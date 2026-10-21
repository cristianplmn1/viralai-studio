import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, rm } from 'node:fs/promises'
import { decryptSecret, encryptSecret, type SessionPayload } from '../crypto'
import { repoDeSesion } from '../auth'
import { claveDeUrl, materializarMedio } from '../media'
import { env, isSupabaseConfigured } from '../env'
import type { Repo } from '../db/repo'
import type { EstadoConexion, Plataforma, Publicacion } from '../db/types'
import {
  obtenerCanalYouTube,
  refrescarTokenYouTube,
  subirAYouTube,
} from './youtube'
import {
  obtenerUsuarioTikTok,
  refrescarTokenTikTok,
  subirATikTok,
} from './tiktok'

/* ------------------------------------------------------------------ */
/* Conexiones                                                          */
/* ------------------------------------------------------------------ */

export async function estadoConexion(
  repo: Repo,
  usuarioId: string,
): Promise<EstadoConexion> {
  const credenciales = await repo.obtenerCredenciales(usuarioId)
  if (!credenciales) {
    return {
      youtube: false,
      tiktok: false,
      canal_youtube: null,
      cuenta_tiktok: null,
    }
  }
  return {
    youtube: Boolean(credenciales.token_youtube),
    tiktok: Boolean(credenciales.token_tiktok),
    canal_youtube: credenciales.canal_youtube,
    cuenta_tiktok: credenciales.cuenta_tiktok,
  }
}

export async function guardarTokenYouTube(
  repo: Repo,
  usuarioId: string,
  tokens: {
    accessToken: string
    refreshToken: string | null
    expiresAt: number | null
  },
): Promise<EstadoConexion> {
  const canal = await obtenerCanalYouTube(tokens.accessToken).catch(() => null)
  const credenciales = await repo.obtenerCredenciales(usuarioId)
  await repo.guardarCredenciales(usuarioId, {
    token_youtube: encryptSecret(tokens.accessToken),
    refresh_youtube: encryptSecret(tokens.refreshToken),
    youtube_expira: tokens.expiresAt,
    canal_youtube: canal?.titulo ?? credenciales?.canal_youtube ?? null,
  })
  return estadoConexion(repo, usuarioId)
}

export async function guardarTokenTikTok(
  repo: Repo,
  usuarioId: string,
  tokens: {
    accessToken: string
    refreshToken: string | null
    expiresAt: number | null
  },
): Promise<EstadoConexion> {
  const usuario = await obtenerUsuarioTikTok(tokens.accessToken).catch(() => null)
  const credenciales = await repo.obtenerCredenciales(usuarioId)
  await repo.guardarCredenciales(usuarioId, {
    token_tiktok: encryptSecret(tokens.accessToken),
    refresh_tiktok: encryptSecret(tokens.refreshToken),
    tiktok_expira: tokens.expiresAt,
    cuenta_tiktok: usuario?.nombre ?? credenciales?.cuenta_tiktok ?? null,
  })
  return estadoConexion(repo, usuarioId)
}

/** Devuelve un token de acceso válido, refrescándolo si ha caducado. */
async function tokenValido(
  repo: Repo,
  usuarioId: string,
  plataforma: 'youtube' | 'tiktok',
): Promise<string | null> {
  const credenciales = await repo.obtenerCredenciales(usuarioId)
  if (!credenciales) return null

  const tokenCifrado =
    plataforma === 'youtube' ? credenciales.token_youtube : credenciales.token_tiktok
  const refreshCifrado =
    plataforma === 'youtube'
      ? credenciales.refresh_youtube
      : credenciales.refresh_tiktok
  const expira =
    plataforma === 'youtube' ? credenciales.youtube_expira : credenciales.tiktok_expira

  const token = decryptSecret(tokenCifrado)
  if (!token) return null

  const caducado = expira !== null && expira !== undefined && expira < Date.now() + 60_000
  if (!caducado) return token

  const refresh = decryptSecret(refreshCifrado)
  if (!refresh) return null

  const nuevos =
    plataforma === 'youtube'
      ? await refrescarTokenYouTube(refresh).catch(() => null)
      : await refrescarTokenTikTok(refresh).catch(() => null)

  if (!nuevos) return null

  await repo.guardarCredenciales(usuarioId, {
    [plataforma === 'youtube' ? 'token_youtube' : 'token_tiktok']:
      encryptSecret(nuevos.accessToken),
    [plataforma === 'youtube' ? 'youtube_expira' : 'tiktok_expira']:
      nuevos.expiresAt,
  })

  return nuevos.accessToken
}

/* ------------------------------------------------------------------ */
/* Publicación                                                         */
/* ------------------------------------------------------------------ */

export interface ResultadoPublicar {
  publicacion: Publicacion
  mensaje: string
  modoDemo: boolean
}

export interface EntradaPublicar {
  clipId: string
  plataforma: Plataforma
  /** ISO local; si es futuro se programa */
  fechaProgramada?: string | null
}

