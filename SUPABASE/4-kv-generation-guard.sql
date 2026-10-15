-- Bloquea a clientes antiguos para que no resuciten settings/meta desde kv.
-- Aditiva, no reescribe ni elimina filas existentes.
begin;

alter table public.kv add column if not exists generation uuid;

drop trigger if exists require_delivery_generation on public.kv;
create trigger require_delivery_generation
before insert or update on public.kv
for each row execute function public.require_current_delivery_generation();

drop policy if exists p_kv_all on public.kv;
create policy p_kv_all on public.kv for all to authenticated
  using ((select app_private.is_active_user())
    and generation = (select public.current_delivery_generation()))
  with check ((select app_private.is_active_user())
    and generation = (select public.current_delivery_generation()));

revoke all on public.kv from public, anon, service_role;
grant select, insert, update, delete on public.kv to authenticated;

commit;
