-- Prueba de triggers y RPC del snapshot automático. SOLO en toto_audit_test.
\set ON_ERROR_STOP on
begin;
do $$ begin
  if current_database() <> 'toto_audit_test' then raise exception 'FAIL: base insegura'; end if;
end $$;
insert into public.profiles(id,email,nombre,role,activo)
values ('00000000-0000-4000-8000-000000000099','backup@example.test','Backup fixture','usuario',true)
on conflict (id) do nothing;
insert into public.app_delivery_state(singleton,generation,label)
values (true,'00000000-0000-4000-8000-000000000088','Fixture backup')
on conflict (singleton) do nothing;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;

do $$ begin
  if not has_function_privilege('authenticated','public.app_backup_status()','EXECUTE')
     or not has_function_privilege('authenticated','public.app_create_verified_snapshot(bigint,text,text,boolean)','EXECUTE')
     or has_function_privilege('anon','public.app_backup_status()','EXECUTE')
     or has_function_privilege('anon','public.app_create_verified_snapshot(bigint,text,text,boolean)','EXECUTE')
     or has_table_privilege('authenticated','app_private.backup_state','SELECT')
     or has_table_privilege('authenticated','app_private.backup_state','UPDATE') then
    raise exception 'FAIL: privilegios del respaldo no son mínimos';
  end if;
  raise notice 'PASS: RPC solo autenticado; tabla de estado no accesible desde API';
end $$;

-- Metadatos de interfaz (p. ej. la hora de exportación) no son cambio comercial.
insert into public.kv(k,data,generation) values ('meta','{"lastBackupAt":1}', '00000000-0000-4000-8000-000000000088');
do $$ declare s jsonb; begin
  s := public.app_backup_status();
  if (s->>'revision')::bigint<>0 or (s->>'needs_backup')::boolean then raise exception 'FAIL: metadato técnico marcado como cambio comercial'; end if;
  raise notice 'PASS: kv.meta técnico no dispara snapshot comercial';
end $$;

-- Un alta marca la revisión como pendiente; la función toma el estado remoto.
insert into public.vehicles(id,data) values ('backup-fixture-vehicle',
  '{"id":"backup-fixture-vehicle","marca":"TEST","modelo":"A","_delivery_generation":"00000000-0000-4000-8000-000000000088"}'::jsonb);
do $$ declare s jsonb; result jsonb; begin
  s := public.app_backup_status();
  result := public.app_create_verified_snapshot((s->>'revision')::bigint,'Todavía temprano','activity',true);
  if result->>'status'<>'too_early' then raise exception 'FAIL A: el servidor aceptó snapshot antes de diez minutos: %',result; end if;
  raise notice 'PASS A: el servidor exige los diez minutos completos';
end $$;
reset role;
update app_private.backup_state set dirty_since=clock_timestamp()-interval '11 minutes'
  where generation='00000000-0000-4000-8000-000000000088';
set local role authenticated;
do $$ declare s jsonb; r bigint; saved jsonb; snap jsonb; begin
  s := public.app_backup_status(); r := (s->>'revision')::bigint;
  if not (s->>'needs_backup')::boolean or r < 1 then raise exception 'FAIL A: INSERT no quedó pendiente: %',s; end if;
  saved := public.app_create_verified_snapshot(r,'Fixture actividad A','activity',true);
  if saved->>'status'<>'saved' then raise exception 'FAIL B: snapshot no se guardó: %',saved; end if;
  select state into snap from public.app_snapshots where id=(saved->>'snapshot_id')::uuid;
  if snap->'vehicles'->0->>'modelo'<>'A' or snap ? 'profiles' or snap ? 'credentials' then raise exception 'FAIL C: contenido incompleto o datos de autenticación en snapshot: %',snap; end if;
  s := public.app_backup_status();
  if (s->>'needs_backup')::boolean or (s->>'verified_revision')::bigint<>r then raise exception 'FAIL D: revisión no se confirmó'; end if;
  raise notice 'PASS A-D: cambio confirmado, snapshot remoto completo y revisión verificada';
end $$;

