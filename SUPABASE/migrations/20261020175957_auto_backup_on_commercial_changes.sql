-- Snapshots remotos verificados tras diez minutos sin cambios comerciales.
-- Migration aditiva: no toca filas de negocio ni snapshots existentes.
begin;

create table if not exists app_private.backup_state (
  generation uuid primary key,
  revision bigint not null default 0,
  verified_revision bigint not null default 0,
  dirty_since timestamptz,
  latest_snapshot_id uuid,
  latest_snapshot_at timestamptz,
  backup_failed_revision bigint,
  backup_failed_at timestamptz,
  check (revision >= verified_revision)
);
revoke all on app_private.backup_state from public, anon, authenticated, service_role;
insert into app_private.backup_state(generation)
select generation from public.app_delivery_state where singleton = true
on conflict (generation) do nothing;

create or replace function app_private.bump_backup_revision(p_generation uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_generation is null then return; end if;
  insert into app_private.backup_state(generation,revision,verified_revision,dirty_since)
  values (p_generation,1,0,pg_catalog.clock_timestamp())
  on conflict (generation) do update set
    revision=app_private.backup_state.revision+1,
    dirty_since=pg_catalog.clock_timestamp(),
    backup_failed_revision=null, backup_failed_at=null;
end;
$$;
revoke all on function app_private.bump_backup_revision(uuid) from public, anon, authenticated, service_role;

create or replace function app_private.track_commercial_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old jsonb; v_new jsonb; v_generation uuid;
begin
  if tg_op <> 'INSERT' then v_old := pg_catalog.to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := pg_catalog.to_jsonb(new); end if;
  if tg_table_name = 'kv' and coalesce(v_new ->> 'k',v_old ->> 'k') = 'meta' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_table_name = 'app_trash' then
    if tg_op = 'DELETE' then return old; end if;
    v_generation := (v_new ->> 'generation')::uuid;
    if tg_op = 'UPDATE' and (v_old - 'generation') is not distinct from (v_new - 'generation') then return new; end if;
  else
    if tg_table_name in ('vehicles','history','reminders','fixed_expenses') then
      v_generation := coalesce((v_new -> 'data' ->> '_delivery_generation')::uuid,(v_old -> 'data' ->> '_delivery_generation')::uuid);
    else
      v_generation := coalesce((v_new ->> 'generation')::uuid,(v_old ->> 'generation')::uuid);
    end if;
    if tg_op = 'UPDATE' then
      if tg_table_name in ('vehicles','history','reminders','fixed_expenses') then
        v_old := (v_old -> 'data') - '_delivery_generation';
        v_new := (v_new -> 'data') - '_delivery_generation';
        if tg_table_name = 'history' then
          v_old := v_old || pg_catalog.jsonb_build_object('_event_ts',pg_catalog.to_jsonb(old) -> 'ts');
          v_new := v_new || pg_catalog.jsonb_build_object('_event_ts',pg_catalog.to_jsonb(new) -> 'ts');
        end if;
      elsif tg_table_name = 'kv' then
        v_old := v_old -> 'data'; v_new := v_new -> 'data';
      end if;
      if v_old is not distinct from v_new then return new; end if;
    end if;
  end if;
  perform app_private.bump_backup_revision(v_generation);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function app_private.track_commercial_change() from public, anon, authenticated, service_role;

create or replace function app_private.block_unbacked_commercial_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_generation uuid; v_state record;
begin
  if tg_op = 'DELETE' then
    if tg_table_name in ('vehicles','history','reminders','fixed_expenses') then
      v_generation := (pg_catalog.to_jsonb(old) -> 'data' ->> '_delivery_generation')::uuid;
    else
      v_generation := (pg_catalog.to_jsonb(old) ->> 'generation')::uuid;
    end if;
  elsif tg_table_name = 'app_trash' then
    v_generation := (pg_catalog.to_jsonb(new) ->> 'generation')::uuid;
  elsif tg_table_name in ('vehicles','history','reminders','fixed_expenses') then
    v_generation := (pg_catalog.to_jsonb(new) -> 'data' ->> '_delivery_generation')::uuid;
  else
    v_generation := (pg_catalog.to_jsonb(new) ->> 'generation')::uuid;
  end if;
  select revision,verified_revision,dirty_since,backup_failed_revision into v_state
    from app_private.backup_state where generation=v_generation;
  if found and v_state.revision > v_state.verified_revision and
     (v_state.backup_failed_revision=v_state.revision or
      v_state.dirty_since <= pg_catalog.clock_timestamp()-interval '10 minutes') then
    raise exception 'Los cambios anteriores todavía no tienen una copia verificada. Completá el respaldo antes de seguir modificando.' using errcode='55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function app_private.block_unbacked_commercial_change() from public, anon, authenticated, service_role;

create or replace function app_private.track_commercial_truncate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_generation uuid;
begin
  select generation into v_generation from public.app_delivery_state where singleton=true;
  perform app_private.bump_backup_revision(v_generation);
  return null;
end;
$$;
revoke all on function app_private.track_commercial_truncate() from public, anon, authenticated, service_role;

do $$ declare t text; begin
  foreach t in array array['vehicles','history','reminders','fixed_expenses','kv'] loop
    execute pg_catalog.format('drop trigger if exists app_backup_write_guard on public.%I',t);
    execute pg_catalog.format('create trigger app_backup_write_guard before insert or update or delete on public.%I for each row execute function app_private.block_unbacked_commercial_change()',t);
    execute pg_catalog.format('drop trigger if exists app_backup_revision_row on public.%I',t);
    execute pg_catalog.format('create trigger app_backup_revision_row after insert or update or delete on public.%I for each row execute function app_private.track_commercial_change()',t);
    execute pg_catalog.format('drop trigger if exists app_backup_revision_truncate on public.%I',t);
    execute pg_catalog.format('create trigger app_backup_revision_truncate after truncate on public.%I for each statement execute function app_private.track_commercial_truncate()',t);
  end loop;
end $$;
drop trigger if exists app_backup_write_guard on public.app_trash;
create trigger app_backup_write_guard before insert or update on public.app_trash for each row execute function app_private.block_unbacked_commercial_change();
drop trigger if exists app_backup_revision_row on public.app_trash;
create trigger app_backup_revision_row after insert or update on public.app_trash for each row execute function app_private.track_commercial_change();

create or replace function app_private.get_backup_status()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_generation uuid; v_state record;
begin
  if auth.uid() is null or not app_private.is_active_user() then raise exception 'Se requiere una sesión activa.' using errcode='42501'; end if;
  select generation into v_generation from public.app_delivery_state where singleton=true;
  select * into v_state from app_private.backup_state where generation=v_generation;
  if not found then return pg_catalog.jsonb_build_object('revision',0,'verified_revision',0,'dirty_since',null,'latest_snapshot_id',null,'latest_snapshot_at',null,'needs_backup',false,'blocked',false); end if;
  return pg_catalog.jsonb_build_object('generation',v_generation,'revision',v_state.revision,'verified_revision',v_state.verified_revision,
    'dirty_since',v_state.dirty_since,'latest_snapshot_id',v_state.latest_snapshot_id,'latest_snapshot_at',v_state.latest_snapshot_at,
    'needs_backup',v_state.revision>v_state.verified_revision,
    'blocked',v_state.revision>v_state.verified_revision and (v_state.backup_failed_revision=v_state.revision or v_state.dirty_since<=pg_catalog.clock_timestamp()-interval '10 minutes'));
end;
$$;
revoke all on function app_private.get_backup_status() from public, anon, authenticated, service_role;
grant execute on function app_private.get_backup_status() to authenticated;
create or replace function public.app_backup_status()
returns jsonb language sql security invoker set search_path = '' as $$ select app_private.get_backup_status() $$;
revoke all on function public.app_backup_status() from public, anon, authenticated, service_role;
grant execute on function public.app_backup_status() to authenticated;

create or replace function app_private.create_verified_snapshot(p_expected_revision bigint,p_label text,p_source text,p_only_if_pending boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_generation uuid; v_uid uuid; v_state app_private.backup_state%rowtype; v_snapshot_id uuid; v_created_at timestamptz; v_payload jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null or not app_private.is_active_user() then raise exception 'Se requiere una sesión activa.' using errcode='42501'; end if;
  if p_source not in ('activity','safety','application') then raise exception 'Tipo de snapshot no permitido.' using errcode='22023'; end if;
  if p_label is null or pg_catalog.length(pg_catalog.btrim(p_label)) not between 1 and 120 then raise exception 'Etiqueta de snapshot inválida.' using errcode='22023'; end if;
  select generation into v_generation from public.app_delivery_state where singleton=true;
  select * into v_state from app_private.backup_state where generation=v_generation for update;
  if not found then raise exception 'No se encontró el estado de respaldo de la generación activa.' using errcode='55000'; end if;
  if v_state.revision<>p_expected_revision then return pg_catalog.jsonb_build_object('status','stale','revision',v_state.revision,'verified_revision',v_state.verified_revision); end if;
  if p_only_if_pending and v_state.revision=v_state.verified_revision then
    return pg_catalog.jsonb_build_object('status','already_saved','revision',v_state.revision,'snapshot_id',v_state.latest_snapshot_id,'created_at',v_state.latest_snapshot_at);
  end if;
  if p_only_if_pending and v_state.dirty_since > pg_catalog.clock_timestamp()-interval '10 minutes' then
    return pg_catalog.jsonb_build_object('status','too_early','revision',v_state.revision,'retry_at',v_state.dirty_since+interval '10 minutes');
  end if;
  select pg_catalog.jsonb_build_object(
    'schema',1,
    'vehicles',coalesce((select pg_catalog.jsonb_agg(data-'_delivery_generation' order by id) from public.vehicles where data->>'_delivery_generation'=v_generation::text),'[]'::jsonb),
    'history',coalesce((select pg_catalog.jsonb_agg(data-'_delivery_generation' order by ts,id) from public.history where data->>'_delivery_generation'=v_generation::text),'[]'::jsonb),
    'reminders',coalesce((select pg_catalog.jsonb_agg(data-'_delivery_generation' order by id) from public.reminders where data->>'_delivery_generation'=v_generation::text),'[]'::jsonb),
    'fixedExpenses',coalesce((select pg_catalog.jsonb_agg(data-'_delivery_generation' order by id) from public.fixed_expenses where data->>'_delivery_generation'=v_generation::text),'[]'::jsonb),
    'settings',coalesce((select data from public.kv where k='settings' and generation=v_generation),'{}'::jsonb),
    'meta',coalesce((select data from public.kv where k='meta' and generation=v_generation),'{}'::jsonb),
    'trash',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'entity',entity,'entityId',entity_id,'parentId',parent_id,'label',label,'data',data,
      'deletedAt',pg_catalog.floor(extract(epoch from deleted_at)*1000),'deletedBy',deleted_by,
      'restoredAt',case when restored_at is null then null else pg_catalog.floor(extract(epoch from restored_at)*1000) end) order by deleted_at desc,id)
      from public.app_trash where generation=v_generation),'[]'::jsonb)
  ) into v_payload;
  insert into public.app_snapshots(created_at,label,created_by,state,summary,source,generation)
  values(pg_catalog.clock_timestamp(),p_label,v_uid,v_payload,
    pg_catalog.jsonb_build_object('vehicles',pg_catalog.jsonb_array_length(v_payload->'vehicles'),'history',pg_catalog.jsonb_array_length(v_payload->'history'),
      'reminders',pg_catalog.jsonb_array_length(v_payload->'reminders'),'fixed_expenses',pg_catalog.jsonb_array_length(v_payload->'fixedExpenses')),p_source,v_generation)
  returning id,created_at into v_snapshot_id,v_created_at;
  update app_private.backup_state set verified_revision=v_state.revision,dirty_since=null,latest_snapshot_id=v_snapshot_id,latest_snapshot_at=v_created_at,
    backup_failed_revision=null,backup_failed_at=null where generation=v_generation and revision=v_state.revision;
  if not found then raise exception 'El estado cambió durante el snapshot; no se marcó como respaldado.' using errcode='40001'; end if;
  return pg_catalog.jsonb_build_object('status','saved','revision',v_state.revision,'snapshot_id',v_snapshot_id,'created_at',v_created_at);
end;
$$;
revoke all on function app_private.create_verified_snapshot(bigint,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function app_private.create_verified_snapshot(bigint,text,text,boolean) to authenticated;
create or replace function public.app_create_verified_snapshot(p_expected_revision bigint,p_label text,p_source text,p_only_if_pending boolean)
returns jsonb language sql security invoker set search_path = '' as $$ select app_private.create_verified_snapshot($1,$2,$3,$4) $$;
revoke all on function public.app_create_verified_snapshot(bigint,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function public.app_create_verified_snapshot(bigint,text,text,boolean) to authenticated;

commit;
