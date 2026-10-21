import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

export interface OpcionesFfmpeg {
  /** Callback de progreso 0-1 con el tiempo consumido en segundos */
  onProgress?: (fraccion: number, segundos: number) => void
  /** Duración total conocida, para normalizar el progreso */
  duracionTotal?: number
  timeoutMs?: number
  cwd?: string
}

export class ErrorFfmpeg extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message)
    this.name = 'ErrorFfmpeg'
  }
}

/* ------------------------------------------------------------------ */
/* Resolución de binarios                                              */
/* ------------------------------------------------------------------ */

/**
 * Localiza el binario sin importar el paquete `ffmpeg-static`: es CommonJS y
 * al empaquetarlo para ESM su `__dirname` deja de existir.
 *
 * Orden de búsqueda:
 *   1. `FFMPEG_PATH` / `FFPROBE_PATH`
 *   2. binarios instalados junto al proyecto (`node_modules`)
 *   3. el PATH del sistema
 */
function localizarBinario(nombre: 'ffmpeg' | 'ffprobe'): string {
  const variable = nombre === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'
  const desdeEnv = process.env[variable]
  if (desdeEnv && existsSync(desdeEnv)) return desdeEnv

  const base = join(process.cwd(), 'node_modules')
  const candidatos =
    nombre === 'ffmpeg'
      ? [
          join(base, 'ffmpeg-static', 'ffmpeg.exe'),
          join(base, 'ffmpeg-static', 'ffmpeg'),
        ]
      : [
          join(base, 'ffprobe-static', 'bin', 'win32', 'x64', 'ffprobe.exe'),
          join(base, 'ffprobe-static', 'bin', 'linux', 'x64', 'ffprobe'),
          join(base, 'ffprobe-static', 'bin', 'darwin', 'x64', 'ffprobe'),
          join(base, 'ffprobe-static', 'bin', 'darwin', 'arm64', 'ffprobe'),
        ]

  for (const candidato of candidatos) {
    if (existsSync(candidato)) return candidato
  }

  // Último recurso: el PATH del sistema.
  return nombre
}

/**
 * Alternativa para entornos donde los binarios están en el `node_modules`
 * del proyecto pero el proceso se ejecuta desde otro directorio.
 */
function localizarEnPaquete(nombre: 'ffmpeg' | 'ffprobe'): string | null {
  try {
    const require = createRequire(import.meta.url)
    // Nombre dinámico: evita que el empaquetador resuelva el CommonJS.
    const paquete = nombre === 'ffmpeg' ? 'ffmpeg-static' : 'ffprobe-static'
    const valor = require(paquete) as string | { path?: string }
    if (typeof valor === 'string') {
      return existsSync(valor) ? valor : null
    }
    const ruta = (valor as { path?: string }).path
    return ruta && existsSync(ruta) ? ruta : null
  } catch {
    return null
  }
}

export const RUTA_FFMPEG = (): string =>
  localizarEnPaquete('ffmpeg') ?? localizarBinario('ffmpeg')

export const RUTA_FFPROBE = (): string =>
  localizarEnPaquete('ffprobe') ?? localizarBinario('ffprobe')

export function ffmpegDisponible(): boolean {
  try {
    resolverSeguro(RUTA_FFMPEG())
    resolverSeguro(RUTA_FFPROBE())
    return true
  } catch {
    return false
  }
}

function resolverSeguro(ruta: string): string {
  if (!ruta) throw new Error('Binario de ffmpeg no encontrado.')
  return ruta
}

/* ------------------------------------------------------------------ */
/* Ejecución                                                            */
/* ------------------------------------------------------------------ */

export interface ResultadoProceso {
  stdout: Buffer
  stderr: string
}

