import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const reportDir=path.join(root,'artifacts');
const reportFile=path.join(reportDir,'marvel-unlimited-link-audit.json');
const checkpointDir=path.join(root,'.cache','marvel-link-audit-v1');
const checkpointFile=path.join(checkpointDir,'checkpoint.json');

const SMART_BASE='https://marvel.smart.link/fiir7ec77';
const LEGACY='https://share.marvel.com/sharing/legacy/';
const CONCURRENCY=Math.max(1,Math.min(12,Number(process.env.LINK_VERIFY_CONCURRENCY)||6));
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

async function request(url,{redirect='manual',tries=5,accept='text/html,application/xhtml+xml,*/*;q=0.8'}={}){
  let last=null;
  for(let attempt=1;attempt<=tries;attempt++){
    try{
      const r=await fetch(url,{redirect,headers:{'User-Agent':UA,'Accept':accept,'Accept-Language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(20000)});
      if(r.status===429||r.status>=500){
        const retry=Number(r.headers.get('retry-after')||0);
        try{await r.body?.cancel()}catch{}
        await sleep(retry?Math.min(30000,retry*1000):Math.min(12000,600*(2**attempt)));
        continue;
      }
      return r;
    }catch(e){
      last=e;
      await sleep(Math.min(12000,600*(2**attempt)));
    }
  }
  throw last||new Error(`No se pudo consultar ${url}`);
}

async function resolveCurrentDrn(readerId){
  const url=LEGACY+encodeURIComponent(String(readerId));
  for(let pass=1;pass<=3;pass++){
    try{
      const first=await request(url,{redirect:'manual',tries:4});
      if(!first)continue;
      const location=first.headers.get('location')||'';
      let drn=extractDrn(location);
      if(!drn&&first.status>=200&&first.status<300){
        const text=await first.text();
        drn=extractDrn(text);
      }else{
        try{await first.body?.cancel()}catch{}
      }
      if(drn)return drn;
    }catch{}
    try{
      const second=await request(url,{redirect:'follow',tries:3});
      let drn=extractDrn(second.url||'');
      if(!drn&&second.status>=200&&second.status<400)drn=extractDrn(await second.text());
      else try{await second.body?.cancel()}catch{}
      if(drn)return drn;
    }catch{}
    await sleep(1200*pass);
  }
  return '';
}

async function checkSmartLink(sourceId,drn){
  const url=smartLink(sourceId,drn);
  let last={ok:false,status:0,location:'',reason:'network'};
  for(let pass=1;pass<=4;pass++){
    try{
      const r=await request(url,{redirect:'manual',tries:3});
      const status=Number(r.status)||0,location=r.headers.get('location')||'';
      try{await r.body?.cancel()}catch{}
      if(status>=200&&status<300)return{ok:true,status,location,url};
      if(status>=300&&status<400&&location)return{ok:true,status,location,url};
      last={ok:false,status,location,url,reason:`http-${status}`};
      if(status===404||status===410)return last;
    }catch(e){last={ok:false,status:0,location:'',url,reason:e?.message||'network'}}
    await sleep(900*pass);
  }
  return last;
}

function signatureOf(pack){
  return [pack.version,pack.resolverVersion,pack.generatedAt,pack.localCount,pack.matched,pack.linkReady,pack.linkMissing].join('|');
}
async function readCheckpoint(signature){
  try{
    const p=JSON.parse(await fs.readFile(checkpointFile,'utf8'));
    if(p?.version!==1||p?.signature!==signature||!p?.results||typeof p.results!=='object')return null;
    return p;
  }catch{return null}
}
async function saveCheckpoint(signature,results,processed,total){
  await fs.mkdir(checkpointDir,{recursive:true});
  const tmp=checkpointFile+'.tmp';
  await fs.writeFile(tmp,JSON.stringify({version:1,signature,updatedAt:new Date().toISOString(),processed,total,results}));
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
let cursor=0,processed=0,repaired=0,passed=0,failed=0;
const failures=[];
console.log(`Auditoría Marvel Unlimited: ${targets.length} cómics; concurrencia=${CONCURRENCY}; checkpoint=${Object.keys(results).length}.`);

async function auditOne(t){
  const key=String(t.gcdId);
  const cached=results[key];
  if(cached?.ok===true&&cached?.readerId===t.readerId&&cached?.sourceId===t.sourceId&&cached?.drn){
    const row=pack.entries[t.index];
    if(row[5]!==cached.drn||Number(row[3])!==STATUS_MU){row[5]=cached.drn;row[3]=STATUS_MU;repaired++}
    passed++;
    return;
  }
  if(!t.gcdId||!t.sourceId||!t.readerId){
    const failure={gcdId:t.gcdId,sourceId:t.sourceId,readerId:t.readerId,reason:'identificadores-incompletos'};
    results[key]={ok:false,...failure};failures.push(failure);failed++;return;
  }

  const currentDrn=await resolveCurrentDrn(t.readerId);
  if(!DRN_RE.test(currentDrn)){
    const failure={gcdId:t.gcdId,sourceId:t.sourceId,readerId:t.readerId,reason:'drn-no-resuelto',storedDrn:t.storedDrn};
    results[key]={ok:false,...failure};failures.push(failure);failed++;return;
  }

  const check=await checkSmartLink(t.sourceId,currentDrn);
  if(!check.ok){
    const failure={gcdId:t.gcdId,sourceId:t.sourceId,readerId:t.readerId,reason:'smart-link-fallido',httpStatus:check.status||0,detail:check.reason||'',drn:currentDrn,url:check.url};
    results[key]={ok:false,...failure};failures.push(failure);failed++;return;
  }

  const row=pack.entries[t.index];
  if(row[5]!==currentDrn||Number(row[3])!==STATUS_MU){row[5]=currentDrn;row[3]=STATUS_MU;repaired++}
  results[key]={ok:true,gcdId:t.gcdId,sourceId:t.sourceId,readerId:t.readerId,drn:currentDrn,httpStatus:check.status,location:check.location||'',checkedAt:new Date().toISOString()};
  passed++;
}

async function worker(){
  while(true){
    const i=cursor++;if(i>=targets.length)return;
    await auditOne(targets[i]);
    processed++;
    if(processed%100===0||processed===targets.length){
      console.log(`Enlaces comprobados ${processed}/${targets.length}; OK=${passed}; fallos=${failed}; reparados=${repaired}`);
      await saveCheckpoint(signature,results,processed,targets.length);
    }
    await sleep(35);
  }
}
await Promise.all(Array.from({length:Math.min(CONCURRENCY,targets.length||1)},()=>worker()));

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
pack.linkAudit={version:1,auditedAt:new Date().toISOString(),checked:targets.length,passed,failed:failures.length,repaired,allLinksVerified:failures.length===0&&linkMissing===0};
await fs.writeFile(cacheFile,JSON.stringify(pack));

await fs.mkdir(reportDir,{recursive:true});
const report={
  generatedAt:new Date().toISOString(),
  cacheGeneratedAt:pack.generatedAt,
  totalEntries:pack.entries.length,
  unlimitedTargets:targets.length,
  passed,
  failed:failures.length,
  repaired,
  linkReady,
  linkMissing,
  allLinksVerified:failures.length===0&&linkMissing===0,
  failures
};
await fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
await saveCheckpoint(signature,results,targets.length,targets.length);
console.log(report);

if(failures.length||linkMissing){
  throw new Error(`Auditoría Unlimited incompleta: ${failures.length} enlaces fallidos y ${linkMissing} enlaces sin DRN.`);
}
console.log(`Auditoría completa: ${passed}/${targets.length} enlaces Unlimited respondieron y su DRN fue revalidado.`);
