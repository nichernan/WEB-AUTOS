/* ============================================================================
 * supabase.js  —  Inicializa el cliente de Supabase (solo en la versión online)
 * ==========================================================================*/
(function () {
  'use strict';
  window.App = window.App || {};
  var cfg = App.config || {};
  if (!cfg.supabaseUrl || !cfg.supabaseKey || typeof window.supabase === 'undefined') {
    App.sb = null;   // versión local (archivo): no hay nube
    return;
  }
  try {
    App.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'paginaToto:auth' },
      realtime: { params: { eventsPerSecond: 5 } }
    });
  } catch (e) {
    console.error('Supabase init', e);
    App.sb = null;
  }
})();
