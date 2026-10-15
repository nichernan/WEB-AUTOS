-- PaginaToto: auditoría, papelera y puntos de restauración.
-- Migración exclusivamente aditiva: no modifica ni copia filas existentes.
-- Aplicada en producción al proyecto WebTotoAuto wprhqjmhsqwncbhouxvl.

begin;

-- Helpers de RLS en un esquema no expuesto a PostgREST. El cliente autenticado
-- puede evaluarlos como parte de políticas; no quedan disponibles como RPC.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, service_role;
grant usage on schema app_private to authenticated;
create or replace function app_private.is_active_user()
returns boolean language sql security definer stable
set search_path = pg_catalog, public, auth
as $$ select exists (select 1 from public.profiles where id = auth.uid() and activo = true) $$;
create or replace function app_private.is_admin()
returns boolean language sql security definer stable
set search_path = pg_catalog, public, auth
as $$ select exists (select 1 from public.profiles where id = auth.uid() and activo = true and role = 'admin') $$;
revoke all on function app_private.is_active_user() from public, anon, service_role;
revoke all on function app_private.is_admin() from public, anon, service_role;
grant execute on function app_private.is_active_user() to authenticated;
grant execute on function app_private.is_admin() to authenticated;

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  table_name text not null,
  operation text not null check (operation in ('INSERT','UPDATE','DELETE','TRUNCATE')),
  record_id jsonb not null,
  before_data jsonb,
  after_data jsonb,
  actor_uid uuid,
  db_role name not null default current_user,
  transaction_id bigint not null default txid_current()
);
create index if not exists audit_log_occurred_at_idx on public.audit_log (occurred_at desc);
create index if not exists audit_log_transaction_id_idx on public.audit_log (transaction_id);
create index if not exists audit_log_table_operation_idx on public.audit_log (table_name, operation, occurred_at desc);
alter table public.audit_log enable row level security;
drop policy if exists audit_log_read_active on public.audit_log;
create policy audit_log_read_active on public.audit_log for select to authenticated using ((select app_private.is_active_user()));
revoke all on public.audit_log from public, anon, authenticated, service_role;
grant select on public.audit_log to authenticated;
revoke all on sequence public.audit_log_id_seq from public, anon, authenticated, service_role;

create or replace function public.capture_row_audit()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_id jsonb;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_id := jsonb_build_object('id', v_new -> 'id');
    if tg_table_name = 'kv' then v_id := jsonb_build_object('k', v_new -> 'k'); end if;
    insert into public.audit_log(table_name, operation, record_id, before_data, after_data, actor_uid, db_role, transaction_id)
    values (tg_table_name, tg_op, v_id, null, v_new, auth.uid(),
      coalesce(auth.role(), session_user::text)::name, txid_current());
    return new;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old); v_new := to_jsonb(new);
    v_id := jsonb_build_object('id', v_new -> 'id');
    if tg_table_name = 'kv' then v_id := jsonb_build_object('k', v_new -> 'k'); end if;
    insert into public.audit_log(table_name, operation, record_id, before_data, after_data, actor_uid, db_role, transaction_id)
    values (tg_table_name, tg_op, v_id, v_old, v_new, auth.uid(),
      coalesce(auth.role(), session_user::text)::name, txid_current());
    return new;
  else
    v_old := to_jsonb(old);
    v_id := jsonb_build_object('id', v_old -> 'id');
    if tg_table_name = 'kv' then v_id := jsonb_build_object('k', v_old -> 'k'); end if;
    insert into public.audit_log(table_name, operation, record_id, before_data, after_data, actor_uid, db_role, transaction_id)
    values (tg_table_name, tg_op, v_id, v_old, null, auth.uid(),
      coalesce(auth.role(), session_user::text)::name, txid_current());
    return old;
  end if;
end;
$$;
revoke all on function public.capture_row_audit() from public, anon, authenticated, service_role;

-- TRUNCATE no activa triggers por fila: guardar cada fila antes del vaciado.
create or replace function public.capture_truncate_audit()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_row jsonb;
  v_id jsonb;
