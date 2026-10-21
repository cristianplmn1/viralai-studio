import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ffmpeg } from './ffmpeg'

/**
 * cama musical original generada proceduralmente.
 *
 * `sidechaincompress` necesita que ambas entradas procedan de ficheros
 * reales (no de filtros fuente del propio grafo), por lo que la base
 * musical se renderiza una vez a disco y se reutiliza en bucle.
 */

const DIRECTORIO = join(tmpdir(), 'viralai-work')
const FICHERO = join(DIRECTORIO, 'musica-base.wav')

/** Progresión Am – F – C – G, cada acorde dura 4 segundos (16 s en total). */
const ACORDES: { fundamental: number; tercera: number; quinta: number }[] = [
  { fundamental: 220.0, tercera: 261.63, quinta: 329.63 }, // Am
  { fundamental: 174.61, tercera: 220.0, quinta: 261.63 }, // F
  { fundamental: 130.81, tercera: 164.81, quinta: 196.0 }, // C
  { fundamental: 196.0, tercera: 246.94, quinta: 293.66 }, // G
]

const DURACION_ACORDE = 4

function expresionAcorde(acorde: (typeof ACORDES)[number]): string {
  const { fundamental, tercera, quinta } = acorde
  const tremolo = '(0.84+0.16*sin(2*PI*0.9*t))'
  return (
    `(0.20*sin(2*PI*${fundamental.toFixed(2)}*t)` +
    `+0.15*sin(2*PI*${tercera.toFixed(2)}*t)` +
    `+0.11*sin(2*PI*${quinta.toFixed(2)}*t)` +
    `+0.09*sin(2*PI*${(fundamental / 2).toFixed(2)}*t)` +
    `+0.04*sin(2*PI*${(fundamental * 2).toFixed(2)}*t))*${tremolo}`
  )
}

let promesa: Promise<string> | null = null

/** Genera (una sola vez) la base musical en disco y devuelve su ruta. */
export function obtenerMusicaBase(): Promise<string> {
  if (promesa) return promesa
  promesa = (async () => {
    if (existsSync(FICHERO)) return FICHERO
    await mkdir(DIRECTORIO, { recursive: true })

    const entradas: string[] = []
    const etiquetas: string[] = []
    for (let i = 0; i < ACORDES.length; i++) {
      entradas.push(
        '-f',
        'lavfi',
        '-i',
        `aevalsrc='${expresionAcorde(ACORDES[i]!)}':s=44100:d=${DURACION_ACORDE}`,
      )
      etiquetas.push(`[${i}:a]`)
    }

    const grafo = [
      ...ACORDES.flatMap((_, i) => [
        `${etiquetas[i]}aformat=channel_layouts=mono,volume=1.0[ac${i}]`,
      ]),
      `${ACORDES.map((_, i) => `[ac${i}]`).join('')}concat=n=${ACORDES.length}:v=0:a=1,` +
        `afade=t=in:st=0:d=1.5,afade=t=out:st=${ACORDES.length * DURACION_ACORDE - 1.5}:d=1.5[out]`,
    ].join(';')

    await ffmpeg([
      ...entradas,
      '-filter_complex',
      grafo,
      '-map',
      '[out]',
      '-ac',
      '1',
      '-ar',
      '44100',
      '-c:a',
      'pcm_s16le',
      FICHERO,
    ])

    return FICHERO
  })()
  return promesa
}
