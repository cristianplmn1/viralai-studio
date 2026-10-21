import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { validar } from './validar'

async function contexto() {
  const { sesionVigente, repoDeSesion } = await import('../auth')
  const sesion = await sesionVigente()
  if (!sesion) throw new Error('Debes iniciar sesión para continuar.')
  const repo = await repoDeSesion(sesion)
  return { sesion, repo }
}

export const fnPublicar = createServerFn({ method: 'POST' })
  .validator(
    validar(
      z.object({
        clipId: z.string().min(1),
        plataforma: z.enum(['youtube', 'shorts', 'tiktok']),
        fechaProgramada: z.string().nullable().optional(),
      }),
    ),
  )
  .handler(async ({ data }) => {
    const { sesion } = await contexto()
    const { publicarClip, ensurePlanificador } = await import('../publishing')
    ensurePlanificador()
    const resultado = await publicarClip(sesion, {
      clipId: data.clipId,
      plataforma: data.plataforma,
      fechaProgramada: data.fechaProgramada ?? null,
    })
    return {
      ok: true as const,
      publicacion: resultado.publicacion,
      mensaje: resultado.mensaje,
      modoDemo: resultado.modoDemo,
    }
  })

export const fnListarPublicaciones = createServerFn({ method: 'GET' })
  .validator(validar(z.object({ clipId: z.string().min(1) })))
  .handler(async ({ data }) => {
    const { repo } = await contexto()
    return repo.listarPublicaciones(data.clipId)
  })

export const fnListarPublicacionesGlobales = createServerFn({
  method: 'GET',
}).handler(async () => {
  const { sesion, repo } = await contexto()
  const { ensurePlanificador } = await import('../publishing')
  ensurePlanificador()
  return repo.listarPublicacionesPorUsuario(sesion.uid)
})
