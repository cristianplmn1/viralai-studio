import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, rm, readFile } from 'node:fs/promises'
import type { SessionPayload } from '../crypto'
import { repoDeSesion } from '../auth'
import { claveDeUrl, guardarMedio, materializarMedio } from '../media'
import { analizarVideo, type MomentoDestacado, type ResultadoAnalisis } from './analisis'
import { renderizarClip, RESOLUCIONES, type Formato } from './render'
import { obtenerMusicaBase } from './musica'
import { generarPortadas } from './portadas'
import { generarViral } from './viral'
import { transcribir } from './transcripcion'

export type TipoJob = 'proyecto' | 'clip' | 'importar'
export type EstadoJob = 'pendiente' | 'ejecutando' | 'listo' | 'error'

export interface Job {
  id: string
  tipo: TipoJob
  objetivoId: string
  estado: EstadoJob
  progreso: number
  etapa: string
  error: string | null
  creado: number
  actualizado: number
  /** Datos extra del trabajo (por ejemplo, la URL de origen) */
  datos?: Record<string, string>
  /** Segundos estimados para terminar (null si aún no hay ritmo medido) */
  etaSegundos: number | null
  /** Clips ya generados, para la previsualización progresiva */
  clipsListos: ClipListo[]
  /** Clips completados y total previsto */
  clipsCompletados: number
  clipsTotales: number
}

export interface ClipListo {
  id: string
  url_render: string
  titulo: string
  formato: string
  duracion: number
  portada: string | null
}

export interface OpcionesJob {
  /** Formatos a generar (se deduplican: 9:16 y 16:9) */
  formatos: Formato[]
  /** Máximo de clips a generar */
  maximoClips: number
  /** Duración objetivo de cada clip */
  duracionClip: number
  subtitulos: boolean
  eliminarSilencios: boolean
  musica: boolean
}

export const OPCIONES_POR_DEFECTO: OpcionesJob = {
  formatos: ['9:16'],
  maximoClips: 3,
  duracionClip: 34,
  subtitulos: true,
  eliminarSilencios: true,
  musica: false,
}

/* ------------------------------------------------------------------ */
/* Registro de jobs (globalThis sobrevive al HMR de Vite)             */
/* ------------------------------------------------------------------ */

interface Registro {
  jobs: Map<string, Job>
  cola: string[]
  ejecutando: boolean
}

const GLOBAL_KEY = '__viralai_jobs__'

function registro(): Registro {
  const global = globalThis as unknown as Record<string, Registro | undefined>
  const existente = global[GLOBAL_KEY]
  if (existente) return existente
  const nuevo: Registro = { jobs: new Map(), cola: [], ejecutando: false }
  global[GLOBAL_KEY] = nuevo
  return nuevo
}

function crearJob(
  tipo: TipoJob,
  objetivoId: string,
  datos?: Record<string, string>,
  clipsTotales = 0,
): Job {
  const registroGlobal = registro()
  const job: Job = {
    id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    tipo,
    objetivoId,
    estado: 'pendiente',
    progreso: 0,
    etapa: 'En cola',
    error: null,
    creado: Date.now(),
    actualizado: Date.now(),
    etaSegundos: null,
    clipsListos: [],
    clipsCompletados: 0,
    clipsTotales,
    ...(datos ? { datos } : {}),
  }
  registroGlobal.jobs.set(job.id, job)
  registroGlobal.cola.push(job.id)

  if (registroGlobal.jobs.size > 60) {
    const caducar = [...registroGlobal.jobs.values()]
      .filter((j) => j.estado === 'listo' || j.estado === 'error')
      .sort((a, b) => a.actualizado - b.actualizado)
      .slice(0, 20)
    for (const caducado of caducar) {
      registroGlobal.jobs.delete(caducado.id)
    }
  }
  return job
}

export function obtenerJob(id: string): Job | null {
  return registro().jobs.get(id) ?? null
}

export function listarJobs(): Job[] {
  return [...registro().jobs.values()].sort((a, b) => b.creado - a.creado)
}

/** Trabajo en curso (o el último) de un proyecto. */
export function jobDeProyecto(proyectoId: string): Job | null {
  const candidatos = [...registro().jobs.values()]
    .filter((j) => j.objetivoId === proyectoId)
    .sort((a, b) => b.creado - a.creado)
  return candidatos[0] ?? null
}

function actualizarJob(id: string, patch: Partial<Job>): void {
  const job = registro().jobs.get(id)
  if (!job) return
  Object.assign(job, patch, { actualizado: Date.now() })
}

