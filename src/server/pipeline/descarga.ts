import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { env } from '../env'
import { RUTA_FFMPEG } from './ffmpeg'

/** Ruta del binario de ffmpeg que usaremos también para las fusiones. */
function resolverFfmpeg(): string | null {
  try {
    const ruta = RUTA_FFMPEG()
    return ruta && existsSync(ruta) ? ruta : null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Validación de URLs (protección SSRF)                                */
/* ------------------------------------------------------------------ */

/** Rangos privados/reservados que nunca deben alcanzarse desde el servidor. */
function esIpPrivada(ip: string): boolean {
  if (ip.includes(':')) {
    const normal = ip.toLowerCase()
    if (normal === '::1' || normal === '::') return true
    if (normal.startsWith('fc') || normal.startsWith('fd')) return true
    if (normal.startsWith('fe80')) return true
    if (normal.startsWith('::ffff:')) {
      const v4 = normal.slice(7)
      return esIpPrivada(v4)
    }
    return false
  }
  const partes = ip.split('.').map(Number)
  if (partes.length !== 4 || partes.some((p) => !Number.isInteger(p))) return true
  const [a, b] = partes
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true // link-local / metadata
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a >= 224) return true // multicast / reservada
  return false
}

export interface UrlValidada {
  href: string
  host: string
}

/**
 * Valida una URL de usuario: sólo http/https, sin IPs privadas y sin puertos
 * exóticos. Evita que el servidor fetchee recursos internos (SSRF).
 */
export async function validarUrlVideo(entrada: string): Promise<UrlValidada> {
  let url: URL
  try {
    url = new URL(entrada.trim())
  } catch {
    throw new Error('El enlace no es una URL válida.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Sólo se admiten enlaces http o https.')
  }
  // El puerto no se restringe: la protección real es que el host no resuelva
  // a una dirección interna (comprobado más abajo). Bloquear puertos
  // impediría sources legítimos served en puertos alternativos.

  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) {
    if (esIpPrivada(host)) {
      throw new Error('El enlace apunta a una dirección interna no permitida.')
    }
  } else {
    if (host === 'localhost' || host.endsWith('.localhost')) {
      throw new Error('El enlace apunta a una dirección interna no permitida.')
    }
    let direcciones: { address: string }[]
    try {
      direcciones = await lookup(host, { all: true })
    } catch {
      throw new Error('No se pudo resolver el dominio del enlace.')
    }
    if (!direcciones.length) {
      throw new Error('El dominio del enlace no resuelve a ninguna dirección.')
    }
    if (direcciones.some((d) => esIpPrivada(d.address))) {
      throw new Error('El dominio resuelve a una dirección interna no permitida.')
    }
  }

  return { href: url.toString(), host }
}

/* ------------------------------------------------------------------ */
/* Resolución de yt-dlp                                                */
/* ------------------------------------------------------------------ */

const DIRECTORIO_HERRAMIENTAS = join(process.cwd(), '.tools')

function candidatosYtDlp(): string[] {
  const exe = process.platform === 'win32' ? '.exe' : ''
  return [
    process.env.YT_DLP_PATH ?? '',
    join(DIRECTORIO_HERRAMIENTAS, `yt-dlp${exe}`),
    join(
      process.env.LOCALAPPDATA ?? '',
      'ViralAI',
      `yt-dlp${exe}`,
    ),
    join(process.env.HOME ?? '', '.local', 'share', 'viralai', `yt-dlp${exe}`),
  ].filter(Boolean)
}

