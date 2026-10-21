/**
 * Tipos de dominio. Reflejan el esquema SQL en supabase/migrations.
 */

export type EstadoProyecto = 'procesando' | 'listo' | 'publicado'
export type FormatoClip = '9:16' | '16:9'
export type Plataforma = 'youtube' | 'shorts' | 'tiktok'
export type EstadoPublicacion = 'programada' | 'publicada' | 'error'

export interface Usuario {
  id: string
  email: string
  nombre: string
  fecha_creacion: string
}

export interface Proyecto {
  id: string
  usuario_id: string
  titulo: string
  url_video_original: string
  duracion_seg: number
  estado: EstadoProyecto
  fecha_creacion: string
  /** Progreso 0-100 del pipeline en segundo plano */
  progreso: number
  /** Etapa legible del pipeline ("Analizando audio", "Renderizando clips"…) */
  etapa: string | null
  mensaje_error: string | null
}

export interface OpcionesClip {
  subtitulos: boolean
  eliminar_silencios: boolean
  musica: boolean
}

export interface Clip {
  id: string
  proyecto_id: string
  inicio_seg: number
  fin_seg: number
  formato: FormatoClip
  url_render: string
  subtitulos: boolean
  puntuacion_viral: number
  eliminar_silencios: boolean
  musica: boolean
  /** Render "virgen" sin subtítulos/música: permite previsualizar el original */
  url_render_virgen: string | null
  titulo: string
  fecha_creacion: string
}

export interface Portada {
  id: string
  clip_id: string
  url_imagen: string
  titulo_visual: string
  version: number
  fondo_eliminado: boolean
  fecha_creacion: string
}

export interface FragmentoRecomendado {
  inicio_seg: number
  fin_seg: number
  motivo: string
  puntuacion: number
}

export interface ContenidoViral {
  id: string
  clip_id: string
  gancho: string
  titulo: string
  descripcion: string
  hashtags: string[]
  puntuacion: number
  fragmentos: FragmentoRecomendado[]
}

export interface Publicacion {
  id: string
  clip_id: string
  plataforma: Plataforma
  fecha_programada: string | null
  estado: EstadoPublicacion
  id_externo: string | null
  url_publicacion: string | null
  error: string | null
  fecha_creacion: string
}

/** Credenciales OAuth por usuario. Los tokens se guardan cifrados. */
export interface Credenciales {
  usuario_id: string
  token_youtube: string | null
  token_tiktok: string | null
  refresh_youtube: string | null
  refresh_tiktok: string | null
  canal_youtube: string | null
  cuenta_tiktok: string | null
  youtube_expira: number | null
  tiktok_expira: number | null
}

export interface CredencialesPlanas extends Omit<Credenciales, 'usuario_id'> {
  usuario_id: string
}

/** Señal devuelta al cliente: nunca incluye los tokens en claro. */
export interface EstadoConexion {
  youtube: boolean
  tiktok: boolean
  canal_youtube: string | null
  cuenta_tiktok: string | null
}

export const PLATAFORMAS: {
  id: Plataforma
  nombre: string
  color: string
  descripcion: string
}[] = [
  {
    id: 'youtube',
    nombre: 'YouTube',
    color: '#ff0033',
    descripcion: 'Vídeo largo horizontal (16:9)',
  },
  {
    id: 'shorts',
    nombre: 'YouTube Shorts',
    color: '#ff4e45',
    descripcion: 'Vertical ≤ 60 s con #Shorts',
  },
  {
    id: 'tiktok',
    nombre: 'TikTok',
    color: '#25f4ee',
    descripcion: 'Vertical ≤ 10 min',
  },
]

export const ESTADOS_PROYECTO: Record<
  EstadoProyecto,
  { etiqueta: string; clase: string }
> = {
  procesando: {
    etiqueta: 'Procesando',
    clase: 'bg-amber-400/10 text-amber-300 border-amber-400/25',
  },
  listo: {
    etiqueta: 'Listo',
    clase: 'bg-lime-400/10 text-lime-300 border-lime-400/25',
  },
  publicado: {
    etiqueta: 'Publicado',
    clase: 'bg-brand-500/10 text-brand-300 border-brand-500/25',
  },
}

export const ESTADOS_PUBLICACION: Record<
  EstadoPublicacion,
  { etiqueta: string; clase: string }
> = {
  programada: {
    etiqueta: 'Programada',
    clase: 'bg-cyan-400/10 text-cyan-300 border-cyan-400/25',
  },
  publicada: {
    etiqueta: 'Publicada',
    clase: 'bg-lime-400/10 text-lime-300 border-lime-400/25',
  },
  error: {
    etiqueta: 'Error',
    clase: 'bg-rose-500/10 text-rose-300 border-rose-500/25',
  },
}
