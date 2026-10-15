-- Corte comercial de entrega. SOLO para el proyecto WebTotoAuto confirmado.
-- Los conteos iniciales son precondiciones: si algo cambió, aborta sin limpiar.
-- Nunca modifica auth.users ni profiles; registra cada DELETE en audit_log.
begin;

lock table public.vehicles, public.history, public.reminders,
  public.fixed_expenses, public.kv, public.app_delivery_state,
  public.app_snapshots, public.app_trash, public.app_operations,
  public.audit_log in share row exclusive mode;

do $$
declare
  v_generation uuid := gen_random_uuid();
  v_snapshot_id uuid := gen_random_uuid();
  v_now timestamptz;
  v_vehicles integer;
  v_history integer;
  v_reminders integer;
  v_fixed_expenses integer;
  v_kv integer;
begin
  -- Guardas de identidad y de estado; diferencias requieren detener y revisar.
  if (select count(*) from auth.users) <> 1
    or (select count(*) from public.profiles) <> 1
    or (select count(*) from public.profiles where activo and role = 'usuario') <> 1 then
    raise exception 'ABORTADO: cambió el estado de cuentas/perfiles respecto de la auditoría previa';
  end if;
  if (select count(*) from public.vehicles) <> 4
    or (select count(*) from public.history) <> 20
    or (select count(*) from public.reminders) <> 0
    or (select count(*) from public.fixed_expenses) <> 3
    or (select count(*) from public.kv) <> 1
    or not exists (select 1 from public.kv where k = 'meta') then
    raise exception 'ABORTADO: cambió el conjunto comercial; no se borró ninguna fila';
  end if;
  if (select count(*) from public.audit_log) <> 0
    or (select count(*) from public.app_snapshots) <> 0
    or (select count(*) from public.app_trash) <> 0
    or (select count(*) from public.app_operations) <> 0
    or (select count(*) from public.app_delivery_state) <> 0 then
    raise exception 'ABORTADO: las tablas de seguridad ya contienen datos; revisar antes del corte';
  end if;

  delete from public.vehicles;
  get diagnostics v_vehicles = row_count;
  delete from public.history;
  get diagnostics v_history = row_count;
  delete from public.reminders;
  get diagnostics v_reminders = row_count;
  delete from public.fixed_expenses;
  get diagnostics v_fixed_expenses = row_count;
  delete from public.kv;
  get diagnostics v_kv = row_count;

  if v_vehicles <> 4 or v_history <> 20 or v_reminders <> 0
    or v_fixed_expenses <> 3 or v_kv <> 1 then
    raise exception 'ABORTADO: las cantidades borradas no coinciden con las precondiciones';
  end if;
  if (select count(*) from public.audit_log where transaction_id = txid_current()) <> 28
    or (select count(*) from public.audit_log where transaction_id = txid_current()
      and operation = 'DELETE' and before_data is not null) <> 28 then
    raise exception 'ABORTADO: la auditoría no capturó todas las filas; transacción revertida';
  end if;

  -- La generación se instala después de borrar; el cutoff separa esos eventos
  -- pre-entrega del uso nuevo y habilita únicamente filas etiquetadas por etapa.
  insert into public.app_delivery_state(singleton, generation, label)
  values (true, v_generation, 'Estado inicial — Entrega al dueño');

  v_now := clock_timestamp();
  insert into public.app_snapshots(id, created_at, label, state, summary, source, generation)
  values (
    v_snapshot_id,
    v_now,
    'Estado inicial — Entrega al dueño',
    jsonb_build_object(
      'schema', 1,
      'vehicles', '[]'::jsonb,
      'history', '[]'::jsonb,
      'reminders', '[]'::jsonb,
      'fixedExpenses', '[]'::jsonb,
      'trash', '[]'::jsonb,
      'settings', jsonb_build_object('dolarActual', 1600, 'diasStockAlerta', 60, 'cuotaProximaDias', 7),
      'meta', jsonb_build_object(
        'createdAt', floor(extract(epoch from v_now) * 1000)::bigint,
        'lastId', 0,
        'lastBackupAt', null
      )
    ),
    jsonb_build_object('vehicles',0,'history',0,'reminders',0,'fixed_expenses',0,'trash',0),
    'delivery_initial',
    v_generation
  );

  insert into public.app_operations(actor_uid, action, entity, details, generation)
  values (
    null,
    'entrega_inicial',
    'estado_completo',
    jsonb_build_object(
      'phase', 'limpieza_pre_entrega',
      'label', 'Estado inicial — Entrega al dueño',
      'snapshot_id', v_snapshot_id,
      'generation', v_generation,
      'deleted', jsonb_build_object(
        'vehicles', v_vehicles, 'history', v_history,
        'reminders', v_reminders, 'fixed_expenses', v_fixed_expenses, 'kv', v_kv
      )
    ),
    v_generation
  );

  if exists (select 1 from public.vehicles)
    or exists (select 1 from public.history)
    or exists (select 1 from public.reminders)
    or exists (select 1 from public.fixed_expenses)
    or exists (select 1 from public.kv)
    or exists (select 1 from public.app_trash) then
    raise exception 'ABORTADO: el estado comercial no quedó vacío; transacción revertida';
  end if;
  if not exists (select 1 from public.app_snapshots where id = v_snapshot_id
      and label = 'Estado inicial — Entrega al dueño'
      and state->'vehicles' = '[]'::jsonb and state->'history' = '[]'::jsonb
      and state->'reminders' = '[]'::jsonb and state->'fixedExpenses' = '[]'::jsonb
      and state->'trash' = '[]'::jsonb)
    or not exists (select 1 from public.app_delivery_state where generation = v_generation) then
    raise exception 'ABORTADO: no se creó correctamente el snapshot inicial';
  end if;
end $$;

commit;
