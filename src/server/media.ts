import { createReadStream } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import { env, isSupabaseConfigured } from './env'
import { BUCKET_MEDIOS, crearClienteSupabase } from './db/supabase'

export const MEDIA_PREFIX = '/api/media/'

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  srt: 'application/x-subrip',
  vtt: 'text/vtt',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
}

export function mimeDeClave(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? ''
  return MIME[ext] ?? 'application/octet-stream'
}

/** Claves seguras: sin "..", sin barras invertidas, longitud acotada. */
export function sanitizarClave(key: string): string {
  const limpio = normalize(key)
    .replace(/\\/g, '/')
    .replace(/\.\./g, '')
    .replace(/[^a-zA-Z0-9/_.-]/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
  if (limpio.length > 200) throw new Error('Clave de medio demasiado larga')
  if (!limpio) throw new Error('Clave de medio vacía')
  return limpio
}

function rutaDisco(key: string): string {
  const raiz = join(process.cwd(), env.storageDir, 'medios')
  const destino = join(raiz, key)
  // Defensa extra contra path traversal
  if (!destino.startsWith(raiz + sep)) throw new Error('Ruta de medio inválida')
  return destino
}

export function urlDeClave(key: string): string {
  // Las claves contienen "/", que rompería el enrutado de un único segmento.
  // Usamos "~" como separador seguro (no está permitido dentro de las claves).
  return `${MEDIA_PREFIX}${key.split('/').map(encodeURIComponent).join('~')}`
}

/**
 * Convierte el parámetro de ruta (`portadas~clip~v1.jpg`) en la clave de
 * almacenamiento (`portadas/clip/v1.jpg`).
 */
export function claveDesdeParametro(parametro: string): string | null {
  if (!parametro) return null
  return parametro
    .split('~')
    .map((s) => decodeURIComponent(s))
    .join('/')
}

export function claveDeUrl(url: string): string | null {
  if (!url) return null
  if (url.startsWith(MEDIA_PREFIX)) {
    return claveDesdeParametro(url.slice(MEDIA_PREFIX.length))
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Almacenamiento                                                      */
/* ------------------------------------------------------------------ */

export async function guardarMedio(
  key: string,
  datos: Buffer | Uint8Array,
  contentType?: string,
): Promise<string> {
  const clave = sanitizarClave(key)
  const buffer = Buffer.isBuffer(datos) ? datos : Buffer.from(datos)

  if (isSupabaseConfigured) {
    const client = crearClienteSupabase(env.supabase.serviceRoleKey || env.supabase.anonKey)
    const { error } = await client.storage
      .from(BUCKET_MEDIOS)
      .upload(clave, buffer, {
        contentType: contentType ?? mimeDeClave(clave),
        upsert: true,
      })
    if (error) throw new Error(`No se pudo subir el medio: ${error.message}`)
  } else {
    const destino = rutaDisco(clave)
    await mkdir(dirname(destino), { recursive: true })
    await writeFile(destino, buffer)
  }
  return urlDeClave(clave)
}

export async function escribirMedio(
  key: string,
  datos: Buffer | Uint8Array,
  contentType?: string,
): Promise<string> {
  return guardarMedio(key, datos, contentType)
}

export interface MedioLeido {
  stream: Readable
  size: number
  contentType: string
}
export async function abrirMedio(
  key: string,
): Promise<MedioLeido | { signedUrl: string }> {
  const clave = sanitizarClave(key)
  const contentType = mimeDeClave(clave)

  if (isSupabaseConfigured) {
    const client = crearClienteSupabase(env.supabase.serviceRoleKey || env.supabase.anonKey)
    const { data, error } = await client.storage
      .from(BUCKET_MEDIOS)
      .createSignedUrl(clave, 60 * 30)
    if (error || !data?.signedUrl) {
      throw new Error(`No se pudo firmar el medio: ${error?.message ?? 'desconocido'}`)
    }
    return { signedUrl: data.signedUrl }
  }

  const info = await stat(rutaDisco(clave))
  return {
    stream: Readable.from(createReadStream(rutaDisco(clave))),
    size: info.size,
    contentType,
  }
}

export async function leerMedioCompleto(key: string): Promise<Buffer> {
  const clave = sanitizarClave(key)
  if (isSupabaseConfigured) {
    const client = crearClienteSupabase(env.supabase.serviceRoleKey || env.supabase.anonKey)
    const { data, error } = await client.storage
      .from(BUCKET_MEDIOS)
      .download(clave)
    if (error) throw new Error(`No se pudo descargar el medio: ${error.message}`)
    const buffer = Buffer.from(await data.arrayBuffer())
    return buffer
  }
  return readFile(rutaDisco(clave))
}

/**
 * Materializa un medio en un archivo local para poder consumirlo con ffmpeg.
 * En modo Supabase se descarga a la caché temporal de trabajo.
 */
export async function materializarMedio(
  key: string,
  destino: string,
): Promise<string> {
  const clave = sanitizarClave(key)
  await mkdir(dirname(destino), { recursive: true })
  if (!isSupabaseConfigured) {
    const origen = rutaDisco(clave)
    await writeFile(destino, await readFile(origen))
    return destino
  }
  const buffer = await leerMedioCompleto(clave)
  await writeFile(destino, buffer)
  return destino
}

export async function eliminarMedio(key: string): Promise<void> {
  const clave = sanitizarClave(key)
  if (isSupabaseConfigured) {
    const client = crearClienteSupabase(env.supabase.serviceRoleKey || env.supabase.anonKey)
    await client.storage.from(BUCKET_MEDIOS).remove([clave])
    return
  }
  await rm(rutaDisco(clave), { force: true })
}
