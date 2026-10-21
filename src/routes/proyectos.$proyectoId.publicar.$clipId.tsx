import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ClipTabs } from '~/components/ClipTabs'
import { EstadoPublicacionBadge } from '~/components/EstadoBadge'
import { Panel, Spinner } from '~/components/UI'
import { useSesion } from '~/components/SesionProvider'
import { fnSesionActual } from '~/server/api/auth'
import { fnObtenerClip } from '~/server/api/clips'
import { fnEstadoConexion, fnIniciarOAuth } from '~/server/api/conexion'
import { fnObtenerProyecto } from '~/server/api/proyectos'
import { fnPublicar } from '~/server/api/publicar'
import { PLATAFORMAS } from '~/server/db/types'
import type { Plataforma, Publicacion } from '~/server/db/types'

export const Route = createFileRoute('/proyectos/$proyectoId/publicar/$clipId')({
  loader: async ({ params }) => {
    const sesion = await fnSesionActual()
    if (!sesion.autenticado) throw redirect({ to: '/login' })
    const { clip, viral, publicaciones } = await fnObtenerClip({
      data: { clipId: params.clipId },
    })
    const { proyecto } = await fnObtenerProyecto({
      data: { proyectoId: params.proyectoId },
    })
    return { clip, viral, publicaciones, proyecto }
  },
  component: PaginaPublicar,
})

