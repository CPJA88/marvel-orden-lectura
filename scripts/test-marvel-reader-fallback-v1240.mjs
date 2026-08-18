import fs from 'node:fs/promises';
import vm from 'node:vm';

const source=await fs.readFile('source/marvel-reader-fallback-v1240.js','utf8');
const pack=JSON.parse(await fs.readFile('source/marvel-cache/index.json','utf8'));
const original=new Map([
  [29395,'55204'],[29387,'55203'],[60401,'73928'],[338373,'535'],[521503,'6307'],[521504,'6308'],[1244835,'34127'],
]);
const rows=new Map(pack.entries.map(r=>[Number(r[0]),r]));
const expectedIds=Array.isArray(pack.readerFallbackGcdIds)&&pack.readerFallbackGcdIds.length?pack.readerFallbackGcdIds.map(Number):[...original.keys()];
const targets=new Map();
for(const id of expectedIds){const row=rows.get(id);if(!row)throw new Error(`Fallback GCD ${id} no existe en caché.`);const readerId=String(Number(row[2])||'');if(Number(row[3])!==5||!readerId)throw new Error(`Fallback GCD ${id} no es status5 con readerId.`);targets.set(id,readerId)}
for(const [id,readerId] of original)if(targets.get(id)!==readerId)throw new Error(`Se perdió fallback original GCD ${id}.`);

const marvel=new Map();for(const [id,readerId] of targets)marvel.set(id,{id,readerId,preinstalledStatus:5});
let outsider=999999;while(targets.has(outsider))outsider++;
marvel.set(outsider,{id:outsider,readerId:'55204',preinstalledStatus:5});
marvel.set(888888,{id:888888,readerId:'123',preinstalledStatus:1,smartLink:'https://example.test/kept'});
const context={state:{marvel},unlimitedState:m=>({label:Number(m?.preinstalledStatus)===5?'Unlimited ✓ · enlace pendiente':'BASE',cls:'base'}),stableAppHref:()=> 'BASE-HREF',updateRenderedMeta:()=>{},requestAnimationFrame:fn=>fn(),setTimeout:fn=>fn(),console};
vm.createContext(context);vm.runInContext(source,context,{filename:'marvel-reader-fallback-v1240.js'});
let checked=0;for(const [id,readerId] of targets){const m=marvel.get(id),state=context.unlimitedState(m);if(state.label!=='Unlimited ✓'||state.cls!=='available')throw new Error(`Badge incorrecto para GCD ${id}`);const href=context.stableAppHref({id},{}),expected=`https://marvel.smart.link/fiir7ec77?type=reader&drn=${readerId}`;if(href!==expected)throw new Error(`Fallback incorrecto para GCD ${id}: ${href}`);checked++}
if(context.stableAppHref({id:outsider},{})!=='BASE-HREF')throw new Error('El fallback escapó de la allowlist verificada.');
if(context.stableAppHref({id:888888},{})!=='BASE-HREF')throw new Error('El fallback alteró una entrada positiva normal.');
if(context.unlimitedState(marvel.get(outsider)).label==='Unlimited ✓')throw new Error('Una entrada status5 no verificada se marcó como resuelta.');
console.log(`Fallback reader validado: ${checked} objetivos verificados; ninguna entrada fuera de allowlist afectada.`);
