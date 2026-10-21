# ViralAI Studio

Convierte un vídeo largo en clips verticales, portadas y textos virales listos
para publicar en **YouTube**, **YouTube Shorts** y **TikTok**.

Sube el vídeo → la IA analiza el audio y los planos, detecta los momentos
destacados, recorta los silencios, renderiza el clip en 9:16, genera tres
miniaturas comparables y redacta el copy viral → publica o programa.

---

## Stack

| Capa | Tecnología |
| --- | --- |
| Framework | [TanStack Start](https://tanstack.com/start) (React 19, SSR + server functions) |
| Routing | TanStack Router (file-based) |
| Backend | [Supabase](https://supabase.com) (Postgres, Auth, Storage, RLS) |
| Estilo | Tailwind CSS v4 (CSS-first) |
| Vídeo | ffmpeg / ffprobe (`ffmpeg-static`, `ffprobe-static`) |

La app **funciona sin Supabase**: si no hay credenciales, arranca en *modo
local* con usuarios, proyectos y medios en disco (`./storage`). Es la forma
más rápida de probarla; para producción hay que configurar Supabase.

---

## Puesta en marcha

```bash
npm install
cp .env.example .env      # opcional: sin esto funciona en modo local
npm run dev               # http://localhost:3000
```

> En Windows, si PowerShell bloquea `npm.ps1`, usa `npm.cmd install`.

### Variables de entorno

Todas son opcionales en desarrollo. Las importantes:

| Variable | Para qué sirve |
| --- | --- |
| `SESSION_SECRET` | Firma las cookies de sesión (HMAC) y cifra los tokens OAuth (AES-256-GCM). **Cámbiala en producción.** |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Activa el modo Supabase (Postgres + Auth + Storage + RLS). |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo la usa el planificador de publicaciones programadas. |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` | OAuth de YouTube (Google Cloud → YouTube Data API v3). |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | OAuth de TikTok (Content Posting API). |
| `OPENAI_API_KEY` | Transcripción (Whisper) y copywriting viral. Sin ella se usan subtítulos animados y copy heurístico. |
| `APP_URL` | URL pública; se usa en las redirecciones OAuth. |

### Supabase

1. Crea un proyecto y ejecuta `supabase/migrations/0001_init.sql` en el
   **SQL Editor**.
2. Rellena `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`.
3. En *Authentication → Providers*, habilita **Email**.

El esquema incluye RLS en todas las tablas: cada usuario sólo ve y modifica
sus proyectos, clips, portadas, publicaciones y credenciales. La tabla
`credenciales_plataforma` guarda los tokens OAuth **cifrados** (AES-256-GCM en
la capa de aplicación) y es de acceso exclusivo de su titular.

### OAuth

| Plataforma | URL de redirección |
| --- | --- |
| YouTube | `http://localhost:3000/api/oauth/youtube/callback` |
| TikTok | `http://localhost:3000/api/oauth/tiktok/callback` |

El flujo es el estándar: `/api/oauth/...` genera una URL de autorización con
un `state` **firmado** (HMAC) que ligando al `uid` del usuario; el callback
intercambia el código por tokens, los cifra y los guarda en la fila del
usuario. Nunca se exponen tokens al cliente: la UI solo recibe un booleano
"conectado".

---

## Cómo funciona el pipeline

Todo ocurre en un **worker en segundo plano**: la subida responde al instante
con el estado `Procesando` y la interfaz sigue navegable.

```
subir vídeo
   └─ POST /api/subir (binario crudo, con progreso de bytes)
        └─ análisis con ffprobe/ffmpeg
             · duración, resolución, fps
             · silencios      → silencedetect
             · energía de audio → astats (10 muestras/s)
             · cambios de plano → scene detection
        └─ selección de momentos destacados (ventanas + puntuación)
        └─ render por clip (ffmpeg)
             · 9:16 con fondo desenfocado o 16:9 recortado
             · eliminación de silencios (select/aselect + trim absolutos)
             · subtítulos (SRT de Whisper o keywords animados con drawtext)
             · música de fondo (base original + sidechaincompress)
        └─ 3 portadas (3 fotogramas + fondo extraíble + título visual)
        └─ contenido viral (gancho, título, descripción, hashtags, score)
```

### Detalles técnicos que importan

- **Recorte absoluto**: los clips se extraen con `trim=start=<inicio>:end=<fin>`
  en tiempos absolutos del vídeo original, no desde el segundo 0.
- **Silencios**: `select='between(t,inicio,fin)*not(between(t,s1,e1)+…)'` recorta
  audio **y** vídeo a la vez (no solo el audio).
- **Música**: la base armónica se genera proceduralmente (sin copyright) y se
  renderiza a disco; `sidechaincompress` la atenúa cuando hay voz. La voz se
  duplica con `asplit` porque en ffmpeg cada etiqueta se enlaza una sola vez.
- **Fondo extraíble**: se analiza el color dominante del borde del fotograma y
  se aplica `colorkey` + `overlay` sobre un degradado de marca.
- **Medios optimizados**: H.264 (`+faststart`), AAC 128 kbps, portada JPEG
  calidad 3 y `Cache-Control: immutable`. El endpoint `/api/media/*` soporta
  **HTTP Range**, así que el reproductor puede hacer *seek* sin descargar el
  fichero entero.

---

## Comandos

```bash
npm run dev        # servidor de desarrollo
npm run build      # build de producción (+ typecheck)
npm run preview    # previsualiza el build
npm start          # sirve el build de producción

npm run typecheck  # tsc --noEmit
npm run test:e2e   # prueba de extremo a extremo contra el servidor
npm run fixture    # genera fixtures/demo.mp4 (vídeo de prueba)
```

### Prueba de extremo a extremo

Con el servidor levantado en otra terminal:

```bash
npm run test:e2e
```

Verifica registro, sesión, subida, generación en segundo plano, clips 9:16,
soporte Range, tres portadas, contenido viral con puntuación 0-100, efecto
real de los toggles sobre el render, regeneración de portadas, publicación y
estado de las conexiones OAuth.

---

## Estructura

```
src/
├─ routes/                # rutas file-based (UI + endpoints /api)
│  ├─ login.tsx
│  ├─ dashboard.tsx
│  ├─ subir.tsx
│  ├─ proyectos.$proyectoId*.tsx
│  ├─ api.subir.ts             # POST binario → crea proyecto + encola
│  ├─ api.media.$clave.ts      # medios con soporte Range
│  └─ api.oauth.*.callback.ts  # callbacks OAuth
├─ components/            # UI (shell, reproductor, timeline, toggles…)
├─ server/
│  ├─ api/                 # server functions (createServerFn)
│  ├─ db/                  # repositorio: Supabase (RLS) o local
│  ├─ pipeline/            # análisis, render, portadas, música, cola
│  ├─ publishing/          # YouTube + TikTok + planificador
│  ├─ auth.ts  crypto.ts  media.ts  env.ts
└─ styles/app.css         # sistema de diseño (Tailwind v4)
```

---

## Decisiones de diseño

**Interfaz oscura tipo estudio de edición.** Fondos casi negros con halo
violeta-magenta, acentos en degradado `#8b5cf6 → #d946ef → #ec4899` y tipografía
Inter + Space Grotesk. Se prioriza la previsualización del vídeo y la claridad
de los estados (`Procesando` / `Listo` / `Publicado`).

**Aviso legal siempre visible.** *"Ninguna IA garantiza que un vídeo se
vuelva viral"* aparece en el login, en el pie de todas las pantallas, en el
panel de subida y junto a la puntuación de viralidad.

**Puntuación explicable.** El score 0-100 no es un número mágico: desglosa
gancho, título, descripción, hashtags y duración, cada uno con su parte y el
motivo de la nota.

**Toggles reales.** Subtítulos, música y eliminación de silencios no son
"etiquetas" en la base de datos: cada uno se traduce a filtros de ffmpeg y
obliga a un render nuevo.

---

## Límites conocidos

- TikTok no ofrece programación nativa: las publicaciones programadas de TikTok
  las ejecuta nuestro planificador (cada minuto).
- El "eliminado de fondo" usa *chroma key* sobre el color dominante del borde:
  funciona con fondos planos, no con fondos complexos.
- Sin `OPENAI_API_KEY` los subtítulos son de palabras clave (no una
  transcripción) y el copy viral se genera con plantillas heurísticas.
- Sin credenciales OAuth, publicar entra en **modo demo**: se registra la
  publicación pero no llega a la plataforma.
