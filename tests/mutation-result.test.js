'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../PaginaToto-CODIGO-FUENTE/js/store.js'), 'utf8');
function createStore({ blocked = false, onLocalChange } = {}) {
  const values = new Map();
  const toasts = [];
  const listeners = [];
  const App = {
    auth: { enabled: true, profile: { id: 'isolated-user' } },
    data: {
      backupWritesBlocked: () => blocked,
      safetyAvailable: () => true,
      deliveryReady: () => true,
      isOffline: () => false,
      onLocalChange: onLocalChange || (() => Promise.resolve({ status: 'synced' }))
    },
    ui: { toast: (message, type) => toasts.push({ message, type }) },
    fmt: { money: (n) => String(n), date: String }
  };
  const window = { App };
  const localStorage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
  vm.runInNewContext(source, { window, App, localStorage, console, Promise, Date, Math, Intl, JSON, Object, Array, String, Number, RegExp, isNaN, parseFloat });
  const store = window.App.store;
  store.hydrate(store.blankState());
  return { store, toasts, listeners };
}
function vehicle() { return { marca: 'Fixture', modelo: 'Auto aislado', anio: '2024' }; }

test('registro bloqueado por backup revierte el estado y no produce id para navegar', async () => {
  const { store, toasts } = createStore({ blocked: true });
  const result = store.createVehicle(vehicle());
  assert.equal(result, null);
  assert.equal(store.getState().vehicles.length, 0);
  assert.equal((await store.afterMutation()).status, 'rejected');
  let navigated = false;
  assert.equal(await store.finishMutation('Vehículo registrado', () => { navigated = true; }), false);
  assert.equal(navigated, false);
  assert.ok(toasts.some((toast) => toast.type === 'error'));
});

test('el éxito espera confirmación remota antes de notificar o continuar', async () => {
  let confirmRemote;
  const { store, toasts } = createStore({ onLocalChange: () => new Promise((resolve) => { confirmRemote = resolve; }) });
  const created = store.createVehicle(vehicle());
  assert.ok(created && created.id);
  let navigated = false;
  const completion = store.finishMutation('Vehículo registrado', () => { navigated = true; });
  await Promise.resolve();
  assert.equal(navigated, false);
  assert.equal(toasts.length, 0);
  confirmRemote({ status: 'synced' });
  assert.equal(await completion, 'synced');
  assert.equal(navigated, true);
  assert.equal(toasts.at(-1).type, 'success');
});

test('modo offline informa pendiente local sin afirmar guardado remoto', async () => {
  const { store, toasts } = createStore({ onLocalChange: () => Promise.resolve({ status: 'pending', reason: 'offline' }) });
  assert.ok(store.createVehicle(vehicle()));
  let continued = false;
  assert.equal(await store.finishMutation('Vehículo registrado', () => { continued = true; }), 'pending');
  assert.equal(continued, true);
  assert.match(toasts.at(-1).message, /pendiente de sincronización/);
  assert.equal(toasts.at(-1).type, 'info');
});

test('un rechazo remoto permite reconciliar al estado confirmado y no reintenta por el store', async () => {
  const { store } = createStore({ onLocalChange: () => Promise.resolve({ status: 'rejected', reason: 'backup' }) });
  const created = store.createVehicle(vehicle());
  assert.ok(created);
  store.discardRejectedChanges(store.blankState());
  assert.equal(await store.finishMutation('Vehículo registrado'), false);
  assert.equal(store.getState().vehicles.length, 0);
});

test('falla de conexión conserva el cambio local y la reconexión lo confirma sin duplicar IDs', async () => {
  let online = false;
  const cloud = new Map();
  const { store } = createStore({ onLocalChange: (state) => {
    if (!online) return Promise.resolve({ status: 'pending', reason: 'offline' });
    state.vehicles.forEach((row) => cloud.set(row.id, structuredClone(row)));
    return Promise.resolve({ status: 'synced' });
  } });
  const created = store.createVehicle(vehicle());
  assert.equal(await store.finishMutation('Vehículo registrado'), 'pending');
  online = true;
  assert.equal(store.updateVehicle(created.id, { modelo: 'Reconciliado tras reconexión' }).id, created.id);
  assert.equal(await store.finishMutation('Vehículo actualizado'), 'synced');
  assert.equal(store.getState().vehicles.length, 1);
  assert.equal(cloud.size, 1);
  assert.equal([...cloud.keys()][0], created.id);
});

test('dos sesiones aisladas pueden escribir registros distintos sin duplicar filas', async () => {
  const cloud = new Map();
  const sync = (state) => {
    state.vehicles.forEach((row) => cloud.set(row.id, structuredClone(row)));
    return Promise.resolve({ status: 'synced' });
  };
  const tabA = createStore({ onLocalChange: sync }).store;
  const tabB = createStore({ onLocalChange: sync }).store;
  const a = tabA.createVehicle(vehicle());
  const b = tabB.createVehicle({ marca: 'Fixture', modelo: 'Segundo tab', anio: '2023' });
  await Promise.all([tabA.finishMutation('Alta A'), tabB.finishMutation('Alta B')]);
  assert.notEqual(a.id, b.id);
  assert.equal(cloud.size, 2);
  assert.equal(new Set([...cloud.keys()]).size, 2);
});

test('el reintento posterior a un rechazo solo muestra éxito tras confirmación', async () => {
  let attempt = 0;
  const { store, toasts } = createStore({ onLocalChange: () => Promise.resolve(
    ++attempt === 1 ? { status: 'rejected', reason: 'backup' } : { status: 'synced' }
  ) });
  store.createVehicle(vehicle());
  assert.equal(await store.finishMutation('Vehículo registrado'), false);
  assert.equal(toasts.at(-1).type, 'error');
  store.discardRejectedChanges(store.blankState());
  assert.ok(store.createVehicle(vehicle()));
  assert.equal(await store.finishMutation('Vehículo registrado'), 'synced');
  assert.equal(toasts.at(-1).type, 'success');
});
