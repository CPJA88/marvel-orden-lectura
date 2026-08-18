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
const checkpointDir=path.join(root,'.cache','marvel-official-coverage-v1');
const checkpointFile=path.join(checkpointDir,`shard-${shard}.json`);
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const SEARCH='https://www.marvel.com/search';
const ISSUE='https://www.marvel.com/comics/issue/';
const LEGACY='https://share.marvel.com/sharing/legacy/';
const STATUS={UNKNOWN:0,MU:1,AMBIGUOUS:2,NO_DIGITAL:3,NOT_LISTED:4,MU_LINK_MISSING:5};
const DRN_RE=/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const str=v=>v==null?'':String(v);
const normalize=v=>str(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
const normalizeSeries=v=>normalize(str(v).replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|present))?\s*\)/gi,' ')).replace(/^the\s+/,'').replace(/\s+comics?$/,'').trim();
const normalizeIssue=v=>{let s=str(v).trim().toUpperCase().replace(/\s+/g,'');if(/^0+\d+$/.test(s))s=String(Number(s));return s};
const tokenScore=(a,b)=>{const A=new Set(normalizeSeries(a).split(' ').filter(Boolean)),B=new Set(normalizeSeries(b).split(' ').filter(Boolean));if(!A.size||!B.size)return 0;let n=0;for(const t of A)if(B.has(t))n++;return n/Math.max(A.size,B.size)};
const decodeHtml=v=>str(v).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)||32));
const plainHtml=html=>decodeHtml(str(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
const pageTitle=html=>decodeHtml(str(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||str(html).match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]||'').replace(/\s*\|\s*Comic Issues\s*\|\s*Marvel.*$/i,'').trim();
const parseIssueTitle=title=>{const m=decodeHtml(title).trim().match(/^(.*?)\s*(?:\(\s*(\d{4})(?:\s*-\s*(?:\d{4}|present))?\s*\))?\s*#\s*([^\s|]+)/i);return m?{series:m[1].trim(),year:m[2]||'',issue:m[3].trim()}:null};
const availability=html=>{const t=plainHtml(html).toLowerCase();if(/digital issue (?:is )?not currently available/.test(t))return'no-digital';if(/members get unlimited access to this issue/.test(t)||/get unlimited access to this issue/.test(t))return'mu';return'unknown'};
const extractDrn=v=>str(v).replace(/\\u003A/gi,':').replace(/%3A/gi,':').match(DRN_RE)?.[0]||'';
const extractReaderId=html=>{const s=str(html);for(const re of [/sharing\/legacy\/(\d+)/i,/read\.marvel\.com\/#\/book\/(\d+)/i,/["'](?:digitalId|readerId)["']\s*:\s*["']?(\d+)/i,/(?:digitalId|readerId)%22%3A(?:%22)?(\d+)/i]){const m=s.match(re);if(m)return Number(m[1])||0}return 0};
const extractCover=html=>decodeHtml(str(html).match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]||'').replace(/^http:/i,'https:');

async function request(url,{tries=5,redirect='follow'}={}){
  let last,lastStatus=0;
  for(let i=0;i<tries;i++){
    try{
      const r=await fetch(url,{redirect,headers:{'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(25000)});
      lastStatus=r.status;
      if(r.ok||redirect==='manual'&&r.status>=300&&r.status<400)return r;
      if(r.status===404)return null;
      last=new Error(`HTTP ${r.status} ${url}`);last.httpStatus=r.status;
      const retry=Number(r.headers.get('retry-after')||0);try{await r.body?.cancel()}catch{}
      await sleep(retry?Math.min(60000,retry*1000):Math.min(20000,900*(2**i)));
    }catch(e){last=e;await sleep(Math.min(20000,900*(2**i)))}
  }
  const e=last||new Error(`Sin respuesta ${lastStatus} ${url}`);e.httpStatus=lastStatus;throw e;
}

async function loadLocal(){
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'marvel-official-coverage-'));
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

function candidateIds(searchHtml){
  const out=[];const seen=new Set();const re=/(?:https?:\/\/www\.marvel\.com)?\/comics\/issue\/(\d+)(?:\/[^"'<>\s]*)?/gi;let m;
  while((m=re.exec(searchHtml))&&out.length<20){const id=Number(m[1]);if(id&&!seen.has(id)){seen.add(id);out.push(id)}}
  return out;
}

async function resolveDrn(readerId){
  if(!readerId)return'';
  try{
    const r=await request(LEGACY+readerId,{tries:3,redirect:'manual'});if(!r)return'';
    let d=extractDrn(r.headers.get('location')||'');if(!d&&r.status>=200&&r.status<300)d=extractDrn(await r.text());return d;
  }catch{return''}
}

async function inspectOfficialIssue(local,sourceId){
  const r=await request(ISSUE+sourceId,{tries:4});if(!r)return null;
  const html=await r.text(),title=pageTitle(html);if(!sameIdentity(local,title))return null;
  const av=availability(html),cover=extractCover(html);let readerId=extractReaderId(html),drn=extractDrn(html);
  if(av==='mu'&&!drn&&readerId)drn=await resolveDrn(readerId);
  return{sourceId,readerId,drn,cover,title,availability:av};
}

async function verifyLocal(local){
  const q=[local.title,local.seriesYear,`#${local.issueNumber}`].filter(Boolean).join(' ');
  const u=new URL(SEARCH);u.searchParams.set('content_type','comics');u.searchParams.set('query',q);
  const r=await request(u.toString(),{tries:5});if(!r)throw new Error(`Búsqueda Marvel 404 para ${q}`);
  const html=await r.text(),ids=candidateIds(html);
  let exactUnknown=null;
  for(const sourceId of ids){
    const found=await inspectOfficialIssue(local,sourceId);if(!found)continue;
    if(found.availability==='mu')return{kind:'mu',...found,row:[local.gcdId,found.sourceId,found.readerId||0,found.drn?STATUS.MU:STATUS.MU_LINK_MISSING,found.cover||'',found.drn||'']};
    if(found.availability==='no-digital')return{kind:'no-digital',...found,row:[local.gcdId,found.sourceId,0,STATUS.NO_DIGITAL,found.cover||'','']};
    exactUnknown=found;
  }
  if(exactUnknown)return{kind:'retryable',reason:'official-page-availability-unknown',sourceId:exactUnknown.sourceId,title:exactUnknown.title};
  return{kind:'not-found',reason:ids.length?'no-exact-official-match':'official-search-no-candidates'};
}

async function readCheckpoint(signature){try{const p=JSON.parse(await fs.readFile(checkpointFile,'utf8'));return p?.signature===signature&&p?.results?p:null}catch{return null}}
async function saveCheckpoint(signature,results,processed,total){await fs.mkdir(checkpointDir,{recursive:true});const tmp=checkpointFile+'.tmp';await fs.writeFile(tmp,JSON.stringify({version:1,signature,updatedAt:new Date().toISOString(),processed,total,results}));await fs.rename(tmp,checkpointFile)}

async function pilot(){
  const local=await loadLocal();const x=local.byId.get(8972);if(!x)throw new Error('No existe GCD 8972 (Strange Tales #1) en la biblioteca local.');
  const result=await verifyLocal(x);console.log('Piloto Strange Tales #1:',result);
  if(result.kind!=='mu'||Number(result.sourceId)!==11016)throw new Error(`Regresión: Strange Tales #1 no se resolvió como Marvel sourceId 11016 + Unlimited (${JSON.stringify(result)}).`);
  await fs.mkdir(artifactRoot,{recursive:true});await fs.writeFile(path.join(artifactRoot,'pilot.json'),JSON.stringify({gcdId:8972,local:x,result},null,2)+'\n');
}

async function scan(){
  const [local,pack]=await Promise.all([loadLocal(),fs.readFile(cacheFile,'utf8').then(JSON.parse)]);
  if(Number(pack.version)<3||!Array.isArray(pack.entries)||pack.localCount<50000)throw new Error('Caché V3 inválida.');
  const all=pack.entries.filter(r=>Number(r?.[3])===STATUS.NOT_LISTED).map(r=>Number(r[0])).sort((a,b)=>a-b);
  const targets=all.filter((_,i)=>i%shardCount===shard);
  const signature=[pack.generatedAt,pack.localCount,pack.entries.length,all.length,shardCount,shard].join('|');
  const cp=await readCheckpoint(signature),results=cp?.results||{};
  let done=Object.keys(results).length;
  console.log(`Cobertura oficial: status4=${all.length}; shard ${shard+1}/${shardCount}; objetivos=${targets.length}; checkpoint=${done}.`);
  const pending=targets.filter(id=>!results[id]);let cursor=0;
  async function worker(){
    while(cursor<pending.length){const i=cursor++,id=pending[i],x=local.byId.get(id);if(!x){results[id]={kind:'retryable',reason:'missing-local-row'};continue}
      try{results[id]=await verifyLocal(x)}catch(e){results[id]={kind:'retryable',reason:e?.message||String(e),httpStatus:Number(e?.httpStatus)||0}}
      done++;if(done%25===0||done===targets.length){const vals=Object.values(results),mu=vals.filter(v=>v.kind==='mu').length,no=vals.filter(v=>v.kind==='no-digital').length,nf=vals.filter(v=>v.kind==='not-found').length,rt=vals.filter(v=>v.kind==='retryable').length;console.log(`Shard ${shard}: ${done}/${targets.length}; MU=${mu}; noDigital=${no}; noMatch=${nf}; retry=${rt}`);await saveCheckpoint(signature,results,done,targets.length)}
      await sleep(120);
    }
  }
  await Promise.all(Array.from({length:concurrency},worker));await saveCheckpoint(signature,results,targets.length,targets.length);
  const values=Object.entries(results).map(([gcdId,v])=>({gcdId:Number(gcdId),...v}));
  const report={version:1,generatedAt:new Date().toISOString(),cacheGeneratedAt:pack.generatedAt,shard,shardCount,totalNotListed:all.length,targetCount:targets.length,mu:values.filter(v=>v.kind==='mu').length,noDigital:values.filter(v=>v.kind==='no-digital').length,notFound:values.filter(v=>v.kind==='not-found').length,retryable:values.filter(v=>v.kind==='retryable').length,results:values};
  await fs.mkdir(artifactRoot,{recursive:true});await fs.writeFile(path.join(artifactRoot,`shard-${shard}.json`),JSON.stringify(report,null,2)+'\n');
  if(report.retryable)throw new Error(`Shard ${shard}: ${report.retryable} resultados transitorios/no verificables; conservar checkpoint y reintentar.`);
}

function recompute(pack){
  const count=s=>pack.entries.filter(r=>Number(r?.[3])===s).length;
  pack.matched=count(STATUS.MU)+count(STATUS.MU_LINK_MISSING);pack.verifiedMU=pack.matched;pack.unavailable=count(STATUS.NO_DIGITAL);pack.noDigital=pack.unavailable;pack.notListed=count(STATUS.NOT_LISTED);pack.ambiguous=count(STATUS.AMBIGUOUS);pack.unknown=count(STATUS.UNKNOWN);
  pack.linkReady=pack.entries.filter(r=>Number(r?.[3])===STATUS.MU&&str(r?.[5])).length;pack.linkMissing=pack.entries.filter(r=>Number(r?.[3])===STATUS.MU_LINK_MISSING||Number(r?.[3])===STATUS.MU&&!str(r?.[5])).length;pack.linksPrebuilt=pack.linkMissing===0;return pack;
}

async function merge(){
  const pack=JSON.parse(await fs.readFile(cacheFile,'utf8')),before={matched:pack.matched,notListed:pack.notListed,noDigital:pack.noDigital,linkReady:pack.linkReady,linkMissing:pack.linkMissing};
  const files=[];async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else if(/^shard-\d+\.json$/.test(e.name))files.push(p)}}await walk(artifactRoot);
  if(files.length!==shardCount)throw new Error(`Se esperaban ${shardCount} shards y llegaron ${files.length}.`);
  const reports=await Promise.all(files.map(f=>fs.readFile(f,'utf8').then(JSON.parse)));if(reports.some(r=>r.retryable))throw new Error('Hay shards con resultados transitorios.');
  const byId=new Map(pack.entries.map((r,i)=>[Number(r[0]),i]));let promotedMU=0,promotedNoDigital=0,checked=0,notFound=0;
  for(const rep of reports)for(const v of rep.results){checked++;if(v.kind==='not-found'){notFound++;continue}if(!Array.isArray(v.row))continue;const pos=byId.get(Number(v.gcdId));if(pos==null)continue;if(Number(pack.entries[pos][3])!==STATUS.NOT_LISTED)continue;pack.entries[pos]=v.row;if(v.kind==='mu')promotedMU++;if(v.kind==='no-digital')promotedNoDigital++}
  recompute(pack);pack.generatedAt=new Date().toISOString();pack.officialCoverageAudit={version:1,completed:true,completedAt:pack.generatedAt,authority:'marvel.com/search + marvel.com/comics/issue',previousNotListed:Number(before.notListed)||0,checked,promotedMU,promotedNoDigital,notFound,remainingNotListed:pack.notListed};
  const strange=pack.entries.find(r=>Number(r[0])===8972);if(!strange||![STATUS.MU,STATUS.MU_LINK_MISSING].includes(Number(strange[3]))||Number(strange[1])!==11016)throw new Error(`Regresión Strange Tales #1: ${JSON.stringify(strange)}`);
  if(pack.unknown||pack.ambiguous)throw new Error(`No se publica con unknown=${pack.unknown}, ambiguous=${pack.ambiguous}.`);
  await fs.writeFile(cacheFile,JSON.stringify(pack));await fs.mkdir(artifactRoot,{recursive:true});await fs.writeFile(path.join(artifactRoot,'summary.json'),JSON.stringify({before,after:{matched:pack.matched,notListed:pack.notListed,noDigital:pack.noDigital,linkReady:pack.linkReady,linkMissing:pack.linkMissing},...pack.officialCoverageAudit},null,2)+'\n');
  console.log(pack.officialCoverageAudit);console.log('Resumen:',{before,after:{matched:pack.matched,notListed:pack.notListed,noDigital:pack.noDigital,linkReady:pack.linkReady,linkMissing:pack.linkMissing}});
}

if(mode==='pilot')await pilot();else if(mode==='scan')await scan();else if(mode==='merge')await merge();else throw new Error(`Modo desconocido: ${mode}`);
