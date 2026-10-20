/* ============================================================================
 * store.js  —  Estado global, persistencia y operaciones de datos
 * ----------------------------------------------------------------------------
 * Toda la aplicación comparte un único objeto `state` que se guarda en
 * localStorage. Cualquier módulo que necesite modificar datos DEBE hacerlo a
 * través de las funciones expuestas en `App.store`, que se encargan de:
 *   - mantener la consistencia entre módulos,
 *   - registrar los movimientos en el historial general,
 *   - persistir y emitir el evento `state:change` para re-renderizar la vista.
 * ==========================================================================*/
(function () {
  'use strict';

  var STORAGE_KEY = 'paginaToto:v1';
  var SCHEMA_VERSION = 1;

  /* ----------------------------- Estado base ------------------------------ */
  function emptyState() {
    return {
      schema: SCHEMA_VERSION,
      vehicles: [],       // ver estructura en createVehicle()
      history: [],         // movimientos cronológicos { id, ts, fecha, tipo, vehicleId, titulo, detalle, monto, moneda, meta }
      reminders: [],       // recordatorios del calendario { id, titulo, fecha, hora, tipo, nota, repeat, doneDates, createdAt }
      fixedExpenses: [],   // gastos fijos del negocio { id, concepto, categoria, monto, moneda, cotizacionUSD, frecuencia, fecha, hasta, notas }
      trash: [],            // elementos eliminados recuperables (independiente de la auditoría SQL)
      settings: {
        dolarActual: 1600,           // cotización actual (editable por el usuario, sólo para comparaciones)
        diasStockAlerta: 60,          // umbral de "muchos días en stock"
        cuotaProximaDias: 7           // umbral de "cuota próxima a vencer"
      },
      meta: { createdAt: Date.now(), lastId: 0, lastBackupAt: null }
    };
  }

  var state = emptyState();
  var listeners = [];
  var safetyBaseline = null;
  var lastMutation = Promise.resolve({ status: 'synced' });

  /* ----------------------------- Utilidades ------------------------------- */
  // id único sin depender de un contador compartido (importante para multi-usuario)
  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function snapshotDayISO(date) {
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date || new Date());
    var p = {}; parts.forEach(function (x) { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

  // convierte a entero o null (nunca deja NaN guardado, p.ej. si alguien escribe letras en
  // Año/Km; tampoco un negativo, que no tiene sentido para ninguno de los dos campos)
  function toIntOrNull(x) {
    if (x === '' || x == null || !/[0-9]/.test(String(x))) return null;
    var n = Math.round(num(x));
    if (isNaN(n) || n < 0) return null;
    return n;
  }

  /* --------------------------- Persistencia ------------------------------- */
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { state = emptyState(); save(); return; }
      var parsed = JSON.parse(raw);
      state = migrate(parsed);
      safetyBaseline = deepClone(state);
    } catch (err) {
      console.error('No se pudo cargar el estado, se inicia vacío:', err);
      state = emptyState();
    }
  }

  /* -------------------- Copias internas (anti "borré todo") ------------- */
  var SNAP_KEY = 'paginaToto:snapshots';
  function uniqueSnapshotTs(candidate, arr, data) {
    arr = arr || JSON.parse(localStorage.getItem(SNAP_KEY) || '[]');
    var same = arr.filter(function (x) { return x.ts === candidate; })[0];
    if (same && same.data === data) return candidate;
    var max = arr.reduce(function (n, x) { return Math.max(n, Number(x.ts) || 0); }, 0);
    candidate = Math.max(Number(candidate) || Date.now(), max + 1);
    while (arr.some(function (x) { return x.ts === candidate; })) candidate++;
    return candidate;
  }
  function takeSnapshot(label) {
    try {
      var arr = JSON.parse(localStorage.getItem(SNAP_KEY) || '[]');
      var hoy = snapshotDayISO();
      if (arr.some(function (x) { return x.etiqueta === (label || 'Estado completo') && x.fecha === hoy; })) return;
      var data = JSON.stringify(state);
      var snap = { ts: uniqueSnapshotTs(Date.now(), arr, data), fecha: hoy, etiqueta: label || 'Estado completo', data: data };
      arr.push(snap);
      localStorage.setItem(SNAP_KEY, JSON.stringify(arr));
      if (App.data && App.data.saveSnapshot) App.data.saveSnapshot(snap).catch(function (e) { console.warn('No se pudo guardar el punto de restauración remoto', e); });
    } catch (e) { /* si no entra en el almacenamiento, se ignora */ }
  }
  function createSnapshot(label, requireRemote) {
    try {
      var arr = JSON.parse(localStorage.getItem(SNAP_KEY) || '[]');
      var data = JSON.stringify(state);
      var snap = { ts: uniqueSnapshotTs(Date.now(), arr, data), fecha: snapshotDayISO(), etiqueta: label || 'Estado completo', data: data };
      arr.push(snap);
      localStorage.setItem(SNAP_KEY, JSON.stringify(arr));
      if (App.data && App.data.saveSnapshot) return App.data.saveSnapshot(snap).then(function () {
        var log = App.data.logOperation ? App.data.logOperation('snapshot', 'estado_completo', summarizeState(state)) : Promise.resolve(false);
        return Promise.resolve(log).then(function (logged) {
          if (requireRemote && !logged) throw new Error('No se pudo registrar la creación del snapshot.');
          return snap.ts;
        });
      }).catch(function (e) {
        console.warn('Copia local creada; no pudo escribirse en Supabase', e);
        if (requireRemote) throw e;
        return snap.ts;
      });
      if (requireRemote) return Promise.reject(new Error('La capa de copias de Supabase todavía no está disponible.'));
      return Promise.resolve(snap.ts);
    } catch (e) { throw new Error('No hay espacio disponible para guardar una copia local.'); }
  }
  function cacheSnapshot(snap) {
    var arr = JSON.parse(localStorage.getItem(SNAP_KEY) || '[]');
    var same = arr.filter(function (x) { return x.ts === snap.ts; })[0];
    if (same && same.data === snap.data) return same.ts;
    var copy = deepClone(snap);
    copy.ts = uniqueSnapshotTs(copy.ts, arr, copy.data);
    arr.push(copy); localStorage.setItem(SNAP_KEY, JSON.stringify(arr));
    return copy.ts;
  }
  function getSnapshots() {
    try {
      return JSON.parse(localStorage.getItem(SNAP_KEY) || '[]')
        .map(function (s) { return { ts: s.ts, fecha: s.fecha, etiqueta: s.etiqueta || 'Estado completo', autos: (JSON.parse(s.data).vehicles || []).length }; })
        .sort(function (a, b) { return b.ts - a.ts; });
    } catch (e) { return []; }
  }
  function restoreSnapshot(ts) {
    try {
      var arr = JSON.parse(localStorage.getItem(SNAP_KEY) || '[]');
      var s = arr.filter(function (x) { return x.ts === ts; })[0];
      if (!s) return false;
      var requireRemote = requiresRemoteBackup();
      var backup = createSnapshot('Estado anterior a restauración', requireRemote);
      var previousTrash = (state.trash || []).slice();
      var targetState = migrate(JSON.parse(s.data));
      return backup.then(function () {
        var operation = App.data && App.data.logOperation ? App.data.logOperation('restauracion', 'snapshot', summarizeChange(state, targetState)) : Promise.resolve(false);
        return Promise.resolve(operation).then(function (logged) {
        if (requireRemote && !logged) throw new Error('No se pudo registrar la restauración en la auditoría de la aplicación.');
        if (App.data && App.data.markBulkOperation && !App.data.markBulkOperation('restauracion', requireRemote, state)) {
          throw new Error('No se pudo conservar la restauración pendiente de sincronización.');
        }
        state = targetState;
        var seenTrash = {}; state.trash.forEach(function (x) { seenTrash[x.id] = true; });
        previousTrash.forEach(function (x) { if (!seenTrash[x.id]) state.trash.push(x); });
        if (!emit()) return false;
        return afterMutation().then(function (result) { return result.status !== 'rejected'; });
        });
      }).catch(function (e) { console.error('Restauración bloqueada porque no se guardó la copia previa', e); return false; });
    } catch (e) { return false; }
  }
  function markBackup() {
    state.meta.lastBackupAt = Date.now();
    save();
  }

  function save() {
    // modo local (archivo) y respaldo local del modo online: localStorage.
    // En modo online esto es sólo una copia de resguardo por si el dispositivo
    // se queda sin conexión antes de poder subir los cambios a la nube; nunca
    // reemplaza la sincronización en sí.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      safetyBaseline = deepClone(state);
    } catch (err) {
      console.error('No se pudo guardar el estado:', err);
      App.ui && App.ui.toast('No se guardaron los cambios en este dispositivo. Exportá una copia y liberá espacio.', 'error');
    }
    // modo online (multi-usuario): además, guardar en la nube
    if (App.data && App.data.onLocalChange) return App.data.onLocalChange(state);
    return Promise.resolve({ status: 'synced' });
  }

  // reemplaza el estado completo (usado por la sincronización con la nube). No guarda.
  function hydrate(newState) {
    state = migrate(newState || emptyState());
    safetyBaseline = deepClone(state);
    listeners.forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } });
  }
  function notify() {
    safetyBaseline = deepClone(state);
    listeners.forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } });
  }

  function migrate(parsed) {
    var base = emptyState();
    if (!parsed || typeof parsed !== 'object') return base;
    // merge superficial + defaults
    base.vehicles = Array.isArray(parsed.vehicles) ? parsed.vehicles : [];
    base.history = Array.isArray(parsed.history) ? parsed.history : [];
    base.reminders = Array.isArray(parsed.reminders) ? parsed.reminders : [];
    base.fixedExpenses = Array.isArray(parsed.fixedExpenses) ? parsed.fixedExpenses : [];
    base.trash = Array.isArray(parsed.trash) ? parsed.trash : [];
    base.settings = Object.assign({}, base.settings, parsed.settings || {});
    base.meta = Object.assign({}, base.meta, parsed.meta || {});
    base.schema = SCHEMA_VERSION;
    // normalización defensiva
    base.vehicles.forEach(normalizeVehicle);
    base.reminders.forEach(normalizeReminder);
    base.fixedExpenses.forEach(normalizeFixedExpense);
    return base;
  }

  function normalizeReminder(r) {
    r.id = r.id || uid('r');
    r.titulo = (r.titulo || '').trim();
    r.fecha = r.fecha || todayISO();
    r.hora = r.hora || '';
    r.tipo = r.tipo || 'tarea';
    r.nota = r.nota || '';
    r.repeat = r.repeat || 'none';
    // nuevo modelo: doneDates = lista de fechas de ocurrencias completadas
    r.doneDates = Array.isArray(r.doneDates) ? r.doneDates : [];
    if (r.done && !r.doneDates.length) {
      r.doneDates.push(r.doneAt ? new Date(r.doneAt).toISOString().slice(0, 10) : r.fecha);
    }
    delete r.done; delete r.doneAt;
    if (!r.createdAt) r.createdAt = Date.now();
    return r;
  }

  function normalizeFixedExpense(f) {
    f.id = f.id || uid('f');
    f.concepto = (f.concepto || '').trim();
    f.categoria = f.categoria || 'otro';
    f.monto = num(f.monto);
    f.moneda = f.moneda || 'ARS';
    if (typeof f.cotizacionUSD === 'undefined') f.cotizacionUSD = null;
    f.frecuencia = f.frecuencia === 'mensual' ? 'mensual' : 'unica';
    f.fecha = f.fecha || todayISO();
    f.hasta = f.hasta || '';
    f.notas = (f.notas || '').trim();
    if (!f.createdAt) f.createdAt = Date.now();
    return f;
  }

  function normComision(c) {
    if (!c || !num(c.monto)) return null;
    return {
      persona: (c.persona || '').trim(),
      monto: num(c.monto),
      moneda: c.moneda || 'ARS',
      pagada: !!c.pagada,
      fechaPago: c.fechaPago || null
    };
  }

  // Consignación: precioDueno/cotizacionUSD llegan del formulario como texto
  // (posiblemente con separador de miles, ej. "10.000") — hay que pasarlos
  // por num() antes de guardarlos, igual que ya se hace con cualquier otro
  // importe (precio de compra/venta, gastos, cuotas), para que finance.js
  // los pueda usar como números reales.
  function normalizeOrigin(o) {
    if (!o) return { type: 'compra' };
    if (o.type === 'consignacion') {
      if (o.precioDueno != null && o.precioDueno !== '') o.precioDueno = num(o.precioDueno); else o.precioDueno = 0;
      if (o.cotizacionUSD != null && o.cotizacionUSD !== '') o.cotizacionUSD = num(o.cotizacionUSD); else o.cotizacionUSD = null;
    }
    return o;
  }

  function normalizeVehicle(v) {
    v.anio = toIntOrNull(v.anio);
    v.km = toIntOrNull(v.km);
    v.fotos = Array.isArray(v.fotos) ? v.fotos : [];
    v.expenses = Array.isArray(v.expenses) ? v.expenses : [];
    v.checklist = v.checklist || {};
    v.estado = v.estado || 'stock';
    v.documentacion = v.documentacion || 'pendiente';
    v.observaciones = v.observaciones || '';
    v.precioPretendido = (v.precioPretendido != null && v.precioPretendido !== '') ? num(v.precioPretendido) : null;
    if (!v.purchase) v.purchase = null;
    if (!v.sale) v.sale = null;
    if (typeof v.reservation === 'undefined') v.reservation = null;
    if (v.purchase) {
      v.purchase.cuotas = Array.isArray(v.purchase.cuotas) ? v.purchase.cuotas : [];
      v.purchase.comision = normComision(v.purchase.comision);
    }
    if (v.sale) {
      v.sale.comision = normComision(v.sale.comision);
      if (v.sale.financiacion) {
        v.sale.financiacion.cuotas = Array.isArray(v.sale.financiacion.cuotas) ? v.sale.financiacion.cuotas : [];
      } else v.sale.financiacion = null;
    }
    v.origin = normalizeOrigin(v.origin);
    if (typeof v.deleted !== 'boolean') v.deleted = false;
    return v;
  }

  /* ------------------------------ Listeners ------------------------------- */
  function subscribe(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (l) { return l !== fn; }); }; }
  function remoteSafetyMissing() {
    return !!(App.auth && App.auth.enabled && App.data && App.data.safetyAvailable && !App.data.safetyAvailable() && !(App.data.isOffline && App.data.isOffline()));
  }
  function deliveryGenerationMissing() {
    return !!(App.auth && App.auth.enabled && App.data && App.data.deliveryReady && !App.data.deliveryReady());
  }
  function requiresRemoteBackup() {
    return !!(App.auth && App.auth.enabled && !(App.data && App.data.isOffline && App.data.isOffline()));
  }
  function emit() {
    if (remoteSafetyMissing() || deliveryGenerationMissing()) {
      if (safetyBaseline) state = deepClone(safetyBaseline);
      lastMutation = Promise.resolve({ status: 'rejected', reason: 'safety' });
      App.ui && App.ui.toast(deliveryGenerationMissing()
        ? 'Cambios bloqueados hasta cargar la etapa comercial vigente desde Supabase.'
        : 'Cambios bloqueados: aplicá primero la migración de auditoría y recuperación en Supabase.', 'error');
      listeners.forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } });
      return false;
    }
    if (App.auth && App.auth.enabled && App.data && App.data.backupWritesBlocked && App.data.backupWritesBlocked()) {
      if (safetyBaseline) state = deepClone(safetyBaseline);
      lastMutation = Promise.resolve({ status: 'rejected', reason: 'backup' });
      App.ui && App.ui.toast('Los cambios están pausados hasta completar la copia de seguridad. Podés seguir consultando la información.', 'error');
      listeners.forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } });
      return false;
    }
    lastMutation = Promise.resolve(save()).then(function (result) {
      return result && result.status ? result : { status: result === false ? 'pending' : 'synced' };
    }, function () { return { status: 'pending', reason: 'sync' }; });
    listeners.forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } });
    return true;
  }
  function afterMutation() { return lastMutation; }
  function finishMutation(message, onContinue) {
    return afterMutation().then(function (result) {
      result = result || { status: 'pending' };
      if (result.status === 'rejected') {
        App.ui && App.ui.toast('No se pudo completar la operación. Supabase la rechazó y no se aplicaron los cambios. ' +
          (result.reason === 'backup' ? 'Reintentá la copia desde el aviso.' : 'Revisá la protección y volvé a intentar.'), 'error');
        return false;
      }
      if (result.status === 'pending') {
        App.ui && App.ui.toast(message + '. Guardado en este dispositivo; pendiente de sincronización.', 'info');
      } else {
        App.ui && App.ui.toast(message, 'success');
      }
      if (onContinue) onContinue(result);
      return result.status;
    });
  }
  function discardRejectedChanges(remoteState) {
    state = migrate(deepClone(remoteState || emptyState()));
    safetyBaseline = deepClone(state);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    listeners.forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } });
  }
  function safetyReady(action) {
    if (deliveryGenerationMissing()) {
      App.ui && App.ui.toast('Esta acción queda bloqueada hasta cargar la etapa comercial vigente desde Supabase.', 'error');
      return false;
    }
    if (remoteSafetyMissing()) {
      App.ui && App.ui.toast('Esta acción está bloqueada hasta aplicar la migración SUPABASE/2-seguridad-y-recuperacion.sql.', 'error');
      return false;
    }
    if (App.auth && App.auth.enabled && App.data && App.data.backupWritesBlocked && App.data.backupWritesBlocked()) {
      App.ui && App.ui.toast('Esta acción queda pausada hasta completar la copia de seguridad.', 'error');
      return false;
    }
    return true;
  }

  /* --------------------------- Historial general ------------------------- */
  function logEvent(evt) {
    var e = {
      id: uid('h'),
      ts: Date.now(),
      fecha: evt.fecha || todayISO(),
      tipo: evt.tipo,                 // compra | venta | gasto | cuota | estado | edicion | parte-pago | papelera | restaurar | otro
      vehicleId: evt.vehicleId || null,
      titulo: evt.titulo || '',
      detalle: evt.detalle || '',
      monto: (typeof evt.monto === 'number') ? evt.monto : null,
      moneda: evt.moneda || null,
      meta: evt.meta || {}
    };
    state.history.push(e);
    return e;
  }

  /* --------------------------- CRUD Vehículos ---------------------------- */
  function createVehicle(data, opts) {
    opts = opts || {};
    var v = {
      id: uid('v'),
      marca: (data.marca || '').trim(),
      modelo: (data.modelo || '').trim(),
      anio: toIntOrNull(data.anio),
      patente: (data.patente || '').trim().toUpperCase(),
      km: toIntOrNull(data.km),
      combustible: data.combustible || '',
      caja: data.caja || '',
      version: (data.version || '').trim(),
      precioPretendido: data.precioPretendido != null && data.precioPretendido !== '' ? num(data.precioPretendido) : null,
      precioPretendidoMoneda: data.precioPretendidoMoneda || 'ARS',
      fotoPrincipal: '',
      fotos: [],
      estado: data.estado || 'stock',
      documentacion: data.documentacion || 'pendiente',
      observaciones: data.observaciones || '',
      checklist: data.checklist || {},
      purchase: null,
      sale: null,
      reservation: null,
      expenses: [],
      origin: normalizeOrigin(data.origin || { type: 'compra' }),
      deleted: false,
      deletedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    state.vehicles.push(v);
    if (!opts.silent) {
      logEvent({
        tipo: 'otro', vehicleId: v.id, fecha: todayISO(),
        titulo: 'Registraste ' + vehicleName(v),
        detalle: 'Vehículo agregado al sistema' + (v.origin.type === 'parte-de-pago' ? ' (recibido como parte de pago)' : '')
      });
    }
    if (!emit()) return null;
    return v;
  }

  function updateVehicle(id, patch, opts) {
    opts = opts || {};
    var v = getVehicle(id);
    if (!v) return null;
    var before = deepClone(v);
    Object.keys(patch).forEach(function (k) { v[k] = patch[k]; });
    if (v.patente) v.patente = String(v.patente).toUpperCase().trim();
    v.updatedAt = Date.now();
    normalizeVehicle(v);
    if (!opts.silent) {
      var changed = describeChanges(before, v);
      if (before.estado !== v.estado) {
        logEvent({ tipo: 'estado', vehicleId: v.id, titulo: 'Cambiaste el estado de ' + vehicleName(v), detalle: estadoLabel(before.estado) + ' → ' + estadoLabel(v.estado) });
      }
      if (changed.length && (before.estado === v.estado)) {
        logEvent({ tipo: 'edicion', vehicleId: v.id, titulo: 'Editaste ' + vehicleName(v), detalle: changed.join(', ') });
      }
    }
    if (!emit()) return null;
    return v;
  }

  function describeChanges(a, b) {
    var fields = { marca: 'marca', modelo: 'modelo', anio: 'año', patente: 'patente', km: 'km', combustible: 'combustible', caja: 'caja', version: 'versión', documentacion: 'documentación', observaciones: 'observaciones' };
    var out = [];
    Object.keys(fields).forEach(function (f) {
      if (JSON.stringify(a[f]) !== JSON.stringify(b[f])) out.push(fields[f]);
    });
    return out;
  }

  function softDeleteVehicle(id) {
    if (!safetyReady('eliminar')) return;
    var v = getVehicle(id);
    if (!v) return;
    v.deleted = true;
    v.deletedAt = Date.now();
    addTrashEntry('vehicle', v.id, null, { vehicle: deepClone(v), history: deepClone(state.history.filter(function (h) { return h.vehicleId === id; })) }, 'Vehículo');
    logEvent({ tipo: 'papelera', vehicleId: v.id, titulo: 'Enviaste a papelera ' + vehicleName(v), detalle: 'El vehículo puede restaurarse desde la Papelera' });
    if (!emit()) return false;
    return true;
  }

  function restoreVehicle(id) {
    if (!safetyReady('restaurar')) return;
    var v = getVehicle(id);
    if (!v) return;
    v.deleted = false;
    v.deletedAt = null;
    markTrashRestored('vehicle', v.id);
    logEvent({ tipo: 'restaurar', vehicleId: v.id, titulo: 'Restauraste ' + vehicleName(v), detalle: 'El vehículo volvió al sistema' });
    if (App.data && App.data.logOperation) App.data.logOperation('restauracion', 'vehicle', { entityId: id });
    if (!emit()) return false;
    return true;
  }

  function hardDeleteVehicle(id) {
    if (!safetyReady('eliminar')) return;
    var v = getVehicle(id);
    if (!v) return;
    var savedInTrash = (state.trash || []).some(function (x) { return x.entity === 'vehicle' && x.entityId === id && !x.restoredAt; });
    if (!savedInTrash) addTrashEntry('vehicle', v.id, null, { vehicle: deepClone(v), history: deepClone(state.history.filter(function (h) { return h.vehicleId === id; })) }, 'Vehículo eliminado definitivamente');
    state.vehicles = state.vehicles.filter(function (x) { return x.id !== id; });
    // limpiar referencias de parte de pago (en ambos sentidos, para que ninguna
    // relación quede apuntando a un vehículo que ya no existe)
    state.vehicles.forEach(function (x) {
      if (x.sale && x.sale.tradeIn && x.sale.tradeIn.vehicleId === id) x.sale.tradeIn.vehicleId = null;
      if (x.origin && x.origin.type === 'parte-de-pago' && x.origin.saleVehicleId === id) x.origin.saleVehicleId = null;
    });
    state.history = state.history.filter(function (h) { return h.vehicleId !== id; });
    if (!emit()) return false;
    return true;
  }

  /* --------------------------- Registrar compra ------------------------- */
  function setPurchase(id, purchase) {
    var v = getVehicle(id);
    if (!v) return null;
    var esNuevo = !v.purchase;
    v.purchase = {
      fecha: purchase.fecha || todayISO(),
      precio: num(purchase.precio),
      moneda: purchase.moneda || 'ARS',
      // cotización histórica al momento de la compra; para compras en USD sin dato, se fija la cotización actual como referencia
      cotizacionUSD: num(purchase.cotizacionUSD) || (purchase.moneda === 'USD' ? state.settings.dolarActual : null),
      formaPago: purchase.formaPago || 'transferencia',
      montoTransferencia: num(purchase.montoTransferencia) || 0,
      montoEfectivo: num(purchase.montoEfectivo) || 0,
      cuotas: normalizeCuotas(purchase.cuotas),
      proveedor: purchase.proveedor && (purchase.proveedor.nombre || purchase.proveedor.telefono || purchase.proveedor.notas)
        ? { nombre: (purchase.proveedor.nombre || '').trim(), telefono: (purchase.proveedor.telefono || '').trim(), notas: (purchase.proveedor.notas || '').trim() }
        : null,
      comision: normComision(purchase.comision)
    };
    v.updatedAt = Date.now();
    logEvent({
      tipo: 'compra', vehicleId: v.id, fecha: v.purchase.fecha,
      titulo: (esNuevo ? 'Compraste ' : 'Actualizaste la compra de ') + vehicleName(v),
      detalle: 'Precio: ' + App.fmt.money(v.purchase.precio, v.purchase.moneda) +
        (v.purchase.moneda === 'ARS' && v.purchase.cotizacionUSD ? ' · Dólar: ' + App.fmt.money(v.purchase.cotizacionUSD, 'ARS') : '') +
        ' · ' + formaPagoLabel(v.purchase.formaPago),
      monto: v.purchase.precio, moneda: v.purchase.moneda
    });
    if (!emit()) return null;
    return v;
  }

  function normalizeCuotas(cuotas) {
    if (!Array.isArray(cuotas)) return [];
    return cuotas.map(function (c, i) {
      return {
        id: c.id || uid('c'),
        numero: c.numero || (i + 1),
        monto: num(c.monto),
        vencimiento: c.vencimiento || '',
        pagada: !!c.pagada,
        fechaPago: c.fechaPago || null
      };
    });
  }

  // cuotas que TE tienen que pagar (venta financiada)
  function normalizeCuotasCobro(cuotas) {
    if (!Array.isArray(cuotas)) return [];
    return cuotas.map(function (c, i) {
      return {
        id: c.id || uid('cc'),
        numero: c.numero || (i + 1),
        monto: num(c.monto),
        vencimiento: c.vencimiento || '',
        cobrada: !!c.cobrada,
        fechaCobro: c.fechaCobro || null
      };
    });
  }

  function pagarCuota(vehicleId, cuotaId, fechaPago) {
    var v = getVehicle(vehicleId);
    if (!v || !v.purchase) return;
    var c = (v.purchase.cuotas || []).filter(function (x) { return x.id === cuotaId; })[0];
    if (!c) return;
    c.pagada = true;
    c.fechaPago = fechaPago || todayISO();
    logEvent({
      tipo: 'cuota', vehicleId: v.id, fecha: c.fechaPago,
      titulo: 'Pagaste la cuota ' + c.numero + '/' + v.purchase.cuotas.length + ' de ' + vehicleName(v),
      detalle: App.fmt.money(c.monto, v.purchase.moneda),
      monto: c.monto, moneda: v.purchase.moneda
    });
    if (!emit()) return false;
    return true;
  }

  function desmarcarCuota(vehicleId, cuotaId) {
    var v = getVehicle(vehicleId);
    if (!v || !v.purchase) return;
    var c = (v.purchase.cuotas || []).filter(function (x) { return x.id === cuotaId; })[0];
    if (!c) return;
    c.pagada = false;
    c.fechaPago = null;
    if (!emit()) return false;
    return true;
  }

  /* ---------------------------- Registrar venta ------------------------- */
  function setSale(id, sale) {
    var v = getVehicle(id);
    if (!v) return null;
    var esNuevo = !v.sale;

    var tradeIn = null;
    if (sale.tradeIn && sale.tradeIn.enabled) {
      tradeIn = {
        vehicleId: sale.tradeIn.vehicleId || null,
        marca: (sale.tradeIn.marca || '').trim(),
        modelo: (sale.tradeIn.modelo || '').trim(),
        anio: toIntOrNull(sale.tradeIn.anio),
        patente: (sale.tradeIn.patente || '').trim().toUpperCase(),
        km: toIntOrNull(sale.tradeIn.km),
        valor: num(sale.tradeIn.valor),
        moneda: sale.tradeIn.moneda || 'ARS',
        observaciones: (sale.tradeIn.observaciones || '').trim(),
        fotos: []
      };
    }

    var financiacion = null;
    if (sale.financiacion && sale.financiacion.enabled) {
      financiacion = {
        entidad: (sale.financiacion.entidad || '').trim(),
        entrega: num(sale.financiacion.entrega) || 0,
        moneda: sale.financiacion.moneda || sale.moneda || 'ARS',
        cuotas: normalizeCuotasCobro(sale.financiacion.cuotas),
        notas: (sale.financiacion.notas || '').trim()
      };
    }

    v.sale = {
      fecha: sale.fecha || todayISO(),
      precio: num(sale.precio),
      moneda: sale.moneda || 'ARS',
      cotizacionUSD: num(sale.cotizacionUSD) || (sale.moneda === 'USD' ? state.settings.dolarActual : null),
      formaCobro: sale.formaCobro || 'transferencia',
      montoTransferencia: num(sale.montoTransferencia) || 0,
      montoEfectivo: num(sale.montoEfectivo) || 0,
      cliente: sale.cliente && (sale.cliente.nombre || sale.cliente.telefono || sale.cliente.notas)
        ? { nombre: (sale.cliente.nombre || '').trim(), telefono: (sale.cliente.telefono || '').trim(), notas: (sale.cliente.notas || '').trim() }
        : null,
      tradeIn: tradeIn,
      financiacion: financiacion,
      comision: normComision(sale.comision),
      diferencia: sale.diferencia && sale.diferencia.monto != null
        ? {
            monto: num(sale.diferencia.monto), moneda: sale.diferencia.moneda || 'ARS',
            montoEfectivo: num(sale.diferencia.montoEfectivo) || 0,
            montoTransferencia: num(sale.diferencia.montoTransferencia) || 0
          }
        : null
    };
    v.estado = 'vendido';
    v.updatedAt = Date.now();

    // Crear el vehículo recibido como parte de pago e incorporarlo al stock
    if (tradeIn && !tradeIn.vehicleId) {
      var nuevo = createVehicle({
        marca: tradeIn.marca, modelo: tradeIn.modelo, anio: tradeIn.anio,
        patente: tradeIn.patente, km: tradeIn.km,
        observaciones: tradeIn.observaciones,
        estado: 'stock',
        origin: { type: 'parte-de-pago', saleVehicleId: v.id }
      }, { silent: true });
      // registrar la "compra" implícita del vehículo recibido, al valor asignado
      nuevo.purchase = {
        fecha: v.sale.fecha,
        precio: tradeIn.valor,
        moneda: tradeIn.moneda,
        cotizacionUSD: v.sale.cotizacionUSD || state.settings.dolarActual,
        formaPago: 'parte-de-pago',
        montoTransferencia: 0, montoEfectivo: 0, cuotas: [],
        proveedor: v.sale.cliente ? { nombre: v.sale.cliente.nombre, telefono: v.sale.cliente.telefono, notas: 'Entregado como parte de pago por ' + vehicleName(v) } : null
      };
      tradeIn.vehicleId = nuevo.id;
      logEvent({
        tipo: 'parte-pago', vehicleId: nuevo.id, fecha: v.sale.fecha,
        titulo: 'Ingresó ' + vehicleName(nuevo) + ' como parte de pago',
        detalle: 'Valor asignado: ' + App.fmt.money(tradeIn.valor, tradeIn.moneda) + ' · Operación: venta de ' + vehicleName(v),
        monto: tradeIn.valor, moneda: tradeIn.moneda, meta: { saleVehicleId: v.id }
      });
    }

    logEvent({
      tipo: 'venta', vehicleId: v.id, fecha: v.sale.fecha,
      titulo: (esNuevo ? 'Vendiste ' : 'Actualizaste la venta de ') + vehicleName(v),
      detalle: 'Precio: ' + App.fmt.money(v.sale.precio, v.sale.moneda) +
        (v.sale.moneda === 'ARS' && v.sale.cotizacionUSD ? ' · Dólar: ' + App.fmt.money(v.sale.cotizacionUSD, 'ARS') : '') +
        (tradeIn ? ' · + vehículo recibido' : ''),
      monto: v.sale.precio, moneda: v.sale.moneda
    });
    if (!emit()) return null;
    return v;
  }

  function cancelarVenta(id) {
    var v = getVehicle(id);
    if (!v || !v.sale) return;
    // si había un vehículo generado como parte de pago y no fue tocado, se envía a papelera
    if (v.sale.tradeIn && v.sale.tradeIn.vehicleId) {
      var ti = getVehicle(v.sale.tradeIn.vehicleId);
      if (ti && !ti.sale && !ti.reservation && (ti.expenses || []).length === 0) {
        ti.deleted = true; ti.deletedAt = Date.now();
      }
    }
    v.sale = null;
    v.estado = v.reservation ? 'reservado' : 'stock';
    logEvent({ tipo: 'estado', vehicleId: v.id, titulo: 'Anulaste la venta de ' + vehicleName(v), detalle: 'El vehículo volvió a ' + estadoLabel(v.estado).toLowerCase() });
    if (!emit()) return false;
    return true;
  }

  /* ------------------------------ Reserva / seña ---------------------- */
  function setReservation(id, data) {
    var v = getVehicle(id);
    if (!v) return null;
    var esNuevo = !v.reservation;
    v.reservation = {
      fecha: data.fecha || todayISO(),
      monto: num(data.monto),
      moneda: data.moneda || 'ARS',
      cotizacionUSD: num(data.cotizacionUSD) || (data.moneda === 'USD' ? state.settings.dolarActual : null),
      vence: data.vence || '',
      cliente: (data.cliente && (data.cliente.nombre || data.cliente.telefono))
        ? { nombre: (data.cliente.nombre || '').trim(), telefono: (data.cliente.telefono || '').trim() }
        : null,
      notas: (data.notas || '').trim()
    };
    if (v.estado === 'stock') v.estado = 'reservado';
    v.updatedAt = Date.now();
    logEvent({
      tipo: 'reserva', vehicleId: v.id, fecha: v.reservation.fecha,
      titulo: (esNuevo ? 'Reservaste ' : 'Actualizaste la reserva de ') + vehicleName(v),
      detalle: 'Seña ' + App.fmt.money(v.reservation.monto, v.reservation.moneda) +
        (v.reservation.cliente ? ' · ' + v.reservation.cliente.nombre : '') +
        (v.reservation.vence ? ' · vence ' + App.fmt.date(v.reservation.vence) : ''),
      monto: v.reservation.monto, moneda: v.reservation.moneda
    });
    if (!emit()) return false;
    return v;
  }
  function cancelReservation(id) {
    var v = getVehicle(id);
    if (!v || !v.reservation) return;
    v.reservation = null;
    if (v.estado === 'reservado') v.estado = 'stock';
    logEvent({ tipo: 'estado', vehicleId: v.id, titulo: 'Cancelaste la reserva de ' + vehicleName(v), detalle: 'El vehículo volvió a stock' });
    if (!emit()) return false;
    return true;
  }

  /* ----------------- Cuotas a cobrar (venta financiada) ------------- */
  function cobrarCuotaVenta(vehicleId, cuotaId, fecha) {
    var v = getVehicle(vehicleId);
    if (!v || !v.sale || !v.sale.financiacion) return;
    var c = (v.sale.financiacion.cuotas || []).filter(function (x) { return x.id === cuotaId; })[0];
    if (!c) return;
    c.cobrada = true;
    c.fechaCobro = fecha || todayISO();
    logEvent({
      tipo: 'cobro', vehicleId: v.id, fecha: c.fechaCobro,
      titulo: 'Cobraste la cuota ' + c.numero + '/' + v.sale.financiacion.cuotas.length + ' de ' + vehicleName(v),
      detalle: App.fmt.money(c.monto, v.sale.financiacion.moneda),
      monto: c.monto, moneda: v.sale.financiacion.moneda
    });
    if (!emit()) return false;
    return true;
  }
  function descobrarCuotaVenta(vehicleId, cuotaId) {
    var v = getVehicle(vehicleId);
    if (!v || !v.sale || !v.sale.financiacion) return;
    var c = (v.sale.financiacion.cuotas || []).filter(function (x) { return x.id === cuotaId; })[0];
    if (!c) return;
    c.cobrada = false; c.fechaCobro = null;
    if (!emit()) return false;
    return true;
  }

  /* ------------------------------- Gastos ------------------------------- */
  function addExpense(vehicleId, expense) {
    var v = getVehicle(vehicleId);
    if (!v) return;
    var e = {
      id: uid('g'),
      monto: num(expense.monto),
      moneda: expense.moneda || 'ARS',
      fecha: expense.fecha || todayISO(),
      cotizacionUSD: num(expense.cotizacionUSD) || null,
      observacion: (expense.observacion || '').trim(),
      createdAt: Date.now()
    };
    v.expenses.push(e);
    v.updatedAt = Date.now();
    logEvent({
      tipo: 'gasto', vehicleId: v.id, fecha: e.fecha,
      titulo: 'Agregaste un gasto a ' + vehicleName(v),
      detalle: App.fmt.money(e.monto, e.moneda) + (e.observacion ? ' · ' + e.observacion : ''),
      monto: e.monto, moneda: e.moneda
    });
    if (!emit()) return null;
    return e;
  }

  function updateExpense(vehicleId, expenseId, patch) {
    var v = getVehicle(vehicleId);
    if (!v) return;
    var e = v.expenses.filter(function (x) { return x.id === expenseId; })[0];
    if (!e) return;
    Object.assign(e, patch);
    e.monto = num(e.monto);
    v.updatedAt = Date.now();
    if (!emit()) return false;
    return true;
  }

  function removeExpense(vehicleId, expenseId) {
    if (!safetyReady('eliminar')) return;
    var v = getVehicle(vehicleId);
    if (!v) return;
    var removed = v.expenses.filter(function (x) { return x.id === expenseId; })[0];
    if (!removed) return;
    addTrashEntry('expense', removed.id, vehicleId, removed, 'Gasto de vehículo');
    v.expenses = v.expenses.filter(function (x) { return x.id !== expenseId; });
    v.updatedAt = Date.now();
    logEvent({ tipo: 'gasto', vehicleId: v.id, titulo: 'Eliminaste un gasto de ' + vehicleName(v), detalle: '' });
    if (!emit()) return false;
    return true;
  }

  /* --------------------- Gastos fijos del negocio -------------------- */
  function getFixedExpenses() { return (state.fixedExpenses || []).slice(); }
  function getFixedExpense(id) { return (state.fixedExpenses || []).filter(function (f) { return f.id === id; })[0] || null; }
  function addFixedExpense(data) {
    if (!state.fixedExpenses) state.fixedExpenses = [];
    var f = normalizeFixedExpense({
      concepto: data.concepto, categoria: data.categoria, monto: data.monto, moneda: data.moneda,
      cotizacionUSD: data.cotizacionUSD, frecuencia: data.frecuencia, fecha: data.fecha, hasta: data.hasta, notas: data.notas
    });
    state.fixedExpenses.push(f);
    logEvent({
      tipo: 'gasto-fijo', fecha: f.fecha,
      titulo: 'Gasto del negocio: ' + (f.concepto || categoriaLabel(f.categoria)),
      detalle: App.fmt.money(f.monto, f.moneda) + (f.frecuencia === 'mensual' ? ' · por mes' : ' · una vez'),
      monto: f.monto, moneda: f.moneda
    });
    if (!emit()) return null;
    return f;
  }
  function updateFixedExpense(id, patch) {
    var f = getFixedExpense(id);
    if (!f) return null;
    Object.keys(patch).forEach(function (k) { f[k] = patch[k]; });
    normalizeFixedExpense(f);
    if (!emit()) return null;
    return f;
  }
  function removeFixedExpense(id) {
    if (!safetyReady('eliminar')) return;
    var removed = getFixedExpense(id);
    if (removed) addTrashEntry('fixed_expense', removed.id, null, removed, 'Gasto fijo');
    state.fixedExpenses = (state.fixedExpenses || []).filter(function (f) { return f.id !== id; });
    if (!emit()) return false;
    return true;
  }
  function categoriaLabel(c) {
    return ({ alquiler: 'Alquiler del local', sueldos: 'Sueldos', seguros: 'Seguros / flota', patentes: 'Patentes e impuestos', servicios: 'Servicios (luz, internet…)', publicidad: 'Publicidad', otro: 'Otro' })[c] || c;
  }

  /* ------------------------------ Settings ------------------------------ */
  function updateSettings(patch) {
    Object.assign(state.settings, patch);
    if (patch.dolarActual != null) state.settings.dolarActual = num(patch.dolarActual);
    if (!emit()) return false;
    return true;
  }

  /* ---------------------------- Recordatorios ------------------------- */
  function getReminders() { return (state.reminders || []).slice(); }
  function getReminder(id) { return (state.reminders || []).filter(function (r) { return r.id === id; })[0] || null; }
  function addReminder(data) {
    if (!state.reminders) state.reminders = [];
    var r = normalizeReminder({
      titulo: data.titulo, fecha: data.fecha, hora: data.hora,
      tipo: data.tipo, nota: data.nota, repeat: data.repeat
    });
    state.reminders.push(r);
    if (!emit()) return null;
    return r;
  }
  function updateReminder(id, patch) {
    var r = getReminder(id);
    if (!r) return null;
    Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
    normalizeReminder(r);
    if (!emit()) return null;
    return r;
  }
  // marca / desmarca UNA ocurrencia (para recordatorios que se repiten,
  // completar "esta semana" no completa toda la serie)
  function toggleReminderOccurrence(id, occDate) {
    var r = getReminder(id);
    if (!r) return;
    occDate = occDate || ((r.repeat && r.repeat !== 'none') ? todayISO() : r.fecha);
    var i = r.doneDates.indexOf(occDate);
    if (i >= 0) r.doneDates.splice(i, 1);
    else r.doneDates.push(occDate);
    if (!emit()) return false;
    return true;
  }
  function removeReminder(id) {
    if (!safetyReady('eliminar')) return;
    var removed = getReminder(id);
    if (removed) addTrashEntry('reminder', removed.id, null, removed, 'Recordatorio');
    state.reminders = (state.reminders || []).filter(function (r) { return r.id !== id; });
    if (!emit()) return false;
    return true;
  }

  function addTrashEntry(entity, entityId, parentId, data, label) {
    if (!state.trash) state.trash = [];
    state.trash.push({ id: uid('trash'), entity: entity, entityId: entityId, parentId: parentId,
      label: label, deletedAt: Date.now(), deletedBy: App.auth && App.auth.profile ? App.auth.profile.id : null,
      data: deepClone(data), restoredAt: null });
  }
  function markTrashRestored(entity, entityId) {
    (state.trash || []).forEach(function (x) { if (x.entity === entity && x.entityId === entityId && !x.restoredAt) x.restoredAt = Date.now(); });
  }
  function getTrash() { return (state.trash || []).slice().filter(function (x) { return !x.restoredAt; }).sort(function (a, b) { return b.deletedAt - a.deletedAt; }); }
  function allTrash() { return (state.trash || []).slice().sort(function (a, b) { return b.deletedAt - a.deletedAt; }); }
  function restoreTrash(id) {
    if (!safetyReady('restaurar')) return false;
    var item = (state.trash || []).filter(function (x) { return x.id === id && !x.restoredAt; })[0];
    if (!item) return false;
    var now = Date.now();
    if (item.entity === 'vehicle') {
      var saved = item.data && item.data.vehicle ? item.data : { vehicle: item.data, history: [] };
      var existing = getVehicle(item.entityId);
      if (existing) { existing.deleted = false; existing.deletedAt = null; }
      else { var restoredVehicle = deepClone(saved.vehicle); restoredVehicle.deleted = false; restoredVehicle.deletedAt = null; state.vehicles.push(restoredVehicle); }
      (saved.history || []).forEach(function (h) { if (!getEvent(h.id)) state.history.push(h); });
    } else if (item.entity === 'expense') {
      var parent = getVehicle(item.parentId); if (!parent) return false;
      if (!parent.expenses.some(function (x) { return x.id === item.entityId; })) parent.expenses.push(item.data);
    } else if (item.entity === 'fixed_expense') {
      if (!getFixedExpense(item.entityId)) state.fixedExpenses.push(item.data);
    } else if (item.entity === 'reminder') {
      if (!getReminder(item.entityId)) state.reminders.push(item.data);
    } else return false;
    item.restoredAt = now;
    if (App.data && App.data.logOperation) App.data.logOperation('restauracion', item.entity, { trashId: item.id, entityId: item.entityId });
    if (!emit()) return false;
    return true;
  }

  /* ------------------------- Import / Export / Reset ------------------- */
  function exportJSON() { return JSON.stringify(state, null, 2); }
  function importJSON(text) {
    var parsed = JSON.parse(text);
    var imported = migrate(parsed);
    var requireRemote = requiresRemoteBackup();
    return createSnapshot('Estado anterior a importación', requireRemote).then(function () {
      var operation = App.data && App.data.logOperation ? App.data.logOperation('importacion', 'estado_completo', summarizeChange(state, imported)) : Promise.resolve(false);
      return Promise.resolve(operation).then(function (logged) {
      if (requireRemote && !logged) throw new Error('No se pudo registrar la importación; no se reemplazaron los datos.');
      if (App.data && App.data.markBulkOperation && !App.data.markBulkOperation('importacion', requireRemote, state)) {
        throw new Error('No se pudo conservar la importación pendiente de sincronización.');
      }
      var previousTrash = (state.trash || []).slice();
      state = imported;
      var seenTrash = {}; state.trash.forEach(function (x) { seenTrash[x.id] = true; });
      previousTrash.forEach(function (x) { if (!seenTrash[x.id]) state.trash.push(x); });
      if (!emit()) return false;
      return afterMutation();
      });
    });
  }
  function resetAll() {
    var requireRemote = requiresRemoteBackup();
    return createSnapshot('Estado anterior a reset', requireRemote).then(function () {
      var operation = App.data && App.data.logOperation ? App.data.logOperation('reinicio', 'estado_completo', summarizeChange(state, emptyState())) : Promise.resolve(false);
      return Promise.resolve(operation).then(function (logged) {
      if (requireRemote && !logged) throw new Error('No se pudo registrar el reinicio; no se reemplazaron los datos.');
      if (App.data && App.data.markBulkOperation && !App.data.markBulkOperation('reset', requireRemote, state)) {
        throw new Error('No se pudo conservar el reset pendiente de sincronización.');
      }
      var previousTrash = (state.trash || []).slice();
      state = emptyState();
      state.trash = previousTrash;
      if (!emit()) throw new Error('Supabase bloqueó el reinicio; se conservaron los datos anteriores.');
      return afterMutation();
      });
    });
  }

  /* ------------------------------- Getters ----------------------------- */
  function getState() { return state; }
  function summarizeState(s) { return { vehicles: (s.vehicles || []).length, history: (s.history || []).length, reminders: (s.reminders || []).length, fixed_expenses: (s.fixedExpenses || []).length }; }
  function summarizeChange(before, after) {
    var result = { before: summarizeState(before), after: summarizeState(after), changes: {} };
    [['vehicles','vehicles'],['history','history'],['reminders','reminders'],['fixed_expenses','fixedExpenses']].forEach(function (p) {
      var old = {}, cur = {};
      (before[p[1]] || []).forEach(function (x) { old[x.id] = x; });
      (after[p[1]] || []).forEach(function (x) { cur[x.id] = x; });
      var insert = 0, update = 0, del = 0;
      Object.keys(cur).forEach(function (id) { if (!old[id]) insert++; else if (JSON.stringify(old[id]) !== JSON.stringify(cur[id])) update++; });
      Object.keys(old).forEach(function (id) { if (!cur[id]) del++; });
      result.changes[p[0]] = { INSERT: insert, UPDATE: update, DELETE: del };
    });
    return result;
  }
  function getVehicle(id) { return state.vehicles.filter(function (v) { return v.id === id; })[0] || null; }
  function activeVehicles() { return state.vehicles.filter(function (v) { return !v.deleted; }); }
  function trashedVehicles() { return state.vehicles.filter(function (v) { return v.deleted; }); }
  function getHistory() { return state.history.slice().sort(function (a, b) { return b.ts - a.ts; }); }
  function getEvent(id) { return state.history.filter(function (h) { return h.id === id; })[0] || null; }

  /* ----------------------------- Helpers varios ----------------------- */
  // Interpreta números escritos en formato argentino (1.500.000,50) o con
  // notación "genérica" (1500.50 / 1,500.50) sin que el usuario tenga que
  // pensar en el formato. Antes se asumía siempre "punto = miles" y un monto
  // como "1500.50" (muy común al tipear con teclado numérico en inglés)
  // quedaba guardado como 150050 — un error silencioso de x100 en dinero.
  function num(x) {
    var s = String(x == null ? '' : x).trim();
    if (!s) return 0;
    var neg = s.charAt(0) === '-';
    s = s.replace(/[^0-9.,]/g, '');
    var lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      // están los dos separadores: el que aparece último es el decimal
      s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (lastComma > -1) {
      var cp = s.split(',');
      s = (cp.length === 2 && cp[1].length <= 2) ? (cp[0] + '.' + cp[1]) : s.replace(/,/g, '');
    } else if (lastDot > -1) {
      var dp = s.split('.');
      // un solo punto seguido de 3 dígitos es ambiguo entre "miles" (AR) y
      // decimal; en montos de dinero (máx. 2 decimales) siempre es miles.
      if (!(dp.length === 2 && dp[1].length <= 2)) s = s.replace(/\./g, '');
    }
    var n = parseFloat(s);
    n = isNaN(n) ? 0 : n;
    return neg ? -n : n;
  }
  function vehicleName(v) {
    return [v.marca, v.modelo, v.anio].filter(Boolean).join(' ') || (v.patente || 'Vehículo sin datos');
  }
  function estadoLabel(e) { return ({ stock: 'En stock', reservado: 'Reservado', vendido: 'Vendido' })[e] || e; }
  function formaPagoLabel(f) {
    return ({ transferencia: 'Transferencia', efectivo: 'Efectivo', mixto: 'Mitad transferencia / mitad efectivo', cuotas: 'En cuotas', 'parte-de-pago': 'Parte de pago' })[f] || f;
  }
  function formaCobroLabel(f) {
    return ({ transferencia: 'Transferencia', efectivo: 'Efectivo', mixto: 'Mitad transferencia / mitad efectivo', vehiculo: 'Entrega de vehículo', financiado: 'Financiado / con prenda' })[f] || f;
  }

  /* ------------------------------- Export API -------------------------- */
  window.App = window.App || {};
  App.store = {
    STORAGE_KEY: STORAGE_KEY,
    load: load, save: save, subscribe: subscribe,
    hydrate: hydrate, notify: notify, blankState: emptyState, migrate: migrate,
    getState: getState, getVehicle: getVehicle,
    activeVehicles: activeVehicles, trashedVehicles: trashedVehicles,
    getHistory: getHistory, getEvent: getEvent,
    getTrash: getTrash, allTrash: allTrash, restoreTrash: restoreTrash,
    createVehicle: createVehicle, updateVehicle: updateVehicle,
    softDeleteVehicle: softDeleteVehicle, restoreVehicle: restoreVehicle, hardDeleteVehicle: hardDeleteVehicle,
    setPurchase: setPurchase, pagarCuota: pagarCuota, desmarcarCuota: desmarcarCuota,
    setSale: setSale, cancelarVenta: cancelarVenta,
    setReservation: setReservation, cancelReservation: cancelReservation,
    cobrarCuotaVenta: cobrarCuotaVenta, descobrarCuotaVenta: descobrarCuotaVenta,
    addExpense: addExpense, updateExpense: updateExpense, removeExpense: removeExpense,
    getFixedExpenses: getFixedExpenses, getFixedExpense: getFixedExpense,
    addFixedExpense: addFixedExpense, updateFixedExpense: updateFixedExpense, removeFixedExpense: removeFixedExpense,
    getReminders: getReminders, getReminder: getReminder, addReminder: addReminder,
    updateReminder: updateReminder, toggleReminderOccurrence: toggleReminderOccurrence, removeReminder: removeReminder,
    updateSettings: updateSettings,
    exportJSON: exportJSON, importJSON: importJSON, resetAll: resetAll,
    markBackup: markBackup, takeSnapshot: takeSnapshot, createSnapshot: createSnapshot, cacheSnapshot: cacheSnapshot, getSnapshots: getSnapshots, restoreSnapshot: restoreSnapshot,
    logEvent: function (e) { logEvent(e); return emit(); },
    afterMutation: afterMutation,
    finishMutation: finishMutation,
    discardRejectedChanges: discardRejectedChanges,
    // helpers
    uid: uid, todayISO: todayISO, num: num,
    vehicleName: vehicleName, estadoLabel: estadoLabel, categoriaLabel: categoriaLabel,
    formaPagoLabel: formaPagoLabel, formaCobroLabel: formaCobroLabel
  };
})();
