/**
 * Descarga yt-dlp en `.tools/` (Windows / macOS / Linux).
 *
 *   npm run tool:yt-dlp
 *
 * Es la dependencia externa que permite importar vídeos de YouTube, TikTok,
 * X, Instagram… Si no está, la app sólo admite ficheros MP4 remotos.
 */
import { spawn } from 'node:child_process'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const DESTINO = join(RAIZ, '.tools')

const PLATAFORMA = process.platform
const ARQUITECTURA = process.arch

function nombreBinario() {
  if (PLATAFORMA === 'win32') return 'yt-dlp.exe'
  if (PLATAFORMA === 'darwin') return 'yt-dlp_macos'
  return 'yt-dlp_linux'
}

async function ultimaVersion() {
  const res = await fetch(
    'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest',
    { headers: { 'User-Agent': 'viralai-studio' } },
  )
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}`)
  const datos = await res.json()
  return datos.tag_name
}

const tag = await ultimaVersion()
const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${tag}/${nombreBinario()}`

console.log(`Descargando yt-dlp ${tag}…`)
const respuesta = await fetch(url, { redirect: 'follow' })
if (!respuesta.ok) {
  throw new Error(`No se pudo descargar yt-dlp (${respuesta.status})`)
}

await mkdir(DESTINO, { recursive: true })
const destino = join(DESTINO, nombreBinario())
await writeFile(destino, Buffer.from(await respuesta.arrayBuffer()))
if (PLATAFORMA !== 'win32') await chmod(destino, 0o755)

console.log(`Listo: ${destino}`)
console.log('Comprueba con: .tools/yt-dlp --version')
