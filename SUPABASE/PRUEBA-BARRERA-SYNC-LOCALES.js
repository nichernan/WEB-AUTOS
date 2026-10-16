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

function fixtureRows(vehicleCount) {
  return {
    vehicles: Array.from({ length: vehicleCount }, (_, i) => { const v = fixtureVehicle(`v${i + 1}`); return { id: v.id, data: v }; }),
    history: [], reminders: [], fixed_expenses: [], kv: [], audit_log: [], app_snapshots: [], app_trash: [], app_operations: [],
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

async function createHarness(vehicleCount, decisions = []) {
  const rows = fixtureRows(vehicleCount);
  const memory = new Map();
  const listeners = {};
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
    sb: { from: table => new Query(rows, table), channel: () => ({ on() { return this; }, subscribe() { channelSubscribed = true; return this; } }), removeChannel() {} }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(sourceDir, 'store.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(sourceDir, 'sync.js'), 'utf8'), context);
  await context.App.data.loadAll();
  assert.equal(channelSubscribed, true, 'la carga con seguridad activa debe iniciar Realtime');
  events.length = 0; audit.length = 0; prompts.length = 0; toasts.length = 0;
  return { context, rows, memory, listeners, prompts, toasts };
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
  }
  {
    const h = await createHarness(1);
    h.context.App.store.setSale('v1', { precio: 12000, moneda: 'ARS', formaCobro: 'transferencia' }); await flush(h);
    expectNoRiskPrompt(h, 'registrar 1 venta');
  }
  {
    const h = await createHarness(1);
    h.context.App.store.hardDeleteVehicle('v1'); await flush(h);
    expectNoRiskPrompt(h, 'eliminar 1 vehículo (la confirmación normal pertenece a la interfaz)');
    assert.equal(audit.filter(x => x.table_name === 'vehicles' && x.operation === 'DELETE').length, 1);
  }
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

async function cancellationScenario() {
  const h = await createHarness(12, [false]);
  for (let i = 1; i <= 6; i++) h.context.App.store.hardDeleteVehicle(`v${i}`);
  await flush(h);
  expectRiskPrompt(h, 'cancelar operación masiva');
  assert.equal(audit.filter(x => x.table_name === 'vehicles' && x.operation === 'DELETE').length, 0, 'cancelar no debe enviar DELETE');
  assert.equal(h.rows.vehicles.length, 12, 'cancelar mantiene intacto el estado remoto');
  const localAfterCancel = JSON.parse(h.memory.get('paginaToto:v1'));
  assert.equal(localAfterCancel.vehicles.length, 6, 'los cambios locales pendientes quedan guardados');
  // Simula recarga: el estado pendiente debe volver a aparecer y requerir confirmación.
  const persistedMemory = new Map(h.memory);
  const h2 = await createHarness(12, [false]);
  h2.memory.clear(); persistedMemory.forEach((v, k) => h2.memory.set(k, v));
  await h2.context.App.data.loadAll();
  assert.equal(h2.context.App.store.getState().vehicles.length, 6, 'recargar no debe descartar los cambios pendientes cancelados');
  assert.equal(h2.rows.vehicles.length, 12, 'recargar no debe enviar el lote cancelado');
  assert.equal(audit.filter(x => x.table_name === 'vehicles' && x.operation === 'DELETE').length, 0, 'el lote sigue sin enviarse tras volver a cancelar');

  // Solo la confirmación explícita posterior permite enviar el lote retenido.
  const h3 = await createHarness(12, [true]);
  h2.memory.forEach((value, key) => h3.memory.set(key, value));
  await h3.context.App.data.loadAll();
  assert.equal(h3.rows.vehicles.length, 6, 'confirmar el reintento envía el lote pendiente');
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
  await massDeleteScenario();
  await massReplacementScenario();
  await cancellationScenario();
  await offlineReconnectScenario();
  console.log('PASS barrera aislada: CRUD normal, respaldo/confirmación masiva, cancelación persistente, auditoría simulada y reconexión offline.');
}

main().catch(error => { console.error('FAIL barrera aislada:', error); process.exitCode = 1; });
