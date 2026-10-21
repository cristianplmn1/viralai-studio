/**
 * Prueba de la importación por enlace.
 * Uso: node scripts/test-enlace.mjs [baseUrl]
 */
import { toJSONAsync, fromCrossJSON } from 'seroval'

const BASE = process.argv[2] ?? 'http://localhost:3000'

const cookies = new Map()

function guardarCookies(res) {
  for (const linea of res.headers.getSetCookie?.() ?? []) {
    const [par] = linea.split(';')
    const idx = par.indexOf('=')
    const nombre = par.slice(0, idx).trim()
    const valor = par.slice(idx + 1).trim()
    if (valor === '') cookies.delete(nombre)
    else cookies.set(nombre, valor)
  }
}

function cabeceraCookie() {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

async function discover() {
  const mapa = {}
  for (const modulo of ['auth', 'proyectos', 'clips']) {
    const res = await fetch(`${BASE}/src/server/api/${modulo}.ts`).catch(() => null)
    if (!res?.ok) continue
    const texto = await res.text()
    const rx =
      /export const (fn\w+) = createServerFn\(\{ method: "(GET|POST)" \}\)\.handler\(createClientRpc\("([^"]+)"\)\)/g
    let m
    while ((m = rx.exec(texto)) !== null) {
      mapa[m[1]] = { id: m[3], method: m[2] }
    }
  }
  return mapa
}

let FN = {}

async function fn(nombre, data) {
  const spec = FN[nombre]
  if (!spec) throw new Error(`Server function desconocida: ${nombre}`)
  const headers = {
    'Content-Type': 'application/json',
    'x-tsr-serverFn': 'true',
    accept: 'application/json',
    Cookie: cabeceraCookie(),
    Origin: BASE,
    'Sec-Fetch-Site': 'same-origin',
  }
  let url = `${BASE}/_serverFn/${spec.id}`
  let body
  const payload = data === undefined ? {} : { data }
  if (spec.method === 'POST') {
    body = JSON.stringify(await toJSONAsync(payload))
  } else {
    url += `?payload=${encodeURIComponent(JSON.stringify(await toJSONAsync(payload)))}`
  }
  const res = await fetch(url, { method: spec.method, headers, body })
  guardarCookies(res)
  const texto = await res.text()
  if (!res.ok) throw new Error(`${nombre} -> ${res.status}: ${texto.slice(0, 300)}`)

  // seroval no sabe deserializar el nodo Error: lo detectamos en crudo.
  const mensajeError = /"message":\{"t":1,"s":"((?:[^"\\]|\\.)*)"\}/.exec(texto)
  if (mensajeError) {
    throw new Error(`${nombre}: ${JSON.parse(`"${mensajeError[1]}"`)}`)
  }

  let cuerpo
  try {
    cuerpo = fromCrossJSON(JSON.parse(texto), { plugins: [] })
  } catch {
    cuerpo = texto
  }
  return cuerpo?.result ?? cuerpo
}

const ok = (m) => console.log(`  \x1b[32mOK\x1b[0m  ${m}`)
const fail = (m) => {
  console.log(`  \x1b[31mFAIL\x1b[0m ${m}`)
  process.exitCode = 1
}
const paso = (m) => console.log(`\n\x1b[1m\x1b[35m▸ ${m}\x1b[0m`)

async function main() {
  FN = await discover()
  if (!FN.fnImportarEnlace) {
    fail('no se ha encontrado fnImportarEnlace (¿servidor reiniciado?)')
    return
  }

  const email = `enlace${Date.now()}@viralai.studio`
  await fn('fnRegistrar', { email, nombre: 'Test Enlace', password: 'contrasena-larga-123' })

  paso('1. Protección SSRF: URLs internas y formatos inválidos')
  const attacks = [
    ['http://127.0.0.1:3000/login', 'loopback'],
    ['http://169.254.169.254/latest/meta-data/', 'metadata de nube'],
    ['http://192.168.1.1/admin', 'red privada'],
    ['http://[::1]/x', 'IPv6 loopback'],
    ['file:///etc/passwd', 'protocolo no http'],
    ['http://localhost:4321/demo.mp4', 'localhost por nombre'],
  ]
  for (const [url, etiqueta] of attacks) {
    try {
      await fn('fnImportarEnlace', {
        url,
        formatos: ['9:16'],
        maxClips: 1,
        duracionClip: 30,
        subtitulos: true,
        eliminarSilencios: true,
        musica: false,
      })
      fail(`permitió ${etiqueta}: ${url}`)
    } catch (error) {
      const m = error instanceof Error ? error.message : String(error)
      if (/interna|no permitida|no es una URL|Sólo se admiten|puerto/i.test(m)) {
        ok(`bloqueado ${etiqueta}`)
      } else {
        fail(`error inesperado para ${etiqueta}: ${m.slice(0, 120)}`)
      }
    }
  }

  paso('2. Importación de un MP4 remoto (URL pública real)')
  const url =
    process.env.TEST_VIDEO_URL ??
    'https://www.w3schools.com/html/mov_bbb.mp4'
  let importacion
  try {
    importacion = await fn('fnImportarEnlace', {
      url,
      formatos: ['9:16'],
      maxClips: 2,
      duracionClip: 30,
      subtitulos: true,
      eliminarSilencios: true,
      musica: false,
    })
    ok(`proyecto ${importacion.proyectoId} · job ${importacion.jobId}`)
    ok(`yt-dlp disponible: ${importacion.ytDlp}`)
  } catch (error) {
    fail(`importación: ${error instanceof Error ? error.message : error}`)
    return
  }

  paso('3. El pipeline se ejecuta sobre el vídeo descargado')
  let proyecto = null
  const inicio = Date.now()
  while (Date.now() - inicio < 300_000) {
    const datos = await fn('fnObtenerProyecto', { proyectoId: importacion.proyectoId })
    proyecto = datos.proyecto
    process.stdout.write(
      `\r     ${proyecto.estado} ${proyecto.progreso}% · ${proyecto.etapa ?? ''}`.padEnd(80),
    )
    if (proyecto.estado === 'listo' || proyecto.mensaje_error) break
    await new Promise((r) => setTimeout(r, 2000))
  }
  console.log('')

  if (proyecto.estado === 'listo') {
    ok(`proyecto listo en ${Math.round((Date.now() - inicio) / 1000)}s`)
    ok(`duración detectada: ${proyecto.duracion_seg}s`)
  } else {
    fail(`no listo: ${proyecto.estado} ${proyecto.mensaje_error ?? ''}`)
    return
  }

  paso('4. La IA hizo todo: clips, portadas, título y copy viral')
  const clips = (await fn('fnObtenerProyecto', { proyectoId: importacion.proyectoId }))
    .clips
  if (clips.length >= 1) ok(`${clips.length} clips generados`)
  else fail('no se generó ningún clip')

  const clip = clips[0]
  const detalle = await fn('fnObtenerClip', { clipId: clip.id })
  ok(`${detalle.portadas.length} portadas generadas`)
  if (detalle.viral) {
    ok(`gancho: ${detalle.viral.gancho}`)
    ok(`título: ${detalle.viral.titulo}`)
    ok(`puntuación: ${detalle.viral.puntuacion}/100`)
  } else {
    fail('no hay contenido viral')
  }

  console.log('')
  if (process.exitCode) console.log('\x1b[31m\x1b[1mHay fallos.\x1b[0m')
  else console.log('\x1b[32m\x1b[1mImportación por enlace verificada.\x1b[0m')
}

main().catch((error) => {
  console.error('\n\x1b[31mError inesperado:\x1b[0m', error)
  process.exitCode = 1
})