export function ytDlpDisponible(): string | null {
  for (const candidato of candidatosYtDlp()) {
    if (existsSync(candidato)) return candidato
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Descarga                                                            */
/* ------------------------------------------------------------------ */

export interface MetadatosDescarga {
  titulo: string
  duracion: number
  thumbnail: string | null
  extractor: string
}

/**
 * Descarga un vídeo a disco.
 * Usa yt-dlp cuando está disponible (YouTube, TikTok, X, Instagram…) y cae
 * a una descarga HTTP directa cuando la URL ya apunta a un fichero de vídeo.
 */
export async function descargarVideo(
  url: string,
  destino: string,
  onProgreso?: (porcentaje: number, fase: string) => void,
): Promise<MetadatosDescarga> {
  const binario = ytDlpDisponible()

  if (binario) {
    // yt-dlp sigue las redirecciones por su cuenta y se saltaría nuestra
    // validación: resolvemos la cadena aquí, comprobando cada salto.
    const resuelta = await resolverRedirecciones(url)
    return descargarConYtDlp(binario, resuelta, destino, onProgreso)
  }
  return descargarDirecto(url, destino, onProgreso)
}

/**
 * Sigue las redirecciones de una URL validando **cada** salto.
 * Si en algún punto se apunta a una dirección interna, se corta.
 */
export async function resolverRedirecciones(url: string): Promise<string> {
  let actual = url
  for (let salto = 0; salto < 5; salto++) {
    const validada = await validarUrlVideo(actual)
    let respuesta: Response
    try {
      respuesta = await fetch(validada.href, {
        method: 'HEAD',
        redirect: 'manual',
        headers: { 'User-Agent': 'ViralAI-Studio/1.0' },
      })
    } catch {
      return validada.href
    }
    const ubicacion = respuesta.headers.get('location')
    if (
      respuesta.status >= 300 &&
      respuesta.status < 400 &&
      ubicacion
    ) {
      actual = new URL(ubicacion, validada.href).toString()
      continue
    }
    return validada.href
  }
  throw new Error('La URL redirige en bucle.')
}

function descargarConYtDlp(
  binario: string,
  url: string,
  destino: string,
  onProgreso?: (porcentaje: number, fase: string) => void,
): Promise<MetadatosDescarga> {
  return new Promise(async (resolve, reject) => {
    // yt-dlp interpreta `-o` como PLANTILLA y añade su propia extensión, así
    // que descargamos a un directorio propio y luego movemos el resultado.
    const dir = join(
      dirname(destino),
      `yt-${basename(destino).replace(/\.[^.]+$/, '')}-${Date.now()}`,
    )
    await mkdir(dir, { recursive: true })

    const argumentos = [
      '--no-playlist',
      '--no-warnings',
      '--newline',
      // `--dump-single-json` implica `--simulate`: sin esto no descarga nada.
      '--no-simulate',
      '--dump-single-json',
      '--print',
      'after_move:filepath',
      '--merge-output-format',
      'mp4',
      '--no-mtime',
      // Preferimos H.264 (avc1): decodificar AV1 por software es ~7x más
      // lento y el resultado se re-codifica a H.264 de todas formas.
      '-f',
      'bv*[height<=1080][vcodec^=avc1]+ba/b[height<=1080][vcodec^=avc1]/b[height<=1080]/b',
      '-o',
      join(dir, 'video.%(ext)s'),
      url,
    ]

    // yt-dlp necesita ffmpeg para fusionar la pista de vídeo con el audio.
    // Si no se lo decimos, deja los ficheros sueltos y se queda sin vídeo.
    const rutaFfmpeg = resolverFfmpeg()
    if (rutaFfmpeg) argumentos.push('--ffmpeg-location', rutaFfmpeg)

    // YouTube pide verificación ("Sign in to confirm you're not a bot") cuando
    // detecta un uso automatizado. Con las cookies del navegador del usuario
    // (YT_DLP_COOKIES_FROM_BROWSER=chrome) o de un fichero de cookies
    // (YT_DLP_COOKIES_FILE) se resuelve.
    const cookiesNavegador = process.env.YT_DLP_COOKIES_FROM_BROWSER
    if (cookiesNavegador) {
      argumentos.push('--cookies-from-browser', cookiesNavegador)
    }
    const ficheroCookies = process.env.YT_DLP_COOKIES_FILE
    if (ficheroCookies) {
      argumentos.push('--cookies', ficheroCookies)
    }

    const hijo = spawn(binario, argumentos, { windowsHide: true })
    let stderr = ''
    let stdout = ''
    let rutaFinal = ''

    hijo.stdout.on('data', (trozo: Buffer) => {
      const texto = trozo.toString('utf8')
      stdout += texto

      const coincidencia = /\[download\]\s+(\d+\.\d)%/.exec(texto)
      if (coincidencia) {
        onProgreso?.(Number(coincidencia[1]), 'Descargando vídeo')
      }
      const lineas = texto
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
      const ultima = lineas[lineas.length - 1]
      if (ultima && /\.[a-z0-9]{2,5}$/i.test(ultima) && !ultima.startsWith('[')) {
        rutaFinal = ultima
        onProgreso?.(100, 'Descargando vídeo')
      }
    })

    hijo.stderr.on('data', (trozo: Buffer) => {
      stderr += trozo.toString('utf8')
      if (stderr.length > 40_000) stderr = stderr.slice(-20_000)
    })

    hijo.on('error', (error) => reject(error))

    hijo.on('close', async (codigo) => {
      if (codigo !== 0) {
        const mensaje = /ERROR:\s*(.+)/i.exec(stderr)
        console.log(
          '[TRAZA traducir] capturada:',
          JSON.stringify(mensaje?.[1]?.slice(0, 90) ?? null),
        )
        reject(
          new Error(
            traducirErrorDescarga(
              mensaje?.[1]?.trim() ??
                `No se pudo descargar el vídeo (código ${codigo}).`,
            ),
          ),
        )
        return
      }

      try {
        // Localizamos el fichero realmente producido (el ya fusionado).
        let ruta = rutaFinal
        if (!ruta || !existsSync(ruta)) {
          const { readdir } = await import('node:fs/promises')
          const ficheros = await readdir(dir)
          const candidatos = ficheros.filter((f) => /\.(mp4|mkv|webm|mov)$/i.test(f))
          // Preferimos el MP4 fusionado; el resto puede ser sólo audio.
          const elegido =
            candidatos.find((f) => f.toLowerCase() === 'video.mp4') ??
            candidatos.find((f) => f.toLowerCase().endsWith('.mp4')) ??
            candidatos[0]
          if (!elegido) {
            throw new Error('El extractor no ha devuelto ningún fichero de vídeo.')
          }
          ruta = join(dir, elegido)
        }

        await mkdir(dirname(destino), { recursive: true })
        await copyFile(ruta, destino)

        // Metadatos del vídeo original (título real de la fuente).
        let metadatos: MetadatosDescarga = {
          titulo: '',
          duracion: 0,
          thumbnail: null,
          extractor: 'yt-dlp',
        }
        // `--dump-single-json` emite el JSON en una única línea.
        const lineaJson = stdout
          .split('\n')
          .map((l) => l.trim())
          .find((l) => l.startsWith('{') && l.endsWith('}'))
        if (lineaJson) {
          try {
            const datos = JSON.parse(lineaJson) as {
              title?: string
              duration?: number
              thumbnail?: string
              extractor?: string
            }
            metadatos = {
              titulo: datos.title ?? '',
              duracion: Number(datos.duration ?? 0) || 0,
              thumbnail: datos.thumbnail ?? null,
              extractor: datos.extractor ?? 'yt-dlp',
            }
          } catch {
            /* metadatos no analizables: seguimos con el título del fichero */
          }
        }

        resolve(metadatos)
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  })
}

async function descargarDirecto(
  url: string,
  destino: string,
  onProgreso?: (porcentaje: number, fase: string) => void,
): Promise<MetadatosDescarga> {
  onProgreso?.(5, 'Descargando vídeo')

  // Cada redirección se valida como si fuera una URL nueva: si no, una URL
  // pública podría redirigir a la metadata de la nube (169.254.169.254).
  let actual = url
  let respuesta: Response | null = null
  for (let salto = 0; salto < 4; salto++) {
    const validada = await validarUrlVideo(actual)
    respuesta = await fetch(validada.href, {
      headers: { 'User-Agent': 'ViralAI-Studio/1.0' },
      redirect: 'manual',
    })

    if (
      respuesta.status >= 300 &&
      respuesta.status < 400 &&
      respuesta.headers.get('location')
    ) {
      const destinoRedirect = new URL(
        respuesta.headers.get('location')!,
        validada.href,
      ).toString()
      actual = destinoRedirect
      respuesta = null
      continue
    }
    break
  }

  if (!respuesta) {
    throw new Error('La URL redirige en bucle o a un destino no permitido.')
  }
  if (!respuesta.ok) {
    throw new Error(`El servidor devolvió ${respuesta.status} al descargar.`)
  }

  const tipo = respuesta.headers.get('content-type') ?? ''
  if (!tipo.startsWith('video/') && !tipo.includes('octet-stream')) {
    throw new Error(
      'El enlace no apunta a un fichero de vídeo. Instala yt-dlp para importar de YouTube o TikTok.',
    )
  }

  const total = Number(respuesta.headers.get('content-length') ?? 0)
  await mkdir(dirname(destino), { recursive: true })
  const salida = createWriteStream(destino)

  let recibido = 0
  const cuerpo = Readable.fromWeb(
    respuesta.body as import('node:stream/web').ReadableStream,
  )
  cuerpo.on('data', (trozo: Buffer) => {
    recibido += trozo.length
    if (total > 0) onProgreso?.(Math.round((recibido / total) * 95), 'Descargando vídeo')
  })

  await pipeline(cuerpo, salida)
  onProgreso?.(100, 'Descargando vídeo')

  return {
    titulo: '',
    duracion: 0,
    thumbnail: null,
    extractor: 'directo',
  }
}

/**
 * Traduce los errores típicos de yt-dlp a un mensaje que el usuario pueda
 * resolver. Los errores crudos ("Sign in to confirm you're not a bot") no
 * le dicen nada a un creador.
 */
export function traducirErrorDescarga(mensaje: string): string {
  // yt-dlp usa comillas tipográficas: normalizamos para poder comparar.
  const texto = mensaje
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()

  if (texto.includes("sign in to confirm you're not a bot")) {
    return (
      'YouTube ha pedido verificación por exceso de peticiones automatizadas. ' +
      'Espera unos minutos o exporta las cookies de tu navegador: define ' +
      'YT_DLP_COOKIES_FROM_BROWSER=chrome (o YT_DLP_COOKIES_FILE) en el .env.'
    )
  }
  if (texto.includes('private video') || texto.includes('members-only')) {
    return 'Ese vídeo es privado o sólo para miembros: no se puede importar.'
  }
  if (texto.includes('video unavailable') || texto.includes('has been removed')) {
    return 'Ese vídeo no está disponible (eliminado o restringido en tu región).'
  }
  if (texto.includes('unsupported url') || texto.includes('no suitable extractor')) {
    return 'yt-dlp no reconoce ese sitio. Prueba con un enlace de YouTube, TikTok, X o Instagram.'
  }
  if (texto.includes('geo restricted') || texto.includes('not available in your country')) {
    return 'Ese vídeo está bloqueado por geolocalización.'
  }
  if (texto.includes('age')) {
    return 'Ese vídeo está restringido por edad.'
  }
  return mensaje
}

/* ------------------------------------------------------------------ */
/* Inspección de un enlace (sin descargar)                              */
/* ------------------------------------------------------------------ */

/**
 * Lee los metadatos de un enlace sin bajar el vídeo: título, duración y
 * miniatura. Sirve para teach-early al usuario lo que va a importar y
 * cuánto tardará.
 */
export async function inspeccionarEnlace(
  url: string,
): Promise<MetadatosDescarga & { valido: boolean }> {
  const binario = ytDlpDisponible()
  if (!binario) {
    return {
      titulo: '',
      duracion: 0,
      thumbnail: null,
      extractor: 'directo',
      valido: false,
    }
  }

  return new Promise((resolve) => {
    const hijo = spawn(
      binario,
      [
        '--no-playlist',
        '--no-warnings',
        '--no-simulate',
        '--skip-download',
        '--dump-single-json',
        url,
      ],
      { windowsHide: true },
    )

    let stdout = ''
    let stderr = ''

    hijo.stdout.on('data', (trozo: Buffer) => {
      stdout += trozo.toString('utf8')
    })
    hijo.stderr.on('data', (trozo: Buffer) => {
      stderr += trozo.toString('utf8')
      if (stderr.length > 20_000) stderr = stderr.slice(-10_000)
    })

    hijo.on('error', () => {
      resolve({
        titulo: '',
        duracion: 0,
        thumbnail: null,
        extractor: 'error',
        valido: false,
      })
    })

    hijo.on('close', (codigo) => {
      if (codigo !== 0) {
        const mensaje = /ERROR:\s*(.+)/i.exec(stderr)
        resolve({
          titulo: traducirErrorDescarga(
            mensaje?.[1]?.trim() ?? 'No se ha podido leer el enlace.',
          ),
          duracion: 0,
          thumbnail: null,
          extractor: 'error',
          valido: false,
        })
        return
      }

      const linea = stdout
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('{') && l.endsWith('}'))
      if (!linea) {
        resolve({
          titulo: '',
          duracion: 0,
          thumbnail: null,
          extractor: 'error',
          valido: false,
        })
        return
      }

      try {
        const datos = JSON.parse(linea) as {
          title?: string
          duration?: number
          thumbnail?: string
          extractor?: string
        }
        resolve({
          titulo: datos.title ?? '',
          duracion: Number(datos.duration ?? 0) || 0,
          thumbnail: datos.thumbnail ?? null,
          extractor: datos.extractor ?? 'yt-dlp',
          valido: true,
        })
      } catch {
        resolve({
          titulo: '',
          duracion: 0,
          thumbnail: null,
          extractor: 'error',
          valido: false,
        })
      }
    })
  })
}

/**
 * Estimación orientativa del tiempo de proceso a partir de la duración del
 * vídeo original. Se calibra con las medidas reales del pipeline: el análisis
 * escala con la duración y cada clip renderizado tiene un coste fijo.
 */
export function estimarTiempoProceso(
  duracionVideo: number,
  numeroClips: number,
): number {
  // El análisis escala con la duración (decodificar el vídeo entero) y cada
  // clip renderizado tiene un coste fijo.
  const analisis = 3 + duracionVideo * 0.12
  const renders = numeroClips * 3.2
  return Math.max(8, Math.round(analisis + renders))
}

export async function existeFichero(ruta: string): Promise<boolean> {
  try {
    const info = await stat(ruta)
    return info.size > 1024
  } catch {
    return false
  }
}
