import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import extract from 'extract-zip';

const root=process.cwd();
const archive=path.join(root,'Marvel_Orden_de_Lectura_PWA.zip');
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const artifactRoot=path.join(root,'artifacts','official-coverage');
const mode=process.argv[2]||'scan';
const shard=Number(process.env.SHARD_INDEX||0);
const shardCount=Math.max(1,Number(process.env.SHARD_COUNT)||1);
const concurrency=Math.max(1,Math.min(2,Number(process.env.COVERAGE_CONCURRENCY)||1));
const checkpointDir=path.join(root,'.cache','marvel-official-coverage-v3');
const checkpointFile=path.join(checkpointDir,`shard-${shard}.json`);

const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const SEARCH='https://www.marvel.com/search';
const ISSUE='https://www.marvel.com/comics/issue/';
const LEGACY='https://share.marvel.com/sharing/legacy/';
const STATUS={UNKNOWN:0,MU:1,AMBIGUOUS:2,NO_DIGITAL:3,NOT_LISTED:4,MU_LINK_MISSING:5};
const DRN_RE=/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i;
const REGRESSION_HINTS=new Map([
  [8972,11016],
  [3617,7880],
]);

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const str=v=>v==null?'':String(v);
const normalize=v=>str(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
const normalizeSeries=v=>normalize(str(v).replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|present))?\s*\)/gi,' ')).replace(/^the\s+/,'').replace(/\s+comics?$/,'').trim();
const normalizeIssue=v=>{let s=str(v).trim().toUpperCase().replace(/\s+/g,'');if(/^0+\d+$/.test(s))s=String(Number(s));return s};
const tokenScore=(a,b)=>{const A=new Set(normalizeSeries(a).split(' ').filter(Boolean)),B=new Set(normalizeSeries(b).split(' ').filter(Boolean));if(!A.size||!B.size)return 0;let n=0;for(const t of A)if(B.has(t))n++;return n/Math.max(A.size,B.size)};
const yearOf=v=>str(v).match(/\b((?:19|20)\d{2})\b/)?.[1]||'';
const seriesStartYear=v=>str(v).match(/\((\d{4})/)?.[1]||'';
const decodeHtml=v=>str(v).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)||32));
const plainHtml=html=>decodeHtml(str(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
const pageTitle=html=>decodeHtml(str(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||str(html).match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]||'').replace(/\s*\|\s*Comic Issues\s*\|\s*Marvel.*$/i,'').trim();
const parseIssueTitle=title=>{const m=decodeHtml(title).trim().match(/^(.*?)\s*(?:\(\s*(\d{4})(?:\s*-\s*(?:\d{4}|present))?\s*\))?\s*#\s*([^\s|]+)/i);return m?{series:m[1].trim(),year:m[2]||'',issue:m[3].trim()}:null};
const extractDrn=v=>str(v).replace(/\\u003A/gi,':').replace(/%3A/gi,':').match(DRN_RE)?.[0]||'';
const extractReaderId=html=>{const s=str(html);for(const re of [/sharing\/legacy\/(\d+)/i,/read\.marvel\.com\/#\/book\/(\d+)/i,/["'](?:digitalId|readerId)["']\s*:\s*["']?(\d+)/i,/(?:digitalId|readerId)%22%3A(?:%22)?(\d+)/i]){const m=s.match(re);if(m)return Number(m[1])||0}return 0};
const extractCover=html=>decodeHtml(str(html).match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]||'').replace(/^http:/i,'https:');

function availability(html){
  const t=plainHtml(html).toLowerCase();
  const mu=/members get unlimited access to this issue/.test(t)||/get unlimited access to this issue/.test(t);
  const no=/digital issue (?:is )?not currently available/.test(t);
  if(mu&&!no)return'mu';
  if(no&&!mu)return'no-digital';
  if(mu&&no)return'conflict';
  return'unknown';
}

async function request(url,{tries=5,redirect='follow',accept='text/html,application/xhtml+xml,*/*;q=0.8'}={}){
  let last,lastStatus=0;
  for(let i=0;i<tries;i++){
    try{
      const r=await fetch(url,{redirect,headers:{'User-Agent':UA,'Accept':accept,'Accept-Language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(25000)});
      lastStatus=r.status;
      if(r.ok||(redirect==='manual'&&r.status>=300&&r.status<400))return r;
      if(r.status===404)return null;
      last=new Error(`HTTP ${r.status} ${url}`);last.httpStatus=r.status;
      const retry=Number(r.headers.get('retry-after')||0);try{await r.body?.cancel()}catch{}
      await sleep(retry?Math.min(60000,retry*1000):Math.min(20000,900*(2**i)));
    }catch(e){last=e;await sleep(Math.min(20000,900*(2**i)))}
  }
  const e=last||new Error(`Sin respuesta ${lastStatus} ${url}`);e.httpStatus=lastStatus;throw e;
}

async function loadLocal(){
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'marvel-official-coverage-v3-'));
  try{
    await extract(archive,{dir:tmp});
    const data=path.join(tmp,'data');
    const meta=JSON.parse(await fs.readFile(path.join(data,'meta.json'),'utf8'));
    const series=JSON.parse(await fs.readFile(path.join(data,'series.json'),'utf8'));
    const seriesMap=new Map(series.map(s=>[Number(s.id),s]));
    const byId=new Map();
    for(const c of meta.chunks||[]){for(const x of JSON.parse(await fs.readFile(path.join(data,c.file),'utf8'))){const s=seriesMap.get(Number(x.s))||{};byId.set(Number(x.id),{gcdId:Number(x.id),title:s.original||s.es||'',issueNumber:str(x.n),seriesYear:str(x.a||s.year||s.y),date:str(x.sv||x.d)})}}
    return{meta,byId};
  }finally{await fs.rm(tmp,{recursive:true,force:true})}
}

function sameIdentity(local,title){
  const p=parseIssueTitle(title);if(!p)return false;
  if(normalizeIssue(p.issue)!==normalizeIssue(local.issueNumber))return false;
  if(local.seriesYear&&p.year&&String(local.seriesYear)!==String(p.year))return false;
  const a=normalizeSeries(local.title),b=normalizeSeries(p.series);if(!a||!b)return false;
  return a===b||a.includes(b)||b.includes(a)||tokenScore(a,b)>=0.82;
}

async function resolveDrn(readerId){
  if(!readerId)return'';
  const r=await request(LEGACY+readerId,{tries:4,redirect:'manual'});if(!r)return'';
  let d=extractDrn(r.headers.get('location')||'');if(!d&&r.status>=200&&r.status<300)d=extractDrn(await r.text());return d;
}

async function inspectOfficialIssue(local,sourceId){
  const r=await request(ISSUE+encodeURIComponent(String(sourceId)),{tries:4});if(!r)return{kind:'missing',sourceId:Number(sourceId)||0};
  const html=await r.text(),title=pageTitle(html);if(!sameIdentity(local,title))return{kind:'identity-mismatch',sourceId:Number(sourceId)||0,title};
  let av=availability(html);const cover=extractCover(html);let readerId=extractReaderId(html),drn=extractDrn(html);
  if(av==='conflict'&&(readerId||drn))av='mu';
  if(av==='mu'&&!drn&&readerId){try{drn=await resolveDrn(readerId)}catch{}}
  return{kind:'exact',sourceId:Number(sourceId)||0,readerId,drn,cover,title,availability:av};
}

function primitive(v){return v===null||['string','number','boolean'].includes(typeof v)}
function decodeRefs(pool,obj,stack=new Set()){
  if(typeof obj==='boolean')return obj;
  if(typeof obj==='number'){if(!Number.isInteger(obj)||obj<0||obj>=pool.length)return null;const v=pool[obj];if(primitive(v))return v;if(stack.has(obj))return null;const next=new Set(stack);next.add(obj);return decodeRefs(pool,v,next)}
  if(Array.isArray(obj))return obj.map(v=>decodeRefs(pool,v,stack));
  if(obj&&typeof obj==='object')return Object.fromEntries(Object.entries(obj).map(([k,v])=>[k,decodeRefs(pool,v,stack)]));
  return obj;
}
function extractPool(payload){
  const nodes=payload?.nodes;if(Array.isArray(nodes)&&nodes.length>=3&&nodes[2]&&Array.isArray(nodes[2].data))return nodes[2].data;
  let best=null;function walk(x){if(Array.isArray(x)){const looks=x.some(it=>it&&typeof it==='object'&&!Array.isArray(it)&&'detailUrl'in it&&'title'in it&&typeof it.detailUrl==='number');if(looks&&(!best||x.length>best.length))best=x;x.forEach(walk)}else if(x&&typeof x==='object')Object.values(x).forEach(walk)}walk(payload);if(!best)throw new Error('No se encontró el pool SvelteKit');return best;
}
function decodeYearPayload(payload,year){
  const pool=extractPool(payload),out=[];for(const packed of pool){if(!packed||typeof packed!=='object'||Array.isArray(packed)||typeof packed.detailUrl!=='number'||typeof packed.title!=='number')continue;const d=decodeRefs(pool,packed);if(!d||typeof d.title!=='string'||typeof d.detailUrl!=='string')continue;out.push({...d,_year_page:year})}return out;
}
function sourceIdFromUrl(v=''){try{return Number(new URL(v,'https://www.marvel.com').pathname.match(/\/comics\/issue\/(\d+)/i)?.[1]||0)}catch{return 0}}

const catalogYearCache=new Map();
async function fetchCatalogYear(year){
  const y=Number(year);if(!Number.isFinite(y)||y<1939||y>new Date().getUTCFullYear()+1)return[];if(catalogYearCache.has(y))return catalogYearCache.get(y);
  const promise=(async()=>{
    let issues=[];
    try{const r=await request(`https://marvel.geoffrich.net/year/${y}/__data.json`,{accept:'application/json',tries:4});if(r)issues=decodeYearPayload(await r.json(),y)}catch{}
    if(!issues.length){try{const out=[];let offset=0,total=Infinity;while(offset<total){const u=new URL('https://marvel.emreparker.com/v1/issues');u.searchParams.set('year',String(y));u.searchParams.set('limit','200');u.searchParams.set('offset',String(offset));const r=await request(u.toString(),{accept:'application/json',tries:4});if(!r)break;const data=await r.json(),items=Array.isArray(data?.items)?data.items:[];total=Number(data?.total)||items.length;for(const x of items)out.push({id:x.id,digitalId:null,title:x.title,issueNumber:x.issueNumber,detailUrl:x.detailUrl,series:{id:x.seriesId,name:x.seriesName},dates:{onSale:x.onSaleDate,unlimited:x.unlimitedDate},_year_page:y});if(!items.length)break;offset+=items.length;await sleep(150)}issues=out}catch{}}
    return issues.map(issue=>({sourceId:Number(issue?.id||sourceIdFromUrl(issue?.detailUrl))||0,readerId:Number(issue?.digitalId)||0,issueNumber:str(issue?.issueNumber??issue?.issue),title:str(issue?.title),seriesName:str(issue?.series?.name||issue?.seriesName),seriesYear:seriesStartYear(issue?.series?.name||issue?.seriesName||issue?.title),onSale:str(issue?.dates?.onSale||issue?.onSaleDate),unlimited:str(issue?.dates?.unlimited||issue?.unlimitedDate),yearPage:y})).filter(x=>x.sourceId);
  })();catalogYearCache.set(y,promise);return promise;
}

function scoreCatalogCandidate(local,c){
  if(normalizeIssue(local.issueNumber)!==normalizeIssue(c.issueNumber))return-Infinity;
  const remoteTitle=c.seriesName||c.title.replace(/#\s*[^#]+$/,'').trim(),a=normalizeSeries(local.title),b=normalizeSeries(remoteTitle),sim=tokenScore(local.title,remoteTitle);if(!a||!b||sim<0.5)return-Infinity;
  let score=sim*60;if(a===b)score+=120;else if(a.includes(b)||b.includes(a))score+=35;if(local.seriesYear&&c.seriesYear&&String(local.seriesYear)===String(c.seriesYear))score+=35;const ly=yearOf(local.date);if(ly&&Number(ly)===Number(c.yearPage))score+=22;if(local.date&&c.onSale&&local.date.slice(0,10)===c.onSale.slice(0,10))score+=28;if(c.readerId)score+=2;return score;
}

async function catalogCandidateIds(local){
  const y=Number(yearOf(local.date));if(!y)return[];
  const years=[y,y-1,y+1].filter((v,i,a)=>v>=1939&&v<=new Date().getUTCFullYear()+1&&a.indexOf(v)===i),ranked=[];
  for(const year of years){for(const c of await fetchCatalogYear(year)){const score=scoreCatalogCandidate(local,c);if(Number.isFinite(score))ranked.push({sourceId:c.sourceId,score})}}
  ranked.sort((a,b)=>b.score-a.score);const out=[],seen=new Set();for(const x of ranked){if(seen.has(x.sourceId))continue;seen.add(x.sourceId);out.push(x.sourceId);if(out.length>=8)break}return out;
}

function candidateIds(searchHtml){const out=[],seen=new Set(),re=/(?:https?:\/\/www\.marvel\.com)?\/comics\/issue\/(\d+)(?:\/[^"'<>\s]*)?/gi;let m;while((m=re.exec(searchHtml))&&out.length<20){const id=Number(m[1]);if(id&&!seen.has(id)){seen.add(id);out.push(id)}}return out}
async function searchCandidateIds(local){
  const queries=[[local.title,`#${local.issueNumber}`].filter(Boolean).join(' '),[local.title,local.issueNumber,local.seriesYear].filter(Boolean).join(' ')],out=[],seen=new Set();
  for(const q of queries){const u=new URL(SEARCH);u.searchParams.set('content_type','comics');u.searchParams.set('query',q);const r=await request(u.toString(),{tries:4});if(!r)continue;for(const id of candidateIds(await r.text()))if(!seen.has(id)){seen.add(id);out.push(id)}if(out.length>=12)break;await sleep(80)}return out.slice(0,12);
}

function rowForMu(local,found){return[local.gcdId,found.sourceId,found.readerId||0,found.drn?STATUS.MU:STATUS.MU_LINK_MISSING,found.cover||'',found.drn||'']}
function rowForNoDigital(local,found){return[local.gcdId,found.sourceId,0,STATUS.NO_DIGITAL,found.cover||'','']}

async function verifyLocal(local,currentRow){
  const candidateOrder=[],seen=new Set(),transient=[];const add=id=>{id=Number(id)||0;if(id&&!seen.has(id)){seen.add(id);candidateOrder.push(id)}};
  add(currentRow?.[1]);add(REGRESSION_HINTS.get(local.gcdId));
  let catalogWorked=false,searchWorked=false;
  try{const ids=await catalogCandidateIds(local);catalogWorked=true;ids.forEach(add)}catch(e){transient.push(`catalog:${e?.message||e}`)}
  let negative=null,exactUnknown=null;
  async function inspectCandidates(ids){for(const sourceId of ids){try{const found=await inspectOfficialIssue(local,sourceId);if(found.kind!=='exact')continue;if(found.availability==='mu')return{kind:'mu',source:'official-page',...found,row:rowForMu(local,found)};if(found.availability==='no-digital'){negative=negative||found;continue}exactUnknown=exactUnknown||found}catch(e){transient.push(`issue:${sourceId}:${e?.message||e}`)}}return null}
  let positive=await inspectCandidates(candidateOrder);if(positive)return positive;
  try{const ids=await searchCandidateIds(local);searchWorked=true;const fresh=ids.filter(id=>!seen.has(id));fresh.forEach(add);positive=await inspectCandidates(fresh);if(positive)return positive}catch(e){transient.push(`search:${e?.message||e}`)}
  if(negative)return{kind:'no-digital',source:'official-page',...negative,row:rowForNoDigital(local,negative)};
  if(exactUnknown)return{kind:'retryable',reason:exactUnknown.availability==='conflict'?'official-page-conflicting-availability':'official-page-availability-unknown',sourceId:exactUnknown.sourceId,title:exactUnknown.title};
  if(transient.length&&!catalogWorked&&!searchWorked)return{kind:'retryable',reason:transient.slice(0,3).join(' | ')};
  if(transient.some(x=>x.startsWith('issue:')))return{kind:'retryable',reason:transient.slice(0,3).join(' | ')};
  return{kind:'not-found',reason:seen.size?'no-exact-official-match':'no-candidates-from-discovery',candidateCount:seen.size};
}

async function readCheckpoint(signature){try{const p=JSON.parse(await fs.readFile(checkpointFile,'utf8'));return p?.version===3&&p?.signature===signature&&p?.results?p:null}catch{return null}}
async function saveCheckpoint(signature,results,processed,total){await fs.mkdir(checkpointDir,{recursive:true});const tmp=checkpointFile+'.tmp';await fs.writeFile(tmp,JSON.stringify({version:3,signature,updatedAt:new Date().toISOString(),processed,total,results}));await fs.rename(tmp,checkpointFile)}

async function pilot(){
  const local=await loadLocal(),strange=local.byId.get(8972),cap=local.byId.get(3617);if(!strange||!cap)throw new Error('Faltan regresiones locales del piloto.');
  const strangeDirect=await inspectOfficialIssue(strange,11016),capCorrect=await inspectOfficialIssue(cap,7880),capWrong=await inspectOfficialIssue(cap,12798);
  const report={version:3,generatedAt:new Date().toISOString(),strangeDirect,capCorrect,capWrong};await fs.mkdir(artifactRoot,{recursive:true});await fs.writeFile(path.join(artifactRoot,'pilot.json'),JSON.stringify(report,null,2)+'\n');
  if(strangeDirect.kind!=='exact'||strangeDirect.availability!=='mu')throw new Error(`Piloto directo Strange Tales #1 no confirmó Unlimited: ${JSON.stringify(strangeDirect)}`);
  if(capCorrect.kind!=='exact')throw new Error(`La ficha oficial correcta de Captain America Comics #38 no coincide con su identidad: ${JSON.stringify(capCorrect)}`);
  if(capWrong.kind==='exact')throw new Error(`La protección de identidad aceptó el falso positivo Captain America (1998) #38: ${JSON.stringify(capWrong)}`);
  console.log('Piloto v3 correcto:',JSON.stringify(report,null,2));
}

async function scan(){
  const [local,pack]=await Promise.all([loadLocal(),fs.readFile(cacheFile,'utf8').then(JSON.parse)]);if(Number(pack.version)<3||!Array.isArray(pack.entries)||Number(pack.localCount)!==51002)throw new Error('Caché V3 base inválida o con conteo inesperado.');
  const byRow=new Map(pack.entries.map(r=>[Number(r[0]),r]));
  const all=pack.entries.filter(r=>[STATUS.NO_DIGITAL,STATUS.NOT_LISTED].includes(Number(r?.[3]))).map(r=>Number(r[0])).sort((a,b)=>a-b);
  const countNoDigital=pack.entries.filter(r=>Number(r?.[3])===STATUS.NO_DIGITAL).length,countNotListed=pack.entries.filter(r=>Number(r?.[3])===STATUS.NOT_LISTED).length,targets=all.filter((_,i)=>i%shardCount===shard);
  const signature=[pack.generatedAt,pack.localCount,pack.entries.length,'3,4',all.length,shardCount,shard].join('|'),cp=await readCheckpoint(signature),results=cp?.results||{};let done=Object.keys(results).length;
  console.log(`Cobertura oficial v3: noDigital=${countNoDigital}; notListed=${countNotListed}; shard ${shard+1}/${shardCount}; objetivos=${targets.length}; checkpoint=${done}.`);
  const pending=targets.filter(id=>!results[id]);let cursor=0;
  async function worker(){while(cursor<pending.length){const id=pending[cursor++],x=local.byId.get(id),row=byRow.get(id);if(!x)results[id]={kind:'retryable',reason:'missing-local-row'};else try{results[id]=await verifyLocal(x,row)}catch(e){results[id]={kind:'retryable',reason:e?.message||String(e),httpStatus:Number(e?.httpStatus)||0}}done++;if(done%20===0||done===targets.length){const vals=Object.values(results),mu=vals.filter(v=>v.kind==='mu').length,no=vals.filter(v=>v.kind==='no-digital').length,nf=vals.filter(v=>v.kind==='not-found').length,rt=vals.filter(v=>v.kind==='retryable').length;console.log(`Shard ${shard}: ${done}/${targets.length}; MU=${mu}; noDigital=${no}; pendientes=${nf}; retry=${rt}`);await saveCheckpoint(signature,results,done,targets.length)}await sleep(180)}}
  await Promise.all(Array.from({length:concurrency},worker));await saveCheckpoint(signature,results,targets.length,targets.length);
  const values=Object.entries(results).map(([gcdId,v])=>({gcdId:Number(gcdId),originalStatus:Number(byRow.get(Number(gcdId))?.[3]),...v}));
  const report={version:3,generatedAt:new Date().toISOString(),cacheGeneratedAt:pack.generatedAt,shard,shardCount,scannedStatuses:[STATUS.NO_DIGITAL,STATUS.NOT_LISTED],totalNoDigital:countNoDigital,totalNotListed:countNotListed,targetCount:targets.length,mu:values.filter(v=>v.kind==='mu').length,noDigital:values.filter(v=>v.kind==='no-digital').length,notFound:values.filter(v=>v.kind==='not-found').length,retryable:values.filter(v=>v.kind==='retryable').length,falseNegativeNoDigital:values.filter(v=>v.originalStatus===STATUS.NO_DIGITAL&&v.kind==='mu').length,unconfirmedNoDigital:values.filter(v=>v.originalStatus===STATUS.NO_DIGITAL&&v.kind==='not-found').length,results:values};
  await fs.mkdir(artifactRoot,{recursive:true});await fs.writeFile(path.join(artifactRoot,`shard-${shard}.json`),JSON.stringify(report,null,2)+'\n');if(report.retryable)throw new Error(`Shard ${shard}: ${report.retryable} resultados transitorios; conservar checkpoint y reintentar.`);
}

function recompute(pack){const count=s=>pack.entries.filter(r=>Number(r?.[3])===s).length;pack.matched=count(STATUS.MU)+count(STATUS.MU_LINK_MISSING);pack.verifiedMU=pack.matched;pack.unavailable=count(STATUS.NO_DIGITAL);pack.noDigital=pack.unavailable;pack.notListed=count(STATUS.NOT_LISTED);pack.ambiguous=count(STATUS.AMBIGUOUS);pack.unknown=count(STATUS.UNKNOWN);pack.linkReady=pack.entries.filter(r=>Number(r?.[3])===STATUS.MU&&str(r?.[5])).length;pack.linkMissing=pack.entries.filter(r=>Number(r?.[3])===STATUS.MU_LINK_MISSING||Number(r?.[3])===STATUS.MU&&!str(r?.[5])).length;pack.linksPrebuilt=pack.linkMissing===0;return pack}

async function merge(){
  const pack=JSON.parse(await fs.readFile(cacheFile,'utf8'));if(Number(pack.localCount)!==51002||!Array.isArray(pack.entries)||pack.entries.length!==51002)throw new Error('La caché base no contiene exactamente 51.002 filas.');
  const originalEntries=pack.entries.map(r=>[...r]),immutableBefore=new Map(originalEntries.filter(r=>![STATUS.NO_DIGITAL,STATUS.NOT_LISTED].includes(Number(r[3]))).map(r=>[Number(r[0]),JSON.stringify(r)]));
  const files=[];async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else if(/^shard-\d+\.json$/.test(e.name))files.push(p)}}await walk(artifactRoot);if(files.length!==shardCount)throw new Error(`Se esperaban ${shardCount} shards y llegaron ${files.length}.`);
  const reports=await Promise.all(files.map(f=>fs.readFile(f,'utf8').then(JSON.parse)));if(reports.some(r=>Number(r.version)!==3))throw new Error('Hay shards que no pertenecen a la auditoría v3.');if(reports.some(r=>r.retryable))throw new Error('Hay shards con resultados transitorios.');
  const byId=new Map(pack.entries.map((r,i)=>[Number(r[0]),i]));let promotedMU=0,confirmedNoDigital=0,demotedUnconfirmedNoDigital=0,checked=0,falseNegativeNoDigital=0;
  for(const rep of reports)for(const v of rep.results){checked++;const pos=byId.get(Number(v.gcdId));if(pos==null)throw new Error(`GCD ${v.gcdId} desapareció de la caché.`);const current=pack.entries[pos],oldStatus=Number(current[3]);if(![STATUS.NO_DIGITAL,STATUS.NOT_LISTED].includes(oldStatus))throw new Error(`La auditoría intentó mutar un estado protegido ${oldStatus} en GCD ${v.gcdId}.`);if(v.kind==='mu'){if(!Array.isArray(v.row)||![STATUS.MU,STATUS.MU_LINK_MISSING].includes(Number(v.row[3])))throw new Error(`Promoción MU inválida en ${v.gcdId}.`);pack.entries[pos]=v.row;promotedMU++;if(oldStatus===STATUS.NO_DIGITAL)falseNegativeNoDigital++}else if(v.kind==='no-digital'){if(!Array.isArray(v.row)||Number(v.row[3])!==STATUS.NO_DIGITAL)throw new Error(`Negativo oficial inválido en ${v.gcdId}.`);pack.entries[pos]=v.row;confirmedNoDigital++}else if(v.kind==='not-found'){if(oldStatus===STATUS.NO_DIGITAL){pack.entries[pos]=[Number(current[0]),Number(current[1])||0,0,STATUS.NOT_LISTED,str(current[4]),''];demotedUnconfirmedNoDigital++}}else throw new Error(`Resultado no publicable ${v.kind} en ${v.gcdId}.`)}
  if(pack.entries.length!==51002)throw new Error('Cambió el número de filas durante el merge.');const ids=new Set(pack.entries.map(r=>Number(r[0])));if(ids.size!==51002)throw new Error(`IDs GCD duplicados o perdidos: ${ids.size}/51002.`);
  for(const [id,before] of immutableBefore){const after=pack.entries[byId.get(id)];if(JSON.stringify(after)!==before)throw new Error(`Regresión: se modificó una fila previamente positiva/protegida GCD ${id}.`)}
  recompute(pack);const now=new Date().toISOString(),strange=pack.entries.find(r=>Number(r[0])===8972),cap=pack.entries.find(r=>Number(r[0])===3617);
  if(!strange||![STATUS.MU,STATUS.MU_LINK_MISSING].includes(Number(strange[3]))||Number(strange[1])!==11016)throw new Error(`Regresión Strange Tales #1: ${JSON.stringify(strange)}`);
  if(cap&&[STATUS.MU,STATUS.MU_LINK_MISSING].includes(Number(cap[3]))&&Number(cap[1])===12798)throw new Error(`Regresión Captain America Comics #38: falso positivo 1998 ${JSON.stringify(cap)}`);
  if(pack.unknown||pack.ambiguous)throw new Error(`No se publica con unknown=${pack.unknown}, ambiguous=${pack.ambiguous}.`);
  pack.generatedAt=now;pack.officialCoverageAudit={version:3,completed:true,completedAt:now,authority:'marvel.com/comics/issue; discovery only via cached sourceId, catalog mirrors and marvel.com/search',checked,promotedMU,falseNegativeNoDigital,confirmedNoDigital,demotedUnconfirmedNoDigital,remainingNotListed:pack.notListed,localCount:pack.localCount};
  pack.linkAudit={...(pack.linkAudit||{}),allLinksVerified:false,invalidatedAt:now,invalidatedReason:'official-coverage-v3-changed',linkMissing:pack.linkMissing};
  await fs.writeFile(cacheFile,JSON.stringify(pack));await fs.mkdir(artifactRoot,{recursive:true});await fs.writeFile(path.join(artifactRoot,'summary.json'),JSON.stringify({before:{matched:originalEntries.filter(r=>[STATUS.MU,STATUS.MU_LINK_MISSING].includes(Number(r[3]))).length,noDigital:originalEntries.filter(r=>Number(r[3])===STATUS.NO_DIGITAL).length,notListed:originalEntries.filter(r=>Number(r[3])===STATUS.NOT_LISTED).length},after:{matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed,linkReady:pack.linkReady,linkMissing:pack.linkMissing},audit:pack.officialCoverageAudit},null,2)+'\n');
  console.log(JSON.stringify({matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed,linkReady:pack.linkReady,linkMissing:pack.linkMissing,audit:pack.officialCoverageAudit},null,2));
}

if(mode==='pilot')await pilot();else if(mode==='scan')await scan();else if(mode==='merge')await merge();else throw new Error(`Modo desconocido: ${mode}`);
