import fs from 'node:fs/promises';
import path from 'node:path';
import extract from 'extract-zip';

const root = process.cwd();
const archive = path.join(root, 'Marvel_Orden_de_Lectura_PWA.zip');
const output = path.join(root, 'public');
const source = path.join(root, 'source');
const uiVersion = 'v1.1.9-ui';

try {
  await fs.access(archive);
} catch {
  console.error('Falta Marvel_Orden_de_Lectura_PWA.zip en la raíz del repositorio.');
  process.exit(1);
}

for (const override of ['index.html', 'styles.css']) {
  try {
    await fs.access(path.join(source, override));
  } catch {
    console.error(`Falta source/${override}; la capa visual no puede construirse.`);
    process.exit(1);
  }
}

await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
await extract(archive, { dir: output });

await Promise.all([
  fs.copyFile(path.join(source, 'index.html'), path.join(output, 'index.html')),
  fs.copyFile(path.join(source, 'styles.css'), path.join(output, 'styles.css')),
]);

// Los cinco botones se mantienen, pero la identificación del cómic vuelve al
// método de v1.1.3: búsqueda Google restringida a marvel.com/comics/issue.
const appPath = path.join(output, 'app.js');
let app = await fs.readFile(appPath, 'utf8');
const detailMarker = 'async function openDetail(id,collection){';
const officialHelper = 'function officialComicLinks(x,s,title){const issue=String(x.n||\'\').trim(),year=String(x.a||\'\').trim(),date=String(x.sv||x.d||\'\').trim(),original=String(s.original||title||\'Marvel\').trim(),spanish=String(title||original).trim();const qs=new URLSearchParams({title:original,issue,year,date});const resolver=mode=>\'/api/marvel/open?\'+qs.toString()+\'&mode=\'+mode;const paniniQuery=\'site:panini.es/shp_esp_es/ "\'+spanish+\'" "\'+(issue?\'#\'+issue:\'\')+\'" \'+year+\' Marvel\';const pan=\'https://www.google.com/search?q=\'+encodeURIComponent(paniniQuery);return \'<div class="official-links"><a class="primary full" style="text-decoration:none" href="\'+esc(resolver(\'android\'))+\'">Abrir en Marvel Unlimited Android</a><a class="primary full" style="text-decoration:none" href="\'+esc(resolver(\'ios\'))+\'">Abrir en Marvel Unlimited iOS</a><a class="secondary full" style="text-decoration:none" target="_blank" rel="noopener" href="\'+esc(resolver(\'web\'))+\'">Abrir en Marvel Unlimited Web</a><a class="secondary full" style="text-decoration:none" target="_blank" rel="noopener" href="\'+esc(pan)+\'">Buscar edición en castellano</a></div>\';}\n';
if (!app.includes('function officialComicLinks(')) app = app.replace(detailMarker, officialHelper + detailMarker);
const gcdMarkup = '<a class="gcd-link" target="_blank" rel="noopener" href="https://www.comics.org/issue/${x.id}/">Abrir ficha en GCD ↗</a>';
if (!app.includes(gcdMarkup)) {
  console.error('No se encontró el enlace GCD esperado en app.js.');
  process.exit(1);
}
app = app.replace(gcdMarkup, '${officialComicLinks(x,s,title)}');
app = app.replace(/marvel-lectura-v1\.0\.1/g, `marvel-lectura-${uiVersion}`);
await fs.writeFile(appPath, app);

const swPath = path.join(output, 'sw.js');
let sw = await fs.readFile(swPath, 'utf8');
sw = sw.replace(/marvel-lectura-v[^'\"]+/g, `marvel-lectura-${uiVersion}`);
await fs.writeFile(swPath, sw);

const manifestPath = path.join(output, 'manifest.webmanifest');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
manifest.background_color = '#f3f1ec';
manifest.theme_color = '#f3f1ec';
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

for (const required of ['index.html', 'app.js', 'styles.css', 'manifest.webmanifest', 'sw.js', 'data/meta.json', 'data/search.json']) {
  await fs.access(path.join(output, required));
}

console.log(`PWA Marvel extraída, UI ${uiVersion} aplicada y método de identificación v1.1.3 restaurado.`);