/* ------------------------------------------------------------------ */
/* Encolado                                                             */
/* ------------------------------------------------------------------ */

export function encolarProyecto(
  sesion: SessionPayload,
  proyectoId: string,
  opciones: OpcionesJob,
): Job {
  const job = crearJob('proyecto', proyectoId)
  void ejecutarEnSegundoPlano(job.id, sesion, opciones)
  return job
}

export function encolarClip(
  sesion: SessionPayload,
  clipId: string,
  opciones: Partial<OpcionesJob> = {},
): Job {
  const job = crearJob('clip', clipId)
  void ejecutarEnSegundoPlano(job.id, sesion, {
    ...OPCIONES_POR_DEFECTO,
    ...opciones,
  })
  return job
}

/**
 * Importa un vídeo desde una URL externa (YouTube, TikTok, un MP4 directo…)
 * y lanza el pipeline completo sobre él.
 */
export function encolarImportacion(
  sesion: SessionPayload,
  proyectoId: string,
  url: string,
  opciones: OpcionesJob,
): Job {
  const job = crearJob('importar', proyectoId, { url })
  void ejecutarEnSegundoPlano(job.id, sesion, opciones)
  return job
}

/**
 * Un único worker procesa la cola: evita saturar la CPU con renders
 * simultáneos y mantiene el orden de los trabajos.
 */
async function ejecutarEnSegundoPlano(
  jobId: string,
  sesion: SessionPayload,
  opciones: OpcionesJob,
): Promise<void> {
  const registroGlobal = registro()
  registroGlobal.cola = registroGlobal.cola.filter((id) => id !== jobId)

  while (registroGlobal.ejecutando) {
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  registroGlobal.ejecutando = true

  try {
    const job = registroGlobal.jobs.get(jobId)
    if (!job) return
    if (job.tipo === 'proyecto') {
      await procesarProyecto(job, sesion, opciones)
    } else if (job.tipo === 'importar') {
      await procesarImportacion(job, sesion, opciones)
    } else {
      await procesarClip(job, sesion, opciones)
    }
    actualizarJob(jobId, { estado: 'listo', progreso: 100, etapa: 'Completado' })
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error)
    actualizarJob(jobId, { estado: 'error', error: mensaje, etapa: 'Error' })
  } finally {
    registroGlobal.ejecutando = false
    void drenarCola(sesion, opciones)
  }
}

async function drenarCola(
  sesion: SessionPayload,
  opciones: OpcionesJob,
): Promise<void> {
  const registroGlobal = registro()
  const siguiente = registroGlobal.cola.shift()
  if (!siguiente) return
  const job = registroGlobal.jobs.get(siguiente)
  if (!job || job.estado !== 'pendiente') return
  void ejecutarEnSegundoPlano(siguiente, sesion, opciones)
}

/* ------------------------------------------------------------------ */
/* Pipeline                                                             */
/* ------------------------------------------------------------------ */

export function directorioTrabajo(): string {
  return join(tmpdir(), 'viralai-work')
}

async function descargarOriginal(url: string, destino: string): Promise<string> {
  const clave = claveDeUrl(url)
  if (!clave) {
    throw new Error('El vídeo original no está en el almacén de medios.')
  }
  await mkdir(dirname(destino), { recursive: true })
  return materializarMedio(clave, destino)
}

