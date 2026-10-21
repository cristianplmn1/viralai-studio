import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { ClipTabs } from '~/components/ClipTabs'
import { Toggle } from '~/components/Toggle'
import { Panel, Spinner } from '~/components/UI'
import { fnSesionActual } from '~/server/api/auth'
import {
  fnObtenerClip,
  fnRegenerarPortadas,
  fnActualizarPortada,
} from '~/server/api/clips'
import { fnObtenerProyecto } from '~/server/api/proyectos'

export const Route = createFileRoute('/proyectos/$proyectoId/portadas/$clipId')({
  loader: async ({ params }) => {
    const sesion = await fnSesionActual()
    if (!sesion.autenticado) throw redirect({ to: '/login' })
    const { clip, portadas } = await fnObtenerClip({
      data: { clipId: params.clipId },
    })
    const { proyecto } = await fnObtenerProyecto({
      data: { proyectoId: params.proyectoId },
    })
    return { clip, portadas, proyecto }
  },
  component: PaginaPortadas,
})

function PaginaPortadas() {
  const { clip, portadas, proyecto } = Route.useLoaderData()

  const [tituloVisual, setTituloVisual] = useState(
    portadas[0]?.titulo_visual ?? proyecto.titulo,
  )
  const [eliminarFondo, setEliminarFondo] = useState(true)
  const [regenerando, setRegenerando] = useState(false)
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(
    null,
  )

  async function guardarTitulo(portadaId: string, titulo: string) {
    const limpio = titulo.trim()
    if (!limpio) return
    try {
      await fnActualizarPortada({ data: { portadaId, tituloVisual: limpio } })
      setMensaje({ tipo: 'ok', texto: 'Portada actualizada con el nuevo título.' })
    } catch (fallo) {
      setMensaje({
        tipo: 'error',
        texto: fallo instanceof Error ? fallo.message : 'No se pudo actualizar.',
      })
    }
  }

  async function regenerar() {
    setRegenerando(true)
    setMensaje(null)
    try {
      await fnRegenerarPortadas({
        data: {
          clipId: clip.id,
          tituloVisual: tituloVisual.trim() || proyecto.titulo,
          eliminarFondo,
        },
      })
      setMensaje({ tipo: 'ok', texto: 'Tres nuevas portadas generadas.' })
    } catch (fallo) {
      setMensaje({
        tipo: 'error',
        texto: fallo instanceof Error ? fallo.message : 'No se pudieron generar.',
      })
    } finally {
      setRegenerando(false)
    }
  }

  return (
    <div className="space-y-5">
      <ClipTabs proyectoId={proyecto.id} clipId={clip.id} activo="portadas" />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel
          titulo="Generador de portadas"
          descripcion="Tres versiones distintas extraídas del clip para que puedas compararlas y elegir."
          acciones={
            <span className="chip border-ink-600/70 bg-ink-800/60 text-mist-300">
              {portadas.length} versiones
            </span>
          }
        >
          {portadas.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Spinner className="h-6 w-6 text-brand-400" />
              <p className="text-sm text-mist-400">
                Las portadas se generan al terminar el render del clip.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              {portadas.map((portada) => (
                <figure
                  key={portada.id}
                  className="group overflow-hidden rounded-xl border border-ink-700 bg-ink-900 transition-colors hover:border-brand-500/40"
                >
                  <div
                    className="relative overflow-hidden bg-ink-950"
                    style={{ aspectRatio: clip.formato === '9:16' ? '9 / 16' : '16 / 9' }}
                  >
                    <img
                      src={portada.url_imagen}
                      alt={`Portada versión ${portada.version}`}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                    />
                    <span className="absolute left-2 top-2 rounded-md bg-ink-950/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur">
                      v{portada.version}
                    </span>
                    {portada.fondo_eliminado && (
                      <span className="absolute right-2 top-2 rounded-md bg-brand-500/85 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                        Sin fondo
                      </span>
                    )}
                  </div>
                  <figcaption className="px-3 py-2.5">
                    <label
                      className="sr-only"
                      htmlFor={`titulo-${portada.id}`}
                    >
                      Título de la versión {portada.version}
                    </label>
                    <input
                      id={`titulo-${portada.id}`}
                      className="input !py-1.5 !text-[11.5px]"
                      defaultValue={portada.titulo_visual}
                      maxLength={120}
                      onBlur={(e) => void guardarTitulo(portada.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                      }}
                    />
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </Panel>

        <div className="space-y-5">
          <Panel titulo="Ajustes de la miniatura">
            <div>
              <label className="label" htmlFor="titulo-visual">
                Título visual
              </label>
              <input
                id="titulo-visual"
                className="input"
                type="text"
                maxLength={120}
                placeholder="El texto grande de la miniatura"
                value={tituloVisual}
                onChange={(e) => setTituloVisual(e.target.value)}
              />
              <p className="mt-1.5 text-[11px] text-mist-500">
                {tituloVisual.length}/120 caracteres
              </p>
            </div>

            <div className="mt-4">
              <Toggle
                etiqueta="Eliminar fondo"
                descripcion="Detecta el color dominante del encuadre y lo hace transparente."
                valorInicial={eliminarFondo}
                onCambio={setEliminarFondo}
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
                    <path d="M5 3v4M3 5h4M6 17v4M4 19h4M13 3l8 8-8 8-8-8 8-8Z" />
                  </svg>
                }
              />
            </div>

            <button
              type="button"
              onClick={() => void regenerar()}
              disabled={regenerando}
              className="btn btn-primary mt-5 w-full"
            >
              {regenerando ? (
                <>
                  <Spinner />
                  Regenerando…
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
                    <path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" />
                  </svg>
                  Regenerar
                </>
              )}
            </button>

            {mensaje && (
              <p
                role="status"
                className={`mt-3 rounded-lg border px-3 py-2.5 text-[12.5px] ${
                  mensaje.tipo === 'ok'
                    ? 'border-lime-400/25 bg-lime-400/10 text-lime-200'
                    : 'border-rose-500/25 bg-rose-500/10 text-rose-200'
                }`}
              >
                {mensaje.texto}
              </p>
            )}
          </Panel>

          <Panel titulo="Cómo elegir" cuerpoClassName="p-4">
            <ul className="space-y-2.5 text-[12px] leading-relaxed text-mist-400">
              <li className="flex gap-2">
                <span className="text-brand-300">·</span>
                Compara las tres versiones con el mismo texto: la que mejor
                comunique en un segundo es la ganadora.
              </li>
              <li className="flex gap-2">
                <span className="text-brand-300">·</span>
                Con el fondo eliminado el sujeto destaca sobre el degradado de
                marca, útil para retratos y tutoriales.
              </li>
              <li className="flex gap-2">
                <span className="text-brand-300">·</span>
                Mantén el texto corto: en móvil solo se lee una parte.
              </li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  )
}
