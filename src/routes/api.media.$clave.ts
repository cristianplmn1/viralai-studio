import { createFileRoute } from '@tanstack/react-router'

/**
 * Sirve los medios (vídeos originales, renders y portadas) con soporte de
 * rangos HTTP para que el reproductor pueda hacer *seek* sin descargar el
 * fichero entero.
 */
export const Route = createFileRoute('/api/media/$clave')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          const { abrirMedio, claveDesdeParametro } = await import('~/server/media')
          const clave = claveDesdeParametro(params.clave)
          if (!clave) {
            return new Response('Medio no encontrado', { status: 404 })
          }
          const medio = await abrirMedio(clave)

          if ('signedUrl' in medio) {
            return Response.redirect(medio.signedUrl, 302)
          }

          const rango = request.headers.get('range')
          const cabeceras = new Headers({
            'Content-Type': medio.contentType,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=31536000, immutable',
          })

          if (rango) {
            const coincidencia = /^bytes=(\d*)-(\d*)$/.exec(rango.trim())
            if (coincidencia) {
              const inicio = coincidencia[1]
                ? Number(coincidencia[1])
                : Math.max(0, medio.size - Number(coincidencia[2] ?? 0))
              const fin = coincidencia[2]
                ? Math.min(medio.size - 1, Number(coincidencia[2]))
                : medio.size - 1

              if (inicio > fin || inicio >= medio.size) {
                return new Response(null, {
                  status: 416,
                  headers: { 'Content-Range': `bytes */${medio.size}` },
                })
              }

              const trozo = await leerRango(medio, inicio, fin)
              cabeceras.set('Content-Length', String(trozo.length))
              cabeceras.set('Content-Range', `bytes ${inicio}-${fin}/${medio.size}`)
              return new Response(new Uint8Array(trozo), {
                status: 206,
                headers: cabeceras,
              })
            }
          }

          cabeceras.set('Content-Length', String(medio.size))
          return new Response(medio.stream as unknown as ReadableStream, {
            status: 200,
            headers: cabeceras,
          })
        } catch (error) {
          const mensaje = error instanceof Error ? error.message : 'No encontrado'
          return new Response(mensaje, {
            status: 404,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        }
      },
    },
  },
})

async function leerRango(
  medio: { stream: NodeJS.ReadableStream & { destroy?: () => void }; size: number },
  inicio: number,
  fin: number,
): Promise<Buffer> {
  const trozos: Buffer[] = []
  let posicion = 0
  let restante = fin - inicio + 1

  await new Promise<void>((resolve, reject) => {
    medio.stream.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const inicioChunk = posicion
      const finChunk = posicion + buffer.length - 1
      posicion += buffer.length

      if (finChunk >= inicio) {
        const desde = Math.max(0, inicio - inicioChunk)
        const hasta = Math.min(buffer.length - 1, fin - inicioChunk)
        if (hasta >= desde) {
          trozos.push(buffer.subarray(desde, hasta + 1))
          restante -= hasta - desde + 1
        }
      }
      if (restante <= 0) {
        medio.stream.destroy?.()
      }
    })
    medio.stream.on('end', resolve)
    medio.stream.on('error', reject)
    medio.stream.on('close', resolve)
  })

  return Buffer.concat(trozos)
}
