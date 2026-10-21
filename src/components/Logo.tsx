import { Link } from '@tanstack/react-router'

export function Logo({ compacto = false }: { compacto?: boolean }) {
  return (
    <Link to="/dashboard" className="group inline-flex items-center gap-3">
      <span className="brand-ring relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 via-magenta-500 to-pink-500">
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5 text-white"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M13 2 4.5 13H11l-1 9 8.5-11H12l1-9Z" />
        </svg>
      </span>
      {!compacto && (
        <span className="flex flex-col leading-none">
          <span className="font-display text-[15px] font-bold tracking-tight text-white">
            ViralAI <span className="brand-text">Studio</span>
          </span>
          <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-mist-500">
            Content Engine
          </span>
        </span>
      )}
    </Link>
  )
}
