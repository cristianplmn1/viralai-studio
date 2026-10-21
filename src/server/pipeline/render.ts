import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { asegurarDirectorio, ffmpeg } from './ffmpeg'
import type { Intervalo } from './analisis'

export type Formato = '9:16' | '16:9'

export interface Resolucion {
  ancho: number
  alto: number
}

export const RESOLUCIONES: Record<Formato, Resolucion> = {
  '9:16': { ancho: 1080, alto: 1920 },
  '16:9': { ancho: 1920, alto: 1080 },
}

/* ------------------------------------------------------------------ */
/* Tipografías                                                          */
/* ------------------------------------------------------------------ */

const CANDIDATAS_FUENTE = [
  'C:/Windows/Fonts/arialbd.ttf',
  'C:/Windows/Fonts/segoeuib.ttf',
  'C:/Windows/Fonts/impact.ttf',
  'C:/Windows/Fonts/verdanab.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/Library/Fonts/Arial Bold.ttf',
]

let fuenteCache: string | null | undefined

export function resolverFuente(): string | null {
  if (fuenteCache !== undefined) return fuenteCache
  for (const ruta of CANDIDATAS_FUENTE) {
    if (existsSync(ruta)) {
      fuenteCache = ruta
      return fuenteCache
    }
  }
  fuenteCache = null
  return fuenteCache
}

export function opcionFuente(): string {
  const ruta = resolverFuente()
  if (ruta) return `fontfile='${ruta.replace(/\\/g, '/').replace(/:/g, '\\:')}'`
  return "font='Sans'"
}

/** Escapa un texto para usarlo dentro de drawtext. */
export function escaparTextoDraw(texto: string): string {
  return texto
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/\n/g, ' ')
    .trim()
}

/* ------------------------------------------------------------------ */
/* Subtítulos                                                          */
/* ------------------------------------------------------------------ */

export interface SegmentoSubtitulo {
  inicio: number
  fin: number
  texto: string
}

