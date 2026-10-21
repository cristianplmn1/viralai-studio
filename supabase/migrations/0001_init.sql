-- ═══════════════════════════════════════════════════════════════
-- ViralAI Studio — esquema inicial
-- Ejecuta este fichero en el SQL Editor de Supabase.
-- ═══════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- Tipos enumerados
-- ─────────────────────────────────────────────────────────────

do $$ begin
  create type public.estado_proyecto as enum ('procesando', 'listo', 'publicado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.formato_clip as enum ('9:16', '16:9');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.plataforma as enum ('youtube', 'shorts', 'tiktok');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_publicacion as enum ('programada', 'publicada', 'error');
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────
-- Tablas
-- ─────────────────────────────────────────────────────────────

-- Perfil del creador. `id` referencia auth.users.
create table if not exists public.usuarios (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text not null unique,
  nombre         text not null default '',
  password_hash  text,           -- sólo se usa en el modo local
  fecha_creacion timestamptz not null default now()
);

create table if not exists public.proyectos (
  id                 uuid primary key default gen_random_uuid(),
  usuario_id         uuid not null references public.usuarios(id) on delete cascade,
  titulo             text not null,
  url_video_original text not null,
  duracion_seg       numeric(10,2) not null default 0,
  estado             public.estado_proyecto not null default 'procesando',
  fecha_creacion     timestamptz not null default now(),
  progreso           int not null default 0,
  etapa              text,
  mensaje_error      text
);

create table if not exists public.clips (
  id                 uuid primary key default gen_random_uuid(),
  proyecto_id        uuid not null references public.proyectos(id) on delete cascade,
  inicio_seg         numeric(10,2) not null,
  fin_seg            numeric(10,2) not null,
  formato            public.formato_clip not null default '9:16',
  url_render         text not null default '',
  subtitulos         boolean not null default false,
  puntuacion_viral   int not null default 0,
  eliminar_silencios boolean not null default false,
  musica             boolean not null default false,
  url_render_virgen  text,
  titulo             text not null default '',
  fecha_creacion     timestamptz not null default now()
);

create table if not exists public.portadas (
  id            uuid primary key default gen_random_uuid(),
  clip_id       uuid not null references public.clips(id) on delete cascade,
  url_imagen    text not null,
  titulo_visual text not null default '',
  version       int not null default 1,
  fondo_eliminado boolean not null default false,
  fecha_creacion timestamptz not null default now(),
  unique (clip_id, version)
);

create table if not exists public.contenido_viral (
  id          uuid primary key default gen_random_uuid(),
  clip_id     uuid not null unique references public.clips(id) on delete cascade,
  gancho      text not null default '',
  titulo      text not null default '',
  descripcion text not null default '',
  hashtags    text[] not null default '{}',
  puntuacion  int not null default 0,
  fragmentos  jsonb not null default '[]'::jsonb
);

create table if not exists public.publicaciones (
  id               uuid primary key default gen_random_uuid(),
  clip_id          uuid not null references public.clips(id) on delete cascade,
  plataforma       public.plataforma not null,
  fecha_programada timestamptz,
  estado           public.estado_publicacion not null default 'programada',
  id_externo       text,
  url_publicacion  text,
  error            text,
  fecha_creacion   timestamptz not null default now()
);

-- Tokens OAuth cifrados (AES-256-GCM en la capa de aplicación).
-- Cada usuario sólo puede leer y modificar su propia fila.
create table if not exists public.credenciales_plataforma (
  usuario_id      uuid primary key references public.usuarios(id) on delete cascade,
  token_youtube   text,
  token_tiktok    text,
  refresh_youtube text,
  refresh_tiktok  text,
  canal_youtube   text,
  cuenta_tiktok   text,
  youtube_expira  bigint,
  tiktok_expira   bigint
);

-- ─────────────────────────────────────────────────────────────
-- Índices
-- ─────────────────────────────────────────────────────────────

create index if not exists idx_proyectos_usuario   on public.proyectos (usuario_id, fecha_creacion desc);
create index if not exists idx_clips_proyecto      on public.clips (proyecto_id, inicio_seg);
create index if not exists idx_portadas_clip       on public.portadas (clip_id, version);
create index if not exists idx_publicaciones_clip  on public.publicaciones (clip_id, fecha_creacion desc);
create index if not exists idx_publicaciones_estado on public.publicaciones (estado, fecha_programada);

-- ─────────────────────────────────────────────────────────────
-- Funciones auxiliares
-- ─────────────────────────────────────────────────────────────

-- Crea (o actualiza) el perfil público la primera vez que entra un usuario.
create or replace function public.crear_perfil()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.usuarios (id, email, nombre)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'nombre', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.crear_perfil();

-- ¿Pertenece el clip al usuario autenticado?
create or replace function public.clip_pertenece(p_clip_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1
    from public.clips c
    join public.proyectos p on p.id = c.proyecto_id
    where c.id = p_clip_id
      and p.usuario_id = auth.uid()
  );
$$;

-- Publicaciones del usuario autenticado (usado por el panel).
create or replace function public.mis_publicaciones(p_usuario uuid)
returns setof public.publicaciones
language sql
stable
security definer set search_path = public
as $$
  select pu.*
  from public.publicaciones pu
  join public.clips c on c.id = pu.clip_id
  join public.proyectos p on p.id = c.proyecto_id
  where p.usuario_id = p_usuario
  order by pu.fecha_creacion desc;
$$;

-- Publicaciones programadas ya vencidas (lo usa el planificador).
create or replace function public.publicaciones_vencidas(p_hora timestamptz)
returns setof public.publicaciones
language sql
stable
security definer set search_path = public
as $$
  select pu.*
  from public.publicaciones pu
  where pu.estado = 'programada'
    and pu.fecha_programada is not null
    and pu.fecha_programada <= p_hora;
$$;

-- ─────────────────────────────────────────────────────────────
-- Row Level Security
-- Cada usuario sólo ve y modifica sus propios datos.
-- ─────────────────────────────────────────────────────────────

alter table public.usuarios                enable row level security;
alter table public.proyectos               enable row level security;
alter table public.clips                   enable row level security;
alter table public.portadas                 enable row level security;
alter table public.contenido_viral         enable row level security;
alter table public.publicaciones           enable row level security;
alter table public.credenciales_plataforma enable row level security;

drop policy if exists "usuarios: propia fila" on public.usuarios;
create policy "usuarios: propia fila" on public.usuarios
  for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "proyectos: propios" on public.proyectos;
create policy "proyectos: propios" on public.proyectos
  for all using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

drop policy if exists "clips: propios" on public.clips;
create policy "clips: propios" on public.clips
  for all using (public.clip_pertenece(id)) with check (public.clip_pertenece(id));

drop policy if exists "portadas: propios" on public.portadas;
create policy "portadas: propios" on public.portadas
  for all using (public.clip_pertenece(clip_id)) with check (public.clip_pertenece(clip_id));

drop policy if exists "contenido_viral: propios" on public.contenido_viral;
create policy "contenido_viral: propios" on public.contenido_viral
  for all using (public.clip_pertenece(clip_id)) with check (public.clip_pertenece(clip_id));

drop policy if exists "publicaciones: propias" on public.publicaciones;
create policy "publicaciones: propias" on public.publicaciones
  for all using (public.clip_pertenece(clip_id)) with check (public.clip_pertenece(clip_id));

-- Los tokens OAuth son el dato más sensible: acceso exclusivo del titular.
drop policy if exists "credenciales: propias" on public.credenciales_plataforma;
create policy "credenciales: propias" on public.credenciales_plataforma
  for all using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- Almacenamiento de medios
-- ─────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('medios', 'medios', false)
on conflict (id) do nothing;

drop policy if exists "medios: lectura servicio" on storage.objects;
create policy "medios: lectura servicio" on storage.objects
  for select using (bucket_id = 'medios');

drop policy if exists "medios: escritura servicio" on storage.objects;
create policy "medios: escritura servicio" on storage.objects
  for insert with check (bucket_id = 'medios');

drop policy if exists "medios: actualizacion servicio" on storage.objects;
create policy "medios: actualizacion servicio" on storage.objects
  for update using (bucket_id = 'medios');

drop policy if exists "medios: borrado servicio" on storage.objects;
create policy "medios: borrado servicio" on storage.objects
  for delete using (bucket_id = 'medios');
