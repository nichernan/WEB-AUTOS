/* ============================================================================
 * excel.js  —  Exporta TODO el negocio a un archivo Excel colorido y ordenado
 * ----------------------------------------------------------------------------
 *  - App.excel.download()  -> descarga el .xlsx completo
 *  - App.excel.blob()      -> Blob del .xlsx (para guardado automático)
 *  - Guardado automático (Chrome / Edge): elegís un archivo una vez y la app
 *    lo vuelve a escribir sola con cada cambio.
 * ==========================================================================*/
(function () {
  'use strict';
  var store = App.store, fin = App.finance, fmt = App.fmt;

  /* ------------------------------ helpers ------------------------------- */
  function n(x) { var v = Math.round(+x); return isFinite(v) ? v : 0; }
  function estadoStyle(text) {
    var t = String(text || '').toLowerCase();
    if (/vendid|pagad|complet|al día/.test(t)) return 'ok';
    if (/vencid/.test(t)) return 'danger';
    if (/pendient|hoy|reservad|transferencia/.test(t)) return 'warn';
    if (/papelera|eliminad/.test(t)) return 'trash';
    return 'stock';
  }
  function reminderEstado(r, hoy) {
    var done = (r.doneDates || []).length > 0;
    if ((!r.repeat || r.repeat === 'none')) {
      if ((r.doneDates || []).indexOf(r.fecha) >= 0) return 'Completado';
      if (r.fecha < hoy) return 'Vencido';
      if (r.fecha === hoy) return 'Para hoy';
      return 'Pendiente';
    }
    return done ? 'Se repite (con completadas)' : 'Se repite';
  }
  function lastDone(r) {
    var d = (r.doneDates || []).slice().sort();
    return d.length ? d[d.length - 1] : '';
  }
  var REP = { none: 'No repite', daily: 'Todos los días', weekly: 'Todas las semanas', monthly: 'Todos los meses', yearly: 'Todos los años' };
  var REMT = { tarea: 'Tarea', mantenimiento: 'Mantenimiento', tramite: 'Trámite', pago: 'Pago de cuota', turno: 'Turno con cliente', gestoria: 'Gestoría', stock: 'Stock', otro: 'Otro' };

  /* --------------------------- armado del libro ------------------------ */
  function build() {
    var wb = App.xlsx.create();
    var hoy = store.todayISO();

    // estilos con nombre
    wb.define('title', { bold: true, size: 16, color: '1D4ED8' });
    wb.define('sub', { color: '64748B', size: 10 });
    wb.define('sec', { bold: true, color: 'FFFFFF', fill: '475569', border: true });
    wb.define('k', { bold: true, border: true, fill: 'EEF2F7' });
    wb.define('cell', { border: true });
    wb.define('center', { border: true, align: 'center' });
    wb.define('date', { border: true, align: 'center' });
    wb.define('money', { border: true, numFmt: 'money', align: 'right' });
    wb.define('pct', { border: true, numFmt: 'pct', align: 'right' });
    wb.define('pos', { border: true, numFmt: 'money', align: 'right', bold: true, color: '15803D' });
    wb.define('neg', { border: true, numFmt: 'money', align: 'right', bold: true, color: 'B91C1C' });
    wb.define('ok', { border: true, align: 'center', bold: true, color: '166534', fill: 'DCFCE7' });
    wb.define('warn', { border: true, align: 'center', bold: true, color: '92400E', fill: 'FEF3C7' });
    wb.define('danger', { border: true, align: 'center', bold: true, color: '991B1B', fill: 'FEE2E2' });
    wb.define('stock', { border: true, align: 'center', bold: true, color: '1E40AF', fill: 'DBEAFE' });
    wb.define('trash', { border: true, align: 'center', color: '64748B', fill: 'F1F5F9' });

    function head(color) { return { bold: true, color: 'FFFFFF', fill: color, border: true, align: 'center', valign: 'center', wrap: true }; }
    function ganStyle(v) { return v >= 0 ? 'pos' : 'neg'; }
    // zebra: agrega fondo suave en filas impares
    function z(styleName, alt) {
      if (!alt) return styleName;
      var s = wb.named[styleName] || {};
      if (s.fill) return styleName;
      return Object.assign({}, s, { fill: 'F8FAFC' });
    }

    var vehicles = store.getState().vehicles.slice();

    /* ===================== 1) RESUMEN ===================== */
    (function () {
      var g = fin.globalMetrics();
      var s = wb.sheet('Resumen', { cols: [36, 22] });
      s.row(['PaginaToto — Todo tu negocio'], 'title');
      s.row(['Actualizado: ' + fmt.datetime(Date.now())], 'sub');
      s.blank();
      function sec(t) { s.row([{ v: t, s: 'sec' }, { v: '', s: 'sec' }]); }
      function kv(k, v, st) { s.row([{ v: k, s: 'k' }, { v: v, s: st || 'cell' }]); }

      sec('STOCK');
      kv('Autos en stock', g.autosEnStock, 'center');
      kv('Capital invertido (pesos)', n(g.capitalInvertido), 'money');
      kv('Valor estimado del stock (pesos)', n(g.valorEstimadoStock), 'money');
      s.blank();
      sec('OPERACIONES');
      kv('Autos vendidos', g.autosVendidos, 'center');
      kv('Ventas acumuladas (pesos)', n(g.ventasTotal), 'money');
      kv('Compras acumuladas (pesos)', n(g.comprasTotal), 'money');
      s.blank();
      sec('RESULTADO');
      kv('Ganancia por autos vendidos (pesos)', n(g.gananciaTotal), ganStyle(g.gananciaTotal));
      kv('(−) Gastos fijos del negocio (pesos)', n(g.gastosFijosTotales), 'money');
      kv('(=) RESULTADO DEL NEGOCIO (pesos)', n(g.resultadoNegocio), ganStyle(g.resultadoNegocio));
      kv('Ganancia en USD', n(g.gananciaTotalUSD), ganStyle(g.gananciaTotalUSD));
      kv('Ganancia promedio por auto (pesos)', n(g.gananciaPromedio), 'money');
      kv('Resultado de este mes (pesos)', n(g.resultadoNetoDelMes), ganStyle(g.resultadoNetoDelMes));
      s.blank();
      sec('CUOTAS');
      kv('Te tienen que pagar (pesos)', n(g.porCobrar), g.porCobrarVencido ? 'neg' : 'money');
      kv('Tenés que pagar (pesos)', n(g.porPagarCuotas), g.porPagarVencido ? 'neg' : 'money');
      s.blank();
      sec('GASTOS');
      kv('Gastos puestos en autos (pesos)', n(g.gastosTotales), 'money');
      kv('Comisiones pagadas (pesos)', n(g.comisionesTotal), 'money');
      s.blank();
      sec('DÓLAR');
      kv('Cotización actual', n(store.getState().settings.dolarActual), 'money');
    })();

    /* ===================== 2) AUTOS ===================== */
    (function () {
      var s = wb.sheet('Autos', { freeze: 1, cols: [16, 16, 7, 11, 9, 12, 12, 16, 11, 14, 14, 12, 15, 8, 11, 15, 13, 15, 12, 15, 8, 11, 16, 11, 9, 10, 40] });
      var H = head('1D4ED8');
      s.row(['Marca', 'Modelo', 'Año', 'Patente', 'Km', 'Combustible', 'Caja', 'Versión', 'Estado', 'Documentación', 'Origen',
        'Compra: fecha', 'Compra: precio', 'Moneda', 'Dólar compra', 'Gastos (pesos)', 'Comisión (pesos)', 'Lo que puse (pesos)',
        'Venta: fecha', 'Venta: precio', 'Moneda', 'Dólar venta', 'Ganancia (pesos)', 'Rentab. %', 'Días en stock', 'Ubicación', 'Observaciones'].map(function (t) { return { v: t, s: H }; }));
      vehicles.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).forEach(function (v, i) {
        var alt = i % 2 === 1;
        var m = fin.vehicleMetrics(v);
        var p = v.purchase, sa = v.sale;
        var origen = v.origin && v.origin.type === 'parte-de-pago' ? 'Parte de pago' : 'Compra';
        var estadoTxt = store.estadoLabel(v.estado);
        s.row([
          { v: v.marca, s: z('cell', alt) }, { v: v.modelo, s: z('cell', alt) },
          { v: v.anio || '', s: z('center', alt) }, { v: v.patente, s: z('center', alt) },
          { v: v.km != null ? n(v.km) : '', s: z('cell', alt) }, { v: v.combustible, s: z('cell', alt) },
          { v: v.caja === 'automatica' ? 'Automática' : (v.caja === 'manual' ? 'Manual' : ''), s: z('cell', alt) },
          { v: v.version, s: z('cell', alt) },
          { v: estadoTxt, s: estadoStyle(estadoTxt) },
          { v: v.documentacion, s: z('cell', alt) }, { v: origen, s: z('cell', alt) },
          { v: p ? fmt.date(p.fecha) : '', s: z('date', alt) },
          { v: p ? n(p.precio) : '', s: z('money', alt) }, { v: p ? p.moneda : '', s: z('center', alt) },
          { v: p && p.cotizacionUSD ? n(p.cotizacionUSD) : '', s: z('money', alt) },
          { v: n(m.gastosARS), s: z('money', alt) },
          { v: m.comisionARS ? n(m.comisionARS) : '', s: z('money', alt) },
          { v: n(m.costoTotalARS), s: z('money', alt) },
          { v: sa ? fmt.date(sa.fecha) : '', s: z('date', alt) },
          { v: sa ? n(sa.precio) : '', s: z('money', alt) }, { v: sa ? sa.moneda : '', s: z('center', alt) },
          { v: sa && sa.cotizacionUSD ? n(sa.cotizacionUSD) : '', s: z('money', alt) },
          { v: m.vendido ? n(m.gananciaARS) : '', s: m.vendido ? ganStyle(m.gananciaARS) : z('cell', alt) },
          { v: m.vendido ? +m.rentabilidad.toFixed(1) : '', s: z('pct', alt) },
          { v: m.diasEnStock != null ? m.diasEnStock : '', s: z('center', alt) },
          { v: v.deleted ? 'Papelera' : 'Activo', s: v.deleted ? 'trash' : z('center', alt) },
          { v: v.observaciones, s: z('cell', alt) }
        ]);
      });
      if (vehicles.length === 0) s.row([{ v: 'Todavía no cargaste autos.', s: 'cell' }]);
    })();

    /* ===================== 3) COMPRAS ===================== */
    (function () {
      var s = wb.sheet('Compras', { freeze: 1, cols: [22, 13, 15, 8, 12, 16, 24, 15, 15, 10, 13, 16, 20, 15, 30] });
      var H = head('0F766E');
      s.row(['Auto', 'Fecha', 'Precio', 'Moneda', 'Dólar', 'Precio en pesos', 'Forma de pago', 'Por transferencia', 'En efectivo',
        'Cuotas', 'Cuotas pagadas', 'Total en cuotas (pesos)', 'Proveedor / vendedor', 'Teléfono', 'Notas'].map(function (t) { return { v: t, s: H }; }));
      var rows = vehicles.filter(function (v) { return v.purchase; })
        .sort(function (a, b) { return (b.purchase.fecha || '').localeCompare(a.purchase.fecha || ''); });
      rows.forEach(function (v, i) {
        var alt = i % 2 === 1, p = v.purchase, m = fin.vehicleMetrics(v);
        s.row([
          { v: store.vehicleName(v), s: z('cell', alt) }, { v: fmt.date(p.fecha), s: z('date', alt) },
          { v: n(p.precio), s: z('money', alt) }, { v: p.moneda, s: z('center', alt) },
          { v: p.cotizacionUSD ? n(p.cotizacionUSD) : '', s: z('money', alt) },
          { v: n(m.compraARS), s: z('money', alt) },
          { v: store.formaPagoLabel(p.formaPago), s: z('cell', alt) },
          { v: p.montoTransferencia ? n(p.montoTransferencia) : '', s: z('money', alt) },
          { v: p.montoEfectivo ? n(p.montoEfectivo) : '', s: z('money', alt) },
          { v: p.formaPago === 'cuotas' ? (p.cuotas || []).length : '', s: z('center', alt) },
          { v: p.formaPago === 'cuotas' ? m.cuotasPagadasCount : '', s: z('center', alt) },
          { v: p.formaPago === 'cuotas' ? n(m.cuotasTotalARS) : '', s: z('money', alt) },
          { v: p.proveedor ? p.proveedor.nombre : '', s: z('cell', alt) },
          { v: p.proveedor ? p.proveedor.telefono : '', s: z('cell', alt) },
          { v: p.proveedor ? p.proveedor.notas : '', s: z('cell', alt) }
        ]);
      });
      if (!rows.length) s.row([{ v: 'Sin compras registradas.', s: 'cell' }]);
    })();

    /* ===================== 4) VENTAS ===================== */
    (function () {
      var s = wb.sheet('Ventas', { freeze: 1, cols: [22, 13, 15, 8, 12, 16, 22, 20, 15, 22, 15, 16, 16, 11] });
      var H = head('15803D');
      s.row(['Auto', 'Fecha', 'Precio', 'Moneda', 'Dólar', 'Precio en pesos', 'Forma de cobro', 'Cliente', 'Teléfono',
        'Vehículo recibido', 'Valor recibido', 'Diferencia recibida', 'Ganancia (pesos)', 'Rentab. %'].map(function (t) { return { v: t, s: H }; }));
      var rows = vehicles.filter(function (v) { return v.sale; })
        .sort(function (a, b) { return (b.sale.fecha || '').localeCompare(a.sale.fecha || ''); });
      rows.forEach(function (v, i) {
        var alt = i % 2 === 1, sa = v.sale, m = fin.vehicleMetrics(v), ti = sa.tradeIn;
        s.row([
          { v: store.vehicleName(v), s: z('cell', alt) }, { v: fmt.date(sa.fecha), s: z('date', alt) },
          { v: n(sa.precio), s: z('money', alt) }, { v: sa.moneda, s: z('center', alt) },
          { v: sa.cotizacionUSD ? n(sa.cotizacionUSD) : '', s: z('money', alt) },
          { v: n(m.ventaARS), s: z('money', alt) },
          { v: store.formaCobroLabel(sa.formaCobro), s: z('cell', alt) },
          { v: sa.cliente ? sa.cliente.nombre : '', s: z('cell', alt) },
          { v: sa.cliente ? sa.cliente.telefono : '', s: z('cell', alt) },
          { v: ti ? [ti.marca, ti.modelo, ti.anio].filter(Boolean).join(' ') : '', s: z('cell', alt) },
          { v: ti ? n(ti.valor) : '', s: z('money', alt) },
          { v: sa.diferencia ? n(sa.diferencia.monto) : '', s: z('money', alt) },
          { v: n(m.gananciaARS), s: ganStyle(m.gananciaARS) },
          { v: +m.rentabilidad.toFixed(1), s: z('pct', alt) }
        ]);
      });
      if (!rows.length) s.row([{ v: 'Sin ventas registradas.', s: 'cell' }]);
    })();

    /* ===================== 5) GASTOS ===================== */
    (function () {
      var s = wb.sheet('Gastos', { freeze: 1, cols: [22, 13, 14, 8, 16, 13, 44] });
      var H = head('B45309');
      s.row(['Auto', 'Fecha', 'Monto', 'Moneda', 'En pesos', 'Cotización usada', 'Observación'].map(function (t) { return { v: t, s: H }; }));
      var list = [];
      vehicles.forEach(function (v) {
        (v.expenses || []).forEach(function (e) {
          var rate = e.cotizacionUSD || fin.purchaseRate(v);
          list.push({ v: v, e: e, ars: fin.toARS(e.monto, e.moneda, rate), rate: rate });
        });
      });
      list.sort(function (a, b) { return (b.e.fecha || '').localeCompare(a.e.fecha || ''); });
      list.forEach(function (x, i) {
        var alt = i % 2 === 1;
        s.row([
          { v: store.vehicleName(x.v), s: z('cell', alt) }, { v: fmt.date(x.e.fecha), s: z('date', alt) },
          { v: n(x.e.monto), s: z('money', alt) }, { v: x.e.moneda, s: z('center', alt) },
          { v: n(x.ars), s: z('money', alt) },
          { v: x.e.moneda === 'USD' ? n(x.rate) : '', s: z('money', alt) },
          { v: x.e.observacion, s: z('cell', alt) }
        ]);
      });
      if (!list.length) s.row([{ v: 'Sin gastos registrados.', s: 'cell' }]);
    })();

    /* ============ 6) CUOTAS A PAGAR / 6b) CUOTAS A COBRAR ============ */
    (function () {
      var inst = fin.allInstallments();
      function sheet(name, list, color, doneWord) {
        var s = wb.sheet(name, { freeze: 1, cols: [24, 10, 14, 8, 13, 13, 13] });
        var H = head(color);
        s.row(['Auto', 'Cuota N°', 'Monto', 'Moneda', 'Vencimiento', 'Estado', doneWord].map(function (t) { return { v: t, s: H }; }));
        list.forEach(function (it, i) {
          var alt = i % 2 === 1, c = it.cuota;
          var estado = it.estado.charAt(0).toUpperCase() + it.estado.slice(1);
          s.row([
            { v: store.vehicleName(it.vehicle), s: z('cell', alt) }, { v: c.numero, s: z('center', alt) },
            { v: n(c.monto), s: z('money', alt) }, { v: it.moneda, s: z('center', alt) },
            { v: fmt.date(it.vencimiento), s: z('date', alt) },
            { v: estado, s: estadoStyle(estado) },
            { v: (c.fechaPago || c.fechaCobro) ? fmt.date(c.fechaPago || c.fechaCobro) : '', s: z('date', alt) }
          ]);
        });
        if (!list.length) s.row([{ v: 'Nada por acá.', s: 'cell' }]);
      }
      sheet('Cuotas a pagar', inst.pagar, '7C3AED', 'Pagada el');
      sheet('Cuotas a cobrar', inst.cobrar, '15803D', 'Cobrada el');
    })();

    /* ===================== 6c) RESERVAS ===================== */
    (function () {
      var s = wb.sheet('Reservas', { freeze: 1, cols: [24, 13, 16, 13, 22, 15, 40] });
      var H = head('B45309');
      s.row(['Auto', 'Fecha', 'Seña', 'Vence', 'Cliente', 'Teléfono', 'Notas'].map(function (t) { return { v: t, s: H }; }));
      var any = false;
      vehicles.forEach(function (v, i) {
        if (!v.reservation) return;
        any = true;
        var r = v.reservation, alt = i % 2 === 1;
        s.row([
          { v: store.vehicleName(v), s: z('cell', alt) }, { v: fmt.date(r.fecha), s: z('date', alt) },
          { v: n(r.monto), s: z('money', alt) },
          { v: r.vence ? fmt.date(r.vence) : '', s: r.vence && r.vence < hoy ? 'danger' : z('date', alt) },
          { v: r.cliente ? r.cliente.nombre : '', s: z('cell', alt) },
          { v: r.cliente ? r.cliente.telefono : '', s: z('cell', alt) },
          { v: r.notas, s: z('cell', alt) }
        ]);
      });
      if (!any) s.row([{ v: 'Sin reservas activas.', s: 'cell' }]);
    })();

    /* ================= 6d) GASTOS DEL NEGOCIO ================= */
    (function () {
      var s = wb.sheet('Gastos del negocio', { freeze: 1, cols: [26, 18, 14, 8, 15, 13, 13, 30] });
      var H = head('475569');
      s.row(['Concepto', 'Categoría', 'Monto', 'Moneda', 'Cada cuánto', 'Desde', 'Hasta', 'Notas'].map(function (t) { return { v: t, s: H }; }));
      var list = store.getFixedExpenses();
      list.slice().sort(function (a, b) { return (b.fecha || '').localeCompare(a.fecha || ''); }).forEach(function (f, i) {
        var alt = i % 2 === 1;
        s.row([
          { v: f.concepto, s: z('cell', alt) }, { v: store.categoriaLabel(f.categoria), s: z('cell', alt) },
          { v: n(f.monto), s: z('money', alt) }, { v: f.moneda, s: z('center', alt) },
          { v: f.frecuencia === 'mensual' ? 'Todos los meses' : 'Una vez', s: z('center', alt) },
          { v: fmt.date(f.fecha), s: z('date', alt) }, { v: f.hasta ? fmt.date(f.hasta) : '', s: z('date', alt) },
          { v: f.notas, s: z('cell', alt) }
        ]);
      });
      if (!list.length) s.row([{ v: 'Sin gastos del negocio cargados.', s: 'cell' }]);
    })();

    /* ===================== 7) RECORDATORIOS ===================== */
    (function () {
      var s = wb.sheet('Recordatorios', { freeze: 1, cols: [34, 13, 8, 16, 20, 13, 13, 40] });
      var H = head('0891B2');
      s.row(['Título', 'Fecha', 'Hora', 'Tipo', 'Repetición', 'Estado', 'Completado el', 'Nota'].map(function (t) { return { v: t, s: H }; }));
      var rems = store.getReminders().slice().sort(function (a, b) { return (a.fecha || '').localeCompare(b.fecha || ''); });
      rems.forEach(function (r, i) {
        var alt = i % 2 === 1;
        var estado = reminderEstado(r, hoy);
        s.row([
          { v: r.titulo, s: z('cell', alt) }, { v: fmt.date(r.fecha), s: z('date', alt) },
          { v: r.hora || '', s: z('center', alt) }, { v: REMT[r.tipo] || r.tipo, s: z('cell', alt) },
          { v: REP[r.repeat] || 'No repite', s: z('cell', alt) },
          { v: estado, s: estadoStyle(estado) },
          { v: lastDone(r) ? fmt.date(lastDone(r)) : '', s: z('date', alt) },
          { v: r.nota, s: z('cell', alt) }
        ]);
      });
      if (!rems.length) s.row([{ v: 'Sin recordatorios.', s: 'cell' }]);
    })();

    /* ===================== 8) MOVIMIENTOS (historial) ===================== */
    (function () {
      var s = wb.sheet('Movimientos', { freeze: 1, cols: [13, 18, 14, 22, 40, 46, 15, 8] });
      var H = head('475569');
      s.row(['Fecha', 'Registrado', 'Tipo', 'Vehículo', 'Qué pasó', 'Detalle', 'Monto', 'Moneda'].map(function (t) { return { v: t, s: H }; }));
      var TIPO = { compra: 'Compra', venta: 'Venta', gasto: 'Gasto', cuota: 'Cuota', estado: 'Cambio de estado', edicion: 'Edición', 'parte-pago': 'Parte de pago', papelera: 'Papelera', restaurar: 'Restaurado', otro: 'Otro' };
      store.getHistory().forEach(function (e, i) {
        var alt = i % 2 === 1;
        var v = e.vehicleId ? store.getVehicle(e.vehicleId) : null;
        s.row([
          { v: fmt.date(e.fecha), s: z('date', alt) },
          { v: fmt.datetime(e.ts), s: z('center', alt) },
          { v: TIPO[e.tipo] || e.tipo, s: z('cell', alt) },
          { v: v ? store.vehicleName(v) : '', s: z('cell', alt) },
          { v: e.titulo, s: z('cell', alt) },
          { v: e.detalle, s: z('cell', alt) },
          { v: e.monto != null ? n(e.monto) : '', s: z('money', alt) },
          { v: e.moneda || '', s: z('center', alt) }
        ]);
      });
      if (!store.getHistory().length) s.row([{ v: 'Sin movimientos todavía.', s: 'cell' }]);
    })();

    /* ===================== 9) RESUMEN MENSUAL ===================== */
    (function () {
      var s = wb.sheet('Resumen mensual', { freeze: 1, cols: [12, 9, 9, 16, 15, 16, 16, 16] });
      var H = head('1D4ED8');
      s.row(['Mes', 'Compras', 'Ventas', 'Ganancias', 'Gastos autos', 'Gastos negocio', 'Resultado neto', 'Acumulado'].map(function (t) { return { v: t, s: H }; }));
      fin.monthlySeries(12).forEach(function (mo, i) {
        var alt = i % 2 === 1;
        s.row([
          { v: mo.label, s: z('cell', alt) }, { v: mo.compras, s: z('center', alt) }, { v: mo.ventas, s: z('center', alt) },
          { v: n(mo.ganancias), s: mo.ganancias >= 0 ? 'pos' : 'neg' },
          { v: n(mo.gastos), s: z('money', alt) }, { v: n(mo.gastosFijos || 0), s: z('money', alt) },
          { v: n(mo.resultadoNeto), s: mo.resultadoNeto >= 0 ? 'pos' : 'neg' },
          { v: n(mo.acumulado), s: mo.acumulado >= 0 ? 'pos' : 'neg' }
        ]);
      });
    })();

    /* ===================== 10) RESUMEN ANUAL ===================== */
    (function () {
      var s = wb.sheet('Resumen anual', { freeze: 1, cols: [10, 16, 16, 16, 16] });
      var H = head('1D4ED8');
      s.row(['Año', 'Ganancias', 'Gastos autos', 'Gastos negocio', 'Resultado neto'].map(function (t) { return { v: t, s: H }; }));
      var y0 = new Date().getFullYear();
      for (var y = y0, i = 0; y >= y0 - 4; y--, i++) {
        var alt = i % 2 === 1;
        var r = fin.periodResult(fin.yearRange(new Date(y, 0, 1)));
        s.row([
          { v: y, s: z('center', alt) },
          { v: n(r.ganancias), s: r.ganancias >= 0 ? 'pos' : 'neg' },
          { v: n(r.gastos), s: z('money', alt) }, { v: n(r.gastosFijos), s: z('money', alt) },
          { v: n(r.resultadoNeto), s: r.resultadoNeto >= 0 ? 'pos' : 'neg' }
        ]);
      }
    })();

    return wb;
  }

  function filename() { return 'PaginaToto ' + store.todayISO() + '.xlsx'; }
  function blob() { return build().blob(); }
  function download() {
    try {
      build().download(filename());
      try { store.markBackup(); } catch (e) {}
      App.ui && App.ui.toast('Excel descargado', 'success');
      try { App.router && App.router.render(); } catch (e) {}
    } catch (e) {
      console.error('excel', e);
      App.ui && App.ui.toast('No se pudo generar el Excel', 'error');
    }
  }

  /* ===================== Guardado automático en un archivo ============= */
  var handle = null;          // FileSystemFileHandle
  var needsReconnect = false; // el permiso caducó tras recargar
  var lastSaved = null;
  var writing = false;
  var timer = null;

  function supported() {
    try { return typeof window.showSaveFilePicker === 'function'; } catch (e) { return false; }
  }
  // preferencia por dispositivo (no se comparte entre usuarios): localStorage
  function prefOn() { try { return localStorage.getItem('paginaToto:excelAutosave') === '1'; } catch (e) { return false; } }
  function setPref(v) { try { localStorage.setItem('paginaToto:excelAutosave', v ? '1' : '0'); } catch (e) {} }

  function idb(mode, val) {
    return new Promise(function (res, rej) {
      var open;
      try { open = indexedDB.open('paginaToto-fs', 1); } catch (e) { return rej(e); }
      open.onupgradeneeded = function () { try { open.result.createObjectStore('h'); } catch (e) {} };
      open.onerror = function () { rej(open.error); };
      open.onsuccess = function () {
        try {
          var db = open.result;
          var tx = db.transaction('h', mode === 'get' ? 'readonly' : 'readwrite');
          var st = tx.objectStore('h');
          var rq = mode === 'get' ? st.get('excel') : (mode === 'put' ? st.put(val, 'excel') : st.delete('excel'));
          rq.onsuccess = function () { res(rq.result); };
          rq.onerror = function () { rej(rq.error); };
        } catch (e) { rej(e); }
      };
    });
  }

  function ensurePerm(interactive) {
    if (!handle) return Promise.resolve(false);
    if (!handle.queryPermission) return Promise.resolve(true);
    var opts = { mode: 'readwrite' };
    return handle.queryPermission(opts).then(function (p) {
      if (p === 'granted') return true;
      if (interactive && handle.requestPermission) return handle.requestPermission(opts).then(function (r) { return r === 'granted'; });
      return false;
    });
  }

  function writeNow() {
    if (!handle || writing) return Promise.resolve();
    writing = true;
    return ensurePerm(false).then(function (ok) {
      if (!ok) { needsReconnect = true; refresh(); return; }
      var b;
      try { b = blob(); } catch (e) { console.error('excel build', e); return; }
      return handle.createWritable().then(function (w) {
        return w.write(b).then(function () { return w.close(); });
      }).then(function () {
        lastSaved = new Date(); needsReconnect = false;
        try { store.markBackup(); } catch (e) {}
        refresh();
      });
    }).catch(function (e) { console.error('excel autosave', e); needsReconnect = true; refresh(); })
      .then(function () { writing = false; });
  }

  function schedule() {
    if (!handle || needsReconnect || !prefOn()) return;
    clearTimeout(timer);
    timer = setTimeout(writeNow, 1500);
  }

  function pickFile() {
    if (!supported()) { App.ui.toast('Tu navegador no permite esto. Usá Chrome o Edge, o el botón de descarga.', 'error'); return; }
    return window.showSaveFilePicker({
      suggestedName: 'PaginaToto.xlsx',
      types: [{ description: 'Libro de Excel', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }]
    }).then(function (h) {
      handle = h; needsReconnect = false;
      return idb('put', h).catch(function () {}).then(function () {
        setPref(true);
        return writeNow();
      }).then(function () {
        App.ui.toast('Listo. El Excel se va a actualizar solo con cada cambio.', 'success');
        refresh();
      });
    }).catch(function (e) {
      if (e && (e.name === 'AbortError' || e.name === 'SecurityError')) return; // el usuario canceló
      console.error(e); App.ui.toast('No se pudo elegir el archivo', 'error');
    });
  }

  function reconnect() {
    if (!handle) { return pickFile(); }
    return ensurePerm(true).then(function (ok) {
      if (ok) { needsReconnect = false; refresh(); return writeNow(); }
      App.ui.toast('No se pudo reconectar el archivo', 'error');
    });
  }

  function disable() {
    setPref(false);
    handle = null; needsReconnect = false;
    idb('del').catch(function () {});
    refresh();
  }

  function initAutosave() {
    if (!supported() || !prefOn()) return;
    idb('get').then(function (h) {
      if (!h) { setPref(false); return; }
      handle = h;
      return ensurePerm(false).then(function (ok) { needsReconnect = !ok; refresh(); });
    }).catch(function () {});
  }

  function status() {
    return {
      supported: supported(),
      on: prefOn() && !!handle,
      needsReconnect: needsReconnect,
      lastSaved: lastSaved,
      name: handle ? handle.name : null
    };
  }

  var lastKey = '';
  function refresh() {
    // sólo re-renderiza Ajustes cuando cambia algo visible (evita robar el foco al escribir)
    var key = (prefOn() ? '1' : '0') + (handle ? '1' : '0') + (needsReconnect ? '1' : '0');
    if (key === lastKey) return;
    lastKey = key;
    try {
      if (App.router && App.router.currentPath && App.router.currentPath().name === 'ajustes') App.router.render();
    } catch (e) {}
  }

  // re-escribe el archivo con cada cambio del estado
  store.subscribe(schedule);

  window.App = window.App || {};
  App.excel = {
    build: build, blob: blob, download: download, filename: filename,
    pickFile: pickFile, reconnect: reconnect, disable: disable,
    initAutosave: initAutosave, status: status, supported: supported
  };
})();
