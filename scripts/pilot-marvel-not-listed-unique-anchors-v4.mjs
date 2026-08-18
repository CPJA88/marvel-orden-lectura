import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import extract from 'extract-zip';

const root=process.cwd();
const archive=path.join(root,'Marvel_Orden_de_Lectura_PWA.zip');
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const catalogFile=path.join(root,'.cache','marvel-global-catalog-v4.json');
const outDir=path.join(root,'artifacts','marvel-not-listed-v4');
const outFile=path.join(outDir,'pilot-unique-anchors-v4.json');
const STATUS={MU:1,NOT_LISTED:4,MU_LINK_MISSING:5};
const ISSUE='https://www.marvel.com/comics/issue/';
const SHARE_READER='https://share.marvel.com/sharing/reader/';
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const DRN_RE=/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i;
const str=v=>v==null?'':String(v);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const normalize=v=>str(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
const normalizeSeries=v=>normalize(str(v).replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|present))?\s*\)/gi,' ')).replace(/^the\s+/,'').replace(/\s+comics?$/,'').trim();
const normalizeIssue=v=>{let s=str(v).trim().toUpperCase().replace(/\s+/g,'');if(/^0+\d+$/.test(s))s=String(Number(s));return s};
const tokenScore=(a,b)=>{const A=new Set(normalizeSeries(a).split(' ').filter(Boolean)),B=new Set(normalizeSeries(b).split(' ').filter(Boolean));if(!A.size||!B.size)return 0;let n=0;for(const t of A)if(B.has(t))n++;return n/Math.max(A.size,B.size)};
const yearOf=v=>str(v).match(/\b((?:19|20)\d{2})\b/)?.[1]||'';
const decodeHtml=v=>str(v).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)||32));
const plainHtml=html=>decodeHtml(str(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
const pageTitle=html=>decodeHtml(str(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||str(html).match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]||'').replace(/\s*\|\s*Comic Issues\s*\|\s*Marvel.*$/i,'').trim();
const parseIssueTitle=title=>{const m=decodeHtml(title).trim().match(/^(.*?)\s*(?:\(\s*(\d{4})(?:\s*-\s*(?:\d{4}|present))?\s*\))?\s*#\s*([^\s|]+)/i);return m?{series:m[1].trim(),year:m[2]||'',issue:m[3].trim()}:null};
const extractDrn=v=>str(v).replace(/\\u003A/gi,':').replace(/%3A/gi,':').match(DRN_RE)?.[0]||'';
const extractReaderId=html=>{const s=str(html);for(const re of [/sharing\/reader\/(\d+)/i,/sharing\/legacy\/(\d+)/i,/read\.marvel\.com\/#\/book\/(\d+)/i,/["'](?:digitalId|readerId)["']\s*:\s*["']?(\d+)/i,/(?:digitalId|readerId)%22%3A(?:%22)?(\d+)/i,/purchaseMobileUrl["']?\s*[:=]\s*["'][^"']*\/issue\/(\d+)/i]){const m=s.match(re);if(m)return Number(m[1])||0}return 0};
function availability(html){const t=plainHtml(html).toLowerCase(),mu=/members get unlimited access to this issue/.test(t)||/get unlimited access to this issue/.test(t)||/this content is available through marvel unlimited/.test(t),no=/digital issue (?:is )?not currently available/.test(t);if(mu&&!no)return'mu';if(no&&!mu)return'no-digital';if(mu&&no)return'conflict';return'unknown'}
function dateYearCompatible(local,c,max=1){const a=Number(yearOf(local?.date)),b=Number(yearOf(c?.onSale)||c?.yearPage||0);if(!a||!b)return false;return Math.abs(a-b)<=max}
function seriesNameCompatible(a,b){const A=normalizeSeries(a),B=normalizeSeries(b);if(!A||!B)return false;if(A===B)return true;return Math.min(A.split(' ').length,B.split(' ').length)>=2&&tokenScore(A,B)>=0.82}
function remoteSeriesKey(c){return c.seriesId?`id:${c.seriesId}`:`name:${normalizeSeries(c.seriesName)}`}

async function request(url,{tries=4}={}){let last;for(let i=0;i<tries;i++){try{const r=await fetch(url,{headers:{'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(25000)});if(r.ok)return r;if(r.status===404)return null;last=new Error(`HTTP ${r.status} ${url}`);try{await r.body?.cancel()}catch{};await sleep(Math.min(10000,700*(2**i)))}catch(e){last=e;await sleep(Math.min(10000,700*(2**i)))}}throw last||new Error(`Sin respuesta ${url}`)}

async function loadLocal(){
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'marvel-unique-anchor-v4-'));
  try{
    await extract(archive,{dir:tmp});
    const data=path.join(tmp,'data'),meta=JSON.parse(await fs.readFile(path.join(data,'meta.json'),'utf8')),series=JSON.parse(await fs.readFile(path.join(data,'series.json'),'utf8')),seriesMeta=new Map(series.map(s=>[Number(s.id),s])),byId=new Map(),bySeries=new Map();
    for(const c of meta.chunks||[])for(const x of JSON.parse(await fs.readFile(path.join(data,c.file),'utf8'))){
      const s=seriesMeta.get(Number(x.s))||{},item={gcdId:Number(x.id),seriesId:Number(x.s),title:s.original||s.es||'',issueNumber:str(x.n),seriesYear:str(x.a||s.year||s.y),date:str(x.sv||x.d)};
      byId.set(item.gcdId,item);const arr=bySeries.get(item.seriesId)||[];arr.push(item);bySeries.set(item.seriesId,arr);
    }
    return{byId,bySeries};
  }finally{await fs.rm(tmp,{recursive:true,force:true})}
}

function pageMatchesRemote(candidate,title){
  const p=parseIssueTitle(title);if(!p||normalizeIssue(p.issue)!==normalizeIssue(candidate.issueNumber))return false;
  const a=normalizeSeries(candidate.seriesName),b=normalizeSeries(p.series);if(!a||!b)return false;
  return a===b||a.includes(b)||b.includes(a)||tokenScore(a,b)>=0.82;
}
function pickRemoteIssue(remoteIssues,localIssue,positiveSourceIds){
  const same=(remoteIssues||[]).filter(c=>normalizeIssue(c.issueNumber)===normalizeIssue(localIssue.issueNumber)&&dateYearCompatible(localIssue,c,1)&&!positiveSourceIds.has(Number(c.sourceId)));
  if(!same.length)return null;
  same.sort((a,b)=>{const ly=Number(yearOf(localIssue.date)),ay=Number(yearOf(a.onSale)||a.yearPage||0),by=Number(yearOf(b.onSale)||b.yearPage||0);return Math.abs(ly-ay)-Math.abs(ly-by)});
  return same[0];
}
async function inspectOfficial(candidate){
  const r=await request(ISSUE+candidate.sourceId,{tries:3});if(!r)return{kind:'missing',sourceId:candidate.sourceId};
  const html=await r.text(),title=pageTitle(html);if(!pageMatchesRemote(candidate,title))return{kind:'remote-identity-mismatch',sourceId:candidate.sourceId,title};
  let av=availability(html),readerId=extractReaderId(html),drn=extractDrn(html);if(av==='conflict'&&(readerId||drn))av='mu';
  return{kind:'exact-remote',sourceId:candidate.sourceId,title,availability:av,readerId,drn};
}
async function inspectReader(candidate,readerId){
  if(!readerId)return null;const r=await request(SHARE_READER+readerId,{tries:3});if(!r)return null;
  const html=await r.text(),title=pageTitle(html);
  return{status:r.status,title,remoteIdentity:pageMatchesRemote(candidate,title),availability:availability(html),readerId,smartLink:`https://marvel.smart.link/fiir7ec77?type=reader&drn=${readerId}`};
}

await fs.mkdir(outDir,{recursive:true});
const [local,pack,catalogPack]=await Promise.all([loadLocal(),fs.readFile(cacheFile,'utf8').then(JSON.parse),fs.readFile(catalogFile,'utf8').then(JSON.parse)]);
const catalog=Array.isArray(catalogPack?.issues)?catalogPack.issues:[];
if(Number(pack.localCount)!==51002||Number(pack.matched)!==25329||Number(pack.notListed)!==24616)throw new Error(`Baseline inesperada: ${pack.localCount}/${pack.matched}/${pack.notListed}`);
if(catalog.length<30000)throw new Error(`Catálogo global V4 ausente o incompleto: ${catalog.length}`);

const positiveRows=pack.entries.filter(r=>[STATUS.MU,STATUS.MU_LINK_MISSING].includes(Number(r?.[3]))&&Number(r?.[1]));
const countBy=(idx,valid=v=>Boolean(v))=>{const m=new Map();for(const r of positiveRows){const v=r?.[idx];if(!valid(v))continue;const k=String(v).toLowerCase();m.set(k,(m.get(k)||0)+1)}return m};
const sourceCounts=countBy(1,v=>Number(v)>0),readerCounts=countBy(2,v=>Number(v)>0),drnCounts=countBy(5,v=>Boolean(str(v)));
const uniqueAnchorRows=positiveRows.filter(r=>{const sid=String(Number(r[1])||0),rid=String(Number(r[2])||0),drn=str(r[5]).toLowerCase();return Number(r[1])>0&&sourceCounts.get(sid)===1&&(!Number(r[2])||readerCounts.get(rid)===1)&&(!drn||drnCounts.get(drn)===1)});
const excludedAmbiguousAnchors=positiveRows.length-uniqueAnchorRows.length,positiveSourceIds=new Set(positiveRows.map(r=>Number(r[1])).filter(Boolean));

const catalogBySource=new Map(catalog.map(c=>[Number(c.sourceId),c])),remoteSeries=new Map();
for(const c of catalog){const k=remoteSeriesKey(c),g=remoteSeries.get(k)||{key:k,seriesId:Number(c.seriesId)||0,seriesName:str(c.seriesName),issues:[]};g.issues.push(c);remoteSeries.set(k,g)}

const votes=new Map();let anchorsFound=0,anchorsDateCompatible=0;
for(const row of uniqueAnchorRows){
  const x=local.byId.get(Number(row[0])),c=catalogBySource.get(Number(row[1]));if(!x||!c)continue;
  anchorsFound++;const key=remoteSeriesKey(c),per=votes.get(x.seriesId)||new Map(),v=per.get(key)||{count:0,dateCompatible:0,remoteKey:key};
  v.count++;if(dateYearCompatible(x,c,1)){v.dateCompatible++;anchorsDateCompatible++}per.set(key,v);votes.set(x.seriesId,per);
}

const mappings=new Map(),mappingStats={strong:0,rejectedConflict:0,rejectedDates:0,rejectedTitle:0,rejectedTooFew:0};
for(const [localSeriesId,per] of votes){
  const ranked=[...per.values()].sort((a,b)=>b.count-a.count),top=ranked[0],total=ranked.reduce((n,v)=>n+v.count,0),second=ranked[1]?.count||0,localIssue=(local.bySeries.get(localSeriesId)||[])[0],remote=remoteSeries.get(top.remoteKey);
  if(!localIssue||!remote)continue;
  if(top.count<2){mappingStats.rejectedTooFew++;continue}
  if(!(top.count/total>=0.8&&top.count>second)){mappingStats.rejectedConflict++;continue}
  if(!(top.dateCompatible>=2&&top.dateCompatible/top.count>=0.9)){mappingStats.rejectedDates++;continue}
  if(!seriesNameCompatible(localIssue.title,remote.seriesName)){mappingStats.rejectedTitle++;continue}
  const map={localSeriesId,localTitle:localIssue.title,remoteKey:top.remoteKey,remoteSeriesId:remote.seriesId,remoteSeriesName:remote.seriesName,anchorVotes:top.count,dateCompatibleAnchors:top.dateCompatible,totalVotes:total,trust:'unique-multi-anchor'};
  mappings.set(localSeriesId,map);mappingStats.strong++;
}

const notListedRows=pack.entries.filter(r=>Number(r?.[3])===STATUS.NOT_LISTED),candidates=[];
for(const row of notListedRows){
  const x=local.byId.get(Number(row[0]));if(!x)continue;const map=mappings.get(x.seriesId);if(!map)continue;
  const c=pickRemoteIssue(remoteSeries.get(map.remoteKey)?.issues,x,positiveSourceIds);if(!c)continue;
  candidates.push({gcdId:x.gcdId,local:x,mapping:map,candidate:{sourceId:Number(c.sourceId),readerId:Number(c.readerId)||0,seriesId:Number(c.seriesId)||0,seriesName:str(c.seriesName),issueNumber:str(c.issueNumber),onSale:str(c.onSale)}});
}

const bySeries=new Map();for(const c of candidates){const a=bySeries.get(c.local.seriesId)||[];a.push(c);bySeries.set(c.local.seriesId,a)}
const picked=[];let round=0;while(picked.length<200){let added=0;for(const arr of bySeries.values()){if(round<arr.length){picked.push(arr[round]);added++;if(picked.length>=200)break}}if(!added)break;round++}

console.log(`Catálogo=${catalog.length}; positivos=${positiveRows.length}; anclas únicas=${uniqueAnchorRows.length}; excluidas=${excludedAmbiguousAnchors}; encontradas catálogo=${anchorsFound}; mappings=${mappings.size}; candidatos=${candidates.length}; pilot=${picked.length}`);
const checked=[];
for(const [i,item] of picked.entries()){
  console.log(`[${i+1}/${picked.length}] GCD=${item.gcdId} ${item.local.title} #${item.local.issueNumber} -> ${item.candidate.seriesName} #${item.candidate.issueNumber}`);
  try{const official=await inspectOfficial(item.candidate);let reader=null;if(official.kind==='exact-remote'&&official.availability==='mu'){const rid=official.readerId||item.candidate.readerId||0;if(rid)reader=await inspectReader(item.candidate,rid).catch(()=>null)}checked.push({...item,official,reader})}
  catch(e){checked.push({...item,official:{kind:'retryable',reason:e?.message||String(e),httpStatus:Number(e?.httpStatus)||0}})}
  await sleep(90);
}

const exact=checked.filter(x=>x.official?.kind==='exact-remote'),mu=exact.filter(x=>x.official.availability==='mu'),no=exact.filter(x=>x.official.availability==='no-digital'),unknown=exact.filter(x=>!['mu','no-digital'].includes(x.official.availability)),mismatch=checked.filter(x=>x.official?.kind==='remote-identity-mismatch'),retryable=checked.filter(x=>x.official?.kind==='retryable'),missing=checked.filter(x=>x.official?.kind==='missing');
const badDate=exact.filter(x=>!dateYearCompatible(x.local,x.candidate,1));
const readerConfirmed=mu.filter(x=>x.reader?.remoteIdentity&&x.reader?.availability==='mu');
const seriesYearDifferences=mu.filter(x=>{const p=parseIssueTitle(x.official.title),a=Number(x.local.seriesYear)||0,b=Number(p?.year)||0;return a&&b&&a!==b}).length;
const report={version:4,generatedAt:new Date().toISOString(),mode:'unique-anchor-date-pilot',writesCache:false,baseline:{localCount:pack.localCount,matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed,linkReady:pack.linkReady,linkMissing:pack.linkMissing},anchorSafety:{positiveRows:positiveRows.length,uniqueAnchorRows:uniqueAnchorRows.length,excludedAmbiguousAnchors,anchorsFound,anchorsDateCompatible},seriesMappings:{localSeriesWithVotes:votes.size,trusted:mappings.size,...mappingStats},candidateRecovery:{notListed:notListedRows.length,candidates:candidates.length,seriesWithCandidates:bySeries.size},pilot:{checked:checked.length,exactRemote:exact.length,mu:mu.length,noDigital:no.length,unknown:unknown.length,remoteIdentityMismatch:mismatch.length,missing:missing.length,retryable:retryable.length,badDateWindow:badDate.length,readerRouteConfirmed:readerConfirmed.length,seriesYearDifferencesInformational:seriesYearDifferences},examples:{mu:mu.slice(0,30),noDigital:no.slice(0,20),mismatch:mismatch.slice(0,20),mappings:[...mappings.values()].slice(0,50)},safety:{cacheWritten:false,targetStatus:STATUS.NOT_LISTED,protectedRows:pack.entries.length-notListedRows.length,existingPositiveSourceIdsExcludedFromCandidates:true,ambiguousPositiveIdentifiersExcludedFromAnchors:true}};
await fs.writeFile(outFile,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({anchorSafety:report.anchorSafety,seriesMappings:report.seriesMappings,candidateRecovery:report.candidateRecovery,pilot:report.pilot},null,2));
console.log(`Informe: ${outFile}`);
if(report.pilot.badDateWindow||report.pilot.remoteIdentityMismatch||report.pilot.retryable||report.pilot.unknown)throw new Error(`Piloto no publicable: date=${report.pilot.badDateWindow} mismatch=${report.pilot.remoteIdentityMismatch} retry=${report.pilot.retryable} unknown=${report.pilot.unknown}`);
