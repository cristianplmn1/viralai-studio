import { createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { ClipTabs } from '~/components/ClipTabs'
import { LineaTiempo, RangoClip } from '~/components/Timeline'
import { Toggle } from '~/components/Toggle'
import { Panel, Spinner } from '~/components/UI'
import { fnSesionActual } from '~/server/api/auth'
import {
  fnGuardarOpcionesClip,
  fnObtenerClip,
  fnEstadoJob,
  fnRecortarClip,
} from '~/server/api/clips'
import { fnObtenerProyecto } from '~/server/api/proyectos'

export const Route = createFileRoute('/proyectos/$proyectoId/editor/$clipId')({
  loader: async ({ params }) => {
    const sesion = await fnSesionActual()
    if (!sesion.autenticado) throw redirect({ to: '/login' })
    const { clip, portadas, viral, publicaciones } = await fnObtenerClip({
      data: { clipId: params.clipId },
    })
    const { proyecto, clips } = await fnObtenerProyecto({
      data: { proyectoId: params.proyectoId },
    })
    return { clip, portadas, viral, publicaciones, proyecto, clips }
  },
  component: PaginaEditor,
})

function PaginaEditor() {
  const { clip, portadas, viral, proyecto, clips } = Route.useLoaderData()
  const navegar = useNavigate()
  const router = useRouter()

  const [subtitulos, setSubtitulos] = useState(clip.subtitulos)
  const [silencios, setSilencios] = useState(clip.eliminar_silencios)
  const [musica, setMusica] = useState(clip.musica)
  const [formato, setFormato] = useState<'9:16' | '16:9'>(clip.formato)
  const [rango, setRango] = useState({
    inicio: clip.inicio_seg,
    fin: clip.fin_seg,
  })
  const [recortando, setRecortando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progresoRender, setProgresoRender] = useState(0)
  const [etapaRender, setEtapaRender] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(
    null,
  )

  const cambiado =
    subtitulos !== clip.subtitulos ||
    silencios !== clip.eliminar_silencios ||
    musica !== clip.musica ||
    formato !== clip.formato

  // Consulta el progreso del render en segundo plano.
  useEffect(() => {
    if (!jobId) return
    let cancelado = false
    const intervalo = setInterval(async () => {
      try {
        const job = await fnEstadoJob({ data: { jobId } })
        if (cancelado || !job) return
        setProgresoRender(job.progreso)
        setEtapaRender(job.etapa)
        if (job.estado === 'listo') {
          clearInterval(intervalo)
          setJobId(null)
          setGuardando(false)
          setMensaje({
            tipo: 'ok',
            texto: 'Render actualizado con las nuevas opciones.',
          })
          await router.invalidate()
        } else if (job.estado === 'error') {
          clearInterval(intervalo)
          setJobId(null)
          setGuardando(false)
          setMensaje({ tipo: 'error', texto: job.error ?? 'Error al renderizar.' })
        }
      } catch {
        /* se reintenta en el siguiente tick */
      }
    }, 1200)
    return () => {
      cancelado = true
      clearInterval(intervalo)
    }
  }, [jobId, router])

  const segmentos = useMemo(
    () =>
      clips.map((c) => ({
        inicio: c.inicio_seg,
        fin: c.fin_seg,
        etiqueta: `Corte ${clips.indexOf(c) + 1}`,
        activo: c.id === clip.id,
      })),
    [clips, clip.id],
  )

  /* Recorte: se aplica con retardo para no lanzar un render por cada pixel. */
  useEffect(() => {
    if (
      Math.abs(rango.inicio - clip.inicio_seg) < 0.15 &&
      Math.abs(rango.fin - clip.fin_seg) < 0.15
    ) {
      return
    }
    const temporizador = setTimeout(async () => {
      setRecortando(true)
      try {
        const resultado = await fnRecortarClip({
          data: { clipId: clip.id, inicio: rango.inicio, fin: rango.fin },
        })
        setJobId(resultado.jobId)
        setProgresoRender(0)
      } catch (fallo) {
        setMensaje({
          tipo: 'error',
          texto:
            fallo instanceof Error
              ? fallo.message
              : 'No se pudo aplicar el recorte.',
        })
      } finally {
        setRecortando(false)
      }
    }, 900)
    return () => clearTimeout(temporizador)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rango.inicio, rango.fin])

  async function guardar() {
    setGuardando(true)
    setMensaje(null)
    try {
      const resultado = await fnGuardarOpcionesClip({
        data: {
          clipId: clip.id,
          subtitulos,
          eliminarSilencios: silencios,
          musica,
          formato,
        },
      })
      setJobId(resultado.jobId)
      setProgresoRender(0)
    } catch (fallo) {
      setGuardando(false)
      setMensaje({
        tipo: 'error',
        texto: fallo instanceof Error ? fallo.message : 'No se pudo guardar.',
      })
    }
  }

  const duracionClip = clip.fin_seg - clip.inicio_seg
  const poster = portadas[0]?.url_imagen

  return (
    <div className="space-y-5">
      <ClipTabs
        proyectoId={proyecto.id}
        clipId={clip.id}
        activo="editor"
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Reproductor */}
        <div className="space-y-5">
          <Panel
            titulo="Reproductor"
            descripcion="Previsualiza exactamente lo que se publicará."
            acciones={
              <span className="chip border-ink-600/70 bg-ink-800/60 text-mist-300">
                {formato} · {Math.round(duracionClip)}s
              </span>
            }
            cuerpoClassName="p-4"
          >
            <div
              className="mx-auto overflow-hidden rounded-xl bg-ink-950"
              style={{ maxWidth: formato === '9:16' ? 340 : 860 }}
            >
              <video
                key={clip.url_render}
                src={clip.url_render}
                poster={poster}
                controls
                playsInline
                preload="metadata"
                className="w-full"
                style={{ aspectRatio: formato === '9:16' ? '9 / 16' : '16 / 9' }}
              />
            </div>

            {guardando && (
              <div className="mt-4 rounded-lg border border-brand-500/25 bg-brand-500/[0.07] px-4 py-3">
                <div className="mb-1.5 flex items-center justify-between text-[12px]">
                  <span className="flex items-center gap-2 font-semibold text-brand-200">
                    <Spinner className="h-3.5 w-3.5" />
                    {etapaRender ?? 'Renderizando…'}
                  </span>
                  <span className="num font-semibold text-brand-300">
                    {Math.round(progresoRender)}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-500 to-pink-500 transition-[width] duration-500"
                    style={{ width: `${Math.max(3, progresoRender)}%` }}
                  />
                </div>
                <p className="mt-2 text-[11px] text-mist-400">
                  El render se ejecuta en segundo plano. Puedes seguir
                  navigating por el proyecto.
                </p>
              </div>
            )}

            {mensaje && (
              <p
                role="status"
                className={`mt-4 rounded-lg border px-3 py-2.5 text-[12.5px] ${
                  mensaje.tipo === 'ok'
                    ? 'border-lime-400/25 bg-lime-400/10 text-lime-200'
                    : 'border-rose-500/25 bg-rose-500/10 text-rose-200'
                }`}
              >
                {mensaje.texto}
              </p>
            )}
          </Panel>

          <Panel
            titulo="Línea de tiempo"
            descripcion="Cortes detectados por la IA sobre el vídeo original."
          >
            <LineaTiempo
              duracion={proyecto.duracion_seg}
              segmentos={segmentos}
              onSeleccion={(indice) => {
                const destino = clips[indice]
                if (destino && destino.id !== clip.id) {
                  void navegar({
                    to: '/proyectos/$proyectoId/editor/$clipId',
                    params: { proyectoId: proyecto.id, clipId: destino.id },
                  })
                }
              }}
            />

            <div className="mt-5">
              <p className="label">Recorte del clip</p>
              <RangoClip
                duracion={proyecto.duracion_seg || clip.fin_seg}
                inicio={rango.inicio}
                fin={rango.fin}
                onCambio={(inicio, fin) => setRango({ inicio, fin })}
              />
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-mist-500">
                {recortando ? (
                  <>
                    <Spinner className="h-3 w-3" />
                    Aplicando el recorte y relanzando el render…
                  </>
                ) : (
                  <>
                    Arrastra los extremos para ajustar el corte. El intervalo
                    actual es{' '}
                    <span className="num text-mist-300">
                      {rango.inicio.toFixed(1)}s – {rango.fin.toFixed(1)}s
                    </span>
                    .
                  </>
                )}
              </p>
            </div>
          </Panel>
        </div>

        {/* Panel lateral */}
        <div className="space-y-5">
          <Panel titulo="Ajustes del clip" descripcion="Se aplican en el render.">
            <div className="space-y-2.5">
              <Toggle
                etiqueta="Eliminar silencios"
                descripcion="Recorta los tramos sin voz y acelera el ritmo."
                valorInicial={clip.eliminar_silencios}
                onCambio={setSilencios}
                icono={
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.9}
                    strokeLinecap="round"
                  >
                    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                    <path d="m17 9 4 6M21 9l-4 6" />
                  </svg>
                }
              />
              <Toggle
                etiqueta="Subtítulos animados"
                descripcion="Texto sincronizado con entradas y salidas suaves."
                valorInicial={clip.subtitulos}
                onCambio={setSubtitulos}
                icono={
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.9}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="5" width="18" height="14" rx="2.5" />
                    <path d="M7 14h4M14 14h3" />
                  </svg>
                }
              />
              <Toggle
                etiqueta="Música"
                descripcion="Base armónica original que se atenúa con la voz."
                valorInicial={clip.musica}
                onCambio={setMusica}
                icono={
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.9}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 18V5l11-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="17" cy="16" r="3" />
                  </svg>
                }
              />
              <Toggle
                etiqueta="Formato 9:16"
                descripcion="Vertical para Shorts y TikTok. Desactívalo para 16:9."
                valorInicial={clip.formato === '9:16'}
                onCambio={(valor) => setFormato(valor ? '9:16' : '16:9')}
                icono={
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.9}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="7" y="3" width="10" height="18" rx="2" />
                  </svg>
                }
              />
            </div>

            <button
              type="button"
              onClick={() => void guardar()}
              disabled={guardando || !cambiado}
              className="btn btn-primary mt-5 w-full"
            >
              {guardando ? (
                <>
                  <Spinner />
                  Guardando…
                </>
              ) : (
                'Guardar cambios'
              )}
            </button>
            {!cambiado && !guardando && (
              <p className="mt-2 text-center text-[11px] text-mist-500">
                No hay cambios pendientes.
              </p>
            )}
          </Panel>

          <Panel
            titulo="Momentos destacados"
            descripcion={`${clips.length} detectados en el vídeo original.`}
            cuerpoClassName="p-3"
          >
            <ul className="space-y-2">
              {clips.map((c, indice) => {
                const activo = c.id === clip.id
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!activo) {
                          void navegar({
                            to: '/proyectos/$proyectoId/editor/$clipId',
                            params: { proyectoId: proyecto.id, clipId: c.id },
                          })
                        }
                      }}
                      className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        activo
                          ? 'border-brand-500/45 bg-brand-500/[0.09]'
                          : 'border-ink-700 bg-ink-850/40 hover:border-ink-600'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12.5px] font-semibold text-mist-100">
                          Corte {indice + 1}
                        </span>
                        <span
                          className={`num rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            c.puntuacion_viral >= 75
                              ? 'bg-lime-400/15 text-lime-300'
                              : c.puntuacion_viral >= 50
                                ? 'bg-brand-500/15 text-brand-300'
                                : 'bg-amber-400/15 text-amber-300'
                          }`}
                        >
                          {c.puntuacion_viral}
                        </span>
                      </div>
                      <p className="num mt-1 text-[10.5px] text-mist-500">
                        {c.inicio_seg.toFixed(1)}s – {c.fin_seg.toFixed(1)}s ·{' '}
                        {c.formato}
                      </p>
                    </button>
                  </li>
                )
              })}
            </ul>
          </Panel>

          {viral && (
            <Panel titulo="Texto viral" descripcion="Resumen del copy generado.">
              <p className="text-[12.5px] font-semibold leading-snug text-mist-100">
                {viral.gancho}
              </p>
              <p className="mt-2 text-[11.5px] leading-relaxed text-mist-400">
                {viral.titulo}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {viral.hashtags.slice(0, 6).map((h) => (
                  <span key={h} className="chip border-brand-500/25 bg-brand-500/10 text-brand-300">
                    {h}
                  </span>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}