export async function publicarClip(
  sesion: SessionPayload,
  entrada: EntradaPublicar,
): Promise<ResultadoPublicar> {
  const repo = await repoDeSesion(sesion)
  const clip = await repo.obtenerClip(entrada.clipId)
  if (!clip) throw new Error('Clip no encontrado')
  const proyecto = await repo.obtenerProyecto(clip.proyecto_id)
  if (!proyecto) throw new Error('Proyecto no encontrado')

  const contenido = await repo.obtenerContenidoViral(clip.id)
  const titulo =
    contenido?.titulo || `${proyecto.titulo} — ${entrada.plataforma}`
  const descripcion = contenido?.descripcion || ''
  const etiquetas = (contenido?.hashtags ?? []).map((h) => h.replace(/^#/, ''))

  const ahora = Date.now()
  const fecha = entrada.fechaProgramada ? new Date(entrada.fechaProgramada) : null
  const esFuturo = fecha ? fecha.getTime() > ahora + 60_000 : false

  /* --- Conexión obligatoria --- */
  const conexion = await estadoConexion(repo, sesion.uid)
  const plataformaOAuth =
    entrada.plataforma === 'tiktok' ? 'tiktok' : 'youtube'
  const conectada = plataformaOAuth === 'tiktok' ? conexion.tiktok : conexion.youtube

  const credenciales = await repo.obtenerCredenciales(sesion.uid)
  const hayToken = Boolean(
    credenciales &&
      (plataformaOAuth === 'tiktok'
        ? credenciales.token_tiktok
        : credenciales.token_youtube),
  )

  /* --- Modo demo: sin credenciales OAuth configuradas --- */
  if (!conectada && !hayToken) {
    if (!env.allowDemoPublishing) {
      throw new Error(
        `Conecta ${plataformaOAuth === 'tiktok' ? 'TikTok' : 'YouTube'} para publicar en ${entrada.plataforma}.`,
      )
    }
    const publicacion = await repo.crearPublicacion({
      clip_id: clip.id,
      plataforma: entrada.plataforma,
      fecha_programada: fecha?.toISOString() ?? null,
      estado: esFuturo ? 'programada' : 'publicada',
    })
    const actualizada = await repo.actualizarPublicacion(publicacion.id, {
      id_externo: `demo_${publicacion.id.slice(-8)}`,
      url_publicacion: null,
      error: null,
    })
    if (!esFuturo) {
      await repo.actualizarProyecto(proyecto.id, { estado: 'publicado' })
    }
    return {
      publicacion: actualizada,
      mensaje:
        'Publicación simulada (modo demo): configura las credenciales OAuth para enviar el vídeo a la plataforma real.',
      modoDemo: true,
    }
  }

  if (!conectada) {
    throw new Error(
      `Conecta ${plataformaOAuth === 'tiktok' ? 'TikTok' : 'YouTube'} para publicar en ${entrada.plataforma}.`,
    )
  }

  /* --- Token válido --- */
  const token = await tokenValido(repo, sesion.uid, plataformaOAuth)
  if (!token) {
    throw new Error(
      `El token de ${plataformaOAuth === 'tiktok' ? 'TikTok' : 'YouTube'} ha caducado. Vuelve a conectar la cuenta.`,
    )
  }

  /* --- Fichero local para subir --- */
  const clave = claveDeUrl(clip.url_render)
  if (!clave) throw new Error('El clip no tiene un render en el almacén de medios.')
  const trabajo = join(tmpdir(), 'viralai-publish')
  await mkdir(trabajo, { recursive: true })
  const archivo = join(trabajo, `${clip.id}_${entrada.plataforma}.mp4`)
  await materializarMedio(clave, archivo)

  try {
    /* --- TikTok --- */
    if (entrada.plataforma === 'tiktok') {
      if (esFuturo) {
        // TikTok no ofrece programación nativa: lo programamos nosotros
        const publicacion = await repo.crearPublicacion({
          clip_id: clip.id,
          plataforma: 'tiktok',
          fecha_programada: fecha!.toISOString(),
          estado: 'programada',
        })
        return {
          publicacion,
          mensaje: `Publicación programada en TikTok para ${fecha!.toLocaleString('es-ES')}.`,
          modoDemo: false,
        }
      }

      const resultado = await subirATikTok(token, {
        archivo,
        titulo,
        descripcion: `${descripcion}\n\n${(contenido?.hashtags ?? []).join(' ')}`.trim(),
        privacidad: 'PUBLIC_TO_EVERYONE',
      })
      const publicacion = await repo.crearPublicacion({
        clip_id: clip.id,
        plataforma: 'tiktok',
        fecha_programada: null,
        estado: 'publicada',
      })
      const actualizada = await repo.actualizarPublicacion(publicacion.id, {
        id_externo: resultado.idExterno,
        url_publicacion: resultado.url,
        error: null,
      })
      await repo.actualizarProyecto(proyecto.id, { estado: 'publicado' })
      return {
        publicacion: actualizada,
        mensaje: 'Vídeo publicado en TikTok.',
        modoDemo: false,
      }
    }

    /* --- YouTube / Shorts --- */
    const esShort = entrada.plataforma === 'shorts'
    const resultado = await subirAYouTube(token, {
      archivo,
      titulo,
      descripcion: `${descripcion}\n\n${(contenido?.hashtags ?? []).join(' ')}`.trim(),
      etiquetas,
      privacidad: 'public',
      publicarEn: esFuturo ? fecha!.toISOString() : null,
      esShort,
    })

    const publicacion = await repo.crearPublicacion({
      clip_id: clip.id,
      plataforma: entrada.plataforma,
      fecha_programada: fecha?.toISOString() ?? null,
      estado: esFuturo ? 'programada' : 'publicada',
    })
    const actualizada = await repo.actualizarPublicacion(publicacion.id, {
      id_externo: resultado.idExterno,
      url_publicacion: resultado.url,
      error: null,
    })
    if (!esFuturo) {
      await repo.actualizarProyecto(proyecto.id, { estado: 'publicado' })
    }
    return {
      publicacion: actualizada,
      mensaje: esFuturo
        ? `Vídeo programado en YouTube para ${fecha!.toLocaleString('es-ES')}.`
        : esShort
          ? 'Short publicado en YouTube.'
          : 'Vídeo publicado en YouTube.',
      modoDemo: false,
    }
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error)
    const publicacion = await repo.crearPublicacion({
      clip_id: clip.id,
      plataforma: entrada.plataforma,
      fecha_programada: fecha?.toISOString() ?? null,
      estado: 'error',
    })
    await repo.actualizarPublicacion(publicacion.id, { error: mensaje })
    throw new Error(mensaje)
  } finally {
    await rm(archivo, { force: true }).catch(() => undefined)
  }
}

/* ------------------------------------------------------------------ */
/* Planificador de publicaciones programadas                           */
/* ------------------------------------------------------------------ */

async function repoAdministrador(): Promise<Repo> {
  if (isSupabaseConfigured) {
    const { crearRepoSupabase } = await import('../db/supabase')
    return crearRepoSupabase(env.supabase.serviceRoleKey || env.supabase.anonKey)
  }
  const { crearRepoLocal } = await import('../db/local')
  return crearRepoLocal()
}

/**
 * Publica las publicaciones programadas cuya hora ya ha llegado.
 * Se ejecuta de forma periódica desde el servidor.
 */
export async function ejecutarPlanificador(): Promise<number> {
  const repo = await repoAdministrador()
  const ahora = new Date().toISOString()

  // El repositorio local no expone listado global, así que recorremos
  // proyectos y clips de forma explícita.
  const pendientes: { publicacion: Publicacion; usuarioId: string }[] = []

  if (repo.backend === 'local') {
    const { listarPublicacionesPendientes } = await import('../db/local')
    const todas = await listarPublicacionesPendientes()
    for (const publicacion of todas) {
      if (
        publicacion.estado === 'programada' &&
        publicacion.fecha_programada &&
        publicacion.fecha_programada <= ahora
      ) {
        const clip = await repo.obtenerClip(publicacion.clip_id)
        if (!clip) continue
        const proyecto = await repo.obtenerProyecto(clip.proyecto_id)
        if (!proyecto) continue
        pendientes.push({ publicacion, usuarioId: proyecto.usuario_id })
      }
    }
  } else {
    const { listarPublicacionesProgramadasVencidas } = await import('../db/supabase')
    const vencidas = await listarPublicacionesProgramadasVencidas(ahora)
    for (const publicacion of vencidas) {
      const clip = await repo.obtenerClip(publicacion.clip_id)
      if (!clip) continue
      const proyecto = await repo.obtenerProyecto(clip.proyecto_id)
      if (!proyecto) continue
      pendientes.push({ publicacion, usuarioId: proyecto.usuario_id })
    }
  }

  let publicadas = 0
  for (const { publicacion, usuarioId } of pendientes) {
    try {
      const sesion: SessionPayload = { uid: usuarioId, email: '', nombre: '' }
      const resultado = await publicarClip(sesion, {
        clipId: publicacion.clip_id,
        plataforma: publicacion.plataforma,
      })
      if (resultado.publicacion.estado === 'publicada') publicadas++
    } catch (error) {
      await repo
        .actualizarPublicacion(publicacion.id, {
          estado: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
        .catch(() => undefined)
    }
  }
  return publicadas
}

let planificadorActivo: NodeJS.Timeout | null = null

/**
 * Arranca el planificador de publicaciones programadas (una sola vez por
 * proceso). Se invoca de forma perezosa desde las rutas que lo necesitan.
 */
export function ensurePlanificador(): void {
  if (planificadorActivo) return
  const global = globalThis as unknown as Record<string, NodeJS.Timeout | undefined>
  if (global.__viralai_planificador__) {
    planificadorActivo = global.__viralai_planificador__
    return
  }
  const temporizador = setInterval(() => {
    void ejecutarPlanificador().catch(() => undefined)
  }, 60_000)
  temporizador.unref?.()
  global.__viralai_planificador__ = temporizador
  planificadorActivo = temporizador
}

export function iniciarPlanificador(): void {
  ensurePlanificador()
}
