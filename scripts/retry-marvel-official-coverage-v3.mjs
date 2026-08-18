import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';

const root=process.cwd();
const shard=Number(process.env.SHARD_INDEX||0);
const maxPasses=Math.max(1,Math.min(6,Number(process.env.RETRY_MAX_PASSES)||4));
const checkpointFile=path.join(root,'.cache','marvel-official-coverage-v3',`shard-${shard}.json`);
const reportFile=path.join(root,'artifacts','official-coverage',`shard-${shard}.json`);
const baseScript=path.join(root,'scripts','audit-marvel-official-coverage-v3.mjs');
const STATUS={NO_DIGITAL:3};

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function normalizeResult(v){
  if(!v||typeof v!=='object')return v;
  if(v.kind!=='exact')return v;
  if(v.availability==='mu')return{...v,kind:'mu'};
  if(v.availability==='no-digital')return{...v,kind:'no-digital'};
  return{...v,kind:'retryable',reason:v.reason||`exact-${v.availability||'unknown'}-availability`};
}

function summarize(results){
  const vals=Object.values(results||{}).map(normalizeResult);
  return{
    total:vals.length,
    mu:vals.filter(v=>v?.kind==='mu').length,
    noDigital:vals.filter(v=>v?.kind==='no-digital').length,
    notFound:vals.filter(v=>v?.kind==='not-found').length,
    retryable:vals.filter(v=>v?.kind==='retryable').length,
  };
}

async function normalizeCheckpoint({dropRetryable=false}={}){
  let cp;
  try{cp=JSON.parse(await fs.readFile(checkpointFile,'utf8'))}catch(e){throw new Error(`No existe checkpoint v3 para shard ${shard}; se aborta para no volver a escanear 25.760 cómics desde cero.`)}
  if(cp?.version!==3||!cp?.results)throw new Error(`Checkpoint v3 inválido para shard ${shard}.`);
  const normalized={};
  for(const [id,raw] of Object.entries(cp.results)){
    const v=normalizeResult(raw);
    if(dropRetryable&&v?.kind==='retryable')continue;
    normalized[id]=v;
  }
  cp.results=normalized;
  cp.processed=Object.keys(normalized).length;
  cp.updatedAt=new Date().toISOString();
  await fs.writeFile(checkpointFile,JSON.stringify(cp));
  return{cp,summary:summarize(normalized)};
}

async function normalizeReport(){
  let rep;
  try{rep=JSON.parse(await fs.readFile(reportFile,'utf8'))}catch{return null}
  const results=(rep.results||[]).map(normalizeResult);
  rep.results=results;
  rep.mu=results.filter(v=>v?.kind==='mu').length;
  rep.noDigital=results.filter(v=>v?.kind==='no-digital').length;
  rep.notFound=results.filter(v=>v?.kind==='not-found').length;
  rep.retryable=results.filter(v=>v?.kind==='retryable').length;
  rep.falseNegativeNoDigital=results.filter(v=>Number(v?.originalStatus)===STATUS.NO_DIGITAL&&v?.kind==='mu').length;
  rep.unconfirmedNoDigital=results.filter(v=>Number(v?.originalStatus)===STATUS.NO_DIGITAL&&v?.kind==='not-found').length;
  rep.retryPassNormalized=true;
  rep.normalizedAt=new Date().toISOString();
  await fs.writeFile(reportFile,JSON.stringify(rep,null,2)+'\n');
  return rep;
}

function runBaseScan(){
  return new Promise(resolve=>{
    const child=spawn(process.execPath,[baseScript,'scan'],{cwd:root,env:{...process.env,COVERAGE_CONCURRENCY:'1'},stdio:'inherit'});
    child.on('error',e=>resolve({code:1,error:e}));
    child.on('exit',(code,signal)=>resolve({code:code??1,signal}));
  });
}

const initial=await normalizeCheckpoint();
console.log(`Retry-only shard ${shard}: checkpoint=${initial.summary.total}; MU=${initial.summary.mu}; noDigital=${initial.summary.noDigital}; notFound=${initial.summary.notFound}; transitorios=${initial.summary.retryable}.`);

if(initial.summary.retryable===0){
  await normalizeReport();
  console.log(`Shard ${shard}: no quedan transitorios; no se repite ninguna consulta.`);
  process.exit(0);
}

let remaining=initial.summary.retryable;
for(let pass=1;pass<=maxPasses;pass++){
  const before=await normalizeCheckpoint({dropRetryable:true});
  const retryCount=remaining;
  console.log(`Shard ${shard}: pasada ${pass}/${maxPasses}; se conservan ${before.summary.total} resultados terminales y se reintentan SOLO ${retryCount} transitorios.`);
  const run=await runBaseScan();
  const after=await normalizeCheckpoint();
  const rep=await normalizeReport();
  remaining=after.summary.retryable;
  console.log(`Shard ${shard}: fin pasada ${pass}; MU=${after.summary.mu}; noDigital=${after.summary.noDigital}; notFound=${after.summary.notFound}; transitorios=${remaining}; exitBase=${run.code}.`);
  if(rep)console.log(`Shard ${shard}: falsos negativos NO_DIGITAL→MU=${rep.falseNegativeNoDigital}; MU total recuperado=${rep.mu}.`);
  if(remaining===0){
    console.log(`Shard ${shard}: todos los transitorios quedaron resueltos sin reescanear los resultados terminales.`);
    process.exit(0);
  }
  if(pass<maxPasses){
    const waitMs=Math.min(120000,20000*pass);
    console.log(`Shard ${shard}: Marvel dejó ${remaining} respuestas transitorias; esperando ${Math.round(waitMs/1000)} s antes de la siguiente pasada.`);
    await sleep(waitMs);
  }
}

await normalizeReport();
throw new Error(`Shard ${shard}: siguen ${remaining} resultados transitorios después de ${maxPasses} pasadas. El checkpoint queda guardado para el siguiente rerun.`);
