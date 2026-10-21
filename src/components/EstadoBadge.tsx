import { ESTADOS_PROYECTO, ESTADOS_PUBLICACION } from '~/server/db/types'
import type { EstadoProyecto, EstadoPublicacion } from '~/server/db/types'

export function EstadoBadge({ estado }: { estado: EstadoProyecto }) {
  const config = ESTADOS_PROYECTO[estado] ?? ESTADOS_PROYECTO.procesando
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${config.clase}`}
    >
      {estado === 'procesando' && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-70" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
        </span>
      )}
      {estado === 'listo' && (
        <svg
          viewBox="0 0 24 24"
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
      {estado === 'publicado' && (
        <svg
          viewBox="0 0 24 24"
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      )}
      {config.etiqueta}
    </span>
  )
}

export function EstadoPublicacionBadge({
  estado,
}: {
  estado: EstadoPublicacion
}) {
  const config = ESTADOS_PUBLICACION[estado] ?? ESTADOS_PUBLICACION.programada
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${config.clase}`}
    >
      {config.etiqueta}
    </span>
  )
}
