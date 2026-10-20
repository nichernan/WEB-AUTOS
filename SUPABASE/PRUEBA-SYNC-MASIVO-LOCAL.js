// Verifica backup + app_operations antes de los DELETE enviados por sync.js.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rows = {
  vehicles: Array.from({ length: 12 }, (_, i) => ({ id: 'fixture-v-' + i, data: { id: 'fixture-v-' + i, marca: 'TEMP', modelo: 'Vehículo ' + i, _delivery_generation: 'isolated-generation' } })),
  history: [], reminders: [], fixed_expenses: [], kv: [], audit_log: [], app_snapshots: [], app_trash: [], app_operations: [],
  app_delivery_state: [{ singleton: true, generation: 'isolated-generation' }]
};
const events = [];
function businessDay(date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
class Query {
  constructor(table) { this.table = table; this.action = 'select'; this.filters = []; this.columns = '*'; this.payload = null; this.inFilter = null; this.limitValue = null; this.rangeValue = null; this.singleRow = false; }
  select(columns) { this.columns = columns; return this; }
  insert(payload) { this.action = 'insert'; this.payload = payload; return this; }
  upsert(payload) { this.action = 'upsert'; this.payload = payload; return this; }
  update(payload) { this.action = 'update'; this.payload = payload; return this; }
  delete() { this.action = 'delete'; return this; }
  eq(key, value) { this.filters.push([key, value]); return this; }
  in(key, values) { this.inFilter = [key, values]; return this; }
  limit(n) { this.limitValue = n; return this; }
  range(a, b) { this.rangeValue = [a, b]; return this; }
  order() { return this; }
  single() { this.singleRow = true; return this; }
  maybeSingle() { this.singleRow = true; return this; }
  then(resolve, reject) { return this.run().then(resolve, reject); }
  async run() {
    const table = rows[this.table];
    if (this.action === 'select') {
      let result = table.slice();
      for (const [key, value] of this.filters) result = result.filter(x => x[key] === value);
      if (this.limitValue === 0) result = [];
      if (this.rangeValue) result = result.slice(this.rangeValue[0], this.rangeValue[1] + 1);
      return { data: this.singleRow ? result[0] || null : result, error: null };
    }
    if (this.action === 'insert') {
      for (const value of (Array.isArray(this.payload) ? this.payload : [this.payload])) {
        const item = { ...value };
        if (this.table === 'app_snapshots') {
          item.snapshot_day = businessDay(new Date(item.created_at));
          if (item.source === 'daily' && table.some(x => x.source === 'daily' && x.snapshot_day === item.snapshot_day)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        table.push(item);
        if (this.table === 'app_snapshots') events.push({ kind: 'snapshot', label: item.label, vehicles: item.state.vehicles.length, source: item.source });
        else if (this.table === 'app_operations') events.push({ kind: 'operation', action: item.action });
      }
      return { data: [], error: null };
    }
    if (this.action === 'delete') {
      const [key, values] = this.inFilter;
      const removed = table.filter(x => values.includes(x[key]));
      rows[this.table] = table.filter(x => !values.includes(x[key]));
      events.push({ kind: 'delete', table: this.table, count: removed.length });
      return { data: removed, error: null };
    }
    if (this.action === 'upsert') return { data: [], error: null };
    return { data: [], error: null };
  }
}

async function main() {
  const memory = new Map();
  memory.set('paginaToto:v1', JSON.stringify({ vehicles: [{ id: 'legacy-car', marca: 'LEGACY' }], history: [{ id: 'legacy-history' }], reminders: [], fixedExpenses: [], trash: [], settings: {}, meta: {} }));
  memory.set('paginaToto:syncBase', '{"vehicles":[{"id":"legacy-car"}]}');
  memory.set('paginaToto:snapshots', '[{"ts":1,"data":"legacy"}]');
  memory.set('paginaToto:businessGeneration', 'legacy-generation');
  memory.set('paginaToto:auth', 'preserve-auth-session');
  const context = {
    window: { addEventListener() {}, setTimeout, clearTimeout },
    document: { addEventListener() {}, body: null, hidden: false },
    navigator: { onLine: true }, localStorage: { getItem: k => memory.get(k) || null, setItem: (k,v) => memory.set(k,String(v)), removeItem: k => memory.delete(k) },
    Intl, Date, Math, JSON, console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}
  };
  context.App = {
    auth: { enabled: true, profile: { id: 'test-user' } },
    ui: { confirm: () => { events.push({ kind: 'confirm' }); return Promise.resolve(true); }, toast() {} }
  };
  context.App.data = { deliveryReady: () => true, safetyAvailable: () => true };
  const backupStatus = { generation: 'isolated-generation', revision: 0, verified_revision: 0, dirty_since: null, latest_snapshot_id: null, latest_snapshot_at: null, needs_backup: false, blocked: false };
  context.App.sb = {
    from: table => new Query(table),
    rpc: (name, args) => {
      if (name === 'app_backup_status') return Promise.resolve({ data: { ...backupStatus }, error: null });
      if (name === 'app_create_verified_snapshot') {
        const state = {
          vehicles: rows.vehicles.map(x => x.data), history: rows.history.map(x => x.data),
          reminders: rows.reminders.map(x => x.data), fixedExpenses: rows.fixed_expenses.map(x => x.data),
          settings: {}, meta: {}, trash: []
        };
        const id = 'snapshot-fixture-' + rows.app_snapshots.length;
        rows.app_snapshots.push({ id, label: args.p_label, state, source: args.p_source, created_at: new Date().toISOString(), generation: 'isolated-generation' });
        events.push({ kind: 'snapshot', label: args.p_label, vehicles: state.vehicles.length, source: args.p_source });
        return Promise.resolve({ data: { status: 'saved', revision: args.p_expected_revision, snapshot_id: id }, error: null });
      }
      return Promise.resolve({ data: null, error: { message: 'RPC desconocido: ' + name } });
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {}
  };
  vm.createContext(context);
  const source = path.join(__dirname, '..', 'PaginaToto-CODIGO-FUENTE', 'js');
  vm.runInContext(fs.readFileSync(path.join(source, 'store.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(source, 'sync.js'), 'utf8'), context);
  await context.App.data.loadAll();
  assert.equal(memory.get('paginaToto:v1'), undefined, 'los datos comerciales de localStorage anterior deben invalidarse');
  const newBase = JSON.parse(memory.get('paginaToto:syncBase'));
  assert.equal(newBase.vehicles.length, 12, 'syncBase debe reemplazarse por el remoto de la etapa actual');
  assert.equal(newBase.vehicles.some(x => x.id === 'legacy-car'), false, 'syncBase no debe conservar registros anteriores');
  assert.equal(memory.get('paginaToto:snapshots'), undefined, 'snapshots locales anteriores deben invalidarse');
  assert.equal(memory.get('paginaToto:auth'), 'preserve-auth-session', 'la sesión Supabase debe conservarse');
  assert.equal(memory.get('paginaToto:businessGeneration'), 'isolated-generation', 'debe persistirse la nueva generación');
  assert.equal(context.App.store.getState().vehicles.length, 12, 'debe hidratarse desde el remoto de la generación actual');
  await context.App.data.flushNow();
  events.length = 0;
  const vehicleIds = context.App.store.getState().vehicles.map(x => x.id);
  vehicleIds.forEach(id => context.App.store.hardDeleteVehicle(id));
  await context.App.data.flushNow();
  const backupIndex = events.findIndex(x => x.kind === 'snapshot' && x.label === 'Estado anterior a operación masiva');
  const operationIndex = events.findIndex(x => x.kind === 'operation' && x.action === 'operacion_masiva');
  const deleteIndex = events.findIndex(x => x.kind === 'delete' && x.table === 'vehicles');
  assert.ok(backupIndex >= 0, 'debe guardar el snapshot preoperación');
  assert.ok(operationIndex > backupIndex, 'app_operations debe ir después del snapshot');
  assert.ok(deleteIndex > operationIndex, 'DELETE debe ir después del snapshot y registro');
  assert.equal(events[backupIndex].vehicles, 12, 'el backup debe contener los 12 vehículos previos');
  assert.equal(events[deleteIndex].count, 12, 'el sync debe enviar los 12 DELETE');
  console.log('PASS sync masivo aislado: snapshot(12) -> app_operations -> DELETE(12).');
}

main().catch(error => { console.error('FAIL sync masivo aislado:', error); process.exitCode = 1; });
