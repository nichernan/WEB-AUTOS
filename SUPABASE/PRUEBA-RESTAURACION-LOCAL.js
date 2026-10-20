// Reproduce restore A -> B -> A en una VM con localStorage y Supabase simulados.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const memory = new Map();
const localStorage = {
  getItem: key => memory.has(key) ? memory.get(key) : null,
  setItem: (key, value) => memory.set(key, String(value))
};
const context = {
  window: {}, localStorage, console, Date, Math, JSON, setTimeout, clearTimeout,
  Intl
};
context.App = { fmt: { money: () => '' }, ui: { toast: () => {} },
  auth: { enabled: true, profile: { id: 'isolated-test-actor' } } };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'PaginaToto-CODIGO-FUENTE', 'js', 'store.js'), 'utf8'), context);

async function main() {
  const store = context.App.store;
  store.load();
  const vehicle = store.createVehicle({ marca: 'TEMPORAL', modelo: 'Estado A', patente: 'TEST-A' });
  const remoteSnapshots = [];
  const operations = [];
  const sequence = [];
  context.App.data = {
    safetyAvailable: () => true,
    isOffline: () => false,
    saveSnapshot: snapshot => {
      sequence.push({ type: 'snapshot', label: snapshot.etiqueta });
      remoteSnapshots.push(JSON.parse(JSON.stringify({ label: snapshot.etiqueta, state: JSON.parse(snapshot.data) })));
      return Promise.resolve(true);
    },
    logOperation: action => { sequence.push({ type: 'operation', action }); operations.push(action); return Promise.resolve(true); },
    markBulkOperation: () => true,
    onLocalChange: () => {}
  };

  const snapshotA = await store.createSnapshot('Estado A', true);
  store.updateVehicle(vehicle.id, { modelo: 'Estado B' });
  await store.createSnapshot('Estado B', true);
  assert.equal(store.getVehicle(vehicle.id).modelo, 'Estado B');

  const restored = await store.restoreSnapshot(snapshotA);
  assert.equal(restored, true, 'la restauración debe completarse');
  assert.equal(store.getVehicle(vehicle.id).modelo, 'Estado A', 'el estado debe volver a A');
  const backupB = remoteSnapshots.find(x => x.label === 'Estado anterior a restauración');
  assert.ok(backupB, 'debe existir backup previo con etiqueta explícita');
  assert.equal(backupB.state.vehicles.find(x => x.id === vehicle.id).modelo, 'Estado B', 'el backup previo debe contener B');
  assert.ok(operations.includes('restauracion'), 'la restauración debe quedar registrada');

  sequence.length = 0;
  const imported = { ...store.getState(), vehicles: [{ id: 'imported-fixture', marca: 'TEMPORAL', modelo: 'Importado' }] };
  await store.importJSON(JSON.stringify(imported));
  assert.equal(store.getState().vehicles[0].id, 'imported-fixture');
  assert.equal(sequence[0].label, 'Estado anterior a importación', 'la importación toma backup antes del reemplazo');
  assert.ok(sequence.findIndex(x => x.action === 'importacion') > 0, 'la importación se registra después del backup previo');
  sequence.length = 0;
  await store.resetAll();
  assert.equal(store.getState().vehicles.length, 0, 'reset aislado deja el estado vacío');
  assert.equal(sequence[0].label, 'Estado anterior a reset', 'el reset toma backup antes del reemplazo');
  assert.ok(sequence.findIndex(x => x.action === 'reinicio') > 0, 'el reset se registra después del backup previo');
  console.log('PASS restauración/import/reset aislados: backup previo -> registro -> operación; A -> B -> A verificado.');
}

main().catch(error => { console.error('FAIL restauración aislada:', error); process.exitCode = 1; });
