import { useId, useState } from 'react'

export function Toggle({
  etiqueta,
  descripcion,
  valorInicial = false,
  disabled = false,
  onCambio,
  icono,
}: {
  etiqueta: string
  descripcion?: string
  valorInicial?: boolean
  disabled?: boolean
  onCambio?: (valor: boolean) => void
  icono?: React.ReactNode
}) {
  const id = useId()
  const [activo, setActivo] = useState(valorInicial)

  return (
    <label
      htmlFor={id}
      className={`group flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors ${
        activo
          ? 'border-brand-500/40 bg-brand-500/[0.08]'
          : 'border-ink-700 bg-ink-850/50 hover:border-ink-600'
      } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      {icono && (
        <span
          className={`mt-0.5 shrink-0 ${activo ? 'text-brand-300' : 'text-mist-500'}`}
        >
          {icono}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-mist-100">{etiqueta}</span>
          {activo && (
            <span className="rounded bg-brand-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-brand-300">
              Activo
            </span>
          )}
        </span>
        {descripcion && (
          <span className="mt-0.5 block text-[11px] leading-snug text-mist-500">
            {descripcion}
          </span>
        )}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={activo}
        aria-label={etiqueta}
        disabled={disabled}
        onClick={() => {
          if (disabled) return
          const nuevo = !activo
          setActivo(nuevo)
          onCambio?.(nuevo)
        }}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors ${
          activo
            ? 'border-brand-400/60 bg-brand-500/70'
            : 'border-ink-600 bg-ink-700'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-transform ${
            activo ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
          style={{ height: '18px', width: '18px' }}
        />
      </button>
    </label>
  )
}
