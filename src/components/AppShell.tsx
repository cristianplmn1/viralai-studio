import { Link, useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Logo } from './Logo'
import { useSesion } from './SesionProvider'
import { fnSalir } from '~/server/api/auth'
import { AvisoLegal, Spinner } from './UI'

const NAVEGACION = [
  {
    to: '/dashboard',
    label: 'Proyectos',
    descripcion: 'Tus vídeos y clips',
    icono: (
      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ height: 18, width: 18 }}>
        <rect x="2" y="4" width="20" height="14" rx="2.5" />
        <path d="M2 9h20M7 4v14" />
      </svg>
    ),
  },
  {
    to: '/subir',
    label: 'Subir vídeo',
    descripcion: 'Generar clips con IA',
    icono: (
      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ height: 18, width: 18 }}>
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    ),
  },
]

export function AppShell({ children }: { children: ReactNode }) {
  const { usuario, conexion } = useSesion()
  const navegar = useNavigate()
  const [saliendo, setSaliendo] = useState(false)
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [conectando, setConectando] = useState<'youtube' | 'tiktok' | null>(null)
  const [errorConexion, setErrorConexion] = useState<string | null>(null)

  async function conectar(plataforma: 'youtube' | 'tiktok') {
    setConectando(plataforma)
    setErrorConexion(null)
    try {
      const { fnIniciarOAuth } = await import('~/server/api/conexion')
      const { url } = await fnIniciarOAuth({ data: { plataforma } })
      window.location.href = url
    } catch (fallo) {
      setErrorConexion(
        fallo instanceof Error
          ? fallo.message
          : 'No se pudo iniciar la conexión.',
      )
      setConectando(null)
    }
  }

  async function cerrarSesion() {
    setSaliendo(true)
    try {
      await fnSalir()
    } finally {
      await navegar({ to: '/login', replace: true })
    }
  }

  return (
    <div className="relative z-10 flex min-h-screen">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-ink-800/80 bg-ink-950/70 backdrop-blur-xl lg:flex">
        <div className="px-5 py-5">
          <Logo />
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAVEGACION.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeProps={{
                className:
                  'bg-brand-500/10 text-white border-brand-500/25 shadow-[inset_2px_0_0_0_var(--color-brand-500)]',
              }}
              inactiveProps={{
                className:
                  'text-mist-400 hover:bg-ink-850/80 hover:text-mist-100 border-transparent',
              }}
              className="flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors"
            >
              <span className="shrink-0 opacity-80">{item.icono}</span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold leading-tight">
                  {item.label}
                </span>
                <span className="block truncate text-[11px] leading-tight opacity-60">
                  {item.descripcion}
                </span>
              </span>
            </Link>
          ))}
        </nav>

        {/* Conexiones */}
        <div className="mx-3 mb-3 rounded-xl border border-ink-800 bg-ink-900/60 p-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-mist-500">
            Cuentas conectadas
          </p>
          <div className="space-y-1.5">
            <FilaConexion
              plataforma="YouTube"
              conectado={Boolean(conexion?.youtube)}
              detalle={conexion?.canal_youtube ?? null}
              color="#ff0033"
              onConectar={() => void conectar('youtube')}
              conectando={conectando === 'youtube'}
            />
            <FilaConexion
              plataforma="TikTok"
              conectado={Boolean(conexion?.tiktok)}
              detalle={conexion?.cuenta_tiktok ?? null}
              color="#25f4ee"
              onConectar={() => void conectar('tiktok')}
              conectando={conectando === 'tiktok'}
            />
          </div>
          {errorConexion && (
            <p className="mt-2 rounded-lg border border-rose-500/25 bg-rose-500/10 px-2.5 py-2 text-[11px] leading-snug text-rose-200">
              {errorConexion}
            </p>
          )}
        </div>

        <div className="border-t border-ink-800 p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-magenta-500 text-xs font-bold text-white">
              {usuario?.nombre?.charAt(0).toUpperCase() ?? '?'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-white">
                {usuario?.nombre ?? 'Invitado'}
              </p>
              <p className="truncate text-[11px] text-mist-500">{usuario?.email}</p>
            </div>
            <button
              type="button"
              onClick={() => void cerrarSesion()}
              disabled={saliendo}
              title="Cerrar sesión"
              className="btn btn-subtle h-8 w-8 !p-0"
            >
              {saliendo ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </aside>

      {/* Contenido */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra móvil */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-ink-800/80 bg-ink-950/85 px-4 py-3 backdrop-blur-xl lg:hidden">
          <Logo />
          <button
            type="button"
            onClick={() => setMenuAbierto((v) => !v)}
            className="btn btn-ghost h-9 w-9 !p-0"
            aria-label="Menú"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
            >
              {menuAbierto ? (
                <path d="M18 6 6 18M6 6l12 12" />
              ) : (
                <path d="M3 6h18M3 12h18M3 18h18" />
              )}
            </svg>
          </button>
        </header>

        {menuAbierto && (
          <div className="border-b border-ink-800 bg-ink-900/95 p-3 backdrop-blur-xl lg:hidden">
            <nav className="space-y-1">
              {NAVEGACION.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMenuAbierto(false)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-mist-200 hover:bg-ink-850"
                >
                  {item.icono}
                  <span className="text-[13px] font-semibold">{item.label}</span>
                </Link>
              ))}
              <button
                type="button"
                onClick={() => void cerrarSesion()}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-mist-300 hover:bg-ink-850"
              >
                Cerrar sesión
              </button>
            </nav>
          </div>
        )}

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>

        <footer className="border-t border-ink-800/70 px-4 py-5 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">
            <AvisoLegal />
          </div>
        </footer>
      </div>
    </div>
  )
}

function FilaConexion({
  plataforma,
  conectado,
  detalle,
  color,
  onConectar,
  conectando,
}: {
  plataforma: string
  conectado: boolean
  detalle: string | null
  color: string
  onConectar: () => void
  conectando: boolean
}) {
  return (
    <button
      type="button"
      onClick={onConectar}
      disabled={conectado || conectando}
      title={
        conectado
          ? `${plataforma} ya está conectado`
          : `Conectar ${plataforma}`
      }
      className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-ink-800/70 disabled:cursor-default disabled:hover:bg-transparent"
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{
          background: conectado ? color : 'var(--color-ink-600)',
          boxShadow: conectado ? `0 0 8px ${color}` : 'none',
        }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-semibold text-mist-200">
          {plataforma}
        </p>
        <p className="truncate text-[10px] text-mist-500">
          {conectado
            ? (detalle ?? 'Conectado')
            : conectando
              ? 'Conectando…'
              : 'Conectar'}
        </p>
      </div>
      {!conectado && !conectando && (
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5 shrink-0 text-mist-500"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      )}
    </button>
  )
}
