import { createFileRoute } from '@tanstack/react-router'

/**
 * Callback de OAuth de Google / YouTube. Intercambia el código por tokens,
 * los cifra y los guarda associated al usuario de la sesión.
 */
export const Route = createFileRoute('/api/oauth/youtube/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const codigo = url.searchParams.get('code')
        const estado = url.searchParams.get('state')
        const error = url.searchParams.get('error')

        if (error) {
          return redirectA('/login?error=youtube_denegado')
        }
        if (!codigo || !estado) {
          return redirectA('/login?error=youtube_respuesta_invalida')
        }

        try {
          const { verifyPayload } = await import('~/server/crypto')
          const { sesionVigente, repoDeSesion } = await import('~/server/auth')
          const { intercambiarCodigoYouTube } = await import('~/server/publishing/youtube')
          const { guardarTokenYouTube } = await import('~/server/publishing')

          // El estado viaja firmado: `payload.signatura`
          const [carga, firma] = estado.split('.')
          if (!carga || !firma || !verifyPayload(carga, firma)) {
            return redirectA('/login?error=estado_invalido')
          }

          const datos = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8')) as {
            uid: string
            plataforma: string
            nonce: string
          }
          if (datos.plataforma !== 'youtube') {
            return redirectA('/login?error=plataforma_incorrecta')
          }

          const sesion = await sesionVigente()
          if (!sesion || sesion.uid !== datos.uid) {
            return redirectA('/login?error=sesion_no_valida')
          }

          const tokens = await intercambiarCodigoYouTube(codigo)
          const repo = await repoDeSesion(sesion)
          await guardarTokenYouTube(repo, sesion.uid, tokens)

          return redirectA('/dashboard?conectado=youtube')
        } catch (fallo) {
          const mensaje =
            fallo instanceof Error ? fallo.message : 'Error desconocido'
          return redirectA(
            `/login?error=youtube_error&detalle=${encodeURIComponent(mensaje.slice(0, 160))}`,
          )
        }
      },
    },
  },
})

function redirectA(destino: string): Response {
  return new Response(null, { status: 302, headers: { Location: destino } })
}
