-- ============================================================================
-- PaginaToto — Base de datos para multi-usuario (UN negocio)
-- ----------------------------------------------------------------------------
-- Pegá TODO este archivo en:  Supabase -> tu proyecto PaginaToto -> SQL Editor
-- -> New query -> pegar -> RUN.
-- Se puede correr varias veces sin romper nada.
-- ============================================================================

-- ---------- Perfiles de usuario ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  nombre     text not null default '',
  role       text not null default 'usuario' check (role in ('admin','usuario')),
  activo     boolean not null default false,   -- se activa al crearlo desde la app
  created_at timestamptz not null default now()
);

-- ---------- Datos del negocio ----------
-- Cada fila guarda el objeto completo como JSON (así no hay que migrar la
-- estructura cada vez que se agrega un campo en la app).
create table if not exists public.vehicles       ( id text primary key, data jsonb not null, updated_at timestamptz not null default now() );
create table if not exists public.history        ( id text primary key, data jsonb not null, ts bigint not null default 0 );
create table if not exists public.reminders      ( id text primary key, data jsonb not null, updated_at timestamptz not null default now() );
create table if not exists public.fixed_expenses ( id text primary key, data jsonb not null, updated_at timestamptz not null default now() );
create table if not exists public.kv             ( k  text primary key, data jsonb not null, updated_at timestamptz not null default now() );

-- ---------- Al registrarse un usuario en Auth, se crea su perfil ----------
-- (queda INACTIVO hasta que el admin lo cree/active desde la app)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.profiles (id, email, nombre)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'nombre', ''))
  on conflict (id) do nothing;
  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Funciones de permiso (ignoran RLS, evitan recursión) ----------
create schema if not exists app_private;
revoke all on schema app_private from public, anon, service_role;
grant usage on schema app_private to authenticated;
create or replace function app_private.is_active_user()
returns boolean language sql security definer stable set search_path = pg_catalog, public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and activo = true)
$$;

create or replace function app_private.is_admin()
returns boolean language sql security definer stable set search_path = pg_catalog, public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and activo = true and role = 'admin')
$$;

-- ---------- Activar Row Level Security ----------
alter table public.profiles       enable row level security;
alter table public.vehicles       enable row level security;
alter table public.history        enable row level security;
alter table public.reminders      enable row level security;
alter table public.fixed_expenses enable row level security;
alter table public.kv             enable row level security;

-- profiles: cualquier usuario activo ve la lista; sólo el admin la modifica
drop policy if exists p_profiles_read  on public.profiles;
drop policy if exists p_profiles_admin on public.profiles;
drop policy if exists p_profiles_admin_insert on public.profiles;
drop policy if exists p_profiles_admin_update on public.profiles;
drop policy if exists p_profiles_admin_delete on public.profiles;
create policy p_profiles_read on public.profiles for select to authenticated using ((select app_private.is_active_user()));
create policy p_profiles_admin_insert on public.profiles for insert to authenticated with check ((select app_private.is_admin()));
create policy p_profiles_admin_update on public.profiles for update to authenticated using ((select app_private.is_admin())) with check ((select app_private.is_admin()));
create policy p_profiles_admin_delete on public.profiles for delete to authenticated using ((select app_private.is_admin()));

-- datos del negocio: cualquier usuario activo lee y escribe todo
do $$
declare t text;
begin
  foreach t in array array['vehicles','history','reminders','fixed_expenses','kv'] loop
    execute format('drop policy if exists p_%1$s_all on public.%1$s', t);
    execute format('create policy p_%1$s_all on public.%1$s for all to authenticated using ((select app_private.is_active_user())) with check ((select app_private.is_active_user()))', t);
  end loop;
end $$;

-- Los helpers SECURITY DEFINER solo son ejecutables por usuarios autenticados
-- (las altas de Auth llaman handle_new_user mediante su trigger, no por RPC).
revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;
revoke all on function app_private.is_active_user() from public, anon, service_role;
revoke all on function app_private.is_admin() from public, anon, service_role;
grant execute on function app_private.is_active_user() to authenticated;
grant execute on function app_private.is_admin() to authenticated;

-- ---------- Tiempo real ----------
do $$
declare t text;
begin
  foreach t in array array['profiles','vehicles','history','reminders','fixed_expenses','kv'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ============================================================================
-- LISTO (tiene que decir "Success"). Ahora seguí con el PASO 2 de PASOS.txt
-- (desplegar la función  admin-users ).
-- ============================================================================
