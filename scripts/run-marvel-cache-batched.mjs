import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root=process.cwd();
const sourceFile=path.join(root,'scripts','generate-marvel-cache.mjs');
const tempFile=path.join(root,'scripts','.generate-marvel-cache-batched.runtime.mjs');

let source=await fs.readFile(sourceFile,'utf8');

function replaceOnce(search,replacement,label){
  if(!source.includes(search))throw new Error(`No se pudo aplicar el parche ${label}.`);
  source=source.replace(search,replacement);
}

replaceOnce('const DRN_CONCURRENCY=14;','const DRN_CONCURRENCY=8;','concurrencia DRN');
replaceOnce('const VERIFY_CONCURRENCY=10;','const VERIFY_CONCURRENCY=5;','concurrencia de verificación');
replaceOnce(
  '    if(!issues.length)throw new Error(`El catálogo remoto no devolvió ningún número para ${year}; se aborta para evitar falsos negativos.`);',
  '    if(!issues.length)console.warn(`Año ${year}: sin entradas en el catálogo remoto; se continúa sin inventar resultados.`);',
  'años vacíos'
);

const marker='\nasync function loadExisting(){';
const helpers=String.raw`
const PREBUILD_BATCH_SIZE=500;
const PREBUILD_CHECKPOINT_VERSION=4;
const PREBUILD_CHECKPOINT_TTL=72*60*60*1000;
const prebuildCheckpointDir=path.join(root,'.cache','marvel-prebuild-v3');
const prebuildCheckpointFile=path.join(prebuildCheckpointDir,'checkpoint.json');

function compactCandidate(r,score){
  return{sourceId:r.sourceId,readerId:r.readerId,coverUrl:r.coverUrl,score};
}
function buildRemoteNumberIndex(remote){
  const byNumber=new Map();
  for(const r of remote){
    const n=normalizeIssue(r.issueNumber);if(!n)continue;
    if(!byNumber.has(n))byNumber.set(n,[]);
    byNumber.get(n).push(r);
  }
  return byNumber;
}
function candidateRowBatched(x,local,byNumber){
  const series=local.seriesMap.get(Number(x.s))||{};
  const localTitle=series?.original||series?.es||'',issueNumber=asString(x.n);
  const pool=byNumber.get(normalizeIssue(issueNumber))||[];
  const ranked=pool.map(r=>({r,score:scoreCandidate(x,series,r)}))
    .filter(v=>Number.isFinite(v.score))
    .sort((a,b)=>b.score-a.score)
    .slice(0,MAX_CANDIDATES);
  return{gcdId:Number(x.id),localTitle,issueNumber,candidates:ranked.map(v=>compactCandidate(v.r,v.score))};
}
function checkpointSignature(local,remote){
  const firstLocal=local.issues[0],lastLocal=local.issues.at(-1),firstRemote=remote[0],lastRemote=remote.at(-1);
  return[
    PREBUILD_CHECKPOINT_VERSION,
    local.issues.length,Number(firstLocal?.id)||0,Number(lastLocal?.id)||0,
    remote.length,Number(firstRemote?.sourceId)||0,Number(lastRemote?.sourceId)||0
  ].join(':');
}
async function readPrebuildCheckpoint(signature,total){
  try{
    const p=JSON.parse(await fs.readFile(prebuildCheckpointFile,'utf8'));
    const age=Date.now()-new Date(p.updatedAt||0).getTime();
    if(Number(p.version)!==PREBUILD_CHECKPOINT_VERSION||p.signature!==signature||Number(p.total)!==Number(total))return null;
    if(!Array.isArray(p.entries)||p.entries.length>total||!Number.isFinite(age)||age>PREBUILD_CHECKPOINT_TTL)return null;
    return p;
  }catch{return null}
}
async function writePrebuildCheckpoint(signature,total,entries,phase){
  await fs.mkdir(prebuildCheckpointDir,{recursive:true});
  const tmp=prebuildCheckpointFile+'.tmp';
  const data={version:PREBUILD_CHECKPOINT_VERSION,signature,total,phase,processed:entries.length,updatedAt:new Date().toISOString(),entries};
  await fs.writeFile(tmp,JSON.stringify(data));
  await fs.rename(tmp,prebuildCheckpointFile);
}
function unresolvedPositions(entries){
  const out=[];
  for(let i=0;i<entries.length;i++){
    const status=Number(entries[i]?.[3]);
    if(status===STATUS.AMBIGUOUS||status===STATUS.UNKNOWN)out.push(i);
  }
  return out;
}
async function rescueFinalAmbiguous(local,byNumber,entries,signature,total){
  let positions=unresolvedPositions(entries);
  if(!positions.length)return;
  console.log('Rescate final de '+positions.length+' estados no terminales con verificación secuencial.');
  for(let pass=1;pass<=3&&positions.length;pass++){
    console.log('Rescate agresivo, pasada '+pass+': '+positions.length+' pendientes.');
    for(const i of positions){
      const row=candidateRowBatched(local.issues[i],local,byNumber);
      officialCache.clear();
      await sleep(750*pass);
      entries[i]=await verifyCandidateRow(row);
      if(global.gc)global.gc();
    }
    await writePrebuildCheckpoint(signature,total,entries,'rescue-'+pass);
    positions=unresolvedPositions(entries);
  }
  if(positions.length){
    console.error('Persisten '+positions.length+' coincidencias ambiguas tras el rescate final:');
    for(const i of positions){
      const row=candidateRowBatched(local.issues[i],local,byNumber);
      console.error('AMBIGUO FINAL GCD '+row.gcdId+' | '+row.localTitle+' #'+row.issueNumber+' | candidatos sourceId='+row.candidates.map(c=>c.sourceId).join(','));
    }
  }
}
async function verifyBatched(local,remote){
  const byNumber=buildRemoteNumberIndex(remote),signature=checkpointSignature(local,remote),total=local.issues.length;
  const checkpoint=await readPrebuildCheckpoint(signature,total);
  const entries=checkpoint?.entries||[];
  if(entries.length)console.log('Checkpoint restaurado: '+entries.length+'/'+total+' números ya verificados; fase='+String(checkpoint.phase||'desconocida')+'.');

  for(let start=entries.length;start<total;start+=PREBUILD_BATCH_SIZE){
    const end=Math.min(start+PREBUILD_BATCH_SIZE,total);
    const rows=[];
    for(let i=start;i<end;i++)rows.push(candidateRowBatched(local.issues[i],local,byNumber));
    const verified=await verifyCandidateRows(rows);
    entries.push(...verified);
    rows.length=0;
    officialCache.clear();
    await writePrebuildCheckpoint(signature,total,entries,'verify');
    console.log('Verificación Marvel oficial '+entries.length+'/'+total);
    if(global.gc)global.gc();
  }

  for(let pass=1;pass<=2;pass++){
    const positions=unresolvedPositions(entries);
    if(!positions.length)break;
    console.log('Reintentando '+positions.length+' estados no terminales (pasada '+pass+').');
    for(let start=0;start<positions.length;start+=PREBUILD_BATCH_SIZE){
      const pos=positions.slice(start,start+PREBUILD_BATCH_SIZE),rows=pos.map(i=>candidateRowBatched(local.issues[i],local,byNumber));
      const verified=await verifyCandidateRows(rows);
      for(let j=0;j<pos.length;j++)entries[pos[j]]=verified[j];
      officialCache.clear();
      await writePrebuildCheckpoint(signature,total,entries,'verify-retry-'+pass);
      console.log('Reverificación '+Math.min(start+pos.length,positions.length)+'/'+positions.length);
      if(global.gc)global.gc();
    }
    await sleep(1500);
  }

  await rescueFinalAmbiguous(local,byNumber,entries,signature,total);
  await writePrebuildCheckpoint(signature,total,entries,'verified');
  return entries;
}
`;
replaceOnce(marker,helpers+marker,'helpers de batching');

replaceOnce(
`  const candidateRows=buildCandidateRows(local,catalog.issues);
  console.log('Verificando candidatos contra las páginas oficiales de Marvel…');
  entries=await verifyCandidateRows(candidateRows);officiallyVerified=true;
  reuseExistingDrns(entries,existing);`,
`  console.log('Verificando candidatos contra las páginas oficiales de Marvel por bloques de '+PREBUILD_BATCH_SIZE+'…');
  entries=await verifyBatched(local,catalog.issues);officiallyVerified=true;
  reuseExistingDrns(entries,existing);`,
'verificación monolítica'
);

await fs.writeFile(tempFile,source);
try{
  await import(pathToFileURL(tempFile).href+'?t='+Date.now());
}finally{
  await fs.rm(tempFile,{force:true}).catch(()=>{});
}
