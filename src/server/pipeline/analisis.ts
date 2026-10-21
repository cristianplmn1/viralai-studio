import { ffmpeg, sondearVideo, type MetadatosVideo } from './ffmpeg'

export interface Intervalo {
  inicio: number
  fin: number
}

export interface MomentoDestacado {
  inicio: number
  fin: number
  puntuacion: number
  motivo: string
  /** Clip de mayor "energía" dentro del momento, para usarlo como gancho */
  gancho_inicio: number
  gancho_fin: number
}

export interface ResultadoAnalisis {
  metadatos: MetadatosVideo
  silencios: Intervalo[]
  escenas: number[]
  energia: { t: number; rms: number }[]
  momentos: MomentoDestacado[]
}

/* ------------------------------------------------------------------ */
/* Detección de silencios                                               */
/* ------------------------------------------------------------------ */

/**
 * Presupuesto de tiempo por paso del análisis. Es una RED DE SEGURIDAD: con
 * H.264 y `-vn` el análisis va a ~12x tiempo real, así que sólo se agota con
 * un vídeo patológico. Si se agota, se usan los resultados parciales.
 */
const TIMEOUT_ANALISIS_MS = 10 * 60 * 1000

export async function detectarSilencios(
  ruta: string,
  umbralDb = -32,
  duracionMinima = 0.45,
): Promise<Intervalo[]> {
  const { stderr } = await ffmpeg(
    [
      '-i',
      ruta,
      // Sin -vn, ffmpeg decodifica también el vídeo: en AV1 eso multiplica
      // el tiempo por 70. Sólo queremos el audio.
      '-vn',
      '-af',
      `silencedetect=noise=${umbralDb}dB:d=${duracionMinima}`,
      '-f',
      'null',
      '-',
    ],
    { timeoutMs: TIMEOUT_ANALISIS_MS, timeoutResuelve: true },
  )

  const silencios: Intervalo[] = []
  let inicio: number | null = null

  const regex = /silence_(start|end):\s*(-?[\d.]+)/g
  let coincidencia: RegExpExecArray | null
  while ((coincidencia = regex.exec(stderr)) !== null) {
    const valor = Number(coincidencia[2])
    if (Number.isNaN(valor)) continue
    if (coincidencia[1] === 'start') {
      inicio = Math.max(0, valor)
    } else if (inicio !== null) {
      silencios.push({ inicio, fin: Math.max(inicio + 0.05, valor) })
      inicio = null
    }
  }
  return silencios
}

/** Complemento de los silencios: tramos con sonido. */
export function tramosConSonido(
  silencios: Intervalo[],
  duracion: number,
): Intervalo[] {
  const tramos: Intervalo[] = []
  let cursor = 0
  const ordenados = [...silencios].sort((a, b) => a.inicio - b.inicio)
  for (const s of ordenados) {
    if (s.inicio - cursor > 0.15) {
      tramos.push({ inicio: cursor, fin: s.inicio })
    }
    cursor = Math.max(cursor, s.fin)
  }
  if (duracion - cursor > 0.15) {
    tramos.push({ inicio: cursor, fin: duracion })
  }
  return tramos
}

/* ------------------------------------------------------------------ */
/* Detección de cambios de plano                                        */
/* ------------------------------------------------------------------ */

export async function detectarEscenas(
  ruta: string,
  umbral = 0.3,
  duracionVideo = 0,
): Promise<number[]> {
  // Presupuesto proporcional al vídeo: si se agota, se conservan los cortes
  // detectados hasta ese momento en lugar de bloquear el pipeline.
  const presupuesto = Math.max(
    45_000,
    Math.min(TIMEOUT_ANALISIS_MS, 20_000 + duracionVideo * 250),
  )

  const { stdout } = await ffmpeg(
    [
      '-i',
      ruta,
      // Escalamos antes de comparar: la escena se calcula sobre el fotograma
      // reducido y no sobre el original, con el mismo resultado práctico.
      '-vf',
      `scale=320:-2,select='gt(scene,${umbral})',metadata=print:file=-`,
      '-an',
      '-f',
      'null',
      '-',
    ],
    { timeoutMs: presupuesto, timeoutResuelve: true },
  )

  const escenas: number[] = []
  const regex = /pts_time:([\d.]+)/g
  let coincidencia: RegExpExecArray | null
  while ((coincidencia = regex.exec(stdout.toString('utf8'))) !== null) {
    const valor = Number(coincidencia[1])
    if (Number.isFinite(valor)) escenas.push(Math.round(valor * 100) / 100)
  }
  return escenas
}

