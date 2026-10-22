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

async function clipDelUsuario(clipId: string) {
  const { sesion, repo } = await contexto()
  const clip = await repo.obtenerClip(clipId)
  if (!clip) throw new Error('Clip no encontrado.')
  const proyecto = await repo.obtenerProyecto(clip.proyecto_id)
  if (!proyecto || proyecto.usuario_id !== sesion.uid) {
    throw new Error('No tienes acceso a este clip.')
  }
  return { sesion, repo, clip, proyecto }
}

/** Localiza el clip y el proyecto a partir de una portada. */
async function clipDelUsuarioPorPortada(portadaId: string) {
  const { sesion, repo } = await contexto()
  const portada = await repo.obtenerPortada(portadaId)
  if (!portada) throw new Error('Portada no encontrada.')
  const clip = await repo.obtenerClip(portada.clip_id)
  if (!clip) throw new Error('Clip no encontrado.')
  const proyecto = await repo.obtenerProyecto(clip.proyecto_id)
  if (!proyecto || proyecto.usuario_id !== sesion.uid) {
    throw new Error('No tienes acceso a esta portada.')
  }
  return { sesion, repo, clip, proyecto, portada }
}

export const fnObtenerClip = createServerFn({ method: 'GET' })
  .validator(validar(z.object({ clipId: z.string().min(1) })))
  .handler(async ({ data }) => {
    const { repo, clip } = await clipDelUsuario(data.clipId)
    const [portadas, viral, publicaciones] = await Promise.all([
      repo.listarPortadas(clip.id),
      repo.obtenerContenidoViral(clip.id),
      repo.listarPublicaciones(clip.id),
    ])
    return { clip, portadas, viral, publicaciones }
  })

/**
 * Guarda las opciones del editor y relanza el render en segundo plano.
 * Los toggles se aplican de verdad: el render cambia.
 */
export const fnGuardarOpcionesClip = createServerFn({ method: 'POST' })
  .validator(
    validar(
      z.object({
        clipId: z.string().min(1),
        subtitulos: z.boolean(),
        eliminarSilencios: z.boolean(),
        musica: z.boolean(),
        formato: z.enum(['9:16', '16:9']).optional(),
      }),
    ),
  )
  .handler(async ({ data }) => {
    const { sesion, repo, clip } = await clipDelUsuario(data.clipId)

    const formato = data.formato ?? clip.formato
    const cambiaFormato = formato !== clip.formato

    await repo.actualizarClip(clip.id, {
      subtitulos: data.subtitulos,
      eliminar_silencios: data.eliminarSilencios,
      musica: data.musica,
      ...(cambiaFormato ? { formato } : {}),
    })

    const { encolarClip } = await import('../pipeline/cola')
    const job = encolarClip(sesion, clip.id, {
      subtitulos: data.subtitulos,
      eliminarSilencios: data.eliminarSilencios,
      musica: data.musica,
    })

    return { ok: true as const, jobId: job.id, formato }
  })

/**
 * Recorta el clip a un nuevo intervalo y relanza el render.
 * Los puntos de corte se aplican en tiempos absolutos del vídeo original.
 */
export const fnRecortarClip = createServerFn({ method: 'POST' })
  .validator(
    validar(
      z.object({
        clipId: z.string().min(1),
        inicio: z.number().min(0),
        fin: z.number().min(1),
      }),
    ),
  )
  .handler(async ({ data }) => {
    const { sesion, repo, clip, proyecto } = await clipDelUsuario(data.clipId)

    const inicio = Math.max(0, Math.min(data.inicio, data.fin - 1))
    const fin = Math.min(proyecto.duracion_seg || data.fin, Math.max(inicio + 1, data.fin))

    await repo.actualizarClip(clip.id, { inicio_seg: inicio, fin_seg: fin })

    const { encolarClip } = await import('../pipeline/cola')
    const job = encolarClip(sesion, clip.id, {
      subtitulos: clip.subtitulos,
      eliminarSilencios: clip.eliminar_silencios,
      musica: clip.musica,
    })

    return {
      ok: true as const,
      jobId: job.id,
      inicio,
      fin,
    }
  })

export const fnEstadoJob = createServerFn({ method: 'GET' })
  .validator(validar(z.object({ jobId: z.string().min(1) })))
  .handler(async ({ data }) => {
    const { obtenerJob } = await import('../pipeline/cola')
    const job = obtenerJob(data.jobId)
    if (!job) return null
    return {
      id: job.id,
      estado: job.estado,
      progreso: job.progreso,
      etapa: job.etapa,
      error: job.error,
      etaSegundos: job.etaSegundos,
      clipsCompletados: job.clipsCompletados,
      clipsTotales: job.clipsTotales,
    }
  })

/* ------------------------------------------------------------------ */
/* Portadas                                                             */
/* ------------------------------------------------------------------ */

