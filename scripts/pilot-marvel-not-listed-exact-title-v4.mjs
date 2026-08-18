import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import extract from 'extract-zip';

const root=process.cwd();
const archive=path.join(root,'Marvel_Orden_de_Lectura_PWA.zip');
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const catalogFile=path.join(root,'.cache','marvel-global-catalog-v4.json');
const outDir=path.join(root,'artifacts','marvel-not-listed-v4');
const outFile=path.join(outDir,'pilot-exact-title.json');
const STATUS_NOT_LISTED=4;
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const ISSUE='https://www.marvel.com/comics/issue/';
const SHARE_READER='https://share.marvel.com/sharing/reader/';
const str=v=>v==null?'':String(v);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const normalize=v=>str(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
const normalizeSeries=v=>normalize(str(v).replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|present))?\s*\)/gi,' ')).replace(/^the\s+/,'').replace(/\s+comics?$/,'').trim();
const normalizeIssue=v=>{let s=str(v).trim().toUpperCase().replace(/\s+/g,'');if(/^0+\d+$/.test(s))s=String(Number(s));return s};
const yearOf=v=>str(v).match(/\b((?:19|20)\d{2})\b/)?.[1]||'';
const decodeHtml=v=>str(v).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)||32));
const plainHtml=html=>decodeHtml(str(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
const pageTitle=html=>decodeHtml(str(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||str(html).match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]||'').replace(/\s*\|\s*Comic Issues\s*\|\s*Marvel.*$/i,'').trim();
const parseIssueTitle=title=>{const m=decodeHtml(title).trim().match(/^(.*?)\s*(?:\(\s*(\d{4})(?:\s*-\s*(?:\d{4}|present))?\s*\))?\s*#\s*([^\s|]+)/i);return m?{series:m[1].trim(),year:m[2]||'',issue:m[3].trim()}:null};
const extractReaderId=html=>{const s=str(html);for(const re of [/sharing\/reader\/(\d+)/i,/sharing\/legacy\/(\d+)/i,/read\.marvel\.com\/#\/book\/(\d+)/i,/["'](?:digitalId|readerId)["']\s*:\s*["']?(\d+)/i,/(?:digitalId|readerId)%22%3A(?:%22)?(\d+)/i,/purchaseMobileUrl["']?\s*[:=]\s*["'][^"']*\/issue\/(\d+)/i]){const m=s.match(re);if(m)return Number(m[1])||0}return 0};
function availability(html){const t=plainHtml(html).toLowerCase(),mu=/members get unlimited access to this issue/.test(t)||/get unlimited access to this issue/.test(t)||/this content is available through marvel unlimited/.test(t),no=/digital issue (?:is )?not currently available/.test(t);if(mu&&!no)return'mu';if(no&&!mu)return'no-digital';if(mu&&no)return'conflict';return'unknown'}
function publicationYear(c){return Number(yearOf(c?.onSale)||c?.yearPage||0)}
function exactLocalRemote(local,c){if(normalizeSeries(local.title)!==normalizeSeries(c.seriesName))return false;if(normalizeIssue(local.issueNumber)!==normalizeIssue(c.issueNumber))return false;const a=Number(yearOf(local.date)),b=publicationYear(c);return Boolean(a&&b&&Math.abs(a-b)<=1)}
function pageMatchesCandidate(c,title){const p=parseIssueTitle(title);if(!p)return false;return normalizeSeries(p.series)===normalizeSeries(c.seriesName)&&normalizeIssue(p.issue)===normalizeIssue(c.issueNumber)}
async function request(url,tries=3){let last;for(let i=0;i<tries;i++){try{const r=await fetch(url,{headers:{'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(25000)});if(r.ok)return r;if(r.status===404)return null;last=new Error(`HTTP ${r.status} ${url}`);last.httpStatus=r.status;try{await r.body?.cancel()}catch{};await sleep(500*(i+1))}catch(e){last=e;await sleep(500*(i+1))}}throw last||new Error(`Sin respuesta ${url}`)}
async function loadLocal(){const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'marvel-exact-title-v4-'));try{await extract(archive,{dir:tmp});const data=path.join(tmp,'data'),meta=JSON.parse(await fs.readFile(path.join(data,'meta.json'),'utf8')),series=JSON.parse(await fs.readFile(path.join(data,'series.json'),'utf8')),seriesMap=new Map(series.map(s=>[Number(s.id),s])),byId=new Map();for(const c of meta.chunks||[])for(const x of JSON.parse(await fs.readFile(path.join(data,c.file),'utf8'))){const s=seriesMap.get(Number(x.s))||{};byId.set(Number(x.id),{gcdId:Number(x.id),seriesId:Number(x.s),title:s.original||s.es||'',issueNumber:str(x.n),seriesYear:str(x.a||s.year||s.y),date:str(x.sv||x.d)})}return byId}finally{await fs.rm(tmp,{recursive:true,force:true})}}

await fs.mkdir(outDir,{recursive:true});
const [local,pack,catalogPack]=await Promise.all([loadLocal(),fs.readFile(cacheFile,'utf8').then(JSON.parse),fs.readFile(catalogFile,'utf8').then(JSON.parse)]);
if(Number(pack.localCount)!==51002||Number(pack.notListed)!==24616)throw new Error(`Baseline inesperada ${pack.localCount}/${pack.notListed}`);
if(!Array.isArray(catalogPack?.issues)||catalogPack.issues.length<30000)throw new Error('Falta catálogo global V4 restaurado.');
const catalog=catalogPack.issues;
const index=new Map();for(const c of catalog){const k=`${normalizeSeries(c.seriesName)}|${normalizeIssue(c.issueNumber)}`;if(!k.startsWith('|')&&!k.endsWith('|')){const a=index.get(k)||[];a.push(c);index.set(k,a)}}
const targets=pack.entries.filter(r=>Number(r?.[3])===STATUS_NOT_LISTED),resolved=[],ambiguous=[],noCandidate=[];
for(const row of targets){const x=local.get(Number(row[0]));if(!x){noCandidate.push({gcdId:Number(row[0]),reason:'missing-local'});continue}const k=`${normalizeSeries(x.title)}|${normalizeIssue(x.issueNumber)}`,all=index.get(k)||[],matches=all.filter(c=>exactLocalRemote(x,c));if(matches.length===1){resolved.push({gcdId:x.gcdId,local:x,candidate:matches[0]})}else if(matches.length>1){const exactDate=matches.filter(c=>str(c.onSale).slice(0,10)===str(x.date).slice(0,10));if(exactDate.length===1)resolved.push({gcdId:x.gcdId,local:x,candidate:exactDate[0],tieBrokenBy:'exact-date'});else ambiguous.push({gcdId:x.gcdId,local:x,candidates:matches.slice(0,6).map(c=>({sourceId:c.sourceId,seriesName:c.seriesName,issueNumber:c.issueNumber,onSale:c.onSale}))})}else noCandidate.push({gcdId:x.gcdId})}
const bySeries=new Map();for(const x of resolved){const a=bySeries.get(x.local.seriesId)||[];a.push(x);bySeries.set(x.local.seriesId,a)}
const sample=[];for(const a of bySeries.values()){sample.push(a[0]);if(a.length>2)sample.push(a[Math.floor(a.length/2)]);if(sample.length>=140)break}sample.splice(140);
console.log(`Exact-title V4: catálogo=${catalog.length}; NOT_LISTED=${targets.length}; candidatos únicos=${resolved.length}; ambiguos=${ambiguous.length}; sin candidato=${noCandidate.length}; pilot=${sample.length}`);
const checked=[];for(const [i,item] of sample.entries()){console.log(`[${i+1}/${sample.length}] ${item.local.title} #${item.local.issueNumber} -> sourceId=${item.candidate.sourceId}`);try{const r=await request(ISSUE+item.candidate.sourceId);if(!r){checked.push({...item,official:{kind:'missing'}});continue}const html=await r.text(),title=pageTitle(html);if(!pageMatchesCandidate(item.candidate,title)){checked.push({...item,official:{kind:'identity-mismatch',title}});continue}let av=availability(html),readerId=extractReaderId(html)||Number(item.candidate.readerId)||0;if(av==='conflict'&&readerId)av='mu';let reader=null;if(av==='mu'&&readerId){const rr=await request(SHARE_READER+readerId).catch(()=>null);if(rr){const rh=await rr.text(),rt=pageTitle(rh);reader={title:rt,identity:pageMatchesCandidate(item.candidate,rt),availability:availability(rh),smartLink:`https://marvel.smart.link/fiir7ec77?type=reader&drn=${readerId}`}}checked.push({...item,official:{kind:'exact',title,availability:av,readerId},reader})}catch(e){checked.push({...item,official:{kind:'retryable',reason:e?.message||String(e),httpStatus:Number(e?.httpStatus)||0}})}await sleep(75)}
const exact=checked.filter(x=>x.official?.kind==='exact'),mu=exact.filter(x=>x.official.availability==='mu'),no=exact.filter(x=>x.official.availability==='no-digital'),unknown=exact.filter(x=>!['mu','no-digital'].includes(x.official.availability)),mismatch=checked.filter(x=>x.official?.kind==='identity-mismatch'),retryable=checked.filter(x=>x.official?.kind==='retryable'),badLocal=checked.filter(x=>!exactLocalRemote(x.local,x.candidate));
const report={version:4,generatedAt:new Date().toISOString(),mode:'exact-title-number-date-pilot',writesCache:false,baseline:{localCount:pack.localCount,matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed},catalog:{issues:catalog.length},candidateCoverage:{notListed:targets.length,uniqueCandidate:resolved.length,ambiguous:ambiguous.length,noCandidate:noCandidate.length},pilot:{checked:checked.length,exact:exact.length,mu:mu.length,noDigital:no.length,unknown:unknown.length,identityMismatch:mismatch.length,retryable:retryable.length,badLocalMatch:badLocal.length,readerRouteConfirmed:mu.filter(x=>x.reader?.identity&&x.reader?.availability==='mu').length},examples:{mu:mu.slice(0,30),noDigital:no.slice(0,20),mismatch:mismatch.slice(0,20),ambiguous:ambiguous.slice(0,20)},safety:{cacheWritten:false,targetStatus:STATUS_NOT_LISTED,protectedRows:pack.entries.length-targets.length}};
await fs.writeFile(outFile,JSON.stringify(report,null,2)+'\n');
if(report.pilot.badLocalMatch)throw new Error(`Invariante local rota: ${report.pilot.badLocalMatch}`);
console.log(JSON.stringify({candidateCoverage:report.candidateCoverage,pilot:report.pilot},null,2));console.log(`Informe: ${outFile}`);
