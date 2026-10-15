-- Endurecimiento de helpers/políticas preexistentes después de instalar
-- 2-seguridad-y-recuperacion.sql. No cambia filas ni perfiles.
begin;

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

alter function public.handle_new_user() set search_path = pg_catalog, public;
alter function app_private.is_active_user() set search_path = pg_catalog, public;
alter function app_private.is_admin() set search_path = pg_catalog, public;

-- Auth invoca handle_new_user a través del trigger de auth.users. Nadie necesita
-- llamarla como RPC. Los helpers de autorización solo los evalúa authenticated.
revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;
revoke all on function app_private.is_active_user() from public, anon, service_role;
revoke all on function app_private.is_admin() from public, anon, service_role;
grant execute on function app_private.is_active_user() to authenticated;
grant execute on function app_private.is_admin() to authenticated;

-- Evita exposición anónima y conserva acceso activo/admin de la aplicación.
drop policy if exists p_profiles_read on public.profiles;
drop policy if exists p_profiles_admin on public.profiles;
drop policy if exists p_profiles_admin_insert on public.profiles;
drop policy if exists p_profiles_admin_update on public.profiles;
drop policy if exists p_profiles_admin_delete on public.profiles;
create policy p_profiles_read on public.profiles for select to authenticated
  using ((select app_private.is_active_user()));
create policy p_profiles_admin_insert on public.profiles for insert to authenticated
  with check ((select app_private.is_admin()));
create policy p_profiles_admin_update on public.profiles for update to authenticated
  using ((select app_private.is_admin())) with check ((select app_private.is_admin()));
create policy p_profiles_admin_delete on public.profiles for delete to authenticated
  using ((select app_private.is_admin()));

drop policy if exists p_vehicles_all on public.vehicles;
create policy p_vehicles_all on public.vehicles for all to authenticated
  using ((select app_private.is_active_user()) and data ->> '_delivery_generation' = (select public.current_delivery_generation())::text)
  with check ((select app_private.is_active_user()) and data ->> '_delivery_generation' = (select public.current_delivery_generation())::text);
drop policy if exists p_history_all on public.history;
create policy p_history_all on public.history for all to authenticated
  using ((select app_private.is_active_user()) and data ->> '_delivery_generation' = (select public.current_delivery_generation())::text)
  with check ((select app_private.is_active_user()) and data ->> '_delivery_generation' = (select public.current_delivery_generation())::text);
drop policy if exists p_reminders_all on public.reminders;
create policy p_reminders_all on public.reminders for all to authenticated
  using ((select app_private.is_active_user()) and data ->> '_delivery_generation' = (select public.current_delivery_generation())::text)
  with check ((select app_private.is_active_user()) and data ->> '_delivery_generation' = (select public.current_delivery_generation())::text);
drop policy if exists p_fixed_expenses_all on public.fixed_expenses;
create policy p_fixed_expenses_all on public.fixed_expenses for all to authenticated
  using ((select app_private.is_active_user()) and data ->> '_delivery_generation' = (select public.current_delivery_generation())::text)
  with check ((select app_private.is_active_user()) and data ->> '_delivery_generation' = (select public.current_delivery_generation())::text);
drop policy if exists p_kv_all on public.kv;
create policy p_kv_all on public.kv for all to authenticated
  using ((select app_private.is_active_user()) and generation = (select public.current_delivery_generation()))
  with check ((select app_private.is_active_user()) and generation = (select public.current_delivery_generation()));
revoke all on public.kv from public, anon, service_role;
grant select, insert, update, delete on public.kv to authenticated;

drop policy if exists audit_log_read_active on public.audit_log;
create policy audit_log_read_active on public.audit_log for select to authenticated
  using ((select app_private.is_active_user()));
drop policy if exists app_delivery_state_read_active on public.app_delivery_state;
create policy app_delivery_state_read_active on public.app_delivery_state for select to authenticated
  using ((select app_private.is_active_user()));
drop policy if exists app_snapshots_read_active on public.app_snapshots;
create policy app_snapshots_read_active on public.app_snapshots for select to authenticated
  using ((select app_private.is_active_user()) and generation = (select public.current_delivery_generation()));
drop policy if exists app_snapshots_insert_active on public.app_snapshots;
create policy app_snapshots_insert_active on public.app_snapshots for insert to authenticated
  with check ((select app_private.is_active_user()) and (created_by is null or created_by = (select auth.uid()))
    and generation = (select public.current_delivery_generation()));
drop policy if exists app_trash_read_active on public.app_trash;
create policy app_trash_read_active on public.app_trash for select to authenticated
  using ((select app_private.is_active_user()) and generation = (select public.current_delivery_generation()));
drop policy if exists app_trash_insert_active on public.app_trash;
create policy app_trash_insert_active on public.app_trash for insert to authenticated
  with check ((select app_private.is_active_user()) and (deleted_by is null or deleted_by = (select auth.uid()))
    and generation = (select public.current_delivery_generation()));
drop policy if exists app_trash_update_active on public.app_trash;
create policy app_trash_update_active on public.app_trash for update to authenticated
  using ((select app_private.is_active_user()) and generation = (select public.current_delivery_generation()))
  with check ((select app_private.is_active_user()) and restored_at is not null
    and generation = (select public.current_delivery_generation()));
drop policy if exists app_operations_read_active on public.app_operations;
create policy app_operations_read_active on public.app_operations for select to authenticated
  using ((select app_private.is_active_user()) and generation = (select public.current_delivery_generation()));
drop policy if exists app_operations_insert_active on public.app_operations;
create policy app_operations_insert_active on public.app_operations for insert to authenticated
  with check ((select app_private.is_active_user()) and (actor_uid is null or actor_uid = (select auth.uid()))
    and generation = (select public.current_delivery_generation()));

-- Los nombres públicos anteriores ya no se usan como API/RPC. Los helpers
-- activos viven en app_private, fuera de los esquemas expuestos por PostgREST.
drop function if exists public.is_active_user();
drop function if exists public.is_admin();

commit;
