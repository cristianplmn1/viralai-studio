import { env, isOpenAIConfigured } from '../env'
import type { FragmentoRecomendado } from '../db/types'
import type { MomentoDestacado } from './analisis'

/* ------------------------------------------------------------------ */
/* Puntuación explicable                                               */
/* ------------------------------------------------------------------ */

export interface DesglosePuntuacion {
  criterio: string
  puntos: number
  maximo: number
  detalle: string
}

export function puntuarContenido(input: {
  gancho: string
  titulo: string
  descripcion: string
  hashtags: string[]
  duracionClip: number
}): { total: number; desglose: DesglosePuntuacion[] } {
  const desglose: DesglosePuntuacion[] = []

  // 1. Gancho (20 pts): 6-16 palabras, se lee en 1-3 s
  const palabrasGancho = input.gancho.trim().split(/\s+/).filter(Boolean).length
  let puntos = 0
  let detalle = `${palabrasGancho} palabras`
  if (palabrasGancho >= 6 && palabrasGancho <= 16) {
    puntos = 20
    detalle = `${palabrasGancho} palabras — ritmo ideal para 1-3 s`
  } else if (palabrasGancho >= 4 && palabrasGancho <= 22) {
    puntos = 12
    detalle = `${palabrasGancho} palabras — ritmo aceptable`
  }
  desglose.push({ criterio: 'Gancho', puntos, maximo: 20, detalle })

  // 2. Título (20 pts): 40-70 caracteres, con cifra o interrogación
  const largoTitulo = input.titulo.trim().length
  puntos = 0
  detalle = `${largoTitulo} caracteres`
  if (largoTitulo >= 40 && largoTitulo <= 70) {
    puntos = 20
    if (/\d|\?/.test(input.titulo)) {
      detalle = `${largoTitulo} caracteres con gancho numérico o pregunta`
    } else {
      puntos = 16
      detalle = `${largoTitulo} caracteres (sin cifra ni pregunta)`
    }
  } else if (largoTitulo >= 25 && largoTitulo <= 90) {
    puntos = 10
  }
  desglose.push({ criterio: 'Título', puntos, maximo: 20, detalle })

  // 3. Descripción (20 pts): 120-400 caracteres con llamada a la acción
  const largoDesc = input.descripcion.trim().length
  const tieneCta = /(comenta|sígueme|guarda|compart|apunta|revisar|ver más|↓|👇)/i.test(
    input.descripcion,
  )
  puntos = 0
  detalle = `${largoDesc} caracteres`
  if (largoDesc >= 120 && largoDesc <= 400) {
    puntos = tieneCta ? 20 : 13
    detalle = tieneCta
      ? `${largoDesc} caracteres con llamada a la acción`
      : `${largoDesc} caracteres sin llamada a la acción`
  } else if (largoDesc >= 60) {
    puntos = 7
  }
  desglose.push({ criterio: 'Descripción', puntos, maximo: 20, detalle })

  // 4. Hashtags (20 pts): 5-12, mezcla de nicho y genéricos
  const numeroHashtags = input.hashtags.length
  puntos = 0
  detalle = `${numeroHashtags} hashtags`
  if (numeroHashtags >= 5 && numeroHashtags <= 12) {
    puntos = 20
    detalle = `${numeroHashtags} hashtags — buen alcance`
  } else if (numeroHashtags >= 3) {
    puntos = 12
    detalle = `${numeroHashtags} hashtags — añade 2 o 3 más`
  } else {
    detalle = `${numeroHashtags} hashtags — insuficientes`
  }
  desglose.push({ criterio: 'Hashtags', puntos, maximo: 20, detalle })

  // 5. Duración del clip (20 pts): 15-45 s concentra la retención
  const duracion = input.duracionClip
  puntos = 0
  detalle = `${Math.round(duracion)} s`
  if (duracion >= 15 && duracion <= 45) {
    puntos = 20
    detalle = `${Math.round(duracion)} s — duración ideal para retención`
  } else if (duracion >= 8 && duracion <= 60) {
    puntos = 12
    detalle = `${Math.round(duracion)} s — aceptable`
  }
  desglose.push({ criterio: 'Duración', puntos, maximo: 20, detalle })

  const total = Math.min(100, desglose.reduce((acc, d) => acc + d.puntos, 0))
  return { total, desglose }
}