async function procesarProyecto(
  job: Job,
  sesion: SessionPayload,
  opciones: OpcionesJob,
): Promise<void> {
  const repo = await repoDeSesion(sesion)
  const proyecto = await repo.obtenerProyecto(job.objetivoId)
  if (!proyecto) throw new Error('Proyecto no encontrado')

  const trabajo = directorioTrabajo()
  await mkdir(trabajo, { recursive: true })
  const original = join(trabajo, `original_${proyecto.id}.mp4`)

  try {
    await repo.actualizarProyecto(proyecto.id, {
      estado: 'procesando',
      progreso: 5,
      etapa: 'Descargando vídeo original',
      mensaje_error: null,
    })
    actualizarJob(job.id, { etapa: 'Descargando vídeo original', progreso: 8 })

    await descargarOriginal(proyecto.url_video_original, original)

    /* --- Análisis --- */
    await repo.actualizarProyecto(proyecto.id, {
      progreso: 18,
      etapa: 'Analizando audio y planos',
    })
    actualizarJob(job.id, { etapa: 'Analizando audio y planos', progreso: 18 })

    const analisis: ResultadoAnalisis = await analizarVideo(original, {
      duracionClip: opciones.duracionClip,
      maximoClips: opciones.maximoClips,
      minimoSeparacion: 4,
    })

    if (!analisis.metadatos.duracion) {
      throw new Error('No se pudo determinar la duración del vídeo.')
    }

    await repo.actualizarProyecto(proyecto.id, {
      duracion_seg: analisis.metadatos.duracion,
      progreso: 28,
      etapa: 'Detectados momentos destacados',
    })
    actualizarJob(job.id, {
      etapa: `Detectados ${analisis.momentos.length} momentos destacados`,
      progreso: 28,
    })

    if (!analisis.momentos.length) {
      throw new Error('No se encontró ningún momento destacado en el vídeo.')
    }

    /* --- Limpieza de clips previos --- */
    await repo.borrarClips(proyecto.id)

    const formatos = normalizarFormatos(opciones.formatos)
    const momentos = analisis.momentos.slice(0, opciones.maximoClips)
    const total = momentos.length * formatos.length
    let completados = 0

    // Estimación de tiempo: media real de render por clip.
    const duraciones: number[] = []

    actualizarJob(job.id, { clipsTotales: total })

    const transcripcion = opciones.subtitulos
      ? await transcribir(original)
      : null

    const musicaBase = opciones.musica ? await obtenerMusicaBase() : null

    for (const momento of momentos) {
      for (const formato of formatos) {
        const duracion = momento.fin - momento.inicio
        const render = join(
          trabajo,
          `clip_${proyecto.id}_${Math.round(momento.inicio)}_${formato}.mp4`,
        )
        const claveRender = `renders/${proyecto.id}/${formato.replace(':', 'x')}-${Math.round(momento.inicio)}.mp4`

        const progresoBase = 28 + (completados / total) * 62
        await repo.actualizarProyecto(proyecto.id, {
          progreso: Math.round(progresoBase),
          etapa: `Renderizando clip ${completados + 1} de ${total} (${formato})`,
        })
        actualizarJob(job.id, {
          etapa: `Renderizando clip ${completados + 1} de ${total} (${formato})`,
          progreso: Math.round(progresoBase),
        })

        const inicioClip = Date.now()
        await renderizarClip(original, {
          formato,
          subtitulos: opciones.subtitulos,
          eliminarSilencios: opciones.eliminarSilencios,
          musica: opciones.musica,
          silencios: analisis.silencios,
          inicio: momento.inicio,
          fin: momento.fin,
          duracion,
          transcripcion: transcripcion?.segmentos,
          musicaBase,
          destino: render,
        })

        const urlRender = await guardarMedio(
          claveRender,
          await readFile(render),
          'video/mp4',
        )

        const clip = await repo.crearClip({
          proyecto_id: proyecto.id,
          inicio_seg: momento.inicio,
          fin_seg: momento.fin,
          formato,
          url_render: urlRender,
          subtitulos: opciones.subtitulos,
          eliminar_silencios: opciones.eliminarSilencios,
          musica: opciones.musica,
          puntuacion_viral: momento.puntuacion,
          titulo: `Momento destacado ${completados + 1}`,
        })

        await generarPortadasDeClip(repo, clip.id, {
          entrada: original,
          inicio: momento.inicio,
          fin: momento.fin,
          formato,
          tituloVisual: proyecto.titulo,
          destinoBase: join(trabajo, `portada_${clip.id}`),
        })

        const viral = await generarViral({
          tituloProyecto: proyecto.titulo,
          duracionClip: duracion,
          momentos: [momento],
        })
        await repo.guardarContenidoViral({
          clip_id: clip.id,
          gancho: viral.gancho,
          titulo: viral.titulo,
          descripcion: viral.descripcion,
          hashtags: viral.hashtags,
          puntuacion: viral.puntuacion,
          fragmentos: viral.fragmentos,
        })

        const portadas = await repo.listarPortadas(clip.id)

        // El clip ya está listo: lo publicamos para la previsualización
        // progresiva y recalculamos el tiempo restante.
        duraciones.push((Date.now() - inicioClip) / 1000)
        const media =
          duraciones.reduce((a, b) => a + b, 0) / Math.max(1, duraciones.length)
        const restantes = total - (completados + 1)

        const jobActual = registro().jobs.get(job.id)
        const clipsListos = [
          ...(jobActual?.clipsListos ?? []),
          {
            id: clip.id,
            url_render: urlRender,
            titulo: clip.titulo,
            formato,
            duracion: Math.round(duracion),
            portada: portadas[0]?.url_imagen ?? null,
          },
        ]

        actualizarJob(job.id, {
          clipsCompletados: completados + 1,
          clipsTotales: total,
          clipsListos,
          etaSegundos:
            restantes > 0
              ? Math.max(1, Math.round(media * restantes))
              : 0,
        })

        completados++
      }
    }

    await repo.actualizarProyecto(proyecto.id, {
      estado: 'listo',
      progreso: 100,
      etapa: 'Listo para editar',
      mensaje_error: null,
    })
    actualizarJob(job.id, { etapa: 'Listo para editar', progreso: 100 })
  } catch (error) {
    await repo
      .actualizarProyecto(proyecto.id, {
        estado: 'procesando',
        progreso: 0,
        etapa: 'Error en el procesamiento',
        mensaje_error:
          error instanceof Error ? error.message : String(error),
      })
      .catch(() => undefined)
    throw error
  } finally {
    await rm(original, { force: true }).catch(() => undefined)
  }
}

