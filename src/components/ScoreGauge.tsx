import { Spinner } from './UI'

export function ScoreGauge({
  puntuacion,
  tamano = 120,
}: {
  puntuacion: number
  tamano?: number
}) {
  const valor = Math.max(0, Math.min(100, Math.round(puntuacion)))
  const radio = tamano / 2 - 12
  const circunferencia = 2 * Math.PI * radio
  const offset = circunferencia * (1 - valor / 100)

  const color =
    valor >= 75
      ? 'url(#gradiente-alto)'
      : valor >= 50
        ? 'url(#gradiente-medio)'
        : 'url(#gradiente-bajo)'

  return (
    <div className="relative shrink-0" style={{ width: tamano, height: tamano }}>
      <svg
        viewBox={`0 0 ${tamano} ${tamano}`}
        className="h-full w-full -rotate-90"
        role="img"
        aria-label={`Puntuación de viralidad ${valor} sobre 100`}
      >
        <defs>
          <linearGradient id="gradiente-alto" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4ade80" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
          <linearGradient id="gradiente-medio" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#d946ef" />
          </linearGradient>
          <linearGradient id="gradiente-bajo" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fb7185" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
        <circle
          cx={tamano / 2}
          cy={tamano / 2}
          r={radio}
          fill="none"
          stroke="currentColor"
          className="text-ink-700"
          strokeWidth={9}
        />
        <circle
          cx={tamano / 2}
          cy={tamano / 2}
          r={radio}
          fill="none"
          stroke={color}
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={circunferencia}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(0.16,1,0.3,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num font-display text-3xl font-bold leading-none text-white">
          {valor}
        </span>
        <span className="mt-1 text-[9px] font-bold uppercase tracking-[0.14em] text-mist-500">
          Viral
        </span>
      </div>
    </div>
  )
}

export function BarraProgreso({
  valor,
  etapa,
}: {
  valor: number
  etapa?: string | null
}) {
  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        {etapa && (
          <span className="truncate text-[11px] font-medium text-mist-400">{etapa}</span>
        )}
        <span className="num shrink-0 text-[11px] font-semibold text-mist-400">
          {Math.round(valor)}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-500 via-magenta-500 to-pink-500 transition-[width] duration-700 ease-out"
          style={{ width: `${Math.max(2, Math.min(100, valor))}%` }}
        />
      </div>
    </div>
  )
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-mist-400">
      <Spinner className="h-6 w-6 text-brand-400" />
      <span className="text-sm">{texto}</span>
    </div>
  )
}