export const fnRegenerarPortadas = createServerFn({ method: 'POST' })
  .validator(
    validar(
      z.object({
        clipId: z.string().min(1),
        tituloVisual: z.string().max(120).optional(),
        eliminarFondo: z.boolean().optional(),
      }),
    ),
  )
  .handler(async ({ data }) => {
    const { repo, clip, proyecto } = await clipDelUsuario(data.clipId)
    const { generarPortadasDeClip } = await import('../pipeline/cola')
    const { materializarMedio } = await import('../media')
    const { claveDeUrl } = await import('../media')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { mkdir } = await import('node:fs/promises')

    const clave = claveDeUrl(proyecto.url_video_original)
    if (!clave) throw new Error('No se encuentra el vídeo original.')

    const trabajo = join(tmpdir(), 'viralai-work')
    await mkdir(trabajo, { recursive: true })
    const original = join(trabajo, `original_${proyecto.id}.mp4`)
    await materializarMedio(clave, original)

    const viral = await repo.obtenerContenidoViral(clip.id)

    await generarPortadasDeClip(repo, clip.id, {
      entrada: original,
      inicio: clip.inicio_seg,
      fin: clip.fin_seg,
      formato: clip.formato,
      tituloVisual: data.tituloVisual ?? viral?.titulo ?? proyecto.titulo,
      destinoBase: join(trabajo, `portada_${clip.id}_${Date.now()}`),
      eliminarFondo: data.eliminarFondo ?? false,
    })

    const portadas = await repo.listarPortadas(clip.id)
    return { ok: true as const, portadas }
  })

export const fnActualizarPortada = createServerFn({ method: 'POST' })
  .validator(
    validar(
      z.object({
        portadaId: z.string().min(1),
        tituloVisual: z.string().max(120).optional(),
      }),
    ),
  )
  .handler(async ({ data }) => {
    const { repo, clip, proyecto, portada } = await clipDelUsuarioPorPortada(
      data.portadaId,
    )

    const titulo = data.tituloVisual?.trim() || portada.titulo_visual

    // Re-renderizamos la miniatura con el nuevo título.
    const { generarPortadaUnica } = await import('../pipeline/portadas')
    const { RESOLUCIONES } = await import('../pipeline/render')
    const { guardarMedio, materializarMedio, claveDeUrl } = await import('../media')
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { mkdir } = await import('node:fs/promises')

    const clave = claveDeUrl(proyecto.url_video_original)
    if (!clave) throw new Error('No se encuentra el vídeo original.')

    const trabajo = join(tmpdir(), 'viralai-work')
    await mkdir(trabajo, { recursive: true })
    const original = join(trabajo, `original_${proyecto.id}.mp4`)
    await materializarMedio(clave, original)

    const duracion = Math.max(1, clip.fin_seg - clip.inicio_seg)
    const offsets = [0.12, 0.5, 0.86]
    const indice = Math.max(0, portada.version - 1)
    const instante = clip.inicio_seg + duracion * (offsets[indice] ?? 0.5)

    const destino = join(trabajo, `portada_${portada.id}.jpg`)
    const variante = await generarPortadaUnica({
      entrada: original,
      instante,
      resolucion: RESOLUCIONES[clip.formato],
      tituloVisual: titulo,
      eliminarFondo: portada.fondo_eliminado,
      destino,
      acento: indice,
    })

    const url = await guardarMedio(
      `portadas/${clip.id}/v${portada.version}.jpg`,
      await readFile(destino),
      'image/jpeg',
    )

    const actualizada = await repo.actualizarPortada(portada.id, {
      titulo_visual: titulo,
      url_imagen: url,
      fondo_eliminado: variante.fondoEliminado,
    })

    return { ok: true as const, portada: actualizada }
  })

/* ------------------------------------------------------------------ */
/* Contenido viral                                                      */
/* ------------------------------------------------------------------ */

export const fnGenerarContenidoViral = createServerFn({ method: 'POST' })
  .validator(validar(z.object({ clipId: z.string().min(1) })))
  .handler(async ({ data }) => {
    const { repo, clip, proyecto } = await clipDelUsuario(data.clipId)
    const { generarViral } = await import('../pipeline/viral')

    const viral = await generarViral({
      tituloProyecto: proyecto.titulo,
      duracionClip: clip.fin_seg - clip.inicio_seg,
      momentos: [
        {
          inicio: clip.inicio_seg,
          fin: clip.fin_seg,
          puntuacion: clip.puntuacion_viral,
          motivo: 'Clip generado automáticamente.',
          gancho_inicio: clip.inicio_seg,
          gancho_fin: Math.min(clip.fin_seg, clip.inicio_seg + 3),
        },
      ],
      semilla: Date.now() % 100000,
    })

    const guardado = await repo.guardarContenidoViral({
      clip_id: clip.id,
      gancho: viral.gancho,
      titulo: viral.titulo,
      descripcion: viral.descripcion,
      hashtags: viral.hashtags,
      puntuacion: viral.puntuacion,
      fragmentos: viral.fragmentos,
    })

    return { ok: true as const, viral: guardado }
  })

