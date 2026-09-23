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

  /* ----------------------------- Utilidades ------------------------------- */
  // id único sin depender de un contador compartido (importante para multi-usuario)
  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

  // convierte a entero o null (nunca deja NaN guardado, p.ej. si alguien escribe letras en Año/Km)
  function toIntOrNull(x) {
    if (x === '' || x == null) return null;
    var n = parseInt(x, 10);
    return isNaN(n) ? null : n;
  }

  /* --------------------------- Persistencia ------------------------------- */
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { state = seedIfEmpty(emptyState()); save(); takeSnapshot(); return; }
      var parsed = JSON.parse(raw);
      state = migrate(parsed);
      takeSnapshot();   // copia de seguridad interna (1 por día, últimas 5)
    } catch (err) {
      console.error('No se pudo cargar el estado, se inicia vacío:', err);
      state = emptyState();
    }
  }

  /* -------------------- Copias internas (anti "borré todo") ------------- */
  var SNAP_KEY = 'paginaToto:snapshots';
  function takeSnapshot() {
    try {
      var arr = JSON.parse(localStorage.getItem(SNAP_KEY) || '[]');
      var hoy = todayISO();
      if (arr.length && arr[arr.length - 1].fecha === hoy) return;
      arr.push({ ts: Date.now(), fecha: hoy, data: JSON.stringify(state) });
      while (arr.length > 5) arr.shift();
      localStorage.setItem(SNAP_KEY, JSON.stringify(arr));
    } catch (e) { /* si no entra en el almacenamiento, se ignora */ }
  }
  function getSnapshots() {
    try {
      return JSON.parse(localStorage.getItem(SNAP_KEY) || '[]')
        .map(function (s) { return { ts: s.ts, fecha: s.fecha, autos: (JSON.parse(s.data).vehicles || []).length }; })
        .sort(function (a, b) { return b.ts - a.ts; });
    } catch (e) { return []; }
  }
  function restoreSnapshot(ts) {
    try {
      var arr = JSON.parse(localStorage.getItem(SNAP_KEY) || '[]');
      var s = arr.filter(function (x) { return x.ts === ts; })[0];
      if (!s) return false;
      takeSnapshot();
      state = migrate(JSON.parse(s.data));
      emit();
      return true;
    } catch (e) { return false; }
  }
  function markBackup() {
    state.meta.lastBackupAt = Date.now();
    save();
  }

  function save() {
    // modo online (multi-usuario): guardar en la nube
    if (App.data && App.data.onLocalChange) { App.data.onLocalChange(state); return; }
    // modo local (archivo): localStorage
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.error('No se pudo guardar el estado:', err);
      App.ui && App.ui.toast('Error al guardar. ¿Almacenamiento lleno?', 'error');
    }
  }

  // reemplaza el estado completo (usado por la sincronización con la nube). No guarda.
  function hydrate(newState) {
    state = migrate(newState || emptyState());
    listeners.forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } });
  }
  function notify() {
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

  function normalizeVehicle(v) {
    v.anio = toIntOrNull(v.anio);
    v.km = toIntOrNull(v.km);
    v.fotos = Array.isArray(v.fotos) ? v.fotos : [];
    v.expenses = Array.isArray(v.expenses) ? v.expenses : [];
    v.checklist = v.checklist || {};
    v.estado = v.estado || 'stock';
    v.documentacion = v.documentacion || 'pendiente';
    v.observaciones = v.observaciones || '';
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
    if (!v.origin) v.origin = { type: 'compra' };
    if (typeof v.deleted !== 'boolean') v.deleted = false;
    return v;
  }

  /* ------------------------------ Listeners ------------------------------- */
  function subscribe(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (l) { return l !== fn; }); }; }
  function emit() { save(); listeners.forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } }); }

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
      origin: data.origin || { type: 'compra' },
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
    emit();
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
    emit();
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
    var v = getVehicle(id);
    if (!v) return;
    v.deleted = true;
    v.deletedAt = Date.now();
    logEvent({ tipo: 'papelera', vehicleId: v.id, titulo: 'Enviaste a papelera ' + vehicleName(v), detalle: 'El vehículo puede restaurarse desde la Papelera' });
    emit();
  }

  function restoreVehicle(id) {
    var v = getVehicle(id);
    if (!v) return;
    v.deleted = false;
    v.deletedAt = null;
    logEvent({ tipo: 'restaurar', vehicleId: v.id, titulo: 'Restauraste ' + vehicleName(v), detalle: 'El vehículo volvió al sistema' });
    emit();
  }

  function hardDeleteVehicle(id) {
    var v = getVehicle(id);
    if (!v) return;
    state.vehicles = state.vehicles.filter(function (x) { return x.id !== id; });
    // limpiar referencias de parte de pago
    state.vehicles.forEach(function (x) {
      if (x.sale && x.sale.tradeIn && x.sale.tradeIn.vehicleId === id) x.sale.tradeIn.vehicleId = null;
    });
    state.history = state.history.filter(function (h) { return h.vehicleId !== id; });
    emit();
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
    emit();
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
    emit();
  }

  function desmarcarCuota(vehicleId, cuotaId) {
    var v = getVehicle(vehicleId);
    if (!v || !v.purchase) return;
    var c = (v.purchase.cuotas || []).filter(function (x) { return x.id === cuotaId; })[0];
    if (!c) return;
    c.pagada = false;
    c.fechaPago = null;
    emit();
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
        ? { monto: num(sale.diferencia.monto), moneda: sale.diferencia.moneda || 'ARS' }
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
    emit();
    return v;
  }

  function cancelarVenta(id) {
    var v = getVehicle(id);
    if (!v || !v.sale) return;
    // si había un vehículo generado como parte de pago y no fue tocado, se envía a papelera
    if (v.sale.tradeIn && v.sale.tradeIn.vehicleId) {
      var ti = getVehicle(v.sale.tradeIn.vehicleId);
      if (ti && !ti.sale && (ti.expenses || []).length === 0) {
        ti.deleted = true; ti.deletedAt = Date.now();
      }
    }
    v.sale = null;
    v.estado = v.reservation ? 'reservado' : 'stock';
    logEvent({ tipo: 'estado', vehicleId: v.id, titulo: 'Anulaste la venta de ' + vehicleName(v), detalle: 'El vehículo volvió a ' + estadoLabel(v.estado).toLowerCase() });
    emit();
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
    emit();
    return v;
  }
  function cancelReservation(id) {
    var v = getVehicle(id);
    if (!v || !v.reservation) return;
    v.reservation = null;
    if (v.estado === 'reservado') v.estado = 'stock';
    logEvent({ tipo: 'estado', vehicleId: v.id, titulo: 'Cancelaste la reserva de ' + vehicleName(v), detalle: 'El vehículo volvió a stock' });
    emit();
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
    emit();
  }
  function descobrarCuotaVenta(vehicleId, cuotaId) {
    var v = getVehicle(vehicleId);
    if (!v || !v.sale || !v.sale.financiacion) return;
    var c = (v.sale.financiacion.cuotas || []).filter(function (x) { return x.id === cuotaId; })[0];
    if (!c) return;
    c.cobrada = false; c.fechaCobro = null;
    emit();
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
    emit();
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
    emit();
  }

  function removeExpense(vehicleId, expenseId) {
    var v = getVehicle(vehicleId);
    if (!v) return;
    v.expenses = v.expenses.filter(function (x) { return x.id !== expenseId; });
    v.updatedAt = Date.now();
    logEvent({ tipo: 'gasto', vehicleId: v.id, titulo: 'Eliminaste un gasto de ' + vehicleName(v), detalle: '' });
    emit();
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
    emit();
    return f;
  }
  function updateFixedExpense(id, patch) {
    var f = getFixedExpense(id);
    if (!f) return null;
    Object.keys(patch).forEach(function (k) { f[k] = patch[k]; });
    normalizeFixedExpense(f);
    emit();
    return f;
  }
  function removeFixedExpense(id) {
    state.fixedExpenses = (state.fixedExpenses || []).filter(function (f) { return f.id !== id; });
    emit();
  }
  function categoriaLabel(c) {
    return ({ alquiler: 'Alquiler del local', sueldos: 'Sueldos', seguros: 'Seguros / flota', patentes: 'Patentes e impuestos', servicios: 'Servicios (luz, internet…)', publicidad: 'Publicidad', otro: 'Otro' })[c] || c;
  }

  /* ------------------------------ Settings ------------------------------ */
  function updateSettings(patch) {
    Object.assign(state.settings, patch);
    if (patch.dolarActual != null) state.settings.dolarActual = num(patch.dolarActual);
    emit();
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
    emit();
    return r;
  }
  function updateReminder(id, patch) {
    var r = getReminder(id);
    if (!r) return null;
    Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
    normalizeReminder(r);
    emit();
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
    emit();
  }
  function removeReminder(id) {
    state.reminders = (state.reminders || []).filter(function (r) { return r.id !== id; });
    emit();
  }

  /* ------------------------- Import / Export / Reset ------------------- */
  function exportJSON() { return JSON.stringify(state, null, 2); }
  function importJSON(text) {
    var parsed = JSON.parse(text);
    takeSnapshot();
    state = migrate(parsed);
    emit();
  }
  function resetAll() {
    takeSnapshot();
    state = emptyState();
    emit();
  }

  /* ------------------------------- Getters ----------------------------- */
  function getState() { return state; }
  function getVehicle(id) { return state.vehicles.filter(function (v) { return v.id === id; })[0] || null; }
  function activeVehicles() { return state.vehicles.filter(function (v) { return !v.deleted; }); }
  function trashedVehicles() { return state.vehicles.filter(function (v) { return v.deleted; }); }
  function getHistory() { return state.history.slice().sort(function (a, b) { return b.ts - a.ts; }); }
  function getEvent(id) { return state.history.filter(function (h) { return h.id === id; })[0] || null; }

  /* ----------------------------- Helpers varios ----------------------- */
  function num(x) { var n = parseFloat(String(x).replace(/\./g, '').replace(',', '.')); return isNaN(n) ? 0 : n; }
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

  /* ---------------------------- Datos de ejemplo ---------------------- */
  function seedIfEmpty(st) {
    // Se cargan pocos datos representativos para que la app no se vea vacía.
    // El usuario puede borrarlos desde Ajustes → Reiniciar datos.
    var prev = state; state = st;
    try {
      var v1 = createVehicle({ marca: 'Toyota', modelo: 'Corolla', anio: 2016, patente: 'AB123CD', km: 98000, combustible: 'Nafta', caja: 'automatica', version: 'XEI 1.8', documentacion: 'completa', observaciones: 'Único dueño, service oficial al día.' }, { silent: true });
      setPurchase(v1.id, { fecha: '2026-07-10', precio: 15000000, moneda: 'ARS', cotizacionUSD: 1500, formaPago: 'transferencia', proveedor: { nombre: 'Juan Pérez', telefono: '11-5555-1234' } });
      addExpense(v1.id, { monto: 200000, moneda: 'ARS', fecha: '2026-07-18', observacion: 'Cambio de vidrio delantero' });
      addExpense(v1.id, { monto: 650000, moneda: 'ARS', fecha: '2026-07-22', observacion: 'Service completo, cubiertas y detailing interior' });
      setSale(v1.id, { fecha: '2026-09-02', precio: 18500000, moneda: 'ARS', cotizacionUSD: 1600, formaCobro: 'transferencia', cliente: { nombre: 'Marcelo Gómez', telefono: '11-4444-9876' } });

      var v2 = createVehicle({ marca: 'Volkswagen', modelo: 'Golf', anio: 2018, patente: 'AD456EF', km: 72000, combustible: 'Nafta', caja: 'automatica', version: 'Comfortline 1.4 TSI', documentacion: 'transferencia', observaciones: 'Detalle de pintura en puerta trasera derecha.' }, { silent: true });
      setPurchase(v2.id, { fecha: '2026-08-05', precio: 12000, moneda: 'USD', cotizacionUSD: 1520, formaPago: 'cuotas', cuotas: [
        { numero: 1, monto: 4000, vencimiento: '2026-08-05', pagada: true, fechaPago: '2026-08-05' },
        { numero: 2, monto: 4000, vencimiento: '2026-09-05', pagada: true, fechaPago: '2026-09-04' },
        { numero: 3, monto: 4000, vencimiento: '2026-10-05', pagada: false }
      ], proveedor: { nombre: 'AutoHaus', telefono: '11-3333-2211' } });
      addExpense(v2.id, { monto: 300000, moneda: 'ARS', fecha: '2026-08-12', observacion: 'Pulido y pintura puerta' });

      var off = function (d) { var x = new Date(); x.setDate(x.getDate() + d); return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()); };

      var v3 = createVehicle({ marca: 'Ford', modelo: 'Focus', anio: 2015, patente: 'MJP902', km: 130000, combustible: 'Nafta', caja: 'manual', version: 'SE 2.0', documentacion: 'pendiente', observaciones: '' }, { silent: true });
      setPurchase(v3.id, { fecha: '2026-06-01', precio: 9500000, moneda: 'ARS', cotizacionUSD: 1450, formaPago: 'mixto', montoTransferencia: 5000000, montoEfectivo: 4500000 });
      addExpense(v3.id, { monto: 120000, moneda: 'ARS', fecha: '2026-06-15', observacion: 'Chapa y pintura paragolpes' });
      setReservation(v3.id, { fecha: off(-2), monto: 1500000, moneda: 'ARS', vence: off(4), cliente: { nombre: 'Diego Fernández', telefono: '11-6666-3030' }, notas: 'Seña recibida en efectivo. Paga el resto cuando esté la transferencia.' });

      var v4 = createVehicle({ marca: 'Chevrolet', modelo: 'Cruze', anio: 2019, patente: 'AC789GH', km: 65000, combustible: 'Nafta', caja: 'automatica', version: 'LT 1.4 Turbo', documentacion: 'completa', observaciones: '' }, { silent: true });
      setPurchase(v4.id, { fecha: '2026-05-10', precio: 13500000, moneda: 'ARS', cotizacionUSD: 1480, formaPago: 'transferencia', proveedor: { nombre: 'Particular (Lucía R.)', telefono: '11-2020-4040' }, comision: { persona: 'Rubén (contacto)', monto: 200000, moneda: 'ARS', pagada: true } });
      setSale(v4.id, { fecha: '2026-08-20', precio: 17000000, moneda: 'ARS', cotizacionUSD: 1550, formaCobro: 'financiado', cliente: { nombre: 'Sofía Ramírez', telefono: '11-7788-1122' },
        financiacion: { enabled: true, entidad: 'Financiera del Sur', entrega: 7000000, moneda: 'ARS', notas: 'Prenda a 6 cuotas.', cuotas: [
          { numero: 1, monto: 1750000, vencimiento: off(-20), cobrada: true, fechaCobro: off(-19) },
          { numero: 2, monto: 1750000, vencimiento: off(10) },
          { numero: 3, monto: 1750000, vencimiento: off(40) },
          { numero: 4, monto: 1750000, vencimiento: off(70) },
          { numero: 5, monto: 1750000, vencimiento: off(100) },
          { numero: 6, monto: 1750000, vencimiento: off(130) }
        ] } });

      addFixedExpense({ concepto: 'Alquiler del local', categoria: 'alquiler', monto: 900000, moneda: 'ARS', frecuencia: 'mensual', fecha: '2026-03-01' });
      addFixedExpense({ concepto: 'Seguro de la flota', categoria: 'seguros', monto: 350000, moneda: 'ARS', frecuencia: 'mensual', fecha: '2026-03-01' });
      addFixedExpense({ concepto: 'Cartel nuevo del frente', categoria: 'publicidad', monto: 480000, moneda: 'ARS', frecuencia: 'unica', fecha: '2026-07-05' });

      addReminder({ titulo: 'Turno de transferencia con Marcelo Gómez', fecha: off(0), hora: '10:30', tipo: 'gestoria', nota: 'Llevar título y cédula del Corolla.' });
      addReminder({ titulo: 'Service completo Volkswagen Golf', fecha: off(2), hora: '09:00', tipo: 'mantenimiento' });
      addReminder({ titulo: 'Renovar VTV Ford Focus', fecha: off(-3), tipo: 'tramite', nota: 'Está vencida, sacar turno.' });
      addReminder({ titulo: 'Limpiar y ordenar el playón', fecha: off(0), tipo: 'tarea', repeat: 'weekly' });
    } catch (e) { console.error('seed', e); }
    var result = state; state = prev; return result;
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
    markBackup: markBackup, takeSnapshot: takeSnapshot, getSnapshots: getSnapshots, restoreSnapshot: restoreSnapshot,
    logEvent: function (e) { logEvent(e); emit(); },
    // helpers
    uid: uid, todayISO: todayISO, num: num,
    vehicleName: vehicleName, estadoLabel: estadoLabel, categoriaLabel: categoriaLabel,
    formaPagoLabel: formaPagoLabel, formaCobroLabel: formaCobroLabel
  };
})();
