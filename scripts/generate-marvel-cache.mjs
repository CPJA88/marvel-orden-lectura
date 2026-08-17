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
const UA='Mozilla/5.0 (compatible; MarvelOrdenLecturaCacheBuilder/1.2.23)';

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

async function fetchRetry(url,{accept='application/json',tries=5}={}){
  let last;
  for(let i=0;i<tries;i++){
    try{
      const r=await fetch(url,{redirect:'follow',headers:{'User-Agent':UA,'Accept':accept,'Accept-Language':'en-US,en;q=0.9'}});
      if(r.ok)return r;
      last=new Error(`${new URL(url).hostname} HTTP ${r.status}`);
      if(r.status===404)return null;
      const retry=Number(r.headers.get('retry-after')||0);
      await sleep(retry?retry*1000:Math.min(15000,900*(2**i)));
    }catch(e){last=e;await sleep(Math.min(15000,900*(2**i)))}
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
  const url=`https://marvel.geoffrich.net/year/${year}/__data.json`;
  const r=await fetchRetry(url);
  if(!r)return [];
  const payload=await r.json();
  return decodeYearPayload(payload,year);
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
    if(!items.length)break;offset+=items.length;
    await sleep(1150);
  }
  return out;
}
async function fetchCatalog(){
  const bySource=new Map(),yearStats=[];
  for(let year=START_YEAR;year<=END_YEAR;year++){
    let issues=[],source='geoffrich';
    try{issues=await fetchYearPrimary(year)}catch(e){console.warn(`Año ${year}: __data falló: ${e.message}`)}
    if(!issues.length){
      source='metadata-api';
      try{issues=await fetchYearFallback(year)}catch(e){console.warn(`Año ${year}: fallback falló: ${e.message}`)}
    }
    for(const issue of issues){
      const sourceId=Number(issue?.id||sourceIdFromUrl(issue?.detailUrl));
      if(!sourceId)continue;
      const current=bySource.get(sourceId);
      const candidate={
        sourceId,
        readerId:Number(issue?.digitalId)||0,
        issueNumber:asString(issue?.issueNumber??issue?.issue),
        title:asString(issue?.title),
        seriesName:asString(issue?.series?.name||issue?.seriesName),
        seriesYear:seriesStartYear(issue?.series?.name||issue?.seriesName||issue?.title),
        onSale:asString(issue?.dates?.onSale||issue?.onSaleDate),
        unlimited:asString(issue?.dates?.unlimited||issue?.unlimitedDate),
        yearPage:Number(issue?._year_page||year),
        coverUrl:coverUrl(issue)
      };
      if(!current||(!current.readerId&&candidate.readerId)||(!current.coverUrl&&candidate.coverUrl))bySource.set(sourceId,{...current,...candidate});
    }
    yearStats.push([year,issues.length,source]);
    console.log(`${year}: ${issues.length} (${source})`);
    await sleep(180);
  }
  return{issues:[...bySource.values()],yearStats};
}

async function loadLocal(){
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'marvel-lector-'));
  try{
    await extract(archive,{dir:tmp});
    const dataDir=path.join(tmp,'data');
    const meta=JSON.parse(await fs.readFile(path.join(dataDir,'meta.json'),'utf8'));
    const series=JSON.parse(await fs.readFile(path.join(dataDir,'series.json'),'utf8'));
    const seriesMap=new Map(series.map(s=>[Number(s.id),s]));
    const issues=[];
    for(const chunk of meta.chunks||[]){
      const rows=JSON.parse(await fs.readFile(path.join(dataDir,chunk.file),'utf8'));
      issues.push(...rows);
    }
    return{meta,seriesMap,issues};
  }finally{await fs.rm(tmp,{recursive:true,force:true})}
}
function remoteSeries(r){return r.seriesName||r.title.replace(/#\s*[^#]+$/,'').trim()}
function scoreCandidate(local,series,r){
  if(normalizeIssue(local.n)!==normalizeIssue(r.issueNumber))return -Infinity;
  const localTitle=series?.original||series?.es||'',remoteTitle=remoteSeries(r);
  const a=normalizeSeries(localTitle),b=normalizeSeries(remoteTitle),sim=tokenScore(localTitle,remoteTitle);
  if(!a||!b||sim<0.52)return -Infinity;
  let score=sim*50;
  if(a===b)score+=110;
  else if(a.includes(b)||b.includes(a))score+=20;
  const localSeriesYear=asString(local.a||series?.year||series?.y),remoteSeriesYear=asString(r.seriesYear);
  if(localSeriesYear&&remoteSeriesYear&&localSeriesYear===remoteSeriesYear)score+=28;
  const localDate=asString(local.sv||local.d),ly=yearOf(localDate);
  if(ly&&Number(ly)===Number(r.yearPage))score+=24;
  if(localDate&&r.onSale&&localDate.slice(0,10)===r.onSale.slice(0,10))score+=18;
  return score;
}
function buildCrosswalk(local,remote){
  const byNumber=new Map();
  for(const r of remote){const n=normalizeIssue(r.issueNumber);if(!n)continue;if(!byNumber.has(n))byNumber.set(n,[]);byNumber.get(n).push(r)}
  const entries=[],stats={matched:0,unavailable:0,ambiguous:0};
  for(const x of local.issues){
    const series=local.seriesMap.get(Number(x.s))||{},candidates=byNumber.get(normalizeIssue(x.n))||[];
    const ranked=candidates.map(r=>({r,score:scoreCandidate(x,series,r)})).filter(v=>Number.isFinite(v.score)).sort((a,b)=>b.score-a.score);
    const top=ranked[0],second=ranked[1];
    let status=0,sourceId=0,readerId=0,cover='';
    if(top&&top.score>=72&&(!second||top.score-second.score>=7||top.r.sourceId===second.r.sourceId)){
      status=1;sourceId=top.r.sourceId;readerId=top.r.readerId||0;cover=top.r.coverUrl||'';stats.matched++;
    }else if(top&&top.score>=72){status=2;stats.ambiguous++}
    else stats.unavailable++;
    entries.push([Number(x.id),sourceId,readerId,status,cover]);
  }
  return{entries,stats};
}

await fs.access(archive);
console.log('Descargando catálogo Marvel Unlimited…');
const catalog=await fetchCatalog();
if(catalog.issues.length<20000)throw new Error(`Catálogo demasiado pequeño (${catalog.issues.length}); no se publica una caché incompleta.`);
console.log(`Catálogo remoto: ${catalog.issues.length} números únicos.`);
console.log('Leyendo los números GCD de la PWA…');
const local=await loadLocal();
console.log(`Orden local: ${local.issues.length} números.`);
const cross=buildCrosswalk(local,catalog.issues);
if(cross.entries.length!==local.issues.length)throw new Error('La caché no cubre todo el orden local.');
await fs.mkdir(outDir,{recursive:true});
const payload={
  version:1,
  resolverVersion:13,
  generatedAt:new Date().toISOString(),
  ready:true,
  localCount:cross.entries.length,
  catalogCount:catalog.issues.length,
  matched:cross.stats.matched,
  unavailable:cross.stats.unavailable,
  ambiguous:cross.stats.ambiguous,
  fields:['gcdId','sourceId','readerId','status(0=noMU,1=MU,2=ambiguous)','coverUrl'],
  yearStats:catalog.yearStats,
  entries:cross.entries
};
await fs.writeFile(outFile,JSON.stringify(payload));
console.log(`Caché escrita: ${outFile}`);
console.log(`Coincidencias MU=${payload.matched}; sin MU=${payload.unavailable}; ambiguas=${payload.ambiguous}`);
