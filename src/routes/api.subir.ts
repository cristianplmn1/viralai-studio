import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/subir')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const url = new URL(request.url)
          const titulo = url.searchParams.get('titulo')?.trim() || 'Vídeo sin título'
          const formatosParam = url.searchParams.get('formatos') ?? '9:16'
          const formatos = formatosParam
            .split(',')
            .map((f) => f.trim())
            .filter((f): f is '9:16' | '16:9' => f === '9:16' || f === '16:9')

          const maxClips = clamp(Number(url.searchParams.get('max_clips') ?? 3), 1, 5)
          const duracionClip = clamp(
            Number(url.searchParams.get('duracion') ?? 34),
            10,
            120,
          )
          const nombreArchivo = url.searchParams.get('nombre') ?? 'video.mp4'
          const subtitulos = url.searchParams.get('subtitulos') !== '0'
          const silencios = url.searchParams.get('silencios') !== '0'
          const musica = url.searchParams.get('musica') === '1'

          if (!request.body) {
            return json({ error: 'No se recibió el fichero de vídeo.' }, 400)
          }

          const { registrarSubida } = await import('~/server/api/proyectos')
          const resultado = await registrarSubida({
            titulo,
            formatos: formatos.length ? formatos : ['9:16'],
            maxClips,
            duracionClip,
            subtitulos,
            eliminarSilencios: silencios,
            musica,
            nombreArchivo,
            cuerpo: request.body,
            contentType: request.headers.get('content-type') ?? 'video/mp4',
          })

          return json(resultado, 202)
        } catch (error) {
          const mensaje =
            error instanceof Error ? error.message : 'Error inesperado al subir.'
          return json({ error: mensaje }, 500)
        }
      },
    },
  },
})

function clamp(valor: number, min: number, max: number): number {
  if (!Number.isFinite(valor)) return min
  return Math.min(max, Math.max(min, Math.round(valor)))
}

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
