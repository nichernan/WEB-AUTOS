/* ============================================================================
 * views2.js  —  Alertas, Finanzas, Resúmenes, Gráficos, Historial,
 *               Operaciones, Comparación del dólar, Contactos, Estadísticas,
 *               Papelera, Exportación, Ajustes
 * ==========================================================================*/
(function () {
  'use strict';
  var ui = App.ui, el = ui.el, fmt = App.fmt, store = App.store, fin = App.finance;

  /* =============================== ALERTAS ============================= */
  /* ---- Recordatorios: tipos, repetición y cálculo de ocurrencias ---- */
  var REM_TIPOS = (App.forms && App.forms.REM_TIPOS) || [['tarea', 'Tarea']];
  var REM_ICON = {
    tarea: '📋', mantenimiento: '🔧', tramite: '📁', pago: '💳',
    turno: '🤝', gestoria: '📝', stock: '📦', otro: '🔔'
  };
  function remTipoLabel(t) {
    for (var i = 0; i < REM_TIPOS.length; i++) if (REM_TIPOS[i][0] === t) return REM_TIPOS[i][1];
    return 'Otro';
  }
  function remIcon(t) { return REM_ICON[t] || '🔔'; }
  function remRepeatLabel(rep) {
    return ({ daily: 'todos los días', weekly: 'todas las semanas', monthly: 'todos los meses', yearly: 'todos los años' })[rep] || '';
  }
  function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  // próxima ocurrencia (>= hoy) de un recordatorio; para 'none' es su fecha tal cual
  function reminderNextDate(r, todayIso) {
    if (!r.repeat || r.repeat === 'none') return r.fecha;
    var base = fin.parseDate(r.fecha), today = fin.parseDate(todayIso);
    if (!base || !today) return r.fecha;
    var start = base > today ? base : today;
    var d;
    if (r.repeat === 'daily') return isoOf(start);
    if (r.repeat === 'weekly') {
      d = new Date(start);
      d.setDate(d.getDate() + ((base.getDay() - d.getDay() + 7) % 7));
      return isoOf(d);
    }
    if (r.repeat === 'monthly') {
      d = new Date(start.getFullYear(), start.getMonth(), base.getDate());
      if (d < start) d = new Date(start.getFullYear(), start.getMonth() + 1, base.getDate());
      return isoOf(d);
    }
    if (r.repeat === 'yearly') {
      d = new Date(start.getFullYear(), base.getMonth(), base.getDate());
      if (d < start) d = new Date(start.getFullYear() + 1, base.getMonth(), base.getDate());
      return isoOf(d);
    }
    return r.fecha;
  }

  // ¿el recordatorio cae en este día (YYYY-MM-DD)?
  function reminderOnDay(r, dayIso) {
    var base = fin.parseDate(r.fecha), day = fin.parseDate(dayIso);
    if (!base || !day) return false;
    if (day < new Date(base.getFullYear(), base.getMonth(), base.getDate())) return false;
    switch (r.repeat) {
      case 'daily': return true;
      case 'weekly': return base.getDay() === day.getDay();
      case 'monthly': return base.getDate() === day.getDate();
      case 'yearly': return base.getDate() === day.getDate() && base.getMonth() === day.getMonth();
      default: return r.fecha === dayIso;
    }
  }

  function occDone(r, occDate) { return (r.doneDates || []).indexOf(occDate) >= 0; }
  function reminderStatus(r, todayIso) {
    var next = reminderNextDate(r, todayIso);
    if (!r.repeat || r.repeat === 'none') {
      if (occDone(r, r.fecha)) return 'done';
      if (r.fecha < todayIso) return 'overdue';
      if (r.fecha === todayIso) return 'today';
      return 'upcoming';
    }
    if (occDone(r, next)) return 'done';
    return next === todayIso ? 'today' : 'upcoming';
  }

  // Eventos automáticos: vencimientos de cuotas (a pagar y a cobrar) y de reservas.
  // Para no llenar Alertas: los vencidos y de hoy siempre; los futuros sólo si
  // faltan pocos días (el listado completo está en "Cuotas y cobros").
  function autoEvents(todayIso, allFuture) {
    var horizonteDias = (store.getState().settings.cuotaProximaDias || 7) + 21; // ~1 mes de anticipación
    var limite = fin.parseDate(todayIso); limite.setDate(limite.getDate() + horizonteDias);
    var limiteIso = limite.getFullYear() + '-' + pad(limite.getMonth() + 1) + '-' + pad(limite.getDate());
    var out = [];
    var inst = fin.allInstallments();
    function add(kind, it) {
      if (!it.vencimiento) return;
      out.push({ auto: true, kind: kind, vehicle: it.vehicle, cuota: it.cuota, moneda: it.moneda, monto: it.cuota.monto, date: it.vencimiento });
    }
    inst.pagar.forEach(function (it) { if (it.estado !== 'pagada') add('pagar', it); });
    inst.cobrar.forEach(function (it) { if (it.estado !== 'cobrada') add('cobrar', it); });
    store.activeVehicles().forEach(function (v) {
      if (v.reservation && v.reservation.vence && v.estado === 'reservado') {
        out.push({ auto: true, kind: 'reserva', vehicle: v, date: v.reservation.vence });
      }
    });
    out.forEach(function (e) {
      e.status = e.date < todayIso ? 'overdue' : (e.date === todayIso ? 'today' : 'upcoming');
    });
    if (allFuture) return out;
    return out.filter(function (e) { return e.status !== 'upcoming' || e.date <= limiteIso; });
  }

  function allBuckets(todayIso) {
    var b = { overdue: [], today: [], upcoming: [], done: [] };
    store.getReminders().forEach(function (r) {
      var st = reminderStatus(r, todayIso);
      b[st].push({ r: r, date: reminderNextDate(r, todayIso), status: st });
    });
    autoEvents(todayIso).forEach(function (e) { b[e.status].push(e); });
    function key(x) { return (x.date || '9999') + '·' + (x.r && x.r.hora ? x.r.hora : '99:99'); }
    ['overdue', 'today', 'upcoming'].forEach(function (k) { b[k].sort(function (a, x) { return key(a).localeCompare(key(x)); }); });
    return b;
  }

  var alerts = {
    forVehicle: function (v) {
      var out = [];
      if (v.deleted) return out;
      var m = fin.vehicleMetrics(v);
      var hoy = store.todayISO();
      var s = store.getState().settings;
      if (!v.purchase && !(v.origin && v.origin.type === 'consignacion')) out.push({ level: 'warn', icon: '🧾', text: 'Falta registrar la compra', vehicleId: v.id });
      if (v.purchase && !v.purchase.cotizacionUSD && v.purchase.moneda === 'ARS') out.push({ level: 'info', icon: '💵', text: 'Falta la cotización del dólar en la compra', vehicleId: v.id });
      if (v.estado === 'vendido' && v.sale) {
        if (!v.sale.precio) out.push({ level: 'warn', icon: '🏷️', text: 'Falta registrar el precio de venta', vehicleId: v.id });
        if (!v.sale.fecha) out.push({ level: 'warn', icon: '📅', text: 'Falta registrar la fecha de venta', vehicleId: v.id });
        if (v.sale.moneda === 'ARS' && !v.sale.cotizacionUSD) out.push({ level: 'info', icon: '💵', text: 'Falta la cotización del dólar en la venta', vehicleId: v.id });
      }
      if (v.documentacion === 'pendiente' || v.documentacion === 'transferencia') out.push({ level: 'warn', icon: '📁', text: 'Documentación pendiente' + (v.documentacion === 'transferencia' ? ' (transferencia)' : ''), vehicleId: v.id });
      if (v.estado !== 'vendido' && m.diasEnStock != null && m.diasEnStock >= s.diasStockAlerta) out.push({ level: 'warn', icon: '⏳', text: 'Lleva ' + m.diasEnStock + ' días en stock', vehicleId: v.id });
      if (!v.marca || !v.modelo || !v.patente) out.push({ level: 'info', icon: '✏️', text: 'Información básica incompleta', vehicleId: v.id });
      // (los vencimientos de cuotas y reservas se muestran arriba, como recordatorios)
      return out;
    },
    all: function () {
      var out = [];
      store.activeVehicles().forEach(function (v) {
        alerts.forVehicle(v).forEach(function (a) { a.vehicle = v; out.push(a); });
      });
      var order = { danger: 0, warn: 1, info: 2 };
      out.sort(function (a, b) { return order[a.level] - order[b.level]; });
      return out;
    },
    count: function () {
      var n = alerts.all().filter(function (a) { return a.level !== 'info'; }).length;
      var hoy = store.todayISO();
      store.getReminders().forEach(function (r) {
        var st = reminderStatus(r, hoy);
        if (st === 'overdue' || st === 'today') n++;
      });
      autoEvents(hoy).forEach(function (e) { if (e.status === 'overdue' || e.status === 'today') n++; });
      return n;
    }
  };
  // Cola priorizada de lo que requiere atención (solo lectura: reutiliza los
  // mismos cálculos de recordatorios, cuotas, reservas y avisos de vehículos).
  // La usa Inicio para mostrar un resumen; la pantalla Alertas arma su propia lista.
  alerts.queue = function () {
    var hoy = store.todayISO();
    var b = allBuckets(hoy);
    var out = [];
    function rel(date, status, hora) {
      if (status === 'overdue') return 'Venció ' + fmt.relative(date);
      if (status === 'today') return 'Hoy' + (hora ? ' · ' + hora : '');
      return fmt.relative(date).replace(/^./, function (c) { return c.toUpperCase(); });
    }
    function describe(it) {
      if (it.auto) {
        var e = it;
        var nm = store.vehicleName(e.vehicle);
        var title = e.kind === 'pagar' ? 'Pagar cuota ' + e.cuota.numero + ' · ' + nm
          : e.kind === 'cobrar' ? 'Cobrar cuota ' + e.cuota.numero + ' · ' + nm
          : 'Vence la reserva · ' + nm;
        return { title: title, meta: e.monto ? fmt.money(e.monto, e.moneda) : '', href: '#/vehiculo/' + e.vehicle.id, status: e.status, due: rel(e.date, e.status) };
      }
      return { title: it.r.titulo, meta: remTipoLabel(it.r.tipo), href: '#/alertas', status: it.status, due: rel(it.date || it.r.fecha, it.status, it.r.hora) };
    }
    b.overdue.forEach(function (it) { out.push(describe(it)); });
    b.today.forEach(function (it) { out.push(describe(it)); });
    var lim = new Date(); lim.setDate(lim.getDate() + 7);
    var limIso = lim.getFullYear() + '-' + pad(lim.getMonth() + 1) + '-' + pad(lim.getDate());
    b.upcoming.forEach(function (it) {
      var dt = it.date || (it.r && it.r.fecha);
      if (dt && dt <= limIso) { var d = describe(it); d.status = 'upcoming'; out.push(d); }
    });
    alerts.all().forEach(function (a) {
      if (a.level === 'info') return;
      out.push({ title: store.vehicleName(a.vehicle) + ' · ' + a.text, meta: '', href: '#/vehiculo/' + a.vehicle.id, status: 'notice', due: 'Aviso' });
    });
    return out;
  };

  function daysBetween(a, b) {
    var da = fin.parseDate(a), db = fin.parseDate(b);
    if (!da || !db) return 0;
    return Math.round((db - da) / 86400000);
  }
  App.alerts = alerts;

  /* ---------- ALERTAS: bandeja de trabajo (cola accionable) ---------- */
  // Misma lógica de siempre (recordatorios, cuotas, reservas y avisos de
  // vehículos); acá solo cambia la presentación: una cola priorizada con
  // contadores, vencimiento muy visible y la acción de resolver en cada fila.
  var alertFilter = 'todas';
  var REM_SVG = { tarea: 'list', mantenimiento: 'wrench', tramite: 'file', pago: 'card', turno: 'handshake', gestoria: 'file', stock: 'car', otro: 'bell' };

  function daysFrom(hoy, iso) { return daysBetween(hoy, iso); }
  // Tono de la fila: vencido = rojo · próximo (hoy o ≤3 días) = naranja ·
  // normal = neutro/azul · completado = positivo. El amarillo de marca NO se usa acá.
  function toneOf(status, date, hoy) {
    if (status === 'done') return 'done';
    if (status === 'overdue') return 'overdue';
    if (status === 'today') return 'soon';
    return (date && daysFrom(hoy, date) <= 3) ? 'soon' : 'later';
  }
  function dueLabel(status, date) {
    if (status === 'done') return 'Completada';
    if (status === 'overdue') return 'Venció ' + fmt.relative(date);
    if (status === 'today') return 'Hoy';
    var r = fmt.relative(date);
    return r.charAt(0).toUpperCase() + r.slice(1);
  }
  function dueBlock(tone, label, sub) {
    return el('div', { class: 'w-due w-due-' + tone }, [el('strong', { text: label }), sub ? el('span', { class: 'num', text: sub }) : null]);
  }

  var MES3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var TILE_LBL = { overdue: 'Vencida', soon: 'Pronto', later: 'Agenda', done: 'Hecha' };
  // "Ficha de fecha" a la izquierda de cada tarea: es lo primero que se lee.
  function dateTile(tone, iso, status) {
    var lbl = status === 'today' ? 'Hoy' : TILE_LBL[tone];
    return el('div', { class: 'w-tile w-tile-' + tone, 'aria-hidden': 'true' }, [
      el('small', { text: lbl }),
      el('b', { class: 'num', text: iso ? String(parseInt(iso.slice(8, 10), 10)) : '–' }),
      el('small', { text: iso ? MES3[parseInt(iso.slice(5, 7), 10) - 1] : '' })
    ]);
  }

  function workRow(it, hoy) {
    if (it.auto) return autoWorkRow(it, hoy);
    var r = it.r;
    var status = it.status || reminderStatus(r, hoy);
    var occ = it.date || r.fecha;
    var isDone = occDone(r, occ) || status === 'done';
    var tone = isDone ? 'done' : toneOf(status, occ, hoy);
    var repTxt = (r.repeat && r.repeat !== 'none') ? ' · repite ' + remRepeatLabel(r.repeat) : '';

    var doneBtn = el('button', {
      class: 'w-act' + (isDone ? ' is-done' : ''), type: 'button',
      title: isDone ? 'Marcar como pendiente' : 'Marcar como hecho',
      onclick: function (e) { e.preventDefault(); e.stopPropagation(); store.toggleReminderOccurrence(r.id, occ); }
    }, [ui.icon('check'), el('span', { text: isDone ? 'Reabrir' : 'Hecho' })]);
    var del = el('button', {
      class: 'icon-btn w-del', type: 'button', title: 'Eliminar', 'aria-label': 'Eliminar alerta', html: '&times;',
      onclick: function (e) {
        e.preventDefault(); e.stopPropagation();
        ui.confirm({ title: 'Eliminar alerta', message: '¿Eliminar "' + r.titulo + '"?', danger: true, confirmText: 'Eliminar' })
          .then(function (ok) { if (ok) { store.removeReminder(r.id); ui.toast('Alerta eliminada'); } });
      }
    });
    return el('div', { class: 'w-row w-' + tone }, [
      dateTile(tone, occ, isDone ? 'done' : status),
      el('div', { class: 'w-body', onclick: function () { App.forms.reminderForm(r); } }, [
        el('div', { class: 'w-title' }, [el('span', { class: 'w-ico' }, ui.icon(REM_SVG[r.tipo] || 'bell')), el('span', { class: 'w-name', text: r.titulo })]),
        el('div', { class: 'w-dueline w-due-' + tone }, [el('strong', { text: dueLabel(isDone ? 'done' : status, occ) }), el('span', { class: 'num', text: (r.hora ? ' · ' + r.hora : '') + ' · ' + remTipoLabel(r.tipo) + repTxt })]),
        r.nota ? el('div', { class: 'w-note', text: r.nota }) : null
      ]),
      el('div', { class: 'w-actions' }, [doneBtn, del])
    ]);
  }

  function autoWorkRow(e, hoy) {
    var nm = store.vehicleName(e.vehicle);
    var title = e.kind === 'pagar' ? 'Pagar cuota ' + e.cuota.numero + ' · ' + nm
      : e.kind === 'cobrar' ? 'Cobrar cuota ' + e.cuota.numero + ' · ' + nm
      : 'Vence la reserva · ' + nm + (e.vehicle.reservation.cliente ? ' (' + e.vehicle.reservation.cliente.nombre + ')' : '');
    var meta = (e.monto ? fmt.money(e.monto, e.moneda) + ' · ' : '') +
      (e.kind === 'cobrar' ? 'te lo pagan a vos' : (e.kind === 'pagar' ? 'lo pagás vos' : 'reserva'));
    var tone = toneOf(e.status, e.date, hoy);
    var action = null;
    if (e.kind === 'pagar') action = el('button', { class: 'btn btn-sm btn-primary', type: 'button', text: 'Pagué', onclick: function (ev) { ev.preventDefault(); ev.stopPropagation(); store.pagarCuota(e.vehicle.id, e.cuota.id, hoy); ui.toast('Cuota pagada', 'success'); } });
    else if (e.kind === 'cobrar') action = el('button', { class: 'btn btn-sm btn-primary', type: 'button', text: 'Me pagaron', onclick: function (ev) { ev.preventDefault(); ev.stopPropagation(); store.cobrarCuotaVenta(e.vehicle.id, e.cuota.id, hoy); ui.toast('Cobro registrado', 'success'); } });
    else action = el('a', { class: 'btn btn-sm btn-ghost', href: '#/vehiculo/' + e.vehicle.id, text: 'Ver ficha' });
    return el('div', { class: 'w-row w-auto w-' + tone }, [
      dateTile(tone, e.date, e.status),
      el('a', { class: 'w-body', href: '#/vehiculo/' + e.vehicle.id }, [
        el('div', { class: 'w-title' }, [el('span', { class: 'w-ico' }, ui.icon(e.kind === 'reserva' ? 'bookmark' : 'card')), el('span', { class: 'w-name', text: title })]),
        el('div', { class: 'w-dueline w-due-' + tone }, [el('strong', { text: dueLabel(e.status, e.date) }), el('span', { class: 'num', text: ' · ' + meta })])
      ]),
      el('div', { class: 'w-actions' }, action)
    ]);
  }

  function vehAlertRow(vid, list) {
    var v = store.getVehicle(vid);
    var worst = list.some(function (a) { return a.level === 'danger'; }) ? 'overdue' : (list.some(function (a) { return a.level === 'warn'; }) ? 'soon' : 'later');
    return el('a', { class: 'w-row w-notice w-' + worst, href: '#/vehiculo/' + vid }, [
      el('div', { class: 'w-tile w-tile-' + worst, 'aria-hidden': 'true' }, ui.icon('car')),
      el('div', { class: 'w-body' }, [
        el('div', { class: 'w-title' }, [el('span', { class: 'w-name', text: [v.marca, v.modelo, v.anio].filter(Boolean).join(' ') || store.vehicleName(v) }), v.patente ? el('span', { class: 'plate plate-sm', text: v.patente }) : null]),
        el('ul', { class: 'w-lines' }, list.map(function (a) { return el('li', { class: 'w-line w-line-' + a.level, text: a.text }); }))
      ]),
      el('div', { class: 'w-actions' }, el('span', { class: 'w-go' }, ui.icon('chevron')))
    ]);
  }

  function alertasView(root) {
    var hoy = store.todayISO();
    var vehAlerts = alerts.all();
    var b = allBuckets(hoy);
    var doneRems = store.getReminders().filter(function (r) { return reminderStatus(r, hoy) === 'done'; })
      .map(function (r) { return { r: r, date: r.fecha, status: 'done' }; });
    var pendCount = b.overdue.length + b.today.length + b.upcoming.length;
    var byVeh = {};
    vehAlerts.forEach(function (a) { (byVeh[a.vehicle.id] = byVeh[a.vehicle.id] || []).push(a); });
    var vehIds = Object.keys(byVeh);

    var wrap = el('div', { class: 'page alertas-page ib' });
    wrap.appendChild(el('header', { class: 'ib-head' }, [
      el('div', {}, [
        el('h1', { text: 'Alertas' }),
        el('p', { class: 'ib-sub', text: pendCount ? pendCount + (pendCount === 1 ? ' tarea pendiente' : ' tareas pendientes') + (b.overdue.length ? ' · ' + b.overdue.length + ' vencida' + (b.overdue.length === 1 ? '' : 's') : '') : 'Todo al día' })
      ]),
      el('button', { class: 'btn btn-primary', type: 'button', onclick: function () { App.forms.reminderForm(null, hoy); } }, [ui.icon('plus'), el('span', { text: 'Nueva alerta' })])
    ]));

    var FILTERS = [
      ['todas', 'Bandeja', pendCount, '', 'list'],
      ['vencidas', 'Vencidas', b.overdue.length, 'overdue', 'alert'],
      ['hoy', 'Hoy', b.today.length, 'soon', 'clock'],
      ['proximas', 'Próximas', b.upcoming.length, 'later', 'calendar'],
      ['completadas', 'Completadas', doneRems.length, 'done', 'check'],
      ['avisos', 'Avisos de vehículos', vehIds.length, 'notice', 'car']
    ];
    var chipBtns = FILTERS.map(function (f) {
      var btn = el('button', { type: 'button', class: 'ib-folder ib-folder-' + (f[3] || 'all') + (f[2] ? ' has-n' : ''), dataset: { f: f[0] } }, [
        el('span', { class: 'ib-folder-ico' }, ui.icon(f[4])), el('span', { class: 'ib-folder-l', text: f[1] }), el('span', { class: 'wq-n num', text: f[2] })
      ]);
      btn.addEventListener('click', function () { alertFilter = f[0]; draw(); });
      return btn;
    });
    var list = el('div', { class: 'wq-list' });
    wrap.appendChild(el('div', { class: 'ib-layout' }, [
      el('nav', { class: 'ib-rail', role: 'tablist', 'aria-label': 'Carpetas de alertas' }, chipBtns),
      list
    ]));

    function section(title, tone, items, render) {
      if (!items.length) return null;
      return el('section', { class: 'wq-sec wq-sec-' + tone }, [
        el('div', { class: 'wq-sec-head' }, [el('h3', { text: title }), el('span', { class: 'wq-sec-n num', text: items.length })]),
        el('div', { class: 'w-list' }, items.map(render))
      ]);
    }
    function draw() {
      chipBtns.forEach(function (c) {
        var on = c.dataset.f === alertFilter;
        c.classList.toggle('is-active', on); c.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      ui.clear(list);
      var f = alertFilter;
      var parts = [];
      var rr = function (it) { return workRow(it, hoy); };
      if (f === 'todas' || f === 'vencidas') parts.push(section('Vencidas', 'overdue', b.overdue, rr));
      if (f === 'todas' || f === 'hoy') parts.push(section('Hoy', 'soon', b.today, rr));
      if (f === 'todas' || f === 'proximas') parts.push(section('Próximas', 'later', f === 'todas' ? b.upcoming.slice(0, 40) : b.upcoming, rr));
      if (f === 'completadas') parts.push(section('Completadas', 'done', doneRems, rr));
      if (f === 'avisos' || (f === 'todas' && vehIds.length)) {
        parts.push(section('Avisos de vehículos', 'notice', vehIds, function (vid) { return vehAlertRow(vid, byVeh[vid]); }));
      }
      parts = parts.filter(Boolean);
      if (!parts.length) {
        var msg = f === 'todas' ? 'No tenés nada pendiente. Todo al día.' : 'No hay nada en esta carpeta.';
        list.appendChild(el('div', { class: 'ix-clear' }, [ui.icon('check'), el('div', {}, [el('strong', { text: 'Bandeja vacía' }), el('span', { text: msg })])]));
        return;
      }
      parts.forEach(function (p) { list.appendChild(p); });
    }
    draw();

    root.appendChild(wrap);
  }

  /* ============================== ECONOMÍA ============================ */
  // Finanzas de una pyme: navegación lateral propia (Situación, Cuotas,
  // Gastos, Dólar, Resúmenes) y a la derecha la vista elegida. Cada sección
  // reutiliza tal cual la vista que ya existía — acá solo se decide en qué
  // contenedor se dibuja.
  var MODULOS_ECONOMIA = [
    ['situacion', 'chart', 'Situación', 'Resultado, capital y stock del negocio', finanzasView],
    ['cuotas', 'card', 'Cuotas y cobros', 'Lo que pagás y lo que te pagan', cuotasView],
    ['gastos', 'briefcase', 'Gastos del negocio', 'Alquiler, sueldos y otros gastos fijos', gastosNegocioView],
    ['dolar', 'dollar', 'Comparar dólar', 'El valor de tus operaciones en dólares', function (panel) { comparacionView(panel); }],
    ['resumenes', 'list', 'Resúmenes', 'Totales por período y estadísticas', resumenesView]
  ];
  var economiaScreen = 'home';
  function economiaView(root) {
    var wrap = el('div', { class: 'page page-economia fz' });
    var tabBtns = MODULOS_ECONOMIA.map(function (m) {
      return el('button', { type: 'button', class: 'fz-nav-i', dataset: { key: m[0] }, onclick: function () { goScreen(m[0]); } }, [
        el('span', { class: 'fz-nav-ico' }, ui.icon(m[1])), el('span', { class: 'fz-nav-l', text: m[2] })
      ]);
    });
    wrap.appendChild(el('div', { class: 'fz-layout' }, [
      el('nav', { class: 'fz-nav', role: 'tablist', 'aria-label': 'Secciones de Economía' }, [el('h1', { text: 'Economía' }), el('p', { class: 'fz-nav-sub', text: 'Finanzas del negocio' })].concat(tabBtns)),
      // class "tab-panel": la regla CSS que le da a Economía su ancho amplio
      // (.page-economia .tab-panel .page) sigue aplicando igual que antes.
      el('div', { class: 'tab-panel fz-content' })
    ]));
    var content = wrap.querySelector('.fz-content');
    root.appendChild(wrap);

    function goScreen(key) { economiaScreen = key; render(); }

    function render() {
      ui.clear(content);
      if (economiaScreen === 'home') economiaScreen = 'situacion';
      var mod = MODULOS_ECONOMIA.filter(function (m) { return m[0] === economiaScreen; })[0] || MODULOS_ECONOMIA[0];
      tabBtns.forEach(function (b) {
        var on = b.dataset.key === mod[0];
        b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      var panel = el('div', {});
      content.appendChild(panel);
      mod[4](panel);
    }
    render();
  }

  /* =============================== FINANZAS =========================== */
  // ("Situación" dentro de Economía). Reusa exactamente
  // fin.globalMetrics()/fin.vehicleMetrics() — ningún cálculo nuevo, solo se
  // reorganiza cómo se presentan los mismos números: resultado como
  // protagonista, estado de resultados, cuentas y stock en tablas alineadas.
  function signed(n) { return (n >= 0 ? '+' : '−') + fmt.money(Math.abs(n)); }
  function fzCell(label, value, sub, tone) {
    return el('div', { class: 'fz-cell' }, [
      el('span', { class: 'fz-cell-l', text: label }),
      el('span', { class: 'fz-cell-v num ' + (tone || ''), text: value }),
      sub ? el('span', { class: 'fz-cell-s', text: sub }) : null
    ]);
  }
  // Barra de una cuenta: lo vigente en azul y lo vencido en rojo, sobre la misma escala.
  function accountBar(label, total, vencido, max, href) {
    var wOk = max ? Math.max(0, (total - vencido)) / max * 100 : 0;
    var wBad = max ? vencido / max * 100 : 0;
    return el('a', { class: 'fz-acc', href: href || '#' }, [
      el('div', { class: 'fz-acc-top' }, [el('b', { text: label }), el('span', { class: 'num', text: fmt.money(total) })]),
      el('div', { class: 'fz-bar', 'aria-hidden': 'true' }, [el('i', { class: 'ok', style: 'width:' + wOk + '%' }), el('i', { class: 'bad', style: 'width:' + wBad + '%' })]),
      el('div', { class: 'fz-acc-sub ' + (vencido ? 'neg' : ''), text: vencido ? 'Vencido ' + fmt.money(vencido) : 'Sin vencidos' })
    ]);
  }

  function finanzasView(root) {
    var g = fin.globalMetrics();
    var wrap = el('div', { class: 'page econ-dashboard fz-situ' });

    // --- Resultado histórico: el número que importa, con su ecuación ---
    var potencial = g.valorEstimadoStock - g.capitalInvertido;
    wrap.appendChild(el('section', { class: 'fz-hero' }, [
      el('div', { class: 'fz-hero-main' }, [
        el('span', { class: 'fz-eyebrow', text: 'Resultado histórico del negocio' }),
        el('span', { class: 'fz-hero-v num ' + (g.resultadoNegocio >= 0 ? 'pos' : 'neg'), text: signed(g.resultadoNegocio) }),
        el('span', { class: 'fz-hero-s', text: 'Acumulado de todas las ventas menos los gastos del negocio. Para un período puntual, mirá Resúmenes.' })
      ]),
      el('div', { class: 'fz-eq' }, [
        fzCell('Ganancia por ventas', signed(g.gananciaTotal), g.autosVendidos + (g.autosVendidos === 1 ? ' vehículo vendido' : ' vehículos vendidos'), g.gananciaTotal >= 0 ? 'pos' : 'neg'),
        el('span', { class: 'fz-op', 'aria-hidden': 'true', text: '−' }),
        fzCell('Gastos del negocio', fmt.money(g.gastosFijosTotales), 'Fijos acumulados'),
        el('span', { class: 'fz-op', 'aria-hidden': 'true', text: '=' }),
        fzCell('En dólares', (g.gananciaTotalUSD >= 0 ? '+' : '−') + fmt.usd(Math.abs(g.gananciaTotalUSD)), 'Ganancia de ventas')
      ])
    ]));

    // --- Capital en stock ---
    wrap.appendChild(el('section', { class: 'fz-strip' }, [
      fzCell('Capital en stock', fmt.money(g.capitalInvertido), g.autosEnStock + (g.autosEnStock === 1 ? ' vehículo' : ' vehículos')),
      fzCell('Valor estimado del stock', fmt.money(g.valorEstimadoStock), 'Según precio pretendido'),
      fzCell('Margen potencial', signed(potencial), 'Valor estimado − capital', potencial > 0 ? 'pos' : (potencial < 0 ? 'neg' : ''))
    ]));

    // --- Cuentas pendientes: dónde está la plata ---
    var max = Math.max(g.porCobrar, g.porPagarCuotas, 1);
    var neto = g.porCobrar - g.porPagarCuotas;
    wrap.appendChild(el('section', { class: 'fz-block' }, [
      el('div', { class: 'ix-block-head' }, [
        el('h2', { text: 'Cuentas pendientes' }),
        el('a', { class: 'ctl-link', href: '#', onclick: function (e) { e.preventDefault(); economiaScreen = 'cuotas'; App.router.render(); } }, ['Cuotas y cobros', ui.icon('chevron')])
      ]),
      el('div', { class: 'fz-accs' }, [
        accountBar('Por cobrar', g.porCobrar, g.porCobrarVencido, max, '#/cuotas'),
        accountBar('Por pagar', g.porPagarCuotas, g.porPagarVencido, max, '#/cuotas'),
        el('div', { class: 'fz-net' }, [el('span', { text: 'Posición neta' }), el('b', { class: 'num ' + (neto > 0 ? 'pos' : (neto < 0 ? 'neg' : '')), text: signed(neto) })])
      ])
    ]));

    // --- Stock: inversión vs. valor estimado (tabla financiera) ---
    var enStock = store.activeVehicles().filter(function (v) { return v.estado !== 'vendido'; })
      .sort(function (a, b) { return b.createdAt - a.createdAt; });
    var stockCard = el('section', { class: 'fz-block' }, [
      el('div', { class: 'ix-block-head' }, [
        el('h2', { text: 'Stock: inversión y valor estimado' }),
        el('span', { class: 'fz-note', text: g.autosEnStock + ' de ' + g.totalVehiculos + ' vehículos' })
      ])
    ]);
    if (!enStock.length) {
      stockCard.appendChild(ui.emptyState('No hay vehículos en stock.', 'car'));
    } else {
      var rows = enStock.map(function (v) {
        var m = fin.vehicleMetrics(v);
        var dif = m.estimadoARS - m.costoTotalARS;
        return el('tr', { class: 'clickable-row', onclick: function () { location.hash = '#/vehiculo/' + v.id; } }, [
          el('td', {}, [el('a', { class: 'fin-veh', href: '#/vehiculo/' + v.id }, [
            v.patente ? el('span', { class: 'plate plate-sm', text: v.patente }) : null,
            el('span', { class: 'fin-veh-name', text: [v.marca, v.modelo, v.anio].filter(Boolean).join(' ') || store.vehicleName(v) })
          ])]),
          el('td', { class: 'num', text: fmt.money(m.costoTotalARS) }),
          el('td', { class: 'num c-valor', text: fmt.money(m.estimadoARS) }),
          el('td', { class: 'num ' + (dif > 0 ? 'pos' : (dif < 0 ? 'neg' : 'muted')), text: signed(dif) })
        ]);
      });
      stockCard.appendChild(el('div', { class: 'fin-scroll' }, el('table', { class: 'fin-table fin-stock' }, [
        el('thead', {}, el('tr', {}, [el('th', { text: 'Vehículo' }), el('th', { class: 'num', text: 'Inversión' }), el('th', { class: 'num c-valor', text: 'Valor estimado' }), el('th', { class: 'num', text: 'Diferencia' })])),
        el('tbody', {}, rows),
        el('tfoot', {}, el('tr', {}, [
          el('td', { text: 'Total' }),
          el('td', { class: 'num', text: fmt.money(g.capitalInvertido) }),
          el('td', { class: 'num c-valor', text: fmt.money(g.valorEstimadoStock) }),
          el('td', { class: 'num ' + (potencial > 0 ? 'pos' : (potencial < 0 ? 'neg' : '')), text: signed(potencial) })
        ]))
      ])));
    }
    wrap.appendChild(stockCard);

    root.appendChild(wrap);
  }

  function miniStat(label, value, tone) {
    return el('div', { class: 'mini-stat' }, [el('span', { class: 'mini-stat-label', text: label }), el('span', { class: 'mini-stat-value ' + (tone || ''), text: value })]);
  }
  function highlight(label, wrapObj, valFn) {
    if (!wrapObj || !wrapObj.v) return el('div', { class: 'card highlight muted' }, [el('span', { class: 'highlight-label', text: label }), el('span', { class: 'highlight-name', text: '—' })]);
    return el('div', { class: 'card highlight' }, [
      el('span', { class: 'highlight-label', text: label }),
      el('a', { class: 'highlight-name', href: '#/vehiculo/' + wrapObj.v.id, text: store.vehicleName(wrapObj.v) }),
      el('span', { class: 'highlight-value', text: valFn(wrapObj) })
    ]);
  }

  /* ============================== RESÚMENES ========================== */
  // Pantalla principal: resumen compacto (4 métricas + accesos). El detalle
  // que antes se mostraba todo junto (comparador, tablas mensuales/anuales,
  // estadísticas del negocio) pasó a la sub-pantalla "negocio"; el detalle
  // por vehículo es nuevo (reutiliza fin.vehicleMetrics, sin cálculos nuevos).
  // Todo sigue usando fin.periodResult/fin.monthlySeries/fin.globalMetrics
  // tal cual ya existían — solo cambió cómo se organiza la presentación.
  var resumenState = { preset: 'mes', from: '', to: '', cmpA: '', cmpB: '', screen: 'home' };
  function resumenesView(root) {
    var wrap = el('div', { class: 'page' });
    var head = pageHead('Resúmenes');

    var presets = [['hoy', 'Hoy'], ['semana', 'Esta semana'], ['mes', 'Este mes'], ['anio', 'Este año'], ['historico', 'Histórico'], ['rango', 'Rango personalizado']];
    var selPeriodo = ui.select(presets.map(function (p) { return { value: p[0], label: p[1] }; }), resumenState.preset, { class: 'input select' });
    selPeriodo.addEventListener('change', function () { resumenState.preset = selPeriodo.value; render(); });
    var periodoWrap = el('div', { class: 'resumen-period' }, [el('span', { class: 'resumen-period-ico', text: '📅' }), selPeriodo]);
    head.appendChild(periodoWrap);
    wrap.appendChild(head);

    var rangeBox = el('div', { class: 'range-box' });
    var fFrom = ui.input({ type: 'date', value: resumenState.from });
    var fTo = ui.input({ type: 'date', value: resumenState.to });
    fFrom.addEventListener('change', function () { resumenState.from = fFrom.value; render(); });
    fTo.addEventListener('change', function () { resumenState.to = fTo.value; render(); });
    rangeBox.appendChild(el('div', { class: 'inline-fields' }, [ui.field('Desde', fFrom), ui.field('Hasta', fTo)]));
    wrap.appendChild(rangeBox);

    var content = el('div', {});
    wrap.appendChild(content);
    root.appendChild(wrap);

    function currentRange() {
      switch (resumenState.preset) {
        case 'hoy': return fin.dayRange();
        case 'semana': return fin.weekRange();
        case 'mes': return fin.monthRange();
        case 'anio': return fin.yearRange();
        case 'historico': return fin.allRange();
        case 'rango': return { from: resumenState.from || null, to: resumenState.to || null };
      }
      return fin.allRange();
    }

    function goScreen(s) { resumenState.screen = s; render(); }
    function volverLink() {
      return el('a', { class: 'back-link', href: '#', html: '‹ Volver a Resúmenes', onclick: function (e) { e.preventDefault(); goScreen('home'); } });
    }
    function navCard(icon, title, desc, screen) {
      return el('div', { class: 'card resumen-nav-card', onclick: function () { goScreen(screen); } }, [
        el('span', { class: 'resumen-nav-ico', text: icon }),
        el('div', { class: 'resumen-nav-body' }, [el('strong', { text: title }), el('span', { text: desc })])
      ]);
    }

    function render() {
      var screen = resumenState.screen;
      periodoWrap.hidden = screen === 'vehiculos';
      rangeBox.hidden = screen === 'vehiculos' || resumenState.preset !== 'rango';
      ui.clear(content);

      if (screen === 'vehiculos') {
        content.appendChild(volverLink());
        content.appendChild(el('h3', { text: 'Estadísticas por vehículo', style: 'margin-top:10px' }));
        content.appendChild(vehiculosStatsCard());
        return;
      }

      if (screen === 'negocio') {
        var r2 = fin.periodResult(currentRange());
        content.appendChild(volverLink());
        content.appendChild(el('h3', { text: 'Estadísticas del negocio', style: 'margin-top:10px' }));
        content.appendChild(el('div', { class: 'card' }, dl([
          ['Período', (r2.range.from ? fmt.date(r2.range.from) : 'inicio') + '  —  ' + (r2.range.to ? fmt.date(r2.range.to) : 'hoy')],
          ['Compras registradas', r2.comprasCount],
          ['Ventas registradas', r2.ventasCount],
          ['Cuotas pagadas en el período', fmt.money(r2.cuotasPagadas)],
          ['(+) Ganancias por autos vendidos', fmt.money(r2.ganancias), r2.ganancias >= 0 ? 'pos' : 'neg'],
          ['(−) Gastos puestos en autos', fmt.money(r2.gastos)],
          ['(−) Gastos fijos del negocio', fmt.money(r2.gastosFijos)],
          ['(=) Resultado neto', fmt.money(r2.resultadoNeto), r2.resultadoNeto >= 0 ? 'pos strong' : 'neg strong']
        ])));
        content.appendChild(comparador());
        content.appendChild(tablaMensual());
        content.appendChild(tablaAnual());
        estadisticasContent().forEach(function (n) { content.appendChild(n); });
        return;
      }

      // screen === 'home': resumen compacto
      var r = fin.periodResult(currentRange());
      content.appendChild(el('div', { class: 'stat-grid stat-grid-4' }, [
        miniStat('Ventas', fmt.num(r.ventasCount)),
        miniStat('Ganancia', fmt.money(r.ganancias), r.ganancias >= 0 ? 'pos' : 'neg'),
        miniStat('Gastos', fmt.money(r.gastos + r.gastosFijos)),
        miniStat('Resultado', fmt.money(r.resultadoNeto), r.resultadoNeto >= 0 ? 'pos' : 'neg')
      ]));

      content.appendChild(el('h3', { text: 'Resumen del negocio', style: 'margin-top:6px' }));
      content.appendChild(navCard('📊', 'Ver estadísticas del negocio', 'Ver rendimiento, ventas, tiempos, resultados y otros indicadores del negocio.', 'negocio'));
      content.appendChild(navCard('🚗', 'Ver estadísticas por vehículo', 'Ver el detalle y rendimiento de cada vehículo.', 'vehiculos'));
    }

    function vehiculosStatsCard() {
      var card = el('div', { class: 'card' });
      var list = store.activeVehicles();
      if (!list.length) { card.appendChild(ui.emptyState('No hay vehículos cargados todavía.', '🚗')); return card; }
      var table = el('table', { class: 'data-table' });
      table.appendChild(el('thead', {}, el('tr', {}, ['Vehículo', 'Estado', 'Inversión', 'Venta', 'Ganancia', 'Rentabilidad', 'Días en stock'].map(function (h) { return el('th', { text: h }); }))));
      var tb = el('tbody');
      list.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).forEach(function (v) {
        var m = fin.vehicleMetrics(v);
        tb.appendChild(el('tr', { class: 'clickable-row', onclick: function () { App.router.go('vehiculo/' + v.id); } }, [
          el('td', {}, el('span', { class: 'cell-name', text: store.vehicleName(v) })),
          el('td', {}, ui.estadoBadge(v.estado)),
          el('td', { text: fmt.money(m.costoTotalARS) }),
          el('td', { text: m.vendido ? fmt.money(m.ventaARS) : '—' }),
          el('td', { class: m.vendido ? (m.gananciaARS >= 0 ? 'pos' : 'neg') : '', text: m.vendido ? ((m.gananciaARS >= 0 ? '+' : '') + fmt.money(m.gananciaARS)) : '—' }),
          el('td', { class: m.vendido ? (m.gananciaARS >= 0 ? 'pos' : 'neg') : '', text: m.vendido ? fmt.pct(m.rentabilidad) : '—' }),
          el('td', { text: fmt.days(m.diasEnStock) })
        ]));
      });
      table.appendChild(tb);
      card.appendChild(el('div', { class: 'table-wrap' }, table));
      return card;
    }

    function comparador() {
      var card = el('div', { class: 'card' });
      card.appendChild(el('h3', { text: 'Comparar períodos' }));
      var now = new Date();
      var mesesOpts = [];
      for (var i = 0; i < 24; i++) { var d = new Date(now.getFullYear(), now.getMonth() - i, 1); mesesOpts.push({ value: d.getFullYear() + '-' + pad(d.getMonth() + 1), label: fin.monthLabelLong(d) }); }
      var aniosOpts = [];
      for (var y = now.getFullYear(); y >= now.getFullYear() - 6; y--) aniosOpts.push({ value: String(y), label: String(y) });

      var modo = ui.select([{ value: 'mes', label: 'Mes contra mes' }, { value: 'anio', label: 'Año contra año' }], 'mes');
      var selA = ui.select(mesesOpts, mesesOpts[1] && mesesOpts[1].value);
      var selB = ui.select(mesesOpts, mesesOpts[0] && mesesOpts[0].value);
      var res = el('div', { class: 'cmp-result' });
      function fill() {
        var isMes = modo.value === 'mes';
        var opts = isMes ? mesesOpts : aniosOpts;
        [selA, selB].forEach(function (s, idx) {
          ui.clear(s); opts.forEach(function (o) { var op = el('option', { value: o.value }, o.label); s.appendChild(op); });
          s.selectedIndex = idx === 0 ? Math.min(1, opts.length - 1) : 0;
        });
        recompute();
      }
      function rangeFor(val) {
        if (modo.value === 'mes') { var p = val.split('-'); return fin.monthRange(new Date(+p[0], +p[1] - 1, 1)); }
        return fin.yearRange(new Date(+val, 0, 1));
      }
      function recompute() {
        var a = fin.periodResult(rangeFor(selA.value));
        var b = fin.periodResult(rangeFor(selB.value));
        ui.clear(res);
        res.appendChild(cmpTable(labelFor(selA.value), a, labelFor(selB.value), b));
      }
      function labelFor(val) {
        if (modo.value === 'mes') { var p = val.split('-'); return fin.monthLabelLong(new Date(+p[0], +p[1] - 1, 1)); }
        return val;
      }
      modo.addEventListener('change', fill);
      selA.addEventListener('change', recompute);
      selB.addEventListener('change', recompute);
      card.appendChild(el('div', { class: 'inline-fields' }, [modo, selA, el('span', { class: 'vs', text: 'vs' }), selB]));
      card.appendChild(res);
      fill();
      return card;
    }

    function cmpTable(la, a, lb, b) {
      var rows = [
        ['Ganancias por autos', a.ganancias, b.ganancias],
        ['Gastos de autos', a.gastos, b.gastos],
        ['Gastos del negocio', a.gastosFijos, b.gastosFijos],
        ['Resultado neto', a.resultadoNeto, b.resultadoNeto]
      ];
      var t = el('table', { class: 'data-table' });
      t.appendChild(el('thead', {}, el('tr', {}, [el('th', { text: 'Concepto' }), el('th', { text: la }), el('th', { text: lb }), el('th', { text: 'Diferencia' })])));
      var body = el('tbody');
      rows.forEach(function (r) {
        var diff = r[1] - r[2];
        body.appendChild(el('tr', {}, [
          el('td', { text: r[0] }),
          el('td', { text: fmt.money(r[1]) }),
          el('td', { text: fmt.money(r[2]) }),
          el('td', { class: diff >= 0 ? 'pos' : 'neg', text: (diff >= 0 ? '+' : '') + fmt.money(diff) })
        ]));
      });
      t.appendChild(body);
      return el('div', { class: 'table-wrap' }, t);
    }

    function tablaMensual() {
      var series = fin.monthlySeries(12);
      var card = el('div', { class: 'card' });
      card.appendChild(el('h3', { text: 'Resumen mensual (últimos 12 meses)' }));
      var t = el('table', { class: 'data-table' });
      t.appendChild(el('thead', {}, el('tr', {}, ['Mes', 'Ganancias', 'Gastos autos', 'Gastos negocio', 'Resultado neto'].map(function (h) { return el('th', { text: h }); }))));
      var body = el('tbody');
      series.forEach(function (mo) {
        body.appendChild(el('tr', {}, [
          el('td', { text: mo.label }),
          el('td', { class: mo.ganancias >= 0 ? 'pos' : 'neg', text: fmt.money(mo.ganancias) }),
          el('td', { text: fmt.money(mo.gastos) }),
          el('td', { text: fmt.money(mo.gastosFijos || 0) }),
          el('td', { class: mo.resultadoNeto >= 0 ? 'pos' : 'neg', text: fmt.money(mo.resultadoNeto) })
        ]));
      });
      t.appendChild(body);
      card.appendChild(el('div', { class: 'table-wrap' }, t));
      return card;
    }

    function tablaAnual() {
      var now = new Date();
      var card = el('div', { class: 'card' });
      card.appendChild(el('h3', { text: 'Resumen anual' }));
      var t = el('table', { class: 'data-table' });
      t.appendChild(el('thead', {}, el('tr', {}, ['Año', 'Ganancias', 'Gastos autos', 'Gastos negocio', 'Resultado neto'].map(function (h) { return el('th', { text: h }); }))));
      var body = el('tbody');
      for (var y = now.getFullYear(); y >= now.getFullYear() - 4; y--) {
        var r = fin.periodResult(fin.yearRange(new Date(y, 0, 1)));
        body.appendChild(el('tr', {}, [
          el('td', { text: y }),
          el('td', { class: r.ganancias >= 0 ? 'pos' : 'neg', text: fmt.money(r.ganancias) }),
          el('td', { text: fmt.money(r.gastos) }),
          el('td', { text: fmt.money(r.gastosFijos) }),
          el('td', { class: r.resultadoNeto >= 0 ? 'pos' : 'neg', text: fmt.money(r.resultadoNeto) })
        ]));
      }
      t.appendChild(body);
      card.appendChild(el('div', { class: 'table-wrap' }, t));
      return card;
    }

    render();
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ============================== HISTORIAL ========================== */
  function timeline(evts) {
    var tl = el('div', { class: 'timeline' });
    var iconMap = { compra: '🛒', venta: '💰', gasto: '🔧', cuota: '💳', estado: '🔄', edicion: '✏️', 'parte-pago': '🚗', papelera: '🗑️', restaurar: '♻️', otro: '📌' };
    evts.forEach(function (e) {
      tl.appendChild(el('div', { class: 'tl-item', onclick: function () { eventDetail(e); } }, [
        el('div', { class: 'tl-icon', text: iconMap[e.tipo] || '📌' }),
        el('div', { class: 'tl-body' }, [
          el('div', { class: 'tl-title' }, [
            el('span', { text: e.titulo }),
            e.monto != null ? el('span', { class: 'tl-monto', text: fmt.money(e.monto, e.moneda) }) : null
          ]),
          el('div', { class: 'tl-meta' }, [
            el('span', { text: fmt.date(e.fecha) }),
            e.detalle ? el('span', { text: '· ' + e.detalle }) : null
          ])
        ])
      ]));
    });
    return tl;
  }

  function eventDetail(e) {
    var v = e.vehicleId ? store.getVehicle(e.vehicleId) : null;
    ui.modal({
      title: e.titulo, size: 'sm',
      body: [dl([
        ['Fecha', fmt.date(e.fecha)],
        ['Tipo', e.tipo],
        e.monto != null ? ['Monto', fmt.money(e.monto, e.moneda)] : null,
        e.detalle ? ['Detalle', e.detalle] : null,
        ['Registrado', fmt.datetime(e.ts)]
      ]), v ? el('a', { class: 'btn btn-sm btn-primary', href: '#/vehiculo/' + v.id, text: 'Ir a ' + store.vehicleName(v), onclick: function () { setTimeout(function () { document.querySelectorAll('.modal-close')[0] && document.querySelectorAll('.modal-close')[0].click(); }, 10); } }) : null]
    });
  }

  // Historial: registro de auditoría. Qué pasó, cuándo (día y hora) y sobre
  // qué vehículo, agrupado por día. Neutro y compacto; cada fila abre el mismo
  // detalle de siempre. (El registro actual no guarda qué usuario hizo cada
  // cambio, por eso no se muestra "quién".)
  var AU_TIPOS = [['', 'Todos'], ['compra', 'Compras'], ['venta', 'Ventas'], ['gasto', 'Gastos'], ['cuota', 'Cuotas'], ['estado', 'Cambios de estado'], ['parte-pago', 'Parte de pago'], ['edicion', 'Ediciones']];
  var AU_LABEL = { compra: 'Compra', venta: 'Venta', gasto: 'Gasto', cuota: 'Cuota', estado: 'Estado', edicion: 'Edición', 'parte-pago': 'Parte de pago', papelera: 'Papelera', restaurar: 'Restauración', otro: 'Registro', 'gasto-fijo': 'Gasto del negocio' };
  var AU_ICON = { compra: 'receipt', venta: 'tag', gasto: 'wrench', cuota: 'card', estado: 'swap', edicion: 'file', 'parte-pago': 'car', papelera: 'trash', restaurar: 'swap', otro: 'activity', 'gasto-fijo': 'briefcase' };
  var auFiltro = { tipo: '', q: '' };
  function auDay(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function auDayLabel(iso) {
    var r = fmt.relative(iso);
    var d = fin.parseDate(iso);
    var long = d ? d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }) : iso;
    long = long.charAt(0).toUpperCase() + long.slice(1);
    return (r === 'hoy' ? 'Hoy' : (r === 'ayer' ? 'Ayer' : null)) ? ((r === 'hoy' ? 'Hoy' : 'Ayer') + ' · ' + long) : long;
  }
  function historialView(root) {
    var wrap = el('div', { class: 'page au' });
    var evts = store.getHistory();
    var count = el('p', { class: 'au-sub' });
    wrap.appendChild(el('header', { class: 'au-head' }, [el('div', {}, [el('h1', { text: 'Historial' }), count])]));

    var q = ui.input({ value: auFiltro.q, placeholder: 'Buscar por detalle, vehículo o patente', class: 'input' });
    wrap.appendChild(el('label', { class: 'dms-search au-search' }, [ui.icon('search'), q]));
    var tabs = AU_TIPOS.map(function (t) {
      var b = el('button', { type: 'button', class: 'dms-view', dataset: { t: t[0] }, text: t[1] });
      b.addEventListener('click', function () { auFiltro.tipo = t[0]; draw(); });
      return b;
    });
    wrap.appendChild(el('div', { class: 'dms-views au-tabs', role: 'tablist' }, tabs));
    q.addEventListener('input', function () { auFiltro.q = q.value; draw(); });
    var box = el('div', { class: 'au-log' });
    wrap.appendChild(box);

    function vehOf(e) { return e.vehicleId ? store.getVehicle(e.vehicleId) : null; }
    function draw() {
      tabs.forEach(function (b) { var on = b.dataset.t === auFiltro.tipo; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      var term = auFiltro.q.trim().toLowerCase();
      var list = evts.filter(function (e) {
        if (auFiltro.tipo && e.tipo !== auFiltro.tipo) return false;
        if (term) {
          var v = vehOf(e);
          var hay = [e.titulo, e.detalle, v ? store.vehicleName(v) : '', v ? v.patente : ''].join(' ').toLowerCase();
          if (hay.indexOf(term) < 0) return false;
        }
        return true;
      });
      count.textContent = list.length + (list.length === 1 ? ' movimiento' : ' movimientos') + (list.length !== evts.length ? ' de ' + evts.length : '') + ' · del más reciente al más antiguo';
      ui.clear(box);
      if (!list.length) { box.appendChild(ui.emptyState('Sin movimientos.', 'activity')); return; }
      var lastDay = null, sec = null, n = 0;
      list.forEach(function (e) {
        var day = auDay(e.ts);
        if (day !== lastDay) {
          sec = el('section', { class: 'au-day' }, [el('h3', { class: 'au-day-h', text: auDayLabel(day) })]);
          box.appendChild(sec); lastDay = day;
        }
        var d = new Date(e.ts);
        var v = vehOf(e);
        var fechaOp = e.fecha && e.fecha !== day ? 'Fecha de la operación ' + fmt.date(e.fecha) : '';
        sec.appendChild(el('div', { class: 'au-row', tabindex: '0', onclick: function () { eventDetail(e); }, onkeydown: function (ev) { if (ev.key === 'Enter') eventDetail(e); } }, [
          el('span', { class: 'au-time num', text: pad(d.getHours()) + ':' + pad(d.getMinutes()) }),
          el('span', { class: 'au-ico', title: AU_LABEL[e.tipo] || 'Registro' }, ui.icon(AU_ICON[e.tipo] || 'activity')),
          el('span', { class: 'au-what' }, [
            el('b', { class: 'au-title', text: e.titulo }),
            el('span', { class: 'au-meta', text: [AU_LABEL[e.tipo] || 'Registro', e.detalle, fechaOp].filter(Boolean).join(' · ') })
          ]),
          el('span', { class: 'au-on' }, v ? [
            el('a', { class: 'au-veh', href: '#/vehiculo/' + v.id, onclick: function (ev) { ev.stopPropagation(); } }, [
              v.patente ? el('span', { class: 'plate plate-sm', text: v.patente }) : null,
              el('span', { text: [v.marca, v.modelo].filter(Boolean).join(' ') || store.vehicleName(v) })
            ])
          ] : null),
          el('span', { class: 'au-amt num', text: e.monto != null ? fmt.money(e.monto, e.moneda) : '' })
        ]));
        n++;
      });
    }
    draw();
    root.appendChild(wrap);
  }

  /* ==================== COMPARACIÓN DEL VALOR SEGÚN EL DÓLAR ========= */
  // Junta, sin guardar nada nuevo, todas las ventas (compradas o en
  // consignación) que tengan una comparación en dólares calculable —
  // se arma en el momento con fin.dollarComparison() sobre los datos
  // reales, así que no hay que volver a cargar nada a mano.
  function comparacionesVendidas() {
    var out = [];
    store.activeVehicles().forEach(function (v) {
      if (!v.sale || !v.sale.precio) return;
      var c = fin.dollarComparison(v);
      if (c && c.venta) out.push({ v: v, c: c });
    });
    return out;
  }

  var historialCmpState = { q: '', sort: 'fecha-desc', filtro: 'todos' };
  function historialComparacionesView(panel, volver) {
    var wrap = el('div', {});
    wrap.appendChild(el('a', { class: 'back-link', href: '#', html: '‹ Volver a Comparar dólar', onclick: function (e) { e.preventDefault(); volver(); } }));
    wrap.appendChild(el('h1', { text: 'Historial de comparaciones', style: 'margin-top:6px' }));
    wrap.appendChild(el('p', { class: 'page-sub', text: 'Ventas con comparación en dólares, calculado con los datos reales de cada operación.' }));

    var searchInput = ui.input({ value: historialCmpState.q, placeholder: 'Buscar vehículo...', class: 'input search-input' });
    var sortSel = ui.select([
      { value: 'fecha-desc', label: 'Más reciente' }, { value: 'fecha-asc', label: 'Más antiguo' },
      { value: 'resultado-desc', label: 'Mayor ganancia' }, { value: 'resultado-asc', label: 'Mayor pérdida' }
    ], historialCmpState.sort, { class: 'input select sort-select' });
    var filtroSeg = el('div', { class: 'seg-control' }, [
      el('button', { class: 'seg' + (historialCmpState.filtro === 'todos' ? ' is-active' : ''), text: 'Todos', onclick: function () { historialCmpState.filtro = 'todos'; draw(); } }),
      el('button', { class: 'seg' + (historialCmpState.filtro === 'ganancia' ? ' is-active' : ''), text: 'Ganancias', onclick: function () { historialCmpState.filtro = 'ganancia'; draw(); } }),
      el('button', { class: 'seg' + (historialCmpState.filtro === 'perdida' ? ' is-active' : ''), text: 'Pérdidas', onclick: function () { historialCmpState.filtro = 'perdida'; draw(); } })
    ]);
    wrap.appendChild(el('div', { class: 'toolbar' }, [
      el('div', { class: 'toolbar-search' }, searchInput),
      el('div', { class: 'toolbar-actions' }, [sortSel])
    ]));
    wrap.appendChild(filtroSeg);

    var listWrap = el('div', { class: 'vehicle-list' });
    var countEl = el('span', { class: 'count-tag' });
    wrap.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h3', { text: 'Ventas comparadas' }), countEl]),
      listWrap
    ]));

    searchInput.addEventListener('input', function () { historialCmpState.q = searchInput.value; draw(); });
    sortSel.addEventListener('change', function () { historialCmpState.sort = sortSel.value; draw(); });

    function draw() {
      ui.qsa('.seg', filtroSeg).forEach(function (b) { b.classList.toggle('is-active', b.textContent === ({ todos: 'Todos', ganancia: 'Ganancias', perdida: 'Pérdidas' })[historialCmpState.filtro]); });
      var all = comparacionesVendidas();
      var q = historialCmpState.q.trim().toLowerCase();
      var list = all.filter(function (x) {
        if (q && store.vehicleName(x.v).toLowerCase().indexOf(q) < 0) return false;
        var gan = x.c.venta.gananciaUSD || 0;
        if (historialCmpState.filtro === 'ganancia' && gan < 0) return false;
        if (historialCmpState.filtro === 'perdida' && gan >= 0) return false;
        return true;
      });
      list.sort(function (a, b) {
        if (historialCmpState.sort === 'fecha-asc') return (a.v.sale.fecha || '').localeCompare(b.v.sale.fecha || '');
        if (historialCmpState.sort === 'fecha-desc') return (b.v.sale.fecha || '').localeCompare(a.v.sale.fecha || '');
        var ga = a.c.venta.gananciaUSD || 0, gb = b.c.venta.gananciaUSD || 0;
        return historialCmpState.sort === 'resultado-desc' ? gb - ga : ga - gb;
      });
      ui.clear(listWrap);
      countEl.textContent = list.length + ' de ' + all.length;
      if (!list.length) { listWrap.appendChild(ui.emptyState('No hay ventas con comparación en dólares todavía.', '💵')); return; }
      list.forEach(function (x) { listWrap.appendChild(cmpHistItem(x.v, x.c)); });
    }
    draw();

    panel.appendChild(wrap);
  }

  function cmpHistItem(v, c) {
    var vv = c.venta;
    var gan = vv.gananciaUSD;
    var pos = (gan || 0) >= 0;
    return el('a', { class: 'cmp-hist-item', href: '#/vehiculo/' + v.id }, [
      el('div', { class: 'cmp-hist-main' }, [
        el('div', { class: 'cmp-hist-top' }, [
          el('span', { class: 'row-name', text: store.vehicleName(v) }),
          el('span', { class: 'cmp-hist-result ' + (pos ? 'pos' : 'neg'), text: gan != null ? ((pos ? '+' : '') + fmt.usd(gan)) : '—' })
        ]),
        el('div', { class: 'cmp-hist-detail' }, [
          el('span', { text: 'Compra ' + (c.valorUSD != null ? fmt.usd(c.valorUSD) : '—') }),
          el('span', { text: '→' }),
          el('span', { text: 'Venta ' + (vv.valorUSDVenta != null ? fmt.usd(vv.valorUSDVenta) : '—') })
        ]),
        el('div', { class: 'home-stock-meta' }, [
          el('span', { text: 'Vendido: ' + fmt.date(v.sale.fecha) }),
          el('span', { text: 'Dólar compra: ' + (c.dolarCompra ? fmt.money(c.dolarCompra) : '—') }),
          el('span', { text: 'Dólar venta: ' + (vv.dolarVenta ? fmt.money(vv.dolarVenta) : '—') })
        ])
      ]),
      el('span', { class: 'pill ' + (pos ? 'pill-ok' : 'pill-danger'), text: pos ? 'Ganancia' : 'Pérdida' })
    ]);
  }

  function comparacionView(root, preselectId) {
    var wrap = el('div', { class: 'page' });
    var panel = el('div', {});

    var vehicles = store.getState().vehicles.filter(function (v) { return v.purchase || (v.origin && v.origin.type === 'consignacion'); }); // incluye vendidos y en papelera (info histórica)
    if (!vehicles.length) {
      wrap.appendChild(pageHead('Comparación del valor según el dólar', 'Analizá cómo cambió el valor de un auto teniendo en cuenta la variación del dólar'));
      wrap.appendChild(ui.emptyState('No hay vehículos con compra o consignación registrada para comparar.', '💵'));
      root.appendChild(wrap); return;
    }

    function showMain() { ui.clear(panel); renderMain(); }
    function showHistorial() { ui.clear(panel); historialComparacionesView(panel, showMain); }
    renderMain();
    wrap.appendChild(panel);
    root.appendChild(wrap);

    function renderMain() {
    var head = pageHead('Comparación del valor según el dólar', 'Analizá cómo cambió el valor de un auto teniendo en cuenta la variación del dólar');
    head.appendChild(el('button', { class: 'btn btn-ghost', html: '<span>📜</span> Historial de comparaciones', onclick: showHistorial }));
    panel.appendChild(head);

    var sel = ui.select(vehicles.map(function (v) {
      return { value: v.id, label: store.vehicleName(v) + (v.deleted ? ' (papelera)' : '') + (v.estado === 'vendido' ? ' · vendido' : '') };
    }), preselectId || vehicles[0].id);
    var fDolar = ui.moneyInput({ value: store.getState().settings.dolarActual || '', placeholder: 'Cotización actual del dólar' });
    var result = el('div', { class: 'cmp-dollar-result' });

    function calc() {
      var v = store.getVehicle(sel.value);
      var dolarActual = store.num(fDolar.value) || store.getState().settings.dolarActual;
      var c = fin.dollarComparison(v, dolarActual);
      ui.clear(result);
      if (!c) { result.appendChild(ui.emptyState('El vehículo no tiene datos de compra suficientes.', '⚠️')); return; }

      // bloque principal: valor actualizado según dólar
      var diff = c.diferenciaARS;
      result.appendChild(el('div', { class: 'card cmp-main ' + (diff == null ? '' : (diff >= 0 ? 'is-pos' : 'is-neg')) }, [
        el('h3', { text: 'Valor del auto según el dólar' }),
        el('div', { class: 'cmp-breakdown' }, [
          el('span', { text: 'Precio de compra ' + fmt.money(c.compraARS) }),
          el('span', { text: '+ Gastos ' + fmt.money(c.gastosARS) }),
          el('strong', { text: '= Inversión total ' + fmt.money(c.inversionARS) })
        ]),
        el('div', { class: 'cmp-grid' }, [
          cmpItem('Inversión total (compra + gastos)', fmt.money(c.inversionARS), 'histórico'),
          cmpItem('Dólar de compra', c.dolarCompra ? fmt.money(c.dolarCompra) : '—', 'histórico'),
          cmpItem('Valor equivalente en USD', c.valorUSD != null ? fmt.usd(c.valorUSD) : '—', 'calculado', '', c.gastosUSD ? ('compra ' + fmt.usd(c.compraUSD) + ' + gastos ' + fmt.usd(c.gastosUSD)) : ''),
          cmpItem('Dólar actual', fmt.money(c.dolarActual), 'ingresado'),
          cmpItem('Valor actualizado según dólar', c.valorActualizadoARS != null ? fmt.money(c.valorActualizadoARS) : '—', 'calculado'),
          cmpItem('Diferencia', diff != null ? ((diff >= 0 ? '+' : '') + fmt.money(diff)) : '—', '', diff == null ? '' : (diff >= 0 ? 'pos' : 'neg'))
        ]),
        diff != null ? el('div', { class: 'cmp-verdict ' + (diff >= 0 ? 'pos' : 'neg') }, [
          el('span', { class: 'cmp-verdict-tag', text: diff >= 0 ? 'GANANCIA' : 'PÉRDIDA' }),
          el('span', { text: 'de ' + fmt.money(Math.abs(diff)) + ' medida en dólares (inversión total)' })
        ]) : null,
        el('p', { class: 'cmp-formula', html: 'Cálculo: <code>' + (c.valorUSD != null ? fmt.usd(c.valorUSD) : '?') + ' (inversión en USD) × ' + fmt.money(c.dolarActual) + ' (dólar actual) = ' + (c.valorActualizadoARS != null ? fmt.money(c.valorActualizadoARS) : '?') + '</code> &nbsp;→&nbsp; <code>' + (c.valorActualizadoARS != null ? fmt.money(c.valorActualizadoARS) : '?') + ' − ' + fmt.money(c.inversionARS) + ' (inversión) = ' + (diff != null ? ((diff >= 0 ? '+' : '') + fmt.money(diff)) : '?') + '</code>' })
      ]));

      // bloque venta (si corresponde)
      if (c.venta) {
        var vv = c.venta;
        result.appendChild(el('div', { class: 'card' }, [
          el('h3', { text: 'Comparación real: inversión vs venta' }),
          el('div', { class: 'cmp-two-col' }, [
            el('div', { class: 'cmp-col' }, [el('h4', { text: 'Inversión (compra + gastos)' }), dl([
              ['Precio de compra', fmt.money(c.compraARS)],
              ['Gastos', fmt.money(c.gastosARS)],
              ['Inversión total en pesos', fmt.money(c.inversionARS), 'strong'],
              ['Dólar de compra', c.dolarCompra ? fmt.money(c.dolarCompra) : '—'],
              ['Inversión total en USD', c.valorUSD != null ? fmt.usd(c.valorUSD) : '—']
            ])]),
            el('div', { class: 'cmp-col' }, [el('h4', { text: 'Venta' }), dl([
              ['Precio en pesos', fmt.money(vv.ventaARS)],
              ['Dólar de venta', vv.dolarVenta ? fmt.money(vv.dolarVenta) : '—'],
              ['Valor en USD', vv.valorUSDVenta != null ? fmt.usd(vv.valorUSDVenta) : '—']
            ])])
          ]),
          dl([
            ['Ganancia / pérdida nominal en pesos', (vv.gananciaNominalARS >= 0 ? '+' : '') + fmt.money(vv.gananciaNominalARS), vv.gananciaNominalARS >= 0 ? 'pos strong' : 'neg strong'],
            ['Ganancia / pérdida en dólares', vv.gananciaUSD != null ? ((vv.gananciaUSD >= 0 ? '+' : '') + fmt.usd(vv.gananciaUSD)) : '—', (vv.gananciaUSD || 0) >= 0 ? 'pos' : 'neg'],
            ['Porcentaje de variación en dólares', vv.variacionUSDPct != null ? fmt.pct(vv.variacionUSDPct) : '—', (vv.gananciaUSD || 0) >= 0 ? 'pos' : 'neg'],
            ['Diferencia explicada por la variación del dólar', vv.efectoDolarARS != null ? ((vv.efectoDolarARS >= 0 ? '+' : '') + fmt.money(vv.efectoDolarARS)) : '—', (vv.efectoDolarARS || 0) >= 0 ? 'pos' : 'neg']
          ]),
          el('div', { class: 'cmp-explain' }, [
            el('p', { html: '<strong>Cómo leer esto:</strong>' }),
            el('ul', {}, [
              el('li', { text: 'La ganancia nominal en pesos es lo que ganaste "en números", sin ajustar por inflación ni dólar.' }),
              el('li', { text: 'La ganancia en dólares muestra si tu capital creció medido en moneda dura.' }),
              el('li', { text: 'La diferencia explicada por el dólar aísla cuánto de la ganancia (o pérdida) se debe sólo a que el dólar cambió entre la compra y la venta.' })
            ])
          ])
        ]));
      }
    }

    sel.addEventListener('change', calc);
    fDolar.addEventListener('input', calc);

    panel.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'grid-2' }, [
        ui.field('Elegí un auto', sel),
        ui.field('Cotización actual del dólar', fDolar, 'Se ingresa manualmente y no modifica ningún valor histórico')
      ])
    ]));
    panel.appendChild(result);
    calc();
    }
  }
  function cmpItem(label, value, tag, tone, note) {
    return el('div', { class: 'cmp-item' }, [
      el('span', { class: 'cmp-item-label', text: label }),
      el('span', { class: 'cmp-item-value ' + (tone || ''), text: value }),
      note ? el('span', { class: 'cmp-item-note', text: note }) : null,
      tag ? el('span', { class: 'cmp-item-tag tag-' + tag, text: tag }) : null
    ]);
  }

  /* ========================= CLIENTES Y PROVEEDORES ================= */
  function contactosView(root) {
    // Agenda profesional: lista de personas a la izquierda (buscable) y, a la
    // derecha, la ficha simple de la persona elegida con su teléfono y las
    // operaciones en las que participó. Mismos datos de siempre: clientes
    // salen de las ventas y proveedores de las compras.
    var people = [];
    var idx = { cliente: {}, proveedor: {} };
    function add(tipo, p, op) {
      var k = p.nombre.toLowerCase();
      var e = idx[tipo][k];
      if (!e) { e = idx[tipo][k] = { tipo: tipo, key: tipo + ':' + k, nombre: p.nombre, telefono: p.telefono, ops: [] }; people.push(e); }
      e.ops.push(op);
    }
    store.activeVehicles().forEach(function (v) {
      if (v.sale && v.sale.cliente && v.sale.cliente.nombre) {
        add('cliente', v.sale.cliente, { v: v, fecha: v.sale.fecha, monto: fin.vehicleMetrics(v).ventaARS, tipo: 'Compró' });
      }
      if (v.purchase && v.purchase.proveedor && v.purchase.proveedor.nombre) {
        add('proveedor', v.purchase.proveedor, { v: v, fecha: v.purchase.fecha, monto: fin.vehicleMetrics(v).compraARS, tipo: 'Vendió' });
      }
    });
    people.forEach(function (p) { p.total = p.ops.reduce(function (s, o) { return s + o.monto; }, 0); });
    people.sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });

    var wrap = el('div', { class: 'page ag' });
    wrap.appendChild(el('header', { class: 'ag-head' }, [
      el('h1', { text: 'Clientes y proveedores' }),
      el('p', { class: 'ag-sub', text: people.length ? people.length + (people.length === 1 ? ' persona' : ' personas') + ' con las que operaste' : 'Las personas con las que operaste' })
    ]));

    if (!people.length) {
      wrap.appendChild(el('div', { class: 'ix-clear' }, [ui.icon('users'), el('div', {}, [el('strong', { text: 'Todavía no hay contactos' }), el('span', { text: 'Se arman solos con el cliente de cada venta y el vendedor de cada compra.' })])]));
      root.appendChild(wrap); return;
    }

    // Teléfono tocable: llamar siempre que haya número; WhatsApp además
    // cuando parece un celular argentino (10 dígitos, área sin 0/15 — el
    // mismo formato en el que ya se cargan los teléfonos en la app).
    function phoneButtons(telefono) {
      if (!telefono) return null;
      var digits = telefono.replace(/\D/g, '');
      if (!digits) return null;
      var kids = [el('a', { class: 'btn btn-sm btn-ghost', href: 'tel:' + digits, title: 'Llamar' }, [ui.icon('phone'), el('span', { text: 'Llamar' })])];
      if (digits.length === 10) kids.push(el('a', { class: 'btn btn-sm btn-ghost', href: 'https://wa.me/549' + digits, target: '_blank', rel: 'noopener', title: 'WhatsApp' }, [ui.icon('message'), el('span', { text: 'WhatsApp' })]));
      return el('div', { class: 'ag-phone-btns' }, kids);
    }
    function initials(n) {
      var w = n.trim().split(/\s+/).filter(Boolean);
      return ((w[0] || '?').charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : '')).toUpperCase();
    }
    var TIPO_L = { cliente: 'Cliente', proveedor: 'Proveedor' };

    var state = { q: '', tipo: 'todos', sel: null };
    var desktop = window.matchMedia && window.matchMedia('(min-width: 901px)').matches;

    var q = ui.input({ placeholder: 'Buscar por nombre o teléfono', class: 'input' });
    var seg = el('div', { class: 'ag-seg', role: 'tablist' }, [['todos', 'Todos'], ['cliente', 'Clientes'], ['proveedor', 'Proveedores']].map(function (t) {
      var b = el('button', { type: 'button', class: 'ag-seg-b', dataset: { t: t[0] }, text: t[1] });
      b.addEventListener('click', function () { state.tipo = t[0]; drawList(); });
      return b;
    }));
    var listBox = el('div', { class: 'ag-items' });
    var detail = el('section', { class: 'ag-detail' });
    var layout = el('div', { class: 'ag-layout' }, [
      el('div', { class: 'ag-list' }, [el('label', { class: 'dms-search' }, [ui.icon('search'), q]), seg, listBox]),
      detail
    ]);
    wrap.appendChild(layout);
    q.addEventListener('input', function () { state.q = q.value; drawList(); });

    function filtered() {
      var term = state.q.trim().toLowerCase();
      var digits = term.replace(/\D/g, '');
      return people.filter(function (p) {
        if (state.tipo !== 'todos' && p.tipo !== state.tipo) return false;
        if (!term) return true;
        return p.nombre.toLowerCase().indexOf(term) >= 0 || (digits && (p.telefono || '').replace(/\D/g, '').indexOf(digits) >= 0);
      });
    }
    function drawList() {
      Array.prototype.forEach.call(seg.children, function (b) { var on = b.dataset.t === state.tipo; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      ui.clear(listBox);
      var items = filtered();
      if (!items.length) { listBox.appendChild(el('p', { class: 'ag-none', text: 'No hay personas que coincidan.' })); return; }
      var lastL = null;
      items.forEach(function (p) {
        var L = p.nombre.charAt(0).toUpperCase();
        if (L !== lastL) { listBox.appendChild(el('div', { class: 'ag-letter', text: L })); lastL = L; }
        listBox.appendChild(el('button', { type: 'button', class: 'ag-item' + (state.sel === p.key ? ' is-active' : ''), onclick: function () { state.sel = p.key; layout.classList.add('ag-has-sel'); drawList(); drawDetail(); } }, [
          el('span', { class: 'ag-av ag-av-' + p.tipo, text: initials(p.nombre) }),
          el('span', { class: 'ag-item-t' }, [el('b', { text: p.nombre }), el('small', { text: (p.telefono || 'Sin teléfono') + ' · ' + p.ops.length + (p.ops.length === 1 ? ' operación' : ' operaciones') })]),
          el('span', { class: 'ag-tag ag-tag-' + p.tipo, text: TIPO_L[p.tipo] })
        ]));
      });
    }
    function drawDetail() {
      ui.clear(detail);
      var p = people.filter(function (x) { return x.key === state.sel; })[0];
      if (!p) { detail.appendChild(el('div', { class: 'ag-empty' }, [ui.icon('users'), el('p', { text: 'Elegí una persona para ver sus datos y operaciones.' })])); return; }
      detail.appendChild(el('button', { type: 'button', class: 'ag-back', onclick: function () { layout.classList.remove('ag-has-sel'); } }, [ui.icon('back'), el('span', { text: 'Contactos' })]));
      detail.appendChild(el('div', { class: 'ag-card-head' }, [
        el('span', { class: 'ag-av ag-av-lg ag-av-' + p.tipo, text: initials(p.nombre) }),
        el('div', { class: 'ag-card-id' }, [
          el('h2', { text: p.nombre }),
          el('div', { class: 'ag-card-meta' }, [el('span', { class: 'ag-tag ag-tag-' + p.tipo, text: TIPO_L[p.tipo] }), el('span', { class: 'num', text: p.telefono || 'Sin teléfono cargado' })])
        ])
      ]));
      var pb = phoneButtons(p.telefono); if (pb) detail.appendChild(pb);
      detail.appendChild(el('div', { class: 'ag-summary' }, [
        el('div', {}, [el('small', { text: 'Operaciones' }), el('b', { class: 'num', text: p.ops.length })]),
        el('div', {}, [el('small', { text: p.tipo === 'cliente' ? 'Total comprado' : 'Total vendido a vos' }), el('b', { class: 'num', text: fmt.money(p.total) })])
      ]));
      detail.appendChild(el('h3', { class: 'ag-h3', text: 'Operaciones' }));
      detail.appendChild(el('div', { class: 'ag-ops' }, p.ops.slice().sort(function (a, b) { return (b.fecha || '').localeCompare(a.fecha || ''); }).map(function (o) {
        return el('a', { class: 'ag-op', href: '#/vehiculo/' + o.v.id }, [
          el('span', { class: 'ag-op-t' }, [el('b', { text: o.tipo + ' ' + ([o.v.marca, o.v.modelo, o.v.anio].filter(Boolean).join(' ') || store.vehicleName(o.v)) }), o.v.patente ? el('span', { class: 'plate plate-sm', text: o.v.patente }) : null]),
          el('span', { class: 'ag-op-d num', text: fmt.date(o.fecha) }),
          el('span', { class: 'ag-op-m num', text: fmt.money(o.monto) }),
          ui.icon('chevron', 'ag-op-go')
        ]);
      })));
    }
    if (desktop) { state.sel = people[0].key; layout.classList.add('ag-has-sel'); }
    drawList(); drawDetail();
    root.appendChild(wrap);
  }

  /* ====================== ESTADÍSTICAS (dentro de Resúmenes) ========= */
  // Indicadores clave del negocio. Se muestran integrados en la sección Resúmenes.
  // Contenido idéntico al original: mismas tarjetas, métricas, textos y estructura.
  function estadisticasContent() {
    var g = fin.globalMetrics();
    return [
      el('div', { class: 'stats-block-head' }, [
        el('h3', { text: 'Estadísticas' }),
        el('p', { class: 'page-sub', text: 'Indicadores clave del negocio' })
      ]),
      // "Ganancia total" se sacó de acá: es el mismo número que ya se ve
      // como "Ganancia obtenida" en Situación económica (fin.globalMetrics()
      // en ambos casos) — no tiene sentido mostrarlo dos veces con nombres
      // distintos.
      el('div', { class: 'grid-3' }, [
        miniStat('Autos vendidos', fmt.num(g.autosVendidos)),
        miniStat('Autos en stock', fmt.num(g.autosEnStock)),
        miniStat('Ganancia promedio', fmt.money(g.gananciaPromedio))
      ]),
      el('div', { class: 'grid-2 highlight-grid' }, [
        highlight('Auto más rentable', g.masRentable, function (x) { return fmt.pct(x.m.rentabilidad); }),
        highlight('Auto menos rentable', g.menosRentable, function (x) { return fmt.pct(x.m.rentabilidad); }),
        highlight('Mayor ganancia', g.mayorGanancia, function (x) { return fmt.money(x.m.gananciaARS); }),
        highlight('Menor ganancia', g.menorGanancia, function (x) { return fmt.money(x.m.gananciaARS); }),
        highlight('Mayor venta', g.mayorVenta, function (x) { return fmt.money(x.m.ventaARS); }),
        g.mayorGasto ? el('div', { class: 'card highlight' }, [
          el('span', { class: 'highlight-label', text: 'Mayor gasto' }),
          el('a', { class: 'highlight-name', href: '#/vehiculo/' + g.mayorGasto.vehicle.id, text: store.vehicleName(g.mayorGasto.vehicle) }),
          el('span', { class: 'highlight-value', text: fmt.money(g.mayorGasto.ars) })
        ]) : null,
        highlight('Más tardó en venderse', g.masTiempoStock, function (x) { return fmt.days(x.m.diasEnStock); }),
        highlight('Vendido más rápido', g.vendidoMasRapido, function (x) { return fmt.days(x.m.diasEnStock); })
      ])
    ];
  }

  /* ========================== CUOTAS Y COBROS ====================== */
  // "Cuotas" (lo que pagás) y "Cobros" (lo que te pagan) se muestran de a
  // una por vez mediante un selector interno, para no mostrar todo junto.
  // Reutiliza tal cual totals()/block() de siempre — ningún dato ni cálculo
  // nuevo, solo se decide cuál de los dos bloques se dibuja.
  var cuotasSubTab = 'pagar';
  /* ===================== CUOTAS Y COBROS (cobranza) ==================== */
  // Seguimiento de cobranza: a quién cobrar / a quién pagar, cuánto y cuándo.
  // Mismos datos (fin.allInstallments) y mismas acciones ("Pagué" / "Me
  // pagaron") — solo cambia la presentación: lista agrupada por urgencia.
  function cuotasView(root) {
    var wrap = el('div', { class: 'page cb' });
    var hoy = store.todayISO();
    var inst = fin.allInstallments();
    var lim = new Date(); lim.setDate(lim.getDate() + (store.getState().settings.cuotaProximaDias || 7));
    var limIso = lim.getFullYear() + '-' + pad(lim.getMonth() + 1) + '-' + pad(lim.getDate());

    function totals(list) {
      var t = { total: 0, hecho: 0, falta: 0, vencido: 0 };
      list.forEach(function (it) {
        t.total += it.montoARS;
        if (it.estado === 'pagada' || it.estado === 'cobrada') t.hecho += it.montoARS;
        else { t.falta += it.montoARS; if (it.estado === 'vencida') t.vencido += it.montoARS; }
      });
      return t;
    }
    var tP = totals(inst.pagar), tC = totals(inst.cobrar);

    wrap.appendChild(el('header', { class: 'cb-head' }, [
      el('h1', { text: 'Cuotas y cobros' }),
      el('p', { class: 'cb-sub', text: 'A quién cobrar, a quién pagar y cuándo.' })
    ]));

    var TABS = [['pagar', 'Por pagar', tP], ['cobrar', 'Por cobrar', tC]];
    var tabBtns = TABS.map(function (t) {
      var b = el('button', { type: 'button', class: 'cb-tab', dataset: { tab: t[0] } }, [
        el('span', { class: 'cb-tab-l', text: t[1] }),
        el('strong', { class: 'cb-tab-v num', text: fmt.money(t[2].falta) }),
        el('span', { class: 'cb-tab-s ' + (t[2].vencido ? 'neg' : ''), text: t[2].vencido ? 'Vencido ' + fmt.money(t[2].vencido) : (t[2].total ? 'Sin vencidos' : 'Sin cuotas') })
      ]);
      b.addEventListener('click', function () { cuotasSubTab = t[0]; draw(); });
      return b;
    });
    wrap.appendChild(el('div', { class: 'cb-tabs', role: 'tablist' }, tabBtns));
    var content = el('div', { class: 'cb-content' });
    wrap.appendChild(content);

    function dayParts(iso) {
      var d = fin.parseDate(iso);
      if (!d) return { n: '–', m: '' };
      return { n: String(d.getDate()), m: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][d.getMonth()] };
    }

    function row(it, tipo, listAll) {
      var c = it.cuota, v = it.vehicle;
      var done = it.estado === 'pagada' || it.estado === 'cobrada';
      var persona;
      if (tipo === 'pagar') persona = (v.purchase && v.purchase.proveedor && v.purchase.proveedor.nombre) || 'Sin proveedor cargado';
      else persona = (v.sale && v.sale.cliente && v.sale.cliente.nombre) || (v.sale && v.sale.financiacion && v.sale.financiacion.entidad) || 'Sin cliente cargado';
      var total = listAll.filter(function (x) { return x.vehicle.id === v.id; }).length;
      var dp = dayParts(it.vencimiento);
      var tone = done ? 'done' : (it.estado === 'vencida' ? 'overdue' : (it.vencimiento && it.vencimiento <= limIso ? 'soon' : 'later'));
      var whenTxt = done ? ('Hecha' + ((c.fechaPago || c.fechaCobro) ? ' el ' + fmt.date(c.fechaPago || c.fechaCobro) : '')) : (it.vencimiento ? (tone === 'overdue' ? 'Venció ' : 'Vence ') + fmt.relative(it.vencimiento) : 'Sin fecha');
      return el('div', { class: 'cb-row cb-' + tone }, [
        el('div', { class: 'cb-when' }, [el('b', { class: 'num', text: dp.n }), el('small', { text: dp.m })]),
        el('a', { class: 'cb-main', href: '#/vehiculo/' + v.id + '?tab=economia' }, [
          el('span', { class: 'cb-person', text: persona }),
          el('span', { class: 'cb-veh' }, [
            el('span', { text: [v.marca, v.modelo, v.anio].filter(Boolean).join(' ') || store.vehicleName(v) }),
            v.patente ? el('span', { class: 'plate plate-sm', text: v.patente }) : null,
            el('span', { class: 'cb-n', text: 'Cuota ' + c.numero + ' de ' + total })
          ]),
          el('span', { class: 'cb-due', text: whenTxt })
        ]),
        el('div', { class: 'cb-amt' }, [
          el('strong', { class: 'num', text: fmt.money(c.monto, it.moneda) }),
          it.moneda === 'USD' ? el('small', { class: 'num', text: '≈ ' + fmt.money(it.montoARS) }) : null
        ]),
        el('div', { class: 'cb-act' }, done ? el('span', { class: 'cb-ok' }, [ui.icon('check'), el('span', { text: tipo === 'pagar' ? 'Pagada' : 'Cobrada' })])
          : el('button', { class: 'btn btn-sm ' + (it.estado === 'vencida' ? 'btn-primary' : 'btn-ghost'), type: 'button', text: tipo === 'pagar' ? 'Pagué' : 'Me pagaron', onclick: function (e) {
            e.preventDefault(); e.stopPropagation();
            if (tipo === 'pagar') store.pagarCuota(v.id, c.id, hoy); else store.cobrarCuotaVenta(v.id, c.id, hoy);
            ui.toast('Listo', 'success');
          } }))
      ]);
    }

    function group(title, tone, items, tipo, listAll, collapsed) {
      if (!items.length) return null;
      var sum = 0; items.forEach(function (it) { sum += it.montoARS; });
      var head = el('div', { class: 'cb-ghead' }, [
        el('h3', { text: title }), el('span', { class: 'cb-gn num', text: items.length }), el('span', { class: 'cb-gsum num', text: fmt.money(sum) })
      ]);
      var rows = el('div', { class: 'cb-rows' }, items.map(function (it) { return row(it, tipo, listAll); }));
      if (collapsed) {
        return el('details', { class: 'cb-group cb-g-' + tone }, [el('summary', {}, head), rows]);
      }
      return el('section', { class: 'cb-group cb-g-' + tone }, [head, rows]);
    }

    function draw() {
      tabBtns.forEach(function (b) { var on = b.dataset.tab === cuotasSubTab; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      ui.clear(content);
      var tipo = cuotasSubTab === 'cobrar' ? 'cobrar' : 'pagar';
      var list = tipo === 'pagar' ? inst.pagar : inst.cobrar;
      var t = tipo === 'pagar' ? tP : tC;
      if (!list.length) {
        content.appendChild(el('div', { class: 'ix-clear' }, [ui.icon('card'), el('div', {}, [el('strong', { text: tipo === 'pagar' ? 'No tenés compras en cuotas' : 'No tenés ventas financiadas' }), el('span', { text: 'Cuando cargues cuotas, van a aparecer acá agrupadas por vencimiento.' })])]));
        return;
      }
      var pct = t.total ? Math.round(t.hecho / t.total * 100) : 0;
      content.appendChild(el('div', { class: 'cb-prog' }, [
        el('div', { class: 'cb-prog-top' }, [
          el('span', {}, [(tipo === 'pagar' ? 'Pagado ' : 'Cobrado '), el('b', { class: 'num', text: fmt.money(t.hecho) }), ' de ', el('b', { class: 'num', text: fmt.money(t.total) })]),
          el('span', { class: 'num cb-prog-pct', text: pct + '%' })
        ]),
        el('div', { class: 'cb-bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + pct + '%' }))
      ]));
      var venc = list.filter(function (i) { return i.estado === 'vencida'; });
      var pend = list.filter(function (i) { return i.estado === 'pendiente'; });
      var sem = pend.filter(function (i) { return i.vencimiento && i.vencimiento <= limIso; });
      var prox = pend.filter(function (i) { return !(i.vencimiento && i.vencimiento <= limIso); });
      var done = list.filter(function (i) { return i.estado === 'pagada' || i.estado === 'cobrada'; });
      [group('Vencidas', 'overdue', venc, tipo, list),
       group('Esta semana', 'soon', sem, tipo, list),
       group('Próximas', 'later', prox, tipo, list),
       group('Completadas', 'done', done, tipo, list, true)].forEach(function (g) { if (g) content.appendChild(g); });
    }
    draw();
    root.appendChild(wrap);
  }

  /* ================== GASTOS DEL NEGOCIO (libro contable) ================ */
  // Registro de movimientos: fecha, concepto, categoría e importe en columnas
  // alineadas, agrupado por mes. Mismos datos y mismo formulario de alta/edición.
  var gastosFiltro = { q: '', cat: '', frec: '' };
  var MESES_G = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  function gastosNegocioView(root) {
    var wrap = el('div', { class: 'page gl' });
    var list = store.getFixedExpenses();
    var mr = fin.monthRange(new Date()), yr = fin.yearRange(new Date());

    wrap.appendChild(el('header', { class: 'gl-head' }, [
      el('div', {}, [
        el('h1', { text: 'Gastos del negocio' }),
        el('p', { class: 'gl-sub' }, [
          el('span', {}, ['Este mes ', el('b', { class: 'num', text: fmt.money(fin.fixedExpensesInPeriod(mr.from, mr.to)) })]),
          el('i', { 'aria-hidden': 'true' }),
          el('span', {}, ['Este año ', el('b', { class: 'num', text: fmt.money(fin.fixedExpensesInPeriod(yr.from, yr.to)) })]),
          el('i', { 'aria-hidden': 'true' }),
          el('span', { class: 'num', text: fmt.num(list.length) + (list.length === 1 ? ' registrado' : ' registrados') })
        ])
      ]),
      el('button', { class: 'btn btn-primary', type: 'button', onclick: function () { App.forms.fixedExpenseForm(); } }, [ui.icon('plus'), el('span', { text: 'Nuevo gasto' })])
    ]));

    if (!list.length) {
      wrap.appendChild(el('div', { class: 'ix-clear' }, [ui.icon('briefcase'), el('div', {}, [el('strong', { text: 'Todavía no cargaste gastos del negocio' }), el('span', { text: 'Cargá el alquiler, los sueldos, el seguro de la flota… así la ganancia del negocio es la de verdad.' })])]));
      root.appendChild(wrap); return;
    }

    var cats = []; list.forEach(function (f) { if (cats.indexOf(f.categoria) < 0) cats.push(f.categoria); });
    var q = ui.input({ value: gastosFiltro.q, placeholder: 'Buscar por concepto o categoría', class: 'input' });
    var selCat = ui.select([{ value: '', label: 'Todas las categorías' }].concat(cats.map(function (c) { return { value: c, label: store.categoriaLabel(c) }; })), gastosFiltro.cat, { class: 'input select' });
    var selFrec = ui.select([{ value: '', label: 'Todos' }, { value: 'mensual', label: 'Mensuales' }, { value: 'unica', label: 'Únicos' }], gastosFiltro.frec, { class: 'input select' });
    wrap.appendChild(el('div', { class: 'gl-bar' }, [
      el('label', { class: 'dms-search' }, [ui.icon('search'), q]),
      el('div', { class: 'gl-filters' }, [selCat, selFrec])
    ]));
    var box = el('div', { class: 'gl-sheet' });
    wrap.appendChild(box);
    q.addEventListener('input', function () { gastosFiltro.q = q.value; draw(); });
    selCat.addEventListener('change', function () { gastosFiltro.cat = selCat.value; draw(); });
    selFrec.addEventListener('change', function () { gastosFiltro.frec = selFrec.value; draw(); });

    function draw() {
      ui.clear(box);
      var term = gastosFiltro.q.trim().toLowerCase();
      var items = list.filter(function (f) {
        if (gastosFiltro.cat && f.categoria !== gastosFiltro.cat) return false;
        if (gastosFiltro.frec && f.frecuencia !== gastosFiltro.frec) return false;
        if (term && ((f.concepto || '') + ' ' + store.categoriaLabel(f.categoria)).toLowerCase().indexOf(term) < 0) return false;
        return true;
      }).sort(function (a, b) { return (b.fecha || '').localeCompare(a.fecha || ''); });
      if (!items.length) { box.appendChild(ui.emptyState('No hay gastos que coincidan.', 'search')); return; }
      var table = el('table', { class: 'gl-table' });
      table.appendChild(el('thead', {}, el('tr', {}, [
        el('th', { class: 'g-fecha', text: 'Fecha' }), el('th', { class: 'g-concepto', text: 'Concepto' }),
        el('th', { class: 'g-cat', text: 'Categoría' }), el('th', { class: 'g-frec', text: 'Frecuencia' }), el('th', { class: 'g-monto num', text: 'Importe' })
      ])));
      var tb = el('tbody'); var lastKey = null;
      items.forEach(function (f) {
        var d = fin.parseDate(f.fecha);
        var key = d ? d.getFullYear() * 100 + d.getMonth() : 0;
        if (key !== lastKey) {
          tb.appendChild(el('tr', { class: 'gl-month' }, el('td', { colspan: '5', text: d ? MESES_G[d.getMonth()] + ' ' + d.getFullYear() : 'Sin fecha' })));
          lastKey = key;
        }
        tb.appendChild(el('tr', { class: 'gl-row', tabindex: '0', onclick: function () { App.forms.fixedExpenseForm(f); }, onkeydown: function (e) { if (e.key === 'Enter') App.forms.fixedExpenseForm(f); } }, [
          el('td', { class: 'g-fecha num', dataset: { label: 'Fecha' }, text: fmt.date(f.fecha) }),
          el('td', { class: 'g-concepto' }, [el('span', { class: 'g-name', text: f.concepto }), f.hasta ? el('span', { class: 'g-note', text: 'Hasta ' + fmt.date(f.hasta) }) : null]),
          el('td', { class: 'g-cat', text: store.categoriaLabel(f.categoria) }),
          el('td', { class: 'g-frec', text: f.frecuencia === 'mensual' ? 'Todos los meses' : 'Una vez' }),
          el('td', { class: 'g-monto num', text: fmt.money(f.monto, f.moneda) })
        ]));
      });
      table.appendChild(tb);
      box.appendChild(el('div', { class: 'gl-scroll' }, table));
      box.appendChild(el('div', { class: 'gl-foot', text: 'Mostrando ' + items.length + ' de ' + list.length + ' · tocá un movimiento para editarlo' }));
    }
    draw();
    root.appendChild(wrap);
  }

  /* ============================== PAPELERA ========================= */
  function papeleraView(root) {
    var wrap = el('div', { class: 'page' });
    wrap.appendChild(pageHead('Papelera', 'Vehículos eliminados. Podés restaurarlos o borrarlos definitivamente.'));
    var list = store.trashedVehicles();
    if (!list.length) { wrap.appendChild(ui.emptyState('La papelera está vacía.', '🗑️')); root.appendChild(wrap); return; }
    list.forEach(function (v) {
      wrap.appendChild(el('div', { class: 'card trash-item' }, [
        el('div', { class: 'trash-info' }, [
          el('strong', { text: store.vehicleName(v) }),
          el('span', { class: 'muted', text: (v.patente || '') + ' · eliminado ' + fmt.relative(isoOf(new Date(v.deletedAt))) })
        ]),
        el('div', { class: 'row-btns' }, [
          el('button', { class: 'btn btn-sm btn-primary', text: 'Restaurar', onclick: function () { store.restoreVehicle(v.id); ui.toast('Vehículo restaurado', 'success'); App.router.render(); } }),
          el('button', { class: 'btn btn-sm btn-danger', text: 'Eliminar definitivamente', onclick: function () {
            ui.confirm({ title: 'Eliminar definitivamente', message: 'Esta acción no se puede deshacer. ¿Eliminar "' + store.vehicleName(v) + '" para siempre?', danger: true, confirmText: 'Eliminar para siempre' })
              .then(function (ok) { if (ok) { store.hardDeleteVehicle(v.id); ui.toast('Vehículo eliminado'); App.router.render(); } });
          } })
        ])
      ]));
    });
    root.appendChild(wrap);
  }

  /* ============================ EXPORTACIÓN ======================== */
  function exportarView(root) {
    var wrap = el('div', { class: 'page' });
    wrap.appendChild(pageHead('Exportar', 'Guardá todo tu negocio en un Excel ordenado y colorido'));

    // --- Excel completo (lo principal) ---
    var st = App.excel ? App.excel.status() : { supported: false, on: false };
    var excelCard = el('div', { class: 'card excel-card' }, [
      el('div', { class: 'excel-card-top' }, [
        el('div', {}, [
          el('h3', { text: '📊 Excel completo' }),
          el('p', { class: 'muted', text: 'Un archivo con TODO: autos, compras, ventas, gastos, cuotas, recordatorios, historial de movimientos y resúmenes. Cada tema en su propia hoja, con colores y encabezados en negrita.' })
        ])
      ]),
      el('button', { class: 'btn btn-primary btn-excel', html: '<span>⬇</span> Descargar Excel', onclick: function () { App.excel.download(); } }),
      App.excel && App.excel.supported()
        ? el('p', { class: 'form-help', html: st.on && !st.needsReconnect
            ? 'Guardado automático <strong>activado</strong> — el archivo se actualiza solo. (Ajustes)'
            : 'También podés activar el <strong>guardado automático</strong> en Ajustes: elegís un archivo una vez y se actualiza solo con cada cambio.' })
        : el('p', { class: 'form-help', text: 'El guardado automático necesita Chrome o Edge en computadora. Acá usá el botón de arriba cada vez que quieras la copia actualizada.' })
    ]);
    wrap.appendChild(excelCard);

    // --- Copia de seguridad JSON (para restaurar) ---
    wrap.appendChild(el('div', { class: 'card' }, [
      el('h3', { text: '💾 Copia de seguridad (para restaurar)' }),
      el('p', { class: 'muted', text: 'El archivo JSON guarda la base completa y se puede volver a cargar en la app si cambiás de computadora o pasa algo.' }),
      el('div', { class: 'row-btns' }, [
        el('button', { class: 'btn btn-sm btn-ghost', text: '⬇ Exportar copia (JSON)', onclick: function () { ui.downloadFile('paginatoto-backup-' + store.todayISO() + '.json', store.exportJSON(), 'application/json'); store.markBackup(); ui.toast('Copia descargada', 'success'); App.router.render(); } }),
        el('button', { class: 'btn btn-sm btn-ghost', text: '⬆ Importar copia (JSON)', onclick: importPrompt })
      ])
    ]));

    // --- CSV sueltos (avanzado) ---
    var csvItems = [
      ['Autos', exportAutos],
      ['Movimientos (historial general)', exportMovimientos],
      ['Compras', exportCompras],
      ['Ventas', exportVentas],
      ['Resumen mensual (12 meses)', exportResumenMensual],
      ['Resumen anual (5 años)', exportResumenAnual]
    ];
    var csvBox = el('div', { class: 'card' });
    csvItems.forEach(function (it) {
      csvBox.appendChild(el('div', { class: 'export-row' }, [
        el('span', { text: it[0] }),
        el('button', { class: 'btn btn-sm btn-ghost', text: '⬇ CSV', onclick: it[1] })
      ]));
    });
    wrap.appendChild(el('details', { class: 'card' }, [
      el('summary', { html: '<strong>Archivos CSV sueltos</strong> <span class="muted">(avanzado)</span>' }),
      el('p', { class: 'form-help', text: 'Una tabla por archivo, sin colores. Sirven para abrir en otros programas.' }),
      csvBox
    ]));

    wrap.appendChild(el('div', { class: 'card' }, [
      el('h3', { text: '🖨 Imprimir' }),
      el('button', { class: 'btn btn-sm btn-ghost', text: 'Imprimir esta pantalla', onclick: function () { window.print(); } })
    ]));

    root.appendChild(wrap);

    function download(name, rows) { ui.downloadFile(name, '﻿' + ui.toCSV(rows), 'text/csv;charset=utf-8'); ui.toast('Archivo generado', 'success'); }
    function exportAutos() {
      var rows = [['Marca', 'Modelo', 'Año', 'Patente', 'Km', 'Estado', 'Documentación', 'Compra fecha', 'Compra precio', 'Moneda', 'Dólar compra', 'Gastos ARS', 'Inversión ARS', 'Venta fecha', 'Venta precio', 'Moneda venta', 'Dólar venta', 'Ganancia ARS', 'Rentabilidad %', 'Días en stock']];
      store.activeVehicles().forEach(function (v) {
        var m = fin.vehicleMetrics(v);
        rows.push([v.marca, v.modelo, v.anio, v.patente, v.km, store.estadoLabel(v.estado), v.documentacion,
          v.purchase ? v.purchase.fecha : '', v.purchase ? v.purchase.precio : '', v.purchase ? v.purchase.moneda : '', v.purchase ? v.purchase.cotizacionUSD : '',
          Math.round(m.gastosARS), Math.round(m.inversionARS),
          v.sale ? v.sale.fecha : '', v.sale ? v.sale.precio : '', v.sale ? v.sale.moneda : '', v.sale ? v.sale.cotizacionUSD : '',
          m.vendido ? Math.round(m.gananciaARS) : '', m.vendido ? m.rentabilidad.toFixed(1) : '', m.diasEnStock]);
      });
      download('autos.csv', rows);
    }
    function exportMovimientos() {
      var rows = [['Fecha', 'Tipo', 'Vehículo', 'Título', 'Detalle', 'Monto', 'Moneda']];
      store.getHistory().forEach(function (e) {
        var v = e.vehicleId ? store.getVehicle(e.vehicleId) : null;
        rows.push([e.fecha, e.tipo, v ? store.vehicleName(v) : '', e.titulo, e.detalle, e.monto != null ? e.monto : '', e.moneda || '']);
      });
      download('movimientos.csv', rows);
    }
    function exportCompras() {
      var rows = [['Auto', 'Fecha', 'Precio', 'Moneda', 'Dólar', 'Forma de pago', 'Cuotas', 'Vendedor', 'Teléfono']];
      store.activeVehicles().filter(function (v) { return v.purchase; }).forEach(function (v) {
        var p = v.purchase;
        rows.push([store.vehicleName(v), p.fecha, p.precio, p.moneda, p.cotizacionUSD || '', store.formaPagoLabel(p.formaPago), p.formaPago === 'cuotas' ? p.cuotas.length : '', p.proveedor ? p.proveedor.nombre : '', p.proveedor ? p.proveedor.telefono : '']);
      });
      download('compras.csv', rows);
    }
    function exportVentas() {
      var rows = [['Auto', 'Fecha', 'Precio', 'Moneda', 'Dólar', 'Forma de cobro', 'Vehículo recibido', 'Valor recibido', 'Diferencia', 'Moneda dif.', 'Cliente', 'Teléfono', 'Ganancia ARS']];
      store.activeVehicles().filter(function (v) { return v.sale; }).forEach(function (v) {
        var s = v.sale, m = fin.vehicleMetrics(v), ti = s.tradeIn;
        rows.push([store.vehicleName(v), s.fecha, s.precio, s.moneda, s.cotizacionUSD || '', store.formaCobroLabel(s.formaCobro),
          ti ? [ti.marca, ti.modelo, ti.anio].filter(Boolean).join(' ') : '', ti ? ti.valor : '', s.diferencia ? s.diferencia.monto : '', s.diferencia ? s.diferencia.moneda : '',
          s.cliente ? s.cliente.nombre : '', s.cliente ? s.cliente.telefono : '', Math.round(m.gananciaARS)]);
      });
      download('ventas.csv', rows);
    }
    function exportResumenMensual() {
      var rows = [['Mes', 'Gastos', 'Inversión', 'Ganancias', 'Resultado neto', 'Compras', 'Ventas']];
      fin.monthlySeries(12).forEach(function (m) { rows.push([m.label, Math.round(m.gastos), Math.round(m.inversion), Math.round(m.ganancias), Math.round(m.resultadoNeto), m.compras, m.ventas]); });
      download('resumen-mensual.csv', rows);
    }
    function exportResumenAnual() {
      var rows = [['Año', 'Gastos', 'Inversión', 'Ganancias', 'Resultado neto']];
      var y0 = new Date().getFullYear();
      for (var y = y0; y >= y0 - 4; y--) { var r = fin.periodResult(fin.yearRange(new Date(y, 0, 1))); rows.push([y, Math.round(r.gastos), Math.round(r.inversion), Math.round(r.ganancias), Math.round(r.resultadoNeto)]); }
      download('resumen-anual.csv', rows);
    }
    function importPrompt() {
      var inp = el('input', { type: 'file', accept: '.json,application/json' });
      inp.addEventListener('change', function () {
        var f = inp.files[0]; if (!f) return;
        var r = new FileReader();
        r.onload = function () {
          try { store.importJSON(r.result); ui.toast('Datos importados', 'success'); App.router.render(); }
          catch (e) { ui.toast('Archivo inválido', 'error'); }
        };
        r.readAsText(f);
      });
      inp.click();
    }
  }

  /* ============================== AJUSTES ========================== */
  // Pantalla principal: categorías con filas cliqueables (mismo patrón de
  // estado interno + volverLink ya usado en Resúmenes y Cuotas/Cobros, sin
  // rutas nuevas). Cada fila abre exactamente la misma tarjeta que ya
  // existía (cuentaCard/usuariosCard/avisosCard/snapshotsCard/resetCard/
  // excelAutosaveCard/datosCard/parametrosCard) — ninguna lógica cambió,
  // solo dónde se muestra.
  var ajustesScreen = 'home';

  // Componentes de configuración (SaaS): título + descripción a la izquierda,
  // control a la derecha, agrupados con separadores finos.
  function cfgRow(title, desc, ctl) {
    return el('div', { class: 'cfg-row' }, [
      el('div', { class: 'cfg-row-txt' }, [el('strong', { text: title }), desc ? el('span', { text: desc }) : null]),
      ctl ? el('div', { class: 'cfg-row-ctl' }, ctl) : null
    ]);
  }
  function cfgGroup(rows, cls) { return el('div', { class: 'cfg-group' + (cls ? ' ' + cls : '') }, rows.filter(Boolean)); }
  function cfgSec(title, desc, kids, cls) {
    return el('section', { class: 'cfg-sec' + (cls ? ' ' + cls : '') }, [
      el('header', { class: 'cfg-sec-h' }, [el('h2', { text: title }), desc ? el('p', { text: desc }) : null])
    ].concat(kids));
  }
  function cfgSub(title) { return el('h3', { class: 'cfg-sub', text: title }); }

  // Pantalla principal: navegación interna a la izquierda (selector horizontal
  // en celular) y, a la derecha, la sección elegida. Cada sección reutiliza la
  // misma lógica de siempre (cuenta, usuarios, avisos, parámetros, datos,
  // copias, Excel y borrado) — ninguna lógica cambió, solo cómo se muestra.
  function ajustesView(root) {
    var wrap = el('div', { class: 'page cfg' });
    var online = !!(App.auth && App.auth.enabled);
    var isAdmin = online && App.auth.isAdmin();
    var showDanger = !online || isAdmin;

    var SECTIONS = [['apariencia', 'Apariencia', aparienciaSec]];
    if (online) SECTIONS.push(['cuenta', 'Mi cuenta', cuentaSec]);
    if (isAdmin) SECTIONS.push(['usuarios', 'Usuarios', usuariosSec]);
    SECTIONS.push(['preferencias', 'Avisos', avisosSec], ['financiero', 'Financiero', parametrosSec], ['datos', 'Datos y copias', datosSec], ['sync', 'Excel automático', excelSec]);
    if (showDanger) SECTIONS.push(['peligro', 'Zona peligrosa', peligroSec]);

    var navBtns = SECTIONS.map(function (s) {
      var b = el('button', { type: 'button', class: 'cfg-nav-i' + (s[0] === 'peligro' ? ' is-danger' : ''), dataset: { key: s[0] }, text: s[1] });
      b.addEventListener('click', function () { ajustesScreen = s[0]; render(); });
      return b;
    });
    var content = el('div', { class: 'cfg-content' });
    wrap.appendChild(el('div', { class: 'cfg-layout' }, [
      el('div', { class: 'cfg-side' }, [
        el('h1', { text: 'Ajustes' }), el('p', { class: 'cfg-nav-sub', text: 'Cómo funciona y se ve tu aplicación.' }),
        el('nav', { class: 'cfg-nav', 'aria-label': 'Secciones de Ajustes' }, navBtns)
      ]),
      content
    ]));
    root.appendChild(wrap);

    function render() {
      var cur = SECTIONS.filter(function (s) { return s[0] === ajustesScreen; })[0] || SECTIONS[0];
      ajustesScreen = cur[0];
      navBtns.forEach(function (b) { var on = b.dataset.key === cur[0]; b.classList.toggle('is-active', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
      ui.clear(content);
      ui.appendChildren(content, cur[2]());
    }
    render();
  }

  // --- Apariencia: claro / oscuro / automático (se aplica al instante y se recuerda) ---
  function aparienciaSec() {
    var OPTS = [['light', 'sun', 'Claro'], ['dark', 'moon', 'Oscuro'], ['auto', 'monitor', 'Automático']];
    var seg = el('div', { class: 'seg-control theme-seg', role: 'radiogroup', 'aria-label': 'Tema de la aplicación' });
    var btns = OPTS.map(function (o) {
      var b = el('button', { type: 'button', class: 'seg', role: 'radio', dataset: { theme: o[0] } }, [ui.icon(o[1]), el('span', { text: o[2] })]);
      b.addEventListener('click', function () { ui.theme.set(o[0]); sync(); });
      return b;
    });
    btns.forEach(function (b) { seg.appendChild(b); });
    function sync() {
      var cur = ui.theme.get();
      btns.forEach(function (b) {
        var on = b.dataset.theme === cur;
        b.classList.toggle('is-active', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }
    sync();
    return [cfgSec('Apariencia', 'Cómo se ve la aplicación en este dispositivo.', [
      cfgGroup([cfgRow('Tema', 'Automático sigue la preferencia de tu dispositivo.', seg)])
    ])];
  }

  function cuentaSec() {
    var p = App.auth.profile || {};
    return [cfgSec('Mi cuenta', 'Tu perfil y tu sesión.', [
      cfgGroup([
        cfgRow('Nombre', null, el('span', { class: 'cfg-val', text: p.nombre || '—' })),
        cfgRow('Email', null, el('span', { class: 'cfg-val', text: p.email || '—' })),
        cfgRow('Rol', null, el('span', { class: 'cfg-val', text: p.role === 'admin' ? 'Administrador' : 'Usuario' })),
        cfgRow('Sesión', 'Salí de la aplicación en este dispositivo.', el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cerrar sesión', onclick: function () { App.auth.logout(); } }))
      ])
    ])];
  }

  function usuariosSec() {
    var card = el('div', { class: 'cfg-users' });

    var list = el('div', { class: 'user-list' }, [el('p', { class: 'muted', text: 'Cargando usuarios…' })]);
    card.appendChild(list);

    function refresh() {
      ui.clear(list);
      list.appendChild(el('p', { class: 'muted', text: 'Cargando usuarios…' }));
      App.auth.adminApi('list').then(function (d) {
        ui.clear(list);
        (d.users || []).forEach(function (u) { list.appendChild(userRow(u)); });
      }).catch(function (e) {
        ui.clear(list);
        list.appendChild(el('p', { class: 'auth-err', text: 'No se pudo cargar: ' + e.message }));
      });
    }

    function userRow(u) {
      var yo = App.auth.profile && u.id === App.auth.profile.id;
      var acciones = el('div', { class: 'row-btns' });
      if (!yo) {
        acciones.appendChild(el('button', { class: 'btn btn-sm btn-ghost', text: u.activo ? 'Desactivar' : 'Activar', onclick: function () {
          call('setActive', { id: u.id, activo: !u.activo }, u.activo ? 'Usuario desactivado' : 'Usuario activado');
        } }));
        acciones.appendChild(el('button', { class: 'btn btn-sm btn-ghost', text: u.role === 'admin' ? 'Quitar admin' : 'Hacer admin', onclick: function () {
          call('setRole', { id: u.id, role: u.role === 'admin' ? 'usuario' : 'admin' }, 'Rol actualizado');
        } }));
      }
      acciones.appendChild(el('button', { class: 'btn btn-sm btn-ghost', text: 'Cambiar contraseña', onclick: function () {
        var np = ui.input({ type: 'text', placeholder: 'Nueva contraseña (6+)', autocomplete: 'off' });
        var save = el('button', { class: 'btn btn-primary', text: 'Guardar' });
        var m = ui.modal({
          title: 'Contraseña de ' + (u.nombre || u.email), size: 'sm',
          body: ui.field('Nueva contraseña', np),
          footer: [
            el('button', { class: 'btn btn-ghost', text: 'Cancelar', onclick: function () { m.close(); } }),
            save
          ]
        });
        save.addEventListener('click', function () {
          if ((np.value || '').length < 6) { ui.toast('Mínimo 6 caracteres', 'error'); return; }
          App.auth.adminApi('setPassword', { id: u.id, password: np.value }).then(function () {
            ui.toast('Contraseña cambiada', 'success'); m.close();
          }).catch(function (e) { ui.toast(e.message, 'error'); });
        });
      } }));
      if (!yo) {
        acciones.appendChild(el('button', { class: 'btn btn-sm btn-danger-ghost', text: 'Eliminar', onclick: function () {
          ui.confirm({ title: 'Eliminar usuario', message: 'Se elimina a ' + (u.nombre || u.email) + '. No podrá entrar más. ¿Seguir?', danger: true, confirmText: 'Eliminar' })
            .then(function (ok) { if (ok) call('delete', { id: u.id }, 'Usuario eliminado'); });
        } }));
      }
      return el('div', { class: 'user-row' }, [
        el('div', { class: 'user-row-info' }, [
          el('strong', { text: (u.nombre || u.email) + (yo ? ' (vos)' : '') }),
          el('span', { class: 'muted', text: u.email + ' · ' + (u.role === 'admin' ? 'Administrador' : 'Usuario') + ' · ' + (u.activo ? 'Activo' : 'Desactivado') })
        ]),
        acciones
      ]);
    }

    function call(action, payload, okMsg) {
      App.auth.adminApi(action, payload).then(function () { ui.toast(okMsg, 'success'); refresh(); })
        .catch(function (e) { ui.toast(e.message, 'error'); });
    }

    // --- alta de usuario ---
    var nNombre = ui.input({ placeholder: 'Nombre' });
    var nEmail = ui.input({ type: 'email', placeholder: 'email@ejemplo.com', autocomplete: 'off', inputmode: 'email' });
    var nPass = ui.input({ type: 'text', placeholder: 'Contraseña (6+)', autocomplete: 'off' });
    var nRole = ui.select([{ value: 'usuario', label: 'Usuario' }, { value: 'admin', label: 'Administrador' }], 'usuario');
    var alta = el('div', { class: 'card-inset' }, [
      el('h4', { text: 'Agregar usuario' }),
      el('div', { class: 'grid-2' }, [
        ui.field('Nombre', nNombre),
        ui.field('Email', nEmail),
        ui.field('Contraseña', nPass),
        ui.field('Rol', nRole)
      ]),
      el('button', { class: 'btn btn-primary', text: 'Crear usuario', onclick: function () {
        var email = (nEmail.value || '').trim().toLowerCase();
        if (!email || (nPass.value || '').length < 6) { ui.toast('Poné email y contraseña de 6 o más', 'error'); return; }
        App.auth.adminApi('create', { email: email, password: nPass.value, nombre: nNombre.value, role: nRole.value })
          .then(function () {
            ui.toast('Usuario creado', 'success');
            nNombre.value = ''; nEmail.value = ''; nPass.value = '';
            refresh();
          })
          .catch(function (e) { ui.toast(e.message, 'error'); });
      } })
    ]);

    refresh();
    return [cfgSec('Usuarios', 'Todos los usuarios ven y editan la misma información. Los cambios se ven al instante en las demás computadoras.', [card, alta])];
  }

  function avisosSec() {
    var rows = [];
    if (!App.notify || !App.notify.supported()) {
      rows.push(cfgRow('Avisos del navegador', 'Este navegador no permite avisos. Igual, cada vez que abrís la app te muestra lo que tenés pendiente.'));
    } else {
      var st = App.notify.state();
      if (st === 'granted') {
        rows.push(cfgRow('Avisos del navegador', 'Cuando abrís la app y tenés cuotas o recordatorios vencidos o para hoy, te llega un aviso.', el('span', { class: 'badge badge-ok', text: 'Activados' })));
      } else if (st === 'denied') {
        rows.push(cfgRow('Avisos del navegador', 'Bloqueaste los avisos para este sitio. Se cambia desde el candado que está al lado de la dirección web.', el('span', { class: 'badge badge-danger', text: 'Bloqueados' })));
      } else {
        rows.push(cfgRow('Avisos del navegador', 'Recibí un aviso al abrir la app cuando haya algo vencido o para hoy.', el('button', { class: 'btn btn-primary', type: 'button', text: 'Activar avisos', onclick: function () { App.notify.request().then(function () { App.router.render(); }); } })));
      }
    }
    return [cfgSec('Avisos', 'Cómo te avisa la aplicación de lo que vence.', [cfgGroup(rows)])];
  }

  function parametrosSec() {
    var s = store.getState().settings;
    var fDolar = ui.moneyInput({ value: s.dolarActual });
    var fDias = ui.input({ inputmode: 'numeric', value: s.diasStockAlerta });
    var fCuota = ui.input({ inputmode: 'numeric', value: s.cuotaProximaDias });
    return [cfgSec('Financiero', 'Valores de referencia y umbrales de las alertas.', [
      cfgGroup([
        cfgRow('Cotización actual del dólar', 'Referencia general. Las comparaciones permiten ingresar otra puntual.', fDolar),
        cfgRow('Alerta: días en stock', 'Un vehículo se marca como "mucho tiempo" al llegar a esta cantidad de días.', fDias),
        cfgRow('Alerta: días antes de vencer una cuota', 'Cuántos días antes te avisamos de una cuota por vencer.', fCuota)
      ]),
      el('div', { class: 'cfg-save' }, el('button', { class: 'btn btn-primary', type: 'button', text: 'Guardar ajustes', onclick: function () {
        store.updateSettings({ dolarActual: fDolar.value, diasStockAlerta: parseInt(fDias.value, 10) || 60, cuotaProximaDias: parseInt(fCuota.value, 10) || 7 });
        ui.toast('Ajustes guardados', 'success'); App.router.render();
      } }))
    ])];
  }

  function datosSec() {
    var snaps = store.getSnapshots();
    var snapRows = [];
    if (!snaps.length) {
      snapRows.push(cfgRow('Sin copias todavía', 'La app guarda sola una copia por día (las últimas 5). Si borrás algo sin querer, acá lo podés volver a como estaba.'));
    } else {
      snaps.forEach(function (sn) {
        snapRows.push(cfgRow(fmt.datetime(sn.ts), sn.autos + (sn.autos === 1 ? ' auto' : ' autos'), el('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Restaurar', onclick: function () {
          ui.confirm({ title: 'Restaurar copia', message: 'Los datos actuales se reemplazan por la copia del ' + fmt.datetime(sn.ts) + '. ¿Seguir?', danger: true, confirmText: 'Restaurar' })
            .then(function (ok) { if (ok) { if (store.restoreSnapshot(sn.ts)) { ui.toast('Copia restaurada', 'success'); App.router.go(''); } else ui.toast('No se pudo restaurar', 'error'); } });
        } })));
      });
    }
    return [cfgSec('Datos y copias', 'Papelera, exportación y copias de seguridad.', [
      cfgGroup([
        cfgRow('Papelera', 'Vehículos eliminados: restauralos o borralos definitivamente.', el('a', { class: 'btn btn-ghost', href: '#/papelera' }, [el('span', { text: 'Abrir' }), ui.icon('chevron')])),
        cfgRow('Exportar', 'Excel completo, copia de seguridad (JSON) y archivos CSV.', el('a', { class: 'btn btn-ghost', href: '#/exportar' }, [el('span', { text: 'Abrir' }), ui.icon('chevron')]))
      ]),
      cfgSub('Copias automáticas'),
      el('p', { class: 'cfg-note', text: snaps.length ? 'Copias de los últimos días. Restaurar reemplaza los datos actuales (antes de hacerlo se guarda otra copia).' : '' }),
      cfgGroup(snapRows)
    ])];
  }

  function excelSec() {
    var rows = [];
    if (!App.excel || !App.excel.supported()) {
      rows.push(cfgRow('Guardado automático en Excel', 'Elegís un archivo Excel una vez y la app lo actualiza sola con cada cosa que hacés. Necesita Google Chrome o Microsoft Edge en una computadora. En este navegador, usá “Descargar Excel” en Exportar cada vez que quieras la copia al día.'));
    } else {
      var s = App.excel.status();
      if (s.on && !s.needsReconnect) {
        rows.push(cfgRow('Guardado automático', 'El Excel se actualiza solo con cada cambio' + (s.lastSaved ? ' · último guardado ' + fmt.datetime(s.lastSaved.getTime()) : '') + '.', el('span', { class: 'badge badge-ok', text: 'Activado' })));
        rows.push(cfgRow('Archivo', s.name || 'PaginaToto.xlsx', el('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Cambiar archivo', onclick: function () { App.excel.pickFile(); } })));
        rows.push(cfgRow('Desactivar', 'Deja de actualizar el archivo automáticamente.', el('button', { class: 'btn btn-sm btn-danger-ghost', type: 'button', text: 'Desactivar', onclick: function () { App.excel.disable(); ui.toast('Guardado automático desactivado'); } })));
      } else if (s.on && s.needsReconnect) {
        rows.push(cfgRow('Reconectar archivo', 'Después de cerrar y volver a abrir la app, el navegador pide permiso otra vez para escribir el archivo. Tocá el botón y aceptá.', el('button', { class: 'btn btn-sm btn-primary', type: 'button', text: 'Reconectar archivo', onclick: function () { App.excel.reconnect(); } })));
        rows.push(cfgRow('Desactivar', 'Deja de actualizar el archivo automáticamente.', el('button', { class: 'btn btn-sm btn-danger-ghost', type: 'button', text: 'Desactivar', onclick: function () { App.excel.disable(); ui.toast('Guardado automático desactivado'); } })));
      } else {
        rows.push(cfgRow('Guardado automático', 'Elegí un archivo Excel y la app lo va a actualizar sola con cada cambio (autos, ventas, gastos, recordatorios, todo).', el('button', { class: 'btn btn-primary', type: 'button', text: 'Elegir archivo Excel', onclick: function () { App.excel.pickFile(); } })));
      }
    }
    return [cfgSec('Excel automático', 'Mantené un archivo Excel siempre al día.', [cfgGroup(rows)])];
  }

  function peligroSec() {
    var fWord = ui.input({ placeholder: 'Escribí BORRAR', autocomplete: 'off' });
    return [cfgSec('Zona peligrosa', 'Acciones que no se pueden deshacer.', [
      cfgGroup([
        cfgRow('Borrar todo y empezar de cero', (App.auth && App.auth.enabled)
          ? 'Elimina TODOS los autos, ventas, gastos e historial de la nube, para TODOS los usuarios. Primero se descarga una copia de seguridad.'
          : 'Elimina TODOS los autos, ventas, gastos e historial de este navegador. Primero se descarga una copia de seguridad automática.'),
        el('div', { class: 'cfg-row cfg-confirm' }, [
          el('div', { class: 'cfg-row-txt' }, [el('strong', { text: 'Confirmación' }), el('span', { text: 'Para continuar, escribí la palabra BORRAR.' })]),
          el('div', { class: 'cfg-row-ctl cfg-row-ctl-col' }, [fWord, el('button', { class: 'btn btn-danger', type: 'button', text: 'Borrar todo', onclick: function () {
            if (fWord.value.trim().toUpperCase() !== 'BORRAR') { ui.toast('Escribí BORRAR para confirmar', 'error'); return; }
            ui.confirm({ title: 'Última confirmación', message: 'Se borra todo. Esto no se puede deshacer (salvo con la copia que se está descargando). ¿Seguro?', danger: true, confirmText: 'Sí, borrar todo' })
              .then(function (ok) {
                if (!ok) return;
                try { ui.downloadFile('paginatoto-ANTES-DE-BORRAR-' + store.todayISO() + '.json', store.exportJSON(), 'application/json'); } catch (e) {}
                setTimeout(function () { store.resetAll(); ui.toast('Datos borrados. Guardá el archivo que se descargó.'); App.router.go(''); }, 400);
              });
          } })])
        ])
      ], 'cfg-danger')
    ], 'cfg-sec-danger')];
  }

  /* ------------------------------- helpers --------------------------- */
  function pageHead(title, sub) {
    return el('div', { class: 'page-head' }, [el('div', {}, [el('h1', { text: title }), sub ? el('p', { class: 'page-sub', text: sub }) : null])]);
  }
  function dl(pairs) { return App.views._dl(pairs); }

  // Al tocar de nuevo el botón de navegación de una sección que tiene su
  // propia "pantalla interna" (Economía, Cuotas, Ajustes), estas funciones
  // la resetean al inicio — las llama app.js antes de renderizar.
  function resetEconomia() { economiaScreen = 'home'; }
  function resetCuotas() { cuotasSubTab = 'pagar'; }
  function resetAjustes() { ajustesScreen = 'home'; }

  window.App = window.App || {};
  App.views = App.views || {};
  Object.assign(App.views, {
    timeline: timeline,
    alertas: alertasView, economia: economiaView, finanzas: finanzasView, resumenes: resumenesView,
    historial: historialView, cuotas: cuotasView, gastosNegocio: gastosNegocioView,
    comparacion: comparacionView, contactos: contactosView,
    papelera: papeleraView, exportar: exportarView, ajustes: ajustesView,
    resetEconomia: resetEconomia, resetCuotas: resetCuotas, resetAjustes: resetAjustes
  });
})();
