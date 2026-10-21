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
/* Importación desde un enlace externo                                 */
/* ------------------------------------------------------------------ */

/**
 * Esquema de la importación por enlace.
 *
 * Se valida DENTRO del handler (y no con `.validator()`) porque el plugin
 * que separa las server functions entre cliente y servidor pierde el
 * contenido de los esquemas con arrays: el validador recibía `{}` en lugar
 * del payload y todos los campos salían como `undefined`.
 */
const esquemaImportacion = z.object({
  url: z.string().min(4, 'Introduce un enlace válido.'),
  formatos: z.array(z.enum(['9:16', '16:9'])).min(1),
  maxClips: z.number().int().min(1).max(5),
  duracionClip: z.number().int().min(10).max(120),
  subtitulos: z.boolean(),
  eliminarSilencios: z.boolean(),
  musica: z.boolean(),
})

/**
 * Crea un proyecto a partir de un vídeo remoto (YouTube, TikTok, un MP4
 * directo…) y encola la descarga + el pipeline completo.
 */
export const fnImportarEnlace = createServerFn({ method: 'POST' })
  .validator(validar(esquemaImportacion))
  .handler(async ({ data }: { data: unknown }) => {
    const parsed = esquemaImportacion.safeParse(data)
    if (!parsed.success) {
      const primero = parsed.error.issues[0]
      throw new Error(
        primero?.message ?? 'Los datos de la importación no son válidos.',
      )
    }
    const {
      url: enlace,
      formatos,
      maxClips,
      duracionClip,
      subtitulos,
      eliminarSilencios,
      musica,
    } = parsed.data

    const { sesion, repo } = await contexto()
    const { validarUrlVideo } = await import('../pipeline/descarga')
    const { encolarImportacion } = await import('../pipeline/cola')
    const { ytDlpDisponible } = await import('../pipeline/descarga')

    // Validación inmediata: da error rápido si el enlace es inválido o apunta
    // a una dirección interna (protección SSRF).
    const validada = await validarUrlVideo(enlace)

    const proyecto = await repo.crearProyecto({
      usuario_id: sesion.uid,
      titulo: `Importado · ${validada.host}`,
      url_video_original: '',
      duracion_seg: 0,
      estado: 'procesando',
    })

    const job = encolarImportacion(sesion, proyecto.id, validada.href, {
      formatos,
      maximoClips: maxClips,
      duracionClip,
      subtitulos,
      eliminarSilencios,
      musica,
    })

    return {
      ok: true as const,
      proyectoId: proyecto.id,
      jobId: job.id,
      ytDlp: Boolean(ytDlpDisponible()),
    }
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
