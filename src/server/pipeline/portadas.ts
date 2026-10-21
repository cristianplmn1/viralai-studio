import { asegurarDirectorio, ffmpeg } from './ffmpeg'
import {
  escaparTextoDraw,
  opcionFuente,
  type Resolucion,
} from './render'

export interface VariantePortada {
  ruta: string
  tituloVisual: string
  fondoEliminado: boolean
  version: number
  /** Instante del clip del que se extrajo el fotograma */
  instante: number
}

export interface OpcionesPortadas {
  entrada: string
  inicio: number
  fin: number
  resolucion: Resolucion
  tituloVisual: string
  eliminarFondo: boolean
  destinoBase: string
}

/* Paletas de acento: una por versión para que las 3 sean comparables pero distintas */
const ACENTOS = [
  { color: '0xE879F9', halo: '0x7C3AED' },
  { color: '0xA78BFA', halo: '0x7E22CE' },
  { color: '0xF472B6', halo: '0x9D174D' },
]

/* ------------------------------------------------------------------ */
/* Detección del color de fondo                                        */
/* ------------------------------------------------------------------ */

export interface ColorFondo {
  hex: string
  rgb: [number, number, number]
  /** 0-1: proporción de píxeles del borde que comparten el color dominante */
  confianza: number
}

export function detectarColorFondo(
  datos: Buffer,
  ancho: number,
  alto: number,
): ColorFondo | null {
  if (!ancho || !alto) return null

  const grosor = Math.max(2, Math.round(Math.min(ancho, alto) * 0.04))
  const conteo = new Map<number, { r: number; g: number; b: number; n: number }>()

  const registrar = (indice: number): void => {
    const r = datos[indice]!
    const g = datos[indice + 1]!
    const b = datos[indice + 2]!
    // Cuantizamos a 5 bits por canal para agrupar variaciones
    const clave = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    const actual = conteo.get(clave)
    if (actual) {
      actual.r += r
      actual.g += g
      actual.b += b
      actual.n += 1
    } else {
      conteo.set(clave, { r, g, b, n: 1 })
    }
  }

  for (let y = 0; y < grosor; y++) {
    for (let x = 0; x < ancho; x++) {
      registrar((y * ancho + x) * 3)
      registrar(((alto - 1 - y) * ancho + x) * 3)
    }
  }
  for (let y = grosor; y < alto - grosor; y++) {
    for (let x = 0; x < grosor; x++) {
      registrar((y * ancho + x) * 3)
      registrar((y * ancho + (ancho - 1 - x)) * 3)
    }
  }

  let mejor: { r: number; g: number; b: number; n: number } | null = null
  for (const valor of conteo.values()) {
    if (!mejor || valor.n > mejor.n) mejor = valor
  }
  if (!mejor) return null

  const r = Math.round(mejor.r / mejor.n)
  const g = Math.round(mejor.g / mejor.n)
  const b = Math.round(mejor.b / mejor.n)
  const hex = [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')

  return {
    hex,
    rgb: [r, g, b],
    confianza: Math.min(
      1,
      mejor.n / Math.max(1, (grosor * ancho + grosor * alto) * 2),
    ),
  }
}

/* ------------------------------------------------------------------ */
/* Generación                                                           */
/* ------------------------------------------------------------------ */

async function pixelesDeFrame(
  entrada: string,
  instante: number,
  resolucion: Resolucion,
): Promise<{ datos: Buffer; ancho: number; alto: number }> {
  const { stdout } = await ffmpeg([
    '-ss',
    instante.toFixed(2),
    '-i',
    entrada,
    '-frames:v',
    '1',
    '-vf',
    `scale=${resolucion.ancho}:${resolucion.alto}:force_original_aspect_ratio=increase,crop=${resolucion.ancho}:${resolucion.alto}`,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-',
  ])
  return { datos: stdout, ancho: resolucion.ancho, alto: resolucion.alto }
}

/**
 * Ajusta el tamaño de fuente para que el texto quepa en el ancho útil.
 * `drawtext` no encoge el texto automáticamente, así que lo calculamos.
 */
export function tamanoFuente(
  texto: string,
  resolucion: Resolucion,
  maximoRelativo: number,
): number {
  const maximo = resolucion.alto / maximoRelativo
  const caracteres = Math.max(1, texto.length)
  // Anchura media de un carácter en negrita ≈ 0.58 del tamaño de fuente
  const anchoUtil = resolucion.ancho * 0.86
  const porCaracter = anchoUtil / (caracteres * 0.58)
  return Math.max(14, Math.min(maximo, Math.floor(porCaracter)))
}

export interface OpcionesPortadaUnica {
  entrada: string
  instante: number
  resolucion: Resolucion
  tituloVisual: string
  eliminarFondo: boolean
  destino: string
  /** Índice de acento 0-2 */
  acento: number
}

/**
 * Genera una sola miniatura. Es la unidad que reutilizan tanto el generador
 * de 3 versiones como la edición del título de una portada concreta.
 */
export async function generarPortadaUnica(
  opciones: OpcionesPortadaUnica,
): Promise<VariantePortada> {
  const { ancho, alto } = opciones.resolucion
  const acento = ACENTOS[opciones.acento % ACENTOS.length]!
  const duracionFuente = 2
  await asegurarDirectorio(opciones.destino)

  const pixeles = await pixelesDeFrame(
    opciones.entrada,
    opciones.instante,
    opciones.resolucion,
  )
  const fondo = detectarColorFondo(pixeles.datos, pixeles.ancho, pixeles.alto)
  const puedeQuitarFondo =
    opciones.eliminarFondo && fondo !== null && fondo.confianza >= 0.18

  const grafo: string[] = []
  const entradas: string[] = []

  if (puedeQuitarFondo) {
    // Capa 1: el sujeto recortado (el fondo se vuelve transparente)
    grafo.push(`[0:v]colorkey=0x${fondo!.hex}:0.30:0.12,format=rgba[sujeto]`)
    // Capa 2: degradado de marca
    grafo.push('[1:v]format=rgba[base]')
    grafo.push('[base][sujeto]overlay=0:0:format=auto[comp]')
    grafo.push('[comp]format=yuv420p,eq=brightness=-0.05:saturation=1.18[vbase]')
    entradas.push(
      '-f',
      'lavfi',
      '-i',
      `gradients=s=${ancho}x${alto}:c0=0x1A0F2E:c1=0x3B0F63:c2=0x6D28D9:x0=0:y0=0:x1=${ancho}:y1=${alto}:d=${duracionFuente}`,
    )
  } else {
    grafo.push('[0:v]format=rgba[comp]')
    grafo.push('[comp]format=yuv420p,eq=brightness=-0.04:saturation=1.14[vbase]')
  }

  // Título visual: banda oscura + texto con acento
  const titulo = opciones.tituloVisual.trim() || 'VIRALAI STUDIO'
  const tamano = tamanoFuente(titulo, opciones.resolucion, 11)
  const altoBanda = Math.round(tamano * 2.5)
  const lineaY = Math.round(alto * 0.76)
  const margenX = Math.round(ancho * 0.06)
  const fuente = opcionFuente()

  grafo.push(
    `[vbase]drawbox=x=0:y=${lineaY - Math.round(tamano * 1.5)}:w=iw:h=${altoBanda}:color=0x000000@0.55:t=fill[bloque]`,
  )
  grafo.push(
    `[bloque]drawbox=x=0:y=${lineaY - Math.round(tamano * 1.5)}:w=${Math.round(ancho * 0.03)}:h=${altoBanda}:color=${acento.color}@0.95:t=fill[barra]`,
  )
  grafo.push(
    `[barra]drawtext=text='${escaparTextoDraw(titulo)}':${fuente}:fontsize=${tamano}:fontcolor=white:borderw=${Math.max(3, Math.round(tamano * 0.09))}:bordercolor=${acento.halo}@0.95:shadowx=0:shadowy=${Math.max(3, Math.round(tamano * 0.1))}:shadowcolor=black@0.7:x=${margenX}:y=${lineaY - Math.round(tamano * 0.95)}:text_align=left[texto]`,
  )

  await ffmpeg([
    '-ss',
    opciones.instante.toFixed(2),
    '-i',
    opciones.entrada,
    ...entradas,
    '-filter_complex',
    grafo.join(';'),
    '-map',
    '[texto]',
    '-frames:v',
    '1',
    '-q:v',
    '3',
    opciones.destino,
  ])

  return {
    ruta: opciones.destino,
    tituloVisual: titulo,
    fondoEliminado: Boolean(puedeQuitarFondo),
    version: opciones.acento + 1,
    instante: Math.round(opciones.instante * 100) / 100,
  }
}

export async function generarPortadas(
  opciones: OpcionesPortadas,
): Promise<VariantePortada[]> {
  const duracion = Math.max(1, opciones.fin - opciones.inicio)
  const offsets = [0.12, 0.5, 0.86]
  const variantes: VariantePortada[] = []

  for (let i = 0; i < offsets.length; i++) {
    const instante = opciones.inicio + duracion * offsets[i]!
    variantes.push(
      await generarPortadaUnica({
        entrada: opciones.entrada,
        instante,
        resolucion: opciones.resolucion,
        tituloVisual: opciones.tituloVisual,
        eliminarFondo: opciones.eliminarFondo,
        destino: `${opciones.destinoBase}.v${i + 1}.jpg`,
        acento: i,
      }),
    )
  }

  return variantes
}