/* ------------------------------------------------------------------ */
/* Importación desde URL                                               */
/* ------------------------------------------------------------------ */

/**
 * Descarga el vídeo de una URL externa, lo guarda en el almacén de medios
 * y lanza el mismo pipeline que se usa con un fichero subido.
 */
async function procesarImportacion(
  job: Job,
  sesion: SessionPayload,
  opciones: OpcionesJob,
): Promise<void> {
  const repo = await repoDeSesion(sesion)
  const proyecto = await repo.obtenerProyecto(job.objetivoId)
  if (!proyecto) throw new Error('Proyecto no encontrado')

  const url = job.datos?.url
  if (!url) throw new Error('El trabajo no tiene ninguna URL de origen.')

  const trabajo = directorioTrabajo()
  await mkdir(trabajo, { recursive: true })
  const destino = join(trabajo, `import_${proyecto.id}.mp4`)

  try {
    await repo.actualizarProyecto(proyecto.id, {
      estado: 'procesando',
      progreso: 2,
      etapa: 'Descargando vídeo desde el enlace',
      mensaje_error: null,
    })
    actualizarJob(job.id, { etapa: 'Descargando vídeo desde el enlace', progreso: 2 })

    const { descargarVideo, existeFichero } = await import('./descarga')
    const metadatos = await descargarVideo(url, destino, (porcentaje) => {
      actualizarJob(job.id, {
        progreso: Math.max(3, Math.round(porcentaje * 0.25)),
        etapa: `Descargando vídeo desde el enlace · ${Math.round(porcentaje)}%`,
      })
    })

    if (!(await existeFichero(destino))) {
      throw new Error('El enlace no ha producido ningún vídeo descargable.')
    }

    // Si el vídeo original trae título, lo usamos como título del proyecto.
    const titulo = metadatos.titulo?.trim()
    if (titulo) {
      await repo.actualizarProyecto(proyecto.id, { titulo: titulo.slice(0, 140) })
    }

    const { guardarMedio } = await import('../media')
    const urlGuardada = await guardarMedio(
      `uploads/${sesion.uid}/${proyecto.id}-import.mp4`,
      await readFile(destino),
      'video/mp4',
    )
    await repo.actualizarProyecto(proyecto.id, {
      url_video_original: urlGuardada,
      duracion_seg: metadatos.duracion,
      progreso: 26,
      etapa: 'Vídeo descargado, analizando',
    })

    // A partir de aquí el trabajo es idéntico al de un vídeo subido.
    const trabajoProyecto: Job = { ...job, tipo: 'proyecto' }
    await procesarProyecto(trabajoProyecto, sesion, opciones)
  } catch (error) {
    await repo
      .actualizarProyecto(proyecto.id, {
        estado: 'procesando',
        progreso: 0,
        etapa: 'Error en la importación',
        mensaje_error:
          error instanceof Error ? error.message : String(error),
      })
      .catch(() => undefined)
    throw error
  } finally {
    await rm(destino, { force: true }).catch(() => undefined)
  }
}

