import { useMemo } from 'react'

export interface Segmento {
  inicio: number
  fin: number
  etiqueta?: string
  activo?: boolean
  url?: string
}

/**
 * Línea de tiempo del vídeo original con los cortes detectados.
 * Cada bloque representa un momento destacado; el activo se resalta.
 */
export function LineaTiempo({
  duracion,
  segmentos,
  onSeleccion,
}: {
  duracion: number
  segmentos: Segmento[]
  onSeleccion?: (indice: number) => void
}) {
  const marcas = useMemo(() => {
    if (duracion <= 0) return []
    const total = Math.min(12, Math.max(4, Math.round(duracion / 60)))
    return Array.from({ length: total + 1 }, (_, i) => (duracion / total) * i)
  }, [duracion])

  if (duracion <= 0) {
    return (
      <div className="rounded-lg border border-ink-700 bg-ink-900/60 px-4 py-6 text-center text-[12px] text-mist-500">
        La línea de tiempo aparecerá cuando termine el análisis del vídeo.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-3.5">
      <div className="relative h-16 w-full overflow-hidden rounded-lg bg-ink-950">
        {/* Degradado de fondo simulando la pista de audio */}
        <div
          className="absolute inset-0 opacity-70"
          style={{
            background:
              'repeating-linear-gradient(90deg, rgba(139,92,246,0.16) 0px, rgba(139,92,246,0.16) 2px, transparent 2px, transparent 5px)',
          }}
        />

        {segmentos.map((segmento, indice) => {
          const izquierda = (segmento.inicio / duracion) * 100
          const ancho = ((segmento.fin - segmento.inicio) / duracion) * 100
          return (
            <button
              key={`${segmento.inicio}-${indice}`}
              type="button"
              onClick={() => onSeleccion?.(indice)}
              title={`${segmento.etiqueta ?? `Momento ${indice + 1}`} · ${Math.round(segmento.inicio)}s – ${Math.round(segmento.fin)}s`}
              className={`absolute inset-y-0 rounded-md border transition-all ${
                segmento.activo
                  ? 'border-brand-300/70 bg-gradient-to-b from-brand-500/70 to-magenta-500/60 shadow-[0_0_18px_-2px_var(--color-magenta-500)]'
                  : 'border-brand-500/35 bg-brand-500/25 hover:border-brand-400/60 hover:bg-brand-500/40'
              }`}
              style={{ left: `${izquierda}%`, width: `${Math.max(1.2, ancho)}%` }}
            >
              <span className="absolute inset-x-1 bottom-1 truncate text-[9px] font-bold uppercase tracking-wider text-white/80">
                {segmento.etiqueta ?? `Corte ${indice + 1}`}
              </span>
            </button>
          )
        })}

        {/* Marcadores de tiempo */}
        {marcas.map((marca) => (
          <span
            key={marca}
            className="num absolute bottom-0 -translate-x-1/2 text-[9px] font-medium text-mist-500"
            style={{ left: `${(marca / duracion) * 100}%` }}
          >
            {Math.round(marca)}s
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * Selector de inicio y fin del clip con dos rangos superpuestos.
 */
export function RangoClip({
  duracion,
  inicio,
  fin,
  onCambio,
}: {
  duracion: number
  inicio: number
  fin: number
  onCambio: (inicio: number, fin: number) => void
}) {
  const minimo = Math.min(inicio, fin)
  const maximo = Math.max(inicio, fin)

  const porcentajeInicio = (minimo / duracion) * 100
  const porcentajeFin = (maximo / duracion) * 100

  return (
    <div className="space-y-3">
      <div className="relative h-9">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-ink-700" />
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-brand-500 to-magenta-500"
          style={{
            left: `${porcentajeInicio}%`,
            width: `${Math.max(0, porcentajeFin - porcentajeInicio)}%`,
          }}
        />
        <input
          type="range"
          min={0}
          max={duracion}
          step={0.1}
          value={minimo}
          aria-label="Inicio del clip"
          onChange={(e) => {
            const valor = Math.min(Number(e.target.value), maximo - 0.5)
            onCambio(Math.max(0, valor), maximo)
          }}
          className="pointer-events-none absolute inset-0 h-full w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-brand-500 [&::-webkit-slider-thumb]:shadow-lg [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-brand-500"
        />
        <input
          type="range"
          min={0}
          max={duracion}
          step={0.1}
          value={maximo}
          aria-label="Fin del clip"
          onChange={(e) => {
            const valor = Math.max(Number(e.target.value), minimo + 0.5)
            onCambio(minimo, Math.min(duracion, valor))
          }}
          className="pointer-events-none absolute inset-0 h-full w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-magenta-500 [&::-webkit-slider-thumb]:shadow-lg [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-magenta-500"
        />
      </div>
      <div className="flex items-center justify-between text-[11.5px]">
        <span className="num text-mist-400">
          Inicio <span className="font-semibold text-mist-100">{minimo.toFixed(1)}s</span>
        </span>
        <span className="num text-mist-400">
          Duración{' '}
          <span className="font-semibold text-mist-100">
            {(maximo - minimo).toFixed(1)}s
          </span>
        </span>
        <span className="num text-mist-400">
          Fin <span className="font-semibold text-mist-100">{maximo.toFixed(1)}s</span>
        </span>
      </div>
    </div>
  )
}