export function ejecutar(
  binario: string,
  args: string[],
  opciones: OpcionesFfmpeg = {},
): Promise<ResultadoProceso> {
  const timeout = opciones.timeoutMs ?? 15 * 60 * 1000

  return new Promise((resolve, reject) => {
    const hijo = spawn(binario, args, {
      cwd: opciones.cwd,
      windowsHide: true,
    })

    const stdoutChunks: Buffer[] = []
    let stderr = ''
    let terminado = false

    const temporizador = setTimeout(() => {
      if (!terminado) {
        terminado = true
        hijo.kill('SIGKILL')
        reject(
          new ErrorFfmpeg(
            `El proceso ${binario} superó el tiempo límite`,
            stderr.slice(-4000),
          ),
        )
      }
    }, timeout)

    hijo.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))

    hijo.stderr.on('data', (chunk: Buffer) => {
      const texto = chunk.toString('utf8')
      stderr += texto
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000)

      if (opciones.onProgress && opciones.duracionTotal) {
        const coincidencia = /out_time_ms=(\d+)/.exec(texto)
        if (coincidencia) {
          const segundos = Number(coincidencia[1]) / 1_000_000
          const fraccion = Math.min(
            0.999,
            Math.max(0, segundos / opciones.duracionTotal),
          )
          opciones.onProgress(fraccion, segundos)
        }
      }
    })

    hijo.on('error', (error) => {
      clearTimeout(temporizador)
      if (!terminado) {
        terminado = true
        reject(error)
      }
    })

    hijo.on('close', (code) => {
      clearTimeout(temporizador)
      if (terminado) return
      terminado = true
      if (code === 0) {
        resolve({ stdout: Buffer.concat(stdoutChunks), stderr })
      } else {
        // El final de stderr contiene la causa real del fallo.
        const cola = stderr.trim().split('\n').slice(-6).join(' | ')
        reject(
          new ErrorFfmpeg(
            `${binario} terminó con código ${code}${cola ? `: ${cola}` : ''}`,
            stderr.slice(-4000),
          ),
        )
      }
    })
  })
}

export function ffmpeg(
  args: string[],
  opciones: OpcionesFfmpeg = {},
): Promise<ResultadoProceso> {
  return ejecutar(RUTA_FFMPEG(), ['-hide_banner', '-nostdin', '-y', ...args], opciones)
}

export async function ffprobeJson(args: string[]): Promise<Record<string, unknown>> {
  const { stdout } = await ejecutar(RUTA_FFPROBE(), [
    '-v',
    'quiet',
    '-print_format',
    'json',
    ...args,
  ])
  return JSON.parse(stdout.toString('utf8')) as Record<string, unknown>
}

/* ------------------------------------------------------------------ */
/* Utilidades de vídeo                                                 */
/* ------------------------------------------------------------------ */

export interface MetadatosVideo {
  duracion: number
  ancho: number
  alto: number
  fps: number
  tieneAudio: boolean
  tieneVideo: boolean
  bitrate: number
}

export async function sondearVideo(ruta: string): Promise<MetadatosVideo> {
  const datos = await ffprobeJson([
    '-show_format',
    '-show_streams',
    '-i',
    ruta,
  ])
  const streams = (datos.streams ?? []) as Record<string, unknown>[]
  const format = (datos.format ?? {}) as Record<string, unknown>

  const video = streams.find((s) => s.codec_type === 'video')
  const audio = streams.find((s) => s.codec_type === 'audio')

  const duracion = Number(format.duration ?? video?.duration ?? 0) || 0
  let fps = 30
  if (video?.r_frame_rate) {
    const [num, den] = String(video.r_frame_rate).split('/')
    const n = Number(num)
    const d = Number(den)
    if (n > 0 && d > 0) fps = n / d
  }

  return {
    duracion: Math.round(duracion * 1000) / 1000,
    ancho: Number(video?.width ?? 0),
    alto: Number(video?.height ?? 0),
    fps,
    tieneAudio: Boolean(audio),
    tieneVideo: Boolean(video),
    bitrate: Number(format.bit_rate ?? 0),
  }
}

export async function asegurarDirectorio(ruta: string): Promise<void> {
  await mkdir(dirname(ruta), { recursive: true })
}

/** Extrae un fotograma concreto como JPEG. */
export async function extraerFrame(
  entrada: string,
  segundo: number,
  destino: string,
  opciones: { ancho?: number; alto?: number; calidad?: number } = {},
): Promise<void> {
  await asegurarDirectorio(destino)
  const filtros: string[] = []
  if (opciones.ancho && opciones.alto) {
    filtros.push(
      `scale=${opciones.ancho}:${opciones.alto}:force_original_aspect_ratio=increase`,
      `crop=${opciones.ancho}:${opciones.alto}`,
    )
  }
  const args = [
    '-ss',
    String(Math.max(0, segundo)),
    '-i',
    entrada,
    '-frames:v',
    '1',
    ...(filtros.length ? ['-vf', filtros.join(',')] : []),
    '-q:v',
    String(opciones.calidad ?? 2),
    destino,
  ]
  await ffmpeg(args)
}

/** Devuelve los píxeles RGB crudos de un fotograma para analizar colores. */
export async function leerPixelesRGB(
  entrada: string,
): Promise<{ datos: Buffer; ancho: number; alto: number }> {
  const meta = await sondearVideo(entrada)
  const { stdout } = await ffmpeg([
    '-i',
    entrada,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-',
  ])
  return {
    datos: stdout,
    ancho: meta.ancho,
    alto: meta.alto,
  }
}
