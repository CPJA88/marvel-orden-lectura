import fs from 'node:fs/promises';
import path from 'node:path';
import extract from 'extract-zip';

const root=process.cwd();
const archive=path.join(root,'Marvel_Orden_de_Lectura_PWA.zip');
const output=path.join(root,'public');
const source=path.join(root,'source');
const marvelCacheSource=path.join(source,'marvel-cache');
const sagasSource=path.join(source,'data','sagas');
const uiBaseVersion='v1.2.36-unlimited-reader-fallback-v1.5.0-all-sagas';
const sourceFiles=['index.html','styles.css','enhancements.css','characters.css','sagas.css','diagnostics.css','app.js','diagnostics.js','resolver-ui.js','cache-ui.js','cache-authority-v129.js','marvel-reader-fallback-v1240.js','coverage-truth-v135.js','marmota-ui.js','stability-v22.js','diagnostic-v22.js','search-filter-fix-v132.js','character-matching-v130.js','characters-ui-v130.js','sagas-core.js','sagas-ui.js','android-unlimited-v130.js'];

for(const name of sourceFiles){
  const file=path.join(source,name);
  try{await fs.access(file)}catch{console.error(`Falta ${path.relative(root,file)}.`);process.exit(1)}
}
try{await fs.access(path.join(marvelCacheSource,'index.json'))}catch{console.error('Falta source/marvel-cache/index.json.');process.exit(1)}
try{await fs.access(path.join(sagasSource,'catalog.json'))}catch{console.error('Falta source/data/sagas/catalog.json.');process.exit(1)}
try{await fs.access(archive)}catch{console.error('Falta Marvel_Orden_de_Lectura_PWA.zip.');process.exit(1)}

await fs.rm(output,{recursive:true,force:true});
await fs.mkdir(output,{recursive:true});
await extract(archive,{dir:output});
for(const name of sourceFiles)await fs.copyFile(path.join(source,name),path.join(output,name));
await fs.mkdir(path.join(output,'data','marvel-cache'),{recursive:true});
await fs.cp(marvelCacheSource,path.join(output,'data','marvel-cache'),{recursive:true});
await fs.mkdir(path.join(output,'data','sagas'),{recursive:true});
await fs.cp(sagasSource,path.join(output,'data','sagas'),{recursive:true});

const sagaCatalog=JSON.parse(await fs.readFile(path.join(sagasSource,'catalog.json'),'utf8'));
const sagaAssets=['data/sagas/catalog.json',...[...new Set((sagaCatalog.events||[]).map(event=>event.dataFile).filter(Boolean))]];
for(const asset of sagaAssets)await fs.access(path.join(output,asset));

const baked=JSON.parse(await fs.readFile(path.join(output,'data','marvel-cache','index.json'),'utf8'));
if(!baked.ready||baked.localCount<50000)throw new Error(`Caché Marvel incompleta: ready=${Boolean(baked.ready)}, registros=${baked.localCount||0}`);
const cacheStamp=String(baked.generatedAt||'legacy').replace(/[^0-9A-Za-z]+/g,'').slice(0,24)||'legacy';
const uiVersion=`${uiBaseVersion}-${cacheStamp}`;

const indexPath=path.join(output,'index.html');
let index=await fs.readFile(indexPath,'utf8');
const scripts=['resolver-ui.js','cache-ui.js','cache-authority-v129.js','marvel-reader-fallback-v1240.js','coverage-truth-v135.js','marmota-ui.js','stability-v22.js','diagnostic-v22.js','search-filter-fix-v132.js','character-matching-v130.js','characters-ui-v130.js','sagas-core.js','sagas-ui.js','android-unlimited-v130.js'];
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
sw=sw.replace("'styles.css','app.js'",`'styles.css','enhancements.css','characters.css','sagas.css','diagnostics.css','app.js','diagnostics.js','resolver-ui.js','cache-ui.js','cache-authority-v129.js','marvel-reader-fallback-v1240.js','coverage-truth-v135.js','marmota-ui.js','stability-v22.js','diagnostic-v22.js','search-filter-fix-v132.js','character-matching-v130.js','characters-ui-v130.js','sagas-core.js','sagas-ui.js','android-unlimited-v130.js','data/marvel-cache/index.json',${sagaAssets.map(asset=>`'${asset}'`).join(',')}`);
await fs.writeFile(swPath,sw);

const manifestPath=path.join(output,'manifest.webmanifest');
const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
manifest.background_color='#f3f1ec';manifest.theme_color='#f3f1ec';
await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');

for(const required of ['index.html','app.js','diagnostics.js','resolver-ui.js','cache-ui.js','cache-authority-v129.js','marvel-reader-fallback-v1240.js','coverage-truth-v135.js','marmota-ui.js','stability-v22.js','diagnostic-v22.js','search-filter-fix-v132.js','character-matching-v130.js','characters-ui-v130.js','sagas-core.js','sagas-ui.js','android-unlimited-v130.js','styles.css','enhancements.css','characters.css','sagas.css','diagnostics.css','manifest.webmanifest','sw.js','data/meta.json','data/search.json','data/series.json','data/marvel-cache/index.json',...sagaAssets])await fs.access(path.join(output,required));
console.log(`PWA Marvel construida con ${uiVersion}: índice preinstalado=${baked.localCount}; formato=${baked.version||1}; verificación oficial=${Boolean(baked.officiallyVerified)}; cobertura oficial v2 completa=${Boolean(baked.officialCoverageAudit?.completed&&Number(baked.officialCoverageAudit?.version)>=2)}; MU=${baked.matched}; deeplinks UUID preconstruidos=${baked.linkReady||0}; fallback reader oficiales=${baked.readerFallbackReady||0}; enlaces funcionales pendientes=${baked.functionalLinkMissing??baked.linkMissing??0}. Los títulos sin UUID usan exclusivamente su fallback reader oficial verificado por allowlist. Los NO_DIGITAL antiguos se revalidan antes de mostrarse como ausencia definitiva. NOT_LISTED no equivale a ausencia de Unlimited. Pantalla inicial con progreso real de carga; filtros globales en memoria. Órdenes por personaje y sagas, progreso compartido y apertura directa de Unlimited en Android habilitados.`);
