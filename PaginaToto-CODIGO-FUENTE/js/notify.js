/* ============================================================================
 * notify.js  —  Avisos: un toast al abrir la app + notificación del navegador
 * ==========================================================================*/
(function () {
  'use strict';
  var store = App.store;

  function supported() { try { return 'Notification' in window; } catch (e) { return false; } }
  function state() { return supported() ? Notification.permission : 'unsupported'; }

  function request() {
    if (!supported()) return Promise.resolve('unsupported');
    return Notification.requestPermission().then(function (p) {
      // preferencia por dispositivo (no se comparte entre usuarios)
      try { localStorage.setItem('paginaToto:avisosNavegador', p === 'granted' ? '1' : '0'); } catch (e) {}
      if (p === 'granted') { App.ui && App.ui.toast('Avisos activados', 'success'); check(true); }
      return p;
    });
  }

  // cuántas cosas necesitan atención (vencidas o de hoy)
  function pendingCount() {
    try { return App.alerts ? App.alerts.count() : 0; } catch (e) { return 0; }
  }

  var shown = false;
  function check(force) {
    if (shown && !force) return;
    shown = true;
    var n = pendingCount();
    if (n <= 0) return;
    var msg = n === 1 ? 'Tenés 1 cosa para revisar en Alertas.' : 'Tenés ' + n + ' cosas para revisar en Alertas.';
    // toast siempre
    if (App.ui) {
      App.ui.toast(msg, 'info');
    }
    // notificación del navegador si está permitido
    try {
      if (supported() && Notification.permission === 'granted') {
        var nt = new Notification('PaginaToto', { body: msg, tag: 'paginatoto-alertas' });
        nt.onclick = function () { window.focus(); location.hash = '#/alertas'; nt.close(); };
      }
    } catch (e) {}
  }

  App.notify = { supported: supported, state: state, request: request, check: check };
})();
