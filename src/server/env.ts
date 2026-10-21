/**
 * Configuración de entorno del servidor.
 * Nunca debe importarse desde componentes de cliente.
 */

function str(key: string, fallback = ''): string {
  const value = process.env[key]
  return value && value.trim() ? value.trim() : fallback
}

function bool(key: string, fallback = false): boolean {
  const value = process.env[key]
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

const supabaseUrl = str('SUPABASE_URL')
const supabaseAnonKey = str('SUPABASE_ANON_KEY')

export const env = {
  appUrl: str('APP_URL', 'http://localhost:3000'),
  nodeEnv: str('NODE_ENV', 'development'),

  /** Supabase (opcional: si no está configurado la app arranca en modo local) */
  supabase: {
    url: supabaseUrl,
    anonKey: supabaseAnonKey,
    serviceRoleKey: str('SUPABASE_SERVICE_ROLE_KEY'),
  },

  /** Secreto de sesión: firma cookies HMAC y cifra tokens OAuth (AES-256-GCM) */
  sessionSecret: str('SESSION_SECRET', 'viralai-dev-secret-cambiar-en-produccion'),

  /** Almacenamiento local de medios cuando no hay Supabase Storage */
  storageDir: str('STORAGE_DIR', './storage'),

  /** OAuth Google / YouTube */
  youtube: {
    clientId: str('YOUTUBE_CLIENT_ID'),
    clientSecret: str('YOUTUBE_CLIENT_SECRET'),
    scopes: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
    ].join(' '),
  },

  /** OAuth TikTok Content Posting API */
  tiktok: {
    clientKey: str('TIKTOK_CLIENT_KEY'),
    clientSecret: str('TIKTOK_CLIENT_SECRET'),
    scopes: [
      'user.info.basic',
      'video.publish',
      'video.upload',
      'video.list',
    ].join(','),
  },

  /** IA opcional: transcripción (Whisper) y copywriting viral */
  openai: {
    apiKey: str('OPENAI_API_KEY'),
    baseUrl: str('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
    transcriptionModel: str('OPENAI_TRANSCRIPTION_MODEL', 'whisper-1'),
    chatModel: str('OPENAI_CHAT_MODEL', 'gpt-4o-mini'),
  },

  /** Publicación simulada cuando la plataforma no tiene credenciales OAuth */
  allowDemoPublishing: bool('ALLOW_DEMO_PUBLISHING', true),
} as const

export const isSupabaseConfigured = Boolean(
  env.supabase.url && env.supabase.anonKey,
)

export const isYouTubeConfigured = Boolean(
  env.youtube.clientId && env.youtube.clientSecret,
)

export const isTikTokConfigured = Boolean(
  env.tiktok.clientKey && env.tiktok.clientSecret,
)

export const isOpenAIConfigured = Boolean(env.openai.apiKey)

/** Modo demo: sin backend externo configurado, se usa almacenamiento local. */
export const isLocalMode = !isSupabaseConfigured
