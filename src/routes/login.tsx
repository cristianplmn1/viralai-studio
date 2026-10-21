import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Logo } from '~/components/Logo'
import { AvisoLegal, Spinner } from '~/components/UI'
import { useSesion } from '~/components/SesionProvider'
import { fnEntrar, fnRegistrar } from '~/server/api/auth'
import { fnIniciarOAuth } from '~/server/api/conexion'

export const Route = createFileRoute('/login')({
  component: PaginaLogin,
})

type Modo = 'entrar' | 'registro'

function PaginaLogin() {
  const navegar = useNavigate()
  const { autenticado, usuario, refrescar } = useSesion()

  const [modo, setModo] = useState<Modo>('entrar')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nombre, setNombre] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [conectando, setConectando] = useState<'youtube' | 'tiktok' | null>(null)

  useEffect(() => {
    if (autenticado) {
      void navegar({ to: '/dashboard', replace: true })
    }
  }, [autenticado, navegar])

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault()
    setError(null)
    setEnviando(true)
    try {
      const resultado =
        modo === 'entrar'
          ? await fnEntrar({ data: { email, password } })
          : await fnRegistrar({ data: { email, password, nombre } })
      if (!resultado.ok) {
        setError(resultado.error)
        return
      }
      await refrescar()
      await navegar({ to: '/dashboard', replace: true })
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'Algo ha ido mal.')
    } finally {
      setEnviando(false)
    }
  }

  async function conectar(plataforma: 'youtube' | 'tiktok') {
    if (!autenticado) {
      setError(
        'Inicia sesión o crea una cuenta para conectar tus cuentas de YouTube y TikTok.',
      )
      setModo('entrar')
      return
    }
    setConectando(plataforma)
    setError(null)
    try {
      const { url } = await fnIniciarOAuth({ data: { plataforma } })
      window.location.href = url
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo iniciar la conexión.')
      setConectando(null)
    }
  }

  return (
    <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Panel de marca */}
      <section className="relative hidden overflow-hidden border-r border-ink-800/70 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="grid-noise pointer-events-none absolute inset-0 opacity-[0.35]" />
        <div className="relative">
          <Logo />
        </div>

        <div className="relative max-w-xl">
          <span className="chip border-brand-500/30 bg-brand-500/10 text-brand-300">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
            Motor de contenido con IA
          </span>
          <h1 className="mt-6 font-display text-5xl font-bold leading-[1.08] tracking-tight text-white">
            Un vídeo largo.
            <br />
            <span className="brand-text">Una semana de contenido.</span>
          </h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-mist-400">
            Sube tu vídeo, deja que la IA detecte los momentos que funcionan y
            obtén clips verticales, portadas y textos virales listos para
            publicar en YouTube, Shorts y TikTok.
          </p>

          <ul className="mt-9 grid gap-3.5 sm:grid-cols-2">
            {[
              {
                titulo: 'Clips 9:16 automáticos',
                texto: 'Detección de momentos destacados y recortes verticales.',
                icono: 'M6 4v16l12-8L6 4Z',
              },
              {
                titulo: 'Subtítulos y música',
                texto: 'Render real con subtítulos animados y música de fondo.',
                icono: 'M4 6h16M4 12h10M4 18h7',
              },
              {
                titulo: 'Portadas comparables',
                texto: 'Tres miniaturas con fondo extraíble y título visual.',
                icono: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6',
              },
              {
                titulo: 'Publicación multi-plataforma',
                texto: 'YouTube, Shorts y TikTok, ahora o programado.',
                icono: 'M12 3v12M7 10l5 5 5-5M4 21h16',
              },
            ].map((recurso) => (
              <li
                key={recurso.titulo}
                className="rounded-xl border border-ink-800/80 bg-ink-900/50 p-4 backdrop-blur"
              >
                <span className="mb-2.5 grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500/25 to-magenta-500/25 text-brand-300">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={recurso.icono} />
                  </svg>
                </span>
                <p className="text-[13px] font-semibold text-white">{recurso.titulo}</p>
                <p className="mt-1 text-[12px] leading-snug text-mist-500">
                  {recurso.texto}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative max-w-xl">
          <AvisoLegal />
        </div>
      </section>

      {/* Formulario */}
      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>

          <h2 className="font-display text-2xl font-bold tracking-tight text-white">
            {modo === 'entrar' ? 'Entra en tu estudio' : 'Crea tu cuenta'}
          </h2>
          <p className="mt-2 text-sm text-mist-400">
            {modo === 'entrar'
              ? 'Accede a tus proyectos, clips y publicaciones.'
              : 'Empieza a convertir tus vídeos largos en clips virales.'}
          </p>

          {/* Selector de modo */}
          <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl border border-ink-700 bg-ink-900/70 p-1">
            {(['entrar', 'registro'] as const).map((valor) => (
              <button
                key={valor}
                type="button"
                onClick={() => {
                  setModo(valor)
                  setError(null)
                }}
                className={`rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors ${
                  modo === valor
                    ? 'bg-gradient-to-r from-brand-600 to-magenta-600 text-white shadow-lg'
                    : 'text-mist-400 hover:text-mist-100'
                }`}
              >
                {valor === 'entrar' ? 'Entrar' : 'Crear cuenta'}
              </button>
            ))}
          </div>

          <form onSubmit={enviar} className="mt-5 space-y-3.5">
            {modo === 'registro' && (
              <div>
                <label className="label" htmlFor="nombre">
                  Nombre
                </label>
                <input
                  id="nombre"
                  className="input"
                  type="text"
                  autoComplete="name"
                  placeholder="Tu nombre o marca"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  required
                  minLength={2}
                />
              </div>
            )}

            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="email"
                placeholder="tu@estudio.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="password">
                Contraseña
              </label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'}
                placeholder={modo === 'entrar' ? '••••••••' : 'Mínimo 8 caracteres'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={modo === 'entrar' ? 1 : 8}
              />
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2.5 text-[12.5px] leading-snug text-rose-200"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={enviando}
              className="btn btn-primary w-full !py-3"
            >
              {enviando ? (
                <>
                  <Spinner />
                  {modo === 'entrar' ? 'Entrando…' : 'Creando cuenta…'}
                </>
              ) : modo === 'entrar' ? (
                'Entrar'
              ) : (
                'Crear cuenta'
              )}
            </button>
          </form>

          {/* Separador */}
          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-ink-700" />
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-mist-500">
              o conecta tus cuentas
            </span>
            <span className="h-px flex-1 bg-ink-700" />
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void conectar('youtube')}
              disabled={conectando !== null}
              className="btn btn-ghost !py-2.5"
            >
              {conectando === 'youtube' ? (
                <Spinner />
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="#ff0033" aria-hidden="true">
                  <path d="M23 12s0-3.9-.5-5.8a3 3 0 0 0-2.1-2.1C18.6 3.5 12 3.5 12 3.5s-6.6 0-8.4.6a3 3 0 0 0-2.1 2.1C1 8.1 1 12 1 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.8.6 8.4.6 8.4.6s6.6 0 8.4-.6a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8Z" />
                  <path d="m9.8 15.3 5.8-3.3-5.8-3.3v6.6Z" fill="#fff" />
                </svg>
              )}
              Conectar YouTube
            </button>
            <button
              type="button"
              onClick={() => void conectar('tiktok')}
              disabled={conectando !== null}
              className="btn btn-ghost !py-2.5"
            >
              {conectando === 'tiktok' ? (
                <Spinner />
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                  <path
                    d="M16.6 5.82a4.28 4.28 0 0 1-1.06-2.82h-3.2v12.4a2.6 2.6 0 1 1-2.2-2.57V9.6a5.9 5.9 0 1 0 5.4 5.86V9.01a7.2 7.2 0 0 0 4.06 1.24V6.94a4.28 4.28 0 0 1-3-1.12Z"
                    fill="#25f4ee"
                  />
                  <path
                    d="M16.6 5.82a4.28 4.28 0 0 1-1.06-2.82h-3.2v12.4a2.6 2.6 0 1 1-2.2-2.57V9.6a5.9 5.9 0 1 0 5.4 5.86V9.01a7.2 7.2 0 0 0 4.06 1.24V6.94a4.28 4.28 0 0 1-3-1.12Z"
                    fill="#fe2c55"
                    opacity=".75"
                  />
                </svg>
              )}
              Conectar TikTok
            </button>
          </div>

          {autenticado && usuario && (
            <p className="mt-4 text-center text-[12px] text-mist-500">
              Sesión activa como <span className="text-mist-300">{usuario.email}</span>
            </p>
          )}

          <div className="mt-8 lg:hidden">
            <AvisoLegal />
          </div>
        </div>
      </section>
    </div>
  )
}
