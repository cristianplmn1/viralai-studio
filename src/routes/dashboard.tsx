import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AppShell } from '~/components/AppShell'
import { EstadoBadge } from '~/components/EstadoBadge'
import { BarraProgreso } from '~/components/ScoreGauge'
import { Panel } from '~/components/UI'
import { fnSesionActual } from '~/server/api/auth'
import {
  fnListarProyectos,
  fnEliminarProyecto,
} from '~/server/api/proyectos'

export const Route = createFileRoute('/dashboard')({
  loader: async () => {
    const sesion = await fnSesionActual()
    if (!sesion.autenticado) throw redirect({ to: '/login' })
    const proyectos = await fnListarProyectos()
    return { proyectos }
  },
  component: PaginaDashboard,
})

function PaginaDashboard() {
  const { proyectos } = Route.useLoaderData()
  const router = useRouter()

  // Mientras haya proyectos procesándose, refrescamos la lista.
  useEffect(() => {
    if (!proyectos.some((p) => p.estado === 'procesando')) return
    const temporizador = setInterval(() => {
      void router.invalidate()
    }, 2500)
    return () => clearInterval(temporizador)
  }, [proyectos, router])

  const enProceso = proyectos.filter((p) => p.estado === 'procesando')
  const totalClips = proyectos.length
  const publicados = proyectos.filter((p) => p.estado === 'publicado').length

  return (
    <AppShell>
      <div className="animate-[fade-up_0.4s_ease-out]">
        {/* Cabecera */}
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-white">
              Proyectos
            </h1>
            <p className="mt-1.5 text-sm text-mist-400">
              Convierte tus vídeos largos en clips listos para publicar.
            </p>
          </div>
          <Link to="/subir" className="btn btn-primary">
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
            Subir vídeo
          </Link>
        </header>

        {/* Métricas */}
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Metrica etiqueta="Proyectos" valor={totalClips} icono="M3 7h18v12H3zM3 11h18" />
          <Metrica
            etiqueta="En procesamiento"
            valor={enProceso.length}
            icono="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
            tono={enProceso.length > 0 ? 'marca' : 'neutro'}
          />
          <Metrica
            etiqueta="Publicados"
            valor={publicados}
            icono="M12 19V5M5 12l7-7 7 7"
            tono={publicados > 0 ? 'exito' : 'neutro'}
          />
        </div>

        {/* Lista */}
        {proyectos.length === 0 ? (
          <Panel className="mt-6">
            <div className="flex flex-col items-center gap-5 py-14 text-center">
              <span className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-brand-500/20 to-magenta-500/20 text-brand-300">
                <svg
                  viewBox="0 0 24 24"
                  className="h-7 w-7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </span>
              <div>
                <p className="font-display text-lg font-semibold text-white">
                  Todavía no hay proyectos
                </p>
                <p className="mx-auto mt-1.5 max-w-sm text-sm text-mist-400">
                  Sube tu primer vídeo largo y la IA detectará los momentos
                  destacados para crear clips verticales al instante.
                </p>
              </div>
              <Link to="/subir" className="btn btn-primary">
                Subir mi primer vídeo
              </Link>
            </div>
          </Panel>
        ) : (
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {proyectos.map((proyecto) => (
              <TarjetaProyecto key={proyecto.id} proyecto={proyecto} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}

function Metrica({
  etiqueta,
  valor,
  icono,
  tono = 'neutro',
}: {
  etiqueta: string
  valor: number
  icono: string
  tono?: 'neutro' | 'marca' | 'exito'
}) {
  const clases = {
    neutro: 'text-mist-100',
    marca: 'text-brand-300',
    exito: 'text-lime-300',
  } as const
  return (
    <div className="surface-raised flex items-center gap-3.5 px-4 py-3.5">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-800/80 text-mist-400">
        <svg
          viewBox="0 0 24 24"
          className="h-[18px] w-[18px]"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={icono} />
        </svg>
      </span>
      <div className="min-w-0">
        <p className="num font-display text-xl font-bold leading-none text-white">
          {valor}
        </p>
        <p className="mt-1 truncate text-[11px] font-medium text-mist-500">{etiqueta}</p>
      </div>
      <span className={`sr-only ${clases[tono]}`}>{tono}</span>
    </div>
  )
}

function TarjetaProyecto({
  proyecto,
}: {
  proyecto: {
    id: string
    titulo: string
    estado: 'procesando' | 'listo' | 'publicado'
    duracion_seg: number
    fecha_creacion: string
    progreso: number
    etapa: string | null
    mensaje_error: string | null
  }
}) {
  const minutos = Math.floor(proyecto.duracion_seg / 60)
  const segundos = Math.round(proyecto.duracion_seg % 60)
  const fecha = new Date(proyecto.fecha_creacion)
  const [borrando, setBorrando] = useState(false)
  const router = useRouter()

  async function eliminar() {
    const confirmado = window.confirm(
      `¿Eliminar "${proyecto.titulo}"? Se borrarán sus clips, portadas y publicaciones.`,
    )
    if (!confirmado) return
    setBorrando(true)
    try {
      await fnEliminarProyecto({ data: { proyectoId: proyecto.id } })
      await router.invalidate()
    } finally {
      setBorrando(false)
    }
  }

  return (
    <div className="surface-raised group relative block overflow-hidden p-5 transition-all hover:-translate-y-0.5 hover:border-ink-500">
      <Link
        to="/proyectos/$proyectoId"
        params={{ proyectoId: proyecto.id }}
        className="block"
        aria-label={`Abrir ${proyecto.titulo}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold text-white transition-colors group-hover:text-brand-200">
              {proyecto.titulo}
            </h3>
            <p className="mt-1 text-[11.5px] text-mist-500">
              {fecha.toLocaleDateString('es-ES', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
              {proyecto.duracion_seg > 0 && (
                <> · {minutos}:{String(segundos).padStart(2, '0')}</>
              )}
            </p>
          </div>
          <EstadoBadge estado={proyecto.estado} />
        </div>

        {proyecto.estado === 'procesando' && (
          <div className="mt-4">
            <BarraProgreso valor={proyecto.progreso} etapa={proyecto.etapa} />
            {proyecto.mensaje_error && (
              <p className="mt-2 text-[11px] text-rose-300">{proyecto.mensaje_error}</p>
            )}
          </div>
        )}

        {proyecto.estado !== 'procesando' && (
          <div className="mt-4 flex items-center gap-4 border-t border-ink-700/60 pt-3.5 text-[11.5px] text-mist-500">
            <span className="inline-flex items-center gap-1.5">
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="4" width="20" height="14" rx="2.5" />
                <path d="m10 9 5 3-5 3V9Z" />
              </svg>
              Abrir clips
            </span>
            <span className="ml-auto inline-flex items-center gap-1 text-brand-300 opacity-0 transition-opacity group-hover:opacity-100">
              Ver proyecto
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </span>
          </div>
        )}
      </Link>

      <button
        type="button"
        onClick={() => void eliminar()}
        disabled={borrando}
        title="Eliminar proyecto"
        className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-lg border border-transparent text-mist-500 opacity-0 transition-all hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-300 focus-visible:opacity-100 group-hover:opacity-100"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
        </svg>
      </button>
    </div>
  )
}
