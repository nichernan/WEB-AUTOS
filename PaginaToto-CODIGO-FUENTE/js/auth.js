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
  var recovering = false; // true mientras se está por el link de "olvidé mi contraseña"
  var PROFILE_KEY = 'paginaToto:verifiedProfile';
  var offlineProfile = false;

  function cachedProfile(session) {
    try {
      var p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
      if (!p || !session || !session.user || p.id !== session.user.id || !p.activo) return null;
      var saved = JSON.parse(localStorage.getItem('paginaToto:v1') || 'null');
      if (!saved || !['vehicles', 'history', 'reminders', 'fixedExpenses'].some(function (k) { return Array.isArray(saved[k]) && saved[k].length; })) return null;
      // No conceder acceso después de la expiración del token que Supabase guardó.
      if (!session.expires_at || session.expires_at * 1000 <= Date.now()) return null;
      return p;
    } catch (e) { return null; }
  }

  function isNetworkError(err) {
    if (!err) return false;
    var status = err.status || err.statusCode;
    // Una respuesta HTTP/Auth explícita prevalece sobre navigator.onLine:
    // incluso con la interfaz de red desconectada, un 401 no es un fallo de red.
    if (status >= 400 && status < 500) return false;
    if (status === 0 || status >= 500) return true;
    if (err.name === 'TypeError' || err.name === 'NetworkError' || err.name === 'AbortError') return true;
    if (/network|fetch|failed to fetch|load failed|timeout|timed out|offline/i.test(String(err.message || ''))) return true;
    return !navigator.onLine && !err.code;
  }

  function networkFallback(err) {
    if (!isNetworkError(err)) return Promise.reject(err);
    return sb.auth.getSession().then(function (res) {
      var session = res.data && res.data.session;
      var p = cachedProfile(session);
      if (!p) {
        if (session && session.expires_at && session.expires_at * 1000 <= Date.now()) {
          localStorage.removeItem(PROFILE_KEY);
          return sb.auth.signOut().then(function () { return null; });
        }
        // Sin credencial local/perfil verificado se vuelve al login. Un fallo
        // de red nunca crea una identidad offline.
        return null;
      }
      offlineProfile = true;
      return p;
    });
  }

  function fullScreen(node) {
    document.body.innerHTML = '';
    var wrap = el('div', { class: 'auth-screen' }, [node]);
    document.body.appendChild(wrap);
  }

  function card(children) {
    return el('div', { class: 'auth-card' }, [
      el('div', { class: 'auth-brand' }, [
        el('img', { class: 'auth-logo-img', src: App.assets.logo, alt: 'Car Style Mercedes' })
      ])
    ].concat(children));
  }

  function loginScreen(msg) {
    var email = ui.input({ type: 'email', placeholder: 'tu@email.com', autocomplete: 'username', inputmode: 'email' });
    var pass = ui.input({ type: 'password', placeholder: 'Contraseña', autocomplete: 'current-password' });
    var err = el('p', { class: 'auth-err', text: msg || '' });
    // type="submit" implícito: el propio submit del <form> ya llama a submit();
    // si acá también tuviera onclick, un solo click dispararía el login dos veces.
    var btn = el('button', { type: 'submit', class: 'btn btn-primary auth-btn', text: 'Entrar' });

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
      }).catch(function (e) {
        err.textContent = isNetworkError(e) ? 'No hay conexión a internet. Revisá tu conexión y volvé a intentar.' : 'No se pudo iniciar sesión. Volvé a intentar.';
        btn.disabled = false; btn.textContent = 'Entrar';
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

  // Pantalla para elegir nueva contraseña, después de tocar el link de recuperación del mail
  function recoveryScreen(msg) {
    var p1 = ui.input({ type: 'password', placeholder: 'Nueva contraseña', autocomplete: 'new-password' });
    var p2 = ui.input({ type: 'password', placeholder: 'Repetir contraseña', autocomplete: 'new-password' });
    var err = el('p', { class: 'auth-err', text: msg || '' });
    var btn = el('button', { type: 'submit', class: 'btn btn-primary auth-btn', text: 'Guardar contraseña' });

    var form = el('form', { class: 'auth-form', onsubmit: function (e) { e.preventDefault(); submit(); } }, [
      ui.field('Nueva contraseña', p1),
      ui.field('Repetir contraseña', p2),
      err,
      btn,
      el('p', { class: 'auth-hint', text: 'Elegí una contraseña de 6 caracteres o más.' })
    ]);

    fullScreen(card([el('h2', { text: 'Elegí tu nueva contraseña' }), form]));
    setTimeout(function () { p1.focus(); }, 50);

    function submit() {
      var a = p1.value, b = p2.value;
      if (!a || a.length < 6) { err.textContent = 'La contraseña tiene que tener 6 caracteres o más.'; return; }
      if (a !== b) { err.textContent = 'Las contraseñas no coinciden.'; return; }
      btn.disabled = true; btn.textContent = 'Guardando…'; err.textContent = '';
      sb.auth.updateUser({ password: a }).then(function (res) {
        if (res.error) {
          err.textContent = 'No se pudo cambiar la contraseña: ' + res.error.message;
          btn.disabled = false; btn.textContent = 'Guardar contraseña';
          return;
        }
        recovering = false;
        start();
      });
    }
  }

  function loadProfile() {
    return sb.auth.getUser().then(function (res) {
      if (res.error) {
        if (res.error.name === 'AuthSessionMissingError' || /session missing/i.test(String(res.error.message || ''))) {
          localStorage.removeItem(PROFILE_KEY);
          return null;
        }
        if (isNetworkError(res.error)) return networkFallback(res.error);
        // Una respuesta real de Auth (401, token inválido/revocado) invalida
        // la sesión almacenada y jamás habilita el fallback offline.
        localStorage.removeItem(PROFILE_KEY);
        if (res.error.status === 401 || res.error.status === 403 || res.error.code) {
          return sb.auth.signOut().then(function () { return null; });
        }
        throw res.error;
      }
      var user = res.data && res.data.user;
      if (!user) { localStorage.removeItem(PROFILE_KEY); return null; }
      return sb.from('profiles').select('*').eq('id', user.id).single().then(function (p) {
        if (p.error) {
          if (isNetworkError(p.error)) return networkFallback(p.error);
          throw p.error;
        }
        var base = { id: user.id, email: user.email, nombre: '', role: 'usuario', activo: false };
        return Object.assign(base, p.data || {}, { authEmail: user.email });
      });
    }).catch(function (err) {
      if (offlineProfile) throw err;
      return networkFallback(err);
    });
  }

  function start() {
    if (recovering) { recoveryScreen(); return; }
    fullScreen(card([el('h2', { text: 'Cargando…' })]));
    loadProfile().then(function (p) {
      if (recovering) { recoveryScreen(); return; }
      if (!p) { loginScreen(); return; }
      if (!p.activo) { localStorage.removeItem(PROFILE_KEY); fullScreen(blockedScreen(p)); return; }
      App.auth.profile = p;
      if (!offlineProfile) {
        try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (e) {}
      }
      App.auth.offline = offlineProfile;
      document.body.innerHTML = '';
      if (readyCb) readyCb(p);
    }).catch(function (e) {
      if (recovering) { recoveryScreen(); return; }
      console.error('auth start', e);
      fullScreen(errorScreen());
    });
  }

  App.auth = {
    enabled: true,
    profile: null,
    offline: false,
    isAdmin: function () { return !!(App.auth.profile && App.auth.profile.role === 'admin'); },
    // se usa en app.js para distinguir, después de un login ya validado, si
    // la carga de datos que sigue falló por falta de red (recuperable con
    // los datos locales) o por un error real (no ocultarlo con un fallback).
    isNetworkError: isNetworkError,
    logout: function () {
      localStorage.removeItem(PROFILE_KEY);
      sb.auth.signOut().then(function () { location.reload(); });
    },
    boot: function (cb) { readyCb = cb; start(); },
    reloadProfile: function () {
      offlineProfile = false;
      return loadProfile().then(function (p) {
        if (p) App.auth.profile = p;
        App.auth.offline = offlineProfile;
        if (p && p.activo && !offlineProfile) {
          try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (e) {}
        }
        return p;
      });
    },
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
    if (evt === 'PASSWORD_RECOVERY') { recovering = true; recoveryScreen(); return; }
    if (evt === 'SIGNED_OUT') { localStorage.removeItem(PROFILE_KEY); location.reload(); }
  });
})();
