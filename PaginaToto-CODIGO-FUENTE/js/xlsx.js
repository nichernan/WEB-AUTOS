/* ============================================================================
 * xlsx.js  —  Escritor de archivos Excel (.xlsx) con estilos, sin dependencias
 * ----------------------------------------------------------------------------
 * Genera un .xlsx real (ZIP de XML) con:
 *   - varias hojas
 *   - encabezados en negrita y con color
 *   - colores de fondo por celda, bordes, alineación
 *   - formato de número (miles) y colores para positivo / negativo
 * Uso:
 *   var wb = App.xlsx.create();
 *   var ws = wb.sheet('Autos', { cols: [24, 12], freeze: 1 });
 *   ws.row(['Marca', 'Precio'], 'header');
 *   ws.row(['Toyota', { v: 1500000, s: { numFmt: 'money' } }]);
 *   wb.blob();  // -> Blob   |   wb.download('archivo.xlsx');
 * ==========================================================================*/
(function () {
  'use strict';

  /* ------------------------------- utilidades ------------------------------ */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''); // caracteres de control inválidos en XML
  }
  function colLetter(n) { // 1 -> A
    var s = '';
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
    return s;
  }

  /* --------------------------------- CRC32 -------------------------------- */
  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ------------------------------ ZIP (store) ---------------------------- */
  function zip(files) {
    // files: [{ name, data(Uint8Array) }]
    var enc = new TextEncoder();
    var parts = [];
    var central = [];
    var offset = 0;
    var now = new Date();
    var dosTime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | ((now.getSeconds() / 2) & 31);
    var dosDate = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);

    files.forEach(function (f) {
      var nameBytes = enc.encode(f.name);
      var data = f.data;
      var crc = crc32(data);
      var local = new Uint8Array(30 + nameBytes.length);
      var dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);          // version needed
      dv.setUint16(6, 0x0800, true);      // flag: UTF-8 names
      dv.setUint16(8, 0, true);           // compression: store
      dv.setUint16(10, dosTime, true);
      dv.setUint16(12, dosDate, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      parts.push(local, data);

      var cd = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      cd.set(nameBytes, 46);
      central.push(cd);

      offset += local.length + data.length;
    });

    var cdSize = central.reduce(function (a, c) { return a + c.length; }, 0);
    var cdOffset = offset;
    central.forEach(function (c) { parts.push(c); });

    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdOffset, true);
    parts.push(eocd);

    return new Blob(parts, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ----------------------------- estilos (styles.xml) ------------------- */
  var NUMFMT = { money: '#,##0', money2: '#,##0.00', pct: '0.0"%"', int: '#,##0', date: 'dd/mm/yyyy' };

  function StyleBook() {
    this.fonts = ['<font><sz val="11"/><name val="Calibri"/></font>'];
    this.fills = [
      '<fill><patternFill patternType="none"/></fill>',
      '<fill><patternFill patternType="gray125"/></fill>'
    ];
    this.borders = [
      '<border><left/><right/><top/><bottom/><diagonal/></border>',
      '<border><left style="thin"><color rgb="FFD9DEE8"/></left><right style="thin"><color rgb="FFD9DEE8"/></right><top style="thin"><color rgb="FFD9DEE8"/></top><bottom style="thin"><color rgb="FFD9DEE8"/></bottom><diagonal/></border>'
    ];
    this.numFmts = [];        // {id, code}
    this.xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
    this.cache = {};
  }
  StyleBook.prototype._idx = function (arr, xml) {
    var i = arr.indexOf(xml);
    if (i >= 0) return i;
    arr.push(xml);
    return arr.length - 1;
  };
  StyleBook.prototype._numFmtId = function (code) {
    for (var i = 0; i < this.numFmts.length; i++) if (this.numFmts[i].code === code) return this.numFmts[i].id;
    var id = 164 + this.numFmts.length;
    this.numFmts.push({ id: id, code: code });
    return id;
  };
  StyleBook.prototype.style = function (s) {
    s = s || {};
    var key = JSON.stringify(s);
    if (this.cache[key] != null) return this.cache[key];

    var fontId = 0;
    if (s.bold || s.italic || s.color || s.size) {
      var f = '<font>';
      if (s.bold) f += '<b/>';
      if (s.italic) f += '<i/>';
      if (s.size) f += '<sz val="' + s.size + '"/>'; else f += '<sz val="11"/>';
      if (s.color) f += '<color rgb="FF' + s.color + '"/>';
      f += '<name val="Calibri"/></font>';
      fontId = this._idx(this.fonts, f);
    }

    var fillId = 0;
    if (s.fill) {
      fillId = this._idx(this.fills,
        '<fill><patternFill patternType="solid"><fgColor rgb="FF' + s.fill + '"/><bgColor indexed="64"/></patternFill></fill>');
    }

    var borderId = s.border ? 1 : 0;

    var numFmtId = 0;
    if (s.numFmt) {
      var code = NUMFMT[s.numFmt] || s.numFmt;
      numFmtId = this._numFmtId(code);
    }

    var xf = '<xf numFmtId="' + numFmtId + '" fontId="' + fontId + '" fillId="' + fillId + '" borderId="' + borderId + '" xfId="0"';
    var applies = [];
    if (numFmtId) applies.push('applyNumberFormat="1"');
    if (fontId) applies.push('applyFont="1"');
    if (fillId) applies.push('applyFill="1"');
    if (borderId) applies.push('applyBorder="1"');
    var align = '';
    if (s.align || s.wrap || s.valign) {
      applies.push('applyAlignment="1"');
      align = '<alignment' +
        (s.align ? ' horizontal="' + s.align + '"' : '') +
        (s.valign ? ' vertical="' + s.valign + '"' : ' vertical="center"') +
        (s.wrap ? ' wrapText="1"' : '') + '/>';
    }
    if (applies.length) xf += ' ' + applies.join(' ');
    xf += align ? ('>' + align + '</xf>') : '/>';

    var idx = this._idx(this.xfs, xf);
    this.cache[key] = idx;
    return idx;
  };
  StyleBook.prototype.xml = function () {
    var nf = this.numFmts.length
      ? '<numFmts count="' + this.numFmts.length + '">' +
        this.numFmts.map(function (n) { return '<numFmt numFmtId="' + n.id + '" formatCode="' + esc(n.code) + '"/>'; }).join('') +
        '</numFmts>'
      : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      nf +
      '<fonts count="' + this.fonts.length + '">' + this.fonts.join('') + '</fonts>' +
      '<fills count="' + this.fills.length + '">' + this.fills.join('') + '</fills>' +
      '<borders count="' + this.borders.length + '">' + this.borders.join('') + '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="' + this.xfs.length + '">' + this.xfs.join('') + '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
  };

  /* -------------------------------- Hoja -------------------------------- */
  function Sheet(name, opts, book) {
    this.name = name;
    this.opts = opts || {};
    this.book = book;
    this.rows = [];       // cada fila: array de { v, num, s }
  }
  Sheet.prototype.row = function (cells, defStyle) {
    var self = this;
    function resolve(sp) {
      if (!sp) return null;
      if (typeof sp === 'string') return self.book.named[sp] || null;
      return sp;
    }
    var base = resolve(defStyle);
    var out = (cells || []).map(function (c) {
      var v, sp;
      if (c != null && typeof c === 'object' && ('v' in c || 's' in c)) { v = c.v; sp = resolve(c.s); }
      else { v = c; sp = null; }
      if (!sp) sp = base;
      else if (base) sp = Object.assign({}, base, sp);   // override sobre el estilo base de la fila
      var isNum = (typeof v === 'number' && isFinite(v));
      return { v: v, num: isNum, s: sp };
    });
    this.rows.push(out);
    return this;
  };
  Sheet.prototype.blank = function (n) { for (var i = 0; i < (n || 1); i++) this.rows.push([]); return this; };

  Sheet.prototype.xml = function (first) {
    var book = this.book;
    var nCols = 1;
    this.rows.forEach(function (r) { if (r.length > nCols) nCols = r.length; });
    var nRows = this.rows.length || 1;

    var views = '<sheetViews><sheetView workbookViewId="0"' + (first ? ' tabSelected="1"' : '') + '>';
    if (this.opts.freeze) {
      var fr = this.opts.freeze;
      views += '<pane ySplit="' + fr + '" topLeftCell="A' + (fr + 1) + '" activePane="bottomLeft" state="frozen"/>' +
        '<selection pane="bottomLeft" activeCell="A' + (fr + 1) + '" sqref="A' + (fr + 1) + '"/>';
    }
    views += '</sheetView></sheetViews>';

    var cols = '';
    if (this.opts.cols && this.opts.cols.length) {
      cols = '<cols>' + this.opts.cols.map(function (w, i) {
        return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
      }).join('') + '</cols>';
    }

    var body = '';
    for (var r = 0; r < this.rows.length; r++) {
      var cells = this.rows[r];
      var rowXml = '';
      for (var c = 0; c < cells.length; c++) {
        var cell = cells[c];
        if (cell.v == null || cell.v === '') {
          if (cell.s) {
            var sIdxE = book.styles.style(cell.s);
            rowXml += '<c r="' + colLetter(c + 1) + (r + 1) + '" s="' + sIdxE + '"/>';
          }
          continue;
        }
        var sIdx = cell.s ? book.styles.style(cell.s) : 0;
        var ref = colLetter(c + 1) + (r + 1);
        if (cell.num) {
          rowXml += '<c r="' + ref + '"' + (sIdx ? ' s="' + sIdx + '"' : '') + '><v>' + cell.v + '</v></c>';
        } else {
          rowXml += '<c r="' + ref + '"' + (sIdx ? ' s="' + sIdx + '"' : '') + ' t="inlineStr"><is><t xml:space="preserve">' + esc(cell.v) + '</t></is></c>';
        }
      }
      body += '<row r="' + (r + 1) + '">' + rowXml + '</row>';
    }

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<dimension ref="A1:' + colLetter(nCols) + nRows + '"/>' +
      views +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      cols +
      '<sheetData>' + body + '</sheetData>' +
      '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
      '</worksheet>';
  };

  /* ------------------------------ Libro -------------------------------- */
  function Workbook() {
    this.sheets = [];
    this.styles = new StyleBook();
    this.named = {};
  }
  Workbook.prototype.define = function (name, spec) { this.named[name] = spec; return this; };
  Workbook.prototype.sheet = function (name, opts) {
    var s = new Sheet(String(name).slice(0, 31).replace(/[\\\/\?\*\[\]:]/g, ' '), opts, this);
    this.sheets.push(s);
    return s;
  };
  Workbook.prototype.blob = function () {
    var enc = new TextEncoder();
    var self = this;
    var files = [];

    var sheetTypes = this.sheets.map(function (s, i) {
      return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    }).join('');
    files.push({ name: '[Content_Types].xml', data: enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheetTypes +
      '</Types>') });

    files.push({ name: '_rels/.rels', data: enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>') });

    var sheetsXml = this.sheets.map(function (s, i) {
      return '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
    }).join('');
    files.push({ name: 'xl/workbook.xml', data: enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + sheetsXml + '</sheets></workbook>') });

    var rels = this.sheets.map(function (s, i) {
      return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
    }).join('');
    rels += '<Relationship Id="rId' + (this.sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + '</Relationships>') });

    // hojas primero (para poblar estilos), luego styles.xml
    var sheetFiles = this.sheets.map(function (s, i) {
      return { name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: enc.encode(s.xml(i === 0)) };
    });
    files.push({ name: 'xl/styles.xml', data: enc.encode(this.styles.xml()) });
    sheetFiles.forEach(function (f) { files.push(f); });

    return zip(files);
  };
  Workbook.prototype.download = function (filename) {
    var blob = this.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename || 'export.xlsx';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 120);
  };

  window.App = window.App || {};
  App.xlsx = { create: function () { return new Workbook(); } };
})();