begin
  for v_row in execute format('select to_jsonb(t) from %I.%I as t', tg_table_schema, tg_table_name) loop
    v_id := jsonb_build_object('id', v_row -> 'id');
    if tg_table_name = 'kv' then v_id := jsonb_build_object('k', v_row -> 'k'); end if;
    insert into public.audit_log(table_name, operation, record_id, before_data, after_data, actor_uid, db_role, transaction_id)
    values (tg_table_name, 'TRUNCATE', v_id, v_row, null, auth.uid(), coalesce(auth.role(), session_user::text)::name, txid_current());
  end loop;
  return null;
end;
$$;
revoke all on function public.capture_truncate_audit() from public, anon, authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['profiles','vehicles','history','reminders','fixed_expenses','kv'] loop
    execute format('drop trigger if exists audit_row_change on public.%I', t);
    execute format('create trigger audit_row_change after insert or update or delete on public.%I for each row execute function public.capture_row_audit()', t);
    execute format('drop trigger if exists audit_truncate on public.%I', t);
    execute format('create trigger audit_truncate before truncate on public.%I for each statement execute function public.capture_truncate_audit()', t);
  end loop;
end $$;

-- Un corte de entrega separa los datos locales/offline de cada etapa comercial.
-- La fila se instala durante la limpieza controlada, nunca desde el navegador.
create table if not exists public.app_delivery_state (
  singleton boolean primary key default true check (singleton),
  generation uuid not null,
  label text not null,
  established_at timestamptz not null default clock_timestamp()
);
alter table public.app_delivery_state enable row level security;
drop policy if exists app_delivery_state_read_active on public.app_delivery_state;
create policy app_delivery_state_read_active on public.app_delivery_state
  for select to authenticated using ((select app_private.is_active_user()));
revoke all on public.app_delivery_state from public, anon, authenticated, service_role;
grant select on public.app_delivery_state to authenticated;

create or replace function public.current_delivery_generation()
returns uuid language sql stable security invoker
set search_path = pg_catalog, public
as $$ select generation from public.app_delivery_state where singleton = true $$;
revoke all on function public.current_delivery_generation() from public, anon, service_role;
grant execute on function public.current_delivery_generation() to authenticated;

-- kv forma parte del estado comercial: etiquetas la generación para impedir
-- que clientes viejos vuelvan a subir settings/meta locales después del corte.
alter table public.kv add column if not exists generation uuid;

-- Los clientes nuevos incluyen el UUID de etapa en cada objeto comercial.
-- Un cliente viejo/offline que intente re-subir objetos sin ese UUID es rechazado.
create or replace function public.require_current_delivery_generation()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare v_generation uuid;
begin
  v_generation := public.current_delivery_generation();
  if v_generation is null then
    raise exception 'WebTotoAuto está en transición de entrega; sincronización bloqueada';
  end if;
  if tg_table_name in ('vehicles','history','reminders','fixed_expenses') then
    if new.data ->> '_delivery_generation' is distinct from v_generation::text then
      raise exception 'Estado local de otra etapa comercial; recargá la aplicación antes de sincronizar';
    end if;
  elsif new.generation is distinct from v_generation then
    raise exception 'Registro de recuperación de otra etapa comercial';
  end if;
  return new;
end;
$$;
revoke all on function public.require_current_delivery_generation() from public, anon, authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['vehicles','history','reminders','fixed_expenses'] loop
    execute format('drop trigger if exists require_delivery_generation on public.%I', t);
    execute format('create trigger require_delivery_generation before insert or update on public.%I for each row execute function public.require_current_delivery_generation()', t);
    execute format('drop policy if exists p_%1$s_all on public.%1$s', t);
    execute format('create policy p_%1$s_all on public.%1$s for all to authenticated using ((select app_private.is_active_user()) and data ->> ''_delivery_generation'' = (select public.current_delivery_generation())::text) with check ((select app_private.is_active_user()) and data ->> ''_delivery_generation'' = (select public.current_delivery_generation())::text)', t);
  end loop;
  execute 'drop trigger if exists require_delivery_generation on public.kv';
  execute 'create trigger require_delivery_generation before insert or update on public.kv for each row execute function public.require_current_delivery_generation()';
