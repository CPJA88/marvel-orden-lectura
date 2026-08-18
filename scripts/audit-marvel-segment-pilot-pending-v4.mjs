import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const atlasFile=path.join(root,'artifacts','marvel-not-listed-v4','segment-atlas-v4.json');
const certFile=path.join(root,'artifacts','marvel-not-listed-v4','segment-certification-pilot-v4.json');
const outFile=path.join(root,'artifacts','marvel-not-listed-v4','segment-pilot-pending-audit-v4.json');
const ISSUE='https://www.marvel.com/comics/issue/';
const SHARE='https://share.marvel.com/sharing/reader/';
const UA='Mozilla/5.0 AppleWebKit/537.36 Chrome/140 Safari/537.36';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const str=v=>v==null?'':String(v);
const norm=v=>str(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
const normSeries=v=>norm(str(v).replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|present))?\s*\)/gi,' ')).replace(/^the\s+/,'').replace(/\s+comics?$/,'').trim();
const normIssue=v=>str(v).trim().toUpperCase().replace(/\s+/g,'');
const decode=v=>str(v).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ');
const plain=v=>decode(str(v).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
function titles(html){const out=[];for(const re of [/<h1\b[^>]*>([\s\S]*?)<\/h1>/ig,/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/ig,/<title[^>]*>([\s\S]*?)<\/title>/ig]){let m;while((m=re.exec(str(html)))){const t=plain(m[1]).replace(/\s*\|\s*Comic Issues\s*\|\s*Marvel.*$/i,'').trim();if(t&&!out.includes(t))out.push(t)}}return out}
function parseTitle(t){const m=decode(t).trim().match(/^(.*?)\s*(?:\(\s*(\d{4})(?:\s*-\s*(?:\d{4}|present))?\s*\))?\s*#\s*([^\s|]+)/i);return m?{series:m[1].trim(),year:Number(m[2]||0),issue:m[3].trim()}:null}
function remoteVolumeStart(name){return Number(str(name).match(/\(\s*((?:19|20)\d{2})/)?.[1]||0)}
function readerId(html){const s=str(html);for(const re of [/sharing\/reader\/(\d+)/i,/sharing\/legacy\/(\d+)/i,/read\.marvel\.com\/#\/book\/(\d+)/i,/["'](?:digitalId|readerId)["']\s*:\s*["']?(\d+)/i,/(?:digitalId|readerId)%22%3A(?:%22)?(\d+)/i]){const m=s.match(re);if(m)return Number(m[1])||0}return 0}
function availability(html){const t=plain(html).toLowerCase(),mu=/members get unlimited access to this issue|this content is available through marvel unlimited|get unlimited access to this issue/.test(t),no=/digital issue (?:is )?not currently available/.test(t);if(mu&&!no)return'mu';if(no&&!mu)return'no-digital';return'unknown'}
function pageDate(html){const raw=str(html),text=plain(html);const rawMatch=raw.match(/["'](?:onSaleDate|onsaleDate|datePublished)["']\s*:\s*["'](\d{4}-\d{2}-\d{2})/i);if(rawMatch)return rawMatch[1];const m=text.match(/\bPublished\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\b/i);if(m){const d=new Date(m[1]);if(!Number.isNaN(d.valueOf()))return d.toISOString().slice(0,10)}return''}
async function get(url,tries=3){let last;for(let i=0;i<tries;i++){try{const r=await fetch(url,{headers:{'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(25000)});if(r.ok||r.status===404||r.status===410)return r;last=new Error(`HTTP ${r.status} ${url}`)}catch(e){last=e}await sleep(450*(i+1))}throw last}
function issueSlugVariants(segment,row){const start=remoteVolumeStart(segment.remoteSeriesName),series=str(segment.remoteSeriesName).replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|present))?\s*\)/gi,' ').trim(),issue=str(row.remoteIssueNumber||row.issueNumber).trim(),base=`${series} ${start||''} ${issue}`.trim().toLowerCase();return[base.replace(/[^a-z0-9-]+/g,'_').replace(/^_+|_+$/g,''),base.replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')].filter((v,i,a)=>v&&a.indexOf(v)===i)}
async function getIssue(sourceId,segment,row){let last=await get(ISSUE+sourceId);if(last.ok)return last;for(const slug of issueSlugVariants(segment,row)){const r=await get(`${ISSUE}${sourceId}/${slug}`);if(r.ok)return r;last=r}return last}
function identity(ts,segment,row,{requireVolumeYear}){const expectedSeries=normSeries(segment.remoteSeriesName),expectedIssue=normIssue(row.remoteIssueNumber||row.issueNumber),expectedYear=remoteVolumeStart(segment.remoteSeriesName);for(const t of ts){const p=parseTitle(t);if(!p)continue;if(normSeries(p.series)!==expectedSeries||normIssue(p.issue)!==expectedIssue)continue;if(requireVolumeYear&&expectedYear&&p.year!==expectedYear)continue;return{ok:true,title:t,parsed:p}}return{ok:false,titles:ts.slice(0,5)}}
async function inspect(segment,row){
  const sourceId=Number(row.sourceId),expectedReaderId=Number(row.readerId),expectedDate=str(row.remoteOnSale).slice(0,10);
  const r=await getIssue(sourceId,segment,row);if(!r||r.status===404||r.status===410)return{kind:'not-found',sourceId,http:r?.status||0};
  const issueUrl=r.url||'',html=await r.text(),ts=titles(html),id=identity(ts,segment,row,{requireVolumeYear:true});if(!id.ok)return{kind:'identity-fail',sourceId,issueUrl,titles:id.titles};
  const officialDate=pageDate(html);if(!officialDate||officialDate!==expectedDate)return{kind:'date-fail',sourceId,issueUrl,expectedDate,officialDate,officialTitle:id.title};
  const av=availability(html),rid=readerId(html);
  if(av==='no-digital')return{kind:'no-digital',sourceId,issueUrl,readerId:rid,officialDate,officialTitle:id.title};
  if(av!=='mu')return{kind:'unknown',sourceId,issueUrl,availability:av,readerId:rid,officialDate,officialTitle:id.title};
  if(!expectedReaderId||rid!==expectedReaderId)return{kind:'reader-id-fail',sourceId,issueUrl,expectedReaderId,readerId:rid,officialDate,officialTitle:id.title};
  const rr=await get(SHARE+rid);if(!rr.ok)return{kind:'reader-http-fail',sourceId,issueUrl,readerId:rid,http:rr.status,officialDate,officialTitle:id.title};
  const rh=await rr.text(),rt=titles(rh),ri=identity(rt,segment,row,{requireVolumeYear:false});if(!ri.ok)return{kind:'reader-identity-fail',sourceId,issueUrl,readerId:rid,titles:ri.titles,officialDate,officialTitle:id.title};
  return{kind:'mu',sourceId,issueUrl,readerId:rid,officialDate,officialTitle:id.title,readerTitle:ri.title,functional:true};
}

const[pack,atlas,cert]=await Promise.all([fs.readFile(cacheFile,'utf8').then(JSON.parse),fs.readFile(atlasFile,'utf8').then(JSON.parse),fs.readFile(certFile,'utf8').then(JSON.parse)]);
if(Number(pack.localCount)!==51002||pack.entries?.length!==51002||Number(pack.matched)!==29155||Number(pack.noDigital)!==1135||Number(pack.notListed)!==20712||Number(pack.functionalLinkMissing)!==0)throw new Error(`Baseline inesperada ${pack.matched}/${pack.noDigital}/${pack.notListed}/${pack.functionalLinkMissing}`);
if(cert?.summary?.certifiedSegments!==2||cert?.summary?.verifiedAnchors!==6||cert?.summary?.certifiedPendingRows!==34)throw new Error('Certificación piloto previa no válida.');
const certifiedIds=new Set(cert.segments.filter(s=>s.certified).map(s=>s.segmentId));
const segments=(atlas.segments||[]).filter(s=>certifiedIds.has(s.segmentId));if(segments.length!==2)throw new Error(`Segmentos certificados reconstruidos=${segments.length}`);
const rows=segments.flatMap(s=>(s.pendingRows||[]).map(r=>({segmentId:s.segmentId,segmentTitle:s.localTitle,remoteSeriesName:s.remoteSeriesName,...r})));
if(rows.length!==34)throw new Error(`Esperaba 34 pendientes, obtuvo ${rows.length}`);
const cacheById=new Map(pack.entries.map(r=>[Number(r[0]),r])),terminalOwners=new Map();for(const r of pack.entries){const sid=Number(r[1])||0;if(!sid||![1,3,5].includes(Number(r[3])))continue;const a=terminalOwners.get(sid)||[];a.push(Number(r[0]));terminalOwners.set(sid,a)}
const results=[];
for(const [i,row] of rows.entries()){
  const cache=cacheById.get(Number(row.gcdId));if(!cache||Number(cache[3])!==4)throw new Error(`Pendiente ${row.gcdId} dejó status4`);
  const owners=(terminalOwners.get(Number(row.sourceId))||[]).filter(id=>id!==Number(row.gcdId));if(owners.length){results.push({...row,kind:'source-collision',collisionOwners:owners});continue}
  const segment=segments.find(s=>s.segmentId===row.segmentId);
  const inspected=await inspect(segment,row).catch(e=>({kind:'exception',error:e?.message||String(e)}));results.push({...row,...inspected});
  if((i+1)%10===0)console.log(`Pilot pending ${i+1}/34`);await sleep(90);
}
const summary={targets:34,mu:results.filter(r=>r.kind==='mu').length,noDigital:results.filter(r=>r.kind==='no-digital').length,identityFail:results.filter(r=>r.kind==='identity-fail').length,dateFail:results.filter(r=>r.kind==='date-fail').length,readerFail:results.filter(r=>/^reader-/.test(r.kind)).length,unknown:results.filter(r=>r.kind==='unknown').length,notFound:results.filter(r=>r.kind==='not-found').length,sourceCollision:results.filter(r=>r.kind==='source-collision').length,exception:results.filter(r=>r.kind==='exception').length,verified:results.filter(r=>['mu','no-digital'].includes(r.kind)).length,writesCache:false};
const report={version:4,generatedAt:new Date().toISOString(),mode:'segment-pilot-pending-audit-v4',writesCache:false,baseline:{matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed,functionalLinkMissing:pack.functionalLinkMissing},certifiedSegments:[...certifiedIds],safety:{cacheWritten:false,publishAllowed:false,segmentCertificationRequired:true,status4Required:true,sourceCollisionProtection:true,exactIssueIdentity:true,exactVolumeStartYear:true,exactOfficialCatalogDate:true,muRequiresExactReaderIdAndIdentity:true,noDigitalRequiresOfficialExplicitSignal:true,slugFallbackForLegacyIssueRoutes:true},summary,results};
await fs.mkdir(path.dirname(outFile),{recursive:true});await fs.writeFile(outFile,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
