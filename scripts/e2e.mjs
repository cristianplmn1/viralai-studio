/**
 * Prueba de extremo a extremo contra el servidor de desarrollo.
 * Uso: node scripts/e2e.mjs [baseUrl]
 */
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { toJSONAsync, fromCrossJSON, fromJSON } from 'seroval'
import ffprobeStatic from 'ffprobe-static'

const BASE = process.argv[2] ?? 'http://localhost:3000'

/** Duración real de un render, en segundos. */
async function duracionRender(url) {
  const ruta = await materializar(url)
  const { stdout } = await ejecutar(
    ffprobeStatic.path,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', ruta],
  )
  return Number(stdout.toString('utf8').trim())
}

async function materializar(url) {
  const { writeFile, mkdir } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const res = await fetch(`${BASE}${url}`)
  const destino = join(tmpdir(), 'viralai-work', `probe-${Date.now()}.mp4`)
  await mkdir(join(tmpdir(), 'viralai-work'), { recursive: true })
  await writeFile(destino, Buffer.from(await res.arrayBuffer()))
  return destino
}

function ejecutar(binario, args) {
  return new Promise((resolve, reject) => {
    const hijo = spawn(binario, args, { windowsHide: true })
    const trozos = []
    let stderr = ''
    hijo.stdout.on('data', (c) => trozos.push(c))
    hijo.stderr.on('data', (c) => (stderr += c.toString()))
    hijo.on('close', (codigo) =>
      codigo === 0
        ? resolve({ stdout: Buffer.concat(trozos), stderr })
        : reject(new Error(stderr.slice(-500))),
    )
  })
}

/**
 * Descubre los identificadores de las server functions preguntando al propio
 * servidor de desarrollo por los módulos fuente (en dev cada export se
 * registra con `createClientRpc(<id base64>)`).
 */
