import { createClient, type SupabaseClient } from '@supabase/supabase-js'
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

export const BUCKET_MEDIOS = 'medios'

export function crearClienteSupabase(accessToken?: string): SupabaseClient {
  return createClient(env.supabase.url, env.supabase.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : undefined,
  })
}

type Row<T> = Record<string, unknown> & T

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function bool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : []
}

function obj(v: unknown): ContenidoViral['fragmentos'] {
  return Array.isArray(v) ? (v as ContenidoViral['fragmentos']) : []
}

function toUsuario(r: Row<Record<string, unknown>>): Usuario {
  return {
    id: str(r.id),
    email: str(r.email),
    nombre: str(r.nombre),
    fecha_creacion: str(r.fecha_creacion ?? r.created_at),
  }
}

function toProyecto(r: Row<Record<string, unknown>>): Proyecto {
  return {
    id: str(r.id),
    usuario_id: str(r.usuario_id),
    titulo: str(r.titulo),
    url_video_original: str(r.url_video_original),
    duracion_seg: num(r.duracion_seg),
    estado: (str(r.estado, 'procesando') as EstadoProyecto),
    fecha_creacion: str(r.fecha_creacion ?? r.created_at),
    progreso: num(r.progreso),
    etapa: r.etapa ? str(r.etapa) : null,
    mensaje_error: r.mensaje_error ? str(r.mensaje_error) : null,
  }
}

function toClip(r: Row<Record<string, unknown>>): Clip {
  return {
    id: str(r.id),
    proyecto_id: str(r.proyecto_id),
    inicio_seg: num(r.inicio_seg),
    fin_seg: num(r.fin_seg),
    formato: str(r.formato, '9:16') as FormatoClip,
    url_render: str(r.url_render),
    subtitulos: bool(r.subtitulos),
    puntuacion_viral: num(r.puntuacion_viral),
    eliminar_silencios: bool(r.eliminar_silencios),
    musica: bool(r.musica),
    url_render_virgen: r.url_render_virgen ? str(r.url_render_virgen) : null,
    titulo: str(r.titulo),
    fecha_creacion: str(r.fecha_creacion ?? r.created_at),
  }
}

function toPortada(r: Row<Record<string, unknown>>): Portada {
  return {
    id: str(r.id),
    clip_id: str(r.clip_id),
    url_imagen: str(r.url_imagen),
    titulo_visual: str(r.titulo_visual),
    version: num(r.version, 1),
    fondo_eliminado: bool(r.fondo_eliminado),
    fecha_creacion: str(r.fecha_creacion ?? r.created_at),
  }
}

function toContenido(r: Row<Record<string, unknown>>): ContenidoViral {
  return {
    id: str(r.id),
    clip_id: str(r.clip_id),
    gancho: str(r.gancho),
    titulo: str(r.titulo),
    descripcion: str(r.descripcion),
    hashtags: arr(r.hashtags),
    puntuacion: num(r.puntuacion),
    fragmentos: obj(r.fragmentos),
  }
}

function toPublicacion(r: Row<Record<string, unknown>>): Publicacion {
  return {
    id: str(r.id),
    clip_id: str(r.clip_id),
    plataforma: str(r.plataforma, 'youtube') as Plataforma,
    fecha_programada: r.fecha_programada ? str(r.fecha_programada) : null,
    estado: str(r.estado, 'programada') as Publicacion['estado'],
    id_externo: r.id_externo ? str(r.id_externo) : null,
    url_publicacion: r.url_publicacion ? str(r.url_publicacion) : null,
    error: r.error ? str(r.error) : null,
    fecha_creacion: str(r.fecha_creacion ?? r.created_at),
  }
}

function toCredenciales(r: Row<Record<string, unknown>>): Credenciales {
  return {
    usuario_id: str(r.usuario_id),
    token_youtube: r.token_youtube ? str(r.token_youtube) : null,
    token_tiktok: r.token_tiktok ? str(r.token_tiktok) : null,
    refresh_youtube: r.refresh_youtube ? str(r.refresh_youtube) : null,
    refresh_tiktok: r.refresh_tiktok ? str(r.refresh_tiktok) : null,
    canal_youtube: r.canal_youtube ? str(r.canal_youtube) : null,
    cuenta_tiktok: r.cuenta_tiktok ? str(r.cuenta_tiktok) : null,
    youtube_expira: r.youtube_expira ? num(r.youtube_expira) : null,
    tiktok_expira: r.tiktok_expira ? num(r.tiktok_expira) : null,
  }
}

function fail(context: string, error: { message: string } | null): never {
  throw new Error(`${context}: ${error?.message ?? 'error desconocido'}`)
}

/* ------------------------------------------------------------------ */
/* Consultas administrativas (planificador)                             */
/* ------------------------------------------------------------------ */

