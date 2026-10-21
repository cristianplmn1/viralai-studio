import type { ReactNode } from 'react'

export function Panel({
  titulo,
  descripcion,
  acciones,
  children,
  className = '',
  cuerpoClassName = 'p-5',
}: {
  titulo?: ReactNode
  descripcion?: ReactNode
  acciones?: ReactNode
  children: ReactNode
  className?: string
  cuerpoClassName?: string
}) {
  return (
    <section className={`surface-raised ${className}`}>
      {(titulo || acciones) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-700/70 px-5 py-4">
          <div className="min-w-0">
            {titulo && (
              <h2 className="text-sm font-bold tracking-tight text-white">{titulo}</h2>
            )}
            {descripcion && (
              <p className="mt-1 text-xs leading-relaxed text-mist-400">
                {descripcion}
              </p>
            )}
          </div>
          {acciones && <div className="flex shrink-0 items-center gap-2">{acciones}</div>}
        </header>
      )}
      <div className={cuerpoClassName}>{children}</div>
    </section>
  )
}

export function Chip({
  children,
  tono = 'neutro',
  className = '',
}: {
  children: ReactNode
  tono?: 'neutro' | 'marca' | 'exito' | 'aviso' | 'error'
  className?: string
}) {
  const tonos = {
    neutro: 'border-ink-600/70 bg-ink-800/60 text-mist-300',
    marca: 'border-brand-500/30 bg-brand-500/10 text-brand-300',
    exito: 'border-lime-400/25 bg-lime-400/10 text-lime-300',
    aviso: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
    error: 'border-rose-500/25 bg-rose-500/10 text-rose-300',
  } as const
  return <span className={`chip ${tonos[tono]} ${className}`}>{children}</span>
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-20"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3.5"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v3.5a4.5 4.5 0 0 0-4.5 4.5H4Z"
      />
    </svg>
  )
}

export function AvisoLegal({ className = '' }: { className?: string }) {
  return (
    <p
      className={`flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.07] px-3 py-2 text-[11px] leading-relaxed text-amber-200/90 ${className}`}
      role="note"
    >
      <svg
        viewBox="0 0 24 24"
        className="mt-0.5 h-3.5 w-3.5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      </svg>
      <span>
        Ninguna IA garantiza que un vídeo se vuelva viral. Las puntuaciones son
        estimaciones orientativas y el éxito depende de la plataforma, el
        algoritmo y tu audiencia.
      </span>
    </p>
  )
}
