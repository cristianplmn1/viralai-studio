import { createFileRoute, Link, Outlet, redirect, useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { AppShell } from '~/components/AppShell'
import { EstadoBadge } from '~/components/EstadoBadge'
import { BarraProgreso } from '~/components/ScoreGauge'
import { fnSesionActual } from '~/server/api/auth'
import { fnObtenerProyecto } from '~/server/api/proyectos'

export const Route = createFileRoute('/proyectos/$proyectoId')({
  loader: async ({ params }) => {
    const sesion = await fnSesionActual()
    if (!sesion.autenticado) throw redirect({ to: '/login' })
    const { proyecto, clips } = await fnObtenerProyecto({
      data: { proyectoId: params.proyectoId },
    })
    return { proyecto, clips }
  },
  component: LayoutProyecto,
})

function LayoutProyecto() {
  const { proyecto, clips } = Route.useLoaderData()
  const router = useRouter()

  // Mientras el proyecto se procesa, refrescamos los datos periódicamente.
  useEffect(() => {
    if (proyecto.estado !== 'procesando') return
    const temporizador = setInterval(() => {
      void router.invalidate()
    }, 2500)
    return () => clearInterval(temporizador)
  }, [proyecto.estado, router])

  const minutos = Math.floor(proyecto.duracion_seg / 60)
  const segundos = Math.round(proyecto.duracion_seg % 60)

  return (
    <AppShell>
      <div className="animate-[fade-up_0.35s_ease-out]">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="truncate font-display text-2xl font-bold tracking-tight text-white">
                {proyecto.titulo}
              </h1>
              <EstadoBadge estado={proyecto.estado} />
            </div>
            <p className="mt-1.5 text-[12.5px] text-mist-500">
              {proyecto.duracion_seg > 0 && (
                <span className="num">
                  {minutos}:{String(segundos).padStart(2, '0')}
                </span>
              )}
              {proyecto.duracion_seg > 0 && <span className="mx-2">·</span>}
              <span>{clips.length} clips</span>
              <span className="mx-2">·</span>
              <span>
                {new Date(proyecto.fecha_creacion).toLocaleDateString('es-ES', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            </p>
          </div>
        </header>

        {proyecto.estado === 'procesando' && (
          <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3.5">
            <BarraProgreso valor={proyecto.progreso} etapa={proyecto.etapa} />
            <p className="mt-2 text-[11.5px] leading-snug text-amber-200/80">
              El análisis y el render se ejecutan en segundo plano. Puedes
              navegar mientras termina.
            </p>
            {proyecto.mensaje_error && (
              <p className="mt-1.5 text-[11.5px] text-rose-300">
                {proyecto.mensaje_error}
              </p>
            )}
          </div>
        )}

        {clips.length > 0 && (
          <nav className="mt-5 flex gap-2 overflow-x-auto pb-1">
            {clips.map((clip, indice) => (
              <TarjetaClipNav
                key={clip.id}
                proyectoId={proyecto.id}
                clip={clip}
                indice={indice}
              />
            ))}
          </nav>
        )}

        <div className="mt-5">
          <Outlet />
        </div>
      </div>
    </AppShell>
  )
}

function TarjetaClipNav({
  proyectoId,
  clip,
  indice,
}: {
  proyectoId: string
  clip: {
    id: string
    formato: '9:16' | '16:9'
    inicio_seg: number
    fin_seg: number
    puntuacion_viral: number
  }
  indice: number
}) {
  const duracion = Math.round(clip.fin_seg - clip.inicio_seg)
  return (
    <Link
      to="/proyectos/$proyectoId/editor/$clipId"
      params={{ proyectoId, clipId: clip.id }}
      activeProps={{
        className:
          'border-brand-500/50 bg-brand-500/[0.1] shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-brand-500)_25%,transparent)]',
      }}
      inactiveProps={{
        className:
          'border-ink-700 bg-ink-850/50 hover:border-ink-600 hover:bg-ink-800/70',
      }}
      className="group flex min-w-[190px] shrink-0 items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors"
    >
      <span className="num grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-800 text-[12px] font-bold text-mist-300 group-hover:bg-brand-500/20 group-hover:text-brand-200">
        {indice + 1}
      </span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-semibold text-mist-100">
          Clip {indice + 1}
        </span>
        <span className="num block text-[10.5px] text-mist-500">
          {clip.formato} · {duracion}s · viral {clip.puntuacion_viral}
        </span>
      </span>
    </Link>
  )
}
