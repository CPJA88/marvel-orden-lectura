import fs from 'node:fs/promises';
import path from 'node:path';
import extract from 'extract-zip';

const root=process.cwd();
const archive=path.join(root,'Marvel_Orden_de_Lectura_PWA.zip');
const output=path.join(root,'public');
const source=path.join(root,'source');
const uiVersion='v1.2.18.1-neighbor-gcd';

for(const file of [archive,path.join(source,'index.html'),path.join(source,'styles.css'),path.join(source,'enhancements.css'),path.join(source,'diagnostics.css'),path.join(source,'app.js'),path.join(source,'diagnostics.js'),path.join(source,'resolver-ui.js'),path.join(source,'cache-ui.js'),path.join(source,'diagnostic-v8-fix.js'),path.join(source,'diagnostic-trace.js'),path.join(source,'diagnostic-catalog.js')]){
  try{await fs.access(file)}catch{console.error(`Falta ${path.relative(root,file)}.`);process.exit(1)}
}
await fs.rm(output,{recursive:true,force:true});
await fs.mkdir(output,{recursive:true});
await extract(archive,{dir:output});
await Promise.all([
  fs.copyFile(path.join(source,'index.html'),path.join(output,'index.html')),
  fs.copyFile(path.join(source,'styles.css'),path.join(output,'styles.css')),
  fs.copyFile(path.join(source,'enhancements.css'),path.join(output,'enhancements.css')),
  fs.copyFile(path.join(source,'diagnostics.css'),path.join(output,'diagnostics.css')),
  fs.copyFile(path.join(source,'app.js'),path.join(output,'app.js')),
  fs.copyFile(path.join(source,'diagnostics.js'),path.join(output,'diagnostics.js')),
  fs.copyFile(path.join(source,'resolver-ui.js'),path.join(output,'resolver-ui.js')),
  fs.copyFile(path.join(source,'cache-ui.js'),path.join(output,'cache-ui.js')),
  fs.copyFile(path.join(source,'diagnostic-v8-fix.js'),path.join(output,'diagnostic-v8-fix.js')),
  fs.copyFile(path.join(source,'diagnostic-trace.js'),path.join(output,'diagnostic-trace.js')),
  fs.copyFile(path.join(source,'diagnostic-catalog.js'),path.join(output,'diagnostic-catalog.js')),
]);

const indexPath=path.join(output,'index.html');
let index=await fs.readFile(indexPath,'utf8');
if(!index.includes('resolver-ui.js'))index=index.replace('<script src="diagnostics.js" defer></script>','<script src="diagnostics.js" defer></script>\n<script src="resolver-ui.js" defer></script>');
if(!index.includes('cache-ui.js'))index=index.replace('<script src="resolver-ui.js" defer></script>','<script src="resolver-ui.js" defer></script>\n<script src="cache-ui.js" defer></script>');
if(!index.includes('diagnostic-v8-fix.js'))index=index.replace('<script src="cache-ui.js" defer></script>','<script src="cache-ui.js" defer></script>\n<script src="diagnostic-v8-fix.js" defer></script>');
if(!index.includes('diagnostic-trace.js'))index=index.replace('<script src="diagnostic-v8-fix.js" defer></script>','<script src="diagnostic-v8-fix.js" defer></script>\n<script src="diagnostic-trace.js" defer></script>');
if(!index.includes('diagnostic-catalog.js'))index=index.replace('<script src="diagnostic-trace.js" defer></script>','<script src="diagnostic-trace.js" defer></script>\n<script src="diagnostic-catalog.js" defer></script>');
await fs.writeFile(indexPath,index);

const swPath=path.join(output,'sw.js');
let sw=await fs.readFile(swPath,'utf8');
sw=sw.replace(/marvel-lectura-v[^'\"]+/g,`marvel-lectura-${uiVersion}`);
sw=sw.replace("'styles.css','app.js'","'styles.css','enhancements.css','diagnostics.css','app.js','diagnostics.js','resolver-ui.js','cache-ui.js','diagnostic-v8-fix.js','diagnostic-trace.js','diagnostic-catalog.js'");
await fs.writeFile(swPath,sw);

const manifestPath=path.join(output,'manifest.webmanifest');
const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
manifest.background_color='#f3f1ec';manifest.theme_color='#f3f1ec';
await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');

for(const required of ['index.html','app.js','diagnostics.js','resolver-ui.js','cache-ui.js','diagnostic-v8-fix.js','diagnostic-trace.js','diagnostic-catalog.js','styles.css','enhancements.css','diagnostics.css','manifest.webmanifest','sw.js','data/meta.json','data/search.json','data/series.json'])await fs.access(path.join(output,required));
console.log(`PWA Marvel construida con ${uiVersion}: portadas por ID GCD y resolución Unlimited por navegación incremental entre números vecinos; diagnóstico V8 alineado con ambas fuentes.`);
