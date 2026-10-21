import { useCallback, useRef, useState } from 'react'

export interface ArchivoSeleccionado {
  archivo: File
  duracion: number
  ancho: number
  alto: number
  url: string
}

export function Dropzone({
  onArchivo,
  archivo,
}: {
  onArchivo: (archivo: ArchivoSeleccionado | null) => void
  archivo: ArchivoSeleccionado | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [arrastrando, setArrastrando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const procesar = useCallback(
    (fichero: File | undefined) => {
      if (!fichero) return
      if (!fichero.type.startsWith('video/')) {
        setError('Selecciona un fichero de vídeo (MP4, MOV, WebM…).')
        return
      }
      if (fichero.size > 2 * 1024 * 1024 * 1024) {
        setError('El vídeo supera el límite de 2 GB.')
        return
      }
      setError(null)
      const url = URL.createObjectURL(fichero)
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => {
        onArchivo({
          archivo: fichero,
          duracion: Number.isFinite(video.duration) ? video.duration : 0,
          ancho: video.videoWidth,
          alto: video.videoHeight,
          url,
        })
        URL.revokeObjectURL(url)
      }
      video.onerror = () => {
        setError('No se pudo leer el vídeo. Prueba con otro formato.')
        onArchivo(null)
        URL.revokeObjectURL(url)
      }
      video.src = url
    },
    [onArchivo],
  )

  if (archivo) {
    return (
      <div className="relative overflow-hidden rounded-xl border border-brand-500/30 bg-ink-900">
        <div className="grid gap-4 p-4 sm:grid-cols-[180px_1fr]">
          <div className="relative aspect-[9/16] max-h-56 overflow-hidden rounded-lg bg-ink-950">
            <video
              src={archivo.url}
              className="h-full w-full object-contain"
              muted
              playsInline
              controls
            />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-mist-500">
              Vídeo listo
            </p>
            <p className="mt-1.5 truncate text-sm font-semibold text-white">
              {archivo.archivo.name}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-[11.5px] text-mist-400">
              <span className="num">{formatearTamano(archivo.archivo.size)}</span>
              {archivo.duracion > 0 && (
                <>
                  <span>·</span>
                  <span className="num">
                    {Math.floor(archivo.duracion / 60)}:
                    {String(Math.round(archivo.duracion % 60)).padStart(2, '0')}
                  </span>
                </>
              )}
              {archivo.ancho > 0 && (
                <>
                  <span>·</span>
                  <span className="num">
                    {archivo.ancho}×{archivo.alto}
                  </span>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                onArchivo(null)
                if (inputRef.current) inputRef.current.value = ''
              }}
              className="btn btn-ghost mt-3 h-8 !px-3 !text-[12px]"
            >
              Cambiar vídeo
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setArrastrando(true)
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => {
          e.preventDefault()
          setArrastrando(false)
          procesar(e.dataTransfer.files?.[0])
        }}
        className={`group flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-all ${
          arrastrando
            ? 'border-brand-400 bg-brand-500/10 scale-[1.01]'
            : 'border-ink-600 bg-ink-900/40 hover:border-brand-500/60 hover:bg-ink-850/60'
        }`}
      >
        <span
          className={`grid h-14 w-14 place-items-center rounded-2xl transition-colors ${
            arrastrando
              ? 'bg-brand-500/25 text-brand-200'
              : 'bg-gradient-to-br from-brand-500/20 to-magenta-500/20 text-brand-300 group-hover:from-brand-500/30 group-hover:to-magenta-500/30'
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.9}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 16V4M7 9l5-5 5 5" />
            <path d="M3 15v3a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-3" />
          </svg>
        </span>
        <span>
          <span className="block text-[15px] font-semibold text-white">
            Arrastra tu vídeo o grabación aquí
          </span>
          <span className="mt-1 block text-[12.5px] text-mist-400">
            o haz clic para elegir el fichero · MP4, MOV o WebM hasta 2 GB
          </span>
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => procesar(e.target.files?.[0])}
      />
      {error && (
        <p className="mt-2.5 text-[12px] text-rose-300" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export function formatearTamano(bytes: number): string {
  if (!bytes) return '0 B'
  const unidades = ['B', 'KB', 'MB', 'GB']
  const exponente = Math.min(
    unidades.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  )
  const valor = bytes / 1024 ** exponente
  return `${valor.toFixed(exponente === 0 ? 0 : 1)} ${unidades[exponente]}`
}
