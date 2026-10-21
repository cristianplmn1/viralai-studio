import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server'
import {
  hashPassword,
  signSession,
  verifyPassword,
  verifySession,
  type SessionPayload,
} from './crypto'
import { crearRepoLocal } from './db/local'
import { crearRepoSupabase, crearClienteSupabase } from './db/supabase'
import type { Repo } from './db/repo'
import type { Usuario } from './db/types'
import { env, isSupabaseConfigured } from './env'

export const COOKIE_SESION = 'viralai_sesion'

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: env.nodeEnv === 'production',
  path: '/',
  maxAge: 60 * 60 * 24 * 30,
}

/* ------------------------------------------------------------------ */
/* Sesión                                                               */
/* ------------------------------------------------------------------ */

export function obtenerSesion(): SessionPayload | null {
  return verifySession(getCookie(COOKIE_SESION))
}

export function establecerSesion(payload: SessionPayload): void {
  setCookie(COOKIE_SESION, signSession(payload), COOKIE_OPTS)
}

export function cerrarSesion(): void {
  deleteCookie(COOKIE_SESION, { path: '/' })
}

/**
 * Devuelve la sesión vigente refrescando el token de Supabase si expiró.
 * Devuelve `null` si la sesión es inválida.
 */
export async function sesionVigente(): Promise<SessionPayload | null> {
  const sesion = obtenerSesion()
  if (!sesion) return null

  if (isSupabaseConfigured && sesion.at) {
    const client = crearClienteSupabase()
    const { data, error } = await client.auth.getUser(sesion.at)
    if (!error && data.user) return sesion

    // Token expirado: intentamos renovar con el refresh token
    if (sesion.rt) {
      const { data: renovar, error: errorRenovar } = await client.auth.refreshSession({
        refresh_token: sesion.rt,
      })
      if (!errorRenovar && renovar.session) {
        const nueva: SessionPayload = {
          uid: sesion.uid,
          email: sesion.email,
          nombre: sesion.nombre,
          at: renovar.session.access_token,
          rt: renovar.session.refresh_token,
          exp: renovar.session.expires_at
            ? renovar.session.expires_at * 1000
            : undefined,
        }
        establecerSesion(nueva)
        return nueva
      }
    }
    return null
  }
  return sesion
}

export async function repoDeSesion(
  sesion: SessionPayload,
): Promise<Repo> {
  if (isSupabaseConfigured && sesion.at) {
    return crearRepoSupabase(sesion.at)
  }
  return crearRepoLocal()
}

/* ------------------------------------------------------------------ */
/* Registro / login                                                     */
/* ------------------------------------------------------------------ */

export interface ResultadoAuth {
  ok: boolean
  error?: string
  usuario?: Usuario
}

export async function registrar(
  email: string,
  nombre: string,
  password: string,
): Promise<ResultadoAuth> {
  const correo = email.toLowerCase().trim()
  const limpio = nombre.trim()

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    return { ok: false, error: 'Introduce un email válido.' }
  }
  if (limpio.length < 2) {
    return { ok: false, error: 'Introduce tu nombre.' }
  }
  if (password.length < 8) {
    return { ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' }
  }

  if (isSupabaseConfigured) {
    const client = crearClienteSupabase()
    const { data, error } = await client.auth.signUp({
      email: correo,
      password,
      options: { data: { nombre: limpio } },
    })
    if (error) {
      const mensaje = error.message.includes('already registered')
        ? 'Ya existe una cuenta con ese email.'
        : error.message
      return { ok: false, error: mensaje }
    }
    if (!data.session) {
      return {
        ok: false,
        error: 'Cuenta creada. Confirma tu email e inicia sesión.',
      }
    }
    const repo = crearRepoSupabase(data.session.access_token)
    let usuario = await repo.buscarUsuarioPorId(data.user!.id)
    if (!usuario) {
      usuario = await repo.crearUsuario({
        email: correo,
        nombre: limpio,
        passwordHash: '',
      })
    }
    establecerSesion({
      uid: usuario.id,
      email: usuario.email,
      nombre: usuario.nombre,
      at: data.session.access_token,
      rt: data.session.refresh_token,
      exp: data.session.expires_at
        ? data.session.expires_at * 1000
        : undefined,
    })
    return { ok: true, usuario }
  }

  const repo = crearRepoLocal()
  const existente = await repo.buscarUsuarioPorEmail(correo)
  if (existente) {
    return { ok: false, error: 'Ya existe una cuenta con ese email.' }
  }
  const usuario = await repo.crearUsuario({
    email: correo,
    nombre: limpio,
    passwordHash: hashPassword(password),
  })
  establecerSesion({ uid: usuario.id, email: usuario.email, nombre: usuario.nombre })
  return { ok: true, usuario }
}

export async function iniciarSesion(
  email: string,
  password: string,
): Promise<ResultadoAuth> {
  const correo = email.toLowerCase().trim()
  if (!correo || !password) {
    return { ok: false, error: 'Introduce email y contraseña.' }
  }

  if (isSupabaseConfigured) {
    const client = crearClienteSupabase()
    const { data, error } = await client.auth.signInWithPassword({
      email: correo,
      password,
    })
    if (error || !data.session) {
      return { ok: false, error: 'Email o contraseña incorrectos.' }
    }
    const repo = crearRepoSupabase(data.session.access_token)
    let usuario = await repo.buscarUsuarioPorId(data.user!.id)
    if (!usuario) {
      usuario = await repo.crearUsuario({
        email: correo,
        nombre: data.user!.user_metadata?.nombre ?? correo.split('@')[0]!,
        passwordHash: '',
      })
    }
    establecerSesion({
      uid: usuario.id,
      email: usuario.email,
      nombre: usuario.nombre,
      at: data.session.access_token,
      rt: data.session.refresh_token,
      exp: data.session.expires_at
        ? data.session.expires_at * 1000
        : undefined,
    })
    return { ok: true, usuario }
  }

  const repo = crearRepoLocal()
  const encontrado = await repo.buscarUsuarioPorEmail(correo)
  if (!encontrado || !verifyPassword(password, encontrado.password_hash)) {
    return { ok: false, error: 'Email o contraseña incorrectos.' }
  }
  const { password_hash: _omit, ...usuario } = encontrado
  void _omit
  establecerSesion({ uid: usuario.id, email: usuario.email, nombre: usuario.nombre })
  return { ok: true, usuario }
}

export async function cerrarSesionServidor(): Promise<void> {
  cerrarSesion()
}
