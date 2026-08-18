import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const reportDir=path.join(root,'artifacts');
const reportFile=path.join(reportDir,'marvel-unlimited-link-audit.json');
// Conservamos la ruta v1 para poder reutilizar los 24k enlaces ya verificados en la pasada anterior.
const checkpointDir=path.join(root,'.cache','marvel-link-audit-v1');
const checkpointFile=path.join(checkpointDir,'checkpoint.json');

const SMART_BASE='https://marvel.smart.link/fiir7ec77';
const LEGACY='https://share.marvel.com/sharing/legacy/';
// Aunque el workflow antiguo inyecte 6, limitamos a 4 para no castigar los endpoints de Marvel.
const CONCURRENCY=Math.max(1,Math.min(4,Number(process.env.LINK_VERIFY_CONCURRENCY)||4));
const RETRY_CONCURRENCY=2;
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1';
const STATUS_MU=1;
const STATUS_MU_LINK_MISSING=5;
const DRN_RE=/^drn:src:marvel:unison::prod:[0-9a-f-]{36}$/i;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const asString=v=>v==null?'':String(v);

function decodeRepeated(v=''){
  let s=asString(v).replace(/&amp;/g,'&').replace(/\\u003A/gi,':').replace(/\\u002F/gi,'/');
  for(let i=0;i<3;i++){
    try{const d=decodeURIComponent(s);if(d===s)break;s=d}catch{break}
  }
  return s;
}
function extractDrn(v=''){
  const s=decodeRepeated(v).replace(/%3A/gi,':');
  return s.match(/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i)?.[0]||'';
}
function smartLink(sourceId,drn){
  return `${SMART_BASE}?type=issue&drn=${drn}&sourceId=${encodeURIComponent(String(sourceId))}`;
}

