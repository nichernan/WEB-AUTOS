-- Suite de integración para correr SOLO con PRUEBAS-SEGURIDAD-AISLADAS.ps1.
-- Exige una base desechable llamada toto_audit_test y termina con ROLLBACK.
\set ON_ERROR_STOP on
begin;

do $$
begin
  if current_database() <> 'toto_audit_test' then
    raise exception 'FAIL: base insegura para pruebas: % (se exige toto_audit_test)', current_database();
  end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000099', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
insert into public.profiles(id,email,nombre,role,activo)
values ('00000000-0000-4000-8000-000000000099','fixture@example.test','Fixture activo','usuario',true);
insert into public.app_delivery_state(singleton,generation,label)
values (true,'00000000-0000-4000-8000-000000000088','Fixture aislado');
create temporary table test_ids(prefix text primary key) on commit drop;
insert into test_ids values ('isolated_' || replace(gen_random_uuid()::text, '-', ''));

-- A. INSERT registra la imagen completa posterior y el actor disponible.
do $$
declare p text; rid text;
begin
  select prefix into p from test_ids;
  rid := p || '_A';
  insert into public.vehicles(id, data) values (rid, jsonb_build_object('id',rid,'marca','TEST-A','modelo','Insertado','nota','fixture','_delivery_generation','00000000-0000-4000-8000-000000000088'));
  if not exists (select 1 from public.audit_log a where a.table_name='vehicles' and a.operation='INSERT'
      and a.record_id->>'id'=rid and a.before_data is null and a.after_data->>'id'=rid
      and a.after_data->'data'->>'modelo'='Insertado' and a.actor_uid='00000000-0000-4000-8000-000000000099'
      and a.db_role='authenticated') then raise exception 'FAIL A: INSERT no capturó after_data/actor/db_role'; end if;
  raise notice 'PASS A: INSERT individual con after_data completo';
end $$;

-- B. UPDATE guarda dos imágenes completas y diferentes.
do $$
declare p text; rid text; a record;
begin
  select prefix into p from test_ids; rid := p || '_A';
  update public.vehicles set data=jsonb_build_object('id',rid,'marca','TEST-A','modelo','Actualizado','nota','nuevo','_delivery_generation','00000000-0000-4000-8000-000000000088') where id=rid;
  select * into a from public.audit_log where table_name='vehicles' and operation='UPDATE' and record_id->>'id'=rid order by id desc limit 1;
  if a.id is null or a.before_data is null or a.after_data is null or a.before_data=a.after_data
      or a.before_data->'data'->>'modelo'<>'Insertado' or a.after_data->'data'->>'modelo'<>'Actualizado'
      or a.before_data->>'updated_at' is null or a.after_data->>'updated_at' is null then
    raise exception 'FAIL B: UPDATE no guardó before_data/after_data completos y distintos'; end if;
  raise notice 'PASS B: UPDATE antes/después completos y distintos';
end $$;

-- C. DELETE individual conserva todo el registro anterior.
do $$
declare p text; rid text; a record;
begin
  select prefix into p from test_ids; rid := p || '_A';
  delete from public.vehicles where id=rid;
  select * into a from public.audit_log where table_name='vehicles' and operation='DELETE' and record_id->>'id'=rid order by id desc limit 1;
  if a.id is null or a.before_data is null or a.after_data is not null
      or a.before_data->>'id'<>rid or a.before_data->'data'->>'modelo'<>'Actualizado'
      or a.before_data->>'updated_at' is null then raise exception 'FAIL C: DELETE no conservó before_data completo'; end if;
  raise notice 'PASS C: DELETE individual con before_data completo';
end $$;

-- D. DELETE masivo: 12 filas, una auditoría por ID y un transaction_id común.
do $$
declare p text; n integer; txns integer; complete_rows integer;
begin
  select prefix into p from test_ids;
  insert into public.vehicles(id,data)
    select p || '_D_' || lpad(g::text,2,'0'), jsonb_build_object('id',p || '_D_' || lpad(g::text,2,'0'),'marca','FICTICIO','modelo','Unidad '||g,'payload',jsonb_build_object('extra',g),'_delivery_generation','00000000-0000-4000-8000-000000000088')
    from generate_series(1,12) g;
  delete from public.vehicles where id like p || '_D_%';
  select count(*),count(distinct transaction_id),count(*) filter (where before_data ? 'updated_at' and before_data->'data'->'payload'->>'extra' is not null)
    into n,txns,complete_rows from public.audit_log where table_name='vehicles' and operation='DELETE' and record_id->>'id' like p || '_D_%';
  if n<>12 or txns<>1 or complete_rows<>12 then raise exception 'FAIL D: esperadas 12 filas completas y txid común; obtuve filas %, txid %, completas %',n,txns,complete_rows; end if;
  raise notice 'PASS D: DELETE masivo produjo 12 filas completas con transaction_id común';
