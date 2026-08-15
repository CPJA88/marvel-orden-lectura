import fs from 'node:fs/promises';
import path from 'node:path';
import extract from 'extract-zip';

const root = process.cwd();
const archive = path.join(root, 'Marvel_Orden_de_Lectura_PWA.zip');
const output = path.join(root, 'public');
const source = path.join(root, 'source');
const uiVersion = 'v1.1.0-ui';

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

// La base de datos y la lógica siguen viniendo del ZIP; la interfaz se mantiene
// como archivos de texto normales en GitHub para poder iterarla sin reempaquetar.
await Promise.all([
  fs.copyFile(path.join(source, 'index.html'), path.join(output, 'index.html')),
  fs.copyFile(path.join(source, 'styles.css'), path.join(output, 'styles.css')),
]);

// Fuerza la actualización inmediata del shell PWA tras cambios visuales.
const swPath = path.join(output, 'sw.js');
let sw = await fs.readFile(swPath, 'utf8');
sw = sw.replace(/marvel-lectura-v[^'\"]+/g, `marvel-lectura-${uiVersion}`);
await fs.writeFile(swPath, sw);

// Mantiene la descarga offline en el mismo caché que el Service Worker.
const appPath = path.join(output, 'app.js');
let app = await fs.readFile(appPath, 'utf8');
app = app.replace(/marvel-lectura-v1\.0\.1/g, `marvel-lectura-${uiVersion}`);
await fs.writeFile(appPath, app);

const manifestPath = path.join(output, 'manifest.webmanifest');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
manifest.background_color = '#09090b';
manifest.theme_color = '#0b0b0d';
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

for (const required of ['index.html', 'app.js', 'styles.css', 'manifest.webmanifest', 'sw.js', 'data/meta.json', 'data/search.json']) {
  await fs.access(path.join(output, required));
}

console.log(`PWA Marvel extraída, UI ${uiVersion} aplicada y validada en public/.`);
