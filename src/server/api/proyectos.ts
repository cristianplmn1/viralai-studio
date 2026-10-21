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

export const fnListarProyectos = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { sesion, repo } = await contexto()
    return repo.listarProyectos(sesion.uid)
  },
)

export const fnObtenerProyecto = createServerFn({ method: 'GET' })
  .validator(validar(z.object({ proyectoId: z.string().min(1) })))
  .handler(async ({ data }) => {
    const { sesion, repo } = await contexto()
    const proyecto = await repo.obtenerProyecto(data.proyectoId)
    if (!proyecto || proyecto.usuario_id !== sesion.uid) {
      throw new Error('Proyecto no encontrado.')
    }
    const clips = await repo.listarClips(proyecto.id)
    return { proyecto, clips }
  })

export const fnEliminarProyecto = createServerFn({ method: 'POST' })
  .validator(validar(z.object({ proyectoId: z.string().min(1) })))
  .handler(async ({ data }) => {
    const { sesion, repo } = await contexto()
    const proyecto = await repo.obtenerProyecto(data.proyectoId)
    if (!proyecto || proyecto.usuario_id !== sesion.uid) {
      throw new Error('Proyecto no encontrado.')
    }
    await repo.borrarProyecto(proyecto.id)
    return { ok: true as const }
  })

/* ------------------------------------------------------------------ */
/* Carga de vídeo (endpoint REST, fuera de las server functions)      */
/* ------------------------------------------------------------------ */

/**
 * Sube el vídeo y arranca el pipeline. Se invoca desde
 * `POST /api/subir?titulo=...&formatos=9:16`
 * con el binario del vídeo como cuerpo de la petición.
 */
export async function registrarSubida(params: {
  titulo: string
  formatos: ('9:16' | '16:9')[]
  maxClips: number
  duracionClip: number
  subtitulos: boolean
  eliminarSilencios: boolean
  musica: boolean
  nombreArchivo: string
  cuerpo: ReadableStream<Uint8Array>
  contentType: string
}): Promise<{ proyectoId: string; jobId: string }> {
  const { sesion, repo } = await contexto()

  const { guardarMedio } = await import('../media')
  const { encolarProyecto } = await import('../pipeline/cola')
  const { randomId } = await import('../crypto')

  const clave = `uploads/${sesion.uid}/${randomId()}-${sanitizarNombre(params.nombreArchivo)}`
  const buffer = await streamToBuffer(params.cuerpo)
  const url = await guardarMedio(clave, buffer, params.contentType)

  const proyecto = await repo.crearProyecto({
    usuario_id: sesion.uid,
    titulo: params.titulo,
    url_video_original: url,
    duracion_seg: 0,
    estado: 'procesando',
  })

  const job = encolarProyecto(
    sesion,
    proyecto.id,
    {
      formatos: params.formatos,
      maximoClips: params.maxClips,
      duracionClip: params.duracionClip,
      subtitulos: params.subtitulos,
      eliminarSilencios: params.eliminarSilencios,
      musica: params.musica,
    },
  )

  return { proyectoId: proyecto.id, jobId: job.id }
}

function sanitizarNombre(nombre: string): string {
  const limpio = nombre
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
  return limpio.slice(-80) || 'video.mp4'
}

async function streamToBuffer(
  flujo: ReadableStream<Uint8Array>,
): Promise<Buffer> {
  const reader = flujo.getReader()
  const trozos: Uint8Array[] = []
  let total = 0
  const limite = 2 * 1024 * 1024 * 1024 // 2 GB
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      total += value.byteLength
      if (total > limite) {
        throw new Error('El vídeo supera el límite de 2 GB.')
      }
      trozos.push(value)
    }
  }
  return Buffer.concat(trozos.map((t) => Buffer.from(t)))
}
