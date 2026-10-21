import { stat } from 'node:fs/promises'
import { open } from 'node:fs/promises'
import { env } from '../env'

const AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/'
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/'
const INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/'
const STATUS_URL = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/'

export interface TokensOAuth {
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
  scope: string
}

export function urlAutorizacionTikTok(state: string): string {
  const params = new URLSearchParams({
    client_key: env.tiktok.clientKey,
    redirect_uri: `${env.appUrl}/api/oauth/tiktok/callback`,
    response_type: 'code',
    scope: env.tiktok.scopes,
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

export async function intercambiarCodigoTikTok(code: string): Promise<TokensOAuth> {
  const respuesta = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_key: env.tiktok.clientKey,
      client_secret: env.tiktok.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${env.appUrl}/api/oauth/tiktok/callback`,
    }),
  })
  const cuerpo = (await respuesta.json()) as {
    data?: {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      scope?: string
    }
    error?: string
    error_description?: string
    message?: string
  }
  const datos = cuerpo.data
  if (!respuesta.ok || !datos?.access_token) {
    throw new Error(
      cuerpo.error_description ??
        cuerpo.message ??
        'No se pudo completar la conexión con TikTok.',
    )
  }
  return {
    accessToken: datos.access_token,
    refreshToken: datos.refresh_token ?? null,
    expiresAt: datos.expires_in ? Date.now() + datos.expires_in * 1000 : null,
    scope: datos.scope ?? env.tiktok.scopes,
  }
}

export async function refrescarTokenTikTok(
  refreshToken: string,
): Promise<TokensOAuth> {
  const respuesta = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: env.tiktok.clientKey,
      client_secret: env.tiktok.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const cuerpo = (await respuesta.json()) as {
    data?: {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      scope?: string
    }
    message?: string
  }
  if (!respuesta.ok || !cuerpo.data?.access_token) {
    throw new Error(cuerpo.message ?? 'No se pudo renovar el token de TikTok.')
  }
  return {
    accessToken: cuerpo.data.access_token,
    refreshToken,
    expiresAt: cuerpo.data.expires_in ? Date.now() + cuerpo.data.expires_in * 1000 : null,
    scope: cuerpo.data.scope ?? env.tiktok.scopes,
  }
}

export async function obtenerUsuarioTikTok(
  accessToken: string,
): Promise<{ id: string; nombre: string }> {
  const respuesta = await fetch(
    'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  const cuerpo = (await respuesta.json()) as {
    data?: { user?: { open_id?: string; display_name?: string; username?: string } }
    message?: string
  }
  const usuario = cuerpo.data?.user
  if (!respuesta.ok || !usuario) {
    throw new Error(cuerpo.message ?? 'No se pudo leer la cuenta de TikTok.')
  }
  return {
    id: usuario.open_id ?? '',
    nombre:
      usuario.display_name ?? usuario.username ?? 'Cuenta de TikTok',
  }
}

export interface SubidaTikTok {
  archivo: string
  titulo: string
  descripcion: string
  privacidad?: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWERS'
}

export interface ResultadoPublicacion {
  idExterno: string
  url: string
  programado: boolean
}

const CHUNK_SIZE = 10 * 1024 * 1024

/**
 * Publica un vídeo en TikTok mediante la Content Posting API con subida
 * directa por trozos (FILE_UPLOAD).
 */
export async function subirATikTok(
  accessToken: string,
  datos: SubidaTikTok,
): Promise<ResultadoPublicacion> {
  const info = await stat(datos.archivo)
  const totalChunks = Math.max(1, Math.ceil(info.size / CHUNK_SIZE))

  const inicializar = await fetch(
    `${INIT_URL}?creator_info=${encodeURIComponent(accessToken)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        post_info: {
          title: datos.titulo.slice(0, 150),
          description: datos.descripcion.slice(0, 2200),
          privacy_level: datos.privacidad ?? 'PUBLIC_TO_EVERYONE',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: info.size,
          chunk_size: CHUNK_SIZE,
          total_chunk_count: totalChunks,
        },
      }),
    },
  )

  const cuerpo = (await inicializar.json()) as {
    data?: { publish_id?: string; upload_url?: string }
    error?: string
    message?: string
  }

  if (!inicializar.ok || !cuerpo.data?.publish_id || !cuerpo.data.upload_url) {
    throw new Error(
      cuerpo.message ?? cuerpo.error ?? 'TikTok rechazó la publicación.',
    )
  }

  const { publish_id, upload_url } = cuerpo.data
  const archivo = await open(datos.archivo, 'r')
  const buffer = Buffer.alloc(CHUNK_SIZE)

  try {
    for (let numero = 0; numero < totalChunks; numero++) {
      const { bytesRead } = await archivo.read(buffer, 0, CHUNK_SIZE, numero * CHUNK_SIZE)
      const trozo = buffer.subarray(0, bytesRead)
      const inicio = numero * CHUNK_SIZE
      const fin = inicio + bytesRead - 1

      const respuesta = await fetch(
        `${upload_url}?chunk_number=${numero}&total_chunk_count=${totalChunks}&chunk_size=${bytesRead}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Range': `bytes ${inicio}-${fin}/${info.size}`,
          },
          body: new Uint8Array(trozo),
        },
      )
      if (!respuesta.ok) {
        const detalle = await respuesta.text()
        throw new Error(`Falló la subida a TikTok: ${detalle.slice(0, 300)}`)
      }
    }
  } finally {
    await archivo.close()
  }

  return {
    idExterno: publish_id,
    url: `https://www.tiktok.com/@me/video/${publish_id}`,
    programado: false,
  }
}

export async function estadoPublicacionTikTok(
  accessToken: string,
  publishId: string,
): Promise<{ estado: string; url: string | null }> {
  const respuesta = await fetch(
    `${STATUS_URL}?publish_id=${encodeURIComponent(publishId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  const cuerpo = (await respuesta.json()) as {
    data?: { status?: string; fail_reason?: string; post_id?: string }
    message?: string
  }
  return {
    estado: cuerpo.data?.status ?? 'UNKNOWN',
    url: cuerpo.data?.post_id
      ? `https://www.tiktok.com/@me/video/${cuerpo.data.post_id}`
      : null,
  }
}
