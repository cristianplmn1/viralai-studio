import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { validar } from './validar'

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
