/* ============================================================================
 * sync.js  —  Sincroniza el estado con Supabase (carga + tiempo real + guardado)
 * ----------------------------------------------------------------------------
 * Estrategia: cada entidad (vehículo, movimiento, recordatorio, gasto fijo) es
 * una fila con su objeto completo en JSON. Al cambiar algo localmente se hace
 * un "diff" contra la última versión sincronizada y se suben sólo los cambios.
 * Realtime avisa de los cambios de otros usuarios y se aplican al estado local.
 * ==========================================================================*/
(function () {
  'use strict';
  if (!App.sb) { App.data = null; return; }
  var sb = App.sb, store = App.store;

  var shadow = null;           // clon del estado tal como está en la nube
  var pushTimer = null;
  var applyingRemote = false;
  var TABLES = ['vehicles', 'history', 'reminders', 'fixed_expenses'];
  var ARR = { vehicles: 'vehicles', history: 'history', reminders: 'reminders', fixed_expenses: 'fixedExpenses' };
  var pendingMigration = null;
  var BASE_KEY = 'paginaToto:syncBase';
  var GENERATION_KEY = 'paginaToto:businessGeneration';
  var PENDING_MASS_KEY = 'paginaToto:pendingMassSync';
  var PENDING_BULK_KEY = 'paginaToto:pendingBulkOperation';
  var MIN_BULK_EXISTING_UPDATES = 5;
  var businessGeneration = null;
  var generationReady = false;
  var deliveryLabel = null;
  var deliveryEstablishedAt = null;
  var offlineMode = false;
  var reconnecting = false;
  var channel = null;
  var safetyAvailable = false;
  var deletionApprovalPending = false;
  var approvedMassChangeFingerprint = null;
  var pendingMassSync = null;
  var pendingBulkOperation = null;
  var backupAvailable = false;
  var backupStatus = null;
  var backupTimer = null;
  var backupPollTimer = null;
  var backupAttempting = false;
  var backupBlocked = false;
  var backupBlockMessage = '';
  var backupOverlay = null;
  var BACKUP_FAILURE_KEY = 'paginaToto:backupFailure';

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function j(o) { return JSON.stringify(o); }
  function businessDateKey(value) {
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value || new Date());
    var p = {}; parts.forEach(function (x) { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
  }

  /* ------------------------------- carga ------------------------------ */
  function probeSafety() {
    return Promise.all(['audit_log','app_snapshots','app_trash','app_operations','app_delivery_state'].map(function (t) {
      return sb.from(t).select('*').limit(0);
    })).then(function (rs) {
      safetyAvailable = rs.every(function (r) { return !r.error; });
      if (!safetyAvailable) console.warn('Auditoría/papelera/snapshots remotos requieren aplicar SUPABASE/2-seguridad-y-recuperacion.sql.');
      return sb.rpc('app_backup_status').then(function (r) {
        backupAvailable = safetyAvailable && !r.error;
        if (!backupAvailable) console.warn('Falta la migración de snapshots automáticos por cambios.');
      });
    }).catch(function () { safetyAvailable = false; backupAvailable = false; });
  }

  function loadAll() {
    return probeSafety().then(function () {
      return sb.from('app_delivery_state').select('generation,label,established_at').eq('singleton', true).maybeSingle();
    }).then(function (r) {
      if (r.error) throw r.error;
      if (!r.data || !r.data.generation) {
        generationReady = false;
        throw new Error('No existe una etapa comercial activa; la sincronización quedó bloqueada.');
      }
      var previousGeneration = null;
      try { previousGeneration = localStorage.getItem(GENERATION_KEY); } catch (e) {}
      businessGeneration = r.data.generation;
      deliveryLabel = r.data.label || null;
      deliveryEstablishedAt = r.data.established_at ? new Date(r.data.established_at).getTime() : null;
      generationReady = true;
      if (previousGeneration !== businessGeneration) {
        // Solo se descartan datos/cachés comerciales. Auth y preferencias quedan intactos.
        try {
          localStorage.removeItem(store.STORAGE_KEY);
          localStorage.removeItem(BASE_KEY);
          localStorage.removeItem('paginaToto:snapshots');
          localStorage.removeItem(PENDING_MASS_KEY);
          localStorage.removeItem(PENDING_BULK_KEY);
          localStorage.setItem(GENERATION_KEY, businessGeneration);
          pendingMassSync = null;
          pendingBulkOperation = null;
        } catch (e) { throw new Error('No se pudo invalidar el estado comercial local anterior.'); }
      } else {
        pendingMassSync = readPendingMassSync();
        pendingBulkOperation = readPendingBulkOperation();
        if (!pendingBulkOperation && pendingMassSync && pendingMassSync.bulkOperation) pendingBulkOperation = pendingMassSync.bulkOperation;
        if (pendingMassSync && pendingMassSync.generation !== businessGeneration) {
          clearPendingMassSync();
        }
        if (pendingBulkOperation && pendingBulkOperation.generation !== businessGeneration) {
          clearPendingBulkOperation();
        }
      }
      return Promise.all([
      sb.from('vehicles').select('data'),
      sb.from('history').select('data'),
      sb.from('reminders').select('data'),
      sb.from('fixed_expenses').select('data'),
      sb.from('kv').select('k,data'),
      safetyAvailable ? sb.from('app_trash').select('*') : Promise.resolve({ data: [], error: null })
    ]);
    }).then(function (res) {
      res.forEach(function (r) { if (r.error) throw r.error; });
      var st = store.blankState();
      st.vehicles = (res[0].data || []).map(function (r) { return fromCloudData(r.data); });
      st.history = (res[1].data || []).map(function (r) { return fromCloudData(r.data); });
      st.reminders = (res[2].data || []).map(function (r) { return fromCloudData(r.data); });
      st.fixedExpenses = (res[3].data || []).map(function (r) { return fromCloudData(r.data); });
      st.trash = (res[5].data || []).map(function (r) { return { id: r.id, entity: r.entity, entityId: r.entity_id, parentId: r.parent_id,
        label: r.label, data: r.data, deletedAt: new Date(r.deleted_at).getTime(), deletedBy: r.deleted_by,
        restoredAt: r.restored_at ? new Date(r.restored_at).getTime() : null }; });
      (res[4].data || []).forEach(function (r) {
        if (r.k === 'settings') st.settings = Object.assign(st.settings, r.data || {});
        if (r.k === 'meta') st.meta = Object.assign(st.meta, r.data || {});
      });

      // La hidratación normaliza campos del dominio (defaults, arrays y datos
      // derivados). La base de comparación debe usar esa misma forma para que
      // un simple load no se convierta en un lote de UPDATE al primer guardado.
      var remote = store.migrate(clone(st));
      var cloudState = clone(remote);
      var local = null;
      try { local = JSON.parse(localStorage.getItem(store.STORAGE_KEY) || 'null'); } catch (e) {}
      var pendingRebased = false;
      if (pendingMassSync && pendingMassSync.state) {
        // Reaplicar sobre la descarga remota más reciente los cambios que se
        // cancelaron. Así una confirmación posterior no pisa ediciones remotas
        // llegadas mientras el lote estaba pendiente.
        var pendingLocal = local && Array.isArray(local.vehicles) ? local : pendingMassSync.state;
        var pendingBase = pendingMassSync.base || readBaseState() || cloudState;
        st = mergeOfflineChanges(clone(remote), pendingLocal, pendingBase);
        local = st;
        pendingRebased = true;
        try { localStorage.setItem(store.STORAGE_KEY, JSON.stringify(st)); } catch (e) {}
      } else if (pendingBulkOperation && (pendingBulkOperation.state || (local && Array.isArray(local.vehicles)))) {
        var bulkLocal = pendingBulkOperation.state || local;
        var bulkBase = pendingBulkOperation.base || readBaseState() || cloudState;
        st = mergeOfflineChanges(clone(remote), bulkLocal, bulkBase);
        local = st;
        pendingRebased = true;
        try { localStorage.setItem(store.STORAGE_KEY, JSON.stringify(st)); } catch (e) {}
      }
      if (local && Array.isArray(local.trash)) {
        var remoteTrash = {}; (st.trash || []).forEach(function (x) { remoteTrash[x.id] = x; });
        local.trash.forEach(function (x) {
          var current = remoteTrash[x.id];
          if (!current) { st.trash.push(x); remoteTrash[x.id] = x; }
          else if (!current.restoredAt && x.restoredAt) { current.restoredAt = x.restoredAt; }
        });
      }
      if (offlineMode && local && !pendingRebased) st = mergeOfflineChanges(remote, local);

      // Nunca importar automáticamente localStorage hacia una etapa ya inicializada.
      pendingMigration = null;

      applyingRemote = true;
      try { store.hydrate(st); } finally { applyingRemote = false; }
      shadow = clone(cloudState);
      if (!offlineMode || !local) saveBase(shadow);
      if (offlineMode) {
        offlineMode = false;
      }
      subscribe();
      if (safetyAvailable) return flush(store.getState()).then(function () { return refreshBackupStatus(); });
    });
  }

  function fromCloudData(data) {
    if (!data || data._delivery_generation !== businessGeneration) {
      throw new Error('Supabase devolvió un registro de otra etapa comercial.');
    }
    var clean = clone(data);
    delete clean._delivery_generation;
    return clean;
  }
  function toCloudData(data) {
    var tagged = clone(data);
    tagged._delivery_generation = businessGeneration;
    return tagged;
  }

  /* ----------------------------- tiempo real -------------------------- */
  function subscribe() {
    if (channel) { try { sb.removeChannel(channel); } catch (e) {} }
    var ch = sb.channel('paginatoto-db');
    channel = ch;
    TABLES.concat(['kv']).forEach(function (t) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, function (payload) { onRemote(t, payload); });
    });
    if (safetyAvailable) ch.on('postgres_changes', { event: '*', schema: 'public', table: 'app_trash' }, function (payload) { onRemote('app_trash', payload); });
    ch.subscribe();
  }

  function onRemote(table, payload) {
    var st = store.getState();
    var remoteState = clone(shadow || st);
    applyingRemote = true;
    try {
      if (table === 'app_trash') {
        var row = payload.new || payload.old;
        if (row.generation && row.generation !== businessGeneration) return;
        applyTrashPayload(st, row, payload.eventType);
        applyTrashPayload(remoteState, row, payload.eventType);
      } else if (table === 'kv') {
        if (payload.new && payload.new.generation !== businessGeneration) return;
        if (payload.eventType === 'DELETE') return;
        var kk = payload.new.k;
        if (kk === 'settings' || kk === 'meta') {
          var baseValue = remoteState[kk] || {};
          var localValue = st[kk] || {};
          var remoteValue = Object.assign({}, baseValue, payload.new.data || {});
          st[kk] = mergeRecord(baseValue, localValue, remoteValue);
          remoteState[kk] = remoteValue;
        }
      } else {
        var arr = st[ARR[table]];
        var remoteArr = remoteState[ARR[table]] || (remoteState[ARR[table]] = []);
        var id = payload.eventType === 'DELETE' ? payload.old && payload.old.id : payload.new && payload.new.id;
        var remoteIndex = remoteArr.findIndex(function (x) { return x.id === id; });
        var remoteBefore = remoteIndex >= 0 ? remoteArr[remoteIndex] : null;
        var localIndex = arr.findIndex(function (x) { return x.id === id; });
        var localBefore = localIndex >= 0 ? arr[localIndex] : null;
        if (payload.eventType === 'DELETE') {
          if (localIndex >= 0 && (!remoteBefore || j(localBefore) === j(remoteBefore))) arr.splice(localIndex, 1);
          if (remoteIndex >= 0) remoteArr.splice(remoteIndex, 1);
        } else {
          if (!payload.new.data || payload.new.data._delivery_generation !== businessGeneration) return;
          var d = fromCloudData(payload.new.data);
          if (localIndex >= 0) arr[localIndex] = remoteBefore && j(localBefore) !== j(remoteBefore)
            ? mergeRecord(remoteBefore, localBefore, d) : d;
          else if (!remoteBefore) arr.push(d); // absent locally with a remote base means a pending local delete
          if (remoteIndex >= 0) remoteArr[remoteIndex] = d; else remoteArr.push(d);
        }
      }
      shadow = remoteState;
      store.notify();
    } catch (e) {
      console.error('sync onRemote', e);
    } finally {
      applyingRemote = false;
    }
  }

  function applyTrashPayload(state, row, eventType) {
    var rows = state.trash || (state.trash = []);
    var idx = rows.findIndex(function (x) { return x.id === row.id; });
    if (eventType === 'DELETE') { if (idx >= 0) rows.splice(idx, 1); return; }
    var item = { id: row.id, entity: row.entity, entityId: row.entity_id, parentId: row.parent_id, label: row.label,
      data: row.data, deletedAt: new Date(row.deleted_at).getTime(), deletedBy: row.deleted_by,
      restoredAt: row.restored_at ? new Date(row.restored_at).getTime() : null };
    if (idx >= 0) rows[idx] = item; else rows.push(item);
  }

  /* ------------------------ guardar (diff + subir) ------------------- */
  function onLocalChange(state) {
    if (applyingRemote) return;
    if (pendingBulkOperation) persistPendingBulkState(state);
    if (!navigator.onLine || offlineMode) { offlineMode = true; return; }
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { flush(state); }, 400);
  }

  function backupFailureMessage() {
    return 'Los últimos cambios todavía no tienen una copia de seguridad verificada. Para proteger tu información, necesitamos completar el respaldo.';
  }
  function showBackupFailure(message) {
    backupBlocked = true;
    backupBlockMessage = message || '';
    try { localStorage.setItem(BACKUP_FAILURE_KEY, JSON.stringify({ generation: businessGeneration, at: Date.now(), message: backupBlockMessage })); } catch (e) {}
    if (!document || !document.body) return;
    if (!backupOverlay) {
      backupOverlay = document.createElement('div'); backupOverlay.className = 'backup-lock-overlay';
      backupOverlay.setAttribute('role', 'alert');
      var box = document.createElement('section'); box.className = 'backup-lock-card';
      var title = document.createElement('h2'); title.textContent = 'No se pudo guardar la copia de seguridad';
      var body = document.createElement('p'); body.className = 'backup-lock-message'; body.textContent = backupFailureMessage();
      var state = document.createElement('p'); state.className = 'backup-lock-state';
      var button = document.createElement('button'); button.type = 'button'; button.className = 'backup-lock-button';
      button.textContent = 'Reintentar copia de seguridad';
      button.addEventListener('click', retryBackup);
      box.appendChild(title); box.appendChild(body); box.appendChild(state); box.appendChild(button); backupOverlay.appendChild(box);
      backupOverlay._state = state; backupOverlay._button = button; backupOverlay._body = body;
      document.body.appendChild(backupOverlay);
    }
    backupOverlay._state.textContent = !navigator.onLine
      ? 'Necesitás recuperar Internet para completar el respaldo.'
      : (backupBlockMessage ? 'No se pudo confirmar el respaldo. Reintentá para proteger los últimos cambios.' : '');
    backupOverlay._button.disabled = backupAttempting;
  }
  function clearBackupFailure() {
    backupBlocked = false; backupBlockMessage = '';
    try { localStorage.removeItem(BACKUP_FAILURE_KEY); } catch (e) {}
    if (backupOverlay) { backupOverlay.remove(); backupOverlay = null; }
  }
  function applyBackupStatus(status) {
    if (!status || typeof status !== 'object') throw new Error('Supabase no devolvió el estado del respaldo.');
    if (status.generation && businessGeneration && status.generation !== businessGeneration) throw new Error('La generación del respaldo no coincide con la sesión actual.');
    backupStatus = status;
    if (!status.needs_backup) {
      if (backupTimer) clearTimeout(backupTimer);
      backupTimer = null;
      clearBackupFailure();
    }
    else {
      if (status.blocked) showBackupFailure('El respaldo está pendiente desde hace más de diez minutos.');
      var localFailure = null;
      try { localFailure = JSON.parse(localStorage.getItem(BACKUP_FAILURE_KEY) || 'null'); } catch (e) {}
      if (localFailure && localFailure.generation === businessGeneration) {
        backupBlocked = true; backupBlockMessage = localFailure.message || 'falló el respaldo'; showBackupFailure(backupBlockMessage);
      }
      scheduleBackup(status);
    }
    return status;
  }
  function fetchBackupStatus() {
    if (!backupAvailable || !generationReady || !businessGeneration) return Promise.reject(new Error('El respaldo automático no está disponible.'));
    return sb.rpc('app_backup_status').then(function (r) { if (r.error) throw r.error; return applyBackupStatus(r.data); });
  }
  function refreshBackupStatus() {
    if (!navigator.onLine || !generationReady) return Promise.resolve(null);
    if (!backupAvailable) { showBackupFailure('El servicio de copias automáticas no está disponible.'); return Promise.resolve(null); }
    return fetchBackupStatus().catch(function (e) {
      console.warn('No se pudo consultar el estado del backup', e);
      if (backupStatus && backupStatus.needs_backup) showBackupFailure(e.message || 'Error al consultar el respaldo');
      return null;
    });
  }
  function scheduleBackup(status) {
    if (backupTimer) clearTimeout(backupTimer);
    backupTimer = null;
    if (backupAttempting || !status || !status.needs_backup || !status.dirty_since) return;
    var dueAt = new Date(status.dirty_since).getTime() + 10 * 60 * 1000;
    backupTimer = setTimeout(function () { return attemptAutomaticBackup(); }, Math.max(0, dueAt - Date.now()));
  }
  function createVerifiedSnapshot(revision, label, source, onlyIfPending) {
    return sb.rpc('app_create_verified_snapshot', { p_expected_revision: revision, p_label: label,
      p_source: source, p_only_if_pending: !!onlyIfPending }).then(function (r) {
      if (r.error) throw r.error;
      if (!r.data || ['saved','already_saved'].indexOf(r.data.status) < 0) return r.data || { status: 'stale' };
      return r.data;
    });
  }
  function attemptAutomaticBackup() {
    if (backupAttempting || !navigator.onLine || !backupAvailable || !generationReady) return Promise.resolve(false);
    backupAttempting = true;
    return fetchBackupStatus().then(function (status) {
      if (!status.needs_backup) return status;
      return createVerifiedSnapshot(Number(status.revision), 'Copia automática tras cambios', 'activity', true).then(function (result) {
        if (result.status === 'stale') return fetchBackupStatus();
        return fetchBackupStatus();
      });
    }).then(function (status) {
      backupAttempting = false;
      if (status && status.needs_backup) scheduleBackup(status);
      return !!(status && !status.needs_backup);
    }).catch(function (e) {
      backupAttempting = false;
      showBackupFailure(e.message || 'No se pudo verificar el snapshot remoto.');
      if (backupOverlay) backupOverlay._button.disabled = false;
      return false;
    });
  }
  function retryBackup() {
    if (backupAttempting) return Promise.resolve(false);
    if (!navigator.onLine) { showBackupFailure('Sin conexión a Internet'); return Promise.resolve(false); }
    backupAttempting = true;
    if (backupOverlay) backupOverlay._button.disabled = true;
    return fetchBackupStatus().then(function (status) {
      if (!status.needs_backup) return status;
      return createVerifiedSnapshot(Number(status.revision), 'Copia automática tras cambios', 'activity', true).then(function (result) {
        if (result.status === 'stale') return fetchBackupStatus();
        return fetchBackupStatus();
      });
    }).then(function (status) {
      backupAttempting = false;
      if (status && !status.needs_backup) clearBackupFailure();
      else if (status) scheduleBackup(status);
      return !!(status && !status.needs_backup);
    }).catch(function (e) {
      backupAttempting = false;
      backupBlockMessage = e.message || 'falló el respaldo';
      showBackupFailure(backupBlockMessage);
      if (backupOverlay) backupOverlay._button.disabled = false;
      return false;
    });
  }
  function startBackupMonitoring() {
    if (backupPollTimer) clearInterval(backupPollTimer);
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(BACKUP_FAILURE_KEY) || 'null'); } catch (e) {}
    if (saved && saved.generation === businessGeneration) { backupBlocked = true; backupBlockMessage = saved.message || ''; showBackupFailure(backupBlockMessage); }
    refreshBackupStatus().then(function (status) {
      if (!status) return;
      if (status.needs_backup && (status.blocked || (backupBlocked && Date.now() >= new Date(status.dirty_since).getTime() + 10 * 60 * 1000))) attemptAutomaticBackup();
    });
    backupPollTimer = setInterval(function () { refreshBackupStatus().then(function (status) {
      if (status && status.needs_backup && Date.now() >= new Date(status.dirty_since).getTime() + 10 * 60 * 1000) attemptAutomaticBackup();
    }); }, 60000);
  }

  function diffArr(table, cur, old, ops, tsField) {
    var metric = ops.metrics[table] || (ops.metrics[table] = { insert: 0, update: 0, delete: 0 });
    var oldById = {}; (old || []).forEach(function (x) { oldById[x.id] = x; });
    var curIds = {};
    (cur || []).forEach(function (x) {
      curIds[x.id] = true;
      var prev = oldById[x.id];
      if (!prev || j(prev) !== j(x)) {
        if (prev) metric.update++; else metric.insert++;
        var row = { id: x.id, data: toCloudData(x) };
        if (tsField) row.ts = x[tsField] || 0;
        ops.up[table].push(row);
      }
    });
    (old || []).forEach(function (x) { if (!curIds[x.id]) { ops.del[table].push(x.id); metric.delete++; } });
  }

  function readPendingMassSync() {
    var raw = localStorage.getItem(PENDING_MASS_KEY);
    if (!raw) return null;
    var pending;
    try { pending = JSON.parse(raw); } catch (e) { throw new Error('Hay una sincronización pendiente local dañada; se bloqueó la carga para no perder cambios.'); }
    if (!pending || !pending.state || !pending.generation) throw new Error('Hay una sincronización pendiente local incompleta; se bloqueó la carga para no perder cambios.');
    return pending;
  }
  function readPendingBulkOperation() {
    var raw = localStorage.getItem(PENDING_BULK_KEY);
    if (!raw) return null;
    var pending;
    try { pending = JSON.parse(raw); } catch (e) { throw new Error('Hay una operación masiva pendiente local dañada; se bloqueó la carga para no perder cambios.'); }
    if (!pending || !pending.kind || !pending.generation) throw new Error('Hay una operación masiva pendiente local incompleta; se bloqueó la carga para no perder cambios.');
    return pending;
  }
  function persistPendingMassSync(state, fingerprint, riskByTable) {
    var pending = { generation: businessGeneration, createdAt: Date.now(), fingerprint: fingerprint,
      risks: riskByTable, state: clone(state), base: clone(shadow), bulkOperation: pendingBulkOperation ? clone(pendingBulkOperation) : null };
    try {
      localStorage.setItem(PENDING_MASS_KEY, JSON.stringify(pending));
      localStorage.setItem(store.STORAGE_KEY, JSON.stringify(state));
      pendingMassSync = pending;
      if (pendingBulkOperation) localStorage.setItem(PENDING_BULK_KEY, JSON.stringify(pendingBulkOperation));
      return true;
    } catch (e) {
      console.error('No se pudo conservar localmente la sincronización pendiente', e);
      return false;
    }
  }
  function clearPendingMassSync() {
    pendingMassSync = null;
    try { localStorage.removeItem(PENDING_MASS_KEY); } catch (e) {}
  }
  function clearPendingBulkOperation() {
    pendingBulkOperation = null;
    try { localStorage.removeItem(PENDING_BULK_KEY); } catch (e) {}
  }
  function markBulkOperation(kind, preBackedUp, beforeState) {
    if (!generationReady || !businessGeneration) return false;
    pendingBulkOperation = { kind: String(kind || 'operacion_masiva'), generation: businessGeneration,
      createdAt: Date.now(), preBackedUp: preBackedUp === true && !!beforeState && j(beforeState) === j(shadow),
      state: null, base: clone(shadow || store.blankState()) };
    try { localStorage.setItem(PENDING_BULK_KEY, JSON.stringify(pendingBulkOperation)); return true; }
    catch (e) { pendingBulkOperation = null; return false; }
  }
  function persistPendingBulkState(state) {
    if (!pendingBulkOperation) return true;
    pendingBulkOperation.state = clone(state);
    try { localStorage.setItem(PENDING_BULK_KEY, JSON.stringify(pendingBulkOperation)); return true; }
    catch (e) { console.error('No se pudo guardar el estado de la operación masiva pendiente', e); return false; }
  }

  function flush(state) {
    if (!navigator.onLine) { offlineMode = true; return Promise.resolve(false); }
    if (!generationReady || !businessGeneration) return Promise.resolve(false);
    if (!shadow) shadow = clone(state);
    var ops = { up: { vehicles: [], history: [], reminders: [], fixed_expenses: [], kv: [] }, metrics: {},
                del: { vehicles: [], history: [], reminders: [], fixed_expenses: [], kv: [] } };
    diffArr('vehicles', state.vehicles, shadow.vehicles, ops);
    diffArr('history', state.history, shadow.history, ops, 'ts');
    diffArr('reminders', state.reminders, shadow.reminders, ops);
    diffArr('fixed_expenses', state.fixedExpenses, shadow.fixedExpenses, ops);
    if (j(state.settings) !== j(shadow.settings)) ops.up.kv.push({ k: 'settings', data: state.settings, generation: businessGeneration });
    if (j(state.meta) !== j(shadow.meta)) ops.up.kv.push({ k: 'meta', data: state.meta, generation: businessGeneration });
    if (ops.up.kv.length) ops.metrics.kv = { insert: 0, update: ops.up.kv.length, delete: 0 };

    var riskByTable = [];
    var totalPrevious = 0, totalUpdates = 0;
    ['vehicles','history','reminders','fixed_expenses','kv'].forEach(function (t) {
      var previous = t === 'kv' ? 2 : (shadow[ARR[t]] || []).length;
      var metric = ops.metrics[t] || { insert: 0, update: 0, delete: 0 };
      totalPrevious += previous;
      totalUpdates += metric.update;
      // Un único DELETE ya tiene su confirmación normal en la interfaz. La
      // barrera adicional es para lotes: exige al menos dos filas y combina
      // cantidad absoluta con proporción, evitando clasificar un UPDATE 1/1
      // como masivo cuando el negocio recién empieza.
      var deleteThreshold = previous <= 3 ? 2 : Math.max(2, Math.ceil(previous * 0.5));
      if (metric.delete >= deleteThreshold && previous > 0) {
        riskByTable.push({ table: t, action: 'DELETE', count: metric.delete, ids: ops.del[t].slice().sort() });
      }
      // Los INSERT son aditivos (incluidos movimientos de historial que una
      // operación comercial puede crear en pareja) y por sí solos no
      // sobrescriben el estado remoto. Para UPDATE exigir un lote absoluto y
      // una fracción significativa; importación/restauración/reset se cubren
      // por intención explícita, incluso en colecciones de 1 o 2 filas.
      var updateThreshold = Math.max(MIN_BULK_EXISTING_UPDATES, Math.ceil(previous * 0.5));
      if (metric.update >= updateThreshold) {
        var ids = t === 'kv' ? ops.up.kv.map(function (x) { return x.k; }) :
          ops.up[t].filter(function (x) { return !!(shadow[ARR[t]] || []).some(function (old) { return old.id === x.id; }); }).map(function (x) { return x.id; });
        riskByTable.push({ table: t, action: 'UPDATE', count: metric.update,
          ids: ids.sort() });
      }
    });
    var totalUpdateThreshold = Math.max(MIN_BULK_EXISTING_UPDATES, Math.ceil(totalPrevious * 0.5));
    if (totalUpdates >= totalUpdateThreshold && !riskByTable.some(function (x) { return x.action === 'UPDATE'; })) {
      riskByTable.push({ table: 'varias tablas', action: 'UPDATE', count: totalUpdates, ids: [] });
    }
    // Incluye el contenido efectivo, no solo los IDs: una aprobación previa
    // nunca debe autorizar otra versión del mismo lote.
    var fingerprint = j({ risks: riskByTable, up: ops.up, del: ops.del, bulkOperation: pendingBulkOperation });
    var requiresApproval = riskByTable.length > 0 || !!pendingMassSync || !!pendingBulkOperation;
    if (requiresApproval && deletionApprovalPending) return Promise.resolve(false);
    if (requiresApproval && approvedMassChangeFingerprint !== fingerprint && !deletionApprovalPending) {
      if (!persistPendingMassSync(state, fingerprint, riskByTable)) {
        App.ui && App.ui.toast('Operación bloqueada: no se pudieron conservar los cambios pendientes en este dispositivo.', 'error');
        return Promise.resolve(false);
      }
      if (!App.ui || !App.ui.confirm) return Promise.resolve(false);
      deletionApprovalPending = true;
      var riskDescription = riskByTable.length
        ? riskByTable.map(function (x) { return x.action + ' ' + x.count + ' en ' + x.table; }).join(', ')
        : pendingBulkOperation
          ? 'operación de estado completo: ' + pendingBulkOperation.kind
          : 'cambios pendientes que antes fueron cancelados';
      if (pendingBulkOperation && riskByTable.length) riskDescription += ' · operación: ' + pendingBulkOperation.kind;
      var needsRemoteBackup = !(pendingBulkOperation && pendingBulkOperation.preBackedUp);
      var safetyDescription = needsRemoteBackup
        ? 'Al confirmar, se guardará primero una copia del estado remoto y se registrará la operación.'
        : 'Ya existe una copia previa y la operación está registrada. Al confirmar, se sincronizarán los cambios.';
      return App.ui.confirm({ title: riskByTable.length || pendingBulkOperation ? 'Cambios grandes de sincronización' : 'Sincronización pendiente',
        message: 'La sincronización contiene ' + riskDescription + '. ' + safetyDescription + ' Si cancelás, los cambios quedarán guardados localmente y no se enviarán.', danger: true, confirmText: 'Confirmar sincronización' })
        .then(function (ok) {
          deletionApprovalPending = false;
          if (!ok) {
            approvedMassChangeFingerprint = null;
            App.ui.toast('Cambios conservados en este dispositivo; no se enviaron a Supabase.', 'error');
            return false;
          }
          var existingBackup = pendingBulkOperation && pendingBulkOperation.preBackedUp;
          var backup = existingBackup ? Promise.resolve() : saveSnapshotState(shadow, 'Estado anterior a operación masiva', 'safety');
          return backup.then(function () {
            var details = { tables: {} };
            Object.keys(ops.metrics).forEach(function (table) {
              var m = ops.metrics[table];
              details.tables[table] = { INSERT: m.insert, UPDATE: m.update, DELETE: m.delete };
            });
            details.totalUpdates = totalUpdates;
            if (!riskByTable.length) details.pendingRetry = true;
            if (pendingBulkOperation) details.bulkOperation = pendingBulkOperation.kind;
            return existingBackup ? true : logOperation('operacion_masiva', 'sincronizacion', details);
          }).then(function (logged) {
            if (!logged) throw new Error('No se pudo registrar la operación masiva.');
            approvedMassChangeFingerprint = fingerprint;
            return flush(state);
          }).catch(function (e) {
            approvedMassChangeFingerprint = null;
            console.error('Se bloqueó la operación masiva porque no se pudo respaldar o registrar', e);
            App.ui && App.ui.toast('Operación masiva bloqueada: no se pudo guardar el backup remoto previo.', 'error');
            return false;
          });
        });
    }
    if (approvedMassChangeFingerprint === fingerprint) approvedMassChangeFingerprint = null;
    deletionApprovalPending = false;
    var promises = [];
    Object.keys(ops.up).forEach(function (t) {
      var key = t === 'kv' ? 'k' : 'id';
      if (ops.up[t].length) promises.push(sb.from(t).upsert(ops.up[t], { onConflict: key }));
      if (ops.del[t].length) promises.push(sb.from(t).delete().in(key, ops.del[t]));
    });
    if (!promises.length) {
      return syncTrash(state.trash || [], shadow.trash || []).then(function () { shadow = clone(state); saveBase(state); clearPendingMassSync(); clearPendingBulkOperation(); return refreshBackupStatus(); }).then(function () { return true; }).catch(function (e) {
        console.error('sync safety flush', e); offlineMode = true;
        App.ui && App.ui.toast('No se pudo guardar la papelera en la nube. Revisá internet.', 'error');
        if (pushTimer) clearTimeout(pushTimer); pushTimer = setTimeout(reconnect, 8000);
        return false;
      });
    }

    return Promise.all(promises).then(function (results) {
      var bad = null;
      results.forEach(function (r) { if (r && r.error) bad = r.error; });
      if (bad) throw bad;
      return syncTrash(state.trash || [], shadow.trash || []);
    }).then(function () {
      shadow = clone(state);
      saveBase(state);
      clearPendingMassSync();
      clearPendingBulkOperation();
      return refreshBackupStatus().then(function () { return true; });
    }).catch(function (e) {
      console.error('sync flush', e);
      offlineMode = true;
      App.ui && App.ui.toast('No se pudo guardar en la nube. Revisá internet.', 'error');
      // Revalida perfil, vuelve a descargar y combina cambios antes de reintentar.
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(reconnect, 8000);
      return false;
    });
  }

  function syncTrash(cur, old) {
    if (!safetyAvailable) return Promise.resolve();
    var oldById = {}; (old || []).forEach(function (x) { oldById[x.id] = x; });
    var tasks = [];
    (cur || []).forEach(function (x) {
      var before = oldById[x.id];
      if (!before) tasks.push(sb.from('app_trash').insert({ id: x.id, entity: x.entity, entity_id: x.entityId,
        parent_id: x.parentId || null, label: x.label || x.entity, data: x.data, deleted_at: new Date(x.deletedAt).toISOString(),
        deleted_by: x.deletedBy || null, restored_at: x.restoredAt ? new Date(x.restoredAt).toISOString() : null,
        generation: businessGeneration }));
      else if (!before.restoredAt && x.restoredAt) tasks.push(sb.from('app_trash').update({ restored_at: new Date(x.restoredAt).toISOString() }).eq('id', x.id));
    });
    return Promise.all(tasks).then(function (rs) { var bad = rs.filter(function (x) { return x.error; })[0]; if (bad) throw bad.error; });
  }

  function snapshotSummary(state) {
    return { vehicles: (state.vehicles || []).length, history: (state.history || []).length,
      reminders: (state.reminders || []).length, fixed_expenses: (state.fixedExpenses || []).length };
  }
  function saveSnapshot(snap) {
    if (!safetyAvailable) return Promise.reject(new Error('Migración de seguridad pendiente.'));
    if (!generationReady || !businessGeneration) return Promise.reject(new Error('No hay una etapa comercial activa.'));
    if (!backupAvailable) return Promise.reject(new Error('No está instalada la migración de respaldos automáticos.'));
    var source = snap.source === 'safety' ? 'safety' : 'application';
    return fetchBackupStatus().then(function (status) {
      return createVerifiedSnapshot(Number(status.revision), snap.etiqueta || 'Estado completo', source, false);
    }).then(function (result) {
      if (!result || result.status !== 'saved') throw new Error('No se pudo confirmar la persistencia del snapshot.');
      return refreshBackupStatus().then(function () { return true; });
    });
  }
  function saveSnapshotState(state, label, source) {
    var when = Date.now();
    return saveSnapshot({ ts: when, etiqueta: label, source: source || 'application',
      data: JSON.stringify(state) });
  }
  function fetchSnapshots(offset) {
    if (!safetyAvailable) return Promise.reject(new Error('Aplicá primero la migración SQL de seguridad.'));
    offset = Math.max(0, Number(offset) || 0);
    return sb.from('app_snapshots').select('id,created_at,label,created_by,summary,source,snapshot_day').eq('generation', businessGeneration).order('created_at', { ascending: false }).range(offset, offset + 99)
      .then(function (r) { if (r.error) throw r.error; return r.data || []; });
  }
  function fetchSnapshotDetails(id) {
    return sb.from('app_snapshots').select('id,created_at,label,created_by,state').eq('id', id).eq('generation', businessGeneration).single()
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  function ensureCloudDailySnapshot(state) {
    // Los snapshots automáticos ahora se disparan por actividad confirmada,
    // no por apertura ni por sincronizaciones sin DML.
    return Promise.resolve(false);
  }
  function fetchAudit(offset, operationOffset) {
    if (!safetyAvailable) return Promise.reject(new Error('Aplicá primero la migración SQL de seguridad.'));
    offset = Math.max(0, Number(offset) || 0);
    operationOffset = Math.max(0, Number(operationOffset) || 0);
    var end = offset + 499;
    var operationEnd = operationOffset + 499;
    return Promise.all([
      sb.from('audit_log').select('id,occurred_at,table_name,operation,record_id,before_data,after_data,actor_uid,db_role,transaction_id').order('id', { ascending: false }).range(offset, end),
      sb.from('app_operations').select('id,occurred_at,actor_uid,action,entity,details').eq('generation', businessGeneration).order('occurred_at', { ascending: false }).order('id', { ascending: false }).range(operationOffset, operationEnd),
      offset === 0 ? sb.from('profiles').select('id,nombre,email') : Promise.resolve({ data: [], error: null })
    ]).then(function (rs) { rs.forEach(function (r) { if (r.error) throw r.error; }); return { rows: rs[0].data || [], operations: rs[1].data || [], profiles: rs[2].data || [] }; });
  }
  function logOperation(action, entity, details) {
    if (!safetyAvailable || !generationReady || !businessGeneration) return Promise.resolve(false);
    return sb.from('app_operations').insert({ actor_uid: App.auth && App.auth.profile ? App.auth.profile.id : null,
      action: action, entity: entity, details: details || {}, generation: businessGeneration }).then(function (r) { if (r.error) throw r.error; return true; })
      .catch(function (e) { console.error('No se pudo registrar la operación de aplicación', e); return false; });
  }
  function restoreRemoteSnapshot(id) {
    return fetchSnapshotDetails(id).then(function (row) {
      var ts = new Date(row.created_at).getTime();
      var restoreTs = store.cacheSnapshot({ ts: ts, fecha: businessDateKey(new Date(ts)), etiqueta: row.label, data: JSON.stringify(row.state) });
      return Promise.resolve(store.restoreSnapshot(restoreTs)).then(function (done) { if (!done) throw new Error('No se pudo guardar la copia previa o restaurar el estado.'); return true; });
    });
  }

  function saveBase(state) {
    try { localStorage.setItem(BASE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  // Aplicar solamente las diferencias locales posteriores a la última base
  // conocida sobre la descarga actual evita descartar trabajo offline.
  function readBaseState() {
    try { return JSON.parse(localStorage.getItem(BASE_KEY) || 'null'); } catch (e) { return null; }
  }
  function mergeOfflineChanges(remote, local, baseOverride) {
    var base = baseOverride || readBaseState();
    if (!base) base = store.blankState();
    var pairs = [
      ['vehicles', base.vehicles, local.vehicles], ['history', base.history, local.history],
      ['reminders', base.reminders, local.reminders], ['fixedExpenses', base.fixedExpenses, local.fixedExpenses], ['trash', base.trash, local.trash]
    ];
    pairs.forEach(function (pair) {
      var key = pair[0], before = {}, after = {}, byId = {};
      (pair[1] || []).forEach(function (x) { before[x.id] = x; });
      (pair[2] || []).forEach(function (x) { after[x.id] = x; });
      (remote[key] || []).forEach(function (x) { byId[x.id] = x; });
      Object.keys(before).forEach(function (id) {
        if (!Object.prototype.hasOwnProperty.call(after, id)) delete byId[id];
        else if (j(before[id]) !== j(after[id])) {
          byId[id] = Object.prototype.hasOwnProperty.call(byId, id)
            ? mergeRecord(before[id], after[id], byId[id]) : after[id];
        }
      });
      Object.keys(after).forEach(function (id) {
        if (!before[id] && !Object.prototype.hasOwnProperty.call(byId, id)) byId[id] = after[id];
      });
      remote[key] = Object.keys(byId).map(function (id) { return byId[id]; });
    });
    ['settings', 'meta'].forEach(function (key) {
      Object.keys(local[key] || {}).forEach(function (k) {
        if (j((base[key] || {})[k]) !== j(local[key][k])) remote[key][k] = local[key][k];
      });
    });
    return remote;
  }

  // Combinar a nivel de campo para que una edición offline de, por ejemplo,
  // el kilometraje no revierta un cambio remoto simultáneo en el precio.
  function mergeRecord(base, local, remote) {
    if (j(base) === j(local)) return remote;
    if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
      var keyed = base.concat(local, remote).every(function (x) { return x && typeof x === 'object' && x.id; });
      if (keyed) {
        var b = {}, l = {}, r = {}, out = {};
        base.forEach(function (x) { b[x.id] = x; }); local.forEach(function (x) { l[x.id] = x; });
        remote.forEach(function (x) { r[x.id] = x; });
        Object.keys(r).forEach(function (id) { out[id] = r[id]; });
        Object.keys(b).forEach(function (id) {
          if (!Object.prototype.hasOwnProperty.call(l, id)) delete out[id];
          else if (j(b[id]) !== j(l[id]) && Object.prototype.hasOwnProperty.call(r, id)) out[id] = mergeRecord(b[id], l[id], r[id]);
          else if (j(b[id]) !== j(l[id])) out[id] = l[id];
        });
        Object.keys(l).forEach(function (id) { if (!b[id]) out[id] = l[id]; });
        return Object.keys(out).map(function (id) { return out[id]; });
      }
      // Arrays de fechas/tags: unir adiciones de ambas partes y aplicar las
      // eliminaciones locales respecto de la base común.
      var vals = remote.filter(function (x) { return !base.some(function (v) { return j(v) === j(x); }) || local.some(function (v) { return j(v) === j(x); }); });
      local.forEach(function (x) { if (!vals.some(function (v) { return j(v) === j(x); })) vals.push(x); });
      return vals;
    }
    if (base && local && remote && !Array.isArray(base) && !Array.isArray(local) && !Array.isArray(remote) &&
        typeof base === 'object' && typeof local === 'object' && typeof remote === 'object') {
      var result = clone(remote), keys = {};
      Object.keys(base).concat(Object.keys(local)).forEach(function (k) { keys[k] = true; });
      Object.keys(keys).forEach(function (k) {
        var hadBase = Object.prototype.hasOwnProperty.call(base, k), hasLocal = Object.prototype.hasOwnProperty.call(local, k);
        if (hadBase && !hasLocal) delete result[k];
        else if (hasLocal && (!hadBase || j(base[k]) !== j(local[k]))) {
          if (hadBase && Object.prototype.hasOwnProperty.call(remote, k)) result[k] = mergeRecord(base[k], local[k], remote[k]);
          else result[k] = local[k];
        }
      });
      return result;
    }
    return local;
  }

  function reconnect() {
    if (reconnecting || !navigator.onLine || !offlineMode) return;
    reconnecting = true;
    return App.auth.reloadProfile().then(function (profile) {
      if (!profile || !profile.activo) {
        App.auth.logout();
        return Promise.reject(new Error('La sesión o el usuario ya no están habilitados.'));
      }
      if (App.auth.offline) return false;
      return loadAll();
    }).catch(function (e) {
      console.warn('No se pudo recuperar la conexión; se conserva el modo offline.', e);
    }).then(function () {
      reconnecting = false;
      if (offlineMode && navigator.onLine) {
        if (pushTimer) clearTimeout(pushTimer);
        pushTimer = setTimeout(reconnect, 10000);
      }
    });
  }
  window.addEventListener('offline', function () { offlineMode = true; });
  window.addEventListener('online', reconnect);

  /* --------------------------- migración inicial -------------------- */
  function pendingMigrationInfo() {
    if (!pendingMigration) return null;
    return { autos: (pendingMigration.vehicles || []).length, recordatorios: (pendingMigration.reminders || []).length };
  }
  function doMigration() {
    if (!pendingMigration) return Promise.resolve();
    var st = store.migrate(pendingMigration);
    pendingMigration = null;
    applyingRemote = true;
    try { store.hydrate(st); } finally { applyingRemote = false; }
    return flush(store.getState()).then(function (ok) {
      if (ok) App.ui && App.ui.toast('Datos subidos a la nube', 'success');
    });
  }
  function skipMigration() { pendingMigration = null; }

  App.data = {
    loadAll: loadAll,
    loadLocal: function () {
      var localGeneration = null;
      try { localGeneration = localStorage.getItem(GENERATION_KEY); } catch (e) {}
      if (!localGeneration) {
        try {
          localStorage.removeItem(store.STORAGE_KEY);
          localStorage.removeItem(BASE_KEY);
          localStorage.removeItem('paginaToto:snapshots');
          localStorage.removeItem(PENDING_MASS_KEY);
          localStorage.removeItem(PENDING_BULK_KEY);
        } catch (e) {}
        pendingMassSync = null;
        pendingBulkOperation = null;
        generationReady = false;
        store.hydrate(store.blankState());
        App.ui && App.ui.toast('Estado local anterior descartado. Conectate para cargar la etapa comercial vigente.', 'error');
      } else {
        businessGeneration = localGeneration;
        generationReady = true;
        pendingMassSync = readPendingMassSync();
        pendingBulkOperation = readPendingBulkOperation();
        if (!pendingBulkOperation && pendingMassSync && pendingMassSync.bulkOperation) pendingBulkOperation = pendingMassSync.bulkOperation;
        try {
          var backupFailure = JSON.parse(localStorage.getItem(BACKUP_FAILURE_KEY) || 'null');
          if (backupFailure && backupFailure.generation === localGeneration) {
            backupBlocked = true; backupBlockMessage = backupFailure.message || ''; showBackupFailure(backupBlockMessage);
          }
        } catch (e) {}
        store.load();
      }
      offlineMode = true;
      shadow = clone(store.getState());
      return Promise.resolve(store.getState());
    },
    onLocalChange: onLocalChange,
    flushNow: function () { if (pushTimer) clearTimeout(pushTimer); return flush(store.getState()); },
    pendingMigrationInfo: pendingMigrationInfo,
    doMigration: doMigration,
    skipMigration: skipMigration,
    safetyAvailable: function () { return safetyAvailable; },
    deliveryReady: function () { return generationReady && !!businessGeneration; },
    deliveryLabel: function () { return deliveryLabel; },
    deliveryEstablishedAt: function () { return deliveryEstablishedAt; },
    isOffline: function () { return offlineMode; },
    businessDateKey: businessDateKey,
    fetchAudit: fetchAudit,
    fetchSnapshots: fetchSnapshots,
    fetchSnapshotDetails: fetchSnapshotDetails,
    saveSnapshot: saveSnapshot,
    restoreRemoteSnapshot: restoreRemoteSnapshot,
    logOperation: logOperation,
    markBulkOperation: markBulkOperation,
    backupWritesBlocked: function () { return !!(App.auth && App.auth.enabled && (backupBlocked || (backupStatus && backupStatus.blocked) || (!offlineMode && !backupAvailable))); }
  };

  App.data.backupStatus = function () { return backupStatus; };
  App.data.retryBackup = retryBackup;
  App.data.backupAvailable = function () { return backupAvailable; };
  startBackupMonitoring();
  window.addEventListener('online', function () { refreshBackupStatus().then(function (status) {
    if (status && status.needs_backup && (status.blocked || backupBlocked || Date.now() >= new Date(status.dirty_since).getTime() + 10 * 60 * 1000)) attemptAutomaticBackup();
  }); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshBackupStatus().then(function (status) {
    if (status && status.needs_backup && Date.now() >= new Date(status.dirty_since).getTime() + 10 * 60 * 1000) attemptAutomaticBackup();
  }); });
})();