function PaginaPublicar() {
  const { clip, viral, publicaciones, proyecto } = Route.useLoaderData()
  const router = useRouter()
  const { refrescar } = useSesion()

  const [seleccionadas, setSeleccionadas] = useState<Plataforma[]>(['shorts'])
  const [fecha, setFecha] = useState('')
  const [hora, setHora] = useState('')
  const [publicando, setPublicando] = useState(false)
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(
    null,
  )
  const [conexion, setConexion] = useState<{
    youtube: boolean
    tiktok: boolean
    canal_youtube: string | null
    cuenta_tiktok: string | null
  } | null>(null)

  useEffect(() => {
    void fnEstadoConexion().then(setConexion)
  }, [])

  function alternar(plataforma: Plataforma) {
    setSeleccionadas((previas) =>
      previas.includes(plataforma)
        ? previas.filter((p) => p !== plataforma)
        : [...previas, plataforma],
    )
  }

  function plataformaOAuth(plataforma: Plataforma): 'youtube' | 'tiktok' {
    return plataforma === 'tiktok' ? 'tiktok' : 'youtube'
  }

  async function conectar(plataforma: 'youtube' | 'tiktok') {
    const { url } = await fnIniciarOAuth({ data: { plataforma } })
    window.location.href = url
  }

  async function enviar( programmatic: boolean) {
    if (!seleccionadas.length) {
      setMensaje({ tipo: 'error', texto: 'Selecciona al menos una plataforma.' })
      return
    }
    if (programmatic && (!fecha || !hora)) {
      setMensaje({
        tipo: 'error',
        texto: 'Indica la fecha y la hora de publicación.',
      })
      return
    }

    setPublicando(true)
    setMensaje(null)
    const iso = programmatic ? new Date(`${fecha}T${hora}`).toISOString() : null

    try {
      for (const plataforma of seleccionadas) {
        const resultado = await fnPublicar({
          data: {
            clipId: clip.id,
            plataforma,
            fechaProgramada: iso,
          },
        })
        setMensaje({ tipo: 'ok', texto: resultado.mensaje })
      }
      await Promise.all([router.invalidate(), refrescar()])
    } catch (fallo) {
      setMensaje({
        tipo: 'error',
        texto: fallo instanceof Error ? fallo.message : 'No se pudo publicar.',
      })
    } finally {
      setPublicando(false)
    }
  }

  return (
    <div className="space-y-5">
      <ClipTabs proyectoId={proyecto.id} clipId={clip.id} activo="publicar" />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Panel
            titulo="Plataformas de destino"
            descripcion="Selecciona en dónde quieres publicar este clip."
          >
            <div className="grid gap-2.5 sm:grid-cols-3">
              {PLATAFORMAS.map((plataforma) => {
                const activo = seleccionadas.includes(plataforma.id)
                const oauth = plataformaOAuth(plataforma.id)
                const conectada =
                  oauth === 'tiktok' ? conexion?.tiktok : conexion?.youtube
                return (
                  <button
                    key={plataforma.id}
                    type="button"
                    onClick={() => alternar(plataforma.id)}
                    aria-pressed={activo}
                    className={`relative rounded-xl border p-3.5 text-left transition-all ${
                      activo
                        ? 'border-brand-500/50 bg-brand-500/[0.08]'
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
                      className={`mt-2.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        conectada
                          ? 'bg-lime-400/15 text-lime-300'
                          : 'bg-ink-700 text-mist-400'
                      }`}
                    >
                      {conectada ? 'Conectada' : 'Sin conectar'}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {!conexion?.youtube && (
                <button
                  type="button"
                  onClick={() => void conectar('youtube')}
                  className="btn btn-ghost h-9 !text-[12px]"
                >
                  Conectar YouTube
                </button>
              )}
              {!conexion?.tiktok && (
                <button
                  type="button"
                  onClick={() => void conectar('tiktok')}
                  className="btn btn-ghost h-9 !text-[12px]"
                >
                  Conectar TikTok
                </button>
              )}
            </div>
          </Panel>

          <Panel
            titulo="Programador"
            descripcion="Elige el momento exacto de publicación o publícalo ahora."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="fecha">
                  Fecha
                </label>
                <input
                  id="fecha"
                  type="date"
                  className="input"
                  value={fecha}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setFecha(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="hora">
                  Hora
                </label>
                <input
                  id="hora"
                  type="time"
                  className="input"
                  value={hora}
                  onChange={(e) => setHora(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {[30, 60, 120].map((minutos) => (
                <button
                  key={minutos}
                  type="button"
                  onClick={() => {
                    const destino = new Date(Date.now() + minutos * 60_000)
                    const desfase = destino.getTimezoneOffset() * 60_000
                    const local = new Date(destino.getTime() - desfase)
                    setFecha(local.toISOString().slice(0, 10))
                    setHora(local.toISOString().slice(11, 16))
                  }}
                  className="btn btn-ghost h-8 !px-3 !text-[11.5px]"
                >
                  En {minutos} min
                </button>
              ))}
            </div>
          </Panel>

          <Panel
            titulo="Historial de publicaciones"
            descripcion={`${publicaciones.length} publicaciones registradas para este clip.`}
            cuerpoClassName="p-3"
          >
            {publicaciones.length === 0 ? (
              <p className="px-2 py-6 text-center text-[12.5px] text-mist-500">
                Este clip todavía no se ha publicado en ninguna plataforma.
              </p>
            ) : (
              <ul className="space-y-2">
                {publicaciones.map((publicacion: Publicacion) => (
                  <li
                    key={publicacion.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-ink-700 bg-ink-850/40 px-3.5 py-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-semibold text-mist-100">
                        {PLATAFORMAS.find((p) => p.id === publicacion.plataforma)?.nombre ??
                          publicacion.plataforma}
                      </span>
                      <span className="num block text-[10.5px] text-mist-500">
                        {publicacion.fecha_programada
                          ? new Date(publicacion.fecha_programada).toLocaleString('es-ES')
                          : new Date(publicacion.fecha_creacion).toLocaleString('es-ES')}
                      </span>
                      {publicacion.error && (
                        <span className="mt-1 block text-[11px] text-rose-300">
                          {publicacion.error}
                        </span>
                      )}
                    </span>
                    {publicacion.url_publicacion && (
                      <a
                        href={publicacion.url_publicacion}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="btn btn-ghost h-8 !px-3 !text-[11.5px]"
                      >
                        Ver
                      </a>
                    )}
                    <EstadoPublicacionBadge estado={publicacion.estado} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* Lateral */}
        <div className="space-y-5">
          <Panel titulo="Resumen de la publicación">
            <ul className="space-y-2.5 text-[12.5px]">
              <li className="flex items-baseline justify-between gap-3 border-b border-ink-800/70 pb-2.5">
                <span className="text-mist-500">Plataformas</span>
                <span className="text-right font-semibold text-mist-100">
                  {seleccionadas.length
                    ? PLATAFORMAS.filter((p) => seleccionadas.includes(p.id))
                        .map((p) => p.nombre)
                        .join(', ')
                    : 'Ninguna'}
                </span>
              </li>
              <li className="flex items-baseline justify-between gap-3 border-b border-ink-800/70 pb-2.5">
                <span className="text-mist-500">Título</span>
                <span className="max-w-[60%] truncate text-right font-semibold text-mist-100">
                  {viral?.titulo ?? proyecto.titulo}
                </span>
              </li>
              <li className="flex items-baseline justify-between gap-3 border-b border-ink-800/70 pb-2.5">
                <span className="text-mist-500">Formato</span>
                <span className="font-semibold text-mist-100">{clip.formato}</span>
              </li>
              <li className="flex items-baseline justify-between gap-3">
                <span className="text-mist-500">Hashtags</span>
                <span className="font-semibold text-mist-100">
                  {viral?.hashtags.length ?? 0}
                </span>
              </li>
            </ul>

            {mensaje && (
              <p
                role="status"
                className={`mt-4 rounded-lg border px-3 py-2.5 text-[12.5px] leading-snug ${
                  mensaje.tipo === 'ok'
                    ? 'border-lime-400/25 bg-lime-400/10 text-lime-200'
                    : 'border-rose-500/25 bg-rose-500/10 text-rose-200'
                }`}
              >
                {mensaje.texto}
              </p>
            )}

            <button
              type="button"
              onClick={() => void enviar(false)}
              disabled={publicando || !seleccionadas.length}
              className="btn btn-primary mt-5 w-full !py-3"
            >
              {publicando ? (
                <>
                  <Spinner />
                  Publicando…
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
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                  Publicar ahora
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => void enviar(true)}
              disabled={publicando || !seleccionadas.length}
              className="btn btn-ghost mt-2.5 w-full !py-3"
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
                <rect x="3" y="5" width="18" height="16" rx="2.5" />
                <path d="M8 3v4M16 3v4M3 11h18" />
              </svg>
              Programar
            </button>
          </Panel>

          <Panel titulo="Qué se publicará" cuerpoClassName="p-3">
            <video
              src={clip.url_render}
              controls
              preload="none"
              className="w-full rounded-lg bg-ink-950"
              style={{ aspectRatio: clip.formato === '9:16' ? '9 / 16' : '16 / 9' }}
            />
            <p className="mt-3 text-[11.5px] leading-relaxed text-mist-400">
              El vídeo se sube con el título, la descripción y los hashtags del
              panel viral, y con los subtítulos y el formato que definiste en el
              editor.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  )
}
