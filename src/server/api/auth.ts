import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { validar } from './validar'

export interface UsuarioResumen {
  id: string
  email: string
  nombre: string
}

export interface ConexionResumen {
  youtube: boolean
  tiktok: boolean
  canal_youtube: string | null
  cuenta_tiktok: string | null
}

export const fnSesionActual = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { sesionVigente, repoDeSesion } = await import('../auth')
    const { estadoConexion } = await import('../publishing')

    const sesion = await sesionVigente()
    if (!sesion) {
      return { autenticado: false as const }
    }

    const repo = await repoDeSesion(sesion)
    const usuario = await repo.buscarUsuarioPorId(sesion.uid)
    const conexion = await estadoConexion(repo, sesion.uid)

    const resumen: UsuarioResumen = {
      id: sesion.uid,
      email: sesion.email,
      nombre: usuario?.nombre ?? sesion.nombre ?? sesion.email,
    }
    const conexionResumen: ConexionResumen = {
      youtube: conexion.youtube,
      tiktok: conexion.tiktok,
      canal_youtube: conexion.canal_youtube,
      cuenta_tiktok: conexion.cuenta_tiktok,
    }

    return {
      autenticado: true as const,
      usuario: resumen,
      conexion: conexionResumen,
    }
  },
)

export const fnEntrar = createServerFn({ method: 'POST' })
  .validator(
    validar(
      z.object({
        email: z.string().min(3, 'Introduce tu email.'),
        password: z.string().min(1, 'Introduce tu contraseña.'),
      }),
    ),
  )
  .handler(async ({ data }) => {
    const { iniciarSesion } = await import('../auth')
    const resultado = await iniciarSesion(data.email, data.password)
    if (!resultado.ok || !resultado.usuario) {
      return { ok: false as const, error: resultado.error ?? 'No se pudo iniciar sesión.' }
    }
    const usuario: UsuarioResumen = {
      id: resultado.usuario.id,
      email: resultado.usuario.email,
      nombre: resultado.usuario.nombre,
    }
    return { ok: true as const, usuario }
  })

export const fnRegistrar = createServerFn({ method: 'POST' })
  .validator(
    validar(
      z.object({
        email: z.string().min(3, 'Introduce tu email.'),
        nombre: z.string().min(2, 'Introduce tu nombre.'),
        password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.'),
      }),
    ),
  )
  .handler(async ({ data }) => {
    const { registrar } = await import('../auth')
    const resultado = await registrar(data.email, data.nombre, data.password)
    if (!resultado.ok || !resultado.usuario) {
      return { ok: false as const, error: resultado.error ?? 'No se pudo crear la cuenta.' }
    }
    const usuario: UsuarioResumen = {
      id: resultado.usuario.id,
      email: resultado.usuario.email,
      nombre: resultado.usuario.nombre,
    }
    return { ok: true as const, usuario }
  })

export const fnSalir = createServerFn({ method: 'POST' }).handler(async () => {
  const { cerrarSesion } = await import('../auth')
  cerrarSesion()
  return { ok: true as const }
})
