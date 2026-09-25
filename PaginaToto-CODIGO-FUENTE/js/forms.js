/* ============================================================================
 * forms.js  —  Formularios: vehículo, compra, venta, gasto, reserva,
 *              gasto del negocio, recordatorio
 * ==========================================================================*/
(function () {
  'use strict';
  var ui = App.ui, el = ui.el, store = App.store;

  var COMBUSTIBLES = ['Nafta', 'Diésel', 'GNC', 'Híbrido', 'Eléctrico', 'Nafta/GNC'];
  var CHECKLIST_ITEMS = [
    ['mecanica', 'Mecánica revisada'],
    ['aceite', 'Aceite cambiado'],
    ['frenos', 'Frenos revisados'],
    ['neumaticos', 'Neumáticos revisados'],
    ['luces', 'Luces revisadas'],
    ['aire', 'Aire acondicionado'],
    ['interior', 'Interior'],
    ['exterior', 'Exterior'],
    ['documentacion', 'Documentación'],
    ['transferencia', 'Transferencia']
  ];

  function opt(v, l) { return { value: v, label: l }; }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function isoD(d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }

  /* --------- Constructor de cuotas (a pagar o a cobrar) ------------- */
  function cuotaBuilder(getMoneda, opts) {
    opts = opts || {};
    var cobro = !!opts.cobro;
    var kDone = cobro ? 'cobrada' : 'pagada';
    var kDate = cobro ? 'fechaCobro' : 'fechaPago';
    var lblDone = cobro ? 'Cobrada' : 'Pagada';
    var cuotas = (opts.initial || []).map(function (c) { return Object.assign({}, c); });
    var box = el('div', { class: 'cuotas-builder' });
    var fCant = ui.input({ inputmode: 'numeric', placeholder: 'Ej: 12', style: 'max-width:100px' });
    var fMonto = ui.moneyInput({ placeholder: '0', style: 'max-width:150px' });
    var fPrimer = ui.input({ type: 'date', value: store.todayISO(), style: 'max-width:160px' });
    var gen = el('button', {
      type: 'button', class: 'btn btn-primary btn-sm', text: 'Generar cuotas ›', onclick: function () {
        var n = parseInt(fCant.value, 10), monto = store.num(fMonto.value);
        if (!n || n < 1) { ui.toast('Poné cuántas cuotas', 'error'); return; }
        var base = App.finance.parseDate(fPrimer.value) || new Date();
        cuotas = [];
        for (var i = 0; i < n; i++) {
          var d = new Date(base.getFullYear(), base.getMonth() + i, base.getDate());
          var c = { id: store.uid(cobro ? 'cc' : 'c'), numero: i + 1, monto: monto, vencimiento: isoD(d) };
          c[kDone] = false; c[kDate] = null;
          cuotas.push(c);
        }
        render();
      }
    });
    function render() {
      ui.clear(box);
      if (!cuotas.length) { box.appendChild(el('p', { class: 'form-help', text: 'Todavía no generaste cuotas. Poné la cantidad, el monto y desde cuándo, y tocá "Generar cuotas".' })); return; }
      var totalEl = el('div', { class: 'cuota-total' });
      cuotas.forEach(function (c, i) {
        var fM = ui.moneyInput({ value: c.monto, style: 'max-width:130px' });
        fM.addEventListener('input', function () { c.monto = fM.value; upd(); });
        var fV = ui.input({ type: 'date', value: c.vencimiento, style: 'max-width:150px' });
        fV.addEventListener('input', function () { c.vencimiento = fV.value; });
        var cb = el('input', { type: 'checkbox' }); cb.checked = !!c[kDone];
        var fFP = ui.input({ type: 'date', value: c[kDate] || store.todayISO(), style: 'max-width:140px' });
        fFP.disabled = !c[kDone];
        cb.addEventListener('change', function () { c[kDone] = cb.checked; fFP.disabled = !cb.checked; c[kDate] = cb.checked ? fFP.value : null; });
        fFP.addEventListener('input', function () { c[kDate] = fFP.value; });
        box.appendChild(el('div', { class: 'cuota-row' }, [
          el('span', { class: 'cuota-num', text: 'Cuota ' + (i + 1) }),
          fM, fV,
          el('label', { class: 'check-inline' }, [cb, el('span', { text: lblDone })]),
          fFP,
          el('button', { type: 'button', class: 'mini-btn', text: '✕', title: 'Quitar', onclick: function () { cuotas.splice(i, 1); render(); } })
        ]));
      });
      box.appendChild(totalEl);
      function upd() {
        var t = cuotas.reduce(function (s, x) { return s + store.num(x.monto); }, 0);
        totalEl.textContent = 'Total en cuotas: ' + App.fmt.money(t, getMoneda());
      }
      upd();
    }
    render();
    return {
      section: el('div', {}, [
        el('div', { class: 'inline-fields' }, [
          ui.field('Cantidad de cuotas', fCant),
          ui.field('Monto de cada una', fMonto),
          ui.field('Primer vencimiento', fPrimer, 'Se generan mensuales, una por mes'),
          gen
        ]),
        box
      ]),
      render: render,
      getCuotas: function () { return cuotas.slice(); }
    };
  }

  /* --------- Bloque de comisión a un tercero (opcional) ------------ */
  function comisionBlock(com) {
    com = com || {};
    var fPersona = ui.input({ value: com.persona || '', placeholder: 'Quién la trajo (opcional)' });
    var monto = ui.money2('comision', com.monto || '', com.moneda || 'ARS');
    var cbPag = el('input', { type: 'checkbox' }); cbPag.checked = !!com.pagada;
    var wrap = el('div', { class: 'grid-2' }, [
      ui.field('Persona / contacto', fPersona),
      ui.field('Monto de la comisión', monto.wrap),
      ui.field('', el('label', { class: 'check-inline' }, [cbPag, el('span', { text: 'Ya se la pagué' })]))
    ]);
    return {
      wrap: wrap,
      get: function () {
        return store.num(monto.monto.value) > 0
          ? { persona: fPersona.value, monto: monto.monto.value, moneda: monto.moneda.value, pagada: cbPag.checked }
          : null;
      }
    };
  }

  // --- Campos de "Compra" reutilizables entre registrar (nuevo) y editar
  // (desde dentro de "Editar vehículo", para poder corregir el precio de
  // compra sin ir a un formulario aparte). Reusa exactamente store.setPurchase.
  function compraFieldsBuilder(p) {
    p = p || {};
    var fFecha = ui.input({ type: 'date', value: p.fecha || store.todayISO() });
    var precio = ui.money2('vfCompra', p.precio || '', p.moneda || 'ARS');
    var fForma = ui.select([opt('transferencia', 'Transferencia'), opt('efectivo', 'Efectivo'), opt('mixto', 'Mitad transferencia / mitad efectivo'), opt('cuotas', 'En cuotas')], p.formaPago || 'transferencia');
    var fTransf = ui.moneyInput({ value: p.montoTransferencia || '', placeholder: 'Monto transferencia' });
    var fEfec = ui.moneyInput({ value: p.montoEfectivo || '', placeholder: 'Monto efectivo' });
    var mixtoError = el('p', { class: 'auth-err', hidden: true });
    var mixtoBox = el('div', {}, [el('div', { class: 'grid-2' }, [ui.field('Monto por transferencia', fTransf), ui.field('Monto en efectivo', fEfec)]), mixtoError]);
    function checkMixto() {
      if (fForma.value !== 'mixto') { mixtoError.hidden = true; return true; }
      var total = store.num(precio.monto.value);
      var sum = store.num(fTransf.value) + store.num(fEfec.value);
      var ok = Math.abs(total - sum) <= 0.01;
      mixtoError.hidden = ok;
      if (!ok) mixtoError.textContent = 'Transferencia + efectivo (' + App.fmt.money(sum) + ') no coincide con el precio total (' + App.fmt.money(total) + ').';
      return ok;
    }
    [fTransf, fEfec].forEach(function (i) { i.addEventListener('input', checkMixto); });
    precio.monto.addEventListener('input', checkMixto);
    fForma.addEventListener('change', checkMixto);
    var cuotas = cuotaBuilder(function () { return precio.moneda.value; }, { initial: p.cuotas });
    var pr = p.proveedor || {};
    var fProvNom = ui.input({ value: pr.nombre || '', placeholder: 'Nombre (opcional)' });
    var fProvTel = ui.input({ value: pr.telefono || '', placeholder: 'Teléfono (opcional)' });
    function sync() { mixtoBox.hidden = fForma.value !== 'mixto'; cuotas.section.hidden = fForma.value !== 'cuotas'; }
    fForma.addEventListener('change', sync);
    sync(); checkMixto();
    var node = el('div', { class: 'form-grid' }, [
      el('div', { class: 'grid-2' }, [ui.field('Precio de compra', precio.wrap), ui.field('Fecha de compra', fFecha)]),
      ui.field('Forma de pago', fForma),
      mixtoBox,
      cuotas.section,
      el('div', { class: 'grid-2' }, [ui.field('Proveedor / vendedor', fProvNom), ui.field('Teléfono', fProvTel)])
    ]);
    return {
      node: node,
      hasPrice: function () { return store.num(precio.monto.value) > 0; },
      isValid: checkMixto,
      getData: function () {
        return {
          fecha: fFecha.value, precio: precio.monto.value, moneda: precio.moneda.value,
          formaPago: fForma.value, montoTransferencia: fTransf.value, montoEfectivo: fEfec.value,
          cuotas: fForma.value === 'cuotas' ? cuotas.getCuotas() : [],
          proveedor: { nombre: fProvNom.value, telefono: fProvTel.value, notas: pr.notas || '' }
        };
      }
    };
  }

  // --- Campos de "Consignación": el vehículo sigue siendo del dueño; el
  // negocio NO lo compra (no se llama a store.setPurchase). Lo que le
  // corresponde al dueño se descuenta al vender (ver finance.js). ---
  function consignacionFieldsBuilder(o) {
    o = o || {};
    var fDuenio = ui.input({ value: (o.duenio && o.duenio.nombre) || '', placeholder: 'Nombre del dueño' });
    var fTelDuenio = ui.input({ value: (o.duenio && o.duenio.telefono) || '', placeholder: 'Teléfono (opcional)' });
    var precioDueno = ui.money2('vfConsig', o.precioDueno || '', o.monedaDueno || 'ARS');
    var fFecha = ui.input({ type: 'date', value: o.fecha || store.todayISO() });
    var fCotiz = ui.moneyInput({ value: o.cotizacionUSD || '', placeholder: '1500' });
    var cotizField = ui.field('Cotización del dólar (opcional)', fCotiz, 'Sirve para comparar en dólares más adelante');
    var fNotas = ui.textarea({ value: o.notas || '', rows: 2, placeholder: 'Condiciones, observaciones (opcional)' });
    function sync() { cotizField.hidden = precioDueno.moneda.value !== 'ARS'; }
    precioDueno.moneda.addEventListener('change', sync); sync();
    var node = el('div', { class: 'form-grid' }, [
      el('div', { class: 'grid-2' }, [ui.field('Dueño del vehículo', fDuenio), ui.field('Teléfono', fTelDuenio)]),
      el('div', { class: 'grid-2' }, [ui.field('Precio que pide el dueño', precioDueno.wrap), ui.field('Fecha de ingreso', fFecha)]),
      cotizField,
      ui.field('Notas / condiciones', fNotas)
    ]);
    return {
      node: node,
      hasOwnerName: function () { return !!fDuenio.value.trim(); },
      getData: function () {
        return {
          type: 'consignacion',
          duenio: { nombre: fDuenio.value.trim(), telefono: fTelDuenio.value.trim() },
          precioDueno: precioDueno.monto.value, monedaDueno: precioDueno.moneda.value,
          cotizacionUSD: fCotiz.value, fecha: fFecha.value, notas: fNotas.value
        };
      }
    };
  }

  /* ===================== PÁGINA: REGISTRAR / EDITAR VEHÍCULO ============= */
  // Antes era un modal grande con scroll interno; ahora es una página completa
  // (misma app, solo mejor organizada). Sigue usando EXACTAMENTE las mismas
  // funciones de guardado de siempre: store.createVehicle / store.updateVehicle
  // para los datos del vehículo, y store.setPurchase para la compra (la misma
  // que usa "Editar compra" en la ficha) — tanto al registrar como, ahora
  // también, al editar un vehículo existente.
  function vehicleFormView(root, vehicleId) {
    var existing = vehicleId ? store.getVehicle(vehicleId) : null;
    var isEdit = !!existing;
    var v = existing || {};
    var esConsignacion = !!(v.origin && v.origin.type === 'consignacion');

    var fMarca = ui.input({ value: v.marca || '', required: true, placeholder: 'Toyota' });
    var fModelo = ui.input({ value: v.modelo || '', required: true, placeholder: 'Corolla' });
    var fAnio = ui.input({ value: v.anio || '', inputmode: 'numeric', placeholder: '2016' });
    var fPatente = ui.input({ value: v.patente || '', placeholder: 'AB123CD', style: 'text-transform:uppercase' });
    var fKm = ui.input({ value: v.km != null ? v.km : '', inputmode: 'numeric', placeholder: '98000' });
    var fComb = ui.select([opt('', '—')].concat(COMBUSTIBLES.map(function (c) { return opt(c, c); })), v.combustible || '');
    var fCaja = ui.select([opt('', '—'), opt('manual', 'Manual'), opt('automatica', 'Automática')], v.caja || '');
    var fVersion = ui.input({ value: v.version || '', placeholder: 'XEI 1.8 CVT' });
    var fEstado = ui.select([opt('stock', 'En stock'), opt('reservado', 'Reservado'), opt('vendido', 'Vendido')], v.estado || 'stock');
    var fDoc = ui.select([opt('completa', 'Completa'), opt('pendiente', 'Pendiente'), opt('transferencia', 'Transferencia pendiente'), opt('otro', 'Otro')], v.documentacion || 'pendiente');
    var pretendido = ui.money2('pretendido', v.precioPretendido || '', v.precioPretendidoMoneda || 'ARS');
    var fObs = ui.textarea({ value: v.observaciones || '', rows: 4, placeholder: 'Cualquier información relevante del vehículo...' });

    // --- Origen: Compra o Consignación (solo al REGISTRAR un vehículo nuevo;
    // no se puede cambiar el origen de un vehículo ya existente). ---
    var origenCard, origenMode = 'compra', compraBuilder, consigBuilder;
    if (!isEdit) {
      compraBuilder = compraFieldsBuilder();
      consigBuilder = consignacionFieldsBuilder();
      var segCompra = el('button', { type: 'button', class: 'seg is-active', text: 'Compra' });
      var segConsig = el('button', { type: 'button', class: 'seg', text: 'Consignación' });
      function setOrigenMode(mode) {
        origenMode = mode;
        segCompra.classList.toggle('is-active', mode === 'compra');
        segConsig.classList.toggle('is-active', mode === 'consignacion');
        compraBuilder.node.hidden = mode !== 'compra';
        consigBuilder.node.hidden = mode !== 'consignacion';
      }
      segCompra.addEventListener('click', function () { setOrigenMode('compra'); });
      segConsig.addEventListener('click', function () { setOrigenMode('consignacion'); });
      origenCard = el('div', { class: 'card' }, [
        el('h3', { text: 'Origen del vehículo' }),
        el('div', { class: 'seg-control' }, [segCompra, segConsig]),
        el('p', { class: 'form-help', text: 'Compra: opcional, la podés cargar después. Consignación: el dueño lo entrega para que lo vendas vos — el negocio no lo compra, solo se queda con la diferencia al venderlo.' }),
        compraBuilder.node, consigBuilder.node
      ]);
      setOrigenMode('compra');
    }

    // --- Edición: permite corregir la compra (o los datos de consignación)
    // de un vehículo ya existente, sin ir a un formulario aparte. ---
    var editCompraBuilder = null, editConsigBuilder = null, editOrigenCard = null;
    if (isEdit && esConsignacion) {
      editConsigBuilder = consignacionFieldsBuilder(v.origin);
      editOrigenCard = el('div', { class: 'card' }, [el('h3', { text: '🤝 Consignación' }), editConsigBuilder.node]);
    } else if (isEdit && v.purchase) {
      editCompraBuilder = compraFieldsBuilder(v.purchase);
      editOrigenCard = el('div', { class: 'card' }, [
        el('h3', { text: 'Compra' }),
        el('p', { class: 'form-help', text: 'Corregí el precio u otros datos de la compra. La inversión, la ganancia y toda la economía se recalculan solas.' }),
        editCompraBuilder.node
      ]);
    }

    var page = el('div', { class: 'page vehicle-form-page' }, [
      el('a', { class: 'back-link', href: isEdit ? '#/vehiculo/' + v.id : '#/', html: '‹ Volver' }),
      el('h1', { text: isEdit ? 'Editar vehículo' : 'Registrar vehículo' }),

      el('div', { class: 'card' }, [
        el('h3', { text: 'Información del vehículo' }),
        el('div', { class: 'grid-2' }, [
          ui.field('Marca *', fMarca), ui.field('Modelo *', fModelo),
          ui.field('Año', fAnio), ui.field('Patente', fPatente),
          ui.field('Kilometraje', fKm), ui.field('Combustible', fComb),
          ui.field('Tipo de caja', fCaja), ui.field('Versión', fVersion)
        ])
      ]),

      origenCard,
      editOrigenCard,

      el('div', { class: 'card' }, [
        el('h3', { text: 'Estado' }),
        el('div', { class: 'grid-2' }, [ui.field('Estado', fEstado), ui.field('Documentación', fDoc)])
      ]),

      el('div', { class: 'card' }, [
        el('h3', { text: 'Información adicional' }),
        el('div', { class: 'grid-2' }, [ui.field('Precio pretendido (opcional)', pretendido.wrap, 'Se usa para estimar el valor del stock')]),
        ui.field('Observaciones', fObs)
      ]),

      el('div', { class: 'form-actions' }, [
        el('button', { class: 'btn btn-ghost', text: 'Cancelar', onclick: function () { App.router.go(isEdit ? 'vehiculo/' + v.id : ''); } }),
        el('button', { class: 'btn btn-primary', text: isEdit ? 'Guardar cambios' : 'Registrar vehículo', onclick: submit })
      ])
    ]);

    var submitted = false;
    function submit() {
      if (submitted) return;
      if (!fMarca.value.trim() || !fModelo.value.trim()) { ui.toast('Marca y modelo son obligatorios', 'error'); return; }
      if (!isEdit && origenMode === 'compra' && compraBuilder.hasPrice() && !compraBuilder.isValid()) { ui.toast('Los importes de la compra no coinciden con el total', 'error'); return; }
      if (!isEdit && origenMode === 'consignacion' && !consigBuilder.hasOwnerName()) { ui.toast('Ingresá el nombre del dueño', 'error'); return; }
      if (editCompraBuilder && editCompraBuilder.hasPrice() && !editCompraBuilder.isValid()) { ui.toast('Los importes de la compra no coinciden con el total', 'error'); return; }
      submitted = true;
      var data = {
        marca: fMarca.value, modelo: fModelo.value, anio: fAnio.value, patente: fPatente.value,
        km: fKm.value, combustible: fComb.value, caja: fCaja.value, version: fVersion.value,
        estado: fEstado.value, documentacion: fDoc.value,
        precioPretendido: pretendido.monto.value, precioPretendidoMoneda: pretendido.moneda.value,
        observaciones: fObs.value
      };
      if (!isEdit && origenMode === 'consignacion') data.origin = consigBuilder.getData();
      if (isEdit && editConsigBuilder) data.origin = editConsigBuilder.getData();

      if (isEdit) {
        store.updateVehicle(v.id, data);
        if (editCompraBuilder && editCompraBuilder.hasPrice()) store.setPurchase(v.id, editCompraBuilder.getData());
        ui.toast('Vehículo actualizado', 'success');
        App.router.go('vehiculo/' + v.id);
        return;
      }
      var nv = store.createVehicle(data);
      if (origenMode === 'compra' && compraBuilder.hasPrice()) store.setPurchase(nv.id, compraBuilder.getData());
      ui.toast(origenMode === 'consignacion' ? 'Consignación registrada' : 'Vehículo registrado', 'success');
      App.router.go('vehiculo/' + nv.id);
    }

    root.appendChild(page);
  }

  /* ============================ FORM COMPRA ============================= */
  function purchaseForm(vehicleId) {
    var v = store.getVehicle(vehicleId);
    if (!v) return;
    var p = v.purchase || {};

    var fFecha = ui.input({ type: 'date', value: p.fecha || store.todayISO() });
    var precio = ui.money2('precio', p.precio || '', p.moneda || 'ARS');
    var fCotiz = ui.moneyInput({ value: p.cotizacionUSD || '', placeholder: '1500' });
    var cotizField = ui.field('Cotización del dólar al momento de la compra', fCotiz, 'Se guarda como valor histórico y no cambia luego');

    var fForma = ui.select([opt('transferencia', 'Transferencia'), opt('efectivo', 'Efectivo'), opt('mixto', 'Mitad transferencia / mitad efectivo'), opt('cuotas', 'En cuotas')], p.formaPago || 'transferencia');
    var fTransf = ui.moneyInput({ value: p.montoTransferencia || '', placeholder: 'Monto transferencia' });
    var fEfec = ui.moneyInput({ value: p.montoEfectivo || '', placeholder: 'Monto efectivo' });
    var mixtoError = el('p', { class: 'auth-err', hidden: true });
    var mixtoBox = el('div', {}, [
      el('div', { class: 'grid-2' }, [ui.field('Monto por transferencia', fTransf), ui.field('Monto en efectivo', fEfec)]),
      mixtoError
    ]);
    function checkMixto() {
      if (fForma.value !== 'mixto') { mixtoError.hidden = true; return true; }
      var total = store.num(precio.monto.value);
      var sum = store.num(fTransf.value) + store.num(fEfec.value);
      var ok = Math.abs(total - sum) <= 0.01;
      mixtoError.hidden = ok;
      if (!ok) mixtoError.textContent = 'Transferencia + efectivo (' + App.fmt.money(sum) + ') no coincide con el precio total (' + App.fmt.money(total) + ').';
      return ok;
    }
    [fTransf, fEfec].forEach(function (i) { i.addEventListener('input', checkMixto); });
    precio.monto.addEventListener('input', checkMixto);
    fForma.addEventListener('change', checkMixto);

    var cb = cuotaBuilder(function () { return precio.moneda.value; }, { initial: p.cuotas });
    var cuotasSection = cb.section;

    var pr = p.proveedor || {};
    var fProvNom = ui.input({ value: pr.nombre || '', placeholder: 'Nombre (opcional)' });
    var fProvTel = ui.input({ value: pr.telefono || '', placeholder: 'Teléfono (opcional)' });
    var fProvNotas = ui.textarea({ value: pr.notas || '', rows: 2, placeholder: 'Otros datos (opcional)' });

    var comision = comisionBlock(p.comision);

    function syncForma() {
      var f = fForma.value;
      mixtoBox.hidden = f !== 'mixto';
      cuotasSection.hidden = f !== 'cuotas';
    }
    fForma.addEventListener('change', syncForma);
    function syncCotiz() { cotizField.hidden = precio.moneda.value !== 'ARS'; }
    precio.moneda.addEventListener('change', function () { syncCotiz(); cb.render(); });

    var body = el('div', { class: 'form-grid' }, [
      el('div', { class: 'grid-2' }, [
        ui.field('Fecha de compra', fFecha),
        ui.field('Precio de compra', precio.wrap)
      ]),
      cotizField,
      el('div', { class: 'form-section-title', text: 'Forma de pago' }),
      ui.field('', fForma),
      mixtoBox,
      cuotasSection,
      el('div', { class: 'form-section-title', text: 'Vendedor / proveedor (opcional)' }),
      el('div', { class: 'grid-2' }, [ui.field('Nombre', fProvNom), ui.field('Teléfono', fProvTel)]),
      ui.field('Otros datos', fProvNotas),
      el('div', { class: 'form-section-title', text: 'Comisión pagada a un tercero (opcional)' }),
      comision.wrap
    ]);

    var m = ui.modal({
      title: v.purchase ? 'Editar compra' : 'Registrar compra',
      size: 'lg', body: body,
      footer: [
        el('button', { class: 'btn btn-ghost', text: 'Cancelar', onclick: function () { m.close(); } }),
        el('button', { class: 'btn btn-primary', text: 'Guardar compra', onclick: submit })
      ]
    });
    syncForma(); syncCotiz(); checkMixto();

    var submitted = false;
    function submit() {
      if (submitted) return;
      if (store.num(precio.monto.value) <= 0) { ui.toast('Ingresá el precio de compra', 'error'); return; }
      if (precio.moneda.value === 'ARS' && store.num(fCotiz.value) <= 0) {
        ui.toast('Ingresá la cotización del dólar de la compra', 'error'); return;
      }
      if (!checkMixto()) { ui.toast('Los importes no coinciden con el total', 'error'); return; }
      submitted = true;
      var data = {
        fecha: fFecha.value, precio: precio.monto.value, moneda: precio.moneda.value,
        cotizacionUSD: fCotiz.value,
        formaPago: fForma.value,
        montoTransferencia: fTransf.value, montoEfectivo: fEfec.value,
        cuotas: fForma.value === 'cuotas' ? cb.getCuotas() : [],
        proveedor: { nombre: fProvNom.value, telefono: fProvTel.value, notas: fProvNotas.value },
        comision: comision.get()
      };
      store.setPurchase(v.id, data);
      ui.toast('Compra registrada', 'success');
      m.close();
    }
    return m;
  }

  /* ============================ FORM VENTA ============================= */
  function saleForm(vehicleId) {
    var v = store.getVehicle(vehicleId);
    if (!v) return;
    var esConsignacion = !!(v.origin && v.origin.type === 'consignacion');
    if (!v.purchase && !esConsignacion) { ui.toast('Primero registrá la compra del vehículo', 'error'); return; }
    var s = v.sale || {};

    var fFecha = ui.input({ type: 'date', value: s.fecha || store.todayISO() });
    var precio = ui.money2('venta', s.precio || '', s.moneda || 'ARS');
    var fCotiz = ui.moneyInput({ value: s.cotizacionUSD || '', placeholder: '1600' });
    var cotizField = ui.field('Cotización del dólar al momento de la venta', fCotiz, 'Valor histórico, no cambia luego');
    var fForma = ui.select([
      opt('transferencia', 'Transferencia'), opt('efectivo', 'Efectivo'),
      opt('mixto', 'Mitad transferencia / mitad efectivo'),
      opt('financiado', 'Financiado / con prenda (en cuotas)'),
      opt('vehiculo', 'Entrega de otro vehículo como parte de pago')
    ], s.formaCobro || 'transferencia');
    var fTransf = ui.moneyInput({ value: s.montoTransferencia || '', placeholder: 'Monto transferencia' });
    var fEfec = ui.moneyInput({ value: s.montoEfectivo || '', placeholder: 'Monto efectivo' });
    var mixtoError = el('p', { class: 'auth-err', hidden: true });
    var mixtoBox = el('div', {}, [
      el('div', { class: 'grid-2' }, [ui.field('Monto por transferencia', fTransf), ui.field('Monto en efectivo', fEfec)]),
      mixtoError
    ]);
    function checkMixto() {
      if (fForma.value !== 'mixto') { mixtoError.hidden = true; return true; }
      var total = store.num(precio.monto.value);
      var sum = store.num(fTransf.value) + store.num(fEfec.value);
      var ok = Math.abs(total - sum) <= 0.01;
      mixtoError.hidden = ok;
      if (!ok) mixtoError.textContent = 'Transferencia + efectivo (' + App.fmt.money(sum) + ') no coincide con el precio total (' + App.fmt.money(total) + ').';
      return ok;
    }
    [fTransf, fEfec].forEach(function (i) { i.addEventListener('input', checkMixto); });
    precio.monto.addEventListener('input', checkMixto);
    fForma.addEventListener('change', checkMixto);

    // financiación (cuotas a cobrar)
    var f = s.financiacion || {};
    var finEntidad = ui.input({ value: f.entidad || '', placeholder: 'Banco / financiera / particular' });
    var finEntrega = ui.money2('finEntrega', f.entrega || '', f.moneda || (s.moneda || 'ARS'));
    var finNotas = ui.textarea({ value: f.notas || '', rows: 2, placeholder: 'Otros datos (opcional)' });
    var finCb = cuotaBuilder(function () { return finEntrega.moneda.value; }, { cobro: true, initial: f.cuotas });
    var finBox = el('div', { class: 'trade-in-box' }, [
      el('div', { class: 'grid-2' }, [ui.field('Entidad / quién financia', finEntidad), ui.field('Anticipo / entrega', finEntrega.wrap)]),
      el('p', { class: 'form-help', text: 'Cargá las cuotas que te van a pagar. La app te va a avisar cuando venza cada una.' }),
      finCb.section,
      ui.field('Notas', finNotas)
    ]);

    // trade-in
    var ti = s.tradeIn || {};
    var tiEnabled = el('input', { type: 'checkbox' });
    tiEnabled.checked = !!s.tradeIn;
    var tiMarca = ui.input({ value: ti.marca || '', placeholder: 'Marca' });
    var tiModelo = ui.input({ value: ti.modelo || '', placeholder: 'Modelo' });
    var tiAnio = ui.input({ value: ti.anio || '', inputmode: 'numeric', placeholder: 'Año' });
    var tiPat = ui.input({ value: ti.patente || '', placeholder: 'Patente', style: 'text-transform:uppercase' });
    var tiKm = ui.input({ value: ti.km || '', inputmode: 'numeric', placeholder: 'Kilometraje' });
    var tiValor = ui.money2('tiValor', ti.valor || '', ti.moneda || 'ARS');
    var tiObs = ui.textarea({ value: ti.observaciones || '', rows: 2, placeholder: 'Observaciones del vehículo recibido' });
    var difMonto = ui.money2('dif', s.diferencia ? s.diferencia.monto : '', s.diferencia ? s.diferencia.moneda : 'ARS');
    var tiLinkNote = el('p', { class: 'form-help' });
    if (ti.vehicleId) tiLinkNote.textContent = 'Este vehículo ya fue incorporado al stock. Editá sus datos desde su propia ficha.';

    var tiBox = el('div', { class: 'trade-in-box' }, [
      el('div', { class: 'grid-2' }, [
        ui.field('Marca', tiMarca), ui.field('Modelo', tiModelo),
        ui.field('Año', tiAnio), ui.field('Patente', tiPat),
        ui.field('Kilometraje', tiKm), ui.field('Valor asignado', tiValor.wrap)
      ]),
      ui.field('Observaciones', tiObs),
      el('div', { class: 'form-section-title', text: 'Diferencia recibida' }),
      ui.field('Monto de la diferencia', difMonto.wrap, 'La diferencia que efectivamente cobraste, además del vehículo'),
      tiLinkNote
    ]);

    function syncForma() {
      var vf = fForma.value;
      mixtoBox.hidden = vf !== 'mixto';
      finBox.hidden = vf !== 'financiado';
      if (vf === 'financiado') { finCb.render(); }
      if (vf === 'vehiculo') { tiEnabled.checked = true; }
      syncTi();
    }
    function syncTi() {
      tiBox.hidden = !tiEnabled.checked;
      var inputs = tiBox.querySelectorAll('input,textarea,select,button');
      Array.prototype.forEach.call(inputs, function (i) { i.disabled = !!ti.vehicleId; });
    }
    tiEnabled.addEventListener('change', syncTi);
    fForma.addEventListener('change', syncForma);
    function syncCotiz() { cotizField.hidden = precio.moneda.value !== 'ARS'; }
    precio.moneda.addEventListener('change', syncCotiz);

    var cl = s.cliente || {};
    var clNom = ui.input({ value: cl.nombre || '', placeholder: 'Nombre (opcional)' });
    var clTel = ui.input({ value: cl.telefono || '', placeholder: 'Teléfono (opcional)' });
    var clNotas = ui.textarea({ value: cl.notas || '', rows: 2, placeholder: 'Otros datos (opcional)' });

    var comision = comisionBlock(s.comision);

    var preview = el('div', { class: 'sale-preview' });
    function updatePreview() {
      var m = App.finance.vehicleMetrics(v);
      var sRate = store.num(fCotiz.value) || App.finance.currentRate();
      var ventaARS = precio.moneda.value === 'USD' ? store.num(precio.monto.value) * sRate : store.num(precio.monto.value);
      // en consignación no "compramos" el auto: lo que hay que descontar de la
      // venta es lo que le corresponde al dueño, no un costo de compra propio.
      var precioDuenoARS = esConsignacion && v.origin.precioDueno ? App.finance.toARS(v.origin.precioDueno, v.origin.monedaDueno || 'ARS', sRate) : 0;
      var costo = m.inversionARS + m.comisionCompraARS + precioDuenoARS + (store.num(comision.get() && comision.get().monto) || 0);
      var gan = ventaARS - costo;
      var rent = costo ? gan / costo * 100 : 0;
      ui.clear(preview);
      preview.appendChild(el('div', { class: 'sale-preview-row' }, [
        el('span', { text: esConsignacion ? 'Le corresponde al dueño + gastos + comisión' : 'Lo que pusiste (compra + gastos + comisión)' }), el('strong', { text: App.fmt.money(costo) })
      ]));
      preview.appendChild(el('div', { class: 'sale-preview-row' }, [
        el('span', { text: 'Ganancia estimada' }),
        el('strong', { class: gan >= 0 ? 'pos' : 'neg', text: App.fmt.money(gan) + '  (' + App.fmt.pct(rent) + ')' })
      ]));
    }
    [precio.monto, precio.moneda, fCotiz].forEach(function (i) { i.addEventListener('input', updatePreview); i.addEventListener('change', updatePreview); });

    var body = el('div', { class: 'form-grid' }, [
      el('div', { class: 'grid-2' }, [ui.field('Fecha de venta', fFecha), ui.field('Precio de venta', precio.wrap)]),
      cotizField,
      preview,
      el('div', { class: 'form-section-title', text: 'Forma de cobro' }),
      ui.field('', fForma),
      mixtoBox,
      finBox,
      el('div', { class: 'form-section-title', text: 'Vehículo recibido como parte de pago' }),
      el('label', { class: 'check-inline' }, [tiEnabled, el('span', { text: 'Se recibió otro vehículo como parte de pago' })]),
      tiBox,
      el('div', { class: 'form-section-title', text: 'Cliente (opcional)' }),
      el('div', { class: 'grid-2' }, [ui.field('Nombre', clNom), ui.field('Teléfono', clTel)]),
      ui.field('Otros datos', clNotas),
      el('div', { class: 'form-section-title', text: 'Comisión pagada a un tercero (opcional)' }),
      comision.wrap
    ]);

    var m = ui.modal({
      title: v.sale ? 'Editar venta' : 'Registrar venta',
      size: 'lg', body: body,
      footer: [
        el('button', { class: 'btn btn-ghost', text: 'Cancelar', onclick: function () { m.close(); } }),
        el('button', { class: 'btn btn-primary', text: 'Guardar venta', onclick: submit })
      ]
    });
    syncForma(); syncCotiz(); updatePreview(); checkMixto();

    var submitted = false;
    function submit() {
      if (submitted) return;
      if (store.num(precio.monto.value) <= 0) { ui.toast('Ingresá el precio de venta', 'error'); return; }
      if (precio.moneda.value === 'ARS' && store.num(fCotiz.value) <= 0) { ui.toast('Ingresá la cotización del dólar de la venta', 'error'); return; }
      if (!checkMixto()) { ui.toast('Los importes no coinciden con el total', 'error'); return; }
      var tradeIn = null;
      if (tiEnabled.checked && !ti.vehicleId) {
        if (!tiMarca.value.trim() || !tiModelo.value.trim()) { ui.toast('Completá marca y modelo del vehículo recibido', 'error'); return; }
        if (store.num(tiValor.monto.value) <= 0) { ui.toast('Ingresá el valor asignado al vehículo recibido', 'error'); return; }
        tradeIn = {
          enabled: true, marca: tiMarca.value, modelo: tiModelo.value, anio: tiAnio.value,
          patente: tiPat.value, km: tiKm.value, valor: tiValor.monto.value, moneda: tiValor.moneda.value,
          observaciones: tiObs.value
        };
      } else if (ti.vehicleId) {
        tradeIn = { enabled: true, vehicleId: ti.vehicleId, marca: ti.marca, modelo: ti.modelo, anio: ti.anio, patente: ti.patente, km: ti.km, valor: ti.valor, moneda: ti.moneda, observaciones: ti.observaciones };
      }
      var financiacion = null;
      if (fForma.value === 'financiado') {
        var fc = finCb.getCuotas();
        if (!fc.length) { ui.toast('Cargá las cuotas de la financiación', 'error'); return; }
        financiacion = {
          enabled: true, entidad: finEntidad.value, entrega: finEntrega.monto.value, moneda: finEntrega.moneda.value,
          notas: finNotas.value, cuotas: fc
        };
      }
      submitted = true;
      var data = {
        fecha: fFecha.value, precio: precio.monto.value, moneda: precio.moneda.value, cotizacionUSD: fCotiz.value,
        formaCobro: fForma.value, montoTransferencia: fTransf.value, montoEfectivo: fEfec.value,
        cliente: { nombre: clNom.value, telefono: clTel.value, notas: clNotas.value },
        tradeIn: tradeIn,
        financiacion: financiacion,
        comision: comision.get(),
        diferencia: (tiEnabled.checked && store.num(difMonto.monto.value) > 0) ? { monto: difMonto.monto.value, moneda: difMonto.moneda.value } : null
      };
      store.setSale(v.id, data);
      ui.toast('Venta registrada', 'success');
      m.close();
    }
    return m;
  }

  /* ============================ FORM RESERVA ========================== */
  function reservationForm(vehicleId) {
    var v = store.getVehicle(vehicleId);
    if (!v) return;
    var r = v.reservation || {};
    var isEdit = !!v.reservation;

    var fFecha = ui.input({ type: 'date', value: r.fecha || store.todayISO() });
    var sena = ui.money2('sena', r.monto || '', r.moneda || 'ARS');
    var fVence = ui.input({ type: 'date', value: r.vence || '' });
    var fClienteNom = ui.input({ value: (r.cliente && r.cliente.nombre) || '', placeholder: 'Nombre' });
    var fClienteTel = ui.input({ value: (r.cliente && r.cliente.telefono) || '', placeholder: 'Teléfono' });
    var fNotas = ui.textarea({ value: r.notas || '', rows: 2, placeholder: 'Cómo pagó la seña, qué falta, etc.' });

    var body = el('div', { class: 'form-grid' }, [
      el('div', { class: 'grid-2' }, [
        ui.field('Fecha de la reserva', fFecha),
        ui.field('Seña recibida', sena.wrap)
      ]),
      ui.field('Vence el (opcional)', fVence, 'La app te avisa cuando se acerque o pase esta fecha'),
      el('div', { class: 'form-section-title', text: 'Cliente' }),
      el('div', { class: 'grid-2' }, [ui.field('Nombre', fClienteNom), ui.field('Teléfono', fClienteTel)]),
      ui.field('Notas', fNotas)
    ]);

    var footer = [
      isEdit ? el('button', { class: 'btn btn-danger-ghost', text: 'Cancelar reserva', onclick: function () {
        m.close();
        ui.confirm({ title: 'Cancelar reserva', message: 'El auto vuelve a stock. ¿Seguro?', danger: true, confirmText: 'Cancelar reserva' })
          .then(function (ok) { if (ok) { store.cancelReservation(v.id); ui.toast('Reserva cancelada'); App.router.render(); } });
      } }) : null,
      el('button', { class: 'btn btn-ghost', text: 'Cerrar', onclick: function () { m.close(); } }),
      el('button', { class: 'btn btn-primary', text: isEdit ? 'Guardar' : 'Reservar', onclick: submit })
    ];
    var m = ui.modal({ title: isEdit ? 'Editar reserva' : 'Reservar vehículo', body: body, footer: footer });

    var submitted = false;
    function submit() {
      if (submitted) return;
      if (store.num(sena.monto.value) <= 0) { ui.toast('Ingresá el monto de la seña', 'error'); return; }
      submitted = true;
      store.setReservation(v.id, {
        fecha: fFecha.value, monto: sena.monto.value, moneda: sena.moneda.value, vence: fVence.value,
        cliente: { nombre: fClienteNom.value, telefono: fClienteTel.value },
        notas: fNotas.value
      });
      ui.toast(isEdit ? 'Reserva actualizada' : 'Vehículo reservado', 'success');
      m.close();
    }
    return m;
  }

  /* ========================= FORM GASTO (por auto) ==================== */
  function expenseForm(vehicleId, expense) {
    var v = store.getVehicle(vehicleId);
    if (!v) return;
    var e = expense || {};
    var monto = ui.money2('gasto', e.monto || '', e.moneda || 'ARS');
    var fFecha = ui.input({ type: 'date', value: e.fecha || store.todayISO() });
    var fCotiz = ui.moneyInput({ value: e.cotizacionUSD || '', placeholder: 'Cotización (si es en USD)' });
    var cotizField = ui.field('Cotización del dólar (opcional)', fCotiz, 'Si el gasto es en dólares y querés fijar una cotización distinta a la de la compra');
    var fObs = ui.textarea({ value: e.observacion || '', rows: 3, placeholder: 'Ej: 200 lucas en el vidrio delantero y cambio de aceite.' });
    function syncCotiz() { cotizField.hidden = monto.moneda.value !== 'USD'; }
    monto.moneda.addEventListener('change', syncCotiz);

    var body = el('div', { class: 'form-grid' }, [
      el('div', { class: 'grid-2' }, [ui.field('Monto', monto.wrap), ui.field('Fecha', fFecha)]),
      cotizField,
      ui.field('Observación', fObs)
    ]);
    var m = ui.modal({
      title: expense ? 'Editar gasto' : 'Agregar gasto',
      body: body,
      footer: [
        el('button', { class: 'btn btn-ghost', text: 'Cancelar', onclick: function () { m.close(); } }),
        el('button', { class: 'btn btn-primary', text: 'Guardar gasto', onclick: submit })
      ]
    });
    syncCotiz();
    var submitted = false;
    function submit() {
      if (submitted) return;
      if (store.num(monto.monto.value) <= 0) { ui.toast('Ingresá el monto del gasto', 'error'); return; }
      submitted = true;
      var data = { monto: monto.monto.value, moneda: monto.moneda.value, fecha: fFecha.value, cotizacionUSD: fCotiz.value, observacion: fObs.value };
      if (expense) store.updateExpense(v.id, e.id, data);
      else store.addExpense(v.id, data);
      ui.toast('Gasto guardado', 'success');
      m.close();
    }
    return m;
  }

  /* ==================== FORM GASTO DEL NEGOCIO (fijo) ================= */
  var GASTO_CATS = [
    ['alquiler', 'Alquiler del local'],
    ['sueldos', 'Sueldos'],
    ['seguros', 'Seguros / flota'],
    ['patentes', 'Patentes e impuestos'],
    ['servicios', 'Servicios (luz, internet…)'],
    ['publicidad', 'Publicidad'],
    ['otro', 'Otro']
  ];
  function fixedExpenseForm(fixed) {
    var f = fixed || {};
    var isEdit = !!fixed;

    var fConcepto = ui.input({ value: f.concepto || '', required: true, placeholder: 'Ej: Alquiler del local' });
    var fCat = ui.select(GASTO_CATS.map(function (c) { return opt(c[0], c[1]); }), f.categoria || 'otro');
    var monto = ui.money2('fijo', f.monto || '', f.moneda || 'ARS');
    var fCotiz = ui.moneyInput({ value: f.cotizacionUSD || '', placeholder: 'Cotización (si es en USD)' });
    var cotizField = ui.field('Cotización del dólar (opcional)', fCotiz);
    var fFrec = ui.select([opt('mensual', 'Todos los meses'), opt('unica', 'Una sola vez')], f.frecuencia || 'mensual');
    var fFecha = ui.input({ type: 'date', value: f.fecha || store.todayISO() });
    var fechaField = ui.field('Desde', fFecha);
    var fHasta = ui.input({ type: 'date', value: f.hasta || '' });
    var hastaField = ui.field('Hasta (opcional)', fHasta, 'Si el gasto dejó de correr, poné la fecha');
    var fNotas = ui.textarea({ value: f.notas || '', rows: 2, placeholder: 'Otros datos (opcional)' });

    function sync() {
      var mensual = fFrec.value === 'mensual';
      fechaField.querySelector('.field-label').textContent = mensual ? 'Desde' : 'Fecha del gasto';
      hastaField.hidden = !mensual;
      cotizField.hidden = monto.moneda.value !== 'USD';
    }
    fFrec.addEventListener('change', sync);
    monto.moneda.addEventListener('change', sync);

    var body = el('div', { class: 'form-grid' }, [
      ui.field('Concepto *', fConcepto),
      el('div', { class: 'grid-2' }, [ui.field('Categoría', fCat), ui.field('Monto', monto.wrap)]),
      cotizField,
      el('div', { class: 'grid-2' }, [ui.field('¿Cada cuánto?', fFrec), fechaField]),
      hastaField,
      ui.field('Notas', fNotas)
    ]);

    var footer = [
      isEdit ? el('button', { class: 'btn btn-danger-ghost', text: 'Eliminar', onclick: function () {
        m.close();
        ui.confirm({ title: 'Eliminar gasto', message: '¿Eliminar "' + (f.concepto || 'este gasto') + '"?', danger: true, confirmText: 'Eliminar' })
          .then(function (ok) { if (ok) { store.removeFixedExpense(f.id); ui.toast('Gasto eliminado'); } });
      } }) : null,
      el('button', { class: 'btn btn-ghost', text: 'Cancelar', onclick: function () { m.close(); } }),
      el('button', { class: 'btn btn-primary', text: isEdit ? 'Guardar' : 'Agregar', onclick: submit })
    ];
    var m = ui.modal({ title: isEdit ? 'Editar gasto del negocio' : 'Nuevo gasto del negocio', body: body, footer: footer });
    sync();

    var submitted = false;
    function submit() {
      if (submitted) return;
      if (!fConcepto.value.trim()) { ui.toast('Poné un concepto', 'error'); return; }
      if (store.num(monto.monto.value) <= 0) { ui.toast('Ingresá el monto', 'error'); return; }
      submitted = true;
      var data = {
        concepto: fConcepto.value, categoria: fCat.value, monto: monto.monto.value, moneda: monto.moneda.value,
        cotizacionUSD: fCotiz.value, frecuencia: fFrec.value, fecha: fFecha.value, hasta: fHasta.value, notas: fNotas.value
      };
      if (isEdit) { store.updateFixedExpense(f.id, data); ui.toast('Gasto actualizado', 'success'); }
      else { store.addFixedExpense(data); ui.toast('Gasto agregado', 'success'); }
      m.close();
    }
    return m;
  }

  /* ========================= FORM RECORDATORIO ======================= */
  var REM_TIPOS = [
    ['tarea', 'Tarea'],
    ['mantenimiento', 'Mantenimiento / Service'],
    ['tramite', 'Trámite / Documentación'],
    ['pago', 'Pago de cuota'],
    ['turno', 'Turno con cliente'],
    ['gestoria', 'Gestoría / Transferencia'],
    ['stock', 'Stock'],
    ['otro', 'Otro']
  ];
  var REM_REPEAT = [
    ['none', 'No repetir'],
    ['daily', 'Todos los días'],
    ['weekly', 'Todas las semanas'],
    ['monthly', 'Todos los meses'],
    ['yearly', 'Todos los años']
  ];

  function reminderForm(reminder, presetDate) {
    var isEdit = !!reminder;
    var r = reminder || {};

    var fTitulo = ui.input({ value: r.titulo || '', required: true, placeholder: 'Escribí acá...' });
    var fFecha = ui.input({ type: 'date', value: r.fecha || presetDate || store.todayISO() });
    var fHora = ui.input({ type: 'time', value: r.hora || '' });
    var fTipo = ui.select(REM_TIPOS.map(function (t) { return opt(t[0], t[1]); }), r.tipo || 'tarea');
    var fRepeat = ui.select(REM_REPEAT.map(function (t) { return opt(t[0], t[1]); }), r.repeat || 'none');
    var fNota = ui.textarea({ value: r.nota || '', rows: 3, placeholder: 'Detalle o nota (opcional)' });

    // Solo título y fecha son realmente necesarios para crear una alerta en
    // segundos; el resto (hora, tipo, repetir, nota) queda opcional detrás
    // de "Más opciones" — mismos campos y lógica de siempre, nada eliminado.
    var extra = el('div', { class: 'form-grid', hidden: true }, [
      el('div', { class: 'grid-2' }, [ui.field('Hora (opcional)', fHora), ui.field('Tipo', fTipo)]),
      ui.field('Repetir', fRepeat),
      ui.field('Descripción / nota (opcional)', fNota)
    ]);
    var hayOpcionalesCargados = !!(r.hora || (r.tipo && r.tipo !== 'tarea') || (r.repeat && r.repeat !== 'none') || r.nota);
    extra.hidden = !hayOpcionalesCargados;
    var toggleExtra = el('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: extra.hidden ? '＋ Más opciones' : '－ Menos opciones', onclick: function () {
      extra.hidden = !extra.hidden;
      toggleExtra.textContent = extra.hidden ? '＋ Más opciones' : '－ Menos opciones';
    } });

    var body = el('div', { class: 'form-grid' }, [
      ui.field('¿Qué tenés que recordar?', fTitulo),
      ui.field('¿Cuándo?', fFecha),
      toggleExtra,
      extra
    ]);

    var footer = [
      isEdit ? el('button', { class: 'btn btn-danger-ghost', text: 'Eliminar', onclick: function () {
        m.close();
        ui.confirm({ title: 'Eliminar alerta', message: '¿Eliminar "' + (r.titulo || 'esta alerta') + '"?', danger: true, confirmText: 'Eliminar' })
          .then(function (ok) { if (ok) { store.removeReminder(r.id); ui.toast('Alerta eliminada'); } });
      } }) : null,
      el('button', { class: 'btn btn-ghost', text: 'Cancelar', onclick: function () { m.close(); } }),
      el('button', { class: 'btn btn-primary', html: isEdit ? 'Guardar' : '<span>🔔</span> Crear alerta', onclick: submit })
    ];

    var m = ui.modal({ title: isEdit ? 'Editar alerta' : 'Nueva alerta', body: body, footer: footer });

    var submitted = false;
    function submit() {
      if (submitted) return;
      if (!fTitulo.value.trim()) { ui.toast('El título es obligatorio', 'error'); return; }
      if (!fFecha.value) { ui.toast('La fecha es obligatoria', 'error'); return; }
      submitted = true;
      var data = { titulo: fTitulo.value, fecha: fFecha.value, hora: fHora.value, tipo: fTipo.value, nota: fNota.value, repeat: fRepeat.value };
      if (isEdit) { store.updateReminder(r.id, data); ui.toast('Alerta actualizada', 'success'); }
      else { store.addReminder(data); ui.toast('Alerta creada', 'success'); }
      m.close();
    }
    return m;
  }

  window.App = window.App || {};
  App.forms = {
    vehicleFormView: vehicleFormView, purchaseForm: purchaseForm, saleForm: saleForm, expenseForm: expenseForm,
    reservationForm: reservationForm, fixedExpenseForm: fixedExpenseForm,
    reminderForm: reminderForm, CHECKLIST_ITEMS: CHECKLIST_ITEMS,
    REM_TIPOS: REM_TIPOS, REM_REPEAT: REM_REPEAT, GASTO_CATS: GASTO_CATS
  };
})();