-- Sin cambio, la operación idempotente no inserta una copia duplicada.
do $$ declare s jsonb; before_count bigint; result jsonb; after_count bigint; begin
  select count(*) into before_count from public.app_snapshots where source='activity';
  s := public.app_backup_status();
  result := public.app_create_verified_snapshot((s->>'revision')::bigint,'Duplicado','activity',true);
  select count(*) into after_count from public.app_snapshots where source='activity';
  if result->>'status'<>'already_saved' or after_count<>before_count then raise exception 'FAIL E: snapshot duplicado sin cambios: %',result; end if;
  raise notice 'PASS E: sin cambios no crea snapshots duplicados';
end $$;

-- UPDATE comercial incrementa la revisión y la imagen posterior reemplaza la anterior.
update public.vehicles set data=jsonb_set(data,'{modelo}','"B"') where id='backup-fixture-vehicle';
reset role;
update app_private.backup_state set dirty_since=clock_timestamp()-interval '11 minutes'
  where generation='00000000-0000-4000-8000-000000000088';
set local role authenticated;
do $$ declare s jsonb; result jsonb; snapshot_state jsonb; begin
  s := public.app_backup_status();
  if not (s->>'needs_backup')::boolean then raise exception 'FAIL F: UPDATE no marcó pendiente'; end if;
  result := public.app_create_verified_snapshot((s->>'revision')::bigint,'Fixture actividad B','activity',true);
  if result->>'status'<>'saved' then raise exception 'FAIL G: no guardó B: %',result; end if;
  select state into snapshot_state from public.app_snapshots where id=(result->>'snapshot_id')::uuid;
  if snapshot_state->'vehicles'->0->>'modelo'<>'B' then raise exception 'FAIL H: snapshot no contiene B'; end if;
  raise notice 'PASS F-H: UPDATE generó nuevo snapshot con estado B';
end $$;

-- Cambiar durante el intento invalida la revisión esperada; el servidor no afirma que esté al día.
do $$ declare s jsonb; result jsonb; begin
  s := public.app_backup_status();
  update public.vehicles set data=jsonb_set(data,'{modelo}','"C"') where id='backup-fixture-vehicle';
  result := public.app_create_verified_snapshot((s->>'revision')::bigint,'Revisión vieja','activity',true);
  if result->>'status'<>'stale' then raise exception 'FAIL I: no detectó revisión desactualizada: %',result; end if;
  raise notice 'PASS I: snapshot con revisión vieja no queda marcado como actual';
end $$;

-- Cumplidos diez minutos, los triggers bloquean cambios hasta el snapshot; luego liberan.
reset role;
update app_private.backup_state set dirty_since=clock_timestamp()-interval '11 minutes'
  where generation='00000000-0000-4000-8000-000000000088';
set local role authenticated;
do $$ declare blocked boolean; s jsonb; result jsonb; begin
  begin
    update public.vehicles set data=jsonb_set(data,'{modelo}','"Bloqueado"') where id='backup-fixture-vehicle';
    raise exception 'FAIL J: escritura permitida sin copia verificada';
  exception when sqlstate '55000' then null;
  end;
  s := public.app_backup_status();
  if not (s->>'blocked')::boolean then raise exception 'FAIL J: estado no aparece bloqueado'; end if;
  result := public.app_create_verified_snapshot((s->>'revision')::bigint,'Reintento fixture','activity',true);
  if result->>'status'<>'saved' then raise exception 'FAIL K: no se pudo resolver bloqueo: %',result; end if;
  update public.vehicles set data=jsonb_set(data,'{modelo}','"Permitido"') where id='backup-fixture-vehicle';
  s := public.app_backup_status();
  if (s->>'verified_revision')::bigint <> (result->>'revision')::bigint then raise exception 'FAIL K: revisión escrita después del respaldo no quedó pendiente'; end if;
  result := public.app_create_verified_snapshot((s->>'revision')::bigint,'Antes de operación fixture','safety',false);
  if result->>'status'<>'saved' or not exists(select 1 from public.app_snapshots where id=(result->>'snapshot_id')::uuid and source='safety') then
    raise exception 'FAIL L: backup previo obligatorio no se creó'; end if;
  raise notice 'PASS J-L: barrera por fallo, reintento verificado y snapshot previo a operación';
end $$;

reset role;
rollback;
\echo 'PASS: pruebas de backup automático completadas; fixtures y snapshots de prueba revertidos.'