/**
 * Publicaciones programadas cuya hora ya ha pasado, en cualquier tenant.
 * Usa una función `security definer` porque el planificador corre con la
 * clave de servicio y debe atravesar las políticas RLS.
 */
export async function listarPublicacionesProgramadasVencidas(
  ahora: string,
): Promise<Publicacion[]> {
  const client = crearClienteSupabase(
    env.supabase.serviceRoleKey || env.supabase.anonKey,
  )
  const { data, error } = await client.rpc('publicaciones_vencidas', {
    p_hora: ahora,
  })
  if (error) {
    throw new Error(`No se pudieron listar las publicaciones: ${error.message}`)
  }
  return ((data ?? []) as Row<Record<string, unknown>>[]).map((r) =>
    toPublicacion(r),
  )
}

/**
 * Repositorio Supabase. El cliente se crea con el JWT del usuario, de modo que
 * las políticas RLS de Postgres son la barrera de aislamiento entre tenants.
 * Si se pasa la clave de servicio (service role) en lugar de un JWT de
 * usuario, se obtienen permisos administrativos (lo usa el planificador).
 */
export function crearRepoSupabase(accessToken?: string): Repo {
  const token = accessToken || env.supabase.serviceRoleKey || env.supabase.anonKey
  const db = crearClienteSupabase(token)

  return {
    backend: 'supabase',

    /* Usuarios */
    async crearUsuario(input) {
      const { data, error } = await db
        .from('usuarios')
        .insert({
          email: input.email,
          nombre: input.nombre,
          password_hash: input.passwordHash,
        })
        .select()
        .single()
      if (error) fail('No se pudo crear el usuario', error)
      return toUsuario(data as Row<Record<string, unknown>>)
    },

    async buscarUsuarioPorEmail(email) {
      const { data, error } = await db
        .from('usuarios')
        .select('*')
        .eq('email', email.toLowerCase().trim())
        .maybeSingle()
      if (error) fail('No se pudo buscar el usuario', error)
      if (!data) return null
      const r = data as Row<Record<string, unknown>>
      return { ...toUsuario(r), password_hash: str(r.password_hash) }
    },

    async buscarUsuarioPorId(id) {
      const { data, error } = await db
        .from('usuarios')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) fail('No se pudo buscar el usuario', error)
      if (!data) return null
      return toUsuario(data as Row<Record<string, unknown>>)
    },

    async actualizarUsuario(id, patch) {
      const { data, error } = await db
        .from('usuarios')
        .update({ nombre: patch.nombre })
        .eq('id', id)
        .select()
        .single()
      if (error) fail('No se pudo actualizar el usuario', error)
      return toUsuario(data as Row<Record<string, unknown>>)
    },

    /* Proyectos */
    async listarProyectos(usuarioId) {
      const { data, error } = await db
        .from('proyectos')
        .select('*')
        .eq('usuario_id', usuarioId)
        .order('fecha_creacion', { ascending: false })
      if (error) fail('No se pudieron listar los proyectos', error)
      return (data ?? []).map((r) => toProyecto(r as Row<Record<string, unknown>>))
    },

    async crearProyecto(input) {
      const { data, error } = await db
        .from('proyectos')
        .insert({
          usuario_id: input.usuario_id,
          titulo: input.titulo,
          url_video_original: input.url_video_original,
          duracion_seg: input.duracion_seg,
          estado: input.estado,
        })
        .select()
        .single()
      if (error) fail('No se pudo crear el proyecto', error)
      return toProyecto(data as Row<Record<string, unknown>>)
    },

    async obtenerProyecto(id) {
      const { data, error } = await db
        .from('proyectos')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) fail('No se pudo obtener el proyecto', error)
      if (!data) return null
      return toProyecto(data as Row<Record<string, unknown>>)
    },

    async actualizarProyecto(id, patch) {
      const { data, error } = await db
        .from('proyectos')
        .update(patch)
        .eq('id', id)
        .select()
        .single()
      if (error) fail('No se pudo actualizar el proyecto', error)
      return toProyecto(data as Row<Record<string, unknown>>)
    },

    async borrarProyecto(id) {
      const { error } = await db.from('proyectos').delete().eq('id', id)
      if (error) fail('No se pudo eliminar el proyecto', error)
    },

    /* Clips */
    async listarClips(proyectoId) {
      const { data, error } = await db
        .from('clips')
        .select('*')
        .eq('proyecto_id', proyectoId)
        .order('inicio_seg', { ascending: true })
      if (error) fail('No se pudieron listar los clips', error)
      return (data ?? []).map((r) => toClip(r as Row<Record<string, unknown>>))
    },

    async obtenerClip(id) {
      const { data, error } = await db
        .from('clips')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) fail('No se pudo obtener el clip', error)
      if (!data) return null
      return toClip(data as Row<Record<string, unknown>>)
    },

    async crearClip(input) {
      const { data, error } = await db
        .from('clips')
        .insert(input)
        .select()
        .single()
      if (error) fail('No se pudo crear el clip', error)
      return toClip(data as Row<Record<string, unknown>>)
    },

    async actualizarClip(id, patch) {
      const { data, error } = await db
        .from('clips')
        .update(patch)
        .eq('id', id)
        .select()
        .single()
      if (error) fail('No se pudo actualizar el clip', error)
      return toClip(data as Row<Record<string, unknown>>)
    },

    async borrarClips(proyectoId) {
      const { error } = await db.from('clips').delete().eq('proyecto_id', proyectoId)
      if (error) fail('No se pudieron borrar los clips', error)
    },

    /* Portadas */
    async listarPortadas(clipId) {
      const { data, error } = await db
        .from('portadas')
        .select('*')
        .eq('clip_id', clipId)
        .order('version', { ascending: true })
      if (error) fail('No se pudieron listar las portadas', error)
      return (data ?? []).map((r) => toPortada(r as Row<Record<string, unknown>>))
    },

    async obtenerPortada(portadaId) {
      const { data, error } = await db
        .from('portadas')
        .select('*')
        .eq('id', portadaId)
        .maybeSingle()
      if (error) fail('No se pudo obtener la portada', error)
      if (!data) return null
      return toPortada(data as Row<Record<string, unknown>>)
    },

    async crearPortada(input) {
      const { data, error } = await db
        .from('portadas')
        .insert(input)
        .select()
        .single()
      if (error) fail('No se pudo crear la portada', error)
      return toPortada(data as Row<Record<string, unknown>>)
    },

    async actualizarPortada(id, patch) {
      const { data, error } = await db
        .from('portadas')
        .update(patch)
        .eq('id', id)
        .select()
        .single()
      if (error) fail('No se pudo actualizar la portada', error)
      return toPortada(data as Row<Record<string, unknown>>)
    },

    async borrarPortadas(clipId) {
      const { error } = await db.from('portadas').delete().eq('clip_id', clipId)
      if (error) fail('No se pudieron borrar las portadas', error)
    },

    /* Contenido viral */
    async obtenerContenidoViral(clipId) {
      const { data, error } = await db
        .from('contenido_viral')
        .select('*')
        .eq('clip_id', clipId)
        .maybeSingle()
      if (error) fail('No se pudo obtener el contenido viral', error)
      if (!data) return null
      return toContenido(data as Row<Record<string, unknown>>)
    },

    async guardarContenidoViral(input) {
      const { data, error } = await db
        .from('contenido_viral')
        .upsert(input, { onConflict: 'clip_id' })
        .select()
        .single()
      if (error) fail('No se pudo guardar el contenido viral', error)
      return toContenido(data as Row<Record<string, unknown>>)
    },

    /* Publicaciones */
    async listarPublicaciones(clipId) {
      const { data, error } = await db
        .from('publicaciones')
        .select('*')
        .eq('clip_id', clipId)
        .order('fecha_creacion', { ascending: false })
      if (error) fail('No se pudieron listar las publicaciones', error)
      return (data ?? []).map((r) => toPublicacion(r as Row<Record<string, unknown>>))
    },

    async listarPublicacionesPorUsuario(usuarioId) {
      const { data, error } = await db.rpc('mis_publicaciones', { p_usuario: usuarioId })
      if (error) fail('No se pudieron listar las publicaciones', error)
      return ((data ?? []) as Row<Record<string, unknown>>[]).map((r) =>
        toPublicacion(r),
      )
    },

    async crearPublicacion(input) {
      const { data, error } = await db
        .from('publicaciones')
        .insert(input)
        .select()
        .single()
      if (error) fail('No se pudo crear la publicación', error)
      return toPublicacion(data as Row<Record<string, unknown>>)
    },

    async actualizarPublicacion(id, patch) {
      const { data, error } = await db
        .from('publicaciones')
        .update(patch)
        .eq('id', id)
        .select()
        .single()
      if (error) fail('No se pudo actualizar la publicación', error)
      return toPublicacion(data as Row<Record<string, unknown>>)
    },

    /* Credenciales */
    async obtenerCredenciales(usuarioId) {
      const { data, error } = await db
        .from('credenciales_plataforma')
        .select('*')
        .eq('usuario_id', usuarioId)
        .maybeSingle()
      if (error) fail('No se pudieron obtener las credenciales', error)
      if (!data) return null
      return toCredenciales(data as Row<Record<string, unknown>>)
    },

    async guardarCredenciales(usuarioId, patch) {
      const { data, error } = await db
        .from('credenciales_plataforma')
        .upsert({ usuario_id: usuarioId, ...patch }, { onConflict: 'usuario_id' })
        .select()
        .single()
      if (error) fail('No se pudieron guardar las credenciales', error)
      return toCredenciales(data as Row<Record<string, unknown>>)
    },
  }
}