end $$;

-- E. TRUNCATE captura cada fila existente, no solo un evento agregado.
do $$
declare p text; expected integer; n integer; txns integer; complete_rows integer;
begin
  select prefix into p from test_ids;
  insert into public.vehicles(id,data)
    select p || '_E_' || g, jsonb_build_object('id',p || '_E_' || g,'marca','FICTICIO-TRUNCATE','modelo','Fila '||g,'detalle',jsonb_build_array(g,'completo'),'_delivery_generation','00000000-0000-4000-8000-000000000088')
    from generate_series(1,5) g;
  select count(*) into expected from public.vehicles;
  truncate table public.vehicles;
  select count(*),count(distinct transaction_id),count(*) filter (where before_data ? 'updated_at' and before_data->'data'->'detalle' is not null)
    into n,txns,complete_rows from public.audit_log where table_name='vehicles' and operation='TRUNCATE';
  if n<>expected or txns<>1 or complete_rows<>expected then raise exception 'FAIL E: TRUNCATE debía guardar % filas completas/txid común; filas %, txid %, completas %',expected,n,txns,complete_rows; end if;
  raise notice 'PASS E: TRUNCATE registró las % filas completas individualmente',expected;
end $$;

-- F. La fecha de negocio se calcula en PostgreSQL con la zona horaria argentina.
do $$
declare sid uuid; day date;
begin
  insert into public.app_snapshots(created_at,label,state,source,generation)
    values ('2026-10-14 02:00:00+00','Prueba día argentino','{}','daily','00000000-0000-4000-8000-000000000088') returning id,snapshot_day into sid,day;
  if day<>date '2026-10-13' then raise exception 'FAIL F: 02:00 UTC debía pertenecer al 13/10 en Argentina; resultó %',day; end if;
  begin
    insert into public.app_snapshots(created_at,label,state,source,generation) values ('2026-10-14 02:30:00+00','Duplicado','{}','daily','00000000-0000-4000-8000-000000000088');
    raise exception 'FAIL F: se aceptó un segundo snapshot diario para el mismo día';
  exception when unique_violation then null;
  end;
  raise notice 'PASS F: snapshot_day Argentina=2026-10-13 e índice diario evita duplicados';
end $$;

-- G. Usuario autenticado puede leer, pero no modificar/borrar snapshots/auditoría/papelera.
do $$
begin
  if not has_table_privilege('authenticated','public.audit_log','SELECT')
    or has_table_privilege('authenticated','public.audit_log','UPDATE')
    or has_table_privilege('authenticated','public.audit_log','DELETE')
    or has_table_privilege('authenticated','public.audit_log','TRUNCATE') then raise exception 'FAIL G: permisos incorrectos para audit_log'; end if;
  if not has_table_privilege('authenticated','public.app_snapshots','SELECT')
    or has_table_privilege('authenticated','public.app_snapshots','UPDATE')
    or has_table_privilege('authenticated','public.app_snapshots','DELETE')
    or has_table_privilege('authenticated','public.app_snapshots','TRUNCATE') then raise exception 'FAIL G: permisos incorrectos para app_snapshots'; end if;
  if has_table_privilege('authenticated','public.app_trash','DELETE')
    or has_table_privilege('authenticated','public.app_trash','TRUNCATE')
    or has_column_privilege('authenticated','public.app_trash','data','UPDATE')
    or not has_column_privilege('authenticated','public.app_trash','restored_at','UPDATE') then raise exception 'FAIL G: permisos incorrectos para app_trash'; end if;
  if has_table_privilege('authenticated','public.app_operations','UPDATE')
    or has_table_privilege('authenticated','public.app_operations','DELETE')
    or has_table_privilege('authenticated','public.app_operations','TRUNCATE') then raise exception 'FAIL G: app_operations permite mutaciones'; end if;
  if not has_table_privilege('authenticated','public.app_delivery_state','SELECT')
    or has_table_privilege('authenticated','public.app_delivery_state','UPDATE')
    or has_table_privilege('authenticated','public.app_delivery_state','DELETE') then raise exception 'FAIL G: app_delivery_state no es solo lectura'; end if;
  raise notice 'PASS G: permisos API mínimos; auditoría/snapshots no mutables y papelera sin borrado';
