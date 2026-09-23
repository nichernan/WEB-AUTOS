/* ============================================================================
 * app.js  —  Shell de navegación, router y arranque
 * ==========================================================================*/
(function () {
  'use strict';
  var ui = App.ui, el = ui.el, store = App.store;

  var NAV = [
    { path: '', icon: '🏠', label: 'Inicio' },
    { path: 'finanzas', icon: '📊', label: 'Finanzas' },
    { path: 'gastos-negocio', icon: '🏢', label: 'Gastos del negocio' },
    { path: 'cuotas', icon: '💳', label: 'Cuotas y cobros' },
    { path: 'resumenes', icon: '🧮', label: 'Resúmenes' },
    { path: 'comparacion', icon: '💵', label: 'Comparación dólar' },
    { path: 'historial', icon: '🕓', label: 'Historial' },
    { path: 'contactos', icon: '👥', label: 'Clientes y proveedores' },
    { path: 'alertas', icon: '🔔', label: 'Alertas' },
    { path: 'exportar', icon: '📤', label: 'Exportar' },
    { path: 'papelera', icon: '🗑️', label: 'Papelera' },
    { path: 'ajustes', icon: '⚙️', label: 'Ajustes' }
  ];

  // Barra inferior para celular (accesos directos más usados)
  var BOTTOM_NAV = [
    { path: '', icon: '🏠', label: 'Inicio' },
    { path: 'finanzas', icon: '📊', label: 'Finanzas' },
    { path: 'cuotas', icon: '💳', label: 'Cuotas' },
    { path: 'alertas', icon: '🔔', label: 'Alertas' },
    { path: '__menu', icon: '☰', label: 'Menú' }
  ];

  var appRoot, mainEl, sidebarEl, searchEl;

  function build() {
    appRoot = el('div', { class: 'app-shell' });

    // Sidebar
    var online = App.auth && App.auth.enabled;
    sidebarEl = el('aside', { class: 'sidebar' }, [
      el('div', { class: 'brand' }, [
        el('div', { class: 'brand-logo', text: '🚘' }),
        el('div', {}, [el('strong', { text: 'PaginaToto' }), el('span', { class: 'brand-sub', text: 'Gestión de compraventa' })])
      ]),
      el('nav', { class: 'nav' }, NAV.map(function (n) {
        return el('a', { class: 'nav-item', href: '#/' + n.path, dataset: { path: n.path } }, [
          el('span', { class: 'nav-icon', text: n.icon }),
          el('span', { class: 'nav-label', text: n.label }),
          n.path === 'alertas' ? el('span', { class: 'nav-badge', id: 'alert-badge', hidden: true }) : null
        ]);
      })),
      online ? el('div', { class: 'sidebar-user' }, [
        el('span', { class: 'sidebar-user-name', text: (App.auth.profile && (App.auth.profile.nombre || App.auth.profile.email)) || '' }),
        el('button', { class: 'btn btn-sm btn-ghost', text: 'Salir', onclick: function () { App.auth.logout(); } })
      ]) : null
    ]);

    // Topbar
    searchEl = ui.input({ placeholder: 'Buscar auto por marca, modelo, año, patente...', class: 'input topbar-search' });
    searchEl.addEventListener('input', function () {
      App.filters.q = searchEl.value;
      if (currentPath().name !== '') location.hash = '#/';
      else App.router.render();
    });
    searchEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { location.hash = '#/'; } });

    var topbar = el('header', { class: 'topbar' }, [
      el('button', { class: 'icon-btn menu-toggle', html: '☰', 'aria-label': 'Menú', onclick: function () { document.body.classList.toggle('sidebar-open'); } }),
      el('div', { class: 'topbar-brand', text: 'PaginaToto' }),
      el('div', { class: 'topbar-search-wrap' }, searchEl),
      el('button', { class: 'btn btn-primary btn-add-top', html: '<span>＋</span><span class="hide-sm">Vehículo</span>', 'aria-label': 'Registrar vehículo', onclick: function () { App.forms.vehicleForm(); } })
    ]);

    var backdrop = el('div', { class: 'sidebar-backdrop', onclick: function () { document.body.classList.remove('sidebar-open'); } });

    mainEl = el('main', { class: 'main' });

    var bottomnav = el('nav', { class: 'bottomnav' }, BOTTOM_NAV.map(function (n) {
      var kids = [
        el('span', { class: 'bottomnav-ico', text: n.icon }),
        el('span', { class: 'bottomnav-lbl', text: n.label }),
        n.path === 'alertas' ? el('span', { class: 'bottomnav-badge', id: 'bottomnav-alert-badge', hidden: true }) : null
      ];
      if (n.path === '__menu') {
        return el('button', { class: 'bottomnav-item', type: 'button', 'aria-label': 'Menú', onclick: function () { document.body.classList.toggle('sidebar-open'); } }, kids);
      }
      return el('a', { class: 'bottomnav-item', href: '#/' + n.path, dataset: { path: n.path } }, kids);
    }));

    appRoot.appendChild(sidebarEl);
    appRoot.appendChild(backdrop);
    appRoot.appendChild(el('div', { class: 'content-col' }, [topbar, mainEl, bottomnav]));

    document.body.appendChild(appRoot);
  }

  /* ------------------------------- Router ---------------------------- */
  function currentPath() {
    var h = location.hash.replace(/^#\/?/, '');
    var qi = h.indexOf('?');
    var query = '';
    if (qi >= 0) { query = h.slice(qi + 1); h = h.slice(0, qi); }
    var parts = h.split('/').filter(Boolean);
    return { name: parts[0] || '', param: parts[1] || '', query: query };
  }

  function render() {
    var p = currentPath();
    ui.clear(mainEl);
    mainEl.scrollTop = 0;
    window.scrollTo(0, 0);

    try {
      switch (p.name) {
        case '': App.views.dashboard(mainEl); break;
        case 'vehiculo': App.views.vehicleDetail(mainEl, p.param); break;
        case 'finanzas': App.views.finanzas(mainEl); break;
        case 'gastos-negocio': App.views.gastosNegocio(mainEl); break;
        case 'cuotas': App.views.cuotas(mainEl); break;
        case 'resumenes': App.views.resumenes(mainEl); break;
        case 'comparacion': App.views.comparacion(mainEl, p.param); break;
        case 'historial': App.views.historial(mainEl); break;
        case 'contactos': App.views.contactos(mainEl); break;
        case 'alertas': App.views.alertas(mainEl); break;
        case 'exportar': App.views.exportar(mainEl); break;
        case 'papelera': App.views.papelera(mainEl); break;
        case 'ajustes': App.views.ajustes(mainEl); break;
        default: App.views.dashboard(mainEl);
      }
    } catch (err) {
      console.error('Error al renderizar la vista:', err);
      mainEl.appendChild(el('div', { class: 'page' }, [
        el('div', { class: 'card' }, [
          el('h3', { text: 'Ocurrió un error al mostrar esta sección' }),
          el('pre', { class: 'error-pre', text: String(err && err.stack || err) }),
          el('button', { class: 'btn btn-ghost', text: 'Volver al inicio', onclick: function () { location.hash = '#/'; } })
        ])
      ]));
    }

    // sync nav active (lateral + barra inferior)
    var activePath = (p.name === 'vehiculo') ? '' : p.name;
    ui.qsa('.nav-item', sidebarEl).forEach(function (a) {
      a.classList.toggle('is-active', a.dataset.path === activePath);
    });
    ui.qsa('.bottomnav-item[data-path]', appRoot).forEach(function (a) {
      a.classList.toggle('is-active', a.dataset.path === activePath);
    });
    if (searchEl && document.activeElement !== searchEl) searchEl.value = App.filters.q || '';
    document.body.classList.remove('sidebar-open');
    updateAlertBadge();
  }

  function updateAlertBadge() {
    if (!App.alerts) return;
    var n = App.alerts.count();
    ['alert-badge', 'bottomnav-alert-badge'].forEach(function (id) {
      var badge = document.getElementById(id);
      if (!badge) return;
      badge.hidden = n === 0;
      badge.textContent = n;
    });
  }

  function go(path) { location.hash = '#/' + path; }

  App.router = { render: render, go: go, currentPath: currentPath };

  /* ------------------------------- Init ------------------------------ */
  function afterBoot() {
    if (App.excel && App.excel.initAutosave) { try { App.excel.initAutosave(); } catch (e) {} }
    if (App.notify && App.notify.check) { try { setTimeout(App.notify.check, 800); } catch (e) {} }
    console.log('%cPaginaToto listo', 'color:#2563eb;font-weight:bold');
  }

  function startShell() {
    build();
    store.subscribe(function () { render(); });
    window.addEventListener('hashchange', render);
    render();
  }

  function askMigration() {
    if (!App.data || !App.data.pendingMigrationInfo) return;
    var info = App.data.pendingMigrationInfo();
    if (!info) return;
    setTimeout(function () {
      App.ui.confirm({
        title: 'Datos locales encontrados',
        message: 'Encontramos ' + info.autos + ' auto(s) guardados en esta computadora. ¿Querés subirlos a la nube para compartirlos con los demás usuarios? Si eran datos de prueba, elegí "No".',
        confirmText: 'Sí, subir', cancelText: 'No'
      }).then(function (ok) {
        if (ok) App.data.doMigration(); else App.data.skipMigration();
      });
    }, 600);
  }

  function init() {
    if (App.auth && App.auth.enabled) {
      // Modo online: login -> cargar datos de la nube -> app
      App.auth.boot(function () {
        App.data.loadAll().then(function () {
          startShell();
          afterBoot();
          askMigration();
        }).catch(function (err) {
          console.error('No se pudieron cargar los datos:', err);
          document.body.innerHTML = '';
          var box = el('div', { class: 'auth-screen' }, [
            el('div', { class: 'auth-card' }, [
              el('h2', { text: 'No se pudieron cargar los datos' }),
              el('p', { class: 'auth-hint', text: 'Revisá tu conexión a internet y volvé a intentar.' }),
              el('button', { class: 'btn btn-primary auth-btn', text: 'Reintentar', onclick: function () { location.reload(); } })
            ])
          ]);
          document.body.appendChild(box);
        });
      });
      return;
    }
    // Modo local (archivo único): localStorage
    store.load();
    startShell();
    afterBoot();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
