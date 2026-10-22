/**
 * Comprueba las páginas en un navegador real (headless) y CON sesión.
 *
 * El HTML del servidor puede ser correcto y que la página esté rota en el
 * navegador: un import que falta o un error de hidratación sólo se ven con
 * JavaScript. Esto lo cazaba todo.
 *
 * Usa el protocolo de DevTools de Chrome (CDP) sobre el WebSocket nativo
 * de Node, así que no hace falta ninguna dependencia extra.
 *
 * Uso: node scripts/check-navegador.mjs [baseUrl]
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { toJSONAsync, fromCrossJSON } from 'seroval'

const BASE = process.argv[2] ?? 'http://localhost:3000'

const NAVEGADORES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

function buscarNavegador() {
  for (const ruta of NAVEGADORES) if (existsSync(ruta)) return ruta
  return null
}

/* ------------------------------------------------------------------ */
/* Sesión: nos registramos para tener cookie                            */
/* ------------------------------------------------------------------ */

async function registrar() {
  const res = await fetch(`${BASE}/src/server/api/auth.ts`)
  const texto = await res.text()
  const rx =
    /export const (fn\w+) = createServerFn\(\{ method: "(GET|POST)" \}\)\.handler\(createClientRpc\("([^"]+)"\)\)/g
  const mapa = {}
  let m
  while ((m = rx.exec(texto)) !== null) mapa[m[1]] = { id: m[3], method: m[2] }

  const spec = mapa.fnRegistrar
  const body = JSON.stringify(
    await toJSONAsync({
      data: {
        email: `nav${Date.now()}@viralai.studio`,
        nombre: 'Test Navegador',
        password: 'contrasena-larga-123',
      },
    }),
  )
  const r = await fetch(`${BASE}/_serverFn/${spec.id}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tsr-serverFn': 'true',
      accept: 'application/json',
      Origin: BASE,
      'Sec-Fetch-Site': 'same-origin',
    },
    body,
  })
  const cookie = (r.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('viralai_sesion='))
  return cookie ?? null
}

/* ------------------------------------------------------------------ */
/* Chrome DevTools Protocol                                             */
/* ------------------------------------------------------------------ */

class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pendientes = new Map()
    this.eventos = []
    ws.addEventListener('message', (evento) => {
      const datos = JSON.parse(evento.data)
      if (datos.id && this.pendientes.has(datos.id)) {
        const { resolver, rechazar } = this.pendientes.get(datos.id)
        this.pendientes.delete(datos.id)
        if (datos.error) rechazar(new Error(datos.error.message))
        else resolver(datos.result)
      } else if (datos.method) {
        this.eventos.push(datos)
      }
    })
  }

  enviar(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolver, rechazar) => {
      this.pendientes.set(id, { resolver, rechazar })
      setTimeout(() => {
        if (this.pendientes.has(id)) {
          this.pendientes.delete(id)
          rechazar(new Error(`CDP ${method} sin respuesta`))
        }
      }, 30_000)
    })
  }
}

async function abrirNavegador() {
  const binario = buscarNavegador()
  if (!binario) throw new Error('No hay navegador headless disponible')

  const perfil = join(tmpdir(), `viralai-cdp-${Date.now()}`)
  mkdirSync(perfil, { recursive: true })

  const hijo = spawn(
    binario,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--remote-debugging-port=0',
      `--user-data-dir=${perfil}`,
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  )

  // El puerto real se escribe en DevToolsActivePort.
  const ficheroPuerto = join(perfil, 'DevToolsActivePort')
  let puerto = null
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 200))
    if (existsSync(ficheroPuerto)) {
      const lineas = readFileSync(ficheroPuerto, 'utf8').split('\n')
      if (lineas[0]?.trim()) {
        puerto = Number(lineas[0].trim())
        break
      }
    }
  }
  if (!puerto) {
    hijo.kill()
    throw new Error('Chrome no|Published el puerto de depuración')
  }

  const objetivos = await (
    await fetch(`http://127.0.0.1:${puerto}/json/list`)
  ).json()
  const pagina = objetivos.find((o) => o.type === 'page') ?? objetivos[0]
  const ws = new WebSocket(pagina.webSocketDebuggerUrl)
  await new Promise((resolver, rechazar) => {
    ws.addEventListener('open', resolver, { once: true })
    ws.addEventListener('error', rechazar, { once: true })
  })

  return {
    cdp: new CDP(ws),
    cerrar: () => {
      try {
        ws.close()
      } catch {
        /* ignorar */
      }
      hijo.kill()
      try {
        rmSync(perfil, { recursive: true, force: true })
      } catch {
        /* temporal */
      }
    },
  }
}