async function procesarClip(
  job: Job,
  sesion: SessionPayload,
  opciones: OpcionesJob,
): Promise<void> {  const repo = await repoDeSesion(sesion)
  const clip = await repo.obtenerClip(job.objetivoId)
  if (!clip) throw new Error('Clip no encontrado')
  const proyecto = await repo.obtenerProyecto(clip.proyecto_id)
  if (!proyecto) throw new Error('Proyecto no encontrado')

  const trabajo = directorioTrabajo()
  await mkdir(trabajo, { recursive: true })
  const original = join(trabajo, `original_${proyecto.id}.mp4`)

  try {
    actualizarJob(job.id, { etapa: 'Recuperando vídeo original', progreso: 10 })
    await descargarOriginal(proyecto.url_video_original, original)

    actualizarJob(job.id, { etapa: 'Analizando silencios', progreso: 25 })
    const analisis = await analizarVideo(original, {
      duracionClip: opciones.duracionClip,
      maximoClips: 1,
      minimoSeparacion: 0,
    })

    const duracion = clip.fin_seg - clip.inicio_seg
    const render = join(trabajo, `clip_${clip.id}.mp4`)
    const claveRender = `renders/${proyecto.id}/${clip.formato.replace(':', 'x')}-${Math.round(clip.inicio_seg)}-${Date.now()}.mp4`

    actualizarJob(job.id, {
      etapa: 'Renderizando con las opciones del editor',
      progreso: 45,
    })

    const contenido = await repo.obtenerContenidoViral(clip.id)
    const transcripcion = opciones.subtitulos ? await transcribir(original) : null
    const musicaBase = opciones.musica ? await obtenerMusicaBase() : null

    await renderizarClip(original, {
      formato: clip.formato,
      subtitulos: opciones.subtitulos,
      eliminarSilencios: opciones.eliminarSilencios,
      musica: opciones.musica,
      silencios: analisis.silencios,
      inicio: clip.inicio_seg,
      fin: clip.fin_seg,
      duracion,
      gancho: contenido?.gancho,
      transcripcion: transcripcion?.segmentos,
      musicaBase,
      destino: render,
    })

    const urlRender = await guardarMedio(
      claveRender,
      await readFile(render),
      'video/mp4',
    )

    await repo.actualizarClip(clip.id, {
      url_render: urlRender,
      subtitulos: opciones.subtitulos,
      eliminar_silencios: opciones.eliminarSilencios,
      musica: opciones.musica,
    })

    actualizarJob(job.id, { etapa: 'Regenerando portadas', progreso: 70 })
    await generarPortadasDeClip(repo, clip.id, {
      entrada: original,
      inicio: clip.inicio_seg,
      fin: clip.fin_seg,
      formato: clip.formato,
      tituloVisual: contenido?.titulo ?? proyecto.titulo,
      destinoBase: join(trabajo, `portada_${clip.id}`),
      eliminarFondo: true,
    })

    if (contenido) {
      await repo.guardarContenidoViral({
        clip_id: clip.id,
        gancho: contenido.gancho,
        titulo: contenido.titulo,
        descripcion: contenido.descripcion,
        hashtags: contenido.hashtags,
        puntuacion: contenido.puntuacion,
        fragmentos: contenido.fragmentos,
      })
    }

    actualizarJob(job.id, { etapa: 'Listo', progreso: 100 })
  } finally {
    await rm(original, { force: true }).catch(() => undefined)
  }
}

/* ------------------------------------------------------------------ */
/* Portadas                                                             */
/* ------------------------------------------------------------------ */

export async function generarPortadasDeClip(
  repo: Awaited<ReturnType<typeof repoDeSesion>>,
  clipId: string,
  params: {
    entrada: string
    inicio: number
    fin: number
    formato: Formato
    tituloVisual: string
    destinoBase: string
    eliminarFondo?: boolean
  },
): Promise<void> {
  const resolucion = RESOLUCIONES[params.formato]
  const variantes = await generarPortadas({
    entrada: params.entrada,
    inicio: params.inicio,
    fin: params.fin,
    resolucion,
    tituloVisual: params.tituloVisual,
    eliminarFondo: params.eliminarFondo ?? false,
    destinoBase: params.destinoBase,
  })

  await repo.borrarPortadas(clipId)
  for (const variante of variantes) {
    const clave = `portadas/${clipId}/v${variante.version}.jpg`
    const url = await guardarMedio(
      clave,
      await readFile(variante.ruta),
      'image/jpeg',
    )
    await repo.crearPortada({
      clip_id: clipId,
      url_imagen: url,
      titulo_visual: variante.tituloVisual,
      version: variante.version,
      fondo_eliminado: variante.fondoEliminado,
    })
  }
}

function normalizarFormatos(formatos: Formato[]): Formato[] {
  const unicos = [...new Set(formatos)]
  return unicos.length ? unicos : ['9:16']
}

export type { MomentoDestacado }
