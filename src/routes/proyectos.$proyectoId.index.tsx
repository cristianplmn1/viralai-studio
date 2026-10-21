import { createFileRoute, redirect } from '@tanstack/react-router'
import { Link } from '@tanstack/react-router'
import { fnSesionActual } from '~/server/api/auth'
import { fnObtenerProyecto } from '~/server/api/proyectos'
import { Panel, Spinner } from '~/components/UI'
import { AvisoLegal } from '~/components/UI'

export const Route = createFileRoute('/proyectos/$proyectoId/')({
  loader: async ({ params }) => {
    const sesion = await fnSesionActual()
    if (!sesion.autenticado) throw redirect({ to: '/login' })
    const { proyecto, clips, proceso } = await fnObtenerProyecto({
      data: { proyectoId: params.proyectoId },
    })
    return { proyecto, clips, proceso }
  },
  component: VistaProyecto,
})

function VistaProyecto() {
  const { proyecto, clips, proceso } = Route.useLoaderData()
  const procesando = proyecto.estado === 'procesando'

  // Mientras no haya ningún clip todavía, sólo mostramos el estado.
  if (procesando && clips.length === 0) {
    return (
      <Panel>
        <div className="flex flex-col items-center gap-3 py-14 text-center">
          <Spinner className="h-7 w-7 text-brand-400" />
          <p className="font-display text-lg font-semibold text-white">
            Analizando tu vídeo
          </p>
          <p className="max-w-md text-sm text-mist-400">
            Detectamos los momentos destacados, quitamos los silencios y
            renderizamos los clips. En cuanto el primero esté listo lo verás
            aquí mismo.
          </p>
          {proceso?.etaSegundos ? (
            <p className="num text-[12.5px] text-amber-200/90">
              Tiempo restante estimado: {proceso.etaSegundos} s
            </p>
          ) : null}
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

  const pendientes = procesando
    ? Math.max(0, (proceso?.clipsTotales ?? clips.length) - clips.length)
    : 0

  return (
    <div className="space-y-4">
      {procesando && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-500/25 bg-brand-500/[0.07] px-4 py-3">
          <Spinner className="h-4 w-4 text-brand-300" />
          <p className="text-[12.5px] font-semibold text-brand-100">
            {proceso?.etapa ?? 'Generando clips…'}
          </p>
          <span className="num text-[11.5px] text-brand-200/80">
            {clips.length} listo{clips.length === 1 ? '' : 's'}
            {pendientes > 0 && ` · ${pendientes} en cola`}
          </span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {clips.map((clip, indice) => (
          <article
            key={clip.id}
            className="surface-raised group relative overflow-hidden transition-all hover:-translate-y-0.5 hover:border-brand-500/40"
          >
            <Link
              to="/proyectos/$proyectoId/editor/$clipId"
              params={{ proyectoId: proyecto.id, clipId: clip.id }}
              className="block"
            >
              <div
                className="relative flex items-center justify-center overflow-hidden bg-ink-950"
                style={{ aspectRatio: '16 / 9' }}
              >
                <video
                  src={clip.url_render}
                  preload="metadata"
                  muted
                  playsInline
                  controls
                  onClick={(e) => e.preventDefault()}
                  className="h-full w-full object-contain opacity-90 transition-opacity group-hover:opacity-100"
                />
                <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-md bg-ink-950/85 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur">
                  Clip {indice + 1}
                </span>
                <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-md bg-ink-950/85 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-300 backdrop-blur">
                  {clip.formato}
                </span>
                <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-950/90 to-transparent px-3 pb-2 pt-6 text-[10.5px] font-medium text-mist-300">
                  Toca el vídeo para previsualizarlo
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
          </article>
        ))}

        {/* Marcadores de los clips que aún se están renderizando */}
        {pendientes > 0 &&
          Array.from({ length: pendientes }).map((_, i) => (
            <div
              key={`pendiente-${i}`}
              className="surface-raised flex flex-col justify-center gap-3 p-5"
              style={{ minHeight: 260 }}
            >
              <div className="skeleton h-3 w-24 rounded" />
              <div className="skeleton h-2 w-36 rounded" />
              <div className="skeleton h-2 w-28 rounded" />
              <p className="mt-1 flex items-center gap-2 text-[11.5px] text-mist-500">
                <Spinner className="h-3 w-3 text-brand-400" />
                Renderizando…
              </p>
            </div>
          ))}
      </div>

      <AvisoLegal />
    </div>
  )
}
