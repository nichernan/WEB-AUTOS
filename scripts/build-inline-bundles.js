const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const moduleNames = [
  'brand-logo', 'store', 'finance', 'ui', 'xlsx', 'excel', 'notify',
  'supabase', 'auth', 'sync', 'forms', 'views1', 'views2', 'app'
];

for (const target of ['PaginaToto-WEB/index.html', 'PaginaToto.html']) {
  const targetPath = path.join(root, target);
  let html = fs.readFileSync(targetPath, 'utf8');
  for (const name of moduleNames) {
    const marker = `/* ===== js/${name}.js ===== */`;
    const start = html.indexOf(marker);
    if (start < 0) throw new Error(`${target}: falta el marcador ${marker}`);
    const contentStart = start + marker.length;
    const end = html.indexOf('</script>', contentStart);
    if (end < 0) throw new Error(`${target}: falta el cierre de script para ${name}`);
    const source = fs.readFileSync(path.join(root, 'PaginaToto-CODIGO-FUENTE', 'js', `${name}.js`), 'utf8').trimEnd();
    html = html.slice(0, contentStart) + '\n' + source + '\n' + html.slice(end);
  }

  const css = fs.readFileSync(path.join(root, 'PaginaToto-CODIGO-FUENTE', 'assets', 'styles.css'), 'utf8').trimEnd();
  let replaced = false;
  html = html.replace(/(<style[^>]*>)[\s\S]*?(<\/style>)/i, (_, open, close) => {
    replaced = true;
    return open + '\n' + css + '\n' + close;
  });
  if (!replaced) throw new Error(`${target}: falta el bloque de estilos`);
  fs.writeFileSync(targetPath, html, 'utf8');
  console.log(`Bundle actualizado: ${target}`);
}

const sourceIndex = path.join(root, 'PaginaToto-CODIGO-FUENTE', 'index.html');
let index = fs.readFileSync(sourceIndex, 'utf8');
index = index.replace(/(js\/(?:store|sync|views2)\.js\?v=)19/g, '$1' + '20');
fs.writeFileSync(sourceIndex, index, 'utf8');
console.log('Versiones de caché actualizadas para store.js, sync.js y views2.js.');