end $$;

-- H. Los triggers append-only rechazan intentos de mutación incluso con el rol dueño.
do $$
begin
  insert into public.app_trash(id,entity,entity_id,label,data,deleted_at,generation) values ('test-trash','vehicle','test-v','Fixture','{}',now(),'00000000-0000-4000-8000-000000000088');
  insert into public.app_operations(action,entity,details,generation) values ('test','fixture','{}','00000000-0000-4000-8000-000000000088');
  begin update public.audit_log set db_role='tampered' where id=(select min(id) from public.audit_log); raise exception 'FAIL H: UPDATE audit_log permitido';
  exception when raise_exception then if sqlerrm <> 'audit_log es inmutable' then raise; end if; end;
  begin execute 'truncate table public.audit_log'; raise exception 'FAIL H: TRUNCATE audit_log permitido';
  exception when raise_exception then if sqlerrm <> 'audit_log es inmutable' then raise; end if; end;
  begin update public.app_snapshots set label='tampered' where source='daily'; raise exception 'FAIL H: UPDATE app_snapshots permitido';
  exception when raise_exception then if sqlerrm <> 'app_snapshots es append-only' then raise; end if; end;
  begin delete from public.app_snapshots where source='daily'; raise exception 'FAIL H: DELETE app_snapshots permitido';
  exception when raise_exception then if sqlerrm <> 'app_snapshots es append-only' then raise; end if; end;
  begin execute 'truncate table public.app_snapshots'; raise exception 'FAIL H: TRUNCATE app_snapshots permitido';
  exception when raise_exception then if sqlerrm <> 'app_snapshots es append-only' then raise; end if; end;
  begin delete from public.app_trash; raise exception 'FAIL H: DELETE app_trash permitido';
  exception when raise_exception then if sqlerrm <> 'La papelera no permite borrar registros' then raise; end if; end;
  begin execute 'truncate table public.app_trash'; raise exception 'FAIL H: TRUNCATE app_trash permitido';
  exception when raise_exception then if sqlerrm <> 'La papelera no permite truncado' then raise; end if; end;
  begin update public.app_trash set data='{"changed":true}'::jsonb; raise exception 'FAIL H: UPDATE app_trash.data permitido';
  exception when raise_exception then if sqlerrm <> 'Los datos originales de la papelera son inmutables' then raise; end if; end;
  begin update public.app_operations set action='tampered'; raise exception 'FAIL H: UPDATE app_operations permitido';
  exception when raise_exception then if sqlerrm <> 'app_operations es append-only' then raise; end if; end;
  begin delete from public.app_operations; raise exception 'FAIL H: DELETE app_operations permitido';
  exception when raise_exception then if sqlerrm <> 'app_operations es append-only' then raise; end if; end;
  begin execute 'truncate table public.app_operations'; raise exception 'FAIL H: TRUNCATE app_operations permitido';
  exception when raise_exception then if sqlerrm <> 'app_operations es append-only' then raise; end if; end;
  raise notice 'PASS H: triggers rechazaron UPDATE/DELETE/TRUNCATE prohibidos';
end $$;

-- I. Un cliente de una etapa anterior no puede volver a subir JSON local antiguo.
set local role authenticated;
do $$
begin
  begin
    insert into public.vehicles(id,data) values ('legacy-local-fixture','{"id":"legacy-local-fixture","marca":"DATO ANTIGUO"}'::jsonb);
    raise exception 'FAIL I: se aceptó una fila sin generación comercial';
  exception when others then
    if sqlerrm = 'FAIL I: se aceptó una fila sin generación comercial' then raise; end if;
  end;
  begin
    insert into public.kv(k,data) values ('legacy-meta-fixture','{"lastId":999}'::jsonb);
    raise exception 'FAIL I: se aceptaron metadatos kv sin generación comercial';
  exception when others then
    if sqlerrm = 'FAIL I: se aceptaron metadatos kv sin generación comercial' then raise; end if;
  end;
  raise notice 'PASS I: escrituras locales de negocio y kv sin generación rechazadas';
end $$;
reset role;

rollback;
\echo 'PASS: pruebas SQL aisladas A-I completadas; ROLLBACK aplicado, no quedan fixtures.'