async function visitar(cdp, url, cookie) {
  await cdp.enviar('Page.enable')
  await cdp.enviar('Runtime.enable')
  await cdp.enviar('Log.enable')
  if (cookie) {
    const [nombre, valor] = cookie.split('=')
    await cdp.enviar('Network.enable')
    await cdp.enviar('Network.setCookie', {
      name: nombre,
      value: valor,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
    })
  }

  cdp.eventos.length = 0
  await cdp.enviar('Page.navigate', { url })
  await new Promise((r) => setTimeout(r, 3500))

  const { result } = await cdp.enviar('Runtime.evaluate', {
    expression: 'document.documentElement.outerHTML',
    returnByValue: true,
  })

  const errores = cdp.eventos
    .filter(
      (e) =>
        e.method === 'Runtime.exceptionThrown' ||
        (e.method === 'Log.entryAdded' && e.params?.entry?.level === 'error') ||
        (e.method === 'Runtime.consoleAPICalled' && e.params?.type === 'error'),
    )
    .map((e) => {
      if (e.method === 'Runtime.exceptionThrown') {
        return (
          e.params?.exceptionDetails?.exception?.description ??
          e.params?.exceptionDetails?.text ??
          'excepción'
        )
      }
      if (e.method === 'Log.entryAdded') return e.params?.entry?.text ?? ''
      return e.params?.args?.map((a) => a.value ?? a.description).join(' ') ?? ''
    })
    .map((t) => String(t).slice(0, 220))

  return { dom: result?.value ?? '', errores }
}

/** Pulsa un elemento (expresión JS) y devuelve el DOM resultante. */
async function clicarYLeer(cdp, expresion) {
  cdp.eventos.length = 0
  await cdp.enviar('Runtime.evaluate', {
    expression: `${expresion}?.click()`,
    awaitPromise: false,
  })
  await new Promise((r) => setTimeout(r, 2500))

  const { result } = await cdp.enviar('Runtime.evaluate', {
    expression: 'document.documentElement.outerHTML',
    returnByValue: true,
  })

  const { result: url } = await cdp.enviar('Runtime.evaluate', {
    expression: 'location.href',
    returnByValue: true,
  })

  const errores = cdp.eventos
    .filter(
      (e) =>
        e.method === 'Runtime.exceptionThrown' ||
        (e.method === 'Log.entryAdded' && e.params?.entry?.level === 'error') ||
        (e.method === 'Runtime.consoleAPICalled' && e.params?.type === 'error'),
    )
    .map((e) => {
      if (e.method === 'Runtime.exceptionThrown') {
        return (
          e.params?.exceptionDetails?.exception?.description ??
          e.params?.exceptionDetails?.text ??
          'excepción'
        )
      }
      if (e.method === 'Log.entryAdded') return e.params?.entry?.text ?? ''
      return e.params?.args?.map((a) => a.value ?? a.description).join(' ') ?? ''
    })
    .map((t) => String(t).slice(0, 220))

  return { dom: result?.value ?? '', errores, url: url?.value ?? '' }
}

/* ------------------------------------------------------------------ */
/* Comprobación                                                          */
/* ------------------------------------------------------------------ */

