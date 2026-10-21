import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomId } from '../crypto'
import { env } from '../env'
import type { Repo } from './repo'
import type {
  Clip,
  ContenidoViral,
  Credenciales,
  EstadoProyecto,
  FormatoClip,
  Plataforma,
  Portada,
  Proyecto,
  Publicacion,
  Usuario,
} from './types'

/* ------------------------------------------------------------------ */
/* Almacén en disco                                                    */
/* ------------------------------------------------------------------ */

interface UserRecord extends Usuario {
  password_hash: string
}

interface Database {
  usuarios: UserRecord[]
  proyectos: Proyecto[]
  clips: Clip[]
  portadas: Portada[]
  contenido_viral: ContenidoViral[]
  publicaciones: Publicacion[]
  credenciales: Credenciales[]
}

const DATA_DIR = join(env.storageDir, 'data')
const DATA_FILE = join(DATA_DIR, 'viralai.json')

const EMPTY: Database = {
  usuarios: [],
  proyectos: [],
  clips: [],
  portadas: [],
  contenido_viral: [],
  publicaciones: [],
  credenciales: [],
}

let cache: Database | null = null
let writeChain: Promise<unknown> = Promise.resolve()

async function load(): Promise<Database> {
  if (cache) return cache
  try {
    const raw = await readFile(DATA_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<Database>
    cache = { ...EMPTY, ...parsed }
  } catch {
    cache = structuredClone(EMPTY)
  }
  return cache
}

async function persist(): Promise<void> {
  const snapshot = JSON.stringify(cache, null, 2)
  writeChain = writeChain.then(async () => {
    await mkdir(dirname(DATA_FILE), { recursive: true })
    const tmp = `${DATA_FILE}.tmp`
    await writeFile(tmp, snapshot, 'utf8')
    await rename(tmp, DATA_FILE)
  })
  await writeChain
}

const now = () => new Date().toISOString()

/* ------------------------------------------------------------------ */
/* Repositorio local                                                   */
/* ------------------------------------------------------------------ */

export function crearRepoLocal(): Repo {
  return {
    backend: 'local',

    /* Usuarios */
    async crearUsuario(input) {
      const db = await load()
      const usuario: UserRecord = {
        id: randomId('usr'),
        email: input.email.toLowerCase().trim(),
        nombre: input.nombre.trim(),
        fecha_creacion: now(),
        password_hash: input.passwordHash,
      }
      db.usuarios.push(usuario)
      await persist()
      const { password_hash, ...rest } = usuario
      void password_hash
      return rest
    },

    async buscarUsuarioPorEmail(email) {
      const db = await load()
      return (
        db.usuarios.find((u) => u.email === email.toLowerCase().trim()) ?? null
      )
    },

    async buscarUsuarioPorId(id) {
      const db = await load()
      const found = db.usuarios.find((u) => u.id === id)
      if (!found) return null
      const { password_hash, ...rest } = found
      void password_hash
      return rest
    },

    async actualizarUsuario(id, patch) {
      const db = await load()
      const found = db.usuarios.find((u) => u.id === id)
      if (!found) throw new Error('Usuario no encontrado')
      if (patch.nombre !== undefined) found.nombre = patch.nombre.trim()
      await persist()
      const { password_hash, ...rest } = found
      void password_hash
      return rest
    },

    /* Proyectos */
    async listarProyectos(usuarioId) {
      const db = await load()
      return db.proyectos
        .filter((p) => p.usuario_id === usuarioId)
        .sort((a, b) => b.fecha_creacion.localeCompare(a.fecha_creacion))
    },

    async crearProyecto(input) {
      const db = await load()
      const proyecto: Proyecto = {
        id: randomId('prj'),
        usuario_id: input.usuario_id,
        titulo: input.titulo.trim(),
        url_video_original: input.url_video_original,
        duracion_seg: input.duracion_seg,
        estado: input.estado,
        fecha_creacion: now(),
        progreso: 0,
        etapa: null,
        mensaje_error: null,
      }
      db.proyectos.push(proyecto)
      await persist()
      return proyecto
    },

    async obtenerProyecto(id) {
      const db = await load()
      return db.proyectos.find((p) => p.id === id) ?? null
    },

    async actualizarProyecto(id, patch) {
      const db = await load()
      const found = db.proyectos.find((p) => p.id === id)
      if (!found) throw new Error('Proyecto no encontrado')
      Object.assign(found, patch)
      await persist()
      return found
    },

    async borrarProyecto(id) {
      const db = await load()
      await this.borrarClips(id)
      db.proyectos = db.proyectos.filter((p) => p.id !== id)
      await persist()
    },

    /* Clips */
    async listarClips(proyectoId) {
      const db = await load()
      return db.clips
        .filter((c) => c.proyecto_id === proyectoId)
        .sort((a, b) => a.inicio_seg - b.inicio_seg)
    },

    async obtenerClip(id) {
      const db = await load()
      return db.clips.find((c) => c.id === id) ?? null
    },

    async crearClip(input) {
      const db = await load()
      const clip: Clip = {
        id: randomId('clp'),
        proyecto_id: input.proyecto_id,
        inicio_seg: input.inicio_seg,
        fin_seg: input.fin_seg,
        formato: input.formato,
        url_render: input.url_render,
        subtitulos: input.subtitulos,
        eliminar_silencios: input.eliminar_silencios,
        musica: input.musica,
        puntuacion_viral: input.puntuacion_viral,
        titulo: input.titulo,
        url_render_virgen: null,
        fecha_creacion: now(),
      }
      db.clips.push(clip)
      await persist()
      return clip
    },

    async actualizarClip(id, patch) {
      const db = await load()
      const found = db.clips.find((c) => c.id === id)
      if (!found) throw new Error('Clip no encontrado')
      Object.assign(found, patch)
      await persist()
      return found
    },

    async borrarClips(proyectoId) {
      const db = await load()
      const clipIds = new Set(
        db.clips.filter((c) => c.proyecto_id === proyectoId).map((c) => c.id),
      )
      db.clips = db.clips.filter((c) => c.proyecto_id !== proyectoId)
      db.portadas = db.portadas.filter((p) => !clipIds.has(p.clip_id))
      db.contenido_viral = db.contenido_viral.filter((c) => !clipIds.has(c.clip_id))
      db.publicaciones = db.publicaciones.filter((p) => !clipIds.has(p.clip_id))
      await persist()
    },

    /* Portadas */
    async listarPortadas(clipId) {
      const db = await load()
      return db.portadas
        .filter((p) => p.clip_id === clipId)
        .sort((a, b) => a.version - b.version)
    },

    async obtenerPortada(portadaId) {
      const db = await load()
      return db.portadas.find((p) => p.id === portadaId) ?? null
    },

    async crearPortada(input) {
      const db = await load()
      const portada: Portada = {
        id: randomId('por'),
        clip_id: input.clip_id,
        url_imagen: input.url_imagen,
        titulo_visual: input.titulo_visual,
        version: input.version,
        fondo_eliminado: input.fondo_eliminado,
        fecha_creacion: now(),
      }
      db.portadas.push(portada)
      await persist()
      return portada
    },

    async actualizarPortada(id, patch) {
      const db = await load()
      const found = db.portadas.find((p) => p.id === id)
      if (!found) throw new Error('Portada no encontrada')
      Object.assign(found, patch)
      await persist()
      return found
    },

    async borrarPortadas(clipId) {
      const db = await load()
      db.portadas = db.portadas.filter((p) => p.clip_id !== clipId)
      await persist()
    },

    /* Contenido viral */
    async obtenerContenidoViral(clipId) {
      const db = await load()
      return db.contenido_viral.find((c) => c.clip_id === clipId) ?? null
    },

    async guardarContenidoViral(input) {
      const db = await load()
      const existing = db.contenido_viral.find((c) => c.clip_id === input.clip_id)
      const contenido: ContenidoViral = {
        id: existing?.id ?? randomId('vir'),
        clip_id: input.clip_id,
        gancho: input.gancho,
        titulo: input.titulo,
        descripcion: input.descripcion,
        hashtags: input.hashtags,
        puntuacion: input.puntuacion,
        fragmentos: input.fragmentos ?? [],
      }
      if (existing) Object.assign(existing, contenido)
      else db.contenido_viral.push(contenido)
      await persist()
      return contenido
    },

    /* Publicaciones */
    async listarPublicaciones(clipId) {
      const db = await load()
      return db.publicaciones
        .filter((p) => p.clip_id === clipId)
        .sort((a, b) => b.fecha_creacion.localeCompare(a.fecha_creacion))
    },

    async listarPublicacionesPorUsuario(usuarioId) {
      const db = await load()
      const proyectosUsuario = new Set(
        db.proyectos.filter((p) => p.usuario_id === usuarioId).map((p) => p.id),
      )
      const clipIds = new Set(
        db.clips.filter((c) => proyectosUsuario.has(c.proyecto_id)).map((c) => c.id),
      )
      return db.publicaciones
        .filter((p) => clipIds.has(p.clip_id))
        .sort((a, b) => b.fecha_creacion.localeCompare(a.fecha_creacion))
    },

    async crearPublicacion(input) {
      const db = await load()
      const publicacion: Publicacion = {
        id: randomId('pub'),
        clip_id: input.clip_id,
        plataforma: input.plataforma,
        fecha_programada: input.fecha_programada,
        estado: input.estado,
        id_externo: null,
        url_publicacion: null,
        error: null,
        fecha_creacion: now(),
      }
      db.publicaciones.push(publicacion)
      await persist()
      return publicacion
    },

    async actualizarPublicacion(id, patch) {
      const db = await load()
      const found = db.publicaciones.find((p) => p.id === id)
      if (!found) throw new Error('Publicación no encontrada')
      Object.assign(found, patch)
      await persist()
      return found
    },

    /* Credenciales */
    async obtenerCredenciales(usuarioId) {
      const db = await load()
      return db.credenciales.find((c) => c.usuario_id === usuarioId) ?? null
    },

    async guardarCredenciales(usuarioId, patch) {
      const db = await load()
      let found = db.credenciales.find((c) => c.usuario_id === usuarioId)
      if (!found) {
        found = {
          usuario_id: usuarioId,
          token_youtube: null,
          token_tiktok: null,
          refresh_youtube: null,
          refresh_tiktok: null,
          canal_youtube: null,
          cuenta_tiktok: null,
          youtube_expira: null,
          tiktok_expira: null,
        }
        db.credenciales.push(found)
      }
      Object.assign(found, patch)
      await persist()
      return found
    },
  }
}

export type { EstadoProyecto, FormatoClip, Plataforma }

/**
 * Listado global de publicaciones programadas (lo usa el planificador).
 * El repositorio local no tiene RLS, así que el filtro por usuario se
 * aplica en el llamador.
 */
export async function listarPublicacionesPendientes(): Promise<Publicacion[]> {
  const db = await load()
  return db.publicaciones.filter((p) => p.estado === 'programada')
}
