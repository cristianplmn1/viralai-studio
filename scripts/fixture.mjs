/**
 * Genera `fixtures/demo.mp4`: un vídeo de 75 s con cambios de plano,
 * fragmentos de silencio y audio continuo. Sirve para probar el pipeline
 * completo sin subir material real.
 *
 * Uso: node scripts/fixture.mjs
 */
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpegStatic from 'ffmpeg-static'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const BINARIO = process.env.FFMPEG_PATH ?? ffmpegStatic

if (!BINARIO) {
  console.error('No se encuentra ffmpeg. Define FFMPEG_PATH en el entorno.')
  process.exit(1)
}

const DESTINO = join(RAIZ, 'fixtures', 'demo.mp4')

await mkdir(dirname(DESTINO), { recursive: true })

const args = [
  '-y',
  '-hide_banner',
  '-loglevel',
  'error',
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=1280x720:rate=30:duration=75',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=320:sample_rate=44100:duration=75',
  '-filter_complex',
  "[1:a]volume=enable='between(t,12,16)+between(t,38,44)+between(t,60,63)':volume=0[a]",
  '-map',
  '0:v',
  '-map',
  '[a]',
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '26',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-b:a',
  '128k',
  '-movflags',
  '+faststart',
  DESTINO,
]

console.log('Generando fixtures/demo.mp4…')
const hijo = spawn(BINARIO, args, { stdio: 'inherit', windowsHide: true })
hijo.on('close', (codigo) => {
  if (codigo === 0) console.log(`Listo: ${DESTINO}`)
  else process.exit(codigo ?? 1)
})
