import fs from 'node:fs/promises';
import vm from 'node:vm';

const source=await fs.readFile('source/marvel-reader-fallback-v1240.js','utf8');
const targets=new Map([
  [29395,'55204'],
  [29387,'55203'],
  [60401,'73928'],
  [338373,'535'],
  [521503,'6307'],
  [521504,'6308'],
  [1244835,'34127'],
]);
const marvel=new Map();
for(const [id,readerId] of targets)marvel.set(id,{id,readerId,preinstalledStatus:5});
marvel.set(999999,{id:999999,readerId:'55204',preinstalledStatus:5});
marvel.set(888888,{id:888888,readerId:'123',preinstalledStatus:1,smartLink:'https://example.test/kept'});

const context={
  state:{marvel},
  unlimitedState:m=>({label:Number(m?.preinstalledStatus)===5?'Unlimited ✓ · enlace pendiente':'BASE',cls:'base'}),
  stableAppHref:()=> 'BASE-HREF',
  updateRenderedMeta:()=>{},
  requestAnimationFrame:fn=>fn(),
  setTimeout:fn=>fn(),
  console,
};
vm.createContext(context);
vm.runInContext(source,context,{filename:'marvel-reader-fallback-v1240.js'});

let checked=0;
for(const [id,readerId] of targets){
  const m=marvel.get(id);
  const state=context.unlimitedState(m);
  if(state.label!=='Unlimited ✓'||state.cls!=='available')throw new Error(`Badge incorrecto para GCD ${id}`);
  const href=context.stableAppHref({id},{});
  const expected=`https://marvel.smart.link/fiir7ec77?type=reader&drn=${readerId}`;
  if(href!==expected)throw new Error(`Fallback incorrecto para GCD ${id}: ${href}`);
  checked++;
}
if(context.stableAppHref({id:999999},{})!=='BASE-HREF')throw new Error('El fallback escapó de la allowlist de 7 GCD.');
if(context.stableAppHref({id:888888},{})!=='BASE-HREF')throw new Error('El fallback alteró una entrada positiva normal.');
if(context.unlimitedState(marvel.get(999999)).label==='Unlimited ✓')throw new Error('Una entrada status 5 fuera de allowlist se marcó como resuelta.');
console.log(`Fallback reader validado: ${checked}/7 objetivos; ninguna entrada fuera de allowlist afectada.`);
