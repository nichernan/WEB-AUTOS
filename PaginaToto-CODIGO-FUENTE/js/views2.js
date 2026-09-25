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
  function daysBetween(a, b) {
    var da = fin.parseDate(a), db = fin.parseDate(b);
    if (!da || !db) return 0;
    return Math.round((db - da) / 86400000);
  }
  App.alerts = alerts;

  var remCal = { y: null, m: null, sel: null };

  function alertasView(root) {
    var hoy = store.todayISO();
    var now = new Date();
    if (remCal.y == null) { remCal.y = now.getFullYear(); remCal.m = now.getMonth(); }
    if (!remCal.sel) remCal.sel = hoy;

    var vehAlerts = alerts.all();
    var b = allBuckets(hoy);
    var doneRems = store.getReminders().filter(function (r) { return reminderStatus(r, hoy) === 'done'; })
      .map(function (r) { return { r: r, date: r.fecha, status: 'done' }; });
    var pendCount = b.overdue.length + b.today.length + b.upcoming.length;

    var wrap = el('div', { class: 'page alertas-page' });

    var head = pageHead('Alertas', 'Qué tenés pendiente, vencido y para hoy');
    head.appendChild(el('button', { class: 'btn btn-primary', html: '<span>＋</span> Nueva alerta', onclick: function () { App.forms.reminderForm(null, remCal.sel); } }));
    wrap.appendChild(head);

    // Resumen (chips)
    wrap.appendChild(el('div', { class: 'alert-summary' }, [
      chip('🔔', pendCount, pendCount === 1 ? 'cosa pendiente' : 'cosas pendientes', 'chip-info'),
      b.overdue.length ? chip('⚠️', b.overdue.length, b.overdue.length === 1 ? 'vencida' : 'vencidas', 'chip-danger') : null,
      b.today.length ? chip('📅', b.today.length, 'para hoy', 'chip-warn') : null,
      vehAlerts.length ? chip('🚗', vehAlerts.length, vehAlerts.length === 1 ? 'aviso de vehículos' : 'avisos de vehículos', 'chip-neutral') : null
    ]));

    if (b.overdue.length) wrap.appendChild(remGroup('Vencidos', b.overdue, hoy, 'overdue'));
    if (b.today.length) wrap.appendChild(remGroup('Hoy', b.today, hoy, 'today'));
    if (b.upcoming.length) wrap.appendChild(remGroup('Próximos', b.upcoming.slice(0, 40), hoy, 'upcoming'));
    if (!pendCount) {
      wrap.appendChild(el('div', { class: 'card' }, [ui.emptyState('No tenés nada pendiente. Todo al día 👌', '✅')]));
    }
    if (doneRems.length) {
      wrap.appendChild(el('details', { class: 'card rem-done-box' }, [
        el('summary', {}, [el('strong', { text: 'Recordatorios completados' }), el('span', { class: 'count-tag', text: doneRems.length })]),
        remList(doneRems, hoy)
      ]));
    }

    // Calendario
    wrap.appendChild(calendarCard(hoy));

    // Revisión de vehículos
    if (vehAlerts.length) {
      var vsec = el('div', { class: 'card' });
      vsec.appendChild(el('div', { class: 'card-head' }, [el('h3', { text: 'Revisión de vehículos' }), el('span', { class: 'count-tag', text: vehAlerts.length })]));
      var byVeh = {};
      vehAlerts.forEach(function (a) { (byVeh[a.vehicle.id] = byVeh[a.vehicle.id] || []).push(a); });
      Object.keys(byVeh).forEach(function (vid) {
        var v = store.getVehicle(vid);
        vsec.appendChild(el('a', { class: 'veh-alert', href: '#/vehiculo/' + vid }, [
          el('div', { class: 'veh-alert-top' }, [
            el('strong', { text: store.vehicleName(v) }),
            v.patente ? el('span', { class: 'row-patente', text: v.patente }) : null
          ]),
          el('div', { class: 'veh-alert-lines' }, byVeh[vid].map(function (a) {
            return el('span', { class: 'alrt alrt-' + a.level }, [el('span', { text: a.icon }), el('span', { text: a.text })]);
          }))
        ]));
      });
      wrap.appendChild(vsec);
    }

    root.appendChild(wrap);
  }

  function chip(icon, n, label, cls) {
    return el('div', { class: 'summary-chip ' + (cls || '') }, [
      el('span', { class: 'summary-chip-ico', text: icon }),
      el('span', { class: 'summary-chip-n', text: n }),
      el('span', { class: 'summary-chip-lbl', text: label })
    ]);
  }

  function remGroup(title, items, hoy, kind) {
    return el('div', { class: 'card rem-group rem-group-' + kind }, [
      el('div', { class: 'rem-group-head' }, [el('h3', { text: title }), el('span', { class: 'count-tag', text: items.length })]),
      remList(items, hoy)
    ]);
  }

  function remList(items, hoy) {
    return el('div', { class: 'rem-list' }, items.map(function (it) { return remItem(it, hoy); }));
  }

  function remItem(it, hoy) {
    if (it.auto) return autoItem(it, hoy);
    var r = it.r;
    var status = it.status || reminderStatus(r, hoy);
    var occ = it.date || r.fecha;
    var isDone = occDone(r, occ) || status === 'done';
    var repTxt = (r.repeat && r.repeat !== 'none') ? ' · ↻ ' + remRepeatLabel(r.repeat) : '';
    var when;
    if (status === 'overdue') when = 'Venció · ' + fmt.relative(r.fecha);
    else if (status === 'today') when = 'Hoy' + (r.hora ? ' · ' + r.hora : '');
    else if (status === 'done') when = 'Completado';
    else when = fmt.date(occ) + (r.hora ? ' · ' + r.hora : '');

    var check = el('button', {
      class: 'rem-check' + (isDone ? ' is-done' : ''),
      title: isDone ? 'Marcar como pendiente' : 'Marcar como hecho',
      text: isDone ? '✓' : '',
      onclick: function (e) { e.preventDefault(); e.stopPropagation(); store.toggleReminderOccurrence(r.id, occ); }
    });
    var del = el('button', {
      class: 'icon-btn rem-del', title: 'Eliminar', html: '&times;',
      onclick: function (e) {
        e.preventDefault(); e.stopPropagation();
        ui.confirm({ title: 'Eliminar recordatorio', message: '¿Eliminar "' + r.titulo + '"?', danger: true, confirmText: 'Eliminar' })
          .then(function (ok) { if (ok) { store.removeReminder(r.id); ui.toast('Recordatorio eliminado'); } });
      }
    });
    return el('div', { class: 'rem-item rem-' + status + (isDone ? ' is-done' : '') }, [
      check,
      el('div', { class: 'rem-item-body', onclick: function () { App.forms.reminderForm(r); } }, [
        el('div', { class: 'rem-item-title' }, [
          el('span', { class: 'rem-ico', text: remIcon(r.tipo) }),
          el('span', { class: 'rem-item-name', text: r.titulo })
        ]),
        el('div', { class: 'rem-item-meta', text: when + ' · ' + remTipoLabel(r.tipo) + repTxt }),
        r.nota ? el('div', { class: 'rem-item-note', text: r.nota }) : null
      ]),
      del
    ]);
  }

  function autoItem(e, hoy) {
    var ico = e.kind === 'pagar' ? '💳' : (e.kind === 'cobrar' ? '💰' : '🔖');
    var name = e.kind === 'pagar' ? ('Pagar cuota ' + e.cuota.numero + ' — ' + store.vehicleName(e.vehicle))
      : e.kind === 'cobrar' ? ('Te tienen que pagar la cuota ' + e.cuota.numero + ' — ' + store.vehicleName(e.vehicle))
      : ('Vence la reserva de ' + store.vehicleName(e.vehicle) + (e.vehicle.reservation.cliente ? ' (' + e.vehicle.reservation.cliente.nombre + ')' : ''));
    var when = e.status === 'overdue' ? ('Venció · ' + fmt.relative(e.date)) : (e.status === 'today' ? 'Vence hoy' : ('Vence ' + fmt.date(e.date)));
    var meta = when + (e.monto ? ' · ' + fmt.money(e.monto, e.moneda) : '') +
      (e.kind === 'cobrar' ? ' · te lo pagan a vos' : (e.kind === 'pagar' ? ' · lo pagás vos' : ''));
    var action = null;
    if (e.kind === 'pagar') action = el('button', { class: 'btn btn-sm btn-primary', text: 'Pagué', onclick: function (ev) { ev.preventDefault(); ev.stopPropagation(); store.pagarCuota(e.vehicle.id, e.cuota.id, hoy); ui.toast('Cuota pagada', 'success'); } });
    else if (e.kind === 'cobrar') action = el('button', { class: 'btn btn-sm btn-primary', text: 'Me pagaron', onclick: function (ev) { ev.preventDefault(); ev.stopPropagation(); store.cobrarCuotaVenta(e.vehicle.id, e.cuota.id, hoy); ui.toast('Cobro registrado', 'success'); } });
    return el('div', { class: 'rem-item rem-' + e.status + ' rem-auto' }, [
      el('span', { class: 'rem-ico rem-auto-ico', text: ico }),
      el('a', { class: 'rem-item-body', href: '#/vehiculo/' + e.vehicle.id }, [
        el('div', { class: 'rem-item-title' }, [el('span', { class: 'rem-item-name', text: name })]),
        el('div', { class: 'rem-item-meta', text: meta })
      ]),
      action
    ]);
  }

  function calendarCard(hoy) {
    var card = el('div', { class: 'card rem-cal-card' });
    var y = remCal.y, m = remCal.m;
    var first = new Date(y, m, 1);

    card.appendChild(el('div', { class: 'rem-cal-head' }, [
      el('button', { class: 'icon-btn', html: '‹', 'aria-label': 'Mes anterior', onclick: function () { stepMonth(-1); } }),
      el('h3', { text: fin.MESES_LARGO[m] + ' ' + y }),
      el('button', { class: 'icon-btn', html: '›', 'aria-label': 'Mes siguiente', onclick: function () { stepMonth(1); } })
    ]));

    var grid = el('div', { class: 'rem-cal-grid' });
    ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'].forEach(function (d) { grid.appendChild(el('div', { class: 'rem-cal-dow', text: d })); });
    var startDow = (first.getDay() + 6) % 7;
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    for (var i = 0; i < startDow; i++) grid.appendChild(el('div', { class: 'rem-cal-cell is-empty' }));
    var reminders = store.getReminders();
    var events = autoEvents(hoy, true);
    function dayItems(dayIso) {
      var st = dayIso < hoy ? 'overdue' : (dayIso === hoy ? 'today' : 'upcoming');
      var rems = reminders.filter(function (r) { return reminderOnDay(r, dayIso); })
        .map(function (r) { return { r: r, date: dayIso, status: occDone(r, dayIso) ? 'done' : st }; });
      var evs = events.filter(function (e) { return e.date === dayIso; });
      return rems.concat(evs);
    }
    for (var day = 1; day <= daysInMonth; day++) {
      (function (day) {
        var dayIso = isoOf(new Date(y, m, day));
        var items = dayItems(dayIso);
        var hasPend = items.some(function (x) { return x.auto ? true : !occDone(x.r, dayIso); });
        grid.appendChild(el('button', {
          class: 'rem-cal-cell' + (dayIso === hoy ? ' is-today' : '') + (dayIso === remCal.sel ? ' is-sel' : '') + (items.length ? ' has-rem' : ''),
          onclick: function () { remCal.sel = dayIso; App.router.render(); }
        }, [
          el('span', { class: 'rem-cal-num', text: day }),
          items.length ? el('span', { class: 'rem-cal-dot' + (hasPend ? '' : ' is-done'), text: items.length > 1 ? String(items.length) : '' }) : null
        ]));
      })(day);
    }
    card.appendChild(grid);

    var selItems = dayItems(remCal.sel).sort(function (a, x) {
      var ha = (a.r && a.r.hora) || '99:99', hx = (x.r && x.r.hora) || '99:99';
      return ha.localeCompare(hx);
    });
    card.appendChild(el('div', { class: 'rem-cal-day' }, [
      el('div', { class: 'rem-cal-day-head' }, [
        el('strong', { text: fmt.dateLong(remCal.sel) }),
        el('button', { class: 'btn btn-sm btn-ghost', html: '<span>＋</span> Recordatorio', onclick: function () { App.forms.reminderForm(null, remCal.sel); } })
      ]),
      selItems.length ? remList(selItems, hoy) : el('p', { class: 'form-help', text: 'Nada este día.' })
    ]));
    return card;

    function stepMonth(delta) {
      var nm = remCal.m + delta;
      remCal.y += Math.floor(nm / 12);
      remCal.m = ((nm % 12) + 12) % 12;
      App.router.render();
    }
  }

  /* ============================== ECONOMÍA ============================ */
  // Pantalla principal: menú de módulos en tarjetas (mismo patrón de estado
  // interno + volverLink ya usado en Resúmenes/Cuotas/Ajustes, sin rutas
  // nuevas). Cada módulo reutiliza tal cual la vista que ya existía (misma
  // función, mismos datos, misma lógica) — acá solo se decide en qué
  // contenedor se dibuja.
  var MODULOS_ECONOMIA = [
    ['situacion', '💰', 'Situación económica', 'Resultado, capital y stock del negocio', finanzasView],
    ['gastos', '🏢', 'Gastos del negocio', 'Alquiler, sueldos y otros gastos fijos', gastosNegocioView],
    ['cuotas', '💳', 'Cuotas y cobros', 'Lo que pagás y lo que te pagan', cuotasView],
    ['dolar', '💵', 'Comparar dólar', 'El valor de tus operaciones en dólares', function (panel) { comparacionView(panel); }],
    ['resumenes', '📊', 'Resúmenes', 'Totales por período y estadísticas', resumenesView]
  ];
  var economiaScreen = 'home';
  function economiaView(root) {
    var wrap = el('div', { class: 'page page-economia' });
    wrap.appendChild(el('div', { class: 'page-head' }, [
      el('div', {}, [
        el('h1', { text: 'Economía' }),
        el('p', { class: 'page-sub', text: 'Elegí qué querés ver' })
      ])
    ]));

    // class "tab-panel": la regla CSS que le da a Economía su ancho amplio
    // (.page-economia .tab-panel .page) sigue aplicando igual que antes.
    var content = el('div', { class: 'tab-panel' });
    wrap.appendChild(content);
    root.appendChild(wrap);

    function goScreen(key) { economiaScreen = key; render(); }
    function volverLink() {
      return el('a', { class: 'back-link', href: '#', html: '‹ Volver a Economía', onclick: function (e) { e.preventDefault(); goScreen('home'); } });
    }

    function render() {
      ui.clear(content);
      var mod = MODULOS_ECONOMIA.filter(function (m) { return m[0] === economiaScreen; })[0];
      if (mod) {
        content.appendChild(volverLink());
        var panel = el('div', { style: 'margin-top:6px' });
        content.appendChild(panel);
        mod[4](panel);
        return;
      }
      economiaScreen = 'home';
      content.appendChild(el('div', { class: 'grid-2 module-grid' }, MODULOS_ECONOMIA.map(function (m) {
        return el('div', { class: 'card module-card', onclick: function () { goScreen(m[0]); } }, [
          el('span', { class: 'module-card-ico', text: m[1] }),
          el('strong', { class: 'module-card-title', text: m[2] }),
          el('span', { class: 'module-card-desc', text: m[3] })
        ]);
      })));
    }
    render();
  }

  /* =============================== FINANZAS =========================== */
  // ("Situación económica" dentro de Economía). Dashboard financiero: reusa
  // exactamente fin.globalMetrics()/fin.vehicleMetrics() — ningún cálculo
  // nuevo, solo se reorganiza cómo se presentan los mismos números.
  function finanzasView(root) {
    var g = fin.globalMetrics();
    var wrap = el('div', { class: 'page econ-dashboard' });
    wrap.appendChild(pageHead('Situación económica', 'Cómo está el negocio, de un vistazo'));

    // --- Lo más importante: resultado del negocio ---
    wrap.appendChild(el('div', { class: 'econ-hero' }, [
      el('span', { class: 'econ-hero-label', text: 'Resultado del negocio' }),
      el('span', { class: 'econ-hero-value ' + (g.resultadoNegocio >= 0 ? 'pos' : 'neg'), text: (g.resultadoNegocio >= 0 ? '+' : '') + fmt.money(g.resultadoNegocio) }),
      el('span', { class: 'econ-hero-sub', text: 'Ganancia por autos vendidos − gastos fijos del negocio' })
    ]));

    // --- Tres métricas principales, más discretas que el resultado ---
    wrap.appendChild(el('div', { class: 'grid-3' }, [
      miniStat('Capital en stock', fmt.money(g.capitalInvertido)),
      miniStat('Valor del stock', fmt.money(g.valorEstimadoStock)),
      miniStat('Ganancia obtenida', fmt.money(g.gananciaTotal), g.gananciaTotal >= 0 ? 'pos' : 'neg')
    ]));

    // --- Stock: qué vehículos tiene y cuánto valen ---
    var enStock = store.activeVehicles().filter(function (v) { return v.estado !== 'vendido'; })
      .sort(function (a, b) { return b.createdAt - a.createdAt; });
    var stockCard = el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h3', { text: '🚗 Stock' }),
        el('span', { class: 'count-tag', text: g.autosEnStock + ' de ' + g.totalVehiculos })
      ]),
      el('p', { class: 'form-help', text: g.autosEnStock + ' vehículo' + (g.autosEnStock === 1 ? '' : 's') + ' en stock · ' + fmt.money(g.capitalInvertido) + ' invertidos' })
    ]);
    if (!enStock.length) {
      stockCard.appendChild(ui.emptyState('No hay vehículos en stock.', '🚗'));
    } else {
      var stockTable = el('table', { class: 'data-table' });
      stockTable.appendChild(el('thead', {}, el('tr', {}, ['Vehículo', 'Inversión', 'Valor estimado', 'Diferencia'].map(function (h) { return el('th', { text: h }); }))));
      var stb = el('tbody');
      enStock.forEach(function (v) {
        var m = fin.vehicleMetrics(v);
        var dif = m.estimadoARS - m.costoTotalARS;
        stb.appendChild(el('tr', { class: 'clickable-row', onclick: function () { App.router.go('vehiculo/' + v.id); } }, [
          el('td', {}, [
            el('span', { class: 'cell-name', text: store.vehicleName(v) }),
            (v.origin && v.origin.type === 'consignacion') ? ui.pill('🤝 Consig.', 'pill-warn') : null
          ]),
          el('td', { text: fmt.money(m.costoTotalARS) }),
          el('td', { text: fmt.money(m.estimadoARS) }),
          el('td', { class: dif >= 0 ? 'pos' : 'neg', text: (dif >= 0 ? '+' : '') + fmt.money(dif) })
        ]));
      });
      stockTable.appendChild(stb);
      stockCard.appendChild(el('div', { class: 'table-wrap' }, stockTable));
    }
    wrap.appendChild(stockCard);

    // --- Pendientes: cuotas por cobrar/pagar, gastos fijos y diferencia en USD ---
    // ("Rendimiento" se sacó de esta pantalla — los mismos datos
    // (g.mayorGanancia, g.vendidoMasRapido, g.masTiempoStock, g.mayorVenta)
    // se siguen usando tal cual en Resúmenes → Estadísticas del negocio.)
    wrap.appendChild(el('div', { class: 'card' }, [
      el('h3', { text: '💰 Pendientes' }),
      el('div', { class: 'grid-2' }, [
        miniStat('Por cobrar', fmt.money(g.porCobrar), g.porCobrarVencido ? 'neg' : ''),
        miniStat('Por pagar', fmt.money(g.porPagarCuotas), g.porPagarVencido ? 'neg' : ''),
        miniStat('Gastos del negocio', fmt.money(g.gastosFijosTotales)),
        miniStat('Diferencia en USD', fmt.usd(g.gananciaTotalUSD), g.gananciaTotalUSD >= 0 ? 'pos' : 'neg')
      ])
    ]));

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
        miniStat('Gastos', fmt.money(r.gastos)),
        miniStat('Resultado', fmt.money(r.resultadoNeto), r.resultadoNeto >= 0 ? 'pos' : 'neg')
      ]));

      content.appendChild(el('h3', { text: 'Resumen del negocio', style: 'margin-top:6px' }));
      content.appendChild(navCard('📊', 'Ver estadísticas del negocio', 'Ver rendimiento, ventas, tiempos, resultados y otros indicadores del negocio.', 'negocio'));
      content.appendChild(navCard('🚗', 'Ver estadísticas por vehículo', 'Ver el detalle y rendimiento de cada vehículo.', 'vehiculos'));

      var evts = store.getHistory().slice(0, 6);
      if (evts.length) {
        content.appendChild(el('div', { class: 'card-actions-head', style: 'margin-top:6px' }, [
          el('h3', { text: 'Actividad reciente' }),
          el('a', { class: 'mini-tag', href: '#/historial', text: 'Ver todo →' })
        ]));
        content.appendChild(el('div', { class: 'card' }, App.views.timeline(evts)));
      }
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

  function historialView(root) {
    var wrap = el('div', { class: 'page' });
    wrap.appendChild(pageHead('Historial general', 'Todos los movimientos en orden cronológico'));
    var evts = store.getHistory();
    var tipos = [['', 'Todos'], ['compra', 'Compras'], ['venta', 'Ventas'], ['gasto', 'Gastos'], ['cuota', 'Cuotas'], ['estado', 'Cambios de estado'], ['parte-pago', 'Parte de pago'], ['edicion', 'Ediciones']];
    var filter = { tipo: '' };
    var seg = el('div', { class: 'seg-control wrap' }, tipos.map(function (t) {
      return el('button', { class: 'seg' + (t[0] === filter.tipo ? ' is-active' : ''), text: t[1], onclick: function () { filter.tipo = t[0]; draw(); } });
    }));
    wrap.appendChild(seg);
    var box = el('div', {});
    wrap.appendChild(box);
    function draw() {
      ui.qsa('.seg', seg).forEach(function (b, i) { b.classList.toggle('is-active', tipos[i][0] === filter.tipo); });
      var list = evts.filter(function (e) { return !filter.tipo || e.tipo === filter.tipo || (filter.tipo === 'estado' && e.tipo === 'estado'); });
      ui.clear(box);
      if (!list.length) { box.appendChild(ui.emptyState('Sin movimientos.', '🕓')); return; }
      box.appendChild(timeline(list));
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
    var wrap = el('div', { class: 'page' });
    wrap.appendChild(pageHead('Clientes y proveedores', 'Historial de personas con las que operaste'));

    var clientes = {}, proveedores = {};
    store.activeVehicles().forEach(function (v) {
      if (v.sale && v.sale.cliente && v.sale.cliente.nombre) {
        var k = v.sale.cliente.nombre.toLowerCase();
        (clientes[k] = clientes[k] || { nombre: v.sale.cliente.nombre, telefono: v.sale.cliente.telefono, ops: [] }).ops.push({ v: v, fecha: v.sale.fecha, monto: fin.vehicleMetrics(v).ventaARS, tipo: 'Compró' });
      }
      if (v.purchase && v.purchase.proveedor && v.purchase.proveedor.nombre) {
        var k2 = v.purchase.proveedor.nombre.toLowerCase();
        (proveedores[k2] = proveedores[k2] || { nombre: v.purchase.proveedor.nombre, telefono: v.purchase.proveedor.telefono, ops: [] }).ops.push({ v: v, fecha: v.purchase.fecha, monto: fin.vehicleMetrics(v).compraARS, tipo: 'Vendió' });
      }
    });

    function group(title, obj, emptyMsg) {
      var keys = Object.keys(obj);
      var card = el('div', { class: 'card' });
      card.appendChild(el('h3', { text: title }));
      if (!keys.length) { card.appendChild(ui.emptyState(emptyMsg, '👤')); return card; }
      keys.forEach(function (k) {
        var c = obj[k];
        var total = c.ops.reduce(function (s, o) { return s + o.monto; }, 0);
        card.appendChild(el('details', { class: 'contact-item' }, [
          el('summary', {}, [
            el('strong', { text: c.nombre }),
            c.telefono ? el('span', { class: 'muted', text: ' · ' + c.telefono }) : null,
            el('span', { class: 'count-tag', text: c.ops.length + ' op.' }),
            el('span', { class: 'muted', text: fmt.money(total) })
          ]),
          el('div', { class: 'contact-ops' }, c.ops.map(function (o) {
            return el('a', { class: 'contact-op', href: '#/vehiculo/' + o.v.id }, [
              el('span', { text: o.tipo + ' ' + store.vehicleName(o.v) }),
              el('span', { class: 'muted', text: fmt.date(o.fecha) + ' · ' + fmt.money(o.monto) })
            ]);
          }))
        ]));
      });
      return card;
    }

    wrap.appendChild(group('Clientes', clientes, 'Todavía no registraste clientes en las ventas.'));
    wrap.appendChild(group('Proveedores / vendedores', proveedores, 'Todavía no registraste proveedores en las compras.'));
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
      el('div', { class: 'stat-grid stat-grid-4' }, [
        miniStat('Autos vendidos', fmt.num(g.autosVendidos)),
        miniStat('Autos en stock', fmt.num(g.autosEnStock)),
        miniStat('Ganancia promedio', fmt.money(g.gananciaPromedio)),
        miniStat('Ganancia total', fmt.money(g.gananciaTotal), g.gananciaTotal >= 0 ? 'pos' : 'neg')
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
  function cuotasView(root) {
    var wrap = el('div', { class: 'page' });
    wrap.appendChild(pageHead('Cuotas y cobros', 'Lo que tenés que pagar y lo que te tienen que pagar'));
    var hoy = store.todayISO();
    var inst = fin.allInstallments();

    var seg = el('div', { class: 'seg-control' }, [
      el('button', { class: 'seg' + (cuotasSubTab === 'pagar' ? ' is-active' : ''), text: 'Cuotas', onclick: function () { cuotasSubTab = 'pagar'; draw(); } }),
      el('button', { class: 'seg' + (cuotasSubTab === 'cobrar' ? ' is-active' : ''), text: 'Cobros', onclick: function () { cuotasSubTab = 'cobrar'; draw(); } })
    ]);
    wrap.appendChild(seg);
    var content = el('div', {});

    function totals(list) {
      var t = { total: 0, hecho: 0, falta: 0, vencido: 0 };
      list.forEach(function (it) {
        t.total += it.montoARS;
        if (it.estado === 'pagada' || it.estado === 'cobrada') t.hecho += it.montoARS;
        else { t.falta += it.montoARS; if (it.estado === 'vencida') t.vencido += it.montoARS; }
      });
      return t;
    }
    function block(titulo, list, tipo) {
      var t = totals(list);
      var card = el('div', { class: 'card' });
      card.appendChild(el('h3', { text: titulo }));
      if (!list.length) { card.appendChild(ui.emptyState(tipo === 'pagar' ? 'No tenés compras en cuotas.' : 'No tenés ventas financiadas.', '💳')); return card; }
      card.appendChild(el('div', { class: 'cuotas-summary' }, [
        el('div', {}, [el('span', { text: 'Total' }), el('strong', { text: fmt.money(t.total) })]),
        el('div', {}, [el('span', { text: tipo === 'pagar' ? 'Pagado' : 'Cobrado' }), el('strong', { class: 'pos', text: fmt.money(t.hecho) })]),
        el('div', {}, [el('span', { text: 'Falta' }), el('strong', { class: t.falta ? 'neg' : '', text: fmt.money(t.falta) })]),
        t.vencido ? el('div', {}, [el('span', { text: 'Vencido' }), el('strong', { class: 'neg', text: fmt.money(t.vencido) })]) : null
      ]));
      var table = el('table', { class: 'data-table' });
      table.appendChild(el('thead', {}, el('tr', {}, ['Auto', 'Cuota', 'Monto', 'Vence', 'Estado', ''].map(function (h) { return el('th', { text: h }); }))));
      var tb = el('tbody');
      list.forEach(function (it) {
        var c = it.cuota;
        var pillCls = (it.estado === 'pagada' || it.estado === 'cobrada') ? 'pill-ok' : (it.estado === 'vencida' ? 'pill-danger' : 'pill-warn');
        var pillTxt = it.estado.charAt(0).toUpperCase() + it.estado.slice(1);
        tb.appendChild(el('tr', { class: 'clickable-row', onclick: function () { App.router.go('vehiculo/' + it.vehicle.id + '?tab=economia'); } }, [
          el('td', { text: store.vehicleName(it.vehicle) }),
          el('td', { text: c.numero }),
          el('td', { text: fmt.money(c.monto, it.moneda) }),
          el('td', { text: fmt.date(it.vencimiento) }),
          el('td', {}, ui.pill(pillTxt, pillCls)),
          el('td', {}, (it.estado !== 'pagada' && it.estado !== 'cobrada')
            ? el('button', { class: 'btn btn-sm btn-primary', text: tipo === 'pagar' ? 'Pagué' : 'Me pagaron', onclick: function (e) { e.stopPropagation(); if (tipo === 'pagar') store.pagarCuota(it.vehicle.id, c.id, hoy); else store.cobrarCuotaVenta(it.vehicle.id, c.id, hoy); ui.toast('Listo', 'success'); } })
            : null)
        ]));
      });
      table.appendChild(tb);
      card.appendChild(el('div', { class: 'table-wrap' }, table));
      return card;
    }
    function draw() {
      ui.qsa('.seg', seg).forEach(function (b, i) { b.classList.toggle('is-active', (i === 0 ? 'pagar' : 'cobrar') === cuotasSubTab); });
      ui.clear(content);
      content.appendChild(cuotasSubTab === 'pagar'
        ? block('💸 Cuotas que tenés que pagar', inst.pagar, 'pagar')
        : block('💰 Cuotas que te tienen que pagar', inst.cobrar, 'cobrar'));
    }
    wrap.appendChild(content);
    draw();
    root.appendChild(wrap);
  }

  /* ======================= GASTOS DEL NEGOCIO ===================== */
  function gastosNegocioView(root) {
    var wrap = el('div', { class: 'page' });
    var head = pageHead('Gastos del negocio', 'Alquiler, sueldos, seguros… lo que no es de un auto en particular');
    head.appendChild(el('button', { class: 'btn btn-primary', html: '<span>＋</span> Nuevo gasto', onclick: function () { App.forms.fixedExpenseForm(); } }));
    wrap.appendChild(head);

    var list = store.getFixedExpenses();
    var mr = fin.monthRange(new Date()), yr = fin.yearRange(new Date());
    wrap.appendChild(el('div', { class: 'stat-grid stat-grid-4' }, [
      miniStat('Este mes', fmt.money(fin.fixedExpensesInPeriod(mr.from, mr.to))),
      miniStat('Este año', fmt.money(fin.fixedExpensesInPeriod(yr.from, yr.to))),
      miniStat('Gastos cargados', fmt.num(list.length))
    ]));

    if (!list.length) {
      wrap.appendChild(el('div', { class: 'card' }, [ui.emptyState('Cargá el alquiler, los sueldos, el seguro de la flota… así la ganancia del negocio es la de verdad.', '🏢')]));
      root.appendChild(wrap); return;
    }
    var table = el('table', { class: 'data-table' });
    table.appendChild(el('thead', {}, el('tr', {}, ['Concepto', 'Categoría', 'Monto', 'Cada cuánto', 'Desde', ''].map(function (h) { return el('th', { text: h }); }))));
    var tb = el('tbody');
    list.slice().sort(function (a, b) { return (b.fecha || '').localeCompare(a.fecha || ''); }).forEach(function (f) {
      tb.appendChild(el('tr', { class: 'clickable-row', onclick: function () { App.forms.fixedExpenseForm(f); } }, [
        el('td', { text: f.concepto }),
        el('td', { text: store.categoriaLabel(f.categoria) }),
        el('td', { text: fmt.money(f.monto, f.moneda) }),
        el('td', { text: f.frecuencia === 'mensual' ? 'Todos los meses' : 'Una vez' }),
        el('td', { text: fmt.date(f.fecha) + (f.hasta ? ' → ' + fmt.date(f.hasta) : '') }),
        el('td', {}, el('button', { class: 'mini-btn', text: '✎', title: 'Editar', onclick: function (e) { e.stopPropagation(); App.forms.fixedExpenseForm(f); } }))
      ]));
    });
    table.appendChild(tb);
    wrap.appendChild(el('div', { class: 'card' }, [el('div', { class: 'table-wrap' }, table)]));
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
          el('span', { class: 'muted', text: (v.patente || '') + ' · eliminado ' + fmt.relative(new Date(v.deletedAt).toISOString().slice(0, 10)) })
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
  function ajustesView(root) {
    var wrap = el('div', { class: 'page' });
    wrap.appendChild(pageHead('Ajustes', 'Configurá la aplicación y tu cuenta'));

    var online = !!(App.auth && App.auth.enabled);
    var isAdmin = online && App.auth.isAdmin();
    var showDanger = !online || isAdmin;

    var content = el('div', {});
    wrap.appendChild(content);
    root.appendChild(wrap);

    function goScreen(key) { ajustesScreen = key; render(); }
    function volverLink() {
      return el('a', { class: 'back-link', href: '#', html: '‹ Volver a Ajustes', onclick: function (e) { e.preventDefault(); goScreen('home'); } });
    }

    var SUBSCREENS = {
      cuenta: function () { return cuentaCard(); },
      usuarios: function () { return usuariosCard(); },
      preferencias: function () { return avisosCard(); },
      financiero: function () { return parametrosCard(); },
      datos: function () { return [datosCard(), snapshotsCard()]; },
      sync: function () { return excelAutosaveCard(); },
      peligro: function () { return resetCard(); }
    };

    function render() {
      ui.clear(content);
      if (ajustesScreen !== 'home' && SUBSCREENS[ajustesScreen]) {
        content.appendChild(volverLink());
        ui.appendChildren(content, SUBSCREENS[ajustesScreen]());
        return;
      }
      ajustesScreen = 'home';

      var cuentaRows = [];
      if (online) {
        cuentaRows.push(settingsRow('👤', 'Mi cuenta', (App.auth.profile && (App.auth.profile.nombre || App.auth.profile.email)) || 'Tu perfil y sesión', function () { goScreen('cuenta'); }));
        if (isAdmin) cuentaRows.push(settingsRow('👥', 'Usuarios', 'Quién puede entrar a la app', function () { goScreen('usuarios'); }));
      }
      cuentaRows.push(settingsRow('⚙️', 'Preferencias', 'Avisos del navegador', function () { goScreen('preferencias'); }));

      [
        settingsSection('Cuenta', cuentaRows),
        settingsSection('Negocio', [
          settingsRow('💰', 'Configuración financiera', 'Dólar de referencia y alertas', function () { goScreen('financiero'); })
        ]),
        settingsSection('Datos y sistema', [
          settingsRow('💾', 'Datos', 'Papelera, exportar y copias de seguridad', function () { goScreen('datos'); }),
          settingsRow('🔄', 'Sincronización', 'Guardado automático en Excel', function () { goScreen('sync'); })
        ]),
        showDanger ? settingsSection('Zona peligrosa', [
          settingsRow('⚠️', 'Acciones avanzadas', 'Borrar todos los datos de la app', function () { goScreen('peligro'); }, true)
        ]) : null
      ].filter(Boolean).forEach(function (s) { content.appendChild(s); });
    }

    render();
  }

  function settingsRow(icon, title, desc, onclick, danger) {
    return el('div', { class: 'settings-row' + (danger ? ' is-danger' : ''), onclick: onclick }, [
      el('span', { class: 'settings-row-ico', text: icon }),
      el('div', { class: 'settings-row-body' }, [
        el('strong', { text: title }),
        el('span', { text: desc })
      ]),
      el('span', { class: 'settings-row-chevron', text: '›' })
    ]);
  }
  function settingsSection(title, rows) {
    rows = (rows || []).filter(Boolean);
    if (!rows.length) return null;
    var danger = rows.some(function (r) { return r.classList.contains('is-danger'); });
    return el('div', { class: 'settings-section' }, [
      el('div', { class: 'form-section-title', text: title }),
      el('div', { class: 'settings-group' + (danger ? ' danger-zone' : '') }, rows)
    ]);
  }

  // --- Datos: Papelera y Exportar (mismas páginas de siempre) ---
  function datosCard() {
    return el('div', { class: 'card' }, [
      el('h3', { text: '🗂️ Datos' }),
      el('div', { class: 'row-btns' }, [
        el('a', { class: 'btn btn-ghost', href: '#/papelera', html: '<span>🗑️</span> Papelera' }),
        el('a', { class: 'btn btn-ghost', href: '#/exportar', html: '<span>📤</span> Exportar' })
      ])
    ]);
  }

  function parametrosCard() {
    var s = store.getState().settings;
    var fDolar = ui.moneyInput({ value: s.dolarActual });
    var fDias = ui.input({ inputmode: 'numeric', value: s.diasStockAlerta });
    var fCuota = ui.input({ inputmode: 'numeric', value: s.cuotaProximaDias });
    return el('div', { class: 'card' }, [
      el('h3', { text: 'Parámetros' }),
      el('div', { class: 'grid-2' }, [
        ui.field('Cotización actual del dólar', fDolar, 'Referencia general. Las comparaciones permiten ingresar otra puntual.'),
        ui.field('Alerta: días en stock', fDias),
        ui.field('Alerta: días antes de vencer una cuota', fCuota)
      ]),
      el('button', { class: 'btn btn-primary', text: 'Guardar ajustes', onclick: function () {
        store.updateSettings({ dolarActual: fDolar.value, diasStockAlerta: parseInt(fDias.value, 10) || 60, cuotaProximaDias: parseInt(fCuota.value, 10) || 7 });
        ui.toast('Ajustes guardados', 'success'); App.router.render();
      } })
    ]);
  }

  function cuentaCard() {
    var p = App.auth.profile || {};
    return el('div', { class: 'card' }, [
      el('h3', { text: '👤 Mi cuenta' }),
      el('p', { class: 'form-help', text: (p.nombre ? p.nombre + ' · ' : '') + (p.email || '') + ' · ' + (p.role === 'admin' ? 'Administrador' : 'Usuario') }),
      el('button', { class: 'btn btn-ghost', text: 'Cerrar sesión', onclick: function () { App.auth.logout(); } })
    ]);
  }

  function usuariosCard() {
    var card = el('div', { class: 'card' });
    card.appendChild(el('h3', { text: '👥 Usuarios' }));
    card.appendChild(el('p', { class: 'form-help', text: 'Todos los usuarios ven y editan la misma información. Los cambios se ven al instante en las demás computadoras.' }));

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
    card.appendChild(el('div', { class: 'card-inset' }, [
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
    ]));

    refresh();
    return card;
  }

  function avisosCard() {
    var card = el('div', { class: 'card' });
    card.appendChild(el('h3', { text: '🔔 Avisos del navegador' }));
    if (!App.notify || !App.notify.supported()) {
      card.appendChild(el('p', { class: 'form-help', text: 'Este navegador no permite avisos. Igual, cada vez que abrís la app te muestra lo que tenés pendiente.' }));
      return card;
    }
    var st = App.notify.state();
    if (st === 'granted') {
      card.appendChild(el('p', {}, [el('span', { class: 'badge badge-ok', text: 'Activados' })]));
      card.appendChild(el('p', { class: 'form-help', text: 'Cuando abrís la app y tenés cuotas o recordatorios vencidos o para hoy, te llega un aviso.' }));
    } else if (st === 'denied') {
      card.appendChild(el('p', { class: 'form-help', text: 'Bloqueaste los avisos para este sitio. Se cambia desde el candado 🔒 al lado de la dirección web.' }));
    } else {
      card.appendChild(el('p', { class: 'muted', text: 'Recibí un aviso al abrir la app cuando haya algo vencido o para hoy.' }));
      card.appendChild(el('button', { class: 'btn btn-primary', text: 'Activar avisos', onclick: function () { App.notify.request().then(function () { App.router.render(); }); } }));
    }
    return card;
  }

  function snapshotsCard() {
    var card = el('div', { class: 'card' });
    card.appendChild(el('h3', { text: '↩️ Restaurar una copia anterior' }));
    var snaps = store.getSnapshots();
    if (!snaps.length) {
      card.appendChild(el('p', { class: 'form-help', text: 'La app guarda sola una copia por día (las últimas 5). Si borrás algo sin querer, acá lo podés volver a como estaba.' }));
      return card;
    }
    card.appendChild(el('p', { class: 'form-help', text: 'Copias automáticas de los últimos días. Restaurar reemplaza los datos actuales (antes de hacerlo se guarda otra copia).' }));
    snaps.forEach(function (sn) {
      card.appendChild(el('div', { class: 'export-row' }, [
        el('span', { text: fmt.datetime(sn.ts) + ' · ' + sn.autos + ' autos' }),
        el('button', { class: 'btn btn-sm btn-ghost', text: 'Restaurar', onclick: function () {
          ui.confirm({ title: 'Restaurar copia', message: 'Los datos actuales se reemplazan por la copia del ' + fmt.datetime(sn.ts) + '. ¿Seguir?', danger: true, confirmText: 'Restaurar' })
            .then(function (ok) { if (ok) { if (store.restoreSnapshot(sn.ts)) { ui.toast('Copia restaurada', 'success'); App.router.go(''); } else ui.toast('No se pudo restaurar', 'error'); } });
        } })
      ]));
    });
    return card;
  }

  function resetCard() {
    var fWord = ui.input({ placeholder: 'Escribí BORRAR', autocomplete: 'off' });
    return el('div', { class: 'card danger-zone' }, [
      el('h3', { text: '🗑️ Borrar todo y empezar de cero' }),
      el('p', { class: 'muted', text: (App.auth && App.auth.enabled)
        ? 'Elimina TODOS los autos, ventas, gastos e historial de la nube, para TODOS los usuarios. Primero se descarga una copia de seguridad.'
        : 'Elimina TODOS los autos, ventas, gastos e historial de este navegador. Primero se descarga una copia de seguridad automática.' }),
      ui.field('Para confirmar, escribí la palabra BORRAR', fWord),
      el('button', { class: 'btn btn-danger', text: 'Borrar todo', onclick: function () {
        if (fWord.value.trim().toUpperCase() !== 'BORRAR') { ui.toast('Escribí BORRAR para confirmar', 'error'); return; }
        ui.confirm({ title: 'Última confirmación', message: 'Se borra todo. Esto no se puede deshacer (salvo con la copia que se está descargando). ¿Seguro?', danger: true, confirmText: 'Sí, borrar todo' })
          .then(function (ok) {
            if (!ok) return;
            try { ui.downloadFile('paginatoto-ANTES-DE-BORRAR-' + store.todayISO() + '.json', store.exportJSON(), 'application/json'); } catch (e) {}
            setTimeout(function () { store.resetAll(); ui.toast('Datos borrados. Guardá el archivo que se descargó.'); App.router.go(''); }, 400);
          });
      } })
    ]);
  }

  function excelAutosaveCard() {
    var card = el('div', { class: 'card' });
    card.appendChild(el('h3', { text: '📊 Guardar automáticamente en Excel' }));

    if (!App.excel || !App.excel.supported()) {
      card.appendChild(el('p', { class: 'muted', text: 'Elegís un archivo Excel una vez y la app lo actualiza sola con cada cosa que hacés.' }));
      card.appendChild(el('p', { class: 'form-help', text: 'Necesita Google Chrome o Microsoft Edge en una computadora. En este navegador, usá el botón “Descargar Excel” en la sección Exportar cada vez que quieras la copia al día.' }));
      return card;
    }

    var s = App.excel.status();
    if (s.on && !s.needsReconnect) {
      card.appendChild(el('p', {}, [
        el('span', { class: 'badge badge-ok', text: 'Activado' }),
        el('span', { text: '  Archivo: ' + (s.name || 'PaginaToto.xlsx') })
      ]));
      card.appendChild(el('p', { class: 'form-help', text: 'El Excel se actualiza solo con cada cambio' + (s.lastSaved ? ' · último guardado ' + fmt.datetime(s.lastSaved.getTime()) : '') + '.' }));
      card.appendChild(el('div', { class: 'row-btns' }, [
        el('button', { class: 'btn btn-sm btn-ghost', text: 'Cambiar archivo', onclick: function () { App.excel.pickFile(); } }),
        el('button', { class: 'btn btn-sm btn-danger-ghost', text: 'Desactivar', onclick: function () { App.excel.disable(); ui.toast('Guardado automático desactivado'); } })
      ]));
    } else if (s.on && s.needsReconnect) {
      card.appendChild(el('p', {}, [el('span', { class: 'badge badge-warn', text: 'Reconectar' })]));
      card.appendChild(el('p', { class: 'form-help', text: 'Después de cerrar y volver a abrir la app, el navegador pide permiso otra vez para escribir el archivo. Tocá el botón y aceptá.' }));
      card.appendChild(el('div', { class: 'row-btns' }, [
        el('button', { class: 'btn btn-sm btn-primary', text: 'Reconectar archivo', onclick: function () { App.excel.reconnect(); } }),
        el('button', { class: 'btn btn-sm btn-danger-ghost', text: 'Desactivar', onclick: function () { App.excel.disable(); ui.toast('Guardado automático desactivado'); } })
      ]));
    } else {
      card.appendChild(el('p', { class: 'muted', text: 'Elegí un archivo Excel y la app lo va a actualizar sola con cada cambio (autos, ventas, gastos, recordatorios, todo).' }));
      card.appendChild(el('button', { class: 'btn btn-primary', html: '<span>📄</span> Elegir archivo Excel', onclick: function () { App.excel.pickFile(); } }));
    }
    return card;
  }

  /* ------------------------------- helpers --------------------------- */
  function pageHead(title, sub) {
    return el('div', { class: 'page-head' }, [el('div', {}, [el('h1', { text: title }), sub ? el('p', { class: 'page-sub', text: sub }) : null])]);
  }
  function dl(pairs) { return App.views._dl(pairs); }

  window.App = window.App || {};
  App.views = App.views || {};
  Object.assign(App.views, {
    timeline: timeline,
    alertas: alertasView, economia: economiaView, finanzas: finanzasView, resumenes: resumenesView,
    historial: historialView, cuotas: cuotasView, gastosNegocio: gastosNegocioView,
    comparacion: comparacionView, contactos: contactosView,
    papelera: papeleraView, exportar: exportarView, ajustes: ajustesView
  });
})();