async function request(url,{redirect='manual',tries=4,accept='text/html,application/xhtml+xml,*/*;q=0.8'}={}){
  let last=null,lastStatus=0;
  for(let attempt=1;attempt<=tries;attempt++){
    try{
      const r=await fetch(url,{redirect,headers:{'User-Agent':UA,'Accept':accept,'Accept-Language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(20000)});
      lastStatus=Number(r.status)||0;
      if(r.status===429||r.status===403||r.status>=500){
        const retry=Number(r.headers.get('retry-after')||0);
        try{await r.body?.cancel()}catch{}
        await sleep(retry?Math.min(45000,retry*1000):Math.min(15000,900*(2**attempt)));
        continue;
      }
      return r;
    }catch(e){
      last=e;
      await sleep(Math.min(15000,900*(2**attempt)));
    }
  }
  const err=last||new Error(`Respuesta temporal ${lastStatus||'sin estado'} al consultar ${url}`);
  err.httpStatus=lastStatus;
  throw err;
}

async function resolveCurrentDrn(readerId){
  const url=LEGACY+encodeURIComponent(String(readerId));
  for(let pass=1;pass<=2;pass++){
    try{
      const first=await request(url,{redirect:'manual',tries:3});
      const location=first.headers.get('location')||'';
      let drn=extractDrn(location);
      if(!drn&&first.status>=200&&first.status<300)drn=extractDrn(await first.text());
      else try{await first.body?.cancel()}catch{}
      if(drn)return drn;
    }catch{}
    try{
      const second=await request(url,{redirect:'follow',tries:2});
      let drn=extractDrn(second.url||'');
      if(!drn&&second.status>=200&&second.status<400)drn=extractDrn(await second.text());
      else try{await second.body?.cancel()}catch{}
      if(drn)return drn;
    }catch{}
    await sleep(1800*pass);
  }
  return '';
}

async function checkSmartLink(sourceId,drn){
  const url=smartLink(sourceId,drn);
  let last={ok:false,hard:false,status:0,location:'',reason:'network',url};
  for(let pass=1;pass<=3;pass++){
    try{
      const r=await request(url,{redirect:'manual',tries:3});
      const status=Number(r.status)||0,location=r.headers.get('location')||'';
      try{await r.body?.cancel()}catch{}
      if(status>=200&&status<300)return{ok:true,hard:false,status,location,url};
      if(status>=300&&status<400&&location)return{ok:true,hard:false,status,location,url};
      if(status===404||status===410)return{ok:false,hard:true,status,location,url,reason:`http-${status}`};
      last={ok:false,hard:false,status,location,url,reason:`http-${status}`};
    }catch(e){
      last={ok:false,hard:false,status:Number(e?.httpStatus)||0,location:'',url,reason:e?.message||'network'};
    }
    await sleep(1200*pass);
  }
  return last;
}

function signatureOf(pack){
  return [pack.version,pack.resolverVersion,pack.generatedAt,pack.localCount,pack.matched,pack.linkReady,pack.linkMissing].join('|');
}
async function readCheckpoint(signature){
  try{
    const p=JSON.parse(await fs.readFile(checkpointFile,'utf8'));
    if(![1,2].includes(Number(p?.version))||p?.signature!==signature||!p?.results||typeof p.results!=='object')return null;
    return p;
  }catch{return null}
}
async function saveCheckpoint(signature,results,processed,total){
  await fs.mkdir(checkpointDir,{recursive:true});
  const tmp=checkpointFile+'.tmp';
  await fs.writeFile(tmp,JSON.stringify({version:2,signature,updatedAt:new Date().toISOString(),processed,total,results}));
  await fs.rename(tmp,checkpointFile);
}

const pack=JSON.parse(await fs.readFile(cacheFile,'utf8'));
if(Number(pack.version)<3||pack.officiallyVerified!==true||!Array.isArray(pack.entries)){
  throw new Error('La caché Marvel no es V3 oficialmente verificada; no se auditan deeplinks sobre una base no fiable.');
}

const targets=[];
for(let i=0;i<pack.entries.length;i++){
  const row=pack.entries[i],status=Number(row?.[3]);
  if(status!==STATUS_MU&&status!==STATUS_MU_LINK_MISSING)continue;
  targets.push({index:i,gcdId:Number(row?.[0])||0,sourceId:Number(row?.[1])||0,readerId:Number(row?.[2])||0,status,storedDrn:asString(row?.[5])});
}

const signature=signatureOf(pack),checkpoint=await readCheckpoint(signature),results=checkpoint?.results||{};
let repaired=0;
const keyOf=t=>String(t.gcdId);
const cachedOk=t=>{
  const r=results[keyOf(t)];
  return r?.ok===true&&Number(r.readerId)===t.readerId&&Number(r.sourceId)===t.sourceId&&DRN_RE.test(asString(r.drn));
};

function markOk(t,drn,check,method){
  const row=pack.entries[t.index];
  if(row[5]!==drn||Number(row[3])!==STATUS_MU){row[5]=drn;row[3]=STATUS_MU;repaired++}
  results[keyOf(t)]={ok:true,gcdId:t.gcdId,sourceId:t.sourceId,readerId:t.readerId,drn,httpStatus:check?.status||0,location:check?.location||'',method,checkedAt:new Date().toISOString()};
}
function markFailure(t,{reason,kind='retryable',drn='',check=null,detail=''}){
  results[keyOf(t)]={ok:false,gcdId:t.gcdId,sourceId:t.sourceId,readerId:t.readerId,reason,kind,retryable:kind==='retryable',storedDrn:t.storedDrn,drn,httpStatus:check?.status||0,detail:detail||check?.reason||'',url:check?.url||'',checkedAt:new Date().toISOString()};
}

async function auditOne(t){
  if(!t.gcdId||!t.sourceId||!t.readerId){
    markFailure(t,{reason:'identificadores-incompletos',kind:'hard'});
    return;
  }

  // 1) El DRN preinstalado es la primera fuente de verdad para el deeplink.
  // No volvemos a llamar al endpoint legacy si el enlace que va a usar la app ya funciona.
  if(DRN_RE.test(t.storedDrn)){
    const storedCheck=await checkSmartLink(t.sourceId,t.storedDrn);
    if(storedCheck.ok){
      markOk(t,t.storedDrn,storedCheck,'stored-drm-direct');
      return;
    }
    // 403/429/5xx/timeouts no significan que el enlace esté roto.
    if(!storedCheck.hard){
      markFailure(t,{reason:'smart-link-temporal',kind:'retryable',drn:t.storedDrn,check:storedCheck});
      return;
    }

    // Solo un 404/410 real justifica intentar sustituir el DRN existente.
    const refreshed=await resolveCurrentDrn(t.readerId);
    if(DRN_RE.test(refreshed)){
      const refreshedCheck=await checkSmartLink(t.sourceId,refreshed);
      if(refreshedCheck.ok){
        markOk(t,refreshed,refreshedCheck,refreshed===t.storedDrn?'stored-drm-rechecked':'drn-refreshed');
        return;
      }
      if(!refreshedCheck.hard){
        markFailure(t,{reason:'smart-link-temporal-tras-refresh',kind:'retryable',drn:refreshed,check:refreshedCheck});
        return;
      }
      markFailure(t,{reason:'smart-link-roto',kind:'hard',drn:refreshed,check:refreshedCheck});
      return;
    }
    markFailure(t,{reason:'smart-link-roto-y-drm-no-revalidable',kind:'hard',drn:t.storedDrn,check:storedCheck});
    return;
  }

  // 2) Solo los pocos números que realmente carecen de DRN consultan el resolver legacy.
  const currentDrn=await resolveCurrentDrn(t.readerId);
  if(!DRN_RE.test(currentDrn)){
    markFailure(t,{reason:'drn-no-resuelto',kind:'retryable'});
    return;
  }
  const check=await checkSmartLink(t.sourceId,currentDrn);
  if(check.ok){
    markOk(t,currentDrn,check,'drn-resolved');
    return;
  }
  if(!check.hard){
    markFailure(t,{reason:'smart-link-temporal-tras-resolver',kind:'retryable',drn:currentDrn,check});
    return;
  }
  markFailure(t,{reason:'smart-link-roto-tras-resolver',kind:'hard',drn:currentDrn,check});
}

function summarize(){
  let passed=0,hard=0,retryable=0,missingDrn=0;
  const failures=[];
  for(const t of targets){
    const r=results[keyOf(t)];
    if(r?.ok===true){passed++;continue}
    if(r?.reason==='drn-no-resuelto')missingDrn++;
    if(r?.kind==='hard')hard++;else retryable++;
    failures.push(r||{ok:false,gcdId:t.gcdId,sourceId:t.sourceId,readerId:t.readerId,reason:'sin-auditar',kind:'retryable'});
  }
  return{passed,hard,retryable,missingDrn,failures};
}

async function runBatch(list,{label,concurrency}){
  if(!list.length)return;
  let cursor=0,done=0;
  console.log(`${label}: ${list.length} enlaces; concurrencia=${concurrency}.`);
  async function worker(){
    while(true){
      const i=cursor++;if(i>=list.length)return;
      await auditOne(list[i]);
      done++;
      if(done%50===0||done===list.length){
        const s=summarize();
        console.log(`${label} ${done}/${list.length}; global OK=${s.passed}; duros=${s.hard}; reintentar=${s.retryable}; sinDRN=${s.missingDrn}; reparados=${repaired}`);
        await saveCheckpoint(signature,results,done,list.length);
      }
      await sleep(70);
    }
  }
  await Promise.all(Array.from({length:Math.min(concurrency,list.length||1)},()=>worker()));
}

const alreadyOk=targets.filter(cachedOk);
for(const t of alreadyOk){
  const r=results[keyOf(t)],row=pack.entries[t.index];
  if(row[5]!==r.drn||Number(row[3])!==STATUS_MU){row[5]=r.drn;row[3]=STATUS_MU;repaired++}
}
let todo=targets.filter(t=>!cachedOk(t));
console.log(`Auditoría Marvel Unlimited v2: ${targets.length} cómics; checkpoint reutilizado=${alreadyOk.length}; pendientes=${todo.length}.`);
await runBatch(todo,{label:'Pasada directa',concurrency:CONCURRENCY});

// Los bloqueos temporales de Marvel se vuelven a probar despacio. Nunca se convierten en "enlace roto" por un 403/429/timeout.
for(let pass=1;pass<=3;pass++){
  const pending=targets.filter(t=>results[keyOf(t)]?.ok!==true&&results[keyOf(t)]?.kind!=='hard');
  if(!pending.length)break;
  console.log(`Esperando antes de reintento transitorio ${pass}/3: ${pending.length} enlaces.`);
  await sleep(pass===1?15000:30000);
  await runBatch(pending,{label:`Reintento ${pass}`,concurrency:RETRY_CONCURRENCY});
}

let linkReady=0,linkMissing=0,matched=0;
for(const row of pack.entries){
  const status=Number(row?.[3]);
  if(status===STATUS_MU){matched++;linkReady++}
  else if(status===STATUS_MU_LINK_MISSING){matched++;linkMissing++}
}
pack.matched=matched;
pack.linkReady=linkReady;
pack.linkMissing=linkMissing;
pack.linksPrebuilt=linkMissing===0;

const final=summarize();
const allLinksVerified=final.hard===0&&final.retryable===0&&linkMissing===0;
pack.linkAudit={version:2,auditedAt:new Date().toISOString(),checked:targets.length,passed:final.passed,failed:final.failures.length,hardFailed:final.hard,retryable:final.retryable,missingDrn:final.missingDrn,repaired,allLinksVerified};
await fs.writeFile(cacheFile,JSON.stringify(pack));

await fs.mkdir(reportDir,{recursive:true});
const report={
  generatedAt:new Date().toISOString(),
  cacheGeneratedAt:pack.generatedAt,
  totalEntries:pack.entries.length,
  unlimitedTargets:targets.length,
  checkpointReused:alreadyOk.length,
  passed:final.passed,
  failed:final.failures.length,
  hardFailed:final.hard,
  retryable:final.retryable,
  missingDrn:final.missingDrn,
  repaired,
  linkReady,
  linkMissing,
  allLinksVerified,
  failures:final.failures
};
await fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
await saveCheckpoint(signature,results,targets.length,targets.length);
console.log(report);

if(final.hard||final.retryable||linkMissing){
  throw new Error(`Auditoría Unlimited incompleta: ${final.hard} enlaces realmente rotos, ${final.retryable} sin verificar por respuesta temporal y ${linkMissing} entradas aún sin DRN.`);
}
console.log(`Auditoría completa: ${final.passed}/${targets.length} deeplinks Unlimited respondieron correctamente.`);
