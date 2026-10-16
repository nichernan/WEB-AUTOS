// Suite de sincronización completamente aislada: solo usa tablas en memoria.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourceDir = path.join(__dirname, '..', 'PaginaToto-CODIGO-FUENTE', 'js');
const generation = 'fixture-generation';
const events = [];
const audit = [];

function fixtureVehicle(id) {
  return { id, marca: 'TEMP', modelo: id, anio: 2020, patente: '', km: 100, combustible: '', caja: '',
    version: '', precioPretendido: null, precioPretendidoMoneda: 'ARS', fotoPrincipal: '', fotos: [], estado: 'stock',
    documentacion: 'pendiente', observaciones: '', checklist: {}, purchase: null, sale: null, reservation: null,
    expenses: [], origin: { type: 'compra' }, deleted: false, deletedAt: null, createdAt: 1, updatedAt: 1,
    _delivery_generation: generation };
}

function businessDay(date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function fixtureRows(vehicleCount, historyCount = 0) {
  return {
    vehicles: Array.from({ length: vehicleCount }, (_, i) => { const v = fixtureVehicle(`v${i + 1}`); return { id: v.id, data: v }; }),
    history: Array.from({ length: historyCount }, (_, i) => {
      const data = { id: `h${i + 1}`, ts: i + 1, fecha: '2026-10-16', tipo: 'otro', vehicleId: 'v1', titulo: `Historial ${i + 1}`,
        detalle: '', monto: null, moneda: null, meta: {}, _delivery_generation: generation };
      return { id: data.id, ts: data.ts, data };
    }), reminders: [], fixed_expenses: [], kv: [], audit_log: [], app_snapshots: [], app_trash: [], app_operations: [],
    app_delivery_state: [{ singleton: true, generation }]
  };
}

function recordAudit(table, operation, id, before, after) {
  audit.push({ table_name: table, operation, record_id: id, before_data: before || null, after_data: after || null });
}

class Query {
  constructor(rows, table) { this.rows = rows; this.table = table; this.action = 'select'; this.filters = []; this.payload = null; this.inFilter = null; this.limitValue = null; this.rangeValue = null; this.one = false; }
  select() { return this; }
  insert(payload) { this.action = 'insert'; this.payload = payload; return this; }
  upsert(payload) { this.action = 'upsert'; this.payload = payload; return this; }
  update(payload) { this.action = 'update'; this.payload = payload; return this; }
  delete() { this.action = 'delete'; return this; }
  eq(key, value) { this.filters.push([key, value]); return this; }
  in(key, values) { this.inFilter = [key, values]; return this; }
  limit(n) { this.limitValue = n; return this; }
  range(a, b) { this.rangeValue = [a, b]; return this; }
  order() { return this; }
  single() { this.one = true; return this; }
  maybeSingle() { this.one = true; return this; }
  then(resolve, reject) { return this.run().then(resolve, reject); }
  matches(row) { return this.filters.every(([key, value]) => row[key] === value) && (!this.inFilter || this.inFilter[1].includes(row[this.inFilter[0]])); }
  async run() {
    let rows = this.rows[this.table];
    if (!rows) throw new Error(`Unexpected isolated table ${this.table}`);
    if (this.action === 'select') {
      let result = rows.filter(row => this.matches(row));
      if (this.limitValue === 0) result = [];
      if (this.rangeValue) result = result.slice(this.rangeValue[0], this.rangeValue[1] + 1);
      return { data: this.one ? result[0] || null : result, error: null };
    }
    if (this.action === 'insert') {
      for (const input of (Array.isArray(this.payload) ? this.payload : [this.payload])) {
        const row = { ...input };
        if (this.table === 'app_snapshots') {
          row.snapshot_day = businessDay(new Date(row.created_at));
          if (row.source === 'daily' && rows.some(x => x.source === 'daily' && x.snapshot_day === row.snapshot_day)) {
            return { data: null, error: { code: '23505', message: 'duplicate key' } };
          }
          events.push({ type: 'snapshot', label: row.label, source: row.source });
        } else if (this.table === 'app_operations') events.push({ type: 'operation', action: row.action });
        else if (this.table === 'app_trash') events.push({ type: 'trash-insert', id: row.id });
        rows.push(row);
      }
      return { data: [], error: null };
    }
    if (this.action === 'upsert') {
      const key = this.table === 'kv' ? 'k' : 'id';
      for (const input of (Array.isArray(this.payload) ? this.payload : [this.payload])) {
        const idx = rows.findIndex(x => x[key] === input[key]);
        const before = idx >= 0 ? JSON.parse(JSON.stringify(rows[idx])) : null;
        const after = { ...(before || {}), ...input };
        if (idx >= 0) rows[idx] = after; else rows.push(after);
        const operation = before ? 'UPDATE' : 'INSERT';
        recordAudit(this.table, operation, input[key], before, after);
        events.push({ type: 'dml', table: this.table, operation, id: input[key] });
      }
      return { data: [], error: null };
    }
    if (this.action === 'delete') {
      const removed = rows.filter(row => this.matches(row));
      this.rows[this.table] = rows.filter(row => !this.matches(row));
      for (const row of removed) {
        recordAudit(this.table, 'DELETE', this.table === 'kv' ? row.k : row.id, row, null);
        events.push({ type: 'dml', table: this.table, operation: 'DELETE', id: row.id });
      }
      return { data: removed, error: null };
    }
    if (this.action === 'update') {
      for (const row of rows.filter(x => this.matches(x))) Object.assign(row, this.payload);
      return { data: [], error: null };
    }
    throw new Error(`Unexpected isolated action ${this.action}`);
  }
}

async function createHarness(vehicleCount, decisions = [], historyCount = 0) {
  const rows = fixtureRows(vehicleCount, historyCount);
  const memory = new Map();
  const listeners = {};
  const realtime = {};
  const prompts = [];
  const toasts = [];
  let channelSubscribed = false;
  const context = {
    window: { addEventListener(name, fn) { listeners[name] = fn; }, setTimeout, clearTimeout },
    navigator: { onLine: true },
    localStorage: { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key) },
    Intl, Date, Math, JSON, console, setTimeout, clearTimeout
  };
  context.App = {
    fmt: { money: (n, c) => `${c || 'ARS'} ${n}` },
    auth: { enabled: true, profile: { id: 'isolated-user' }, reloadProfile: () => Promise.resolve({ activo: true }), logout() {} },
    ui: {
      confirm: options => { prompts.push(options); events.push({ type: 'confirm', title: options.title }); return Promise.resolve(decisions.length ? decisions.shift() : false); },
      toast: message => toasts.push(message)
    },
    sb: { from: table => new Query(rows, table), channel: () => ({ on(event, filter, callback) { realtime[filter.table] = callback; return this; }, subscribe() { channelSubscribed = true; return this; } }), removeChannel() {} }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(sourceDir, 'store.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(sourceDir, 'sync.js'), 'utf8'), context);
  await context.App.data.loadAll();
  assert.equal(channelSubscribed, true, 'la carga con seguridad activa debe iniciar Realtime');
  events.length = 0; audit.length = 0; prompts.length = 0; toasts.length = 0;
  return { context, rows, memory, listeners, realtime, prompts, toasts };
}

async function flush(h) { await h.context.App.data.flushNow(); }
function expectNoRiskPrompt(h, scenario) { assert.equal(h.prompts.length, 0, `${scenario}: no debe pedir confirmación extraordinaria`); }
function expectRiskPrompt(h, scenario) { assert.equal(h.prompts.length, 1, `${scenario}: debe pedir confirmación de seguridad`); }

async function normalScenarios() {
  {
    const h = await createHarness(0);
    h.context.App.store.createVehicle({ marca: 'TEMP', modelo: 'Alta aislada' }); await flush(h);
    expectNoRiskPrompt(h, 'crear 1 vehículo');
    assert.equal(audit.filter(x => x.table_name === 'vehicles' && x.operation === 'INSERT').length, 1);
  }
  {
    const h = await createHarness(1);
    h.context.App.store.updateVehicle('v1', { km: 101 }); await flush(h);
    expectNoRiskPrompt(h, 'modificar 1 vehículo');
    assert.equal(audit.filter(x => x.table_name === 'vehicles' && x.operation === 'UPDATE').length, 1);
    assert.notDeepEqual(audit.at(-1).before_data, audit.at(-1).after_data);
  }
  {
    const h = await createHarness(1);
    h.context.App.store.addExpense('v1', { monto: 1000, observacion: 'gasto temporal' }); await flush(h);
    expectNoRiskPrompt(h, 'crear 1 gasto de vehículo');
  }
  {
    const h = await createHarness(1);
    h.context.App.store.addFixedExpense({ concepto: 'gasto temporal', monto: 1000, fecha: '2026-10-16' }); await flush(h);
    expectNoRiskPrompt(h, 'crear 1 gasto fijo');
    const expense = h.context.App.store.getFixedExpenses()[0];
    h.context.App.store.updateFixedExpense(expense.id, { monto: 1100 }); await flush(h);
    expectNoRiskPrompt(h, 'modificar 1 gasto fijo');
  }
  {
    const h = await createHarness(0);
    const reminder = h.context.App.store.addReminder({ titulo: 'Recordatorio temporal', fecha: '2026-10-17' }); await flush(h);
    expectNoRiskPrompt(h, 'crear 1 recordatorio');
    h.context.App.store.updateReminder(reminder.id, { titulo: 'Recordatorio actualizado' }); await flush(h);
    expectNoRiskPrompt(h, 'modificar 1 recordatorio');
  }
  {
    const h = await createHarness(0);
    h.context.App.store.updateSettings({ dolarActual: 1500 }); await flush(h);
    expectNoRiskPrompt(h, 'actualizar una fila de kv/settings');
  }
  {
    const h = await createHarness(1);
    h.context.App.store.setSale('v1', { precio: 12000, moneda: 'ARS', formaCobro: 'transferencia' }); await flush(h);
    expectNoRiskPrompt(h, 'registrar 1 venta');
  }
  {
    const h = await createHarness(1, [], 1);
    h.context.App.store.setPurchase('v1', { precio: 8000, moneda: 'ARS', formaPago: 'transferencia' });
    h.context.App.store.setSale('v1', { precio: 12000, moneda: 'ARS', formaCobro: 'transferencia' });
    await flush(h);
    expectNoRiskPrompt(h, 'dos movimientos normales de historial en un lote');
    assert.equal(h.rows.history.length, 3, 'los dos movimientos nuevos se agregan sin duplicar el existente');
    assert.equal(new Set(h.rows.history.map(row => row.id)).size, 3, 'no se duplican IDs de historial');
  }
  {
    const h = await createHarness(1);
    h.context.App.store.hardDeleteVehicle('v1'); await flush(h);
    expectNoRiskPrompt(h, 'eliminar 1 vehículo (la confirmación normal pertenece a la interfaz)');
    assert.equal(audit.filter(x => x.table_name === 'vehicles' && x.operation === 'DELETE').length, 1);
  }
}

async function consecutiveNormalOperationsScenario() {
  const h = await createHarness(0);
  const store = h.context.App.store;
  const vehicle = store.createVehicle({ marca: 'TEMP', modelo: 'Operación consecutiva' });
  store.setPurchase(vehicle.id, { precio: 8000, moneda: 'ARS' });
  store.setSale(vehicle.id, { precio: 12000, moneda: 'ARS' });
  store.addExpense(vehicle.id, { monto: 300, observacion: 'temporal' });
  store.addReminder({ titulo: 'Entrega temporal', fecha: '2026-10-17' });
  store.addFixedExpense({ concepto: 'Temporal', monto: 100, fecha: '2026-10-16' });
  store.updateSettings({ dolarActual: 1500 });
  await flush(h);
  expectNoRiskPrompt(h, 'varias operaciones comerciales normales antes de un único flush');
  assert.equal(h.rows.vehicles.length, 1);
  assert.equal(h.rows.history.length, 5, 'alta, compra, venta y gastos producen movimientos de historial propios');
  assert.equal(new Set(h.rows.history.map(row => row.id)).size, 5, 'cada movimiento conserva un ID único');
  assert.equal(h.rows.reminders.length, 1);
  assert.equal(h.rows.fixed_expenses.length, 1);
}

async function massDeleteScenario() {
  const h = await createHarness(12, [true]);
  for (let i = 1; i <= 6; i++) h.context.App.store.hardDeleteVehicle(`v${i}`);
  await flush(h);
  expectRiskPrompt(h, 'eliminar varios vehículos');
  const snapshotIndex = events.findIndex(x => x.type === 'snapshot' && x.label === 'Estado anterior a operación masiva');
  const operationIndex = events.findIndex(x => x.type === 'operation' && x.action === 'operacion_masiva');
  const firstDelete = events.findIndex(x => x.type === 'dml' && x.table === 'vehicles' && x.operation === 'DELETE');
  assert.ok(snapshotIndex >= 0 && snapshotIndex < operationIndex && operationIndex < firstDelete, 'backup y app_operations deben ocurrir antes del DELETE');
  assert.equal(audit.filter(x => x.table_name === 'vehicles' && x.operation === 'DELETE').length, 6);
}

async function massReplacementScenario() {
  const h = await createHarness(12, [true]);
  const replacement = h.context.App.store.getState();
  replacement.vehicles = Array.from({ length: 12 }, (_, i) => fixtureVehicle(`replacement-${i + 1}`));
  h.context.App.store.hydrate(replacement);
  await flush(h);
  expectRiskPrompt(h, 'reemplazo masivo');
  const snapshotIndex = events.findIndex(x => x.type === 'snapshot' && x.label === 'Estado anterior a operación masiva');
  const firstDml = events.findIndex(x => x.type === 'dml' && x.table === 'vehicles');
  assert.ok(snapshotIndex >= 0 && snapshotIndex < firstDml, 'debe respaldar antes de reemplazar');
}

async function massUpdateScenario() {
  const h = await createHarness(10, [true]);
  for (let i = 1; i <= 5; i++) h.context.App.store.updateVehicle(`v${i}`, { km: 200 + i });
  await flush(h);
  expectRiskPrompt(h, 'sobrescritura masiva de filas existentes');
  const snapshotIndex = events.findIndex(x => x.type === 'snapshot' && x.label === 'Estado anterior a operación masiva');
  const operationIndex = events.findIndex(x => x.type === 'operation' && x.action === 'operacion_masiva');
  const firstUpdate = events.findIndex(x => x.type === 'dml' && x.table === 'vehicles' && x.operation === 'UPDATE');
  assert.ok(snapshotIndex >= 0 && snapshotIndex < operationIndex && operationIndex < firstUpdate, 'la sobrescritura masiva exige backup y bitácora previos');
}

async function firstSyncScenario() {
  const h = await createHarness(0);
  for (let i = 1; i <= 4; i++) h.context.App.store.createVehicle({ marca: 'TEMP', modelo: `Inicial ${i}` });
  await flush(h);
  expectNoRiskPrompt(h, 'primera sincronización aditiva con base vacía');
  assert.equal(h.rows.vehicles.length, 4);
}

async function importScenario() {
  const h = await createHarness(2, [true], 1);
  const imported = h.context.App.store.blankState();
  imported.vehicles = [fixtureVehicle('imported-v1')];
  await h.context.App.store.importJSON(JSON.stringify(imported));
  await flush(h);
  expectRiskPrompt(h, 'importación explícita');
  const backupIndex = events.findIndex(x => x.type === 'snapshot' && x.label === 'Estado anterior a importación');
  const importLogIndex = events.findIndex(x => x.type === 'operation' && x.action === 'importacion');
  const firstDml = events.findIndex(x => x.type === 'dml' && (x.table === 'vehicles' || x.table === 'history'));
  assert.ok(backupIndex >= 0 && backupIndex < importLogIndex && importLogIndex < firstDml, 'importación respalda y registra antes de sincronizar');
  assert.equal(h.rows.vehicles.length, 1);
}

async function offlineImportReconnectionScenario() {
  const offline = await createHarness(1);
  offline.context.navigator.onLine = false;
  offline.listeners.offline();
  const imported = offline.context.App.store.blankState();
  imported.vehicles = [fixtureVehicle('offline-import-v1')];
  await offline.context.App.store.importJSON(JSON.stringify(imported));
  assert.equal(offline.rows.vehicles[0].id, 'v1', 'offline no envía la importación a Supabase');
  const saved = new Map(offline.memory);

  const online = await createHarness(1, [true]);
  online.memory.clear(); saved.forEach((v, k) => online.memory.set(k, v));
  await online.context.App.data.loadAll();
  assert.equal(online.rows.vehicles.length, 1);
  assert.equal(online.rows.vehicles[0].id, 'offline-import-v1', 'la intención pendiente se restaura tras reconectar');
  const backupIndex = events.findIndex(x => x.type === 'snapshot' && x.label === 'Estado anterior a operación masiva');
  const firstDml = events.findIndex(x => x.type === 'dml' && x.table === 'vehicles');
  assert.ok(backupIndex >= 0 && backupIndex < firstDml, 'la importación offline se respalda remotamente al aprobarla');
}

async function restoreScenario() {
  const h = await createHarness(1, [true]);
  const store = h.context.App.store;
  const snapshotTs = store.cacheSnapshot({ ts: 100, fecha: '2026-10-16', etiqueta: 'Estado A', data: JSON.stringify(store.getState()) });
  store.updateVehicle('v1', { km: 500 }); await flush(h);
  events.length = 0; h.prompts.length = 0;
  assert.equal(await store.restoreSnapshot(snapshotTs), true, 'restaurar Estado A');
  await flush(h);
  expectRiskPrompt(h, 'restauración explícita');
  assert.equal(h.rows.vehicles[0].data.km, 100, 'el estado remoto vuelve a A');
  const backupIndex = events.findIndex(x => x.type === 'snapshot' && x.label === 'Estado anterior a restauración');
  const restoreLogIndex = events.findIndex(x => x.type === 'operation' && x.action === 'restauracion');
  const firstUpdate = events.findIndex(x => x.type === 'dml' && x.table === 'vehicles' && x.operation === 'UPDATE');
  assert.ok(backupIndex >= 0 && backupIndex < restoreLogIndex && restoreLogIndex < firstUpdate, 'restauración conserva backup y bitácora anteriores');
}

async function resetScenario() {
  const h = await createHarness(1, [true]);
  await h.context.App.store.resetAll();
  await flush(h);
  expectRiskPrompt(h, 'reset explícito');
  assert.equal(h.rows.vehicles.length, 0, 'reset sincroniza el estado vacío tras aprobar');
  const backupIndex = events.findIndex(x => x.type === 'snapshot' && x.label === 'Estado anterior a reset');
  const resetLogIndex = events.findIndex(x => x.type === 'operation' && x.action === 'reinicio');
  const deleteIndex = events.findIndex(x => x.type === 'dml' && x.table === 'vehicles' && x.operation === 'DELETE');
  assert.ok(backupIndex >= 0 && backupIndex < resetLogIndex && resetLogIndex < deleteIndex, 'reset respalda y registra antes de borrar');
}

async function cancellationScenario() {
  const h = await createHarness(12, [false]);
  for (let i = 1; i <= 6; i++) h.context.App.store.hardDeleteVehicle(`v${i}`);
  await flush(h);
  expectRiskPrompt(h, 'cancelar operación masiva');
  assert.equal(audit.filter(x => x.table_name === 'vehicles' && x.operation === 'DELETE').length, 0, 'cancelar no debe enviar DELETE');
  assert.equal(h.rows.vehicles.length, 12, 'cancelar mantiene intacto el estado remoto');
  const localAfterCancel = JSON.parse(h.memory.get('paginaToto:v1'));
  assert.equal(localAfterCancel.vehicles.length, 6, 'los cambios locales pendientes quedan guardados');
  const remoteNew = fixtureVehicle('v13');
  h.rows.vehicles.push({ id: remoteNew.id, data: remoteNew });
  h.realtime.vehicles({ eventType: 'INSERT', new: { id: remoteNew.id, data: remoteNew } });
  const remoteUpdate = JSON.parse(JSON.stringify(h.rows.vehicles.find(row => row.id === 'v7')));
  remoteUpdate.data.km = 777;
  h.rows.vehicles.find(row => row.id === 'v7').data.km = 777;
  h.realtime.vehicles({ eventType: 'UPDATE', new: remoteUpdate, old: { id: 'v7' } });
  assert.equal(h.context.App.store.getState().vehicles.length, 7, 'Realtime conserva los borrados locales pendientes');
  assert.equal(h.context.App.store.getVehicle('v7').km, 777, 'Realtime aplica una edición remota en la fila local intacta');
  await flush(h); // cancelar el reintento deja una base remota actualizada y explícita
  const pendingAfterRealtime = JSON.parse(h.memory.get('paginaToto:pendingMassSync'));
  assert.equal(pendingAfterRealtime.base.vehicles.length, 13, 'la base del lote incorpora el estado remoto más reciente');
  // Simula recarga: el estado pendiente debe volver a aparecer y requerir confirmación.
  const persistedMemory = new Map(h.memory);
  const h2 = await createHarness(13, [false]);
  h2.rows.vehicles.find(row => row.id === 'v7').data.km = 777;
  h2.memory.clear(); persistedMemory.forEach((v, k) => h2.memory.set(k, v));
  await h2.context.App.data.loadAll();
  assert.equal(h2.context.App.store.getState().vehicles.length, 7, 'recargar conserva cambios locales y agrega el nuevo registro remoto');
  assert.ok(h2.context.App.store.getState().vehicles.some(v => v.id === 'v13'), 'el registro remoto posterior al backup no se pierde');
  assert.equal(h2.context.App.store.getVehicle('v7').km, 777, 'la edición remota posterior prevalece cuando el usuario local no cambió ese campo');
  assert.equal(h2.rows.vehicles.length, 13, 'recargar no debe enviar el lote cancelado');
  assert.equal(audit.filter(x => x.table_name === 'vehicles' && x.operation === 'DELETE').length, 0, 'el lote sigue sin enviarse tras volver a cancelar');

  // Solo la confirmación explícita posterior permite enviar el lote retenido.
  const h3 = await createHarness(13, [true]);
  h3.rows.vehicles.find(row => row.id === 'v7').data.km = 777;
  h2.memory.forEach((value, key) => h3.memory.set(key, value));
  await h3.context.App.data.loadAll();
  assert.equal(h3.rows.vehicles.length, 7, 'confirmar el reintento envía los cambios locales y conserva lo remoto posterior');
  assert.ok(h3.rows.vehicles.some(v => v.id === 'v13'), 'reintentar no sobrescribe el registro remoto más reciente');
  assert.equal(h3.rows.vehicles.find(row => row.id === 'v7').data.km, 777, 'reintentar no revierte una edición remota posterior');
  const retrySnapshot = events.findIndex(x => x.type === 'snapshot' && x.label === 'Estado anterior a operación masiva');
  const retryOperation = events.findIndex(x => x.type === 'operation' && x.action === 'operacion_masiva');
  const retryDelete = events.findIndex(x => x.type === 'dml' && x.table === 'vehicles' && x.operation === 'DELETE');
  assert.ok(retrySnapshot >= 0 && retrySnapshot < retryOperation && retryOperation < retryDelete, 'el reintento confirmado debe guardar snapshot y operación antes de borrar');
  assert.equal(h3.memory.get('paginaToto:pendingMassSync'), undefined, 'el marcador pendiente se limpia tras sincronizar correctamente');
}

async function offlineReconnectScenario() {
  const h = await createHarness(1);
  h.context.navigator.onLine = false; h.listeners.offline();
  h.context.App.store.updateVehicle('v1', { km: 102 });
  assert.equal(audit.length, 0, 'offline no escribe en la nube');
  h.context.navigator.onLine = true;
  await h.listeners.online();
  expectNoRiskPrompt(h, 'reconectar después de editar offline un vehículo');
  assert.equal(audit.filter(x => x.table_name === 'vehicles' && x.operation === 'UPDATE').length, 1);
}

async function main() {
  await normalScenarios();
  await consecutiveNormalOperationsScenario();
  await firstSyncScenario();
  await massDeleteScenario();
  await massReplacementScenario();
  await massUpdateScenario();
  await importScenario();
  await offlineImportReconnectionScenario();
  await restoreScenario();
  await resetScenario();
  await cancellationScenario();
  await offlineReconnectScenario();
  console.log('PASS barrera aislada: CRUD normal, respaldo/confirmación masiva, cancelación persistente, auditoría simulada y reconexión offline.');
}

main().catch(error => { console.error('FAIL barrera aislada:', error); process.exitCode = 1; });