/* ------------------------------------------------------------------ */
/* Generación heurística                                                */
/* ------------------------------------------------------------------ */

const PLANTILLAS_GANCHO = [
  'Esto es lo que nadie te cuenta sobre {tema}',
  'El error que está arruinando tu {tema}',
  'Te reto a ver esto de {tema}',
  'Cambié mi {tema} en 30 segundos',
  'Lo que nadie te dice sobre {tema}',
  'Este truco de {tema} me ahorró horas',
  'Si haces {tema}, mira esto primero',
  'Antes de publicar tu {tema}, escuche esto',
]

const PLANTILLAS_TITULO = [
  '{gancho} — no te lo puedes perder',
  '{gancho} | Lo que sí funciona',
  '{gancho}: la guía rápida',
  'Aprende {tema} en menos de 1 minuto',
  '{gancho} (esto lo cambia todo)',
]

const HASHTAGS_BASE = [
  '#viral',
  '#parati',
  '#fyp',
  '#shorts',
  '#tiktok',
  '#creadores',
  '#contenidoviral',
  '#motivacion',
  '#aprende',
  '#trucos',
]

const PLANTILLAS_DESCRIPCION = [
  '👆 {gancho}\n\nSi esto te ha servido, guárdalo para verlo cuando lo necesites y compártelo con quien le pueda venir bien.\n\n{hashtags}',
  '{gancho}\n\nDeja tu comentario con tu opinión y sígueme para más contenido como este.\n\n{hashtags}',
  '💡 {gancho}\n\nComenta «INFO» y te paso la versión extendida.\n\n{hashtags}',
]