end $$;

drop policy if exists p_kv_all on public.kv;
create policy p_kv_all on public.kv for all to authenticated
  using ((select app_private.is_active_user()) and generation = (select public.current_delivery_generation()))
  with check ((select app_private.is_active_user()) and generation = (select public.current_delivery_generation()));
revoke all on public.kv from public, anon, service_role;
grant select, insert, update, delete on public.kv to authenticated;

-- Defensa adicional: mutaciones normales sobre auditoría generan error.
create or replace function public.reject_audit_log_mutation()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$ begin raise exception 'audit_log es inmutable'; end $$;
revoke all on function public.reject_audit_log_mutation() from public, anon, authenticated, service_role;
drop trigger if exists audit_log_immutable on public.audit_log;
create trigger audit_log_immutable before update or delete on public.audit_log for each row execute function public.reject_audit_log_mutation();
drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate before truncate on public.audit_log for each statement execute function public.reject_audit_log_mutation();

create table if not exists public.app_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  label text not null default 'Estado completo',
  created_by uuid,
  state jsonb not null,
  summary jsonb not null default '{}'::jsonb,
  source text not null default 'application',
  generation uuid not null,
  snapshot_day date generated always as ((created_at at time zone 'America/Argentina/Buenos_Aires')::date) stored
);
alter table public.app_snapshots add column if not exists snapshot_day date generated always as ((created_at at time zone 'America/Argentina/Buenos_Aires')::date) stored;
alter table public.app_snapshots add column if not exists generation uuid;
create index if not exists app_snapshots_created_at_idx on public.app_snapshots (created_at desc);
create unique index if not exists app_snapshots_daily_day_uidx
  on public.app_snapshots (snapshot_day) where source = 'daily' and snapshot_day is not null;
alter table public.app_snapshots enable row level security;
create or replace function public.reject_snapshot_mutation()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$ begin raise exception 'app_snapshots es append-only'; end $$;
revoke all on function public.reject_snapshot_mutation() from public, anon, authenticated, service_role;
drop trigger if exists app_snapshots_immutable on public.app_snapshots;
create trigger app_snapshots_immutable before update or delete on public.app_snapshots for each row execute function public.reject_snapshot_mutation();
drop trigger if exists app_snapshots_no_truncate on public.app_snapshots;
create trigger app_snapshots_no_truncate before truncate on public.app_snapshots for each statement execute function public.reject_snapshot_mutation();
drop policy if exists app_snapshots_read_active on public.app_snapshots;
create policy app_snapshots_read_active on public.app_snapshots for select to authenticated using ((select app_private.is_active_user()) and generation = (select public.current_delivery_generation()));
drop policy if exists app_snapshots_insert_active on public.app_snapshots;
create policy app_snapshots_insert_active on public.app_snapshots for insert to authenticated with check ((select app_private.is_active_user()) and (created_by is null or created_by = (select auth.uid())) and generation = (select public.current_delivery_generation()));
revoke all on public.app_snapshots from public, anon, authenticated, service_role;
grant select, insert on public.app_snapshots to authenticated;
drop trigger if exists app_snapshots_generation on public.app_snapshots;
create trigger app_snapshots_generation before insert on public.app_snapshots for each row execute function public.require_current_delivery_generation();

