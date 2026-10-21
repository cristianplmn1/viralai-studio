/**
 * Sirve la carpeta `fixtures/` por HTTP para poder probar la importación
 * por enlace con un MP4 real.
 *
 * Uso: node scripts/servidor-fixtures.mjs [puerto]
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const PUERTO = Number(process.argv[2] ?? 4321)

const TIPOS = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg',
}

createServer(async (req, res) => {
  const nombre = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]))
  const ruta = join(RAIZ, nombre === '/' ? 'demo.mp4' : nombre)

  if (!ruta.startsWith(RAIZ)) {
    res.writeHead(403).end('Prohibido')
    return
  }

  try {
    const info = await stat(ruta)
    const rango = req.headers.range

    if (rango) {
      const m = /bytes=(\d*)-(\d*)/.exec(rango)
      const inicio = m?.[1] ? Number(m[1]) : 0
      const fin = m?.[2] ? Number(m[2]) : info.size - 1
      res.writeHead(206, {
        'Content-Type': TIPOS[extname(ruta)] ?? 'application/octet-stream',
        'Content-Length': fin - inicio + 1,
        'Content-Range': `bytes ${inicio}-${fin}/${info.size}`,
        'Accept-Ranges': 'bytes',
      })
      createReadStream(ruta, { start: inicio, end: fin }).pipe(res)
      return
    }

    res.writeHead(200, {
      'Content-Type': TIPOS[extname(ruta)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Accept-Ranges': 'bytes',
    })
    createReadStream(ruta).pipe(res)
  } catch {
    res.writeHead(404).end('No encontrado')
  }
}).listen(PUERTO, () => {
  console.log(`fixtures en http://localhost:${PUERTO}/demo.mp4`)
})
