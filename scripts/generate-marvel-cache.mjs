import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import extract from 'extract-zip';

const root=process.cwd();
const archive=path.join(root,'Marvel_Orden_de_Lectura_PWA.zip');
const outDir=path.join(root,'source','marvel-cache');
const outFile=path.join(outDir,'index.json');
const START_YEAR=1939;
const END_YEAR=new Date().getUTCFullYear();
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const LEGACY='https://share.marvel.com/sharing/legacy/';
const OFFICIAL='https://www.marvel.com/comics/issue/';
const DRN_CONCURRENCY=14;
const VERIFY_CONCURRENCY=10;
const MAX_CANDIDATES=6;

const STATUS={UNKNOWN:0,MU:1,AMBIGUOUS:2,NO_DIGITAL:3,NOT_LISTED:4,MU_LINK_MISSING:5};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const asString=v=>v==null?'':String(v);
function normalize(v=''){
  return asString(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
}
function normalizeSeries(v=''){
  let s=asString(v).replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|present))?\s*\)/gi,' ').replace(/#\s*[^#]+$/,' ');
  return normalize(s).replace(/^the\s+/,'').replace(/\s+comics$/,'').replace(/\s+comic$/,'').trim();
}
function normalizeIssue(v=''){
  let s=asString(v).trim().toUpperCase().replace(/\s+/g,'');
  if(/^0+\d+$/.test(s))s=String(Number(s));
  return s;
}
function tokenScore(a,b){
  const A=new Set(normalizeSeries(a).split(' ').filter(Boolean)),B=new Set(normalizeSeries(b).split(' ').filter(Boolean));
  if(!A.size||!B.size)return 0;
  let n=0;for(const t of A)if(B.has(t))n++;
  return n/Math.max(A.size,B.size);
}
function seriesStartYear(v=''){return asString(v).match(/\((\d{4})/)?.[1]||''}
function yearOf(v=''){return asString(v).match(/\b((?:19|20)\d{2})\b/)?.[1]||''}
function sourceIdFromUrl(v=''){try{return new URL(v).pathname.match(/\/comics\/issue\/(\d+)/i)?.[1]||''}catch{return ''}}
function coverUrl(issue){
  let p=asString(issue?.cover?.path||issue?.cover?.url||'').trim();
  const ext=asString(issue?.cover?.ext||issue?.cover?.extension||'jpg').trim()||'jpg';
  if(!p)return '';
  p=p.replace(/^http:/i,'https:').replace(/\/$/,'');
  if(/\.(?:jpe?g|png|webp)$/i.test(p))return p;
  return `${p}/portrait_incredible.${ext}`;
}

async function fetchRetry(url,{accept='application/json',tries=5,redirect='follow'}={}){
  let last;
  for(let i=0;i<tries;i++){
    try{
      const r=await fetch(url,{redirect,headers:{'User-Agent':UA,'Accept':accept,'Accept-Language':'en-US,en;q=0.9'}});
      if(r.ok||redirect==='manual'&&(r.status>=300&&r.status<400))return r;
      last=new Error(`${new URL(url).hostname} HTTP ${r.status}`);
      if(r.status===404)return null;
      const retry=Number(r.headers.get('retry-after')||0);
      await sleep(retry?retry*1000:Math.min(15000,800*(2**i)));
    }catch(e){last=e;await sleep(Math.min(15000,800*(2**i)))}
  }
  throw last||new Error(`No se pudo descargar ${url}`);
}

function primitive(v){return v===null||['string','number','boolean'].includes(typeof v)}
function decodeRefs(pool,obj,stack=new Set()){
  if(typeof obj==='boolean')return obj;
  if(typeof obj==='number'){
    if(!Number.isInteger(obj)||obj<0||obj>=pool.length)return null;
    const v=pool[obj];
    if(primitive(v))return v;
    if(stack.has(obj))return null;
    const next=new Set(stack);next.add(obj);return decodeRefs(pool,v,next);
  }
  if(Array.isArray(obj))return obj.map(v=>decodeRefs(pool,v,stack));
  if(obj&&typeof obj==='object')return Object.fromEntries(Object.entries(obj).map(([k,v])=>[k,decodeRefs(pool,v,stack)]));
  return obj;
}
function extractPool(payload){
  const nodes=payload?.nodes;
  if(Array.isArray(nodes)&&nodes.length>=3&&nodes[2]&&Array.isArray(nodes[2].data))return nodes[2].data;
  let best=null;
  function walk(x){
    if(Array.isArray(x)){
      const looks=x.some(it=>it&&typeof it==='object'&&!Array.isArray(it)&&'detailUrl'in it&&'title'in it&&typeof it.detailUrl==='number');
      if(looks&&(!best||x.length>best.length))best=x;
      x.forEach(walk);
    }else if(x&&typeof x==='object')Object.values(x).forEach(walk);
  }
  walk(payload);
  if(!best)throw new Error('No se encontró el pool SvelteKit');
  return best;
}
function decodeYearPayload(payload,year){
  const pool=extractPool(payload),out=[];
  for(const packed of pool){
    if(!packed||typeof packed!=='object'||Array.isArray(packed)||typeof packed.detailUrl!=='number'||typeof packed.title!=='number')continue;
    const d=decodeRefs(pool,packed);
    if(!d||typeof d.title!=='string'||typeof d.detailUrl!=='string')continue;
    out.push({...d,_year_page:year});
  }
  return out;
}
async function fetchYearPrimary(year){
  const r=await fetchRetry(`https://marvel.geoffrich.net/year/${year}/__data.json`);
  if(!r)return [];
  return decodeYearPayload(await r.json(),year);
}
async function fetchYearFallback(year){
  const out=[];let offset=0,total=Infinity;
  while(offset<total){
    const u=new URL('https://marvel.emreparker.com/v1/issues');
    u.searchParams.set('year',String(year));u.searchParams.set('limit','200');u.searchParams.set('offset',String(offset));
    const r=await fetchRetry(u.toString());if(!r)break;
    const data=await r.json(),items=Array.isArray(data?.items)?data.items:[];
    total=Number(data?.total)||items.length;
    for(const x of items)out.push({id:x.id,digitalId:null,title:x.title,issue:x.issueNumber,issueNumber:x.issueNumber,detailUrl:x.detailUrl,series:{id:x.seriesId,name:x.seriesName},dates:{onSale:x.onSaleDate,unlimited:x.unlimitedDate},cover:null,_year_page:year});
    if(!items.length)break;offset+=items.length;await sleep(1000);
  }
  return out;
}
async function fetchCatalog(){
  const bySource=new Map(),yearStats=[];
  for(let year=START_YEAR;year<=END_YEAR;year++){
    let issues=[],source='geoffrich';
    try{issues=await fetchYearPrimary(year)}catch(e){console.warn(`Año ${year}: __data falló: ${e.message}`)}
    if(!issues.length){source='metadata-api';try{issues=await fetchYearFallback(year)}catch(e){console.warn(`Año ${year}: fallback falló: ${e.message}`)}}
    if(!issues.length)throw new Error(`El catálogo remoto no devolvió ningún número para ${year}; se aborta para evitar falsos negativos.`);
    for(const issue of issues){
      const sourceId=Number(issue?.id||sourceIdFromUrl(issue?.detailUrl));if(!sourceId)continue;
      const current=bySource.get(sourceId),candidate={sourceId,readerId:Number(issue?.digitalId)||0,issueNumber:asString(issue?.issueNumber??issue?.issue),title:asString(issue?.title),seriesName:asString(issue?.series?.name||issue?.seriesName),seriesYear:seriesStartYear(issue?.series?.name||issue?.seriesName||issue?.title),onSale:asString(issue?.dates?.onSale||issue?.onSaleDate),unlimited:asString(issue?.dates?.unlimited||issue?.unlimitedDate),yearPage:Number(issue?._year_page||year),coverUrl:coverUrl(issue)};
      if(!current||(!current.readerId&&candidate.readerId)||(!current.coverUrl&&candidate.coverUrl))bySource.set(sourceId,{...current,...candidate});
    }
    yearStats.push([year,issues.length,source]);console.log(`${year}: ${issues.length} (${source})`);await sleep(150);
  }
  return{issues:[...bySource.values()],yearStats};
}

async function loadLocal(){
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'marvel-lector-'));
  try{
    await extract(archive,{dir:tmp});
    const dataDir=path.join(tmp,'data'),meta=JSON.parse(await fs.readFile(path.join(dataDir,'meta.json'),'utf8')),series=JSON.parse(await fs.readFile(path.join(dataDir,'series.json'),'utf8')),seriesMap=new Map(series.map(s=>[Number(s.id),s])),issues=[];
    for(const chunk of meta.chunks||[])issues.push(...JSON.parse(await fs.readFile(path.join(dataDir,chunk.file),'utf8')));
    return{meta,seriesMap,issues};
  }finally{await fs.rm(tmp,{recursive:true,force:true})}
}
function remoteSeries(r){return r.seriesName||r.title.replace(/#\s*[^#]+$/,'').trim()}
function scoreCandidate(local,series,r){
  if(normalizeIssue(local.n)!==normalizeIssue(r.issueNumber))return -Infinity;
  const localTitle=series?.original||series?.es||'',remoteTitle=remoteSeries(r),a=normalizeSeries(localTitle),b=normalizeSeries(remoteTitle),sim=tokenScore(localTitle,remoteTitle);
  if(!a||!b||sim<0.42)return -Infinity;
  let score=sim*50;if(a===b)score+=110;else if(a.includes(b)||b.includes(a))score+=20;
  const localSeriesYear=asString(local.a||series?.year||series?.y),remoteSeriesYear=asString(r.seriesYear);if(localSeriesYear&&remoteSeriesYear&&localSeriesYear===remoteSeriesYear)score+=28;
  const localDate=asString(local.sv||local.d),ly=yearOf(localDate);if(ly&&Number(ly)===Number(r.yearPage))score+=24;if(localDate&&r.onSale&&localDate.slice(0,10)===r.onSale.slice(0,10))score+=18;
  if(r.readerId)score+=2;
  return score;
}
function buildCandidateRows(local,remote){
  const byNumber=new Map();
  for(const r of remote){const n=normalizeIssue(r.issueNumber);if(!n)continue;if(!byNumber.has(n))byNumber.set(n,[]);byNumber.get(n).push(r)}
  const rows=[];
  for(const x of local.issues){
    const series=local.seriesMap.get(Number(x.s))||{},localTitle=series?.original||series?.es||'',issueNumber=asString(x.n),candidates=byNumber.get(normalizeIssue(issueNumber))||[];
    const ranked=candidates.map(r=>({r,score:scoreCandidate(x,series,r)})).filter(v=>Number.isFinite(v.score)).sort((a,b)=>b.score-a.score).slice(0,MAX_CANDIDATES);
    rows.push({gcdId:Number(x.id),localTitle,issueNumber,candidates:ranked.map(v=>({...v.r,score:v.score}))});
  }
  return rows;
}

function decodeHtml(v=''){
  return asString(v).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)||32));
}
function plainHtml(html=''){
  return decodeHtml(asString(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
}
function pageTitle(html=''){
  const title=asString(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||asString(html).match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]||'';
  return decodeHtml(title).replace(/\s*\|\s*Comic Issues\s*\|\s*Marvel.*$/i,'').trim();
}
function parseIssueTitle(title=''){
  const cleaned=decodeHtml(title).trim();
  const m=cleaned.match(/^(.*?)\s*(?:\(\s*(\d{4})(?:\s*-\s*(?:\d{4}|present))?\s*\))?\s*#\s*([^\s|]+)/i);
  return m?{series:m[1].trim(),year:m[2]||'',issue:m[3].trim()}:null;
}
function sameIssueIdentity(localTitle,issueNumber,officialTitle){
  const p=parseIssueTitle(officialTitle);if(!p)return false;
  if(normalizeIssue(p.issue)!==normalizeIssue(issueNumber))return false;
  const a=normalizeSeries(localTitle),b=normalizeSeries(p.series);if(!a||!b)return false;
  return a===b||a.includes(b)||b.includes(a)||tokenScore(a,b)>=0.82;
}
function availabilityFromHtml(html=''){
  const text=plainHtml(html).toLowerCase();
  if(/digital issue (?:is )?not currently available/.test(text))return'no-digital';
  if(/members get unlimited access to this issue/.test(text)||/get unlimited access to this issue/.test(text))return'mu';
  return'unknown';
}
const officialCache=new Map();
async function fetchOfficialMeta(sourceId){
  const key=String(sourceId);if(officialCache.has(key))return officialCache.get(key);
  const promise=(async()=>{
    try{
      const r=await fetchRetry(OFFICIAL+encodeURIComponent(key),{accept:'text/html,application/xhtml+xml,*/*;q=0.8',tries:4});
      if(!r)return{ok:false,missing:true,title:'',availability:'unknown'};
      const html=await r.text();return{ok:true,missing:false,title:pageTitle(html),availability:availabilityFromHtml(html)};
    }catch(e){return{ok:false,missing:false,title:'',availability:'unknown',error:e.message}}
  })();officialCache.set(key,promise);return promise;
}
async function verifyCandidateRow(row){
  if(!row.candidates.length)return[row.gcdId,0,0,STATUS.NOT_LISTED,'',''];
  let unavailable=null,identitySeen=false,networkFailure=false;
  for(const c of row.candidates){
    const meta=await fetchOfficialMeta(c.sourceId);
    if(!meta.ok){if(!meta.missing)networkFailure=true;continue}
    if(!sameIssueIdentity(row.localTitle,row.issueNumber,meta.title))continue;
    identitySeen=true;
    if(meta.availability==='mu'){
      if(!c.readerId)return[row.gcdId,Number(c.sourceId)||0,0,STATUS.MU_LINK_MISSING,c.coverUrl||'',''];
      return[row.gcdId,Number(c.sourceId)||0,Number(c.readerId)||0,STATUS.MU,c.coverUrl||'',''];
    }
    if(meta.availability==='no-digital'&&!unavailable)unavailable=c;
  }
  if(unavailable)return[row.gcdId,Number(unavailable.sourceId)||0,0,STATUS.NO_DIGITAL,unavailable.coverUrl||'',''];
  if(identitySeen||networkFailure)return[row.gcdId,0,0,STATUS.AMBIGUOUS,'',''];
  return[row.gcdId,0,0,STATUS.NOT_LISTED,'',''];
}
async function verifyCandidateRows(rows){
  const entries=new Array(rows.length);let cursor=0,done=0;
  async function worker(){
    while(true){
      const i=cursor++;if(i>=rows.length)return;
      entries[i]=await verifyCandidateRow(rows[i]);done++;
      if(done%250===0||done===rows.length)console.log(`Verificación Marvel oficial ${done}/${rows.length}`);
      await sleep(20);
    }
  }
  await Promise.all(Array.from({length:Math.min(VERIFY_CONCURRENCY,rows.length||1)},()=>worker()));
  return entries;
}

async function loadExisting(){
  try{const p=JSON.parse(await fs.readFile(outFile,'utf8'));return p?.ready&&Array.isArray(p.entries)?p:null}catch{return null}
}
function normalizeExistingRow(row){
  const gcdId=Number(row?.[0])||0,sourceId=Number(row?.[1])||0,readerId=Number(row?.[2])||0,oldStatus=Number(row?.[3]),cover=asString(row?.[4]),drn=asString(row?.[5]);
  let status=STATUS.UNKNOWN;
  if(oldStatus===STATUS.MU&&sourceId&&readerId&&drn)status=STATUS.MU;
  else if(oldStatus===STATUS.NO_DIGITAL)status=STATUS.NO_DIGITAL;
  else if(oldStatus===STATUS.NOT_LISTED)status=STATUS.NOT_LISTED;
  else if(oldStatus===STATUS.MU_LINK_MISSING&&sourceId)status=STATUS.MU_LINK_MISSING;
  else if(oldStatus===STATUS.AMBIGUOUS)status=STATUS.AMBIGUOUS;
  return[gcdId,sourceId,readerId,status,cover,drn];
}
function reuseExistingDrns(entries,existing){
  if(!existing?.entries)return;
  const byReader=new Map();
  for(const row of existing.entries){const reader=Number(row?.[2])||0,drn=asString(row?.[5]);if(reader&&drn)byReader.set(String(reader),drn)}
  let reused=0;
  for(const row of entries){if(row[2]>0&&!row[5]){const drn=byReader.get(String(row[2]));if(drn){row[5]=drn;reused++}}}
  console.log(`DRN reutilizados de la caché anterior: ${reused}`);
}
function decodeRepeated(v=''){
  let s=asString(v).replace(/&amp;/g,'&').replace(/\\u003A/gi,':').replace(/\\u002F/gi,'/');
  for(let i=0;i<3;i++){try{const d=decodeURIComponent(s);if(d===s)break;s=d}catch{break}}return s;
}
function extractDrn(v=''){
  const s=decodeRepeated(v).replace(/%3A/gi,':');
  return s.match(/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i)?.[0]||'';
}
async function resolveDrn(readerId){
  const url=LEGACY+encodeURIComponent(String(readerId));
  try{
    const first=await fetchRetry(url,{accept:'text/html,application/xhtml+xml,*/*;q=0.8',tries:5,redirect:'manual'});if(!first)return '';
    let drn=extractDrn(first.headers.get('location')||'');
    if(!drn&&first.status>=200&&first.status<300)drn=extractDrn(await first.text());
    if(drn)return drn;
  }catch{}
  try{
    const second=await fetchRetry(url,{accept:'text/html,application/xhtml+xml,*/*;q=0.8',tries:4,redirect:'follow'});if(!second)return '';
    return extractDrn(second.url)||extractDrn(await second.text());
  }catch{return ''}
}
async function fillDrns(entries){
  const byReader=new Map(),known=new Map();
  for(const row of entries){
    if(row[3]!==STATUS.MU&&row[3]!==STATUS.MU_LINK_MISSING)continue;
    if(row[2]>0){if(row[5])known.set(String(row[2]),row[5]);else byReader.set(String(row[2]),true)}
  }
  const todo=[...byReader.keys()].filter(id=>!known.has(id));
  console.log(`DRN: ${known.size} ya cacheados; ${todo.length} por resolver.`);
  let cursor=0,done=0,found=0;
  async function worker(){
    while(true){
      const i=cursor++;if(i>=todo.length)return;
      const id=todo[i],drn=await resolveDrn(id);if(drn){known.set(id,drn);found++}
      done++;if(done%250===0||done===todo.length)console.log(`DRN ${done}/${todo.length}; nuevos=${found}; total=${known.size}`);
      await sleep(35);
    }
  }
  await Promise.all(Array.from({length:Math.min(DRN_CONCURRENCY,todo.length||1)},()=>worker()));
  for(const row of entries){
    if((row[3]===STATUS.MU||row[3]===STATUS.MU_LINK_MISSING)&&row[2]>0){
      row[5]=known.get(String(row[2]))||'';
      row[3]=row[5]?STATUS.MU:STATUS.MU_LINK_MISSING;
    }
  }
  return{known:known.size,attempted:todo.length,newFound:found};
}
function statsOf(entries){
  let matched=0,unavailable=0,notListed=0,ambiguous=0,unknown=0,linkReady=0,linkMissing=0;
  for(const row of entries){
    if(row[3]===STATUS.MU){matched++;linkReady++}
    else if(row[3]===STATUS.MU_LINK_MISSING){matched++;linkMissing++}
    else if(row[3]===STATUS.NO_DIGITAL)unavailable++;
    else if(row[3]===STATUS.NOT_LISTED)notListed++;
    else if(row[3]===STATUS.AMBIGUOUS)ambiguous++;
    else unknown++;
  }
  return{matched,unavailable,notListed,ambiguous,unknown,linkReady,linkMissing};
}

await fs.access(archive);await fs.mkdir(outDir,{recursive:true});
const existing=await loadExisting();
let entries,yearStats=[],catalogCount=Number(existing?.catalogCount)||0,officiallyVerified=false;
if(existing&&Number(existing.version)>=3&&existing.officiallyVerified&&existing.localCount>=50000&&existing.entries.length===existing.localCount&&process.env.REFRESH_CATALOG!=='1'){
  console.log(`Reutilizando caché V3 verificada de ${existing.localCount} números.`);
  entries=existing.entries.map(normalizeExistingRow);yearStats=existing.yearStats||[];officiallyVerified=true;
}else{
  console.log('Descargando catálogo Marvel y rehaciendo el cruce completo…');
  const catalog=await fetchCatalog();if(catalog.issues.length<20000)throw new Error(`Catálogo demasiado pequeño (${catalog.issues.length}); no se publica una caché incompleta.`);
  catalogCount=catalog.issues.length;yearStats=catalog.yearStats;
  console.log(`Catálogo remoto: ${catalogCount} números únicos.`);
  console.log('Leyendo los números GCD de la PWA…');
  const local=await loadLocal();console.log(`Orden local: ${local.issues.length} números.`);
  const candidateRows=buildCandidateRows(local,catalog.issues);
  console.log('Verificando candidatos contra las páginas oficiales de Marvel…');
  entries=await verifyCandidateRows(candidateRows);officiallyVerified=true;
  reuseExistingDrns(entries,existing);
}
if(entries.length<50000)throw new Error(`La caché no cubre el orden completo (${entries.length}).`);
const drnStats=await fillDrns(entries),stats=statsOf(entries);
const payload={version:3,resolverVersion:14,generatedAt:new Date().toISOString(),ready:true,linksPrebuilt:stats.linkMissing===0,officiallyVerified,localCount:entries.length,catalogCount,matched:stats.matched,unavailable:stats.unavailable,notListed:stats.notListed,ambiguous:stats.ambiguous,unknown:stats.unknown,linkReady:stats.linkReady,linkMissing:stats.linkMissing,fields:['gcdId','sourceId','readerId','status(0=unknown,1=verifiedMU,2=ambiguous,3=verifiedNoDigital,4=notListed,5=verifiedMU-linkMissing)','coverUrl','drn'],yearStats,entries};
await fs.writeFile(outFile,JSON.stringify(payload));
console.log(`Caché escrita: ${outFile}`);
console.log({localCount:payload.localCount,catalogCount:payload.catalogCount,verifiedMU:payload.matched,noDigital:payload.unavailable,notListed:payload.notListed,ambiguous:payload.ambiguous,unknown:payload.unknown,linkReady:payload.linkReady,linkMissing:payload.linkMissing,officiallyVerified:payload.officiallyVerified,drn:drnStats});