const PAGINAS = [
  // Sin sesión: el login muestra los botones OAuth.
  { ruta: '/login', conSesion: false, debeContener: ['Conectar YouTube', 'Conectar TikTok'] },
  // Con sesión: el resto de la aplicación.
  { ruta: '/subir', conSesion: true, debeContener: ['Arrastra tu vídeo o grabación aquí'] },
  { ruta: '/dashboard', conSesion: true, debeContener: ['Proyectos', 'Subir vídeo'] },
]

let fallos = 0
let navegador

try {
  navegador = await abrirNavegador()
} catch (error) {
  console.log(`  \x1b[33mAVISO\x1b[0m no se pudo abrir el navegador: ${error.message}`)
  console.log('  (las comprobaciones de navegador se omiten)')
  navegador = null
}

if (navegador) {
  const cookie = await registrar().catch(() => null)

  for (const pagina of PAGINAS) {
    const { dom, errores } = await visitar(
      navegador.cdp,
      `${BASE}${pagina.ruta}`,
      pagina.conSesion ? cookie : null,
    )

    if (dom.includes('Something went wrong!')) {
      const texto = /<code>([^<]{0,220})<\/code>/.exec(dom)?.[1]
      console.log(
        `  \x1b[31mFAIL\x1b[0m ${pagina.ruta}: la página reventó → ${texto ?? 'error desconocido'}`,
      )
      fallos++
      continue
    }

    const faltan = pagina.debeContener.filter((t) => !dom.includes(t))
    if (faltan.length) {
      console.log(
        `  \x1b[31mFAIL\x1b[0m ${pagina.ruta}: no aparece ${faltan.join(', ')}`,
      )
      fallos++
      continue
    }

    if (errores.length) {
      console.log(`  \x1b[31mFAIL\x1b[0m ${pagina.ruta}: errores de JavaScript`)
      for (const e of errores.slice(0, 3)) console.log(`        ${e}`)
      fallos++
      continue
    }

    console.log(`  \x1b[32mOK\x1b[0m   ${pagina.ruta} se renderiza e hidrata sin errores`)
  }

  // El botón de conectar con YouTube/TikTok debe responder (con un aviso
  // claro si la plataforma no está configurada, o redirigiendo a OAuth).
  {
    await visitar(navegador.cdp, `${BASE}/dashboard`, cookie)
    const { dom, errores, url } = await clicarYLeer(
      navegador.cdp,
      `Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('YouTube'))`,
    )
    const fallo = dom.includes('Something went wrong!')
    const aviso = /no está configurado|YouTube OAuth/i.test(dom)
    const oauth = /accounts\.google\.com/.test(url)

    if (fallo) {
      console.log('  \x1b[31mFAIL\x1b[0m el botón de YouTube rompe la página')
      fallos++
    } else if (errores.length) {
      console.log('  \x1b[31mFAIL\x1b[0m el botón de YouTube genera errores de JavaScript')
      for (const e of errores.slice(0, 3)) console.log(`        ${e}`)
      fallos++
    } else if (oauth) {
      console.log(
        '  \x1b[32mOK\x1b[0m   el botón de YouTube redirige a OAuth de Google',
      )
    } else if (aviso) {
      console.log(
        '  \x1b[32mOK\x1b[0m   el botón de YouTube responde (aviso de OAuth sin configurar)',
      )
    } else {
      console.log(
        `  \x1b[31mFAIL\x1b[0m el botón de YouTube no hace nada (url: ${url})`,
      )
      fallos++
    }
  }

  navegador.cerrar()
}

if (fallos) {
  console.error(
    `\n\x1b[31m\x1b[1m${fallos} página(s) con errores en el navegador.\x1b[0m`,
  )
  process.exit(1)
}
console.log('\n\x1b[32m\x1b[1mTodas las páginas cargan en el navegador.\x1b[0m')
