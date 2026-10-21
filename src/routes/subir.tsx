import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { AppShell } from '~/components/AppShell'
import { Dropzone, type ArchivoSeleccionado } from '~/components/Dropzone'
import { Toggle } from '~/components/Toggle'
import { AvisoLegal, Panel, Spinner } from '~/components/UI'
import { fnSesionActual } from '~/server/api/auth'
import { fnImportarEnlace } from '~/server/api/proyectos'
import {
  fnEstadoHerramientas,
  fnInspeccionarEnlace,
} from '~/server/api/conexion'

export const Route = createFileRoute('/subir')({
  loader: async () => {
    const sesion = await fnSesionActual()
    if (!sesion.autenticado) throw redirect({ to: '/login' })
    // Server function: el módulo del servidor no entra en el bundle del cliente.
    const herramientas = await fnEstadoHerramientas()
    return {
      nombre: sesion.usuario.nombre,
      ytDlp: herramientas.ytDlp,
    }
  },
  component: PaginaSubir,
})

type PlataformaSeleccionada = 'youtube' | 'shorts' | 'tiktok'
type ModoOrigen = 'fichero' | 'enlace'

/**
 * Estimación orientativa del proceso, calibrada con las medidas reales del
 * pipeline: el análisis escala con la duración del vídeo y cada clip
 * renderizado tiene un coste fijo.
 */
function estimarProceso(duracionVideo: number, numeroClips: number): number {
  const analisis = 3 + duracionVideo * 0.12
  const renders = numeroClips * 3.2
  return Math.max(8, Math.round(analisis + renders))
}

/** "2 min 10 s" / "45 s" */
function formatearTiempo(segundos: number): string {
  const total = Math.max(0, Math.round(segundos))
  if (total < 60) return `${total} s`
  const minutos = Math.floor(total / 60)
  const resto = total % 60
  return resto > 0 ? `${minutos} min ${resto} s` : `${minutos} min`
}

const PLATAFORMAS: {
  id: PlataformaSeleccionada
  nombre: string
  formato: '9:16' | '16:9'
  descripcion: string
  color: string
}[] = [
  {
    id: 'shorts',
    nombre: 'YouTube Shorts',
    formato: '9:16',
    descripcion: 'Vertical ≤ 60 s con #Shorts',
    color: '#ff4e45',
  },
  {
    id: 'tiktok',
    nombre: 'TikTok',
    formato: '9:16',
    descripcion: 'Vertical ≤ 10 min',
    color: '#25f4ee',
  },
  {
    id: 'youtube',
    nombre: 'YouTube',
    formato: '16:9',
    descripcion: 'Vídeo largo horizontal',
    color: '#ff0033',
  },
]