/* ------------------------------------------------------------------ */
/* Curva de energía de audio                                           */
/* ------------------------------------------------------------------ */

export async function detectarEnergia(
  ruta: string,
  muestrasPorSegundo = 10,
): Promise<{ t: number; rms: number }[]> {
  const nsamples = Math.round(44100 / muestrasPorSegundo)
  const { stdout } = await ffmpeg(
    [
      '-i',
      ruta,
      '-vn',
      '-af',
      `aresample=8000,aformat=channel_layouts=mono,asetnsamples=n=${nsamples},astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-`,
      '-f',
      'null',
      '-',
    ],
    { timeoutMs: TIMEOUT_ANALISIS_MS, timeoutResuelve: true },
  )

  const texto = stdout.toString('utf8')
  const energia: { t: number; rms: number }[] = []
  const regex = /pts_time:([\d.]+)[\s\S]*?RMS_level=(-?[\d.]+|-inf)/g
  let coincidencia: RegExpExecArray | null
  while ((coincidencia = regex.exec(texto)) !== null) {
    const t = Number(coincidencia[1])
    const bruto = coincidencia[2]
    const rms = bruto === '-inf' ? -90 : Number(bruto)
    if (Number.isFinite(t) && Number.isFinite(rms)) energia.push({ t, rms })
  }
  return energia
}

/* ------------------------------------------------------------------ */
/* Selección de momentos destacados                                    */
/* ------------------------------------------------------------------ */

function percentil(valores: number[], p: number): number {
  if (!valores.length) return 0
  const ordenados = [...valores].sort((a, b) => a - b)
  const indice = Math.min(
    ordenados.length - 1,
    Math.max(0, Math.round((ordenados.length - 1) * p)),
  )
  return ordenados[indice]!
}

function rmsAConserva(energia: { t: number; rms: number }[], desde: number, hasta: number): number {
  const valores = energia
    .filter((e) => e.t >= desde && e.t < hasta)
    .map((e) => e.rms)
  if (!valores.length) return -60
  return valores.reduce((a, b) => a + b, 0) / valores.length
}

export interface OpcionesSeleccion {
  /** Duración objetivo de cada clip en segundos */
  duracionClip: number
  /** Número máximo de clips a generar */
  maximoClips: number
  /** Evitar solapamiento entre clips */
  minimoSeparacion: number
}

