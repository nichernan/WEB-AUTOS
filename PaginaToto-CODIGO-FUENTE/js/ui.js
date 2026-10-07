/* ============================================================================
 * ui.js  —  Helpers de DOM, formato, modales, toasts, confirmaciones y gráficos
 * ==========================================================================*/
(function () {
  'use strict';

  /* ------------------------------ DOM helpers --------------------------- */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var val = attrs[k];
      if (k === 'class' || k === 'className') node.className = val;
      else if (k === 'html') node.innerHTML = val;
      else if (k === 'text') node.textContent = val;
      else if (k === 'dataset') Object.keys(val).forEach(function (d) { node.dataset[d] = val[d]; });
      else if (k.slice(0, 2) === 'on' && typeof val === 'function') node.addEventListener(k.slice(2), val);
      else if (val === true) node.setAttribute(k, '');
      else if (val !== false && val != null) node.setAttribute(k, val);
    });
    appendChildren(node, children);
    return node;
  }
  function appendChildren(node, children) {
    if (children == null) return;
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qsa(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  /* ------------------------------ Formato ------------------------------ */
  function money(n, moneda) {
    n = +n || 0;
    var neg = n < 0;
    var abs = Math.abs(Math.round(n));
    var s = abs.toLocaleString('es-AR');
    var prefix = moneda === 'USD' ? 'USD ' : '$';
    return (neg ? '-' : '') + prefix + s;
  }
  function moneyFull(n, moneda) { return money(n, moneda); }
  function usd(n) {
    n = +n || 0;
    return 'USD ' + (Math.round(n)).toLocaleString('es-AR');
  }
  function pct(n, digits) {
    n = +n || 0;
    return n.toLocaleString('es-AR', { minimumFractionDigits: digits == null ? 1 : digits, maximumFractionDigits: digits == null ? 1 : digits }) + '%';
  }
  function num(n, digits) {
    return (+n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: digits == null ? 0 : digits });
  }
  function date(iso) {
    if (!iso) return '—';
    var p = String(iso).split('T')[0].split('-');
    if (p.length !== 3) return iso;
    return p[2] + '/' + p[1] + '/' + p[0];
  }
  function dateLong(iso) {
    if (!iso) return '—';
    var d = App.finance.parseDate(String(iso).split('T')[0]);
    if (!d) return iso;
    return d.getDate() + ' ' + App.finance.MESES_LARGO[d.getMonth()].toLowerCase() + ' ' + d.getFullYear();
  }
  function datetime(ts) {
    var d = new Date(ts);
    return date(d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function days(n) {
    if (n == null) return '—';
    return n === 1 ? '1 día' : num(n) + ' días';
  }
  function relative(iso) {
    var d = App.finance.parseDate(String(iso).split('T')[0]);
    if (!d) return '';
    var diff = Math.round((new Date().setHours(0, 0, 0, 0) - d.setHours(0, 0, 0, 0)) / 86400000);
    if (diff === 0) return 'hoy';
    if (diff === 1) return 'ayer';
    if (diff === -1) return 'mañana';
    if (diff < 0) return 'en ' + Math.abs(diff) + ' días';
    if (diff < 30) return 'hace ' + diff + ' días';
    if (diff < 365) return 'hace ' + Math.round(diff / 30) + ' meses';
    return 'hace ' + Math.round(diff / 365) + ' años';
  }

  /* ------------------------------ Badges ------------------------------- */
  function estadoBadge(estado) {
    var map = { stock: ['En stock', 'badge-stock'], reservado: ['Reservado', 'badge-reservado'], vendido: ['Vendido', 'badge-vendido'] };
    var b = map[estado] || [estado, ''];
    return el('span', { class: 'badge ' + b[1] }, b[0]);
  }
  function docBadge(doc) {
    var map = {
      completa: ['Documentación completa', 'badge-ok'],
      pendiente: ['Documentación pendiente', 'badge-warn'],
      transferencia: ['Transferencia pendiente', 'badge-warn'],
      otro: ['Documentación: otro', 'badge-neutral']
    };
    var b = map[doc] || [doc, 'badge-neutral'];
    return el('span', { class: 'badge ' + b[1] }, b[0]);
  }
  function pill(text, cls) { return el('span', { class: 'pill ' + (cls || '') }, text); }
  function resultBadge(n) {
    var cls = n > 0 ? 'badge-ok' : (n < 0 ? 'badge-danger' : 'badge-neutral');
    var txt = n > 0 ? 'Ganancia' : (n < 0 ? 'Pérdida' : 'Neutro');
    return el('span', { class: 'badge ' + cls }, txt);
  }

  /* ------------------------------ Toasts ------------------------------- */
  var toastWrap;
  function toast(msg, type) {
    if (!toastWrap) { toastWrap = el('div', { class: 'toast-wrap' }); document.body.appendChild(toastWrap); }
    var t = el('div', { class: 'toast toast-' + (type || 'info') }, msg);
    toastWrap.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 3200);
  }

  /* ------------------------------ Modal -------------------------------- */
  var modalStack = [];
  function modal(opts) {
    // opts: { title, body(node), footer(node), size, onClose }
    var overlay = el('div', { class: 'modal-overlay' });
    var box = el('div', { class: 'modal ' + (opts.size ? 'modal-' + opts.size : '') });
    var head = el('div', { class: 'modal-head' }, [
      el('h3', { class: 'modal-title', text: opts.title || '' }),
      el('button', { class: 'icon-btn modal-close', 'aria-label': 'Cerrar', html: '&times;', onclick: close })
    ]);
    var bodyWrap = el('div', { class: 'modal-body' });
    if (opts.body) appendChildren(bodyWrap, opts.body);
    box.appendChild(head);
    box.appendChild(bodyWrap);
    if (opts.footer) {
      var foot = el('div', { class: 'modal-foot' });
      appendChildren(foot, opts.footer);
      box.appendChild(foot);
    }
    overlay.appendChild(box);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay && opts.closeOnBackdrop !== false) close(); });
    document.body.appendChild(overlay);
    document.body.classList.add('modal-open');
    setTimeout(function () { overlay.classList.add('show'); }, 10);
    var esc = function (e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);

    function close() {
      document.removeEventListener('keydown', esc);
      overlay.classList.remove('show');
      setTimeout(function () {
        overlay.remove();
        modalStack = modalStack.filter(function (m) { return m.overlay !== overlay; });
        if (!modalStack.length) document.body.classList.remove('modal-open');
        opts.onClose && opts.onClose();
      }, 220);
    }
    var api = { overlay: overlay, box: box, body: bodyWrap, close: close };
    modalStack.push(api);
    return api;
  }

  // Cierra cualquier modal abierto (p.ej. al volver a tocar el botón de
  // navegación de la sección activa, para no dejar un modal "atrapado").
  function closeAllModals() {
    modalStack.slice().forEach(function (m) { m.close(); });
  }

  function confirm(opts) {
    return new Promise(function (resolve) {
      var m = modal({
        title: opts.title || 'Confirmar',
        size: 'sm',
        body: el('p', { class: 'confirm-text', text: opts.message || '¿Estás seguro?' }),
        closeOnBackdrop: true,
        footer: [
          el('button', { class: 'btn btn-ghost', text: opts.cancelText || 'Cancelar', onclick: function () { m.close(); resolve(false); } }),
          el('button', { class: 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary'), text: opts.confirmText || 'Confirmar', onclick: function () { m.close(); resolve(true); } })
        ]
      });
    });
  }

  /* --------------------------- Inputs de formulario ------------------- */
  function field(label, control, hint) {
    return el('label', { class: 'field' }, [
      el('span', { class: 'field-label', text: label }),
      control,
      hint ? el('span', { class: 'field-hint', text: hint }) : null
    ]);
  }
  function input(attrs) { return el('input', Object.assign({ class: 'input', type: 'text' }, attrs)); }
  function textarea(attrs) { return el('textarea', Object.assign({ class: 'input textarea', rows: 3 }, attrs)); }
  function select(options, value, attrs) {
    var s = el('select', Object.assign({ class: 'input select' }, attrs || {}));
    options.forEach(function (o) {
      var opt = el('option', { value: o.value }, o.label);
      if (String(o.value) === String(value)) opt.selected = true;
      s.appendChild(opt);
    });
    return s;
  }
  function money2(name, valueMonto, valueMoneda) {
    // grupo monto + moneda
    var monto = moneyInput({ name: name, value: valueMonto != null ? valueMonto : '', placeholder: '0', class: 'input money-input' });
    var moneda = select([{ value: 'ARS', label: 'Pesos (ARS)' }, { value: 'USD', label: 'Dólares (USD)' }], valueMoneda || 'ARS', { name: name + 'Moneda', class: 'input select moneda-select' });
    return { wrap: el('div', { class: 'money-group' }, [monto, moneda]), monto: monto, moneda: moneda };
  }

  /* ------------------- Input numérico con separador de miles ---------- */
  // Formatea en vivo mientras el usuario escribe (1000000 -> 1.000.000),
  // acepta pegar, borrar y editar, y mantiene el cursor en una posición
  // razonable. El valor mostrado es siempre compatible con store.num()
  // (que ya interpreta correctamente "1.500.000,50"), así que ningún
  // cálculo cambia: solo cambia cómo se ve mientras se escribe.
  function numberToDisplay(n, allowNegative) {
    if (n == null || n === '') return '';
    n = +n;
    if (isNaN(n)) return '';
    var neg = n < 0 && allowNegative;
    n = Math.abs(n);
    var parts = String(n).split('.');
    var intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    var decPart = parts[1] ? parts[1].slice(0, 2) : null;
    return (neg ? '-' : '') + intPart + (decPart ? ',' + decPart : '');
  }
  function formatTypedNumber(s, allowNegative) {
    var neg = allowNegative && s.charAt(0) === '-';
    s = s.replace(/[^0-9,]/g, '');
    var ci = s.indexOf(',');
    var intPart = ci >= 0 ? s.slice(0, ci) : s;
    var decPart = ci >= 0 ? s.slice(ci + 1).replace(/,/g, '').slice(0, 2) : null;
    intPart = intPart.replace(/^0+(?=\d)/, '');
    var withDots = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    var out = (neg ? '-' : '') + (withDots || (decPart != null ? '0' : ''));
    if (decPart != null) out += ',' + decPart;
    return out;
  }
  function moneyInput(attrs) {
    attrs = Object.assign({}, attrs);
    var allowNegative = !!attrs.allowNegative;
    delete attrs.allowNegative;
    var initVal = attrs.value;
    attrs.value = (initVal != null && initVal !== '') ? numberToDisplay(initVal, allowNegative) : '';
    var inp = input(Object.assign({ inputmode: 'decimal' }, attrs));
    inp.addEventListener('input', function () {
      var before = inp.value, caret = inp.selectionStart == null ? before.length : inp.selectionStart;
      var digitsBeforeCaret = (before.slice(0, caret).match(/[0-9]/g) || []).length;
      var formatted = formatTypedNumber(before, allowNegative);
      if (formatted !== before) inp.value = formatted;
      var pos = 0, seen = 0;
      while (pos < formatted.length && seen < digitsBeforeCaret) { if (/[0-9]/.test(formatted[pos])) seen++; pos++; }
      try { inp.setSelectionRange(pos, pos); } catch (e) {}
    });
    return inp;
  }

  /* ---------------- (Se quitó la carga de fotos) ------------------- */
  // Ícono de auto para las tarjetas y fichas (SVG inline, sin archivos).
  function carIcon(cls) {
    var wrap = el('span', { class: 'car-icon ' + (cls || '') });
    wrap.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M12 40c0-1 .2-2 .5-3l3.2-9c.9-2.5 3.3-4.2 6-4.2h20.6c2.7 0 5.1 1.7 6 4.2l3.2 9c.3 1 .5 2 .5 3v8.5c0 1.4-1.1 2.5-2.5 2.5h-2c-1.4 0-2.5-1.1-2.5-2.5V47H21.5v1.5c0 1.4-1.1 2.5-2.5 2.5h-2c-1.4 0-2.5-1.1-2.5-2.5z" fill="currentColor"/><path d="M18 34l2.3-6.3c.4-1 1.4-1.7 2.5-1.7h18.4c1.1 0 2.1.7 2.5 1.7L48 34z" fill="#fff" opacity=".28"/><circle cx="22" cy="42" r="3.2" fill="#fff" opacity=".9"/><circle cx="42" cy="42" r="3.2" fill="#fff" opacity=".9"/></svg>';
    return wrap;
  }

  /* ------------- Íconos lineales (una sola familia, SVG inline) ---------- */
  // Mismo trazo para toda la app (24×24, 1.75 de grosor, esquinas redondas).
  // Se usa en navegación y en los módulos rediseñados; el color lo hereda del
  // texto (currentColor).
  var ICONS = {
    home: '<path d="M3.5 11 12 3.8l8.5 7.2"/><path d="M5.5 9.8V20h13V9.8"/><path d="M10 20v-5.5h4V20"/>',
    car: '<path d="M5 16.5H3.5v-5L5.6 7h12.8l2.1 4.5v5H19"/><circle cx="7.6" cy="16.6" r="1.9"/><circle cx="16.4" cy="16.6" r="1.9"/><path d="M9.5 16.6h5M3.5 11.5h17"/>',
    chart: '<path d="M4 20V11M10 20V4M16 20v-6M2.5 20h19"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.8c2 .7 3 2.4 3 5.2"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    back: '<path d="m15 6-6 6 6 6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    alert: '<path d="M12 4 21.5 20h-19z"/><path d="M12 10v4.2M12 17.2v.3"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v3a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h3"/>',
    dollar: '<circle cx="12" cy="12" r="9"/><path d="M14.6 9.3c-.5-.9-1.4-1.3-2.6-1.3-1.5 0-2.5.8-2.5 1.9 0 2.7 5.2 1.3 5.2 4 0 1.1-1 1.9-2.7 1.9-1.2 0-2.2-.5-2.7-1.5M12 6.5v1.5M12 16.3v1.4"/>',
    file: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
    tag: '<path d="M3.5 12V4.5h7.5L20.5 14l-7 7z"/><circle cx="7.8" cy="8.3" r="1.2"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    bookmark: '<path d="M7 4h10v17l-5-4-5 4z"/>',
    hourglass: '<path d="M7 3h10M7 21h10M8 3c0 5 4 6 4 9s-4 4-4 9M16 3c0 5-4 6-4 9s4 4 4 9"/>',
    trend: '<path d="m3 17 6-6 4 4 8-8M15 7h6v6"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 13h18"/>',
    wrench: '<path d="M14.5 6.5a4 4 0 0 0 4.9 4.9L21 13l-8 8-3.5-3.5 8-8z"/><path d="M6 18l-2.5 2.5"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    dots: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 17.3 9 4.5 4.5 0 0 1 17 18z"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    swap: '<path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/>',
    handshake: '<path d="M3 11l4-4 4 2 3-2 5 4-2 2M8 17l-3-3 2-2M11 20l-4-4M14 19l-3-3"/>',
    message: '<path d="M4 5h16v11H10l-4 4v-4H4z"/><path d="M8 9.5h8M8 12.5h5"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'
  };
  function icon(name, cls) {
    var w = el('span', { class: 'ico' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' });
    w.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || ICONS.dots) + '</svg>';
    return w;
  }

  /* ------------------------------ Tema (claro / oscuro / auto) ------------ */
  // La preferencia se guarda en este navegador (clave propia, no toca los datos
  // de la app). "auto" = sin atributo: el CSS sigue prefers-color-scheme del sistema.
  var THEME_KEY = 'paginaToto:tema';
  function themeGet() {
    try { var t = localStorage.getItem(THEME_KEY); return (t === 'light' || t === 'dark') ? t : 'auto'; } catch (e) { return 'auto'; }
  }
  function themeApply(t) {
    var root = document.documentElement;
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
  }
  function themeSet(t) {
    try { if (t === 'light' || t === 'dark') localStorage.setItem(THEME_KEY, t); else localStorage.removeItem(THEME_KEY); } catch (e) {}
    themeApply(t);
  }
  themeApply(themeGet());
  window.addEventListener('storage', function (e) { if (e.key === THEME_KEY) themeApply(themeGet()); });

  /* (gráficos y galería de fotos: eliminados) */


  /* ------------------------------ Descargas -------------------------- */
  function downloadFile(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 100);
  }
  function toCSV(rows) {
    return rows.map(function (r) {
      return r.map(function (cell) {
        var s = cell == null ? '' : String(cell);
        if (/[",\n;]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
        return s;
      }).join(';');
    }).join('\r\n');
  }

  /* ------------- Enter avanza al siguiente campo (como Tab) ----------- */
  // Solución única y centralizada para toda la app: un solo listener
  // global en document, en vez de repetir "Enter -> siguiente campo" en
  // cada formulario. Enter en un input/select se comporta como Tab: busca
  // el siguiente campo visible y habilitado dentro del mismo formulario
  // (la tarjeta ".modal" si está en un modal, o la página ".page" si no)
  // y le da foco. Nunca envía, guarda ni cierra nada — solo mueve el foco.
  // Recalcula la lista de campos en cada Enter (sin cachear), así que los
  // campos que aparecen/desaparecen (p.ej. "+ Más datos", "Mixto") entran
  // o salen solos de la navegación sin código extra por formulario.
  //
  // Excepciones respetadas a propósito (no se tocan):
  // - textarea: Enter sigue siendo salto de línea.
  // - <button>: Enter lo sigue ejecutando (no se intercepta en absoluto).
  // - inputs dentro de un <form> real (login/alta de usuario en auth.js,
  //   único caso en la app): se deja el submit nativo tal cual estaba.
  // - el buscador de la barra superior (.topbar-search-wrap): ya tiene su
  //   propio Enter para ir a la lista filtrada; no se lo pisamos.
  var ENTER_NON_FIELD_TYPES = { button: true, submit: true, reset: true, file: true, hidden: true, image: true };
  function isNavigableField(n) {
    if (!n || !n.tagName) return false;
    var tag = n.tagName.toLowerCase();
    if (tag === 'select') return !n.disabled;
    if (tag !== 'input') return false;
    if (ENTER_NON_FIELD_TYPES[(n.type || '').toLowerCase()]) return false;
    return !n.disabled && !n.readOnly;
  }
  function isVisibleField(n) { return n.offsetParent !== null; }
  function nextNavigableField(scope, current) {
    var all = scope.querySelectorAll('input, select');
    var candidates = [];
    for (var i = 0; i < all.length; i++) {
      if (isNavigableField(all[i]) && isVisibleField(all[i])) candidates.push(all[i]);
    }
    var idx = candidates.indexOf(current);
    if (idx === -1 || idx === candidates.length - 1) return null;
    return candidates[idx + 1];
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.isComposing) return;
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    var t = e.target;
    if (!t || !t.tagName) return;
    var tag = t.tagName.toLowerCase();
    if (tag === 'textarea') return;
    if (tag === 'button' || (tag === 'input' && ENTER_NON_FIELD_TYPES[(t.type || '').toLowerCase()])) return;
    if (t.closest('form')) return;
    if (t.closest('.topbar-search-wrap')) return;
    if (!isNavigableField(t)) return;
    var scope = t.closest('.modal') || t.closest('.page') || document.body;
    var next = nextNavigableField(scope, t);
    e.preventDefault();
    if (next) next.focus();
  });

  /* ------------------------------- Export ---------------------------- */
  function emptyState(msg, ico) {
    // si "ico" es el nombre de un ícono lineal se dibuja ese; si no, el emoji de siempre
    return el('div', { class: 'empty' }, [
      ICONS[ico] ? el('div', { class: 'empty-icon empty-icon-svg' }, icon(ico)) : el('div', { class: 'empty-icon', text: ico || '📭' }),
      el('p', { text: msg })
    ]);
  }

  window.App = window.App || {};
  App.ui = {
    el: el, clear: clear, qs: qs, qsa: qsa, appendChildren: appendChildren,
    toast: toast, modal: modal, confirm: confirm, closeAllModals: closeAllModals,
    field: field, input: input, textarea: textarea, select: select, money2: money2,
    moneyInput: moneyInput,
    carIcon: carIcon, icon: icon,
    theme: { get: themeGet, set: themeSet },
    downloadFile: downloadFile, toCSV: toCSV,
    estadoBadge: estadoBadge, docBadge: docBadge, pill: pill, resultBadge: resultBadge,
    emptyState: emptyState
  };
  App.fmt = {
    money: money, moneyFull: moneyFull, usd: usd, pct: pct, num: num,
    date: date, dateLong: dateLong, datetime: datetime, days: days, relative: relative
  };
})();
