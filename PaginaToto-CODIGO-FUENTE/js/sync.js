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

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function j(o) { return JSON.stringify(o); }

  /* ------------------------------- carga ------------------------------ */
  function loadAll() {
    return Promise.all([
      sb.from('vehicles').select('data'),
      sb.from('history').select('data'),
      sb.from('reminders').select('data'),
      sb.from('fixed_expenses').select('data'),
      sb.from('kv').select('k,data')
    ]).then(function (res) {
      res.forEach(function (r) { if (r.error) throw r.error; });
      var st = store.blankState();
      st.vehicles = (res[0].data || []).map(function (r) { return r.data; });
      st.history = (res[1].data || []).map(function (r) { return r.data; });
      st.reminders = (res[2].data || []).map(function (r) { return r.data; });
      st.fixedExpenses = (res[3].data || []).map(function (r) { return r.data; });
      (res[4].data || []).forEach(function (r) {
        if (r.k === 'settings') st.settings = Object.assign(st.settings, r.data || {});
        if (r.k === 'meta') st.meta = Object.assign(st.meta, r.data || {});
      });

      var vacio = !st.vehicles.length && !st.history.length && !st.reminders.length && !st.fixedExpenses.length;
      var local = null;
      try { local = JSON.parse(localStorage.getItem('paginaToto:v1') || 'null'); } catch (e) {}
      if (vacio && local && (local.vehicles || []).length) pendingMigration = local;

      applyingRemote = true;
      try { store.hydrate(st); } finally { applyingRemote = false; }
      shadow = clone(store.getState());
      subscribe();
    });
  }

  /* ----------------------------- tiempo real -------------------------- */
  function subscribe() {
    var ch = sb.channel('paginatoto-db');
    TABLES.concat(['kv']).forEach(function (t) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, function (payload) { onRemote(t, payload); });
    });
    ch.subscribe();
  }

  function onRemote(table, payload) {
    var st = store.getState();
    applyingRemote = true;
    try {
      if (table === 'kv') {
        if (payload.eventType === 'DELETE') return;
        var kk = payload.new.k;
        if (kk === 'settings') st.settings = Object.assign({}, st.settings, payload.new.data);
        else if (kk === 'meta') st.meta = Object.assign({}, st.meta, payload.new.data);
      } else {
        var arr = st[ARR[table]];
        if (payload.eventType === 'DELETE') {
          var oid = payload.old && payload.old.id;
          var i = -1; arr.forEach(function (x, k) { if (x.id === oid) i = k; });
          if (i >= 0) arr.splice(i, 1);
        } else {
          var d = payload.new.data;
          var jx = -1; arr.forEach(function (x, k) { if (x.id === d.id) jx = k; });
          if (jx >= 0) arr[jx] = d; else arr.push(d);
        }
      }
      shadow = clone(st);
      store.notify();
    } catch (e) {
      console.error('sync onRemote', e);
    } finally {
      applyingRemote = false;
    }
  }

  /* ------------------------ guardar (diff + subir) ------------------- */
  function onLocalChange(state) {
    if (applyingRemote) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { flush(state); }, 400);
  }

  function diffArr(table, cur, old, ops, tsField) {
    var oldById = {}; (old || []).forEach(function (x) { oldById[x.id] = x; });
    var curIds = {};
    (cur || []).forEach(function (x) {
      curIds[x.id] = true;
      var prev = oldById[x.id];
      if (!prev || j(prev) !== j(x)) {
        var row = { id: x.id, data: x };
        if (tsField) row.ts = x[tsField] || 0;
        ops.up[table].push(row);
      }
    });
    (old || []).forEach(function (x) { if (!curIds[x.id]) ops.del[table].push(x.id); });
  }

  function flush(state) {
    if (!shadow) shadow = clone(state);
    var ops = { up: { vehicles: [], history: [], reminders: [], fixed_expenses: [], kv: [] },
                del: { vehicles: [], history: [], reminders: [], fixed_expenses: [], kv: [] } };
    diffArr('vehicles', state.vehicles, shadow.vehicles, ops);
    diffArr('history', state.history, shadow.history, ops, 'ts');
    diffArr('reminders', state.reminders, shadow.reminders, ops);
    diffArr('fixed_expenses', state.fixedExpenses, shadow.fixedExpenses, ops);
    if (j(state.settings) !== j(shadow.settings)) ops.up.kv.push({ k: 'settings', data: state.settings });
    if (j(state.meta) !== j(shadow.meta)) ops.up.kv.push({ k: 'meta', data: state.meta });

    var promises = [];
    Object.keys(ops.up).forEach(function (t) {
      var key = t === 'kv' ? 'k' : 'id';
      if (ops.up[t].length) promises.push(sb.from(t).upsert(ops.up[t], { onConflict: key }));
      if (ops.del[t].length) promises.push(sb.from(t).delete().in(key, ops.del[t]));
    });
    if (!promises.length) { shadow = clone(state); return Promise.resolve(true); }

    return Promise.all(promises).then(function (results) {
      var bad = null;
      results.forEach(function (r) { if (r && r.error) bad = r.error; });
      if (bad) throw bad;
      shadow = clone(state);
      return true;
    }).catch(function (e) {
      console.error('sync flush', e);
      App.ui && App.ui.toast('No se pudo guardar en la nube. Revisá internet.', 'error');
      // reintenta solo en unos segundos (por si fue un corte momentáneo de internet)
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(function () { flush(store.getState()); }, 8000);
      return false;
    });
  }

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
    onLocalChange: onLocalChange,
    flushNow: function () { if (pushTimer) clearTimeout(pushTimer); return flush(store.getState()); },
    pendingMigrationInfo: pendingMigrationInfo,
    doMigration: doMigration,
    skipMigration: skipMigration
  };
})();
