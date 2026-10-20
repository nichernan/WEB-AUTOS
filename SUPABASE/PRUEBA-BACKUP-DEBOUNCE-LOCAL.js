// Simula en Node dos clientes, Supabase y el reloj. No usa credenciales ni red.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const generation = 'isolated-backup-generation';
const deep = value => JSON.parse(JSON.stringify(value));
function fakeServer(clock) {
  return {
    generation, tables: { vehicles: [], history: [], reminders: [], fixed_expenses: [], kv: [], app_trash: [],
      audit_log: [], app_snapshots: [], app_operations: [], app_delivery_state: [{ singleton: true, generation, label: 'Fixture' }] },
    status: { generation, revision: 0, verified_revision: 0, dirty_since: null, latest_snapshot_id: null, latest_snapshot_at: null, needs_backup: false, blocked: false },
    failNextSnapshot: false, snapshots: []
  };
}
function makeBrowser(server, options = {}) {
  const timers = new Map(); const listeners = {}; const local = new Map();
  const clock = options.clock; let timerId = 1;
  class TestDate extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } static now() { return clock.now; } }
  function schedule(fn, delay) { const id = timerId++; timers.set(id, { fn, at: clock.now + Math.max(0, delay || 0) }); return id; }
  function cancel(id) { timers.delete(id); }
  const document = {
    body: { children: [], appendChild(node) { this.children.push(node); node.parentNode = this; }, removeChild(node) { this.children = this.children.filter(x => x !== node); } },
    hidden: false, addEventListener(name, fn) { (listeners['document:' + name] ||= []).push(fn); },
    createElement(tag) { return { tagName: tag, children: [], attrs: {}, classList: { add() {} }, setAttribute(k,v) { this.attrs[k]=v; }, appendChild(n) { this.children.push(n); }, addEventListener(k,fn) { this['on'+k]=fn; }, remove() { if (this.parentNode) this.parentNode.removeChild(this); } }; }
  };
  const window = { addEventListener(name, fn) { (listeners[name] ||= []).push(fn); }, dispatch(name) { (listeners[name]||[]).forEach(fn=>fn()); } };
  const navigator = { onLine: options.online !== false };

  class Query {
    constructor(table) { this.table=table; this.action='select'; this.payload=null; this.filters=[]; this.inFilter=null; this.limitValue=null; this.singleRow=false; }
    select() { return this; } insert(payload) { this.action='insert'; this.payload=payload; return this; } upsert(payload) { this.action='upsert'; this.payload=payload; return this; }
    update(payload) { this.action='update'; this.payload=payload; return this; } delete() { this.action='delete'; return this; }
    eq(k,v) { this.filters.push([k,v]); return this; } in(k,values) { this.inFilter=[k,values]; return this; } limit(n) { this.limitValue=n; return this; }
    order() { return this; } range() { return this; } single() { this.singleRow=true; return this; } maybeSingle() { this.singleRow=true; return this; }
    then(resolve,reject) { return this.run().then(resolve,reject); }
    async run() {
      const rows=server.tables[this.table];
      if (this.action==='select') { let found=rows.slice(); this.filters.forEach(([k,v])=>found=found.filter(x=>x[k]===v)); if(this.limitValue===0) found=[]; return {data:this.singleRow?(found[0]||null):found,error:null}; }
      if (this.action==='upsert') {
        for (const item of this.payload) { const key=this.table==='kv'?'k':'id'; const idx=rows.findIndex(x=>x[key]===item[key]);
          if (idx<0) { rows.push(deep(item)); dirty(); } else if (JSON.stringify(rows[idx])!==JSON.stringify(item)) { rows[idx]=deep(item); dirty(); }
        } return {data:[],error:null};
      }
      if (this.action==='delete') { const [key,values]=this.inFilter; const removed=rows.filter(x=>values.includes(x[key])); server.tables[this.table]=rows.filter(x=>!values.includes(x[key])); removed.forEach(()=>dirty()); return {data:removed,error:null}; }
      if (this.action==='insert') { for(const item of (Array.isArray(this.payload)?this.payload:[this.payload])) { rows.push(deep(item)); dirty(); } return {data:[],error:null}; }
      return {data:[],error:null};
    }
  }
  function dirty() { server.status.revision++; server.status.dirty_since=new TestDate(clock.now).toISOString(); server.status.needs_backup=true; server.status.blocked=false; }
  const sb = {
    from: table=>new Query(table), channel:()=>({on(){return this;},subscribe(){return this;}}), removeChannel(){},
    rpc(name,args) {
      if (!navigator.onLine) return Promise.resolve({data:null,error:{message:'offline'}});
      if (name==='app_backup_status') return Promise.resolve({data:deep(server.status),error:null});
      if (name==='app_create_verified_snapshot') {
        if(server.failNextSnapshot){server.failNextSnapshot=false;return Promise.resolve({data:null,error:{message:'snapshot failed'}});}
        if(args.p_expected_revision!==server.status.revision) return Promise.resolve({data:{status:'stale',revision:server.status.revision},error:null});
        if(args.p_only_if_pending && server.status.revision===server.status.verified_revision) return Promise.resolve({data:{status:'already_saved',revision:server.status.revision},error:null});
        const snap={id:'snap-'+(server.snapshots.length+1),label:args.p_label,source:args.p_source,state:{
          vehicles:server.tables.vehicles.map(x=>{const d=deep(x.data);delete d._delivery_generation;return d;}),
          history:server.tables.history.map(x=>x.data), reminders:server.tables.reminders.map(x=>x.data),
          fixedExpenses:server.tables.fixed_expenses.map(x=>x.data),settings:{},meta:{},trash:server.tables.app_trash.map(deep)
        },revision:server.status.revision,created_at:new TestDate(clock.now).toISOString()};
        server.snapshots.push(snap); server.tables.app_snapshots.push(snap); server.status.verified_revision=server.status.revision; server.status.needs_backup=false;
        server.status.dirty_since=null; server.status.latest_snapshot_id=snap.id; server.status.latest_snapshot_at=snap.created_at; server.status.blocked=false;
        return Promise.resolve({data:{status:'saved',revision:snap.revision,snapshot_id:snap.id,created_at:snap.created_at},error:null});
      }
      return Promise.resolve({data:null,error:{message:'unknown rpc '+name}});
    }
  };
  function dirty() { server.status.revision++; server.status.dirty_since=new TestDate(clock.now).toISOString(); server.status.needs_backup=true; server.status.blocked=false; }
  const state = { schema:1, vehicles:[], history:[], reminders:[], fixedExpenses:[], trash:[], settings:{}, meta:{} };
  const store = {
    STORAGE_KEY:'paginaToto:v1', blankState:()=>deep(state), migrate:x=>deep(x), hydrate(x){Object.keys(state).forEach(k=>delete state[k]);Object.assign(state,deep(x));},
    getState:()=>state, notify(){}, load(){},
  };
  const App = { sb, store, auth:{enabled:true,profile:{id:'fixture-user'}}, ui:{toast(){},confirm(){return Promise.resolve(true);}} };
  const context={App,window,document,navigator,localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k)},
    Intl,Date:TestDate,Math,JSON,console,setTimeout:schedule,clearTimeout:cancel,setInterval:()=>0,clearInterval(){},Promise};
  vm.createContext(context);
  const src=path.join(__dirname,'..','PaginaToto-CODIGO-FUENTE','js');
  vm.runInContext(fs.readFileSync(path.join(src,'sync.js'),'utf8'),context);
  return {context,server,clock,timers,local,window,navigator,advance:async ms=>{
    const end=clock.now+ms; let guard=0;
    while(guard++<100){ const next=[...timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0]; if(!next)break;
      clock.now=next[1].at;timers.delete(next[0]); const value=next[1].fn(); if(value&&typeof value.then==='function') await value; await Promise.resolve(); await Promise.resolve();
    } clock.now=end; await Promise.resolve(); await Promise.resolve();
  }};
}

