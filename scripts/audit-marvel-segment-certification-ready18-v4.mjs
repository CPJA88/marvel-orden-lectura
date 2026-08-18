import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const atlasFile=path.join(root,'artifacts','marvel-not-listed-v4','segment-atlas-v4.json');
const outFile=path.join(root,'artifacts','marvel-not-listed-v4','segment-certification-ready18-v4.json');
const SHARE_LEGACY='https://share.marvel.com/sharing/legacy/';
const SHARE_DRN='https://share.marvel.com/sharing/issue/';
const SMART='https://marvel.smart.link/fiir7ec77';
const DRN_RE=/^drn:src:marvel:unison::prod:[0-9a-f-]{36}$/i;
const PILOT=new Set(['5546|new x men 2004 2008','499|astonishing tales 1970']);
const READY_STRATEGIES=new Set(['certification-ready','certification-ready-small','audited-anchor-ready']);
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const str=v=>v==null?'':String(v);
const decode=v=>str(v).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ');
const transport=v=>decode(str(v)).replace(/\\u003A/gi,':').replace(/\\u002F/gi,'/').replace(/\\\//g,'/').replace(/%3A/gi,':').replace(/%2F/gi,'/');
const plain=v=>decode(str(v).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
function extractDrn(html){const s=transport(html);let explicit=s.match(/(?:[?&]|\b)drn=([^&"'<>\s]+)/i)?.[1]||'';if(explicit){try{explicit=decodeURIComponent(explicit)}catch{}const m=explicit.match(DRN_RE);if(m)return m[0].toLowerCase()}return(s.match(DRN_RE)?.[0]||'').toLowerCase()}
function landingSignal(html){const t=plain(html).toLowerCase();return{unlimited:/this content is available through marvel unlimited/.test(t),openButton:/open in marvel unlimited/.test(t)}}
function buildSmartLink(drn,sourceId){const u=new URL(SMART);u.searchParams.set('type','issue');u.searchParams.set('drn',drn);u.searchParams.set('sourceId',String(sourceId));return u.toString()}
async function get(url,{tries=3,redirect='follow'}={}){let last;for(let i=0;i<tries;i++){try{const r=await fetch(url,{redirect,headers:{'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(25000)});if(r.ok||r.status===404||r.status===410||(redirect==='manual'&&r.status>=300&&r.status<400))return r;last=new Error(`HTTP ${r.status} ${url}`)}catch(e){last=e}await sleep(300*(i+1))}throw last}
async function verifySmart(url){try{const r=await get(url,{tries:2,redirect:'manual'});return{ok:r.status>=200&&r.status<400&&r.status!==404,status:r.status,location:r.headers.get('location')||''}}catch(e){return{ok:false,status:0,error:e?.message||String(e)}}}
async function inspectAnchor(segment,anchor,cacheRow){
  const gcdId=Number(anchor.gcdId),sourceId=Number(anchor.sourceId),readerId=Number(anchor.readerId),status=Number(cacheRow[3]),storedDrn=str(cacheRow[5]).toLowerCase();
  if(!gcdId||!sourceId||!readerId)return{ok:false,gcdId,sourceId,readerId,reason:'missing-identifiers'};
  let lr;try{lr=await get(SHARE_LEGACY+readerId,{tries:3})}catch(e){return{ok:false,gcdId,sourceId,readerId,reason:'legacy-exception',error:e?.message||String(e)}}
  if(!lr.ok)return{ok:false,gcdId,sourceId,readerId,reason:`legacy-http-${lr.status}`};
  const drn=extractDrn(await lr.text());if(!DRN_RE.test(drn))return{ok:false,gcdId,sourceId,readerId,reason:'drn-missing'};
  if(status===1&&(!DRN_RE.test(storedDrn)||storedDrn!==drn))return{ok:false,gcdId,sourceId,readerId,reason:'stored-drn-mismatch',storedDrn,drn};
  let landing;const landingUrl=SHARE_DRN+encodeURIComponent(drn);try{landing=await get(landingUrl,{tries:3})}catch(e){return{ok:false,gcdId,sourceId,readerId,drn,reason:'landing-exception',error:e?.message||String(e)}}
  if(!landing.ok)return{ok:false,gcdId,sourceId,readerId,drn,reason:`landing-http-${landing.status}`};
  const signal=landingSignal(await landing.text());if(!signal.unlimited||!signal.openButton)return{ok:false,gcdId,sourceId,readerId,drn,reason:'landing-missing-unlimited-button',signal};
  const smartLink=buildSmartLink(drn,sourceId),smart=await verifySmart(smartLink);if(!smart.ok)return{ok:false,gcdId,sourceId,readerId,drn,reason:'smartlink-fail',smart};
  return{ok:true,gcdId,sourceId,readerId,status,drn,issueNumber:str(anchor.issueNumber),date:str(anchor.date),remoteIssueNumber:str(anchor.remoteIssueNumber),remoteOnSale:str(anchor.remoteOnSale),landingUnlimited:true,landingOpenButton:true,smartStatus:smart.status,smartLocation:smart.location};
}

const[pack,atlas]=await Promise.all([fs.readFile(cacheFile,'utf8').then(JSON.parse),fs.readFile(atlasFile,'utf8').then(JSON.parse)]);
if(Number(pack.localCount)!==51002||pack.entries?.length!==51002||Number(pack.matched)!==29189||Number(pack.noDigital)!==1135||Number(pack.notListed)!==20678||Number(pack.functionalLinkMissing)!==0)throw new Error(`Baseline inesperada ${pack.localCount}/${pack.matched}/${pack.noDigital}/${pack.notListed}/${pack.functionalLinkMissing}`);
if(atlas?.mode!=='segment-atlas-v4'||Number(atlas?.totals?.safeUniqueCatalogCandidates)!==2017)throw new Error('Atlas de segmentos incompatible.');
const readyQueue=(atlas.topCertificationQueue||[]).filter(s=>READY_STRATEGIES.has(s.strategy));
if(readyQueue.length!==20)throw new Error(`Cola ready cambió: ${readyQueue.length}, esperada=20.`);
const targetIds=new Set(readyQueue.map(s=>s.segmentId).filter(id=>!PILOT.has(id)));
if(targetIds.size!==18)throw new Error(`Objetivo ready restante=${targetIds.size}, esperado=18.`);
const fullById=new Map((atlas.segments||[]).map(s=>[s.segmentId,s]));
const cacheById=new Map(pack.entries.map(r=>[Number(r[0]),r]));
const segments=[];let targetAnchors=0;
for(const ready of readyQueue.filter(s=>targetIds.has(s.segmentId))){
  const segment=fullById.get(ready.segmentId);if(!segment)throw new Error(`Segmento ausente ${ready.segmentId}`);
  const anchors=segment.historicalAnchorCandidates||[];if(anchors.length<2||anchors.length>3)throw new Error(`Segmento ${segment.segmentId} tiene ${anchors.length} anclas, esperaba 2-3.`);
  if(new Set(anchors.map(a=>Number(a.gcdId))).size!==anchors.length)throw new Error(`Anclas duplicadas ${segment.segmentId}`);
  const pendingRows=(segment.pendingRows||[]).filter(r=>Number(cacheById.get(Number(r.gcdId))?.[3])===4);
  if(pendingRows.length!==Number(segment.pendingUniqueCount))throw new Error(`Pendientes cambiaron en ${segment.segmentId}: ${pendingRows.length}/${segment.pendingUniqueCount}`);
  const checked=[];targetAnchors+=anchors.length;
  for(const anchor of anchors){
    const row=cacheById.get(Number(anchor.gcdId));
    if(!row||![1,5].includes(Number(row[3]))||Number(row[1])!==Number(anchor.sourceId)||Number(row[2])!==Number(anchor.readerId))throw new Error(`Ancla histórica inconsistente ${anchor.gcdId} en ${segment.segmentId}`);
    checked.push(await inspectAnchor(segment,anchor,row).catch(e=>({ok:false,gcdId:Number(anchor.gcdId),sourceId:Number(anchor.sourceId),readerId:Number(anchor.readerId),reason:'exception',error:e?.message||String(e)})));
    await sleep(80);
  }
  const certified=checked.every(a=>a.ok);
  segments.push({segmentId:segment.segmentId,localSeriesId:segment.localSeriesId,localTitle:segment.localTitle,remoteSeriesName:segment.remoteSeriesName,strategy:segment.strategy,pendingUniqueCount:segment.pendingUniqueCount,anchorCount:anchors.length,certified,anchors:checked});
  console.log(`${segment.localTitle} -> ${segment.remoteSeriesName}: ${certified?'CERTIFIED':'FAILED'} (${checked.filter(a=>a.ok).length}/${checked.length})`);
}
const flat=segments.flatMap(s=>s.anchors),summary={targetSegments:18,targetAnchors,certifiedSegments:segments.filter(s=>s.certified).length,failedSegments:segments.filter(s=>!s.certified).length,verifiedAnchors:flat.filter(a=>a.ok).length,failedAnchors:flat.filter(a=>!a.ok).length,certifiedPendingRows:segments.filter(s=>s.certified).reduce((n,s)=>n+Number(s.pendingUniqueCount||0),0),uncertifiedPendingRows:segments.filter(s=>!s.certified).reduce((n,s)=>n+Number(s.pendingUniqueCount||0),0),writesCache:false};
const report={version:4,generatedAt:new Date().toISOString(),mode:'segment-certification-ready18-v4',writesCache:false,baseline:{localCount:pack.localCount,matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed,functionalLinkMissing:pack.functionalLinkMissing},safety:{cacheWritten:false,publishAllowed:false,exactReadyQueueRequired:true,pilotSegmentsExcluded:true,twoOrThreeHistoricalAnchorsRequired:true,cacheSourceAndReaderMustMatchAtlas:true,status1StoredDrnMustMatchOfficialLegacyDrn:true,officialDrnLandingMustConfirmUnlimited:true,officialDrnLandingMustExposeOpenButton:true,functionalSmartLinkRequired:true,allAvailableAnchorsMustPass:true},summary,segments};
await fs.mkdir(path.dirname(outFile),{recursive:true});await fs.writeFile(outFile,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