create table if not exists public.app_trash (
  id text primary key,
  entity text not null,
  entity_id text not null,
  parent_id text,
  label text not null,
  data jsonb not null,
  deleted_at timestamptz not null,
  deleted_by uuid,
  restored_at timestamptz,
  generation uuid not null
);
alter table public.app_trash add column if not exists generation uuid;
create index if not exists app_trash_deleted_at_idx on public.app_trash (deleted_at desc);
alter table public.app_trash enable row level security;
drop policy if exists app_trash_read_active on public.app_trash;
create policy app_trash_read_active on public.app_trash for select to authenticated using ((select app_private.is_active_user()) and generation = (select public.current_delivery_generation()));
drop policy if exists app_trash_insert_active on public.app_trash;
create policy app_trash_insert_active on public.app_trash for insert to authenticated with check ((select app_private.is_active_user()) and (deleted_by is null or deleted_by = (select auth.uid())) and generation = (select public.current_delivery_generation()));
drop policy if exists app_trash_update_active on public.app_trash;
create policy app_trash_update_active on public.app_trash for update to authenticated using ((select app_private.is_active_user()) and generation = (select public.current_delivery_generation())) with check ((select app_private.is_active_user()) and restored_at is not null and generation = (select public.current_delivery_generation()));
revoke all on public.app_trash from public, anon, authenticated, service_role;
grant select, insert on public.app_trash to authenticated;
grant update (restored_at) on public.app_trash to authenticated;
drop trigger if exists app_trash_generation on public.app_trash;
create trigger app_trash_generation before insert on public.app_trash for each row execute function public.require_current_delivery_generation();
create or replace function public.protect_app_trash()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'TRUNCATE' then raise exception 'La papelera no permite truncado'; end if;
  if tg_op = 'DELETE' then raise exception 'La papelera no permite borrar registros'; end if;
  if (to_jsonb(new) - 'restored_at') is distinct from (to_jsonb(old) - 'restored_at') then
    raise exception 'Los datos originales de la papelera son inmutables';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_app_trash() from public, anon, authenticated, service_role;
drop trigger if exists app_trash_immutable on public.app_trash;
create trigger app_trash_immutable before update or delete on public.app_trash for each row execute function public.protect_app_trash();
drop trigger if exists app_trash_no_truncate on public.app_trash;
create trigger app_trash_no_truncate before truncate on public.app_trash for each statement execute function public.protect_app_trash();
do $$ begin
  begin alter publication supabase_realtime add table public.app_trash;
  exception when duplicate_object then null;
  end;
end $$;

-- Registro separado de importaciones/restauraciones de la aplicación.
-- No sustituye audit_log: cada fila afectada también queda capturada por trigger.
create table if not exists public.app_operations (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_uid uuid,
  action text not null,
  entity text not null,
  details jsonb not null default '{}'::jsonb,
  generation uuid not null,
  transaction_id bigint not null default txid_current()
);
alter table public.app_operations add column if not exists generation uuid;
alter table public.app_operations add column if not exists transaction_id bigint not null default txid_current();
create index if not exists app_operations_occurred_at_idx on public.app_operations (occurred_at desc);
alter table public.app_operations enable row level security;
drop policy if exists app_operations_read_active on public.app_operations;
create policy app_operations_read_active on public.app_operations for select to authenticated using ((select app_private.is_active_user()) and generation = (select public.current_delivery_generation()));
drop policy if exists app_operations_insert_active on public.app_operations;
create policy app_operations_insert_active on public.app_operations for insert to authenticated with check ((select app_private.is_active_user()) and (actor_uid is null or actor_uid = (select auth.uid())) and generation = (select public.current_delivery_generation()));
revoke all on public.app_operations from public, anon, authenticated, service_role;
grant select, insert on public.app_operations to authenticated;
drop trigger if exists app_operations_generation on public.app_operations;
create trigger app_operations_generation before insert on public.app_operations for each row execute function public.require_current_delivery_generation();
create or replace function public.reject_app_operations_mutation()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$ begin raise exception 'app_operations es append-only'; end $$;
revoke all on function public.reject_app_operations_mutation() from public, anon, authenticated, service_role;
drop trigger if exists app_operations_immutable on public.app_operations;
create trigger app_operations_immutable before update or delete on public.app_operations for each row execute function public.reject_app_operations_mutation();
drop trigger if exists app_operations_no_truncate on public.app_operations;
create trigger app_operations_no_truncate before truncate on public.app_operations for each statement execute function public.reject_app_operations_mutation();

commit;

-- La reversión segura consiste en deshabilitar/eliminar solo los triggers de
-- captura si fuera necesario; conservar audit_log/snapshots/papelera mantiene
-- la evidencia. No se proporciona DROP de tablas porque borraría respaldos.
