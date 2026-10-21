import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { env, isOpenAIConfigured } from '../env'
import type { SegmentoSubtitulo } from './render'

export interface ResultadoTranscripcion {
  segmentos: SegmentoSubtitulo[]
  idioma: string
}

/**
 * Transcribe el audio con Whisper (OpenAI). Devuelve `null` si no hay
 * credenciales o si el proveedor falla: los subtítulos animados de palabras
 * clave siguen estando disponibles como alternativa.
 */
export async function transcribir(
  ruta: string,
  idioma?: string,
): Promise<ResultadoTranscripcion | null> {
  if (!isOpenAIConfigured) return null

  const info = await stat(ruta).catch(() => null)
  if (!info) return null

  const form = new FormData()
  form.append('file', new Blob([await createReadStream(ruta) as unknown as BlobPart]), basename(ruta))
  form.append('model', env.openai.transcriptionModel)
  form.append('response_format', 'verbose_json')
  if (idioma) form.append('language', idioma)

  try {
    const respuesta = await fetch(`${env.openai.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.openai.apiKey}` },
      body: form,
    })
    if (!respuesta.ok) return null

    const cuerpo = (await respuesta.json()) as {
      language?: string
      segments?: { start?: number; end?: number; text?: string }[]
      text?: string
    }

    const segmentos: SegmentoSubtitulo[] = (cuerpo.segments ?? [])
      .filter((s) => typeof s.text === 'string' && s.text.trim().length > 0)
      .map((s) => ({
        inicio: Number(s.start ?? 0),
        fin: Number(s.end ?? 0),
        texto: String(s.text).trim(),
      }))

    if (!segmentos.length && cuerpo.text) {
      // Formato simple: repartimos el texto en bloques de ~6 s
      const frases = cuerpo.text
        .split(/(?<=[.!?])\s+/)
        .map((t) => t.trim())
        .filter(Boolean)
      const duracion = await duracionDe(ruta)
      const porFrase = duracion / Math.max(1, frases.length)
      return {
        idioma: cuerpo.language ?? 'es',
        segmentos: frases.map((texto, i) => ({
          inicio: Number((i * porFrase).toFixed(2)),
          fin: Number(((i + 1) * porFrase).toFixed(2)),
          texto,
        })),
      }
    }

    return {
      segmentos,
      idioma: cuerpo.language ?? 'es',
    }
  } catch {
    return null
  }
}

async function duracionDe(ruta: string): Promise<number> {
  const { ffprobeJson } = await import('./ffmpeg')
  const datos = await ffprobeJson(['-show_format', '-i', ruta])
  const format = (datos.format ?? {}) as Record<string, unknown>
  return Number(format.duration ?? 0) || 0
}
