import { createFileRoute } from '@tanstack/react-router'

/** Callback de OAuth de TikTok (Content Posting API). */
export const Route = createFileRoute('/api/oauth/tiktok/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const codigo = url.searchParams.get('code')
        const estado = url.searchParams.get('state')
        const error = url.searchParams.get('error')

        if (error) {
          return redirectA('/login?error=tiktok_denegado')
        }
        if (!codigo || !estado) {
          return redirectA('/login?error=tiktok_respuesta_invalida')
        }

        try {
          const { verifyPayload } = await import('~/server/crypto')
          const { sesionVigente, repoDeSesion } = await import('~/server/auth')
          const { intercambiarCodigoTikTok } = await import('~/server/publishing/tiktok')
          const { guardarTokenTikTok } = await import('~/server/publishing')

          const [carga, firma] = estado.split('.')
          if (!carga || !firma || !verifyPayload(carga, firma)) {
            return redirectA('/login?error=estado_invalido')
          }

          const datos = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8')) as {
            uid: string
            plataforma: string
          }
          if (datos.plataforma !== 'tiktok') {
            return redirectA('/login?error=plataforma_incorrecta')
          }

          const sesion = await sesionVigente()
          if (!sesion || sesion.uid !== datos.uid) {
            return redirectA('/login?error=sesion_no_valida')
          }

          const tokens = await intercambiarCodigoTikTok(codigo)
          const repo = await repoDeSesion(sesion)
          await guardarTokenTikTok(repo, sesion.uid, tokens)

          return redirectA('/dashboard?conectado=tiktok')
        } catch (fallo) {
          const mensaje =
            fallo instanceof Error ? fallo.message : 'Error desconocido'
          return redirectA(
            `/login?error=tiktok_error&detalle=${encodeURIComponent(mensaje.slice(0, 160))}`,
          )
        }
      },
    },
  },
})

function redirectA(destino: string): Response {
  return new Response(null, { status: 302, headers: { Location: destino } })
}