function limpiarTema(titulo: string): string {
  return (
    titulo
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase() || 'tu tema'
  )
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

function palabrasClave(tema: string): string[] {
  const palabras = tema
    .split(/\s+/)
    .filter((p) => p.length > 3)
    .slice(0, 3)
  return [...new Set([...palabras, ...HASHTAGS_BASE.slice(0, 6)])]
}

export interface EntradaViral {
  tituloProyecto: string
  duracionClip: number
  momentos: MomentoDestacado[]
  /** Semilla para variar las propuestas */
  semilla?: number
}

export interface PropuestaViral {
  gancho: string
  titulo: string
  descripcion: string
  hashtags: string[]
  puntuacion: number
  fragmentos: FragmentoRecomendado[]
}

function pseudoAleatorio(semilla: number): () => number {
  let estado = semilla || 1
  return () => {
    estado = (estado * 1664525 + 1013904223) % 4294967296
    return estado / 4294967296
  }
}

export function generarViralHeuristico(entrada: EntradaViral): PropuestaViral {
  const aleatorio = pseudoAleatorio(entrada.semilla ?? Date.now() % 100000)
  const tema = limpiarTema(entrada.tituloProyecto)

  const ganchoPlantilla =
    PLANTILLAS_GANCHO[Math.floor(aleatorio() * PLANTILLAS_GANCHO.length)]!
  const gancho = capitalizar(ganchoPlantilla.replace('{tema}', tema))

  const tituloPlantilla =
    PLANTILLAS_TITULO[Math.floor(aleatorio() * PLANTILLAS_TITULO.length)]!
  let titulo = tituloPlantilla.replace('{gancho}', gancho).replace('{tema}', tema)
  if (titulo.length > 70) {
    titulo = `${titulo.slice(0, 67).trimEnd()}…`
  }

  const clave = palabrasClave(tema)
  const hashtags = [
    ...new Set([
      `#${clave[0] ?? 'viral'}`,
      `#${clave[1] ?? 'parati'}`,
      ...HASHTAGS_BASE.slice(0, 6),
    ]),
  ].slice(0, 9)

  const descripcionPlantilla =
    PLANTILLAS_DESCRIPCION[
      Math.floor(aleatorio() * PLANTILLAS_DESCRIPCION.length)
    ]!
  const descripcion = descripcionPlantilla
    .replace('{gancho}', gancho)
    .replace('{hashtags}', hashtags.join(' '))

  const fragmentos: FragmentoRecomendado[] = entrada.momentos.map((m) => ({
    inicio_seg: m.inicio,
    fin_seg: m.fin,
    motivo: m.motivo,
    puntuacion: m.puntuacion,
  }))

  const { total } = puntuarContenido({
    gancho,
    titulo,
    descripcion,
    hashtags,
    duracionClip: entrada.duracionClip,
  })

  return {
    gancho,
    titulo,
    descripcion,
    hashtags,
    puntuacion: total,
    fragmentos,
  }
}

/* ------------------------------------------------------------------ */
/* Generación con LLM (opcional)                                        */
/* ------------------------------------------------------------------ */

interface RespuestaLLM {
  gancho: string
  titulo: string
  descripcion: string
  hashtags: string[]
}

export async function generarViralConIA(
  entrada: EntradaViral,
): Promise<PropuestaViral | null> {
  if (!isOpenAIConfigured) return null

  const duracion = Math.round(entrada.duracionClip)
  const sistema = [
    'Eres un expert en contenido viral para short-form video (TikTok, Reels, YouTube Shorts).',
    'Devuelces EXCLUSIVAMENTE JSON válido con esta forma:',
    '{"gancho":"...","titulo":"...","descripcion":"...","hashtags":["#a","#b"]}',
    'Reglas:',
    '- "gancho": UNA frase de 6 a 14 palabras que se lee en 1-3 segundos y crea curiosidad o tensión.',
    '- "titulo": entre 40 y 70 caracteres, con una cifra o una pregunta.',
    '- "descripcion": entre 120 y 400 caracteres, incluye una llamada a la acción clara y los hashtags al final.',
    '- "hashtags": entre 5 y 10 hashtags, mezcla uno de nicho y varios de alcance.',
    '- No uses comillas dobles dentro de los valores.',
  ].join('\n')

  const usuario = `Tema del vídeo original: "${entrada.tituloProyecto}".
Duración del clip: ${duracion} segundos.
Momentos destacados detectados: ${entrada.momentos
    .map((m) => `${Math.round(m.inicio)}s-${Math.round(m.fin)}s`)
    .join(', ') || 'no disponibles'}.`

  try {
    const respuesta = await fetch(`${env.openai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.openai.apiKey}`,
      },
      body: JSON.stringify({
        model: env.openai.chatModel,
        temperature: 0.8,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: sistema },
          { role: 'user', content: usuario },
        ],
      }),
    })

    if (!respuesta.ok) return null
    const cuerpo = (await respuesta.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const contenido = cuerpo.choices?.[0]?.message?.content
    if (!contenido) return null

    const datos = JSON.parse(contenido) as RespuestaLLM
    if (!datos.gancho || !datos.titulo) return null

    const hashtags = (datos.hashtags ?? [])
      .map((h) => (h.startsWith('#') ? h : `#${h}`))
      .slice(0, 12)

    const fragmentos: FragmentoRecomendado[] = entrada.momentos.map((m) => ({
      inicio_seg: m.inicio,
      fin_seg: m.fin,
      motivo: m.motivo,
      puntuacion: m.puntuacion,
    }))

    const { total } = puntuarContenido({
      gancho: datos.gancho,
      titulo: datos.titulo,
      descripcion: datos.descripcion ?? '',
      hashtags,
      duracionClip: entrada.duracionClip,
    })

    return {
      gancho: datos.gancho,
      titulo: datos.titulo,
      descripcion: datos.descripcion ?? '',
      hashtags,
      puntuacion: total,
      fragmentos,
    }
  } catch {
    return null
  }
}

export async function generarViral(entrada: EntradaViral): Promise<PropuestaViral> {
  const conIA = await generarViralConIA(entrada)
  return conIA ?? generarViralHeuristico(entrada)
}
