/* ============================================================================
 * auth.js  —  Login con email + contraseña (versión online)
 * ----------------------------------------------------------------------------
 * - Si no hay Supabase configurado -> App.auth.enabled = false (modo local).
 * - Muestra la pantalla de login hasta que el usuario entra.
 * - Bloquea a los usuarios desactivados.
 * ==========================================================================*/
(function () {
  'use strict';
  var ui = App.ui, el = ui.el;

  if (!App.sb) { App.auth = { enabled: false }; return; }
  var sb = App.sb;
  var readyCb = null;

  function fullScreen(node) {
    document.body.innerHTML = '';
    var wrap = el('div', { class: 'auth-screen' }, [node]);
    document.body.appendChild(wrap);
  }

  function card(children) {
    return el('div', { class: 'auth-card' }, [
      el('div', { class: 'auth-brand' }, [
        el('span', { class: 'auth-logo', text: '🚘' }),
        el('strong', { text: 'PaginaToto' })
      ])
    ].concat(children));
  }

  function loginScreen(msg) {
    var email = ui.input({ type: 'email', placeholder: 'tu@email.com', autocomplete: 'username', inputmode: 'email' });
    var pass = ui.input({ type: 'password', placeholder: 'Contraseña', autocomplete: 'current-password' });
    var err = el('p', { class: 'auth-err', text: msg || '' });
    var btn = el('button', { class: 'btn btn-primary auth-btn', text: 'Entrar', onclick: submit });

    var form = el('form', { class: 'auth-form', onsubmit: function (e) { e.preventDefault(); submit(); } }, [
      ui.field('Email', email),
      ui.field('Contraseña', pass),
      err,
      btn,
      el('p', { class: 'auth-hint', text: '¿No podés entrar? Pedile al administrador que te dé de alta o te resetee la contraseña.' })
    ]);

    fullScreen(card([el('h2', { text: 'Iniciar sesión' }), form]));
    setTimeout(function () { email.focus(); }, 50);

    function submit() {
      var e = email.value.trim().toLowerCase(), p = pass.value;
      if (!e || !p) { err.textContent = 'Completá email y contraseña.'; return; }
      btn.disabled = true; btn.textContent = 'Entrando…'; err.textContent = '';
      sb.auth.signInWithPassword({ email: e, password: p }).then(function (res) {
        if (res.error) {
          err.textContent = 'Email o contraseña incorrectos.';
          btn.disabled = false; btn.textContent = 'Entrar';
          return;
        }
        start();
      });
    }
  }

  function blockedScreen(profile) {
    return card([
      el('h2', { text: 'Tu usuario está desactivado' }),
      el('p', { class: 'auth-hint', text: 'El administrador todavía no te habilitó o te dio de baja. Contactalo.' }),
      el('button', { class: 'btn btn-ghost auth-btn', text: 'Salir', onclick: function () { sb.auth.signOut().then(function () { location.reload(); }); } })
    ]);
  }

  function errorScreen(txt) {
    return card([
      el('h2', { text: 'No se pudo conectar' }),
      el('p', { class: 'auth-hint', text: txt || 'Revisá tu conexión a internet y volvé a intentar.' }),
      el('button', { class: 'btn btn-primary auth-btn', text: 'Reintentar', onclick: function () { location.reload(); } })
    ]);
  }

  function loadProfile() {
    return sb.auth.getUser().then(function (res) {
      var user = res.data && res.data.user;
      if (!user) return null;
      return sb.from('profiles').select('*').eq('id', user.id).single().then(function (p) {
        var base = { id: user.id, email: user.email, nombre: '', role: 'usuario', activo: false };
        return Object.assign(base, p.data || {}, { authEmail: user.email });
      });
    });
  }

  function start() {
    fullScreen(card([el('h2', { text: 'Cargando…' })]));
    loadProfile().then(function (p) {
      if (!p) { loginScreen(); return; }
      if (!p.activo) { fullScreen(blockedScreen(p)); return; }
      App.auth.profile = p;
      document.body.innerHTML = '';
      if (readyCb) readyCb(p);
    }).catch(function (e) {
      console.error('auth start', e);
      fullScreen(errorScreen());
    });
  }

  App.auth = {
    enabled: true,
    profile: null,
    isAdmin: function () { return !!(App.auth.profile && App.auth.profile.role === 'admin'); },
    logout: function () { sb.auth.signOut().then(function () { location.reload(); }); },
    boot: function (cb) { readyCb = cb; start(); },
    reloadProfile: function () { return loadProfile().then(function (p) { if (p) App.auth.profile = p; return p; }); },
    // llama a la Edge Function que administra usuarios (solo admin)
    adminApi: function (action, payload) {
      return sb.functions.invoke('admin-users', { body: Object.assign({ action: action }, payload || {}) })
        .then(function (res) {
          if (res.error) {
            var msg = (res.error && res.error.message) || 'Error';
            try { if (res.data && res.data.error) msg = res.data.error; } catch (e) {}
            throw new Error(msg);
          }
          if (res.data && res.data.error) throw new Error(res.data.error);
          return res.data;
        });
    }
  };

  sb.auth.onAuthStateChange(function (evt) {
    if (evt === 'SIGNED_OUT') location.reload();
  });
})();
