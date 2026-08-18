import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import extract from 'extract-zip';

const root=process.cwd();
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'marvel-filter-v132-'));
await extract(path.join(root,'Marvel_Orden_de_Lectura_PWA.zip'),{dir:tmp});
const read=async p=>JSON.parse(await fs.readFile(path.join(tmp,p),'utf8'));
const meta=await read('data/meta.json');
const series=await read('data/series.json');
const seriesMap=new Map(series.map(s=>[Number(s.id),s]));
const issueDecade=new Map();
const issues=[];
for(const c of meta.chunks){
  const rows=await read('data/'+c.file);
  for(const x of rows){issues.push(x);issueDecade.set(Number(x.id),String(c.id))}
}
issues.sort((a,b)=>Number(a.o)-Number(b.o));
const normalize=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9.]+/g,' ').trim();
const tokensOf=v=>normalize(v).split(/\s+/).filter(Boolean);
const textMatch=(x,q)=>{const s=seriesMap.get(Number(x.s))||{},n=String(x.n??''),hay=normalize(`${s.original||''} ${s.es||''} ${n} #${n} ${x.t||''}`);return tokensOf(q).every(t=>hay.includes(t))};
function apply({q='',content='all',era='all',decade='all'}={}){
  return issues.filter(x=>(decade==='all'||issueDecade.get(Number(x.id))===String(decade))&&(content==='all'||x.c===content)&&(era==='all'||x.e===era)&&textMatch(x,q));
}
const report={
  total:issues.length,
  all:apply().length,
  marvelEra:apply({era:'marvel'}).length,
  originals:apply({content:'original'}).length,
  captainAmerica:apply({q:'captain america'}).length,
  capitanAmericaPlain:apply({q:'capitan america'}).length,
  capitanAmericaAccent:apply({q:'capitán america'}).length,
  captain38:apply({q:'captain america 38'}).length,
  decade1940:apply({decade:'1940'}).length,
  timely:apply({era:'timely'}).length,
  combined1940TimelyOriginal:apply({decade:'1940',era:'timely',content:'original'}).length
};
await fs.mkdir(path.join(root,'artifacts'),{recursive:true});
await fs.writeFile(path.join(root,'artifacts','ui-filter-v132-behavior.json'),JSON.stringify(report,null,2)+'\n');
console.log(report);
const failures=[];
if(report.total!==Number(meta.mainCount))failures.push(`total ${report.total}/${meta.mainCount}`);
if(report.all!==report.total)failures.push('Todas las décadas no devuelve toda la biblioteca');
if(report.marvelEra<=0)failures.push('Filtro Marvel vacío');
if(report.originals<=0)failures.push('Filtro Originales vacío');
if(report.captainAmerica<=0)failures.push('Búsqueda Captain America vacía');
if(report.capitanAmericaPlain<=0)failures.push('Búsqueda Capitan America vacía');
if(report.capitanAmericaPlain!==report.capitanAmericaAccent)failures.push('La búsqueda Capitan/Capitán no coincide');
if(report.captain38<=0)failures.push('Búsqueda Captain America 38 vacía');
if(report.decade1940<=0)failures.push('Década 1940 vacía');
if(report.combined1940TimelyOriginal<=0)failures.push('Filtros encadenados 1940+Timely+Original vacío');
if(failures.length)throw new Error(failures.join(' | '));