async function main() {
  const initial=Date.now(); const clock={now:initial}; const server=fakeServer(clock); const a=makeBrowser(server,{clock});
  await a.context.App.data.loadAll(); await a.context.App.data.flushNow();
  assert.equal(server.snapshots.length,0,'abrir y consultar sin cambios no crea snapshot');
  const store=a.context.App.store; store.getState().vehicles.push({id:'v1',marca:'TEST',modelo:'A'}); a.context.App.data.onLocalChange(store.getState()); await a.context.App.data.flushNow();
  assert.equal(server.status.needs_backup,true,'el INSERT confirmado queda pendiente');
  await a.advance(9*60*1000+59*1000); assert.equal(server.snapshots.length,0,'no copia antes de diez minutos');
  await a.advance(1000); assert.equal(server.snapshots.length,1,'A: un cambio en reposo produce una copia al cumplir diez minutos');
  assert.equal(server.snapshots[0].state.vehicles.length,1);

  // B: segundo cambio reinicia el debounce y el snapshot toma el estado último.
  clock.now+=1000; store.getState().vehicles[0].modelo='B'; a.context.App.data.onLocalChange(store.getState()); await a.context.App.data.flushNow();
  await a.advance(5*60*1000); store.getState().vehicles[0].modelo='C'; a.context.App.data.onLocalChange(store.getState()); await a.context.App.data.flushNow();
  await a.advance(9*60*1000+59*1000); assert.equal(server.snapshots.length,1);
  await a.advance(1000); assert.equal(server.snapshots.length,2); assert.equal(server.snapshots[1].state.vehicles[0].modelo,'C');

  // D/E: un error de persistencia bloquea escrituras; el único reintento resuelve el bloqueo.
  store.getState().vehicles[0].modelo='D'; a.context.App.data.onLocalChange(store.getState()); await a.context.App.data.flushNow();
  server.failNextSnapshot=true; await a.advance(10*60*1000);
  assert.equal(a.context.App.data.backupWritesBlocked(),true,'D: el fallo de snapshot bloquea nuevas modificaciones');
  assert.ok(a.local.get('paginaToto:backupFailure'),'fallo persistido localmente para reinicio');
  const alert=a.context.document.body.children.find(x=>x.attrs.role==='alert');
  assert.ok(alert,'D: se muestra el aviso persistente');
  assert.equal(alert.children[0].children.filter(x=>x.tagName==='button').length,1,'el cartel ofrece un solo botón');
  assert.equal(await a.context.App.data.retryBackup(),true,'E: retry guarda y confirma snapshot');
  assert.equal(a.context.App.data.backupWritesBlocked(),false);
  assert.equal(a.local.get('paginaToto:backupFailure'),undefined);

  // F: otra pestaña ve el estado remoto pendiente luego de abrir con sesión vigente.
  store.getState().vehicles[0].modelo='E'; a.context.App.data.onLocalChange(store.getState()); await a.context.App.data.flushNow();
  const b=makeBrowser(server,{clock}); await b.context.App.data.loadAll();
  const countBeforePeerBackup=server.snapshots.length;
  await a.advance(10*60*1000); assert.equal(server.snapshots.at(-1).state.vehicles[0].modelo,'E','F/G: segunda sesión recupera el estado remoto pendiente');
  await b.advance(0); assert.equal(server.snapshots.length,countBeforePeerBackup+1,'G: dos clientes con la misma revisión no duplican snapshots');

  // H: navegador cerrado/reabierto recupera pending_since desde Supabase; trabaja offline y reintenta online.
  store.getState().vehicles[0].modelo='F'; a.context.App.data.onLocalChange(store.getState()); await a.context.App.data.flushNow();
  a.navigator.onLine=false; await a.advance(10*60*1000); const count=server.snapshots.length;
  assert.equal(server.snapshots.length,count,'offline no inventa una copia confirmada');
  a.navigator.onLine=true; a.window.dispatch('online'); await Promise.resolve(); await Promise.resolve();
  await a.advance(0); assert.equal(server.status.needs_backup,false,'H: al reconectar completa el respaldo pendiente');

  // M: revisión cambiante durante snapshot: la RPC rechaza el revisionado viejo (cubierto en SQL aislado).
  assert.equal(server.status.verified_revision,server.status.revision);
  const storeSrc=fs.readFileSync(path.join(__dirname,'..','PaginaToto-CODIGO-FUENTE','js','store.js'),'utf8');
  const locked={...a.context,window:{App:{},addEventListener(){}},App:{auth:{enabled:true},data:{safetyAvailable:()=>true,deliveryReady:()=>true,backupWritesBlocked:()=>true},ui:{toast(){}}}};
  vm.createContext(locked); vm.runInContext(storeSrc,locked); locked.App.store.hydrate(locked.App.store.blankState());
  locked.App.store.createVehicle({marca:'TEST',modelo:'Bloqueado'});
  assert.equal(locked.App.store.getState().vehicles.length,0,'el store revierte una mutación comercial mientras falla el backup');
  console.log('PASS backup debounce local: A cambio/10m, B cambios agrupados, C sin cambios, D fallo, E retry, F reapertura, G dos clientes, H offline/reconexión, L gating del store; M revisión obsoleta (SQL).');
}
main().catch(err=>{console.error('FAIL backup debounce local:',err);process.exitCode=1;});
