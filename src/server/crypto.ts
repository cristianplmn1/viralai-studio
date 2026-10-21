import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'
import { env } from './env'

/* ------------------------------------------------------------------ */
/* Cifrado de tokens OAuth (AES-256-GCM)                               */
/* ------------------------------------------------------------------ */

const KEY = createHash('sha256').update(`viralai:token:${env.sessionSecret}`).digest()

export function encryptSecret(plain: string | null | undefined): string | null {
  if (!plain) return null
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', KEY, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ct.toString('base64url')}`
}

export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null
  const parts = payload.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') return null
  try {
    const iv = Buffer.from(parts[1]!, 'base64url')
    const tag = Buffer.from(parts[2]!, 'base64url')
    const ct = Buffer.from(parts[3]!, 'base64url')
    const decipher = createDecipheriv('aes-256-gcm', KEY, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Cookies de sesión (HMAC-SHA256)                                     */
/* ------------------------------------------------------------------ */

export interface SessionPayload {
  uid: string
  email: string
  nombre: string
  /** Access token de Supabase (modo Supabase) */
  at?: string
  rt?: string
  exp?: number
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

export function signSession(payload: SessionPayload): string {
  const body = b64url(JSON.stringify(payload))
  const sig = createHmac('sha256', env.sessionSecret).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifySession(token: string | undefined | null): SessionPayload | null {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = createHmac('sha256', env.sessionSecret).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload
    if (payload.exp && Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Contraseñas (modo local)                                            */
/* ------------------------------------------------------------------ */

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, 64)
  return `scrypt:${salt.toString('base64url')}:${key.toString('base64url')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  try {
    const salt = Buffer.from(parts[1]!, 'base64url')
    const key = Buffer.from(parts[2]!, 'base64url')
    const candidate = scryptSync(password, salt, key.length)
    return candidate.length === key.length && timingSafeEqual(candidate, key)
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                           */
/* ------------------------------------------------------------------ */

export function randomId(prefix = ''): string {
  const id = randomBytes(16).toString('hex')
  return prefix ? `${prefix}_${id}` : id
}

/** Firma de un cuerpo de petición (upload directo) para evitar CSRF/replay. */
export function signPayload(payload: string): string {
  return createHmac('sha256', env.sessionSecret).update(payload).digest('base64url')
}

/** Verifica una firma generada con `signPayload`. */
export function verifyPayload(payload: string, firma: string): boolean {
  const esperado = signPayload(payload)
  const a = Buffer.from(firma)
  const b = Buffer.from(esperado)
  return a.length === b.length && timingSafeEqual(a, b)
}
