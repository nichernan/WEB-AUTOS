/* ============================================================================
 * views1.js  —  Dashboard y ficha de vehículo
 * ==========================================================================*/
(function () {
  'use strict';
  var ui = App.ui, el = ui.el, fmt = App.fmt, store = App.store, fin = App.finance;

  /* estado de filtros y búsqueda (compartido con la búsqueda global) */
  var filters = {
    q: '', marca: '', modelo: '', anio: '', estado: '', vendido: '',
    precioMin: '', precioMax: '', gananciaMin: '', gananciaMax: '',
    compraDesde: '', compraHasta: '', ventaDesde: '', ventaHasta: '',
    sort: 'reciente'
  };
  App.filters = filters;

  function matchVehicle(v) {
    var m = fin.vehicleMetrics(v);
    var name = store.vehicleName(v).toLowerCase();
    if (filters.q) {
      var q = filters.q.toLowerCase().trim();
      var hay = [name, v.marca, v.modelo, String(v.anio || ''), v.patente, v.version, store.estadoLabel(v.estado)]
        .filter(Boolean).join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    if (filters.marca && (v.marca || '').toLowerCase() !== filters.marca.toLowerCase()) return false;
    if (filters.modelo && (v.modelo || '').toLowerCase().indexOf(filters.modelo.toLowerCase()) === -1) return false;
    if (filters.anio && String(v.anio || '') !== String(filters.anio)) return false;
    if (filters.estado && v.estado !== filters.estado) return false;
    if (filters.vendido === 'si' && v.estado !== 'vendido') return false;
    if (filters.vendido === 'no' && v.estado === 'vendido') return false;
    var precio = m.vendido ? m.ventaARS : m.inversionARS;
    if (filters.precioMin && precio < store.num(filters.precioMin)) return false;
    if (filters.precioMax && precio > store.num(filters.precioMax)) return false;
    if (filters.gananciaMin && (!m.vendido || m.gananciaARS < store.num(filters.gananciaMin))) return false;
    if (filters.gananciaMax && m.vendido && m.gananciaARS > store.num(filters.gananciaMax)) return false;
    if (filters.compraDesde && (!v.purchase || v.purchase.fecha < filters.compraDesde)) return false;
    if (filters.compraHasta && (!v.purchase || v.purchase.fecha > filters.compraHasta)) return false;
    if (filters.ventaDesde && (!v.sale || v.sale.fecha < filters.ventaDesde)) return false;
    if (filters.ventaHasta && (!v.sale || v.sale.fecha > filters.ventaHasta)) return false;
    return true;
  }

  function sortVehicles(list) {
    var s = filters.sort;
    var arr = list.slice();
    arr.sort(function (a, b) {
      var ma = fin.vehicleMetrics(a), mb = fin.vehicleMetrics(b);
      switch (s) {
        case 'antiguo': return (a.purchase ? a.purchase.fecha : '9999').localeCompare(b.purchase ? b.purchase.fecha : '9999');
        case 'reciente': return (b.purchase ? b.purchase.fecha : '0000').localeCompare(a.purchase ? a.purchase.fecha : '0000') || b.createdAt - a.createdAt;
        case 'ganancia-desc': return mb.gananciaARS - ma.gananciaARS;
        case 'ganancia-asc': return ma.gananciaARS - mb.gananciaARS;
        case 'precio-desc': return (mb.vendido ? mb.ventaARS : mb.inversionARS) - (ma.vendido ? ma.ventaARS : ma.inversionARS);
        case 'precio-asc': return (ma.vendido ? ma.ventaARS : ma.inversionARS) - (mb.vendido ? mb.ventaARS : mb.inversionARS);
        default: return b.createdAt - a.createdAt;
      }
    });
    return arr;
  }

  /* ------------------------------ DASHBOARD --------------------------- */
  // "Vehículos" (antes "Inicio"). Reutiliza exactamente fin.globalMetrics()
  // — los mismos datos y fórmulas que ya usan Economía y Resúmenes. Acá solo
  // se reorganiza la presentación: el stock y las ventas pasan a ser lo
  // protagonista, y el listado completo (buscador/filtros/orden, sin cambios)
  // se movió a vehicleListView(), accesible desde acá sin duplicarlo.
  function dashboard(root) {
    var g = fin.globalMetrics();
    var wrap = el('div', { class: 'page home-dashboard' });

    var alertN = App.alerts ? App.alerts.count() : 0;
    wrap.appendChild(el('div', { class: 'page-head' }, [
      el('div', {}, [
        el('h1', { text: 'Vehículos' }),
        el('p', { class: 'page-sub', text: 'Tu stock, tus ventas y el estado del negocio' })
      ]),
      el('div', { class: 'page-head-actions' }, [
        el('a', { class: 'btn btn-ghost btn-alertas' + (alertN ? ' has-alerts' : ''), href: '#/alertas', 'aria-label': 'Ir a Alertas' + (alertN ? ' (' + alertN + ' pendientes)' : '') }, [
          el('span', { class: 'btn-alertas-ico', text: '🔔' }),
          el('span', { text: 'Alertas' }),
          alertN ? el('span', { class: 'btn-alertas-badge', text: alertN }) : null
        ]),
        el('a', { class: 'btn btn-primary', href: '#/vehiculo-nuevo', html: '<span>＋</span> Registrar vehículo' })
      ])
    ]));

    // aviso de copia de seguridad + cuotas vencidas (mismos avisos de siempre)
    wrap.appendChild(App.views._backupBar());
    if (g.porCobrarVencido > 0 || g.porPagarVencido > 0) {
      wrap.appendChild(el('a', { class: 'card dash-cuotas-alert', href: '#/cuotas' }, [
        el('span', { text: '💸' }),
        el('span', { html:
          (g.porPagarVencido > 0 ? '<strong>' + fmt.money(g.porPagarVencido) + '</strong> en cuotas vencidas que tenés que pagar. ' : '') +
          (g.porCobrarVencido > 0 ? '<strong>' + fmt.money(g.porCobrarVencido) + '</strong> en cuotas vencidas que te tienen que pagar.' : '') }),
        el('span', { class: 'muted', text: 'Ver →' })
      ]));
    }

    // --- Lo primero: cuántos autos tengo y cuántos vendí (protagonistas,
    // clickeables — llevan al listado completo ya filtrado). ---
    wrap.appendChild(el('div', { class: 'grid-2' }, [
      heroLink('Autos en stock', fmt.num(g.autosEnStock), 'Ver vehículos →', function () { goVehiculos('no'); }),
      heroLink('Autos vendidos', fmt.num(g.autosVendidos), 'Ver vendidos →', function () { goVehiculos('si'); })
    ]));

    // --- Después: cómo está el resultado y el capital (informativo, más discreto) ---
    wrap.appendChild(el('div', { class: 'grid-2' }, [
      miniStatHome('Resultado del mes', (g.resultadoNetoDelMes >= 0 ? '+' : '') + fmt.money(g.resultadoNetoDelMes), 'Ganancias − gastos fijos', g.resultadoNetoDelMes >= 0 ? 'pos' : 'neg'),
      miniStatHome('Capital invertido', fmt.money(g.capitalInvertido), 'Compra + gastos + comisiones')
    ]));

    // --- Acceso al listado completo (buscador, filtros, orden — sin duplicarlo) ---
    wrap.appendChild(el('div', { class: 'center' }, [
      el('a', { class: 'btn btn-ghost', href: '#/vehiculos', text: 'Ver todos los vehículos →' })
    ]));

    root.appendChild(wrap);
  }

  // Reutiliza el mismo objeto App.filters que ya usa el buscador/filtros del
  // listado completo — solo se resetean y se deja cargado "vendido" antes de
  // navegar, sin crear ningún mecanismo de filtrado nuevo.
  function goVehiculos(vendidoValue) {
    Object.keys(filters).forEach(function (k) { if (k !== 'sort') filters[k] = ''; });
    filters.vendido = vendidoValue;
    App.router.go('vehiculos');
  }

  // Bloque grande y clickeable (mismo estilo "hero" que ya usa Economía para
  // el Resultado del negocio), con una acción por debajo tipo link.
  function heroLink(label, value, actionText, onclick) {
    return el('div', { class: 'econ-hero econ-hero-link', onclick: onclick, role: 'button', tabindex: '0' }, [
      el('span', { class: 'econ-hero-label', text: label }),
      el('span', { class: 'econ-hero-value', text: value }),
      el('span', { class: 'mini-tag', text: actionText })
    ]);
  }

  // Mismo componente visual "mini-stat" que ya usa Economía — se reutiliza acá.
  function miniStatHome(label, value, sub, tone) {
    return el('div', { class: 'mini-stat' }, [
      el('span', { class: 'mini-stat-label', text: label }),
      el('span', { class: 'mini-stat-value ' + (tone || ''), text: value }),
      sub ? el('span', { class: 'mini-stat-sub', text: sub }) : null
    ]);
  }

  /* --------------------- Listado completo de vehículos ----------------- */
  // Mismo buscador/filtros/orden/listado que antes vivía dentro de "Inicio"
  // (matchVehicle, sortVehicles, buildFiltersPanel, vehicleRow — sin cambios),
  // ahora en su propia pantalla para no duplicar información en el dashboard.
  function vehicleListView(root) {
    var wrap = el('div', { class: 'page' });
    wrap.appendChild(el('div', { class: 'page-head' }, [
      el('div', {}, [
        el('a', { class: 'back-link', href: '#/', html: '‹ Volver a Vehículos' }),
        el('h1', { text: 'Todos los vehículos', style: 'margin-top:6px' })
      ])
    ]));

    var searchInput = ui.input({ value: filters.q, placeholder: 'Buscar por marca, modelo, año, patente, nombre...', class: 'input search-input' });
    searchInput.addEventListener('input', function () { filters.q = searchInput.value; renderList(); });
    var sortSel = ui.select([
      { value: 'reciente', label: 'Más reciente' }, { value: 'antiguo', label: 'Más antiguo' },
      { value: 'ganancia-desc', label: 'Mayor ganancia' }, { value: 'ganancia-asc', label: 'Menor ganancia' },
      { value: 'precio-desc', label: 'Mayor precio' }, { value: 'precio-asc', label: 'Menor precio' }
    ], filters.sort, { class: 'input select sort-select' });
    sortSel.addEventListener('change', function () { filters.sort = sortSel.value; renderList(); });

    var filtersPanel = el('div', { class: 'filters-panel', hidden: true });
    var filterToggle = el('button', { class: 'btn btn-ghost', html: '⚙ Filtros', onclick: function () { filtersPanel.hidden = !filtersPanel.hidden; } });

    wrap.appendChild(el('div', { class: 'toolbar' }, [
      el('div', { class: 'toolbar-search' }, searchInput),
      el('div', { class: 'toolbar-actions' }, [filterToggle, sortSel])
    ]));
    buildFiltersPanel(filtersPanel, function () { renderList(); });
    wrap.appendChild(filtersPanel);

    var listWrap = el('div', { class: 'vehicle-list' });
    wrap.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h3', { text: 'Todos los vehículos' }),
        el('span', { class: 'count-tag', id: 'veh-count' })
      ]),
      listWrap
    ]));

    function renderList() {
      var all = store.activeVehicles();
      var list = sortVehicles(all.filter(matchVehicle));
      ui.clear(listWrap);
      var countEl = ui.qs('#veh-count', wrap);
      if (countEl) countEl.textContent = list.length + ' de ' + all.length;
      if (!list.length) { listWrap.appendChild(ui.emptyState('No hay vehículos que coincidan con la búsqueda.', '🔍')); return; }
      list.forEach(function (v) { listWrap.appendChild(vehicleRow(v)); });
    }
    renderList();

    root.appendChild(wrap);
  }

  function vehicleRow(v) {
    var m = fin.vehicleMetrics(v);
    var right = [];
    right.push(el('span', { class: 'row-patente', text: v.patente || 'Sin patente' }));
    if (m.vendido) right.push(el('span', { class: 'row-ganancia ' + (m.gananciaARS >= 0 ? 'pos' : 'neg'), text: (m.gananciaARS >= 0 ? '+' : '') + fmt.money(m.gananciaARS) }));
    else right.push(el('span', { class: 'row-inversion', text: fmt.money(m.costoTotalARS) }));

    var alerts = App.alerts ? App.alerts.forVehicle(v).length : 0;

    return el('a', { class: 'vehicle-row', href: '#/vehiculo/' + v.id }, [
      el('div', { class: 'row-thumb' }, ui.carIcon()),
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title-line' }, [
          el('span', { class: 'row-name', text: store.vehicleName(v) }),
          ui.estadoBadge(v.estado),
          (v.origin && v.origin.type === 'consignacion') ? ui.pill('🤝 Consignación', 'pill-warn') : null
        ]),
        el('div', { class: 'row-meta' }, [
          v.version ? el('span', { text: v.version }) : null,
          v.km != null ? el('span', { text: fmt.num(v.km) + ' km' }) : null,
          m.diasEnStock != null ? el('span', { text: fmt.days(m.diasEnStock) + ' en stock' }) : null,
          alerts ? el('span', { class: 'row-alert', text: '⚠ ' + alerts } ) : null
        ])
      ]),
      el('div', { class: 'row-right' }, right)
    ]);
  }

  function buildFiltersPanel(panel, onChange) {
    var all = store.activeVehicles();
    var marcas = uniq(all.map(function (v) { return v.marca; }).filter(Boolean)).sort();
    var mk = function (label, node) { return el('div', { class: 'filter-field' }, [el('span', { class: 'filter-label', text: label }), node]); };

    var fMarca = ui.select([{ value: '', label: 'Todas' }].concat(marcas.map(function (m) { return { value: m, label: m }; })), filters.marca);
    var fModelo = ui.input({ value: filters.modelo, placeholder: 'Modelo' });
    var fAnio = ui.input({ value: filters.anio, inputmode: 'numeric', placeholder: 'Año' });
    var fEstado = ui.select([{ value: '', label: 'Todos' }, { value: 'stock', label: 'En stock' }, { value: 'reservado', label: 'Reservado' }, { value: 'vendido', label: 'Vendido' }], filters.estado);
    var fVendido = ui.select([{ value: '', label: 'Todos' }, { value: 'si', label: 'Vendidos' }, { value: 'no', label: 'No vendidos' }], filters.vendido);
    var fPMin = ui.moneyInput({ value: filters.precioMin, placeholder: 'Mín' });
    var fPMax = ui.moneyInput({ value: filters.precioMax, placeholder: 'Máx' });
    var fGMin = ui.moneyInput({ value: filters.gananciaMin, placeholder: 'Mín', allowNegative: true });
    var fGMax = ui.moneyInput({ value: filters.gananciaMax, placeholder: 'Máx', allowNegative: true });
    var fCD = ui.input({ value: filters.compraDesde, type: 'date' });
    var fCH = ui.input({ value: filters.compraHasta, type: 'date' });
    var fVD = ui.input({ value: filters.ventaDesde, type: 'date' });
    var fVH = ui.input({ value: filters.ventaHasta, type: 'date' });

    var allFields = { marca: fMarca, modelo: fModelo, anio: fAnio, estado: fEstado, vendido: fVendido, precioMin: fPMin, precioMax: fPMax, gananciaMin: fGMin, gananciaMax: fGMax, compraDesde: fCD, compraHasta: fCH, ventaDesde: fVD, ventaHasta: fVH };
    Object.keys(allFields).forEach(function (k) {
      allFields[k].addEventListener('input', function () { filters[k] = allFields[k].value; onChange(); });
      allFields[k].addEventListener('change', function () { filters[k] = allFields[k].value; onChange(); });
    });

    ui.clear(panel);
    panel.appendChild(el('div', { class: 'filters-grid' }, [
      mk('Marca', fMarca), mk('Modelo', fModelo), mk('Año', fAnio),
      mk('Estado', fEstado), mk('Vendido / no vendido', fVendido),
      mk('Precio desde', fPMin), mk('Precio hasta', fPMax),
      mk('Ganancia desde', fGMin), mk('Ganancia hasta', fGMax),
      mk('Compra desde', fCD), mk('Compra hasta', fCH),
      mk('Venta desde', fVD), mk('Venta hasta', fVH)
    ]));
    panel.appendChild(el('button', { class: 'btn btn-sm btn-ghost', text: 'Limpiar filtros', onclick: function () {
      Object.keys(allFields).forEach(function (k) { filters[k] = ''; });
      filters.q = '';
      App.router.render();
    } }));
  }

  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  /* --------------------------- FICHA DE VEHÍCULO ---------------------- */
  // Recuerda la pestaña activa por vehículo entre renders (p.ej. cuando se
  // registra un pago, o cuando otro usuario cambia algo en tiempo real): sin
  // esto, cualquier actualización de datos mientras se mira una pestaña que
  // no sea "Resumen" hacía volver la ficha a "Resumen" sin que el usuario lo pida.
  var lastDetailTab = { id: null, tab: null };
  // Menú "⋯" con acciones secundarias (mismas acciones de siempre, solo
  // agrupadas para reducir el ruido visual de la ficha).
  function moreMenu(items) {
    items = items.filter(Boolean);
    var btn = el('button', { class: 'icon-btn more-btn', html: '⋯', 'aria-label': 'Más acciones', title: 'Más acciones' });
    var menu = el('div', { class: 'more-menu', hidden: true }, items.map(function (it) {
      return el('button', { class: 'more-menu-item' + (it.danger ? ' is-danger' : ''), text: it.text, onclick: function () { close(); it.onclick(); } });
    }));
    function onDocClick(e) { if (!wrapEl.contains(e.target)) close(); }
    function close() { menu.hidden = true; document.removeEventListener('mousedown', onDocClick); }
    function open() { menu.hidden = false; document.addEventListener('mousedown', onDocClick); }
    btn.addEventListener('click', function (e) { e.stopPropagation(); if (menu.hidden) open(); else close(); });
    var wrapEl = el('div', { class: 'more-menu-wrap' }, [btn, menu]);
    return wrapEl;
  }

  function vehicleDetail(root, id) {
    var v = store.getVehicle(id);
    if (!v) { root.appendChild(ui.emptyState('El vehículo no existe o fue eliminado.', '🚫')); return; }
    var m = fin.vehicleMetrics(v);
    var esConsignacion = !!(v.origin && v.origin.type === 'consignacion');
    var wrap = el('div', { class: 'page vehicle-detail' });

    // acción principal: registrar compra (si falta y no es consignación) o
    // registrar venta (si ya se puede vender); "Agregar gasto" siempre
    // visible. El resto de las acciones quedan en el menú "⋯".
    var primaryActions = [];
    if (!v.purchase && !esConsignacion) {
      primaryActions.push(el('button', { class: 'btn btn-sm btn-primary', text: 'Registrar compra', onclick: function () { App.forms.purchaseForm(v.id); } }));
    } else if (v.estado !== 'vendido') {
      primaryActions.push(el('button', { class: 'btn btn-sm btn-primary', text: 'Registrar venta', onclick: function () { App.forms.saleForm(v.id); } }));
    }
    primaryActions.push(el('button', { class: 'btn btn-sm btn-ghost', text: 'Agregar gasto', onclick: function () { App.forms.expenseForm(v.id); } }));

    var secondary = moreMenu([
      { text: 'Editar', onclick: function () { App.router.go('vehiculo-editar/' + v.id); } },
      (v.purchase && v.estado !== 'vendido') ? { text: v.reservation ? 'Editar reserva' : 'Reservar', onclick: function () { App.forms.reservationForm(v.id); } } : null,
      { text: 'Comparar dólar', onclick: function () { App.router.go('comparacion/' + v.id); } },
      { text: 'Papelera', danger: true, onclick: function () {
        ui.confirm({ title: 'Enviar a papelera', message: '¿Seguro que querés eliminar este vehículo? Se moverá a la Papelera y podrás restaurarlo.', danger: true, confirmText: 'Enviar a papelera' })
          .then(function (ok) { if (ok) { store.softDeleteVehicle(v.id); ui.toast('Movido a la papelera', 'success'); App.router.go(''); } });
      } }
    ]);

    // header
    wrap.appendChild(el('div', { class: 'detail-head' }, [
      el('a', { class: 'back-link', href: '#/', html: '‹ Volver' }),
      el('div', { class: 'detail-head-main' }, [
        el('div', { class: 'detail-hero-photo' }, ui.carIcon('big')),
        el('div', { class: 'detail-titles' }, [
          el('h1', { text: store.vehicleName(v) }),
          el('div', { class: 'detail-patente', text: v.patente || 'Sin patente' }),
          el('div', { class: 'detail-sub' }, [
            ui.estadoBadge(v.estado), ui.docBadge(v.documentacion),
            v.origin && v.origin.type === 'parte-de-pago' ? ui.pill('Recibido como parte de pago', 'pill-info') : null,
            esConsignacion ? ui.pill('🤝 Consignación', 'pill-warn') : null
          ])
        ])
      ]),
      el('div', { class: 'detail-invest' }, [
        el('span', { class: 'detail-invest-value', text: fmt.money(m.costoTotalARS) }),
        el('span', { class: 'detail-invest-label', text: 'Inversión actual' })
      ]),
      el('div', { class: 'detail-actions' }, primaryActions.concat([secondary]))
    ]));

    if (v.reservation) {
      var rr = v.reservation;
      wrap.appendChild(el('div', { class: 'card reserva-card' }, [
        el('div', { class: 'card-head' }, [el('h4', { text: '🔖 Reservado' }), el('button', { class: 'btn btn-sm btn-ghost', text: 'Editar', onclick: function () { App.forms.reservationForm(v.id); } })]),
        App.views._dl([
          ['Seña recibida', fmt.money(rr.monto, rr.moneda), 'strong'],
          ['Fecha de la reserva', fmt.date(rr.fecha)],
          rr.vence ? ['Vence', fmt.date(rr.vence) + ' (' + fmt.relative(rr.vence) + ')', rr.vence < store.todayISO() ? 'neg' : ''] : null,
          rr.cliente && rr.cliente.nombre ? ['Cliente', rr.cliente.nombre + (rr.cliente.telefono ? ' · ' + rr.cliente.telefono : '')] : null,
          rr.notas ? ['Notas', rr.notas] : null
        ])
      ]));
    }

    // alertas del vehículo
    var va = App.alerts ? App.alerts.forVehicle(v) : [];
    if (va.length) {
      wrap.appendChild(el('div', { class: 'detail-alerts' }, va.map(function (a) {
        return el('div', { class: 'alert-line alert-' + a.level }, [el('span', { text: a.icon || '⚠' }), el('span', { text: a.text })]);
      })));
    }

    // tabs — reducidas a 4 secciones conceptuales: Compra + Gastos + Venta +
    // Rentabilidad viven juntas dentro de "Economía" (mismas funciones
    // tabCompra/tabGastos/tabVenta/tabRentabilidad, solo concatenadas);
    // "Documentación" muestra tabDocs (el Checklist se eliminó de la app).
    // Observaciones se movió a Resumen (ver tabResumen) y ya no es pestaña propia.
    var tabsWrap = el('div', { class: 'tabs' });
    var panel = el('div', { class: 'tab-panel' });
    var tabs = [
      ['resumen', 'Resumen', function () { return tabResumen(v, m); }],
      ['economia', 'Economía', function () { return tabEconomia(v, m); }],
      ['docs', 'Documentación', function () { return tabDocumentacion(v); }],
      ['hist', 'Historial', function () { return tabHist(v); }]
    ];
    var hashTab = (location.hash.split('?')[1] || '').indexOf('tab=') === 0 ? location.hash.split('tab=')[1] : null;
    if (lastDetailTab.id !== id) lastDetailTab = { id: id, tab: hashTab || 'resumen' };
    var active = lastDetailTab.tab;
    tabs.forEach(function (t) {
      var b = el('button', { class: 'tab' + (t[0] === active ? ' is-active' : ''), text: t[1], onclick: function () {
        lastDetailTab = { id: id, tab: t[0] };
        ui.qsa('.tab', tabsWrap).forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
        ui.clear(panel); ui.appendChildren(panel, t[2]());
      } });
      tabsWrap.appendChild(b);
    });
    wrap.appendChild(tabsWrap);
    wrap.appendChild(panel);
    var initial = tabs.filter(function (t) { return t[0] === active; })[0] || tabs[0];
    ui.appendChildren(panel, initial[2]());

    root.appendChild(wrap);
  }

  function kpi(label, value, sub, tone) {
    return el('div', { class: 'kpi' }, [
      el('span', { class: 'kpi-label', text: label }),
      el('span', { class: 'kpi-value ' + (tone || ''), text: value }),
      sub ? el('span', { class: 'kpi-sub', text: sub }) : null
    ]);
  }

  function dl(pairs) {
    return el('div', { class: 'data-list' }, pairs.filter(Boolean).map(function (p) {
      return el('div', { class: 'data-row' }, [el('span', { class: 'data-k', text: p[0] }), el('span', { class: 'data-v ' + (p[2] || '') }, p[1] instanceof Node ? p[1] : String(p[1])) ]);
    }));
  }

  // Tarjeta "Origen: parte de pago" — de dónde vino este vehículo, cuánto costó
  // tomarlo, y el margen potencial (en stock) o la ganancia realizada (vendido).
  // Reutiliza los mismos números que ya calcula vehicleMetrics para cualquier
  // vehículo — no inventa una fórmula nueva.
  function origenCard(v, m) {
    var orig = v.origin.saleVehicleId ? store.getVehicle(v.origin.saleVehicleId) : null;
    var rows = [
      ['Recibido en la venta de', orig ? store.vehicleName(orig) : 'una operación que ya no existe'],
      ['Costo de toma', fmt.money(m.compraARS)]
    ];
    if (!m.vendido) {
      rows.push(['Valor estimado de venta', v.precioPretendido ? fmt.money(v.precioPretendido, v.precioPretendidoMoneda) : '— (no cargado)']);
      if (v.precioPretendido) {
        var margen = m.estimadoARS - m.costoTotalARS;
        rows.push(['Margen potencial', (margen >= 0 ? '+' : '') + fmt.money(margen), margen >= 0 ? 'pos strong' : 'neg strong']);
      }
    } else {
      rows.push(['Vendido en', fmt.money(m.ventaARS)]);
      rows.push(['Ganancia realizada', (m.gananciaARS >= 0 ? '+' : '') + fmt.money(m.gananciaARS), m.gananciaARS >= 0 ? 'pos strong' : 'neg strong']);
    }
    return el('div', { class: 'card info-card' }, [
      el('h4', { text: '🔁 Origen: parte de pago' }),
      dl(rows),
      orig ? el('a', { class: 'btn btn-sm btn-primary', href: '#/vehiculo/' + orig.id + '?tab=economia', text: 'Ver operación' }) : null
    ]);
  }

  // Tarjeta "Consignación": el vehículo sigue siendo del dueño, el negocio
  // no lo compró. Reutiliza vehicleMetrics tal cual (gananciaARS ya
  // descuenta lo que le corresponde al dueño — ver finance.js) y solo
  // agrega, para mostrar, cuánto es ese importe del dueño.
  function consignacionCard(v, m) {
    var o = v.origin;
    var duenoStr = (o.duenio && o.duenio.nombre) ? o.duenio.nombre + (o.duenio.telefono ? ' · ' + o.duenio.telefono : '') : '—';
    var precioDuenoARS = m.precioDuenoARS;
    var rows = [
      ['Dueño', duenoStr],
      ['Precio que pide el dueño', o.precioDueno ? fmt.money(o.precioDueno, o.monedaDueno) : '—'],
      ['Fecha de ingreso', o.fecha ? fmt.date(o.fecha) : '—'],
      o.notas ? ['Notas', o.notas] : null
    ];
    if (m.vendido) {
      rows.push(['Vendido en', fmt.money(m.ventaARS)]);
      rows.push(['Le corresponde al dueño', fmt.money(precioDuenoARS)]);
      rows.push(['Ganancia del negocio', (m.gananciaARS >= 0 ? '+' : '') + fmt.money(m.gananciaARS), m.gananciaARS >= 0 ? 'pos strong' : 'neg strong']);
    } else {
      rows.push(['Le corresponde al dueño al vender', fmt.money(precioDuenoARS)]);
      if (v.precioPretendido) {
        var margen = m.estimadoARS - precioDuenoARS - m.costoTotalARS;
        rows.push(['Margen estimado del negocio', (margen >= 0 ? '+' : '') + fmt.money(margen), margen >= 0 ? 'pos strong' : 'neg strong']);
      }
    }
    return el('div', { class: 'card info-card' }, [
      el('h4', { text: '🤝 Consignación' }),
      dl(rows)
    ]);
  }

  // Resumen: para entenderse en pocos segundos. Junta, en modo lectura, lo
  // esencial de cada sección (los mismos datos y cálculos de siempre — nada
  // se recalcula acá; el detalle interactivo completo sigue en Economía /
  // Documentación).
  function tabResumen(v, m) {
    var esConsig = v.origin && v.origin.type === 'consignacion';
    var out = [];
    out.push(el('div', { class: 'grid-2' }, [
      el('div', { class: 'card' }, [el('h4', { text: 'Economía' }), dl([
        esConsig ? null : ['Compra', v.purchase ? fmt.money(v.purchase.precio, v.purchase.moneda) : '—'],
        ['Gastos', fmt.money(m.gastosARS)],
        m.comisionARS ? ['Comisiones', fmt.money(m.comisionARS)] : null,
        esConsig ? null : ['Inversión total', fmt.money(m.costoTotalARS), 'strong'],
        ['Precio de venta', m.vendido ? fmt.money(v.sale.precio, v.sale.moneda) : 'Todavía no vendido'],
        m.vendido ? ['Ganancia', (m.gananciaARS >= 0 ? '+' : '') + fmt.money(m.gananciaARS), m.gananciaARS >= 0 ? 'pos strong' : 'neg strong'] : null,
        m.vendido ? ['Rentabilidad', fmt.pct(m.rentabilidad), m.gananciaARS >= 0 ? 'pos' : 'neg'] : null,
        ['Días en stock', fmt.days(m.diasEnStock)],
        m.cuotasCount ? ['Cuotas a pagar', m.cuotasPagadasCount + ' / ' + m.cuotasCount + ' pagadas'] : null,
        m.totalPendienteARS ? ['Pendiente de pago', fmt.money(m.totalPendienteARS), 'neg'] : null,
        m.financiado ? ['Cuotas a cobrar', m.financCobradasCount + ' / ' + m.financCuotasCount + ' cobradas'] : null,
        m.financPorCobrarARS ? ['Falta que te paguen', fmt.money(m.financPorCobrarARS), m.financVencidasARS ? 'neg' : ''] : null
      ])]),
      el('div', { class: 'card' }, [el('h4', { text: 'Datos del vehículo' }), dl([
        ['Marca', v.marca || '—'], ['Modelo', v.modelo || '—'], ['Año', v.anio || '—'],
        ['Patente', v.patente || '—'], ['Kilometraje', v.km != null ? fmt.num(v.km) + ' km' : '—'],
        ['Combustible', v.combustible || '—'], ['Caja', v.caja === 'automatica' ? 'Automática' : (v.caja === 'manual' ? 'Manual' : '—')],
        ['Versión', v.version || '—']
      ])])
    ]));
    if (v.origin && v.origin.type === 'parte-de-pago') {
      out.push(origenCard(v, m));
    }
    if (esConsig) {
      out.push(consignacionCard(v, m));
    }
    out.push(el('div', { class: 'card' }, [el('h4', { text: 'Documentación' }), ui.docBadge(v.documentacion)]));
    if (v.observaciones) out.push(el('div', { class: 'card' }, [el('h4', { text: 'Observaciones' }), el('p', { class: 'obs-text', text: v.observaciones })]));
    return out;
  }

  // "Economía" — junta, tal cual, Compra + Gastos + Venta + Rentabilidad
  // (mismas funciones que ya existían, sin ningún cálculo nuevo).
  function tabEconomia(v, m) {
    return [].concat(tabCompra(v, m), tabGastos(v, m), tabVenta(v, m), tabRentabilidad(v, m));
  }

  // "Documentación" (la pestaña ya no incluye Checklist, se eliminó).
  function tabDocumentacion(v) {
    return tabDocs(v);
  }

  function tabCompra(v, m) {
    if (v.origin && v.origin.type === 'consignacion') return [consignacionCard(v, m)];
    if (!v.purchase) return [ui.emptyState('Todavía no registraste la compra de este vehículo.', '🧾'), el('div', { class: 'center' }, el('button', { class: 'btn btn-primary', text: 'Registrar compra', onclick: function () { App.forms.purchaseForm(v.id); } }))];
    var p = v.purchase;
    var out = [el('div', { class: 'card-actions-head' }, [el('h4', { text: 'Compra' }), el('button', { class: 'btn btn-sm btn-ghost', text: 'Editar compra', onclick: function () { App.forms.purchaseForm(v.id); } })])];
    out.push(dl([
      ['Fecha de compra', fmt.date(p.fecha)],
      ['Precio', fmt.money(p.precio, p.moneda)],
      p.moneda === 'ARS' && p.cotizacionUSD ? ['Cotización del dólar (compra)', fmt.money(p.cotizacionUSD) + '  ·  histórico'] : null,
      p.cotizacionUSD || p.moneda === 'USD' ? ['Valor en USD al comprar', fmt.usd(m.compraUSD)] : null,
      ['Forma de pago', store.formaPagoLabel(p.formaPago)],
      p.formaPago === 'mixto' ? ['Detalle', 'Transferencia ' + fmt.money(p.montoTransferencia, p.moneda) + ' · Efectivo ' + fmt.money(p.montoEfectivo, p.moneda)] : null,
      p.proveedor ? ['Proveedor', p.proveedor.nombre + (p.proveedor.telefono ? ' · ' + p.proveedor.telefono : '')] : null,
      p.proveedor && p.proveedor.notas ? ['Notas del proveedor', p.proveedor.notas] : null,
      p.comision ? ['Comisión a ' + (p.comision.persona || 'un tercero'), fmt.money(p.comision.monto, p.comision.moneda) + (p.comision.pagada ? ' · pagada' : ' · sin pagar')] : null
    ]));

    if (p.formaPago === 'cuotas' && p.cuotas.length) {
      out.push(el('h4', { text: 'Cuotas', style: 'margin-top:18px' }));
      out.push(el('div', { class: 'cuotas-summary' }, [
        el('div', {}, [el('span', { text: 'Total' }), el('strong', { text: fmt.money(m.cuotasTotalARS) })]),
        el('div', {}, [el('span', { text: 'Pagado' }), el('strong', { class: 'pos', text: fmt.money(m.cuotasPagadasARS) })]),
        el('div', {}, [el('span', { text: 'Pendiente' }), el('strong', { class: m.cuotasPendientesARS ? 'neg' : '', text: fmt.money(m.cuotasPendientesARS) })]),
        m.proximaCuota ? el('div', {}, [el('span', { text: 'Próxima cuota' }), el('strong', { text: fmt.date(m.proximaCuota.vencimiento) })]) : null,
        m.cuotasVencidasARS ? el('div', {}, [el('span', { text: 'Vencidas' }), el('strong', { class: 'neg', text: fmt.money(m.cuotasVencidasARS) })]) : null
      ]));
      var hoy = store.todayISO();
      out.push(el('div', { class: 'rem-list' }, p.cuotas.map(function (c) {
        var vencida = !c.pagada && c.vencimiento && c.vencimiento < hoy;
        var pillTxt = c.pagada ? 'Pagada' : (vencida ? 'Vencida' : 'Pendiente');
        var pillCls = c.pagada ? 'pill-ok' : (vencida ? 'pill-danger' : 'pill-warn');
        return el('div', { class: 'rem-item rem-auto' + (vencida ? ' rem-overdue' : '') + (c.pagada ? ' is-done' : '') }, [
          el('span', { class: 'rem-ico rem-auto-ico', text: '💳' }),
          el('div', { class: 'rem-item-body' }, [
            el('div', { class: 'rem-item-title' }, [el('span', { class: 'rem-item-name', text: 'Cuota ' + c.numero }), ui.pill(pillTxt, pillCls)]),
            el('div', { class: 'rem-item-meta', text: fmt.money(c.monto, p.moneda) + ' · Vence ' + fmt.date(c.vencimiento) + (c.fechaPago ? ' · Pagada el ' + fmt.date(c.fechaPago) : '') })
          ]),
          c.pagada
            ? el('button', { class: 'btn btn-sm btn-ghost', text: 'Desmarcar', onclick: function () { store.desmarcarCuota(v.id, c.id); App.router.render(); } })
            : el('button', { class: 'btn btn-sm btn-primary', text: 'Registrar pago', onclick: function () { pagarCuotaPrompt(v.id, c); } })
        ]);
      })));
    }
    return out;
  }

  function pagarCuotaPrompt(vehicleId, c) {
    var f = ui.input({ type: 'date', value: store.todayISO() });
    var mm = ui.modal({
      title: 'Registrar pago de cuota ' + c.numero, size: 'sm',
      body: ui.field('Fecha en que se pagó', f),
      footer: [
        el('button', { class: 'btn btn-ghost', text: 'Cancelar', onclick: function () { mm.close(); } }),
        el('button', { class: 'btn btn-primary', text: 'Confirmar pago', onclick: function () { store.pagarCuota(vehicleId, c.id, f.value); ui.toast('Cuota registrada', 'success'); mm.close(); App.router.render(); } })
      ]
    });
  }
  function cobrarCuotaPrompt(vehicleId, c) {
    var f = ui.input({ type: 'date', value: store.todayISO() });
    var mm = ui.modal({
      title: 'Registrar cobro de cuota ' + c.numero, size: 'sm',
      body: ui.field('Fecha en que te pagaron', f),
      footer: [
        el('button', { class: 'btn btn-ghost', text: 'Cancelar', onclick: function () { mm.close(); } }),
        el('button', { class: 'btn btn-primary', text: 'Confirmar cobro', onclick: function () { store.cobrarCuotaVenta(vehicleId, c.id, f.value); ui.toast('Cobro registrado', 'success'); mm.close(); App.router.render(); } })
      ]
    });
  }

  function tabGastos(v, m) {
    var out = [el('div', { class: 'card-actions-head' }, [
      el('h4', { text: 'Gastos del vehículo' }),
      el('button', { class: 'btn btn-sm btn-primary', text: '＋ Agregar gasto', onclick: function () { App.forms.expenseForm(v.id); } })
    ])];
    out.push(el('div', { class: 'invest-summary' }, [
      el('div', {}, [el('span', { text: 'Precio de compra' }), el('strong', { text: v.purchase ? fmt.money(m.compraARS) : '—' })]),
      el('div', {}, [el('span', { text: '+ Gastos' }), el('strong', { text: fmt.money(m.gastosARS) })]),
      el('div', { class: 'invest-total' }, [el('span', { text: '= Inversión total' }), el('strong', { text: fmt.money(m.inversionARS) })])
    ]));
    if (!(v.expenses || []).length) { out.push(ui.emptyState('Sin gastos registrados todavía.', '💸')); return out; }
    out.push(el('div', { class: 'rem-list' }, v.expenses.slice().sort(function (a, b) { return (b.fecha || '').localeCompare(a.fecha || ''); }).map(function (e) {
      return el('div', { class: 'rem-item rem-auto' }, [
        el('span', { class: 'rem-ico rem-auto-ico', text: '💸' }),
        el('a', { class: 'rem-item-body', href: '#', onclick: function (ev) { ev.preventDefault(); App.forms.expenseForm(v.id, e); } }, [
          el('div', { class: 'rem-item-title' }, [el('span', { class: 'rem-item-name', text: fmt.money(e.monto, e.moneda) })]),
          el('div', { class: 'rem-item-meta', text: fmt.date(e.fecha) + (e.observacion ? ' · ' + e.observacion : '') })
        ]),
        el('button', { class: 'icon-btn', html: '&times;', title: 'Eliminar', onclick: function (ev) { ev.preventDefault(); ev.stopPropagation(); ui.confirm({ message: '¿Eliminar este gasto?', danger: true }).then(function (ok) { if (ok) { store.removeExpense(v.id, e.id); App.router.render(); } }); } })
      ]);
    })));
    return out;
  }

  function tabVenta(v, m) {
    if (!v.purchase && !(v.origin && v.origin.type === 'consignacion')) return [ui.emptyState('Registrá primero la compra para poder vender el vehículo.', '🧾')];
    if (!v.sale) return [
      ui.emptyState('Este vehículo todavía no fue vendido.', '🏷️'),
      el('div', { class: 'center' }, el('button', { class: 'btn btn-primary', text: 'Registrar venta', onclick: function () { App.forms.saleForm(v.id); } }))
    ];
    var s = v.sale;
    var out = [el('div', { class: 'card-actions-head' }, [
      el('h4', { text: 'Venta' }),
      el('div', { class: 'row-btns' }, [
        el('button', { class: 'btn btn-sm btn-ghost', text: 'Editar venta', onclick: function () { App.forms.saleForm(v.id); } }),
        el('button', { class: 'btn btn-sm btn-danger-ghost', text: 'Anular venta', onclick: function () { ui.confirm({ message: '¿Anular la venta? El vehículo vuelve a stock.', danger: true }).then(function (ok) { if (ok) { store.cancelarVenta(v.id); ui.toast('Venta anulada'); App.router.render(); } }); } })
      ])
    ])];
    out.push(dl([
      ['Fecha de venta', fmt.date(s.fecha)],
      ['Precio de venta', fmt.money(s.precio, s.moneda)],
      s.moneda === 'ARS' && s.cotizacionUSD ? ['Cotización del dólar (venta)', fmt.money(s.cotizacionUSD) + '  ·  histórico'] : null,
      s.cotizacionUSD || s.moneda === 'USD' ? ['Valor en USD al vender', fmt.usd(m.ventaUSD)] : null,
      ['Forma de cobro', store.formaCobroLabel(s.formaCobro)],
      s.formaCobro === 'mixto' ? ['Detalle', 'Transferencia ' + fmt.money(s.montoTransferencia, s.moneda) + ' · Efectivo ' + fmt.money(s.montoEfectivo, s.moneda)] : null,
      s.cliente ? ['Cliente', s.cliente.nombre + (s.cliente.telefono ? ' · ' + s.cliente.telefono : '')] : null,
      s.cliente && s.cliente.notas ? ['Notas del cliente', s.cliente.notas] : null,
      s.comision ? ['Comisión a ' + (s.comision.persona || 'un tercero'), fmt.money(s.comision.monto, s.comision.moneda) + (s.comision.pagada ? ' · pagada' : ' · sin pagar')] : null
    ]));

    if (s.financiacion) {
      var f = s.financiacion;
      out.push(el('h4', { text: 'Financiación — cuotas que te tienen que pagar', style: 'margin-top:18px' }));
      out.push(el('div', { class: 'cuotas-summary' }, [
        el('div', {}, [el('span', { text: 'Total' }), el('strong', { text: fmt.money(m.financTotalARS) })]),
        el('div', {}, [el('span', { text: 'Cobrado' }), el('strong', { class: 'pos', text: fmt.money(m.financCobradoARS) })]),
        el('div', {}, [el('span', { text: 'Falta cobrar' }), el('strong', { class: m.financPorCobrarARS ? 'neg' : '', text: fmt.money(m.financPorCobrarARS) })]),
        f.entidad ? el('div', {}, [el('span', { text: 'Entidad' }), el('strong', { text: f.entidad })]) : null,
        f.entrega ? el('div', {}, [el('span', { text: 'Anticipo' }), el('strong', { text: fmt.money(f.entrega, f.moneda) })]) : null,
        m.financVencidasARS ? el('div', {}, [el('span', { text: 'Vencidas' }), el('strong', { class: 'neg', text: fmt.money(m.financVencidasARS) })]) : null
      ]));
      var fhoy = store.todayISO();
      out.push(el('div', { class: 'rem-list' }, (f.cuotas || []).map(function (c) {
        var venc = !c.cobrada && c.vencimiento && c.vencimiento < fhoy;
        var pillTxt = c.cobrada ? 'Cobrada' : (venc ? 'Vencida' : 'Pendiente');
        var pillCls = c.cobrada ? 'pill-ok' : (venc ? 'pill-danger' : 'pill-warn');
        return el('div', { class: 'rem-item rem-auto' + (venc ? ' rem-overdue' : '') + (c.cobrada ? ' is-done' : '') }, [
          el('span', { class: 'rem-ico rem-auto-ico', text: '💰' }),
          el('div', { class: 'rem-item-body' }, [
            el('div', { class: 'rem-item-title' }, [el('span', { class: 'rem-item-name', text: 'Cuota ' + c.numero }), ui.pill(pillTxt, pillCls)]),
            el('div', { class: 'rem-item-meta', text: fmt.money(c.monto, f.moneda) + ' · Vence ' + fmt.date(c.vencimiento) + (c.fechaCobro ? ' · Cobrada el ' + fmt.date(c.fechaCobro) : '') })
          ]),
          c.cobrada
            ? el('button', { class: 'btn btn-sm btn-ghost', text: 'Desmarcar', onclick: function () { store.descobrarCuotaVenta(v.id, c.id); App.router.render(); } })
            : el('button', { class: 'btn btn-sm btn-primary', text: 'Registrar cobro', onclick: function () { cobrarCuotaPrompt(v.id, c); } })
        ]);
      })));
    }

    if (s.tradeIn) {
      var ti = s.tradeIn;
      var tiV = ti.vehicleId ? store.getVehicle(ti.vehicleId) : null;
      out.push(el('div', { class: 'card info-card', style: 'margin-top:16px' }, [
        el('h4', { text: 'Vehículo recibido como parte de pago' }),
        dl([
          ['Vehículo', [ti.marca, ti.modelo, ti.anio].filter(Boolean).join(' ') || '—'],
          ['Patente', ti.patente || '—'],
          ['Kilometraje', ti.km != null ? fmt.num(ti.km) + ' km' : '—'],
          ['Valor asignado', fmt.money(ti.valor, ti.moneda)],
          s.diferencia ? ['Diferencia recibida', fmt.money(s.diferencia.monto, s.diferencia.moneda)] : null,
          ['Valor total de la operación', fmt.money(s.precio, s.moneda)],
          ti.observaciones ? ['Observaciones', ti.observaciones] : null
        ]),
        tiV ? el('a', { class: 'btn btn-sm btn-primary', href: '#/vehiculo/' + tiV.id, text: 'Ver ficha del vehículo recibido' }) : null
      ]));
    }
    return out;
  }

  function tabRentabilidad(v, m) {
    if (!m.vendido) return [ui.emptyState('La rentabilidad se calcula cuando el vehículo se vende.', '📈'), el('div', { class: 'card' }, dl([
      ['Lo que puse hasta ahora', fmt.money(m.costoTotalARS)],
      ['Precio pretendido', v.precioPretendido ? fmt.money(v.precioPretendido, v.precioPretendidoMoneda) : '— (no cargado)'],
      v.precioPretendido ? ['Ganancia potencial', fmt.money(m.estimadoARS - m.costoTotalARS), (m.estimadoARS - m.costoTotalARS) >= 0 ? 'pos' : 'neg'] : null
    ]))];
    var comp = fin.dollarComparison(v);
    return [
      el('div', { class: 'card' }, [
        el('h4', { text: 'Resultado de la operación' }),
        dl([
          ['Precio de compra', fmt.money(m.compraARS)],
          ['Gastos', fmt.money(m.gastosARS)],
          m.comisionARS ? ['Comisiones', fmt.money(m.comisionARS)] : null,
          ['Lo que puse (total)', fmt.money(m.costoTotalARS), 'strong'],
          ['Precio de venta', fmt.money(m.ventaARS)],
          ['Ganancia', (m.gananciaARS >= 0 ? '+' : '') + fmt.money(m.gananciaARS), m.gananciaARS >= 0 ? 'pos strong' : 'neg strong'],
          ['Rentabilidad', fmt.pct(m.rentabilidad), m.gananciaARS >= 0 ? 'pos' : 'neg'],
          ['Resultado en dólares', (m.gananciaUSD >= 0 ? '+' : '') + fmt.usd(m.gananciaUSD), m.gananciaUSD >= 0 ? 'pos' : 'neg']
        ])
      ]),
      comp && comp.venta ? el('div', { class: 'card' }, [
        el('h4', { text: 'Compra vs venta según el dólar' }),
        dl([
          ['Inversión total en USD (compra + gastos)', comp.valorUSD != null ? fmt.usd(comp.valorUSD) : '—'],
          ['Valor de venta en USD', comp.venta.valorUSDVenta != null ? fmt.usd(comp.venta.valorUSDVenta) : '—'],
          ['Variación en dólares', comp.venta.variacionUSDPct != null ? fmt.pct(comp.venta.variacionUSDPct) : '—', (comp.venta.gananciaUSD || 0) >= 0 ? 'pos' : 'neg']
        ]),
        el('a', { class: 'btn btn-sm btn-ghost', href: '#/comparacion/' + v.id, text: 'Ver análisis completo del dólar' })
      ]) : null
    ];
  }

  function tabDocs(v) {
    var opts = [['completa', 'Completa'], ['pendiente', 'Pendiente'], ['transferencia', 'Transferencia pendiente'], ['otro', 'Otro']];
    return [el('div', { class: 'card' }, [
      el('h4', { text: 'Estado de la documentación' }),
      el('div', { class: 'doc-options' }, opts.map(function (o) {
        return el('button', { class: 'doc-opt' + (v.documentacion === o[0] ? ' is-active' : ''), text: o[1], onclick: function () { store.updateVehicle(v.id, { documentacion: o[0] }); ui.toast('Documentación actualizada'); App.router.render(); } });
      }))
    ])];
  }

  function tabObs(v) {
    var ta = ui.textarea({ value: v.observaciones || '', rows: 8, placeholder: 'Escribí cualquier información sobre el vehículo...' });
    return [el('div', { class: 'card' }, [
      el('h4', { text: 'Observaciones generales' }),
      ta,
      el('div', { class: 'center', style: 'margin-top:12px' }, el('button', { class: 'btn btn-primary', text: 'Guardar observaciones', onclick: function () { store.updateVehicle(v.id, { observaciones: ta.value }); ui.toast('Observaciones guardadas', 'success'); } }))
    ])];
  }

  function tabHist(v) {
    var evts = store.getHistory().filter(function (h) { return h.vehicleId === v.id; });
    if (!evts.length) return [ui.emptyState('Sin movimientos registrados.', '🕓')];
    return [App.views.timeline(evts)];
  }

  /* --------- Aviso de copia de seguridad (barra en Inicio) --------- */
  function backupBar() {
    var online = !!(App.auth && App.auth.enabled);
    var last = store.getState().meta.lastBackupAt;
    var excelOn = false;
    try { excelOn = !!(App.excel && App.excel.status && App.excel.status().on); } catch (e) {}
    var dias = last ? Math.floor((Date.now() - last) / 86400000) : null;
    var txt, cls, ico;
    if (excelOn) { txt = 'Se está guardando solo en Excel'; cls = 'is-ok'; ico = '✅'; }
    // en modo online los datos ya viven en la nube (Supabase): no hace falta
    // alarmar con "no hiciste copia" — el export local es un extra, no la única red de seguridad.
    else if (online && last == null) { txt = 'Tus datos se guardan en la nube. Podés exportar una copia extra'; cls = ''; ico = '☁️'; }
    else if (last == null) { txt = 'Todavía no hiciste ninguna copia de seguridad'; cls = 'is-urgent'; ico = '⚠️'; }
    else if (dias <= 0) { txt = 'Última copia de seguridad: hoy'; cls = 'is-ok'; ico = '✅'; }
    else if (dias === 1) { txt = 'Última copia de seguridad: ayer'; cls = ''; ico = '💾'; }
    else if (online) { txt = 'Última copia extra: hace ' + dias + ' días (tus datos ya están en la nube)'; cls = ''; ico = '💾'; }
    else { txt = 'Última copia de seguridad: hace ' + dias + ' días'; cls = dias >= 3 ? 'is-urgent' : ''; ico = dias >= 3 ? '⚠️' : '💾'; }
    return el('a', { class: 'backup-bar ' + cls, href: '#/exportar' }, [
      el('span', { class: 'backup-bar-ico', text: ico }),
      el('span', { class: 'backup-bar-txt', text: txt }),
      el('span', { class: 'backup-bar-cta', text: excelOn ? 'Ver' : 'Hacer copia →' })
    ]);
  }

  window.App = window.App || {};
  App.views = App.views || {};
  App.views.dashboard = dashboard;
  App.views.vehicleList = vehicleListView;
  App.views.vehicleDetail = vehicleDetail;
  App.views.vehicleRow = vehicleRow;
  App.views._dl = dl;
  App.views._kpi = kpi;
  App.views._backupBar = backupBar;
})();