/** Convierte segmentos a SRT. */
export function aSrt(segmentos: SegmentoSubtitulo[]): string {
  const tiempo = (segundos: number): string => {
    const ms = Math.max(0, Math.round(segundos * 1000))
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    const s = Math.floor((ms % 60000) / 1000)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`
  }
  return segmentos
    .map(
      (seg, i) =>
        `${i + 1}\n${tiempo(seg.inicio)} --> ${tiempo(seg.fin)}\n${seg.texto.trim()}\n`,
    )
    .join('\n')
}

/**
 * Calcula el tamaño de fuente de un subtítulo para que quepa en el ancho
 * útil del encuadre sin salirse.
 */
export function tamanoFuenteSubtitulo(
  texto: string,
  resolucion: Resolucion,
): number {
  const maximo =
    resolucion.alto / (resolucion.alto > resolucion.ancho ? 13 : 15)
  const caracteres = Math.max(1, texto.length)
  const anchoUtil = resolucion.ancho * 0.88
  const porCaracter = anchoUtil / (caracteres * 0.58)
  return Math.max(16, Math.min(maximo, Math.floor(porCaracter)))
}

/**
 * Genera subtítulos "animados" a partir de las palabras clave del gancho:
 * cada frase entra con un fundido corto y sale con otro.
 */
export function segmentosAnimadosDeTexto(
  texto: string,
  duracion: number,
  maximoFragmentos = 5,
): SegmentoSubtitulo[] {
  const palabras = texto
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

  if (!palabras.length) return []

  const grupos: string[] = []
  const maxPalabras = 4
  for (let i = 0; i < palabras.length; i += maxPalabras) {
    grupos.push(palabras.slice(i, i + maxPalabras).join(' '))
    if (grupos.length >= maximoFragmentos) break
  }

  const util = Math.max(1, duracion * 0.86)
  const salto = util / grupos.length
  const desplazamiento = duracion * 0.05

  return grupos.map((grupo, i) => ({
    inicio: Number((desplazamiento + i * salto).toFixed(2)),
    fin: Number(
      Math.min(duracion, desplazamiento + i * salto + salto * 0.92).toFixed(2),
    ),
    texto: grupo,
  }))
}

/* ------------------------------------------------------------------ */
/* Construcción del grafo de filtros                                   */
/* ------------------------------------------------------------------ */

function expressionSilencio(silencios: Intervalo[]): string {
  if (!silencios.length) return ''
  const tramos = silencios
    .map((s) => `between(t,${s.inicio.toFixed(3)},${s.fin.toFixed(3)})`)
    .join('+')
  return `not(${tramos})`
}

export interface OpcionesRender {
  formato: Formato
  subtitulos: boolean
  eliminarSilencios: boolean
  musica: boolean
  silencios: Intervalo[]
  /** Inicio del clip en el vídeo original (segundos absolutos) */
  inicio: number
  /** Fin del clip en el vídeo original (segundos absolutos) */
  fin: number
  duracion: number
  /** Texto del gancho: alimenta los subtítulos animados */
  gancho?: string
  /** Subtítulos reales transcritos (si hay ASR disponible) */
  transcripcion?: SegmentoSubtitulo[]
  /** Ruta del fichero de música base (ya generado) */
  musicaBase?: string | null
  destino: string
  onProgress?: (fraccion: number) => void
}

export interface ResultadoRender {
  url: string
  ruta: string
  duracion: number
  ancho: number
  alto: number
  conSubtitulos: boolean
  conMusica: boolean
  sinSilencios: boolean
}

/**
 * Renderiza un clip vertical/horizontal aplicando las opciones del editor.
 * Las tres palancas (subtítulos, música, eliminación de silencios) se
 * traducen directamente a filtros de ffmpeg, por lo que el resultado del
 * render refleja el estado de los toggles.
 */
export async function renderizarClip(
  entrada: string,
  opciones: OpcionesRender,
): Promise<ResultadoRender> {
  const { ancho, alto } = RESOLUCIONES[opciones.formato]
  await asegurarDirectorio(opciones.destino)

  const grafo: string[] = []
  const entradas: string[] = ['-i', entrada]

  // El clip se recorta del vídeo original usando tiempos absolutos.
  const inicio = Math.max(0, opciones.inicio)
  const fin = Math.max(inicio + 0.5, opciones.fin)
  const exprSilencio = opciones.eliminarSilencios
    ? expressionSilencio(opciones.silencios)
    : ''

  /* ---------------- VIDEO ---------------- */

  if (exprSilencio) {
    // `select` conserva las marcas de tiempo originales: combinamos el
    // recorte del clip con la eliminación de los tramos silenciosos.
    grafo.push(
      `[0:v]select='between(t,${inicio.toFixed(3)},${fin.toFixed(3)})*${exprSilencio}',` +
        `setpts=N/FRAME_RATE/TB,split=2[vsel0][vsel1]`,
    )
  } else {
    grafo.push(
      `[0:v]trim=start=${inicio}:end=${fin},setpts=PTS-STARTPTS,split=2[vsel0][vsel1]`,
    )
  }

  if (opciones.formato === '9:16') {
    // Fondo desenfocado + primer plano centrado: reutiliza vídeos 16:9 sin recortar
    grafo.push(
      `[vsel0]scale=${ancho}:${alto}:force_original_aspect_ratio=increase,crop=${ancho}:${alto},gblur=sigma=22,eq=brightness=-0.08:saturation=0.9[vbgsrc]`,
    )
    grafo.push(
      `[vsel1]scale=${ancho}:${alto}:force_original_aspect_ratio=decrease[vfg]`,
    )
    grafo.push(`[vbgsrc][vfg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[vcrop]`)
  } else {
    grafo.push(
      `[vsel0]scale=${ancho}:${alto}:force_original_aspect_ratio=increase,crop=${ancho}:${alto},format=yuv420p[vcrop]`,
    )
  }

  /* ---------------- SUBTÍTULOS ---------------- */

  let subtitulosAplicados = false
  const fuente = opcionFuente()

  if (opciones.subtitulos) {
    if (opciones.transcripcion?.length) {
      // Subtítulos reales transcritos (SRT + libass)
      const srt = aSrt(opciones.transcripcion)
      const rutaSrt = opciones.destino.replace(/\.[^.]+$/, '') + '.srt'
      await writeFile(rutaSrt, srt, 'utf8')
      const rutaSrtSeguro = rutaSrt.replace(/\\/g, '/').replace(/:/g, '\\:')
      grafo.push(
        `[vcrop]subtitles='${rutaSrtSeguro}':force_style='FontName=DejaVu Sans,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&HB0000000,BorderStyle=1,Outline=4,Shadow=1,Alignment=2,MarginV=120,Bold=1'[vout]`,
      )
      subtitulosAplicados = true
    } else if (opciones.gancho) {
      // Subtítulos "animados": entradas y salidas con fundido
      const segmentos = segmentosAnimadosDeTexto(
        opciones.gancho,
        opciones.duracion,
      )
      const filtros = segmentos.map((seg) => {
        const a = seg.inicio
        const b = seg.fin
        const alpha =
          `if(lt(t,${a.toFixed(2)}),0,` +
          `if(lt(t,${(a + 0.22).toFixed(2)}),(t-${a.toFixed(2)})/0.22,` +
          `if(lt(t,${(b - 0.22).toFixed(2)}),1,` +
          `max(0,(${b.toFixed(2)}-t)/0.22))))`
        // El tamaño se ajusta al texto para que nunca se salga del encuadre.
        const tamano = tamanoFuenteSubtitulo(seg.texto, { ancho, alto })
        return `drawtext=text='${escaparTextoDraw(seg.texto)}':${fuente}:fontsize=${tamano}:fontcolor=white:borderw=${Math.max(3, Math.round(tamano * 0.12))}:bordercolor=black@0.92:shadowx=0:shadowy=${Math.max(2, Math.round(tamano * 0.08))}:shadowcolor=black@0.55:x=(w-text_w)/2:y=h*0.72:alpha='${alpha}':enable='between(t,${a.toFixed(2)},${b.toFixed(2)})'`
      })
      if (filtros.length) {
        grafo.push(`[vcrop]${filtros.join(',')}[vout]`)
        subtitulosAplicados = true
      } else {
        grafo.push('[vcrop]null[vout]')
      }
    } else {
      grafo.push('[vcrop]null[vout]')
    }
  } else {
    grafo.push('[vcrop]null[vout]')
  }

  /* ---------------- AUDIO ---------------- */

  if (exprSilencio) {
    grafo.push(
      `[0:a]aselect='between(t,${inicio.toFixed(3)},${fin.toFixed(3)})*${exprSilencio}',` +
        `asetpts=N/SR/TB[asel]`,
    )
  } else {
    grafo.push(`[0:a]atrim=start=${inicio}:end=${fin},asetpts=PTS-STARTPTS[asel]`)
  }

  const conMusica = Boolean(opciones.musica && opciones.musicaBase)

  if (conMusica) {
    // La voz se usa dos veces (sidechain y mezcla): hay que duplicarla
    // explícitamente porque en ffmpeg cada etiqueta se enlaza una sola vez.
    grafo.push('[asel]asplit=2[voz1][voz2]')
    // La música entra como fichero real (entrada 1) en bucle infinito.
    entradas.push('-stream_loop', '-1', '-i', opciones.musicaBase!)
    grafo.push('[1:a]aformat=channel_layouts=mono,volume=0.30[mraw]')
    // La voz actúa como sidechain: la música se atenúa cuando hay voz.
    grafo.push(
      '[mraw][voz1]sidechaincompress=threshold=0.02:ratio=10:attack=5:release=350:makeup=1[duck]',
    )
    grafo.push(
      '[voz2][duck]amix=inputs=2:duration=first:weights=1 0.85,volume=0.92[aout]',
    )
  } else {
    grafo.push('[asel]anull[aout]')
  }

  const args = [
    ...entradas,
    '-filter_complex',
    grafo.join(';'),
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '22',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ar',
    '44100',
    '-movflags',
    '+faststart',
    '-shortest',
    opciones.destino,
  ]

  await ffmpeg(args, {
    duracionTotal: opciones.duracion,
    onProgress: (fraccion) => opciones.onProgress?.(fraccion),
  })

  return {
    url: '',
    ruta: opciones.destino,
    duracion: opciones.duracion,
    ancho,
    alto,
    conSubtitulos: subtitulosAplicados,
    conMusica: Boolean(opciones.musica && opciones.musicaBase),
    sinSilencios: Boolean(exprSilencio),
  }
}

/** Genera un póster (primer fotograma) optimizado para el reproductor. */
export async function generarPoster(
  entrada: string,
  segundo: number,
  destino: string,
  resolucion: Resolucion,
): Promise<void> {
  await asegurarDirectorio(destino)
  await ffmpeg([
    '-ss',
    String(Math.max(0, segundo)),
    '-i',
    entrada,
    '-frames:v',
    '1',
    '-vf',
    `scale=${resolucion.ancho}:${resolucion.alto}:force_original_aspect_ratio=increase,crop=${resolucion.ancho}:${resolucion.alto}`,
    '-q:v',
    '4',
    destino,
  ])
}
