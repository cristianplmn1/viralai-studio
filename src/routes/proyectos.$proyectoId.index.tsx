import { createFileRoute, redirect } from '@tanstack/react-router'
import { Link } from '@tanstack/react-router'
import { fnSesionActual } from '~/server/api/auth'
import { fnObtenerProyecto } from '~/server/api/proyectos'
import { Panel, Spinner } from '~/components/UI'

export const Route = createFileRoute('/proyectos/$proyectoId/')({
  loader: async ({ params }) => {
    const sesion = await fnSesionActual()
    if (!sesion.autenticado) throw redirect({ to: '/login' })
    const { proyecto, clips } = await fnObtenerProyecto({
      data: { proyectoId: params.proyectoId },
    })
    return { proyecto, clips }
  },
  component: VistaProyecto,
})

function VistaProyecto() {
  const { proyecto, clips } = Route.useLoaderData()

  if (proyecto.estado === 'procesando') {
    return (
      <Panel>
        <div className="flex flex-col items-center gap-3 py-14 text-center">
          <Spinner className="h-7 w-7 text-brand-400" />
          <p className="font-display text-lg font-semibold text-white">
            Analizando tu vídeo
          </p>
          <p className="max-w-md text-sm text-mist-400">
            Estamos detectando los momentos destacados, quitando silencios y
            renderizando los clips. La página se actualiza sola.
          </p>
        </div>
      </Panel>
    )
  }

  if (!clips.length) {
    return (
      <Panel>
        <div className="flex flex-col items-center gap-3 py-14 text-center">
          <p className="font-display text-lg font-semibold text-white">
            No se han generado clips
          </p>
          <p className="max-w-md text-sm text-mist-400">
            Revisa el estado del proyecto o vuelve a subir el vídeo para
            intentarlo de nuevo.
          </p>
        </div>
      </Panel>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {clips.map((clip, indice) => (
          <Link
            key={clip.id}
            to="/proyectos/$proyectoId/editor/$clipId"
            params={{ proyectoId: proyecto.id, clipId: clip.id }}
            className="surface-raised group block overflow-hidden transition-all hover:-translate-y-0.5 hover:border-brand-500/40"
          >
            <div
              className="relative flex items-center justify-center overflow-hidden bg-ink-950"
              style={{ aspectRatio: '16 / 9' }}
            >
              <video
                src={clip.url_render}
                preload="none"
                muted
                playsInline
                className="h-full w-full object-contain opacity-80 transition-opacity group-hover:opacity-100"
              />
              <span className="absolute left-2.5 top-2.5 rounded-md bg-ink-950/85 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur">
                Clip {indice + 1}
              </span>
              <span className="absolute right-2.5 top-2.5 rounded-md bg-ink-950/85 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-300 backdrop-blur">
                {clip.formato}
              </span>
            </div>
            <div className="p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold text-mist-100">
                  {clip.titulo}
                </p>
                <span className="num rounded bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-bold text-brand-300">
                  {clip.puntuacion_viral}
                </span>
              </div>
              <p className="num mt-1.5 text-[11px] text-mist-500">
                {clip.inicio_seg.toFixed(1)}s – {clip.fin_seg.toFixed(1)}s ·{' '}
                {Math.round(clip.fin_seg - clip.inicio_seg)}s de duración
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {clip.subtitulos && (
                  <span className="chip border-ink-600/70 bg-ink-800/60 text-[10px]">
                    Subtítulos
                  </span>
                )}
                {clip.eliminar_silencios && (
                  <span className="chip border-ink-600/70 bg-ink-800/60 text-[10px]">
                    Sin silencios
                  </span>
                )}
                {clip.musica && (
                  <span className="chip border-ink-600/70 bg-ink-800/60 text-[10px]">
                    Música
                  </span>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
