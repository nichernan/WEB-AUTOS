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
    var monto = input({ type: 'text', inputmode: 'decimal', name: name, value: valueMonto != null ? valueMonto : '', placeholder: '0', class: 'input money-input' });
    var moneda = select([{ value: 'ARS', label: 'Pesos (ARS)' }, { value: 'USD', label: 'Dólares (USD)' }], valueMoneda || 'ARS', { name: name + 'Moneda', class: 'input select moneda-select' });
    return { wrap: el('div', { class: 'money-group' }, [monto, moneda]), monto: monto, moneda: moneda };
  }

  /* ---------------- (Se quitó la carga de fotos) ------------------- */
  // Ícono de auto para las tarjetas y fichas (SVG inline, sin archivos).
  function carIcon(cls) {
    var wrap = el('span', { class: 'car-icon ' + (cls || '') });
    wrap.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M12 40c0-1 .2-2 .5-3l3.2-9c.9-2.5 3.3-4.2 6-4.2h20.6c2.7 0 5.1 1.7 6 4.2l3.2 9c.3 1 .5 2 .5 3v8.5c0 1.4-1.1 2.5-2.5 2.5h-2c-1.4 0-2.5-1.1-2.5-2.5V47H21.5v1.5c0 1.4-1.1 2.5-2.5 2.5h-2c-1.4 0-2.5-1.1-2.5-2.5z" fill="currentColor"/><path d="M18 34l2.3-6.3c.4-1 1.4-1.7 2.5-1.7h18.4c1.1 0 2.1.7 2.5 1.7L48 34z" fill="#fff" opacity=".28"/><circle cx="22" cy="42" r="3.2" fill="#fff" opacity=".9"/><circle cx="42" cy="42" r="3.2" fill="#fff" opacity=".9"/></svg>';
    return wrap;
  }

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

  /* ------------------------------- Export ---------------------------- */
  function emptyState(msg, icon) {
    return el('div', { class: 'empty' }, [
      el('div', { class: 'empty-icon', text: icon || '📭' }),
      el('p', { text: msg })
    ]);
  }

  window.App = window.App || {};
  App.ui = {
    el: el, clear: clear, qs: qs, qsa: qsa, appendChildren: appendChildren,
    toast: toast, modal: modal, confirm: confirm,
    field: field, input: input, textarea: textarea, select: select, money2: money2,
    carIcon: carIcon,
    downloadFile: downloadFile, toCSV: toCSV,
    estadoBadge: estadoBadge, docBadge: docBadge, pill: pill, resultBadge: resultBadge,
    emptyState: emptyState
  };
  App.fmt = {
    money: money, moneyFull: moneyFull, usd: usd, pct: pct, num: num,
    date: date, dateLong: dateLong, datetime: datetime, days: days, relative: relative
  };
})();
