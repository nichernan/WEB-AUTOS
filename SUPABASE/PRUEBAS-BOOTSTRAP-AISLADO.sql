-- Esquema mínimo de compatibilidad Supabase para la base desechable de pruebas.
do $$ begin
  if current_database() <> 'toto_audit_test' then raise exception 'Bootstrap solo permitido en toto_audit_test'; end if;
end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;
create or replace function public.is_active_user() returns boolean language sql stable as $$ select true $$;
create or replace function public.is_admin() returns boolean language sql stable as $$ select true $$;
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$ begin return new; end $$;
create table public.profiles (id uuid primary key, email text, nombre text, role text, activo boolean);
create table public.vehicles (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table public.history (id text primary key, data jsonb not null, ts bigint not null default 0);
create table public.reminders (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table public.fixed_expenses (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table public.kv (k text primary key, data jsonb not null, updated_at timestamptz not null default now());
grant select, insert, update, delete on public.vehicles, public.history, public.reminders, public.fixed_expenses, public.kv to authenticated;
create publication supabase_realtime;
