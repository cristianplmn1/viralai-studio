/// <reference types="vite/client" />
import {
  HeadContent,
  Scripts,
  createRootRoute,
  Link,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { ProveedorSesion } from '~/components/SesionProvider'
import appCss from '~/styles/app.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      { title: 'ViralAI Studio — De un vídeo largo a clips virales' },
      {
        name: 'description',
        content:
          'Sube un vídeo largo y obtén clips verticales, portadas y textos virales listos para publicar en YouTube, Shorts y TikTok.',
      },
      { name: 'theme-color', content: '#06060b' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap',
      },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: () => <NoEncontrado />,
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen antialiased">
        <ProveedorSesion>{children}</ProveedorSesion>
        <Scripts />
      </body>
    </html>
  )
}

function NoEncontrado() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="brand-text text-7xl font-bold">404</p>
      <h1 className="text-2xl font-semibold text-white">Página no encontrada</h1>
      <p className="max-w-md text-sm text-mist-400">
        La dirección que buscas no existe o ha cambiado de sitio.
      </p>
      <Link to="/dashboard" className="btn btn-primary">
        Volver al dashboard
      </Link>
    </div>
  )
}
