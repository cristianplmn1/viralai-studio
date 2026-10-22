import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { validar } from './validar'

/**
 * Lee los metadatos de un enlace (título, duración) sin descargarlo, para
 * mostrar al usuario qué va a importar y cuánto tardará.
 */
export const fnInspeccionarEnlace = createServerFn({ method: 'POST' })
  .validator(validar(z.object({ url: z.string().min(4) })))
  .handler(async ({ data }) => {
    const { validarUrlVideo, inspeccionarEnlace, estimarTiempoProceso } =
      await import('../pipeline/descarga')

    const validada = await validarUrlVideo(data.url)
    const info = await inspeccionarEnlace(validada.href)

    return {
      valido: info.valido,
      titulo: info.titulo,
      duracion: info.duracion,
      extractor: info.extractor,
      error: info.valido ? null : info.titulo || 'No se ha podido leer el enlace.',
      estimacionSegundos: info.valido
        ? estimarTiempoProceso(info.duracion, 3)
        : null,
    }
  })

/**
 * Estado de las herramientas externas del servidor.
 *
 * OJO: esto vive en una server function a propósito. Si un `loader` de ruta
 * hiciera `await import('~/server/pipeline/descarga')`, Vite metería ese módulo
 * (y con él `node:child_process`) en el bundle del navegador y la página
 * reventaría en el cliente. Las server functions sí se podan del cliente.
 */
export const fnEstadoHerramientas = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { ytDlpDisponible } = await import('../pipeline/descarga')
    const { isYouTubeConfigured, isTikTokConfigured } = await import('../env')
    return {
      ytDlp: Boolean(ytDlpDisponible()),
      youtubeConfigurado: isYouTubeConfigured,
      tiktokConfigurado: isTikTokConfigured,
    }
  },
)

export const fnEstadoConexion = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { sesionVigente, repoDeSesion } = await import('../auth')
    const { estadoConexion } = await import('../publishing')
    const { isYouTubeConfigured, isTikTokConfigured } = await import('../env')

    const sesion = await sesionVigente()
    if (!sesion) {
      return {
        youtube: false,
        tiktok: false,
        canal_youtube: null,
        cuenta_tiktok: null,
        youtubeConfigurado: isYouTubeConfigured,
        tiktokConfigurado: isTikTokConfigured,
      }
    }

    const repo = await repoDeSesion(sesion)
    const conexion = await estadoConexion(repo, sesion.uid)

    return {
      ...conexion,
      youtubeConfigurado: isYouTubeConfigured,
      tiktokConfigurado: isTikTokConfigured,
    }
  },
)

/**
 * Inicia el flujo OAuth: devuelve la URL de autorización a la que debe
 * redirigir el navegador. El `state` se valida en el callback.
 */
export const fnIniciarOAuth = createServerFn({ method: 'POST' })
  .validator(validar(z.object({ plataforma: z.enum(['youtube', 'tiktok']) })))
  .handler(async ({ data }) => {
    const { sesionVigente } = await import('../auth')
    const { randomId, signPayload } = await import('../crypto')
    const { isYouTubeConfigured, isTikTokConfigured } = await import('../env')

    // Sin credenciales OAuth la URL llevaría a una página de error de la
    // plataforma: mejor explicarlo aquí mismo.
    if (data.plataforma === 'youtube' && !isYouTubeConfigured) {
      throw new Error(
        'YouTube OAuth no está configurado. Añade YOUTUBE_CLIENT_ID y YOUTUBE_CLIENT_SECRET al fichero .env y reinicia el servidor.',
      )
    }
    if (data.plataforma === 'tiktok' && !isTikTokConfigured) {
      throw new Error(
        'TikTok OAuth no está configurado. Añade TIKTOK_CLIENT_KEY y TIKTOK_CLIENT_SECRET al fichero .env y reinicia el servidor.',
      )
    }

    const sesion = await sesionVigente()
    if (!sesion) throw new Error('Debes iniciar sesión para conectar una cuenta.')

    const state = signPayload(
      JSON.stringify({ uid: sesion.uid, plataforma: data.plataforma, nonce: randomId() }),
    )

    if (data.plataforma === 'youtube') {
      const { urlAutorizacionYouTube } = await import('../publishing/youtube')
      return { url: urlAutorizacionYouTube(state) }
    }
    const { urlAutorizacionTikTok } = await import('../publishing/tiktok')
    return { url: urlAutorizacionTikTok(state) }
  })

export const fnDesconectar = createServerFn({ method: 'POST' })
  .validator(validar(z.object({ plataforma: z.enum(['youtube', 'tiktok']) })))
  .handler(async ({ data }) => {
    const { sesionVigente, repoDeSesion } = await import('../auth')
    const sesion = await sesionVigente()
    if (!sesion) throw new Error('Debes iniciar sesión.')
    const repo = await repoDeSesion(sesion)

    await repo.guardarCredenciales(sesion.uid, {
      ...(data.plataforma === 'youtube'
        ? { token_youtube: null, refresh_youtube: null, canal_youtube: null }
        : { token_tiktok: null, refresh_tiktok: null, cuenta_tiktok: null }),
    })

    const { estadoConexion } = await import('../publishing')
    return estadoConexion(repo, sesion.uid)
  })
