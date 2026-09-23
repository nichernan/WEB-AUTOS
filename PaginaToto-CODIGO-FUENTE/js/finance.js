/* ============================================================================
 * finance.js  —  Cálculos financieros, métricas, resúmenes y estadísticas
 * ----------------------------------------------------------------------------
 * Regla de normalización de monedas:
 *   - Cada operación (compra / venta / gasto) guarda su propia cotización
 *     histórica del dólar. Esa cotización NUNCA se recalcula.
 *   - Para expresar montos en una moneda común usamos la cotización propia de
 *     la operación; si no existe, se usa la cotización actual (settings.dolarActual)
 *     sólo como último recurso.
 *   - Todos los totales del sistema se muestran en PESOS (ARS) y, cuando aporta
 *     valor, también en USD.
 * ==========================================================================*/
(function () {
  'use strict';

  function S() { return App.store.getState(); }
  function currentRate() { return S().settings.dolarActual || 1; }

  function toARS(monto, moneda, rate) {
    monto = +monto || 0;
    if (moneda === 'USD') return monto * (rate || currentRate());
    return monto;
  }
  function toUSD(monto, moneda, rate) {
    monto = +monto || 0;
    if (moneda === 'USD') return monto;
    return monto / (rate || currentRate());
  }

  function purchaseRate(v) {
    if (v.purchase && v.purchase.cotizacionUSD) return v.purchase.cotizacionUSD;
    return currentRate();
  }
  function saleRate(v) {
    if (v.sale && v.sale.cotizacionUSD) return v.sale.cotizacionUSD;
    return currentRate();
  }

  /* --------------------------- Métricas por vehículo -------------------- */
  function vehicleMetrics(v) {
    var pRate = purchaseRate(v);
    var sRate = saleRate(v);

    var compraARS = v.purchase ? toARS(v.purchase.precio, v.purchase.moneda, pRate) : 0;
    var compraUSD = v.purchase ? toUSD(v.purchase.precio, v.purchase.moneda, pRate) : 0;

    var gastosARS = 0, gastosUSD = 0;
    (v.expenses || []).forEach(function (e) {
      var r = e.cotizacionUSD || pRate;
      gastosARS += toARS(e.monto, e.moneda, r);
      gastosUSD += toUSD(e.monto, e.moneda, r);
    });

    var inversionARS = compraARS + gastosARS;
    var inversionUSD = compraUSD + gastosUSD;

    var vendido = !!(v.sale && v.sale.precio);
    var ventaARS = vendido ? toARS(v.sale.precio, v.sale.moneda, sRate) : 0;
    var ventaUSD = vendido ? toUSD(v.sale.precio, v.sale.moneda, sRate) : 0;

    // Comisiones pagadas a terceros (contactos que acercaron la operación)
    var comCompra = (v.purchase && v.purchase.comision) ? v.purchase.comision : null;
    var comVenta = (vendido && v.sale.comision) ? v.sale.comision : null;
    var comisionCompraARS = comCompra ? toARS(comCompra.monto, comCompra.moneda, pRate) : 0;
    var comisionVentaARS = comVenta ? toARS(comVenta.monto, comVenta.moneda, sRate) : 0;
    var comisionCompraUSD = comCompra ? toUSD(comCompra.monto, comCompra.moneda, pRate) : 0;
    var comisionVentaUSD = comVenta ? toUSD(comVenta.monto, comVenta.moneda, sRate) : 0;
    var comisionARS = comisionCompraARS + comisionVentaARS;
    var comisionUSD = comisionCompraUSD + comisionVentaUSD;

    // Costo total = compra + gastos + comisiones
    var costoTotalARS = inversionARS + comisionARS;
    var costoTotalUSD = inversionUSD + comisionUSD;

    // Valor de la operación de venta = precio de venta (incluye el vehículo recibido + diferencia)
    var tradeInARS = 0, diferenciaARS = 0;
    if (vendido && v.sale.tradeIn) tradeInARS = toARS(v.sale.tradeIn.valor, v.sale.tradeIn.moneda, sRate);
    if (vendido && v.sale.diferencia) diferenciaARS = toARS(v.sale.diferencia.monto, v.sale.diferencia.moneda, sRate);

    var gananciaARS = vendido ? (ventaARS - costoTotalARS) : 0;
    var gananciaUSD = vendido ? (ventaUSD - costoTotalUSD) : 0;
    var rentabilidad = (vendido && costoTotalARS) ? (gananciaARS / costoTotalARS) * 100 : 0;
    var rentabilidadUSD = (vendido && costoTotalUSD) ? (gananciaUSD / costoTotalUSD) * 100 : 0;

    // Valor estimado en stock: precio pretendido, si existe; si no, la inversión total
    var estimadoARS = inversionARS;
    if (v.precioPretendido) estimadoARS = toARS(v.precioPretendido, v.precioPretendidoMoneda || 'ARS', currentRate());

    // Cuotas
    var cuotas = (v.purchase && v.purchase.cuotas) || [];
    var cuotasTotal = 0, cuotasPagadas = 0, cuotasPendientes = 0, cuotasVencidas = 0;
    var proximaCuota = null;
    var hoy = App.store.todayISO();
    cuotas.forEach(function (c) {
      var m = toARS(c.monto, v.purchase.moneda, pRate);
      cuotasTotal += m;
      if (c.pagada) { cuotasPagadas += m; }
      else {
        cuotasPendientes += m;
        if (c.vencimiento && c.vencimiento < hoy) cuotasVencidas += m;
        if (!proximaCuota || (c.vencimiento && c.vencimiento < proximaCuota.vencimiento)) proximaCuota = c;
      }
    });
    var totalPagado = 0;
    if (v.purchase) {
      if (v.purchase.formaPago === 'cuotas') totalPagado = cuotasPagadas;
      else if (v.purchase.formaPago === 'parte-de-pago') totalPagado = compraARS;
      else totalPagado = compraARS; // transferencia/efectivo/mixto se consideran pagadas al contado
    }
    var totalPendiente = v.purchase && v.purchase.formaPago === 'cuotas' ? cuotasPendientes : 0;

    // Cuotas que TE tienen que pagar (venta financiada)
    var fin = (vendido && v.sale.financiacion) ? v.sale.financiacion : null;
    var finCuotas = fin ? (fin.cuotas || []) : [];
    var financTotalARS = 0, financCobradoARS = 0, financPorCobrarARS = 0, financVencidasARS = 0;
    var proximaCuotaCobro = null;
    finCuotas.forEach(function (c) {
      var mm = toARS(c.monto, fin.moneda, sRate);
      financTotalARS += mm;
      if (c.cobrada) financCobradoARS += mm;
      else {
        financPorCobrarARS += mm;
        if (c.vencimiento && c.vencimiento < hoy) financVencidasARS += mm;
        if (!proximaCuotaCobro || (c.vencimiento && c.vencimiento < (proximaCuotaCobro.vencimiento || '9999'))) proximaCuotaCobro = c;
      }
    });
    var financEntregaARS = fin ? toARS(fin.entrega, fin.moneda, sRate) : 0;

    return {
      compraARS: compraARS, compraUSD: compraUSD,
      gastosARS: gastosARS, gastosUSD: gastosUSD,
      inversionARS: inversionARS, inversionUSD: inversionUSD,
      comisionCompraARS: comisionCompraARS, comisionVentaARS: comisionVentaARS, comisionARS: comisionARS,
      costoTotalARS: costoTotalARS, costoTotalUSD: costoTotalUSD,
      vendido: vendido,
      ventaARS: ventaARS, ventaUSD: ventaUSD,
      tradeInARS: tradeInARS, diferenciaARS: diferenciaARS,
      gananciaARS: gananciaARS, gananciaUSD: gananciaUSD,
      rentabilidad: rentabilidad, rentabilidadUSD: rentabilidadUSD,
      estimadoARS: estimadoARS,
      diasEnStock: diasEnStock(v),
      purchaseRate: pRate, saleRate: sRate,
      cuotasCount: cuotas.length,
      cuotasPagadasCount: cuotas.filter(function (c) { return c.pagada; }).length,
      cuotasPendientesCount: cuotas.filter(function (c) { return !c.pagada; }).length,
      cuotasVencidasCount: cuotas.filter(function (c) { return !c.pagada && c.vencimiento && c.vencimiento < hoy; }).length,
      cuotasTotalARS: cuotasTotal, cuotasPagadasARS: cuotasPagadas, cuotasPendientesARS: cuotasPendientes, cuotasVencidasARS: cuotasVencidas,
      totalPagadoARS: totalPagado, totalPendienteARS: totalPendiente,
      proximaCuota: proximaCuota,
      // financiación de la venta
      financiado: !!fin,
      financCuotasCount: finCuotas.length,
      financCobradasCount: finCuotas.filter(function (c) { return c.cobrada; }).length,
      financPendientesCount: finCuotas.filter(function (c) { return !c.cobrada; }).length,
      financVencidasCount: finCuotas.filter(function (c) { return !c.cobrada && c.vencimiento && c.vencimiento < hoy; }).length,
      financEntregaARS: financEntregaARS,
      financTotalARS: financTotalARS, financCobradoARS: financCobradoARS,
      financPorCobrarARS: financPorCobrarARS, financVencidasARS: financVencidasARS,
      proximaCuotaCobro: proximaCuotaCobro
    };
  }

  function diasEnStock(v) {
    if (!v.purchase || !v.purchase.fecha) return null;
    var desde = parseDate(v.purchase.fecha);
    var hasta = (v.sale && v.sale.fecha) ? parseDate(v.sale.fecha) : new Date();
    if (!desde) return null;
    var ms = hasta - desde;
    return Math.max(0, Math.round(ms / 86400000));
  }

  function parseDate(iso) {
    if (!iso) return null;
    var p = String(iso).split('-');
    if (p.length !== 3) return null;
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  /* --------------------------- Comparación por dólar ------------------- */
  // Comparación "valor del auto según el dólar" (sección 20/21).
  // La referencia es la INVERSIÓN TOTAL (precio de compra + gastos) expresada en
  // dólares: cada parte se convierte con su propia cotización histórica
  // (la de la compra, o la del gasto si se cargó una distinta).
  function dollarComparison(v, dolarActualManual) {
    if (!v.purchase) return null;
    var m = vehicleMetrics(v);
    var pRate = v.purchase.cotizacionUSD || null;

    var compraARS = m.compraARS;
    var gastosARS = m.gastosARS;
    var inversionARS = m.inversionARS;          // compra + gastos, en pesos (nominal)
    var compraUSD = m.compraUSD;                // compra en USD (cotización de compra)
    var gastosUSD = m.gastosUSD;                // gastos en USD (cotización de cada gasto)
    var inversionUSD = m.inversionUSD;          // compra + gastos, en USD
    var valorUSD = inversionUSD;                // "valor equivalente en dólares" ahora incluye los gastos
    var dolarActual = +dolarActualManual || currentRate();

    var out = {
      compraARS: compraARS,
      gastosARS: gastosARS,
      inversionARS: inversionARS,
      compraUSD: compraUSD,
      gastosUSD: gastosUSD,
      inversionUSD: inversionUSD,
      dolarCompra: pRate || (v.purchase.moneda === 'USD' ? (v.purchase.cotizacionUSD || null) : currentRate()),
      valorUSD: valorUSD,
      dolarActual: dolarActual,
      valorActualizadoARS: valorUSD != null ? valorUSD * dolarActual : null,
      diferenciaARS: null,
      resultado: null
    };
    if (out.valorActualizadoARS != null) {
      out.diferenciaARS = out.valorActualizadoARS - inversionARS;
      out.resultado = out.diferenciaARS >= 0 ? 'ganancia' : 'perdida';
    }

    // Si además está vendido: comparación real inversión vs venta
    if (v.sale && v.sale.precio) {
      var sRate = v.sale.cotizacionUSD || null;
      var ventaARS = m.ventaARS;
      var valorUSDVenta = m.ventaUSD;
      out.venta = {
        ventaARS: ventaARS,
        dolarVenta: sRate || (v.sale.moneda === 'USD' ? (v.sale.cotizacionUSD || null) : currentRate()),
        valorUSDVenta: valorUSDVenta,
        gananciaNominalARS: ventaARS - inversionARS,
        gananciaUSD: (valorUSDVenta != null && valorUSD != null) ? (valorUSDVenta - valorUSD) : null,
        variacionUSDPct: (valorUSD) ? ((valorUSDVenta - valorUSD) / valorUSD) * 100 : null,
        // diferencia explicada por la variación del dólar: cuánto valdría hoy en pesos la inversión en USD al dólar de venta
        efectoDolarARS: (valorUSD != null && sRate) ? (valorUSD * sRate - inversionARS) : null
      };
    }
    return out;
  }

  /* --------------------------- Agregados globales --------------------- */
  function globalMetrics() {
    var vehicles = App.store.activeVehicles();
    var enStock = vehicles.filter(function (v) { return v.estado !== 'vendido'; });
    var vendidos = vehicles.filter(function (v) { return v.estado === 'vendido' && v.sale; });

    var capitalInvertido = 0, valorEstimadoStock = 0, gastosTotales = 0, gananciaTotal = 0, gananciaTotalUSD = 0;
    var ventasTotal = 0, comprasTotal = 0;

    var comisionesTotal = 0, porCobrar = 0, porCobrarVencido = 0, porPagarCuotas = 0, porPagarVencido = 0;

    vehicles.forEach(function (v) {
      var m = vehicleMetrics(v);
      gastosTotales += m.gastosARS;
      comprasTotal += m.compraARS;
      comisionesTotal += m.comisionARS;
      porCobrar += m.financPorCobrarARS;
      porCobrarVencido += m.financVencidasARS;
      porPagarCuotas += m.cuotasPendientesARS;
      porPagarVencido += m.cuotasVencidasARS;
      if (v.estado !== 'vendido') {
        capitalInvertido += m.costoTotalARS;
        valorEstimadoStock += m.estimadoARS;
      } else if (v.sale) {
        gananciaTotal += m.gananciaARS;
        gananciaTotalUSD += m.gananciaUSD;
        ventasTotal += m.ventaARS;
      }
    });

    var gastosFijosTotales = fixedExpensesTotal();
    var resultadoNegocio = gananciaTotal - gastosFijosTotales;
    var gananciaPromedio = vendidos.length ? gananciaTotal / vendidos.length : 0;

    // rankings
    var conGanancia = vendidos.map(function (v) { return { v: v, m: vehicleMetrics(v) }; });
    var mayorGanancia = pick(conGanancia, function (a, b) { return b.m.gananciaARS - a.m.gananciaARS; });
    var menorGanancia = pick(conGanancia, function (a, b) { return a.m.gananciaARS - b.m.gananciaARS; });
    var masRentable = pick(conGanancia, function (a, b) { return b.m.rentabilidad - a.m.rentabilidad; });
    var menosRentable = pick(conGanancia, function (a, b) { return a.m.rentabilidad - b.m.rentabilidad; });
    var masTiempoStock = pick(vehicles.map(wrap), function (a, b) { return (b.m.diasEnStock || 0) - (a.m.diasEnStock || 0); });
    var vendidoMasRapido = pick(conGanancia.filter(function (x) { return x.m.diasEnStock != null; }), function (a, b) { return a.m.diasEnStock - b.m.diasEnStock; });
    var mayorVenta = pick(conGanancia, function (a, b) { return b.m.ventaARS - a.m.ventaARS; });

    // mayor gasto individual
    var mayorGasto = null;
    vehicles.forEach(function (v) {
      (v.expenses || []).forEach(function (e) {
        var r = e.cotizacionUSD || purchaseRate(v);
        var ars = toARS(e.monto, e.moneda, r);
        if (!mayorGasto || ars > mayorGasto.ars) mayorGasto = { vehicle: v, expense: e, ars: ars };
      });
    });

    function wrap(v) { return { v: v, m: vehicleMetrics(v) }; }

    return {
      autosEnStock: enStock.length,
      autosVendidos: vendidos.length,
      totalVehiculos: vehicles.length,
      capitalInvertido: capitalInvertido,
      valorEstimadoStock: valorEstimadoStock,
      dineroEnAutos: capitalInvertido,
      gastosTotales: gastosTotales,
      gastosFijosTotales: gastosFijosTotales,
      comisionesTotal: comisionesTotal,
      resultadoNegocio: resultadoNegocio,
      porCobrar: porCobrar, porCobrarVencido: porCobrarVencido,
      porPagarCuotas: porPagarCuotas, porPagarVencido: porPagarVencido,
      gananciaTotal: gananciaTotal,
      gananciaTotalUSD: gananciaTotalUSD,
      gananciaPromedio: gananciaPromedio,
      ventasTotal: ventasTotal,
      comprasTotal: comprasTotal,
      gananciaDelMes: periodResult(monthRange(new Date())).ganancias,
      resultadoNetoDelMes: periodResult(monthRange(new Date())).resultadoNeto,
      mayorGanancia: mayorGanancia, menorGanancia: menorGanancia,
      masRentable: masRentable, menosRentable: menosRentable,
      masTiempoStock: masTiempoStock, vendidoMasRapido: vendidoMasRapido,
      mayorVenta: mayorVenta, mayorGasto: mayorGasto
    };
  }

  function pick(arr, cmp) {
    if (!arr || !arr.length) return null;
    return arr.slice().sort(cmp)[0];
  }

  /* ------------------- Gastos fijos del negocio ---------------------- */
  function fxRate(f) { return f.cotizacionUSD || currentRate(); }
  function fixedExpenseMonths(f, from, to) {
    if (f.frecuencia !== 'mensual') {
      return (f.fecha && (!from || f.fecha >= from) && (!to || f.fecha <= to)) ? 1 : 0;
    }
    var startD = parseDate(f.fecha);
    if (!startD) return 0;
    var rFrom = from ? parseDate(from) : startD;
    var rTo = to ? parseDate(to) : new Date();
    var endLimit = f.hasta ? parseDate(f.hasta) : null;
    var s = (startD > rFrom) ? startD : rFrom;
    var e = rTo;
    if (endLimit && endLimit < e) e = endLimit;
    if (e < s) return 0;
    return Math.max(0, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1);
  }
  function fixedExpensesInPeriod(from, to) {
    var total = 0;
    (S().fixedExpenses || []).forEach(function (f) {
      var n = fixedExpenseMonths(f, from, to);
      if (n > 0) total += n * toARS(f.monto, f.moneda, fxRate(f));
    });
    return total;
  }
  function fixedExpensesTotal() { return fixedExpensesInPeriod(null, App.store.todayISO()); }

  /* --------------------------- Resúmenes por período ----------------- */
  function periodResult(range) {
    // range = { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
    var from = range.from, to = range.to;
    var inRange = function (d) { return d && (!from || d >= from) && (!to || d <= to); };
    var vehicles = App.store.activeVehicles();

    var gastos = 0, inversion = 0, ganancias = 0, comprasCount = 0, ventasCount = 0, cuotasPagadas = 0;

    vehicles.forEach(function (v) {
      var pRate = purchaseRate(v), sRate = saleRate(v);
      if (v.purchase && inRange(v.purchase.fecha)) {
        // inversión del período = lo efectivamente comprometido en compras (contado + cuotas del período se cuentan aparte)
        if (v.purchase.formaPago !== 'cuotas') {
          inversion += toARS(v.purchase.precio, v.purchase.moneda, pRate);
        }
        comprasCount++;
      }
      (v.purchase && v.purchase.cuotas || []).forEach(function (c) {
        if (c.pagada && inRange(c.fechaPago)) {
          var m = toARS(c.monto, v.purchase.moneda, pRate);
          inversion += m; cuotasPagadas += m;
        }
      });
      (v.expenses || []).forEach(function (e) {
        if (inRange(e.fecha)) gastos += toARS(e.monto, e.moneda, e.cotizacionUSD || pRate);
      });
      if (v.sale && inRange(v.sale.fecha)) {
        ganancias += vehicleMetrics(v).gananciaARS;
        ventasCount++;
      }
    });

    var gastosFijos = fixedExpensesInPeriod(from, to);

    return {
      range: range,
      gastos: gastos,
      gastosFijos: gastosFijos,
      inversion: inversion,
      ganancias: ganancias,
      cuotasPagadas: cuotasPagadas,
      resultadoNeto: ganancias - gastos - gastosFijos,
      comprasCount: comprasCount,
      ventasCount: ventasCount
    };
  }

  /* --------------------------- Series para gráficos ------------------ */
  function monthlySeries(months) {
    months = months || 12;
    var now = new Date();
    var out = [];
    for (var i = months - 1; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var r = monthRange(d);
      var res = periodResult(r);
      out.push({
        label: monthLabel(d),
        ym: d.getFullYear() + '-' + pad(d.getMonth() + 1),
        ganancias: res.ganancias,
        gastos: res.gastos,
        gastosFijos: res.gastosFijos,
        inversion: res.inversion,
        compras: res.comprasCount,
        ventas: res.ventasCount,
        resultadoNeto: res.resultadoNeto
      });
    }
    // evolución acumulada del resultado
    var acc = 0;
    out.forEach(function (m) { acc += m.resultadoNeto; m.acumulado = acc; });
    return out;
  }

  /* --------------------------- Rangos de fecha ---------------------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dayRange(d) { d = d || new Date(); return { from: iso(d), to: iso(d) }; }
  function weekRange(d) {
    d = d || new Date();
    var day = (d.getDay() + 6) % 7; // lunes = 0
    var start = new Date(d); start.setDate(d.getDate() - day);
    var end = new Date(start); end.setDate(start.getDate() + 6);
    return { from: iso(start), to: iso(end) };
  }
  function monthRange(d) {
    d = d || new Date();
    return { from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
  }
  function yearRange(d) {
    d = d || new Date();
    return { from: d.getFullYear() + '-01-01', to: d.getFullYear() + '-12-31' };
  }
  function allRange() { return { from: null, to: null }; }

  var MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  var MESES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  function monthLabel(d) { return MESES[d.getMonth()] + ' ' + String(d.getFullYear()).slice(2); }
  function monthLabelLong(d) { return MESES_LARGO[d.getMonth()] + ' ' + d.getFullYear(); }

  /* ------------- Todas las cuotas (a pagar + a cobrar) -------------- */
  // devuelve { pagar: [item...], cobrar: [item...] }
  // item = { vehicle, cuota, tipo:'pagar'|'cobrar', moneda, vencimiento, montoARS, estado }
  function allInstallments() {
    var hoy = App.store.todayISO();
    var pagar = [], cobrar = [];
    App.store.activeVehicles().forEach(function (v) {
      var sRate = saleRate(v), pRate = purchaseRate(v);
      if (v.purchase && v.purchase.formaPago === 'cuotas') {
        (v.purchase.cuotas || []).forEach(function (c) {
          pagar.push({
            vehicle: v, cuota: c, tipo: 'pagar', moneda: v.purchase.moneda,
            vencimiento: c.vencimiento, montoARS: toARS(c.monto, v.purchase.moneda, pRate),
            estado: c.pagada ? 'pagada' : (c.vencimiento && c.vencimiento < hoy ? 'vencida' : 'pendiente')
          });
        });
      }
      if (v.sale && v.sale.financiacion) {
        var fin = v.sale.financiacion;
        (fin.cuotas || []).forEach(function (c) {
          cobrar.push({
            vehicle: v, cuota: c, tipo: 'cobrar', moneda: fin.moneda,
            vencimiento: c.vencimiento, montoARS: toARS(c.monto, fin.moneda, sRate),
            estado: c.cobrada ? 'cobrada' : (c.vencimiento && c.vencimiento < hoy ? 'vencida' : 'pendiente')
          });
        });
      }
    });
    var byDate = function (a, b) { return (a.vencimiento || '9999').localeCompare(b.vencimiento || '9999'); };
    pagar.sort(byDate); cobrar.sort(byDate);
    return { pagar: pagar, cobrar: cobrar };
  }

  /* ------------------------------- Export ---------------------------- */
  window.App = window.App || {};
  App.finance = {
    toARS: toARS, toUSD: toUSD, currentRate: currentRate,
    purchaseRate: purchaseRate, saleRate: saleRate,
    vehicleMetrics: vehicleMetrics, diasEnStock: diasEnStock,
    dollarComparison: dollarComparison,
    globalMetrics: globalMetrics,
    periodResult: periodResult, monthlySeries: monthlySeries,
    fixedExpensesInPeriod: fixedExpensesInPeriod, fixedExpensesTotal: fixedExpensesTotal, fixedExpenseMonths: fixedExpenseMonths,
    allInstallments: allInstallments,
    dayRange: dayRange, weekRange: weekRange, monthRange: monthRange, yearRange: yearRange, allRange: allRange,
    monthLabel: monthLabel, monthLabelLong: monthLabelLong,
    parseDate: parseDate, MESES: MESES, MESES_LARGO: MESES_LARGO
  };
})();