async function descubrirServerFns() {
  const mapa = {}

  // 1) Servidor de desarrollo: cada export se registra con createClientRpc(<id>)
  const modulos = ['auth', 'proyectos', 'clips', 'publicar', 'conexion']
  for (const modulo of modulos) {
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
  if (Object.keys(mapa).length) return mapa

  // 2) Build de producción: los ids están en el bundle del servidor
  const { readdir, readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const dir = join(process.cwd(), '.output', 'server', '_ssr')
  const archivos = await readdir(dir).catch(() => [])
  for (const archivo of archivos) {
    if (!archivo.endsWith('.mjs')) continue
    const texto = await readFile(join(dir, archivo), 'utf8')
    const rx =
      /id:\s*"([0-9a-f]{64})"[\s\S]{0,900}?var\s+(fn[A-Za-z0-9_]+)\s*=\s*createServerFn\(\{\s*method:\s*"(GET|POST)"/g
    let m
    while ((m = rx.exec(texto)) !== null) {
      mapa[m[2]] = { id: m[1], method: m[3] }
    }
  }
  return mapa
}

let FN = {}

const cookies = new Map()

function guardarCookies(res) {
  const raw = res.headers.getSetCookie?.() ?? []
  for (const linea of raw) {
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

async function fn(nombre, data) {
  const spec = FN[nombre]
  if (!spec) throw new Error(`Server function desconocida: ${nombre}`)
  const { id, method } = spec

  const headers = {
    'Content-Type': 'application/json',
    'x-tsr-serverFn': 'true',
    accept: 'application/json',
    Cookie: cabeceraCookie(),
    Origin: BASE,
    'Sec-Fetch-Site': 'same-origin',
  }

  let url = `${BASE}/_serverFn/${id}`
  let body
  const payload = data === undefined ? {} : { data }

  if (method === 'POST') {
    body = JSON.stringify(await toJSONAsync(payload))
  } else {
    const serializado = JSON.stringify(await toJSONAsync(payload))
    url += `?payload=${encodeURIComponent(serializado)}`
  }

  const res = await fetch(url, { method, headers, body })
  guardarCookies(res)
  const texto = await res.text()

  if (!res.ok) {
    throw new Error(`ServerFn ${nombre} -> ${res.status}: ${texto.slice(0, 400)}`)
  }

  let cuerpo
  try {
    cuerpo = fromCrossJSON(JSON.parse(texto), { plugins: [] })
  } catch {
    try {
      cuerpo = fromJSON(JSON.parse(texto))
    } catch {
      cuerpo = texto
    }
  }
  if (cuerpo && typeof cuerpo === 'object' && 'error' in cuerpo) {
    throw new Error(
      `ServerFn ${nombre} error: ${JSON.stringify(cuerpo.error).slice(0, 400)}`,
    )
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
  paso('0. Descubriendo server functions')
  FN = await descubrirServerFns()
  const necesarias = [
    'fnRegistrar',
    'fnSesionActual',
    'fnObtenerProyecto',
    'fnObtenerClip',
    'fnGuardarOpcionesClip',
    'fnEstadoJob',
    'fnPublicar',
    'fnRegenerarPortadas',
    'fnEstadoConexion',
  ]
  const faltan = necesarias.filter((n) => !FN[n])
  if (faltan.length) {
    fail(`no se han encontrado: ${faltan.join(', ')}`)
    return
  }
  ok(`${Object.keys(FN).length} server functions localizadas`)

  const email = `test${Date.now()}@viralai.studio`
  const password = 'contrasena-larga-123'

  paso('1. Registro de usuario')
  const reg = await fn('fnRegistrar', { email, nombre: 'Creador Test', password })
  if (reg.ok) ok(`usuario creado: ${reg.usuario.email}`)
  else fail(`registro: ${JSON.stringify(reg)}`)

  paso('2. Sesión activa')
  const sesion = await fn('fnSesionActual')
  if (sesion.autenticado) ok(`sesión de ${sesion.usuario.email}`)
  else fail(`sesión: ${JSON.stringify(sesion)}`)

  paso('3. Subida del vídeo de demostración')
  const video = await readFile('fixtures/demo.mp4')
  const params = new URLSearchParams({
    titulo: 'Masterclass de edición viral',
    formatos: '9:16',
    max_clips: '3',
    duracion: '30',
    subtitulos: '1',
    silencios: '1',
    musica: '0',
    nombre: 'demo.mp4',
  })
  const resUpload = await fetch(`${BASE}/api/subir?${params}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'video/mp4',
      Cookie: cabeceraCookie(),
      Origin: BASE,
      'Sec-Fetch-Site': 'same-origin',
    },
    body: video,
  })
  const cuerpoUpload = await resUpload.json()
  if (cuerpoUpload.proyectoId) ok(`proyecto creado: ${cuerpoUpload.proyectoId}`)
  else {
    fail(`subida: ${JSON.stringify(cuerpoUpload)}`)
    return
  }
  const proyectoId = cuerpoUpload.proyectoId

  paso('4. El pipeline se ejecuta en segundo plano (no bloquea)')
  let proyecto = null
  const inicio = Date.now()
  while (Date.now() - inicio < 300_000) {
    const datos = await fn('fnObtenerProyecto', { proyectoId })
    proyecto = datos.proyecto
    process.stdout.write(
      `\r     estado=${proyecto.estado} ${proyecto.progreso}% · ${proyecto.etapa ?? ''}`.padEnd(80),
    )
    if (proyecto.estado === 'listo' || proyecto.mensaje_error) break
    await new Promise((r) => setTimeout(r, 2000))
  }
  console.log('')
  if (proyecto.estado === 'listo') ok(`proyecto listo en ${Math.round((Date.now() - inicio) / 1000)}s`)
  else fail(`proyecto no listo: ${proyecto.estado} ${proyecto.mensaje_error ?? ''}`)

  paso('5. Clips generados')
  const conClips = await fn('fnObtenerProyecto', { proyectoId })
  const clips = conClips.clips
  if (clips.length >= 1) ok(`${clips.length} clips generados`)
  else fail('no se generó ningún clip')

  const verticales = clips.filter((c) => c.formato === '9:16')
  if (verticales.length >= 1) ok(`${verticales.length} clips en formato 9:16`)
  else fail('no hay clips en 9:16')

  for (const clip of clips) {
    const dur = clip.fin_seg - clip.inicio_seg
    console.log(
      `     clip ${clip.id.slice(0, 8)} ${clip.formato} ${clip.inicio_seg}s→${clip.fin_seg}s (${Math.round(dur)}s) viral=${clip.puntuacion_viral} render=${clip.url_render}`,
    )
  }

  paso('6. El render existe y es reproducible (soporte Range)')
  const clip = clips[0]
  const resVideo = await fetch(`${BASE}${clip.url_render}`, {
    headers: { Range: 'bytes=0-1023' },
  })
  if (resVideo.status === 206) ok('HTTP 206 Partial Content (seek habilitado)')
  else fail(`rango: ${resVideo.status}`)

  const duracionConSilencios = await duracionRender(clip.url_render)
  const duracionNominal = clip.fin_seg - clip.inicio_seg
  ok(
    `duración real ${duracionConSilencios.toFixed(1)}s (nominal ${duracionNominal.toFixed(1)}s)`,
  )
  if (duracionConSilencios < duracionNominal - 0.5) {
    ok('el toggle "Eliminar silencios" recortó el render')
  } else {
    fail(
      `el render no se acortó (${duracionConSilencios.toFixed(1)}s vs ${duracionNominal.toFixed(1)}s)`,
    )
  }

  paso('7. Portadas: 3 versiones comparables')
  const det = await fn('fnObtenerClip', { clipId: clip.id })
  if (det.portadas.length === 3) ok('3 portadas generadas')
  else fail(`portadas: ${det.portadas.length}`)

  for (const portada of det.portadas) {
    const resP = await fetch(`${BASE}${portada.url_imagen}`)
    const tipo = resP.headers.get('content-type')
    const largo = Number(resP.headers.get('content-length') ?? 0)
    if (resP.ok && tipo?.startsWith('image/')) {
      ok(`v${portada.version}: ${tipo} · ${(largo / 1024).toFixed(0)} KB · fondo=${portada.fondo_eliminado}`)
    } else {
      fail(`v${portada.version}: ${resP.status}`)
    }
  }

  paso('8. Contenido viral (gancho, título, descripción, hashtags, puntuación)')
  const v = det.viral
  if (!v) fail('no hay contenido viral')
  else {
    ok(`puntuación ${v.puntuacion}/100`)
    ok(`gancho (${v.gancho.split(/\s+/).length} palabras): ${v.gancho}`)
    ok(`título (${v.titulo.length} car.): ${v.titulo}`)
    ok(`descripción (${v.descripcion.length} car.)`)
    ok(`hashtags (${v.hashtags.length}): ${v.hashtags.join(' ')}`)
    ok(`fragmentos recomendados: ${v.fragmentos.length}`)
    if (v.puntuacion < 0 || v.puntuacion > 100) fail('puntuación fuera de rango')
  }

  paso('9. Toggles: subtítulos + música cambian el render')
  const urlAntes = clip.url_render
  const guardar = await fn('fnGuardarOpcionesClip', {
    clipId: clip.id,
    subtitulos: true,
    eliminarSilencios: false,
    musica: true,
    formato: '9:16',
  })
  ok(`render relanzado: job ${guardar.jobId}`)

  let job = null
  const t2 = Date.now()
  while (Date.now() - t2 < 300_000) {
    job = await fn('fnEstadoJob', { jobId: guardar.jobId })
    process.stdout.write(`\r     ${job.estado} ${job.progreso}% · ${job.etapa}`.padEnd(80))
    if (job.estado === 'listo' || job.estado === 'error') break
    await new Promise((r) => setTimeout(r, 2000))
  }
  console.log('')
  if (job.estado === 'listo') ok('render con subtítulos y música completado')
  else fail(`render: ${job.estado} ${job.error ?? ''}`)

  const det2 = await fn('fnObtenerClip', { clipId: clip.id })
  const clip2 = det2.clip
  if (clip2.url_render !== urlAntes) ok('la URL del render cambió (se aplicaron las opciones)')
  else fail('el render no se regeneró')
  if (clip2.musica === true && clip2.subtitulos === true) ok('toggles reflejados en el clip')
  else fail('los toggles no se reflejaron')

  const duracionSinSilencios = await duracionRender(clip2.url_render)
  if (duracionSinSilencios > duracionNominal - 1) {
    ok(
      `sin eliminar silencios el render dura ${duracionSinSilencios.toFixed(1)}s (recuperados ${(duracionSinSilencios - duracionConSilencios).toFixed(1)}s)`,
    )
  } else {
    fail(
      `la duración no cambió al desactivar el toggle (${duracionSinSilencios.toFixed(1)}s)`,
    )
  }

  paso('10. Regeneración de portadas')
  const port = await fn('fnRegenerarPortadas', {
    clipId: clip.id,
    tituloVisual: 'TRES ERRORES QUE ARRUINAN TU VÍDEO',
    eliminarFondo: true,
  })
  if (port.portadas.length === 3) ok('3 portadas regeneradas')
  else fail(`portadas regeneradas: ${port.portadas.length}`)

  paso('11. Publicación (modo demo sin credenciales OAuth)')
  const pub = await fn('fnPublicar', {
    clipId: clip.id,
    plataforma: 'shorts',
    fechaProgramada: null,
  })
  if (pub.ok) ok(`${pub.mensaje}`)
  else fail(`publicación: ${JSON.stringify(pub)}`)

  paso('12. Conexión OAuth: estado de cuentas')
  const conexion = await fn('fnEstadoConexion')
  ok(
    `youtube=${conexion.youtube} tiktok=${conexion.tiktok} (youtubeConfigurado=${conexion.youtubeConfigurado}, tiktokConfigurado=${conexion.tiktokConfigurado})`,
  )

  paso('13. Renderizado de las pantallas (SSR)')
  const html = await (await fetch(`${BASE}/dashboard`, {
    headers: { Cookie: cabeceraCookie() },
  })).text()
  if (html.includes('Proyectos') && html.includes('Subir vídeo'))
    ok('dashboard renderizado con proyectos y CTA de subida')
  else fail('el dashboard no se ha renderizado correctamente')

  const htmlSubir = await (await fetch(`${BASE}/subir`, {
    headers: { Cookie: cabeceraCookie() },
  })).text()
  if (htmlSubir.includes('Arrastra tu vídeo o grabación aquí'))
    ok('pantalla de subida con zona de arrastre')
  else fail('la pantalla de subida no se ha renderizado correctamente')

  if (htmlSubir.includes('Generar clips con IA'))
    ok('botón "Generar clips con IA" presente')
  else fail('falta el botón "Generar clips con IA"')

  const htmlProyecto = await (
    await fetch(`${BASE}/proyectos/${proyectoId}`, {
      headers: { Cookie: cabeceraCookie() },
    })
  ).text()
  // React SSR inserta comentarios entre nodos de texto: buscamos tolerante.
  const tieneClips = /Clip\s*(<!--[^>]*-->)?\s*1/.test(htmlProyecto)
  const esLogin = htmlProyecto.includes('Entra en tu estudio')
  if (tieneClips && !esLogin)
    ok('vista de proyecto renderizada con sus clips')
  else
    fail(
      `la vista de proyecto no se ha renderizado correctamente (clips=${tieneClips}, login=${esLogin})`,
    )

  if (html.includes('Ninguna IA garantiza que un vídeo se vuelva viral'))
    ok('aviso legal visible en el dashboard')
  else fail('falta el aviso legal en el dashboard')

  const htmlLogin = await (await fetch(`${BASE}/login`)).text()
  if (
    htmlLogin.includes('Conectar YouTube') &&
    htmlLogin.includes('Conectar TikTok')
  )
    ok('login con botones OAuth de YouTube y TikTok')
  else fail('faltan los botones OAuth en el login')

  const paginas = [
    ['editor', 'Eliminar silencios'],
    ['portadas', 'Título visual'],
    ['viral', 'Fragmentos recomendados'],
    ['publicar', 'Publicar ahora'],
  ]
  for (const [seccion, marcador] of paginas) {
    const html = await (
      await fetch(`${BASE}/proyectos/${proyectoId}/${seccion}/${clip.id}`, {
        headers: { Cookie: cabeceraCookie() },
      })
    ).text()
    if (html.includes(marcador)) ok(`pantalla ${seccion} renderizada`)
    else fail(`la pantalla ${seccion} no contiene "${marcador}"`)
  }

  console.log('')
  if (process.exitCode) {
    console.log('\x1b[31m\x1b[1mHay fallos en la prueba.\x1b[0m')
  } else {
    console.log('\x1b[32m\x1b[1mTodas las comprobaciones han pasado.\x1b[0m')
  }
}

main().catch((error) => {
  console.error('\n\x1b[31mError inesperado:\x1b[0m', error)
  process.exitCode = 1
})