export function seleccionarMomentos(
  duracion: number,
  silencios: Intervalo[],
  escenas: number[],
  energia: { t: number; rms: number }[],
  opciones: OpcionesSeleccion,
): MomentoDestacado[] {
  const duracionClip = Math.min(opciones.duracionClip, Math.max(4, duracion))
  const paso = Math.max(2, duracionClip / 3)
  const conSonido = tramosConSonido(silencios, duracion)

  // Energía global: percentil 75 sirve de referencia "voz fuerte y clara"
  const referencia = percentil(energia.map((e) => e.rms), 0.75) || -20

  const ventanas: { inicio: number; fin: number; puntuacion: number }[] = []
  for (let inicio = 0; inicio + 6 <= duracion; inicio += paso) {
    const fin = Math.min(duracion, inicio + duracionClip)
    if (fin - inicio < Math.min(6, duracion * 0.5)) break

    const energiaMedia = rmsAConserva(energia, inicio, fin)
    const energiaAlta = rmsAConserva(energia, inicio, fin)
    const pctEnergia = Math.max(0, Math.min(1, (energiaAlta + 60) / (referencia + 60)))

    const cortes = escenas.filter((t) => t >= inicio && t < fin).length
    const densidadCortes = Math.min(1, cortes / 6)

    const voz = conSonido
      .filter((t) => t.inicio < fin && t.fin > inicio)
      .reduce((acc, t) => acc + (Math.min(t.fin, fin) - Math.max(t.inicio, inicio)), 0)
    const densidadVoz = Math.min(1, voz / (fin - inicio))

    // Bonus por ventana Located al principio (el gancho vive en los primeros segundos)
    const bonusPosicion = inicio / Math.max(1, duracion) < 0.25 ? 0.14 : 0

    const puntuacion =
      pctEnergia * 0.42 +
      densidadCortes * 0.22 +
      densidadVoz * 0.28 +
      bonusPosicion

    ventanas.push({ inicio, fin, puntuacion })
  }

  if (!ventanas.length) {
    return [
      {
        inicio: 0,
        fin: Math.min(duracion, duracionClip),
        puntuacion: 0.5,
        motivo: 'Único fragmento disponible del vídeo original.',
        gancho_inicio: 0,
        gancho_fin: Math.min(duracion, 3),
      },
    ]
  }

  ventanas.sort((a, b) => b.puntuacion - a.puntuacion)

  const elegidos: typeof ventanas = []
  for (const ventana of ventanas) {
    if (elegidos.length >= opciones.maximoClips) break
    const solapa = (elegido: (typeof ventanas)[number]): boolean =>
      ventana.inicio < elegido.fin + opciones.minimoSeparacion &&
      ventana.fin > elegido.inicio - opciones.minimoSeparacion
    if (elegidos.some(solapa)) continue
    elegidos.push(ventana)
  }
  elegidos.sort((a, b) => a.inicio - b.inicio)

  return elegidos.map((ventana) => {
    // El gancho son los 3 primeros segundos con más energía dentro del clip
    let mejor = { inicio: ventana.inicio, fin: ventana.inicio + 3, rms: -Infinity }
    for (let t = ventana.inicio; t < ventana.fin - 1; t += 0.5) {
      const rms = rmsAConserva(energia, t, t + 1.5)
      if (rms > mejor.rms) mejor = { inicio: t, fin: t + 3, rms }
    }

    const cortes = escenas.filter((t) => t >= ventana.inicio && t < ventana.fin).length
    const motivo = cortes >= 3
      ? 'Ritmo acelerado con varios cambios de plano.'
      : cortes >= 1
        ? 'Cambio de plano con voz clara y buen ritmo.'
        : 'Tramo con voz continua y buena intensidad.'

    return {
      inicio: Math.round(ventana.inicio * 100) / 100,
      fin: Math.round(ventana.fin * 100) / 100,
      puntuacion: Math.round(Math.min(1, Math.max(0, ventana.puntuacion)) * 100),
      motivo,
      gancho_inicio: Math.round(mejor.inicio * 100) / 100,
      gancho_fin: Math.round(mejor.fin * 100) / 100,
    }
  })
}

/* ------------------------------------------------------------------ */
/* Análisis completo                                                    */
/* ------------------------------------------------------------------ */

export async function analizarVideo(
  ruta: string,
  opciones: OpcionesSeleccion,
  onEtapa?: (etapa: string, fraccion: number, duracion: number) => void,
): Promise<ResultadoAnalisis> {
  const metadatos = await sondearVideo(ruta)
  const duracion = metadatos.duracion

  let silencios: Intervalo[] = []
  let escenas: number[] = []
  let energia: { t: number; rms: number }[] = []

  if (metadatos.tieneAudio) {
    try {
      onEtapa?.('Analizando los silencios', 0.15, duracion)
      silencios = await detectarSilencios(ruta)
    } catch {
      silencios = []
    }
  }
  try {
    onEtapa?.('Analizando los cambios de plano', 0.5, duracion)
    escenas = await detectarEscenas(ruta, 0.3, duracion)
  } catch {
    escenas = []
  }
  if (metadatos.tieneAudio) {
    try {
      onEtapa?.('Analizando la energía del audio', 0.8, duracion)
      energia = await detectarEnergia(ruta)
    } catch {
      energia = []
    }
  }

  onEtapa?.('Seleccionando los momentos destacados', 1, duracion)

  const momentos = seleccionarMomentos(
    metadatos.duracion,
    silencios,
    escenas,
    energia,
    opciones,
  )

  return { metadatos, silencios, escenas, energia, momentos }
}
