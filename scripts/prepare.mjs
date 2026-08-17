import fs from 'node:fs/promises';
import path from 'node:path';
import extract from 'extract-zip';

const root=process.cwd();
const archive=path.join(root,'Marvel_Orden_de_Lectura_PWA.zip');
const output=path.join(root,'public');
const source=path.join(root,'source');
const uiVersion='v1.2.22-structured-links';
const sourceFiles=['index.html','styles.css','enhancements.css','diagnostics.css','app.js','diagnostics.js','resolver-ui.js','cache-ui.js','stability-v22.js','diagnostic-v22.js'];

for(const name of sourceFiles){
  const file=path.join(source,name);
  try{await fs.access(file)}catch{console.error(`Falta ${path.relative(root,file)}.`);process.exit(1)}
}
try{await fs.access(archive)}catch{console.error('Falta Marvel_Orden_de_Lectura_PWA.zip.');process.exit(1)}

await fs.rm(output,{recursive:true,force:true});
await fs.mkdir(output,{recursive:true});
await extract(archive,{dir:output});
for(const name of sourceFiles)await fs.copyFile(path.join(source,name),path.join(output,name));

const indexPath=path.join(output,'index.html');
let index=await fs.readFile(indexPath,'utf8');
const scripts=['resolver-ui.js','cache-ui.js','stability-v22.js','diagnostic-v22.js'];
let anchor='<script src="diagnostics.js" defer></script>';
for(const script of scripts){
  if(!index.includes(script)){
    const tag=`<script src="${script}" defer></script>`;
    index=index.replace(anchor,anchor+'\n'+tag);anchor=tag;
  }else anchor=`<script src="${script}" defer></script>`;
}
await fs.writeFile(indexPath,index);

const swPath=path.join(output,'sw.js');
let sw=await fs.readFile(swPath,'utf8');
sw=sw.replace(/marvel-lectura-v[^'\"]+/g,`marvel-lectura-${uiVersion}`);
sw=sw.replace("'styles.css','app.js'","'styles.css','enhancements.css','diagnostics.css','app.js','diagnostics.js','resolver-ui.js','cache-ui.js','stability-v22.js','diagnostic-v22.js'");
await fs.writeFile(swPath,sw);

const manifestPath=path.join(output,'manifest.webmanifest');
const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
manifest.background_color='#f3f1ec';manifest.theme_color='#f3f1ec';
await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');

for(const required of ['index.html','app.js','diagnostics.js','resolver-ui.js','cache-ui.js','stability-v22.js','diagnostic-v22.js','styles.css','enhancements.css','diagnostics.css','manifest.webmanifest','sw.js','data/meta.json','data/search.json','data/series.json'])await fs.access(path.join(output,required));
console.log(`PWA Marvel construida con ${uiVersion}: sourceId y digitalId desde metadata estructurada; DRN desde share.marvel.com; Smart Link exacto marvel.smart.link; portada Marvel por sourceId con GCD solo como fallback.`);