function PaginaSubir() {
  const navegar = useNavigate()
  const { ytDlp } = Route.useLoaderData()
  const [modo, setModo] = useState<ModoOrigen>('fichero')
  const [archivo, setArchivo] = useState<ArchivoSeleccionado | null>(null)
  const [url, setUrl] = useState('')
  const [titulo, setTitulo] = useState('')
  const [seleccionadas, setSeleccionadas] = useState<PlataformaSeleccionada[]>([
    'shorts',
    'tiktok',
  ])
  const [subtitulos, setSubtitulos] = useState(true)
  const [silencios, setSilencios] = useState(true)
  const [musica, setMusica] = useState(false)
  const [maxClips, setMaxClips] = useState(3)
  const [subiendo, setSubiendo] = useState(false)
  const [progreso, setProgreso] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [inspeccion, setInspeccion] = useState<{
    titulo: string
    duracion: number
    extractor: string
    estimacionSegundos: number
  } | null>(null)
  const [inspeccionando, setInspeccionando] = useState(false)

  function alternar(id: PlataformaSeleccionada) {
    setSeleccionadas((previas) =>
      previas.includes(id)
        ? previas.filter((p) => p !== id)
        : [...previas, id],
    )
  }

  const formatos = Array.from(
    new Set(
      PLATAFORMAS.filter((p) => seleccionadas.includes(p.id)).map(
        (p) => p.formato,
      ),
    ),
  )

  /**
   * Tiempo estimado antes de empezar. Se calcula con la duración real del
   * vídeo cuando la conocemos (fichero local o enlace inspeccionado) y con
   * una estimación por defecto si aún no la tenemos.
   */
  const estimacionSegundos = useMemo(() => {
    const duracion =
      modo === 'enlace'
        ? (inspeccion?.duracion ?? 120)
        : (archivo?.duracion ?? 120)
    return estimarProceso(duracion, maxClips)
  }, [modo, inspeccion?.duracion, archivo?.duracion, maxClips])

  async function inspeccionar() {
    if (!url.trim()) {
      setError('Pega el enlace del vídeo que quieres importar.')
      return
    }
    setInspeccionando(true)
    setError(null)
    try {
      const info = await fnInspeccionarEnlace({ data: { url: url.trim() } })
      if (!info.valido) {
        setInspeccion(null)
        setError(info.error ?? 'No se ha podido leer el enlace.')
        return
      }
      setInspeccion({
        titulo: info.titulo,
        duracion: info.duracion,
        extractor: info.extractor,
        estimacionSegundos: info.estimacionSegundos ?? 0,
      })
    } catch (fallo) {
      setError(
        fallo instanceof Error ? fallo.message : 'No se ha podido leer el enlace.',
      )
    } finally {
      setInspeccionando(false)
    }
  }

  async function importarEnlace() {
    if (!url.trim()) {
      setError('Pega el enlace del vídeo que quieres importar.')
      return
    }
    if (!seleccionadas.length) {
      setError('Elige al menos un destino de publicación.')
      return
    }

    setError(null)
    setSubiendo(true)
    setProgreso(0)

    try {
      const resultado = await fnImportarEnlace({
        data: {
          url: url.trim(),
          formatos,
          maxClips,
          duracionClip: 34,
          subtitulos,
          eliminarSilencios: silencios,
          musica,
        },
      })

      await navegar({
        to: '/proyectos/$proyectoId',
        params: { proyectoId: resultado.proyectoId },
      })
    } catch (fallo) {
      setError(
        fallo instanceof Error
          ? fallo.message
          : 'No se pudo importar el enlace.',
      )
      setSubiendo(false)
    }
  }

  async function generar() {
    if (!archivo) {
      setError('Selecciona un vídeo antes de continuar.')
      return
    }
    if (!seleccionadas.length) {
      setError('Elige al menos un destino de publicación.')
      return
    }

    setError(null)
    setSubiendo(true)
    setProgreso(0)

    try {
      const params = new URLSearchParams({
        titulo: titulo.trim() || archivo.archivo.name.replace(/\.[^.]+$/, ''),
        formatos: formatos.join(','),
        max_clips: String(maxClips),
        duracion: '34',
        subtitulos: subtitulos ? '1' : '0',
        silencios: silencios ? '1' : '0',
        musica: musica ? '1' : '0',
        nombre: archivo.archivo.name,
      })

      // Subida con progreso: XHR permite conocer los bytes enviados.
      const respuesta = await subirConProgreso(
        `/api/subir?${params.toString()}`,
        archivo.archivo,
        setProgreso,
      )

      await navegar({
        to: '/proyectos/$proyectoId',
        params: { proyectoId: respuesta.proyectoId },
      })
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo subir el vídeo.')
      setSubiendo(false)
    }
  }

  return (
    <AppShell>
      <div className="animate-[fade-up_0.4s_ease-out]">
        <header>
          <h1 className="font-display text-3xl font-bold tracking-tight text-white">
            Subir vídeo
          </h1>
          <p className="mt-1.5 text-sm text-mist-400">
            La IA analizará tu vídeo, detectará los momentos destacados y
            generará los clips por ti.
          </p>
        </header>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          {/* Columna izquierda */}
          <div className="space-y-5">
            <Panel
              titulo="1 · De dónde sale el vídeo"
              descripcion="Sube un fichero o pega el enlace de un vídeo ya publicado."
            >
              <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl border border-ink-700 bg-ink-900/70 p-1">
                {(
                  [
                    {
                      id: 'fichero' as const,
                      label: 'Subir fichero',
                      icono: 'M12 19V5M5 12l7-7 7 7',
                    },
                    {
                      id: 'enlace' as const,
                      label: 'Pegar enlace',
                      icono:
                        'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5',
                    },
                  ]
                ).map((opcion) => (
                  <button
                    key={opcion.id}
                    type="button"
                    onClick={() => {
                      setModo(opcion.id)
                      setError(null)
                    }}
                    className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors ${
                      modo === opcion.id
                        ? 'bg-gradient-to-r from-brand-600 to-magenta-600 text-white shadow-lg'
                        : 'text-mist-400 hover:bg-ink-800 hover:text-mist-100'
                    }`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d={opcion.icono} />
                    </svg>
                    {opcion.label}
                  </button>
                ))}
              </div>

              {modo === 'fichero' ? (
                <>
                  <Dropzone archivo={archivo} onArchivo={setArchivo} />
                  <div className="mt-4">
                    <label className="label" htmlFor="titulo">
                      Título del proyecto
                    </label>
                    <input
                      id="titulo"
                      className="input"
                      type="text"
                      placeholder={
                        archivo
                          ? archivo.archivo.name.replace(/\.[^.]+$/, '')
                          : 'Ej. Cómo crecer en YouTube con 0 seguidores'
                      }
                      value={titulo}
                      onChange={(e) => setTitulo(e.target.value)}
                      maxLength={140}
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="label" htmlFor="url">
                    Enlace del vídeo
                  </label>
                  <input
                    id="url"
                    className="input"
                    type="url"
                    inputMode="url"
                    placeholder="https://www.youtube.com/watch?v=…"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !subiendo) void importarEnlace()
                    }}
                  />
                  <p className="mt-2 text-[11.5px] leading-relaxed text-mist-500">
                    Pega el enlace de YouTube, TikTok, X, Instagram o un MP4
                    directo. La IA descarga el vídeo, detecta los momentos
                    destacados y genera los clips, las portadas y los textos
                    virales. El título original del vídeo se usa como título
                    del proyecto.
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void inspeccionar()}
                      disabled={inspeccionando || !url.trim()}
                      className="btn btn-ghost h-9 !px-3.5 !text-[12px]"
                    >
                      {inspeccionando ? (
                        <>
                          <Spinner />
                          Leyendo el enlace…
                        </>
                      ) : (
                        'Comprobar enlace'
                      )}
                    </button>
                    {inspeccion && (
                      <span className="inline-flex flex-wrap items-center gap-2 text-[12px] text-mist-400">
                        <span className="chip border-brand-500/25 bg-brand-500/10 text-brand-300">
                          {inspeccion.extractor}
                        </span>
                        <span className="num">
                          {Math.floor(inspeccion.duracion / 60)}:
                          {String(Math.round(inspeccion.duracion % 60)).padStart(2, '0')}
                        </span>
                        <span className="text-mist-500">·</span>
                        <span className="num text-amber-200/90">
                          ~{inspeccion.estimacionSegundos} s de proceso
                        </span>
                      </span>
                    )}
                  </div>

                  {inspeccion?.titulo && (
                    <p className="mt-2 truncate text-[12.5px] font-medium text-mist-200">
                      {inspeccion.titulo}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {[
                      'YouTube',
                      'TikTok',
                      'Instagram',
                      'X / Twitter',
                      'MP4 directo',
                    ].map((origen) => (
                      <span
                        key={origen}
                        className="chip border-ink-600/70 bg-ink-800/60 text-[10.5px]"
                      >
                        {origen}
                      </span>
                    ))}
                  </div>

                  {!ytDlp && (
                    <p className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.07] px-3 py-2.5 text-[11.5px] leading-relaxed text-amber-200/90">
                      Falta <code className="font-mono">yt-dlp</code>, así que
                      ahora sólo se admiten enlaces a ficheros MP4.{' '}
                      <span className="font-semibold">
                        Ejecútalo con <code className="font-mono">npm run tool:yt-dlp</code>
                      </span>{' '}
                      para importar también de YouTube, TikTok, X o Instagram.
                    </p>
                  )}
                </div>
              )}
            </Panel>

            <Panel
              titulo="2 · Formato de destino"
              descripcion="Selecciona dónde se publicarán los clips. El formato del render se adapta a tus destinos."
            >
              <div className="grid gap-2.5 sm:grid-cols-3">
                {PLATAFORMAS.map((plataforma) => {
                  const activo = seleccionadas.includes(plataforma.id)
                  return (
                    <button
                      key={plataforma.id}
                      type="button"
                      onClick={() => alternar(plataforma.id)}
                      aria-pressed={activo}
                      className={`group relative rounded-xl border p-3.5 text-left transition-all ${
                        activo
                          ? 'border-brand-500/50 bg-brand-500/[0.08] shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-brand-500)_30%,transparent)]'
                          : 'border-ink-700 bg-ink-850/50 hover:border-ink-600'
                      }`}
                    >
                      <span
                        className="absolute right-3 top-3 grid h-4 w-4 place-items-center rounded-full border transition-colors"
                        style={{
                          borderColor: activo ? plataforma.color : 'var(--color-ink-600)',
                          background: activo ? plataforma.color : 'transparent',
                        }}
                      >
                        {activo && (
                          <svg
                            viewBox="0 0 24 24"
                            className="h-2.5 w-2.5 text-ink-950"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={4}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        )}
                      </span>
                      <span className="block pr-6 text-[13.5px] font-semibold text-white">
                        {plataforma.nombre}
                      </span>
                      <span className="mt-1 block text-[11.5px] leading-snug text-mist-500">
                        {plataforma.descripcion}
                      </span>
                      <span
                        className="mt-2.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold"
                        style={{
                          background: `${plataforma.color}1f`,
                          color: plataforma.color,
                        }}
                      >
                        {plataforma.formato}
                      </span>
                    </button>
                  )
                })}
              </div>
            </Panel>

            <Panel
              titulo="3 · Opciones de generación"
              descripcion="Se aplicarán al render de cada clip generado."
            >
              <div className="space-y-2.5">
                <Toggle
                  etiqueta="Subtítulos animados"
                  descripcion="Texto con entradas y salidas animadas sobre el clip."
                  valorInicial={subtitulos}
                  onCambio={setSubtitulos}
                />
                <Toggle
                  etiqueta="Eliminar silencios"
                  descripcion="Recorta los tramos sin voz para acelerar el ritmo."
                  valorInicial={silencios}
                  onCambio={setSilencios}
                />
                <Toggle
                  etiqueta="Música de fondo"
                  descripcion="Pad harmónico original con atenuación automática bajo la voz."
                  valorInicial={musica}
                  onCambio={setMusica}
                />
              </div>

              <div className="mt-5 flex items-center gap-4 border-t border-ink-700/60 pt-4">
                <label className="text-[12.5px] font-semibold text-mist-300">
                  Clips a generar
                </label>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setMaxClips(n)}
                      className={`num h-8 w-8 rounded-lg border text-[12.5px] font-bold transition-colors ${
                        maxClips === n
                          ? 'border-brand-500/60 bg-brand-500/20 text-brand-200'
                          : 'border-ink-700 bg-ink-850/60 text-mist-400 hover:border-ink-600'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </Panel>
          </div>

          {/* Columna derecha */}
          <div className="space-y-5">
            <Panel titulo="Resumen" className="lg:sticky lg:top-6">
              <ul className="space-y-3 text-[13px]">
                <ResumenItem
                  etiqueta="Destinos"
                  valor={
                    seleccionadas.length
                      ? PLATAFORMAS.filter((p) => seleccionadas.includes(p.id))
                          .map((p) => p.nombre)
                          .join(' · ')
                      : 'Ninguno'
                  }
                />
                <ResumenItem
                  etiqueta="Formatos de render"
                  valor={formatos.length ? formatos.join(' · ') : '—'}
                />
                <ResumenItem etiqueta="Clips" valor={`${maxClips}`} />
                <ResumenItem
                  etiqueta="Subtítulos"
                  valor={subtitulos ? 'Activados' : 'Desactivados'}
                />
                <ResumenItem
                  etiqueta="Silencios"
                  valor={silencios ? 'Eliminados' : 'Conservados'}
                />
                <ResumenItem
                  etiqueta="Música"
                  valor={musica ? 'Incluida' : 'Sin música'}
                />
                <ResumenItem
                  etiqueta="Tiempo estimado"
                  valor={
                    estimacionSegundos
                      ? `~${formatearTiempo(estimacionSegundos)}`
                      : '—'
                  }
                />
              </ul>

              {error && (
                <p
                  role="alert"
                  className="mt-4 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2.5 text-[12.5px] text-rose-200"
                >
                  {error}
                </p>
              )}

              {subiendo && (
                <div className="mt-4">
                  <div className="mb-1.5 flex items-center justify-between text-[11.5px]">
                    <span className="text-mist-400">Subiendo vídeo…</span>
                    <span className="num font-semibold text-brand-300">
                      {Math.round(progreso)}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-brand-500 to-pink-500 transition-[width] duration-200"
                      style={{ width: `${Math.max(2, progreso)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-[11.5px] leading-snug text-mist-500">
                    En cuanto termine, la IA analizará el vídeo en segundo
                    plano. Puedes seguir trabajando sin esperar.
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={() =>
                  void (modo === 'enlace' ? importarEnlace() : generar())
                }
                disabled={
                  subiendo || (modo === 'fichero' ? !archivo : !url.trim())
                }
                className="btn btn-primary mt-5 w-full !py-3"
              >
                {subiendo ? (
                  <>
                    <Spinner />
                    {modo === 'enlace'
                      ? 'Importando enlace…'
                      : 'Generando clips con IA…'}
                  </>
                ) : (
                  <>
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m12 3 2.2 6.3L21 11l-6.8 1.7L12 19l-2.2-6.3L3 11l6.8-1.7L12 3Z" />
                    </svg>
                    {modo === 'enlace'
                      ? 'Importar y generar con IA'
                      : 'Generar clips con IA'}
                  </>
                )}
              </button>

              <div className="mt-4">
                <AvisoLegal />
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </AppShell>
  )
}

function ResumenItem({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <li className="flex items-baseline justify-between gap-4 border-b border-ink-800/70 pb-2.5 last:border-0">
      <span className="shrink-0 text-[11.5px] font-medium text-mist-500">{etiqueta}</span>
      <span className="truncate text-right text-[12.5px] font-semibold text-mist-100">
        {valor}
      </span>
    </li>
  )
}

/** Sube el fichero con XHR para poder mostrar el progreso de bytes. */
function subirConProgreso(
  url: string,
  archivo: File,
  onProgreso: (porcentaje: number) => void,
): Promise<{ proyectoId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url, true)
    xhr.setRequestHeader('Content-Type', archivo.type || 'video/mp4')
    xhr.withCredentials = true

    xhr.upload.onprogress = (evento) => {
      if (evento.lengthComputable) {
        onProgreso((evento.loaded / evento.total) * 100)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const cuerpo = JSON.parse(xhr.responseText) as {
            proyectoId?: string
            error?: string
          }
          if (cuerpo.proyectoId) {
            resolve({ proyectoId: cuerpo.proyectoId })
            return
          }
          reject(new Error(cuerpo.error ?? 'No se pudo crear el proyecto.'))
        } catch {
          reject(new Error('Respuesta inesperada del servidor.'))
        }
      } else {
        let mensaje = `Error ${xhr.status} al subir el vídeo.`
        try {
          const cuerpo = JSON.parse(xhr.responseText) as { error?: string }
          if (cuerpo.error) mensaje = cuerpo.error
        } catch {
          /* respuesta no JSON */
        }
        reject(new Error(mensaje))
      }
    }
    xhr.onerror = () => reject(new Error('Error de red al subir el vídeo.'))
    xhr.send(archivo)
  })
}
