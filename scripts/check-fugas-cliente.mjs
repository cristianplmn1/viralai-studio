/**
 * Comprueba que el bundle del CLIENTE no arrastre módulos de Node.
 *
 * Un `import()` dinámico dentro de un fichero de `src/routes` es legal en
 * apariencia, pero Vite lo convierte en un chunk que el navegador puede
 * pedir: si ese módulo usa `node:child_process` (o similar), la página
 * revienta en el cliente con "Cannot access 'node:child_process.spawn'".
 *
 * Regla:
 *  · desde `src/routes` y `src/components` no se puede alcanzar un `node:*`
 *  · los ficheros de `src/server/api` son server functions: el plugin poda
 *    sus handlers del cliente, así que sólo se miran sus imports de primer
 *    nivel y no se sigue la cadena
 *
 * Uso: node scripts/check-fugas-cliente.mjs
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(RAIZ, 'src')

const IMPORT_ESTATICO = /(?:^|\n)\s*import\s+(?!type\b)(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g
const IMPORT_DINAMICO = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

async function listar(dir, filtro = () => true) {
  const entradas = await readdir(dir, { withFileTypes: true })
  const salida = []
  for (const entrada of entradas) {
    const ruta = join(dir, entrada.name)
    if (entrada.isDirectory()) {
      salida.push(...(await listar(ruta, filtro)))
    } else if (filtro(entrada.name)) {
      salida.push(ruta)
    }
  }
  return salida
}

function resolver(rutaActual, especificador) {
  if (especificador.startsWith('~/')) {
    return join(SRC, especificador.slice(2))
  }
  if (especificador.startsWith('.')) {
    return resolve(dirname(rutaActual), especificador)
  }
  return null // paquete externo
}

function tieneExtension(ruta) {
  return /\.(ts|tsx|js|jsx|mjs)$/.test(ruta)
}

async function existe(ruta) {
  try {
    await readFile(ruta)
    return true
  } catch {
    return false
  }
}

async function resolverFichero(ruta) {
  if (tieneExtension(ruta) && (await existe(ruta))) return ruta
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const candidato = ruta + ext
    if (await existe(candidato)) return candidato
  }
  return null
}

const problemas = []
const vistos = new Set()

/** ¿Es este fichero una server function (contiene createServerFn)? */
async function esFicheroDeServerFn(fichero) {
  if (!fichero.includes(join('src', 'server', 'api'))) return false
  const texto = await readFile(fichero, 'utf8')
  return /createServerFn/.test(texto)
}

/**
 * Un fichero de ruta sólo llega al navegador si renderiza UI. Los endpoints
 * de servidor (`api.*.ts` con `server.handlers` y sin `component`) nunca se
 * cargan en el cliente, así que se saltan.
 */
async function esRutaDeServidor(fichero) {
  if (!fichero.includes(`${join('src', 'routes')}`)) return false
  const texto = await readFile(fichero, 'utf8')
  const tieneHandlers = /server\s*:\s*\{[\s\S]*?handlers\s*:/.test(texto)
  const tieneComponente = /\bcomponent\s*:/.test(texto)
  return tieneHandlers && !tieneComponente
}

/**
 * Regla de la comprobación:
 *
 *  · Un fichero de `src/server/api` es una *server function*: el plugin
 *    elimina el cuerpo de sus handlers del bundle del cliente, así que sus
 *    `import()` dinámicos NUNCA llegan al navegador. Sus imports estáticos
 *    de primer nivel, en cambio, sí se quedan.
 *
 *  · Cualquier otro fichero alcanzado desde el cliente es 100 % cliente:
 *    todos sus imports (estáticos y dinámicos) se descargan en el navegador.
 *
 * Por eso, al entrar en una server function sólo seguimos sus imports
 * estáticos; al salir de ella, seguimos todo.
 */
async function seguir(fichero, cadena, raizDeServerFn = false) {
  if (vistos.has(fichero)) return
  vistos.add(fichero)

  // Los endpoints de servidor nunca se cargan en el navegador.
  if (await esRutaDeServidor(fichero)) return

  const texto = await readFile(fichero, 'utf8')
  const esServerFn = raizDeServerFn || (await esFicheroDeServerFn(fichero))

  const estaticos = new Set()
  const dinamicos = new Set()

  for (const m of texto.matchAll(IMPORT_ESTATICO)) estaticos.add(m[1])
  for (const m of texto.matchAll(IMPORT_DINAMICO)) dinamicos.add(m[1])

  // En una server function los dinámicos van dentro de handlers (se podan).
  const aSeguir = esServerFn ? estaticos : new Set([...estaticos, ...dinamicos])

  for (const especificador of aSeguir) {
    if (especificador.startsWith('node:')) {
      problemas.push({
        modulo: especificador,
        desde: cadena,
        fichero: relative(RAIZ, fichero),
      })
      continue
    }
    const bruto = resolver(fichero, especificador)
    if (!bruto) continue
    const destino = await resolverFichero(bruto)
    if (!destino) continue
    await seguir(destino, `${cadena} → ${especificador}`, false)
  }
}

const entradas = [
  ...(await listar(join(SRC, 'routes'), (n) => /\.(ts|tsx)$/.test(n))),
  ...(await listar(join(SRC, 'components'), (n) => /\.(ts|tsx)$/.test(n))),
  join(SRC, 'router.tsx'),
]

for (const entrada of entradas) {
  if (await esRutaDeServidor(entrada)) continue
  await seguir(entrada, relative(RAIZ, entrada))
}

if (problemas.length) {
  console.error('\x1b[31m\x1b[1mFugas de módulos de Node al bundle del cliente:\x1b[0m\n')
  for (const p of problemas) {
    console.error(`  ${p.modulo}`)
    console.error(`    importado desde ${p.fichero}`)
    console.error(`    cadena: ${p.desde}\n`)
  }
  console.error(
    'Arregla esto: dentro de src/routes y src/components usa server functions\n' +
      '(createServerFn) en vez de importar módulos del servidor directamente.',
  )
  process.exit(1)
}

console.log(
  `\x1b[32mOK\x1b[0m  ${entradas.length} puntos de entrada, ${vistos.size} módulos: ningún módulo de Node llega al cliente.`,
)
