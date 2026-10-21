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

/**
 * Contrato de persistencia. Dos implementaciones:
 *  - `supabase.ts` → Supabase (Postgres + Storage + RLS)
 *  - `local.ts`    → almacén local en disco (modo demo / sin credenciales)
 */
export interface Repo {
  readonly backend: 'supabase' | 'local'

  /* Usuarios */
  crearUsuario(input: {
    email: string
    nombre: string
    passwordHash: string
  }): Promise<Usuario>
  buscarUsuarioPorEmail(email: string): Promise<(Usuario & { password_hash: string }) | null>
  buscarUsuarioPorId(id: string): Promise<Usuario | null>
  actualizarUsuario(id: string, patch: Partial<Pick<Usuario, 'nombre'>>): Promise<Usuario>

  /* Proyectos */
  listarProyectos(usuarioId: string): Promise<Proyecto[]>
  crearProyecto(input: {
    usuario_id: string
    titulo: string
    url_video_original: string
    duracion_seg: number
    estado: EstadoProyecto
  }): Promise<Proyecto>
  obtenerProyecto(id: string): Promise<Proyecto | null>
  actualizarProyecto(
    id: string,
    patch: Partial<
      Pick<
        Proyecto,
        'titulo' | 'estado' | 'duracion_seg' | 'progreso' | 'etapa' | 'mensaje_error'
      >
    >,
  ): Promise<Proyecto>
  borrarProyecto(id: string): Promise<void>

  /* Clips */
  listarClips(proyectoId: string): Promise<Clip[]>
  obtenerClip(id: string): Promise<Clip | null>
  crearClip(input: {
    proyecto_id: string
    inicio_seg: number
    fin_seg: number
    formato: FormatoClip
    url_render: string
    subtitulos: boolean
    eliminar_silencios: boolean
    musica: boolean
    puntuacion_viral: number
    titulo: string
  }): Promise<Clip>
  actualizarClip(
    id: string,
    patch: Partial<
      Pick<
        Clip,
        | 'inicio_seg'
        | 'fin_seg'
        | 'formato'
        | 'url_render'
        | 'url_render_virgen'
        | 'subtitulos'
        | 'eliminar_silencios'
        | 'musica'
        | 'puntuacion_viral'
        | 'titulo'
      >
    >,
  ): Promise<Clip>
  borrarClips(proyectoId: string): Promise<void>

  /* Portadas */
  listarPortadas(clipId: string): Promise<Portada[]>
  obtenerPortada(portadaId: string): Promise<Portada | null>
  crearPortada(input: {
    clip_id: string
    url_imagen: string
    titulo_visual: string
    version: number
    fondo_eliminado: boolean
  }): Promise<Portada>
  actualizarPortada(
    id: string,
    patch: Partial<Pick<Portada, 'url_imagen' | 'titulo_visual' | 'fondo_eliminado'>>,
  ): Promise<Portada>
  borrarPortadas(clipId: string): Promise<void>

  /* Contenido viral */
  obtenerContenidoViral(clipId: string): Promise<ContenidoViral | null>
  guardarContenidoViral(input: {
    clip_id: string
    gancho: string
    titulo: string
    descripcion: string
    hashtags: string[]
    puntuacion: number
    fragmentos: ContenidoViral['fragmentos']
  }): Promise<ContenidoViral>

  /* Publicaciones */
  listarPublicaciones(clipId: string): Promise<Publicacion[]>
  listarPublicacionesPorUsuario(usuarioId: string): Promise<Publicacion[]>
  crearPublicacion(input: {
    clip_id: string
    plataforma: Plataforma
    fecha_programada: string | null
    estado: Publicacion['estado']
  }): Promise<Publicacion>
  actualizarPublicacion(
    id: string,
    patch: Partial<
      Pick<
        Publicacion,
        | 'fecha_programada'
        | 'estado'
        | 'id_externo'
        | 'url_publicacion'
        | 'error'
      >
    >,
  ): Promise<Publicacion>

  /* Credenciales de plataforma (tokens cifrados) */
  obtenerCredenciales(usuarioId: string): Promise<Credenciales | null>
  guardarCredenciales(usuarioId: string, patch: Partial<Credenciales>): Promise<Credenciales>
}
