import fs from 'node:fs/promises';
import path from 'node:path';
import extract from 'extract-zip';

const root = process.cwd();
const archive = path.join(root, 'Marvel_Orden_de_Lectura_PWA.zip');
const output = path.join(root, 'public');

try {
  await fs.access(archive);
} catch {
  console.error('Falta Marvel_Orden_de_Lectura_PWA.zip en la raíz del repositorio.');
  process.exit(1);
}

await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
await extract(archive, { dir: output });

for (const required of ['index.html', 'app.js', 'styles.css', 'manifest.webmanifest', 'sw.js', 'data/meta.json', 'data/search.json']) {
  await fs.access(path.join(output, required));
}

console.log('PWA Marvel extraída y validada en public/.');
