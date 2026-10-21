import { stat } from 'node:fs/promises'
import { env } from '../env'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos'

export interface TokensOAuth {
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
  scope: string
}

export function urlAutorizacionYouTube(state: string): string {
  const params = new URLSearchParams({
    client_id: env.youtube.clientId,
    redirect_uri: `${env.appUrl}/api/oauth/youtube/callback`,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: env.youtube.scopes,
    state,
    include_granted_scopes: 'true',
  })
  return `${AUTH_URL}?${params.toString()}`
}

export async function intercambiarCodigoYouTube(
  code: string,
): Promise<TokensOAuth> {
  const respuesta = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.youtube.clientId,
      client_secret: env.youtube.clientSecret,
      redirect_uri: `${env.appUrl}/api/oauth/youtube/callback`,
      grant_type: 'authorization_code',
    }),
  })
  const cuerpo = (await respuesta.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
    error_description?: string
  }
  if (!respuesta.ok || !cuerpo.access_token) {
    throw new Error(
      cuerpo.error_description ?? 'No se pudo completar la conexión con YouTube.',
    )
  }
  return {
    accessToken: cuerpo.access_token,
    refreshToken: cuerpo.refresh_token ?? null,
    expiresAt: cuerpo.expires_in ? Date.now() + cuerpo.expires_in * 1000 : null,
    scope: cuerpo.scope ?? env.youtube.scopes,
  }
}

export async function refrescarTokenYouTube(
  refreshToken: string,
): Promise<TokensOAuth> {
  const respuesta = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.youtube.clientId,
      client_secret: env.youtube.clientSecret,
      grant_type: 'refresh_token',
    }),
  })
  const cuerpo = (await respuesta.json()) as {
    access_token?: string
    expires_in?: number
    scope?: string
    error_description?: string
  }
  if (!respuesta.ok || !cuerpo.access_token) {
    throw new Error(
      cuerpo.error_description ?? 'No se pudo renovar el token de YouTube.',
    )
  }
  return {
    accessToken: cuerpo.access_token,
    refreshToken,
    expiresAt: cuerpo.expires_in ? Date.now() + cuerpo.expires_in * 1000 : null,
    scope: cuerpo.scope ?? env.youtube.scopes,
  }
}

export async function obtenerCanalYouTube(
  accessToken: string,
): Promise<{ id: string; titulo: string }> {
  const respuesta = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  const cuerpo = (await respuesta.json()) as {
    items?: { id: string; snippet?: { title?: string } }[]
    error?: { message?: string }
  }
  if (!respuesta.ok) {
    throw new Error(cuerpo.error?.message ?? 'No se pudo leer el canal de YouTube.')
  }
  const canal = cuerpo.items?.[0]
  return {
    id: canal?.id ?? '',
    titulo: canal?.snippet?.title ?? 'Canal de YouTube',
  }
}

export interface SubidaYouTube {
  archivo: string
  titulo: string
  descripcion: string
  etiquetas: string[]
  privacidad: 'public' | 'private' | 'unlisted'
  /** Fecha ISO para publicación programada */
  publicarEn?: string | null
  esShort: boolean
}

export interface ResultadoPublicacion {
  idExterno: string
  url: string
  programado: boolean
}

/**
 * Sube un vídeo a YouTube con el endpoint de subida reanudable.
 * Si se indica `publicarEn` en el futuro, YouTube lo programa automáticamente.
 */
export async function subirAYouTube(
  accessToken: string,
  datos: SubidaYouTube,
): Promise<ResultadoPublicacion> {
  const info = await stat(datos.archivo)
  const descripcion = datos.esShort
    ? `${datos.descripcion}\n\n#Shorts`.trim()
    : datos.descripcion

  const metadatos = {
    snippet: {
      title: datos.titulo.slice(0, 100),
      description: descripcion.slice(0, 5000),
      tags: datos.etiquetas.slice(0, 30),
      categoryId: '22',
    },
    status: {
      privacyStatus: datos.privacidad,
      selfDeclaredMadeForKids: false,
      ...(datos.publicarEn ? { publishAt: datos.publicarEn } : {}),
    },
  }

  const iniciar = await fetch(`${UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4',
      'X-Upload-Content-Length': String(info.size),
    },
    body: JSON.stringify(metadatos),
  })

  if (!iniciar.ok) {
    const cuerpo = await iniciar.text()
    throw new Error(`YouTube rechazó la subida: ${cuerpo.slice(0, 400)}`)
  }

  const urlSesion = iniciar.headers.get('location')
  if (!urlSesion) throw new Error('YouTube no devolvió una sesión de subida.')

  const { readFile } = await import('node:fs/promises')
  const contenido = await readFile(datos.archivo)

  const subir = await fetch(urlSesion, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(info.size),
    },
    body: new Uint8Array(contenido),
  })

  if (!subir.ok) {
    const cuerpo = await subir.text()
    throw new Error(`Falló la subida del vídeo a YouTube: ${cuerpo.slice(0, 400)}`)
  }

  const resultado = (await subir.json()) as {
    id?: string
    snippet?: { title?: string }
    status?: { privacyStatus?: string }
  }

  const id = resultado.id ?? ''
  return {
    idExterno: id,
    url: `https://www.youtube.com/watch?v=${id}`,
    programado: Boolean(datos.publicarEn),
  }
}
