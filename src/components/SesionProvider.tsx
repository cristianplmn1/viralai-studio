import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { fnSesionActual } from '~/server/api/auth'

export interface UsuarioUI {
  id: string
  email: string
  nombre: string
}

export interface ConexionUI {
  youtube: boolean
  tiktok: boolean
  canal_youtube: string | null
  cuenta_tiktok: string | null
}

interface ValorSesion {
  cargando: boolean
  autenticado: boolean
  usuario: UsuarioUI | null
  conexion: ConexionUI | null
  refrescar: () => Promise<void>
}

const Contexto = createContext<ValorSesion | null>(null)

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [cargando, setCargando] = useState(true)
  const [autenticado, setAutenticado] = useState(false)
  const [usuario, setUsuario] = useState<UsuarioUI | null>(null)
  const [conexion, setConexion] = useState<ConexionUI | null>(null)

  const refrescar = useCallback(async () => {
    try {
      const resultado = await fnSesionActual()
      if (resultado.autenticado) {
        setAutenticado(true)
        setUsuario(resultado.usuario)
        setConexion(resultado.conexion)
      } else {
        setAutenticado(false)
        setUsuario(null)
        setConexion(null)
      }
    } catch {
      setAutenticado(false)
      setUsuario(null)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void refrescar()
  }, [refrescar])

  const valor = useMemo(
    () => ({ cargando, autenticado, usuario, conexion, refrescar }),
    [cargando, autenticado, usuario, conexion, refrescar],
  )

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useSesion(): ValorSesion {
  const contexto = useContext(Contexto)
  if (!contexto) {
    throw new Error('useSesion debe usarse dentro de <ProveedorSesion>')
  }
  return contexto
}
