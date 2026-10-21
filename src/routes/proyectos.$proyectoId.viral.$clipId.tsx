import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { ClipTabs } from '~/components/ClipTabs'
import { ScoreGauge } from '~/components/ScoreGauge'
import { AvisoLegal, Panel, Spinner } from '~/components/UI'
import { fnSesionActual } from '~/server/api/auth'
import { fnGenerarContenidoViral, fnObtenerClip } from '~/server/api/clips'
import { fnObtenerProyecto } from '~/server/api/proyectos'

export const Route = createFileRoute('/proyectos/$proyectoId/viral/$clipId')({
  loader: async ({ params }) => {
    const sesion = await fnSesionActual()
    if (!sesion.autenticado) throw redirect({ to: '/login' })
    const { clip, viral } = await fnObtenerClip({
      data: { clipId: params.clipId },
    })
    const { proyecto } = await fnObtenerProyecto({
      data: { proyectoId: params.proyectoId },
    })
    return { clip, viral, proyecto }
  },
  component: PaginaViral,
})

function PaginaViral() {
  const { clip, viral, proyecto } = Route.useLoaderData()
  const [generando, setGenerando] = useState(false)
  const [copiado, setCopiado] = useState<string | null>(null)

  async function regenerar() {
    setGenerando(true)
    try {
      await fnGenerarContenidoViral({ data: { clipId: clip.id } })
    } finally {
      setGenerando(false)
    }
  }

  async function copiar(texto: string, etiqueta: string) {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(etiqueta)
      setTimeout(() => setCopiado(null), 1800)
    } catch {
      setCopiado(null)
    }
  }

  const puntuacion = viral?.puntuacion ?? 0

  return (
    <div className="space-y-5">
      <ClipTabs proyectoId={proyecto.id} clipId={clip.id} activo="viral" />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Panel
            titulo="Gancho · primeros 1-3 segundos"
            descripcion="La frase que decide si el espectador se queda o hace scroll."
            acciones={
              <button
                type="button"
                onClick={() => void copiar(viral?.gancho ?? '', 'gancho')}
                className="btn btn-ghost h-8 !px-3 !text-[11.5px]"
              >
                {copiado === 'gancho' ? '¡Copiado!' : 'Copiar'}
              </button>
            }
          >
            <p className="font-display text-2xl font-bold leading-snug text-white">
              {viral?.gancho ?? 'Generando gancho…'}
            </p>
            <p className="num mt-2 text-[11.5px] text-mist-500">
              {(viral?.gancho ?? '').trim().split(/\s+/).filter(Boolean).length}{' '}
              palabras · ≈{' '}
              {(((viral?.gancho ?? '').trim().split(/\s+/).filter(Boolean).length) /
                2.6).toFixed(1)}{' '}
              s de lectura
            </p>
          </Panel>

          <Panel
            titulo="Título"
            acciones={
              <button
                type="button"
                onClick={() => void copiar(viral?.titulo ?? '', 'titulo')}
                className="btn btn-ghost h-8 !px-3 !text-[11.5px]"
              >
                {copiado === 'titulo' ? '¡Copiado!' : 'Copiar'}
              </button>
            }
          >
            <p className="text-[15px] font-semibold leading-snug text-mist-100">
              {viral?.titulo ?? '—'}
            </p>
            <p className="num mt-1.5 text-[11px] text-mist-500">
              {(viral?.titulo ?? '').length} caracteres
            </p>
          </Panel>

          <Panel
            titulo="Descripción"
            acciones={
              <button
                type="button"
                onClick={() => void copiar(viral?.descripcion ?? '', 'descripcion')}
                className="btn btn-ghost h-8 !px-3 !text-[11.5px]"
              >
                {copiado === 'descripcion' ? '¡Copiado!' : 'Copiar'}
              </button>
            }
          >
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-mist-300">
              {viral?.descripcion ?? '—'}
            </p>
          </Panel>

          <Panel
            titulo="Hashtags"
            descripcion="Combinación de hashtags de nicho y de alcance general."
            acciones={
              <button
                type="button"
                onClick={() =>
                  void copiar((viral?.hashtags ?? []).join(' '), 'hashtags')
                }
                className="btn btn-ghost h-8 !px-3 !text-[11.5px]"
              >
                {copiado === 'hashtags' ? '¡Copiado!' : 'Copiar todos'}
              </button>
            }
          >
            <div className="flex flex-wrap gap-2">
              {(viral?.hashtags ?? []).map((hashtag) => (
                <span
                  key={hashtag}
                  className="chip border-brand-500/25 bg-brand-500/10 font-mono text-brand-300"
                >
                  {hashtag}
                </span>
              ))}
            </div>
          </Panel>

          <Panel
            titulo="Fragmentos recomendados"
            descripcion="Tramos del vídeo original con mayor potencial, según el análisis."
          >
            {(viral?.fragmentos ?? []).length === 0 ? (
              <p className="text-[12.5px] text-mist-500">
                Todavía no hay fragmentos analizados para este clip.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {(viral?.fragmentos ?? []).map((fragmento, indice) => (
                  <li
                    key={`${fragmento.inicio_seg}-${indice}`}
                    className="flex items-start gap-3 rounded-lg border border-ink-700 bg-ink-850/40 px-3.5 py-3"
                  >
                    <span className="num grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-500/15 text-[11px] font-bold text-brand-300">
                      {indice + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="num text-[11.5px] font-semibold text-mist-200">
                        {fragmento.inicio_seg.toFixed(1)}s – {fragmento.fin_seg.toFixed(1)}s
                        <span className="ml-2 font-normal text-mist-500">
                          ({Math.round(fragmento.fin_seg - fragmento.inicio_seg)}s)
                        </span>
                      </p>
                      <p className="mt-1 text-[12px] leading-snug text-mist-400">
                        {fragmento.motivo}
                      </p>
                    </div>
                    <span
                      className={`num shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        fragmento.puntuacion >= 75
                          ? 'bg-lime-400/15 text-lime-300'
                          : fragmento.puntuacion >= 50
                            ? 'bg-brand-500/15 text-brand-300'
                            : 'bg-amber-400/15 text-amber-300'
                      }`}
                    >
                      {fragmento.puntuacion}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* Lateral */}
        <div className="space-y-5">
          <Panel titulo="Puntuación de viralidad" cuerpoClassName="p-5">
            <div className="flex flex-col items-center">
              <ScoreGauge puntuacion={puntuacion} tamano={140} />
              <p className="mt-4 text-center text-[12.5px] leading-relaxed text-mist-400">
                {puntuacion >= 75
                  ? 'Clip muy bien posicionado para_SHORTs y TikTok. Revisa el gancho y prueba.'
                  : puntuacion >= 50
                    ? 'Base sólida. Ajustar el gancho puede subir la retención.'
                    : 'Hay margen de mejora: juega con el gancho y la duración.'}
              </p>
            </div>
          </Panel>

          <Panel titulo="Acciones">
            <button
              type="button"
              onClick={() => void regenerar()}
              disabled={generando}
              className="btn btn-primary w-full"
            >
              {generando ? (
                <>
                  <Spinner />
                  Generando…
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
                  Regenerar contenido
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
  )
}
