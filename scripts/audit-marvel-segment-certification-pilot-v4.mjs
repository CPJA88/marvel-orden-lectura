import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const atlasFile=path.join(root,'artifacts','marvel-not-listed-v4','segment-atlas-v4.json');
const outFile=path.join(root,'artifacts','marvel-not-listed-v4','segment-certification-pilot-v4.json');
const ISSUE='https://www.marvel.com/comics/issue/';
const SHARE='https://share.marvel.com/sharing/reader/';
const UA='Mozilla/5.0 AppleWebKit/537.36 Chrome/140 Safari/537.36';
const TARGET_SEGMENTS=new Set(['5546|new x men 2004 2008','499|astonishing tales 1970']);
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
function pageDate(html){const s=str(html);for(const re of [/["'](?:onSaleDate|onsaleDate|datePublished)["']\s*:\s*["'](\d{4}-\d{2}-\d{2})/i,/Published:\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i]){const m=s.match(re);if(m){const d=new Date(m[1]);if(!Number.isNaN(d.valueOf()))return d.toISOString().slice(0,10)}}return''}
async function get(url,tries=3){let last;for(let i=0;i<tries;i++){try{const r=await fetch(url,{headers:{'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(25000)});if(r.ok||r.status===404||r.status===410)return r;last=new Error(`HTTP ${r.status} ${url}`)}catch(e){last=e}await sleep(450*(i+1))}throw last}
function identityFromTitles(ts,segment,anchor,{requireVolumeYear}){const expectedSeries=normSeries(segment.remoteSeriesName),expectedIssue=normIssue(anchor.remoteIssueNumber||anchor.issueNumber),expectedYear=remoteVolumeStart(segment.remoteSeriesName);for(const t of ts){const p=parseTitle(t);if(!p)continue;if(normSeries(p.series)!==expectedSeries)continue;if(normIssue(p.issue)!==expectedIssue)continue;if(requireVolumeYear&&expectedYear&&p.year!==expectedYear)continue;return{ok:true,title:t,parsed:p}}return{ok:false,titles:ts.slice(0,5)}}
async function inspectAnchor(segment,anchor){
  const sourceId=Number(anchor.sourceId),expectedReaderId=Number(anchor.readerId),expectedDate=str(anchor.remoteOnSale).slice(0,10);
  const r=await get(ISSUE+sourceId);
  if(r.status===404||r.status===410)return{ok:false,sourceId,reason:`issue-http-${r.status}`};
  const html=await r.text(),ts=titles(html),identity=identityFromTitles(ts,segment,anchor,{requireVolumeYear:true});
  if(!identity.ok)return{ok:false,sourceId,reason:'issue-identity',titles:identity.titles};
  const officialDate=pageDate(html);
  if(!officialDate||officialDate!==expectedDate)return{ok:false,sourceId,reason:'official-date',expectedDate,officialDate};
  const av=availability(html);
  if(av!=='mu')return{ok:false,sourceId,reason:'availability',availability:av};
  const rid=readerId(html);
  if(!rid||rid!==expectedReaderId)return{ok:false,sourceId,reason:'reader-id',expectedReaderId,readerId:rid};
  const rr=await get(SHARE+rid);
  if(!rr.ok)return{ok:false,sourceId,reason:`reader-http-${rr.status}`,readerId:rid};
  const rh=await rr.text(),rt=titles(rh),readerIdentity=identityFromTitles(rt,segment,anchor,{requireVolumeYear:false});
  if(!readerIdentity.ok)return{ok:false,sourceId,reason:'reader-identity',readerId:rid,titles:readerIdentity.titles};
  return{ok:true,gcdId:Number(anchor.gcdId),sourceId,readerId:rid,issueNumber:str(anchor.issueNumber),remoteIssueNumber:str(anchor.remoteIssueNumber),localDate:str(anchor.date),officialDate,availability:av,officialTitle:identity.title,readerTitle:readerIdentity.title};
}

const[pack,atlas]=await Promise.all([fs.readFile(cacheFile,'utf8').then(JSON.parse),fs.readFile(atlasFile,'utf8').then(JSON.parse)]);
if(Number(pack.localCount)!==51002||pack.entries?.length!==51002||Number(pack.matched)!==29155||Number(pack.noDigital)!==1135||Number(pack.notListed)!==20712||Number(pack.functionalLinkMissing)!==0)throw new Error(`Baseline inesperada ${pack.localCount}/${pack.matched}/${pack.noDigital}/${pack.notListed}/${pack.functionalLinkMissing}`);
if(atlas?.mode!=='segment-atlas-v4'||Number(atlas?.totals?.safeUniqueCatalogCandidates)!==2017)throw new Error('Atlas de segmentos incompatible.');
const targets=(atlas.topCertificationQueue||[]).filter(s=>TARGET_SEGMENTS.has(s.segmentId));
if(targets.length!==2||targets.some(s=>(s.historicalAnchorCandidates||[]).length!==3))throw new Error(`Piloto inválido: ${targets.length} segmentos.`);
const cacheById=new Map(pack.entries.map(r=>[Number(r[0]),r]));
const segments=[];
for(const segment of targets){
  const anchors=[];
  for(const anchor of segment.historicalAnchorCandidates){
    const row=cacheById.get(Number(anchor.gcdId));
    if(!row||![1,5].includes(Number(row[3]))||Number(row[1])!==Number(anchor.sourceId))throw new Error(`Ancla histórica inconsistente ${anchor.gcdId}`);
    const result=await inspectAnchor(segment,anchor).catch(e=>({ok:false,gcdId:Number(anchor.gcdId),sourceId:Number(anchor.sourceId),reason:'exception',error:e?.message||String(e)}));
    anchors.push(result);await sleep(120);
  }
  const certified=anchors.length===3&&anchors.every(a=>a.ok);
  segments.push({segmentId:segment.segmentId,localSeriesId:segment.localSeriesId,localTitle:segment.localTitle,remoteSeriesName:segment.remoteSeriesName,pendingUniqueCount:segment.pendingUniqueCount,certified,anchors});
}
const summary={targetSegments:2,targetAnchors:6,certifiedSegments:segments.filter(s=>s.certified).length,verifiedAnchors:segments.flatMap(s=>s.anchors).filter(a=>a.ok).length,failedAnchors:segments.flatMap(s=>s.anchors).filter(a=>!a.ok).length,certifiedPendingRows:segments.filter(s=>s.certified).reduce((n,s)=>n+Number(s.pendingUniqueCount||0),0),writesCache:false};
const report={version:4,generatedAt:new Date().toISOString(),mode:'segment-certification-pilot-v4',writesCache:false,baseline:{localCount:pack.localCount,matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed,functionalLinkMissing:pack.functionalLinkMissing},safety:{cacheWritten:false,publishAllowed:false,allThreeAnchorsRequiredPerSegment:true,exactSourceIdRequired:true,exactIssueIdentityRequired:true,exactRemoteVolumeStartYearRequired:true,exactOfficialCatalogDateRequired:true,exactReaderIdRequired:true,readerIdentityRequired:true},summary,segments};
await fs.mkdir(path.dirname(outFile),{recursive:true});await fs.writeFile(outFile,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
