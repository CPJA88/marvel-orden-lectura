import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const SMART_BASE='https://marvel.smart.link/fiir7ec77';
const ISSUE_BASE='https://www.marvel.com/comics/issue/';
const LEGACY_BASE='https://share.marvel.com/sharing/legacy/';
const STATUS_MU=1;
const STATUS_MU_LINK_MISSING=5;
const DRN_RE=/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i;
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const str=v=>v==null?'':String(v);

function decodeRepeated(v=''){
  let s=str(v).replace(/&amp;/g,'&').replace(/\\u003A/gi,':').replace(/\\u002F/gi,'/').replace(/%3A/gi,':');
  for(let i=0;i<3;i++){
    try{const d=decodeURIComponent(s);if(d===s)break;s=d}catch{break}
  }
  return s;
}
function extractDrn(v=''){return decodeRepeated(v).match(DRN_RE)?.[0]||''}
function smartLink(sourceId,drn){return `${SMART_BASE}?type=issue&drn=${encodeURIComponent(drn)}&sourceId=${encodeURIComponent(String(sourceId))}`}

async function request(url,{redirect='manual',tries=4}={}){
  let last,lastStatus=0;
  for(let i=0;i<tries;i++){
    try{
      const r=await fetch(url,{redirect,headers:{'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(25000)});
      lastStatus=Number(r.status)||0;
      if(r.status===403||r.status===429||r.status>=500){
        const retry=Number(r.headers.get('retry-after')||0);
        try{await r.body?.cancel()}catch{}
        await sleep(retry?Math.min(45000,retry*1000):Math.min(15000,1200*(2**i)));
        continue;
      }
      return r;
    }catch(e){last=e;await sleep(Math.min(15000,1200*(2**i)))}
  }
  const e=last||new Error(`Respuesta temporal ${lastStatus||'sin estado'}: ${url}`);e.httpStatus=lastStatus;throw e;
}

async function drnFromResponse(r){
  let drn=extractDrn(r.url||'')||extractDrn(r.headers.get('location')||'');
  if(drn){try{await r.body?.cancel()}catch{};return drn}
  if(r.status>=200&&r.status<400){
    try{drn=extractDrn(await r.text())}catch{}
  }else try{await r.body?.cancel()}catch{}
  return drn;
}

async function resolveLegacy(readerId){
  if(!readerId)return'';
  const url=LEGACY_BASE+encodeURIComponent(String(readerId));
  for(const redirect of ['manual','follow']){
    try{const r=await request(url,{redirect,tries:4});const d=await drnFromResponse(r);if(d)return d}catch{}
  }
  return'';
}

async function resolveOfficialIssue(sourceId){
  if(!sourceId)return'';
  for(const redirect of ['follow','manual']){
    try{const r=await request(ISSUE_BASE+encodeURIComponent(String(sourceId)),{redirect,tries:4});const d=await drnFromResponse(r);if(d)return d}catch{}
  }
  return'';
}

async function resolveSmartSource(sourceId){
  if(!sourceId)return'';
  const url=`${SMART_BASE}?type=issue&sourceId=${encodeURIComponent(String(sourceId))}`;
  for(const redirect of ['manual','follow']){
    try{const r=await request(url,{redirect,tries:4});const d=await drnFromResponse(r);if(d)return d}catch{}
  }
  return'';
}

async function verify(sourceId,drn){
  if(!sourceId||!DRN_RE.test(drn))return false;
  try{
    const r=await request(smartLink(sourceId,drn),{redirect:'manual',tries:4});
    const status=Number(r.status)||0,location=r.headers.get('location')||'';
    try{await r.body?.cancel()}catch{}
    return (status>=200&&status<300)||(status>=300&&status<400&&Boolean(location));
  }catch{return false}
}

const pack=JSON.parse(await fs.readFile(cacheFile,'utf8'));
if(Number(pack.version)<3||!Array.isArray(pack.entries)||Number(pack.localCount)!==51002)throw new Error('Caché Marvel V3 inválida.');

const targets=[];
for(let i=0;i<pack.entries.length;i++){
  const row=pack.entries[i],status=Number(row?.[3]),drn=str(row?.[5]);
  if(status===STATUS_MU_LINK_MISSING||(status===STATUS_MU&&!DRN_RE.test(drn))){
    targets.push({index:i,gcdId:Number(row?.[0])||0,sourceId:Number(row?.[1])||0,readerId:Number(row?.[2])||0});
  }
}

console.log(`Pre-resolución DRN v1.2.38: ${targets.length} entradas sin DRN.`);
let repaired=0;
const unresolved=[];
for(const [n,t] of targets.entries()){
  let drn='',method='';
  drn=await resolveLegacy(t.readerId);if(drn)method='legacy-reader';
  if(!drn){drn=await resolveOfficialIssue(t.sourceId);if(drn)method='official-issue-page'}
  if(!drn){drn=await resolveSmartSource(t.sourceId);if(drn)method='smartlink-sourceId'}
  if(drn&&await verify(t.sourceId,drn)){
    const row=pack.entries[t.index];row[3]=STATUS_MU;row[5]=drn;repaired++;
    console.log(`DRN reparado ${n+1}/${targets.length}: GCD=${t.gcdId} sourceId=${t.sourceId} readerId=${t.readerId} vía ${method}.`);
  }else{
    unresolved.push({gcdId:t.gcdId,sourceId:t.sourceId,readerId:t.readerId});
    console.log(`DRN pendiente ${n+1}/${targets.length}: GCD=${t.gcdId} sourceId=${t.sourceId} readerId=${t.readerId}.`);
  }
  await sleep(500);
}

let matched=0,linkReady=0,linkMissing=0;
for(const row of pack.entries){
  const status=Number(row?.[3]),drn=str(row?.[5]);
  if(status===STATUS_MU||status===STATUS_MU_LINK_MISSING)matched++;
  if(status===STATUS_MU&&DRN_RE.test(drn))linkReady++;
  else if(status===STATUS_MU_LINK_MISSING||(status===STATUS_MU&&!DRN_RE.test(drn)))linkMissing++;
}
pack.matched=matched;pack.linkReady=linkReady;pack.linkMissing=linkMissing;pack.linksPrebuilt=linkMissing===0;
pack.linkAudit={...(pack.linkAudit||{}),allLinksVerified:false,repairPreflight:{version:1,at:new Date().toISOString(),targets:targets.length,repaired,unresolved:unresolved.length}};
await fs.writeFile(cacheFile,JSON.stringify(pack));
console.log(JSON.stringify({targets:targets.length,repaired,unresolved:unresolved.length,linkReady,linkMissing,unresolvedEntries:unresolved},null,2));
