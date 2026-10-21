import { Link } from '@tanstack/react-router'

const SECCIONES = [
  {
    slug: 'editor',
    label: 'Editor',
    to: '/proyectos/$proyectoId/editor/$clipId' as const,
    icono: 'M4 6h16M4 12h16M4 18h10',
  },
  {
    slug: 'portadas',
    label: 'Portadas',
    to: '/proyectos/$proyectoId/portadas/$clipId' as const,
    icono: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6',
  },
  {
    slug: 'viral',
    label: 'Viral',
    to: '/proyectos/$proyectoId/viral/$clipId' as const,
    icono: 'M13 2 4.5 13H11l-1 9 8.5-11H12l1-9Z',
  },
  {
    slug: 'publicar',
    label: 'Publicar',
    to: '/proyectos/$proyectoId/publicar/$clipId' as const,
    icono: 'M12 19V5M5 12l7-7 7 7',
  },
] as const

export function ClipTabs({
  proyectoId,
  clipId,
  activo,
}: {
  proyectoId: string
  clipId: string
  activo: (typeof SECCIONES)[number]['slug']
}) {
  return (
    <nav className="flex gap-1 overflow-x-auto rounded-xl border border-ink-700 bg-ink-900/60 p-1">
      {SECCIONES.map((seccion) => {
        const esActivo = seccion.slug === activo
        return (
          <Link
            key={seccion.slug}
            to={seccion.to}
            params={{ proyectoId, clipId }}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-[12.5px] font-semibold transition-colors ${
              esActivo
                ? 'bg-gradient-to-r from-brand-600 to-magenta-600 text-white shadow-lg'
                : 'text-mist-400 hover:bg-ink-800 hover:text-mist-100'
            }`}
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
              <path d={seccion.icono} />
            </svg>
            {seccion.label}
          </Link>
        )
      })}
    </nav>
  )
}
