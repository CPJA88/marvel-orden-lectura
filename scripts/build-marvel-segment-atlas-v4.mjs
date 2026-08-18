import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import extract from 'extract-zip';

const root=process.cwd();
const archive=path.join(root,'Marvel_Orden_de_Lectura_PWA.zip');
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const catalogFile=path.join(root,'.cache','marvel-global-catalog-v4.json');
const aliasFile=path.join(root,'artifacts','marvel-not-listed-v4','alias-dictionary-v4.json');
const globalAtlasFile=path.join(root,'artifacts','marvel-not-listed-v4','global-series-atlas-v4.json');
const artifactDir=path.join(root,'artifacts','marvel-not-listed-v4');
const outFile=path.join(artifactDir,'segment-atlas-v4.json');
const STATUS={MU:1,NO_DIGITAL:3,NOT_LISTED:4,MU_LINK_MISSING:5};
const str=v=>v==null?'':String(v);
const norm=v=>str(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
const normSeries=v=>norm(str(v).replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|present))?\s*\)/gi,' ')).replace(/^the\s+/,'').replace(/\s+comics?$/,'').trim();
const normIssue=v=>{let s=str(v).trim().toUpperCase().replace(/\s+/g,'');if(/^0+\d+$/.test(s))s=String(Number(s));return s};
const yearOf=v=>Number(str(v).match(/\b((?:19|20)\d{2})\b/)?.[1]||0);
const pct=(n,d)=>d?Math.round(n*10000/d)/100:0;
function issueVariants(raw){const out=new Set([normIssue(raw)]),s=str(raw).trim();const legacy=s.match(/^(.+?)\s*\(\d+\)\s*$/);if(legacy)out.add(normIssue(legacy[1]));const suffix=s.match(/^(\d+)\.[A-Z]+$/i);if(suffix)out.add(normIssue(suffix[1]));return[...out].filter(Boolean)}
function issueShape(raw){const s=str(raw).trim();if(/^0+$/.test(s))return'zero';if(/^-\d+$/.test(s))return'negative';if(/^.+\(\d+\)$/.test(s))return'legacy-parenthetical';if(/^\d+\.[A-Z]+$/i.test(s))return'suffix';if(/^\d+\.\d+$/.test(s))return'decimal';if(/^\d+$/.test(s))return'numeric';return'special'}
function remoteVolume(seriesName){const m=str(seriesName).match(/\(\s*((?:19|20)\d{2})(?:\s*-\s*((?:19|20)\d{2}|Present))?\s*\)/i);return m?{startYear:Number(m[1]),endYear:/present/i.test(m[2]||'')?null:Number(m[2]||m[1]),label:m[0].slice(1,-1)}:{startYear:0,endYear:null,label:''}}
function spreadSample(rows,n=3){if(!rows.length)return[];const sorted=[...rows].sort((a,b)=>str(a.date).localeCompare(str(b.date))||String(a.issueNumber).localeCompare(String(b.issueNumber),undefined,{numeric:true}));if(sorted.length<=n)return sorted;const idx=new Set([0,sorted.length-1]);while(idx.size<n){const pos=Math.round((idx.size)*(sorted.length-1)/(n-1));idx.add(Math.min(sorted.length-1,pos))}return[...idx].sort((a,b)=>a-b).map(i=>sorted[i])}

async function loadLocal(){
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'marvel-segment-atlas-v4-'));
  try{
    await extract(archive,{dir:tmp});
    const data=path.join(tmp,'data');
    const[meta,series]=await Promise.all([
      fs.readFile(path.join(data,'meta.json'),'utf8').then(JSON.parse),
      fs.readFile(path.join(data,'series.json'),'utf8').then(JSON.parse),
    ]);
    const sm=new Map(series.map(s=>[Number(s.id),s])),byId=new Map();
    for(const c of meta.chunks||[])for(const x of JSON.parse(await fs.readFile(path.join(data,c.file),'utf8'))){
      const s=sm.get(Number(x.s))||{};
      byId.set(Number(x.id),{gcdId:Number(x.id),seriesId:Number(x.s),title:s.original||s.es||'',issueNumber:str(x.n),date:str(x.sv||x.d),seriesYear:str(x.a||s.year||s.y)});
    }
    return byId;
  } finally { await fs.rm(tmp,{recursive:true,force:true}); }
}
function recursivePublishedIds(value,key='',out=new Set()){
  if(Array.isArray(value)){
    if(/published|promoted/i.test(key))for(const x of value){const id=Number(typeof x==='object'&&x?x.gcdId:x);if(id)out.add(id)}
    for(const x of value)if(x&&typeof x==='object')recursivePublishedIds(x,key,out);
  } else if(value&&typeof value==='object'){
    for(const[k,v]of Object.entries(value)){
      if(k==='published'&&Array.isArray(v))for(const x of v){const id=Number(typeof x==='object'&&x?x.gcdId:x);if(id)out.add(id)}
      recursivePublishedIds(v,k,out);
    }
  }
  return out;
}
async function loadAuditedPublishedIds(){
  const ids=new Set(),sources=new Map();
  for(const name of await fs.readdir(artifactDir)){
    if(!/publish-summary.*\.json$|published.*summary.*\.json$/i.test(name))continue;
    try{
      const json=JSON.parse(await fs.readFile(path.join(artifactDir,name),'utf8')),found=recursivePublishedIds(json);
      for(const id of found){ids.add(id);const a=sources.get(id)||[];a.push(name);sources.set(id,a)}
    }catch{}
  }
  return{ids,sources};
}
function chooseCandidates(candidates,localDate,terminalOwners,gcdId){
  const withCollision=candidates.map(c=>({...c,collisionOwners:(terminalOwners.get(Number(c.sourceId)||0)||[]).filter(id=>id!==gcdId)}));
  let clean=withCollision.filter(c=>Number(c.sourceId)&&!c.collisionOwners.length);
  if(clean.length>1){const exact=clean.filter(c=>str(c.onSale).slice(0,10)===str(localDate).slice(0,10));if(exact.length===1)clean=exact}
  if(clean.length===1)return{kind:'unique',candidate:clean[0]};
  if(clean.length>1)return{kind:'ambiguous',candidates:clean.slice(0,8)};
  if(withCollision.some(c=>c.collisionOwners.length))return{kind:'collision',candidates:withCollision.filter(c=>c.collisionOwners.length).slice(0,8)};
  return{kind:'none'};
}

const[pack,catalogPack,globalAtlas,localById,audited]=await Promise.all([
  fs.readFile(cacheFile,'utf8').then(JSON.parse),
  fs.readFile(catalogFile,'utf8').then(JSON.parse),
  fs.readFile(globalAtlasFile,'utf8').then(JSON.parse),
  loadLocal(),
  loadAuditedPublishedIds(),
]);
if(Number(pack.localCount)!==51002||pack.entries?.length!==51002||Number(pack.matched)!==29155||Number(pack.noDigital)!==1135||Number(pack.notListed)!==20712||Number(pack.functionalLinkMissing)!==0)throw new Error(`Baseline inesperada ${pack.localCount}/${pack.matched}/${pack.noDigital}/${pack.notListed}/${pack.functionalLinkMissing}`);
if(globalAtlas?.mode!=='global-series-atlas-v4'||globalAtlas?.writesCache!==false||Number(globalAtlas?.totals?.pendingRows)!==20712||Number(globalAtlas?.totals?.uniqueCatalogPotentialRows)!==2055)throw new Error('Atlas Global previo incompatible.');
if(!Array.isArray(catalogPack?.issues)||catalogPack.issues.length<30000)throw new Error('Catálogo global V4 ausente o incompleto.');
let aliasPack={aliases:[]};try{aliasPack=JSON.parse(await fs.readFile(aliasFile,'utf8'))}catch{}
const aliasByLocal=new Map((aliasPack.aliases||[]).map(a=>[a.localNorm,a])),cacheById=new Map(pack.entries.map(r=>[Number(r[0]),r])),terminalOwners=new Map();
for(const r of pack.entries){const sid=Number(r[1])||0;if(!sid||![STATUS.MU,STATUS.NO_DIGITAL,STATUS.MU_LINK_MISSING].includes(Number(r[3])))continue;const a=terminalOwners.get(sid)||[];a.push(Number(r[0]));terminalOwners.set(sid,a)}
const catalogIndex=new Map(),catalogBySource=new Map();
for(const c of catalogPack.issues||[]){
  const item={sourceId:Number(c.sourceId)||0,readerId:Number(c.readerId)||0,seriesName:str(c.seriesName),issueNumber:str(c.issueNumber),onSale:str(c.onSale),yearPage:Number(c.yearPage)||0};
  const series=normSeries(item.seriesName),issue=normIssue(item.issueNumber);
  if(series&&issue){const k=`${series}|${issue}`,a=catalogIndex.get(k)||[];a.push(item);catalogIndex.set(k,a)}
  if(item.sourceId){const a=catalogBySource.get(item.sourceId)||[];a.push(item);catalogBySource.set(item.sourceId,a)}
}
function catalogLookup(local,remoteNorm){
  const ly=yearOf(local.date)||yearOf(local.seriesYear),all=[];
  for(const issue of issueVariants(local.issueNumber))for(const c of catalogIndex.get(`${remoteNorm}|${issue}`)||[]){const cy=yearOf(c.onSale)||Number(c.yearPage)||0;if(ly&&cy&&Math.abs(ly-cy)>1)continue;all.push(c)}
  const uniq=[...new Map(all.map(c=>[Number(c.sourceId),c])).values()];
  return chooseCandidates(uniq,local.date,terminalOwners,local.gcdId);
}
function uniqueCatalogIdentityForSource(sourceId){
  const rows=catalogBySource.get(Number(sourceId)||0)||[];
  const identities=new Map();
  for(const c of rows){const k=`${norm(c.seriesName)}|${normIssue(c.issueNumber)}|${str(c.onSale).slice(0,10)}`;if(!identities.has(k))identities.set(k,c)}
  return identities.size===1?[...identities.values()][0]:null;
}

const uniqueRows=[];
for(const local of localById.values()){
  const cache=cacheById.get(local.gcdId);if(!cache||Number(cache[3])!==STATUS.NOT_LISTED)continue;
  let result=catalogLookup(local,normSeries(local.title)),mode='exact-title';
  if(result.kind==='none'){
    const alias=aliasByLocal.get(normSeries(local.title));
    if(alias){const alt=catalogLookup(local,alias.remoteNorm);if(alt.kind!=='none'){result=alt;mode='trusted-alias'}}
  }
  if(result.kind!=='unique')continue;
  uniqueRows.push({gcdId:local.gcdId,localSeriesId:local.seriesId,localTitle:local.title,localSeriesYear:local.seriesYear,issueNumber:local.issueNumber,issueShape:issueShape(local.issueNumber),date:local.date,catalogMode:mode,candidate:{sourceId:Number(result.candidate.sourceId),readerId:Number(result.candidate.readerId)||0,seriesName:result.candidate.seriesName,issueNumber:result.candidate.issueNumber,onSale:result.candidate.onSale}});
}
if(uniqueRows.length!==2055)throw new Error(`Candidatos únicos reconstruidos=${uniqueRows.length}, esperados=2055.`);

const sourceToPending=new Map();
for(const row of uniqueRows){const a=sourceToPending.get(row.candidate.sourceId)||[];a.push(row.gcdId);sourceToPending.set(row.candidate.sourceId,a)}
const duplicateSourceGroups=[...sourceToPending.entries()].filter(([,ids])=>ids.length>1).map(([sourceId,gcdIds])=>({sourceId,gcdIds:[...gcdIds].sort((a,b)=>a-b)})).sort((a,b)=>b.gcdIds.length-a.gcdIds.length||a.sourceId-b.sourceId);
const duplicateSourceIds=new Set(duplicateSourceGroups.map(x=>x.sourceId));
for(const row of uniqueRows)row.crossPendingSourceCollision=duplicateSourceIds.has(row.candidate.sourceId);
const safeRows=uniqueRows.filter(r=>!r.crossPendingSourceCollision);

const historicalBySegment=new Map();
for(const local of localById.values()){
  const cache=cacheById.get(local.gcdId);if(!cache||![STATUS.MU,STATUS.MU_LINK_MISSING].includes(Number(cache[3])))continue;
  const sourceId=Number(cache[1])||0,cat=uniqueCatalogIdentityForSource(sourceId);if(!cat)continue;
  const key=`${local.seriesId}|${norm(cat.seriesName)}`;
  const a=historicalBySegment.get(key)||[];
  a.push({gcdId:local.gcdId,sourceId,readerId:Number(cache[2])||0,status:Number(cache[3]),localTitle:local.title,issueNumber:local.issueNumber,date:local.date,remoteSeriesName:cat.seriesName,remoteIssueNumber:cat.issueNumber,remoteOnSale:cat.onSale,auditedPublished:audited.ids.has(local.gcdId),auditFiles:audited.sources.get(local.gcdId)||[]});
  historicalBySegment.set(key,a);
}

const segmentsMap=new Map();
for(const row of safeRows){
  const remoteNorm=norm(row.candidate.seriesName),key=`${row.localSeriesId}|${remoteNorm}`;
  let g=segmentsMap.get(key);
  if(!g){g={segmentId:key,localSeriesId:row.localSeriesId,localTitle:row.localTitle,localSeriesYear:row.localSeriesYear,remoteSeriesName:row.candidate.seriesName,remoteNorm,remoteVolume:remoteVolume(row.candidate.seriesName),rows:[],issueShapes:new Map(),years:new Map()};segmentsMap.set(key,g)}
  g.rows.push(row);g.issueShapes.set(row.issueShape,(g.issueShapes.get(row.issueShape)||0)+1);const y=yearOf(row.date)||yearOf(row.localSeriesYear)||0;g.years.set(y,(g.years.get(y)||0)+1);
}
const remoteCountByLocal=new Map();
for(const g of segmentsMap.values()){const a=remoteCountByLocal.get(g.localSeriesId)||new Set();a.add(g.remoteNorm);remoteCountByLocal.set(g.localSeriesId,a)}

const segments=[];
for(const g of segmentsMap.values()){
  const hist=historicalBySegment.get(`${g.localSeriesId}|${g.remoteNorm}`)||[];
  const auditedHist=hist.filter(x=>x.auditedPublished),weird=g.rows.filter(x=>x.issueShape!=='numeric').length;
  const candidateSpan={localStart:[...g.rows].sort((a,b)=>str(a.date).localeCompare(str(b.date)))[0]?.date||'',localEnd:[...g.rows].sort((a,b)=>str(b.date).localeCompare(str(a.date)))[0]?.date||'',remoteStart:[...g.rows].sort((a,b)=>str(a.candidate.onSale).localeCompare(str(b.candidate.onSale)))[0]?.candidate.onSale||'',remoteEnd:[...g.rows].sort((a,b)=>str(b.candidate.onSale).localeCompare(str(a.candidate.onSale)))[0]?.candidate.onSale||''};
  const historicalSamples=spreadSample(hist,3).map(x=>({gcdId:x.gcdId,sourceId:x.sourceId,readerId:x.readerId,issueNumber:x.issueNumber,date:x.date,remoteIssueNumber:x.remoteIssueNumber,remoteOnSale:x.remoteOnSale,auditedPublished:x.auditedPublished,auditFiles:x.auditFiles}));
  const pendingSamples=spreadSample(g.rows,3).map(x=>({gcdId:x.gcdId,issueNumber:x.issueNumber,date:x.date,sourceId:x.candidate.sourceId,readerId:x.candidate.readerId,remoteIssueNumber:x.candidate.issueNumber,remoteOnSale:x.candidate.onSale}));
  let strategy='candidate-only';
  if(hist.length>=2&&g.rows.length>=3)strategy='certification-ready';
  else if(hist.length>=2)strategy='certification-ready-small';
  if(weird/g.rows.length>=0.35)strategy='special-numbering-segment';
  if(auditedHist.length>=2)strategy='audited-anchor-ready';
  const priorityScore=Math.round((g.rows.length*5+Math.min(hist.length,25)*2+auditedHist.length*8-weird)*10)/10;
  segments.push({segmentId:g.segmentId,localSeriesId:g.localSeriesId,localTitle:g.localTitle,localSeriesYear:g.localSeriesYear,remoteSeriesName:g.remoteSeriesName,remoteVolume:g.remoteVolume,pendingUniqueCount:g.rows.length,historicalSameRemoteMU:hist.length,auditedPublishedSameRemote:auditedHist.length,localSeriesRemoteSegmentCount:remoteCountByLocal.get(g.localSeriesId)?.size||1,mixedLocalSeries:(remoteCountByLocal.get(g.localSeriesId)?.size||1)>1,weirdNumberingCount:weird,weirdRatePct:pct(weird,g.rows.length),issueShapes:Object.fromEntries([...g.issueShapes.entries()].sort()),candidateYears:Object.fromEntries([...g.years.entries()].sort((a,b)=>a[0]-b[0])),candidateSpan,strategy,priorityScore,historicalAnchorCandidates:historicalSamples,pendingVerificationSamples:pendingSamples,pendingRows:g.rows.map(x=>({gcdId:x.gcdId,issueNumber:x.issueNumber,date:x.date,sourceId:x.candidate.sourceId,readerId:x.candidate.readerId,remoteIssueNumber:x.candidate.issueNumber,remoteOnSale:x.candidate.onSale,catalogMode:x.catalogMode}))});
}
segments.sort((a,b)=>b.priorityScore-a.priorityScore||b.pendingUniqueCount-a.pendingUniqueCount||a.localTitle.localeCompare(b.localTitle)||a.remoteSeriesName.localeCompare(b.remoteSeriesName));

const localSeriesSummary=[];
for(const [seriesId,set] of remoteCountByLocal){const ss=segments.filter(s=>s.localSeriesId===seriesId),pendingUnique=ss.reduce((n,s)=>n+s.pendingUniqueCount,0),historical=ss.reduce((n,s)=>n+s.historicalSameRemoteMU,0);localSeriesSummary.push({seriesId,title:ss[0]?.localTitle||'',seriesYear:ss[0]?.localSeriesYear||'',remoteSegments:set.size,pendingUnique,historicalSameRemoteMU:historical,segments:ss.map(s=>({segmentId:s.segmentId,remoteSeriesName:s.remoteSeriesName,pendingUniqueCount:s.pendingUniqueCount,historicalSameRemoteMU:s.historicalSameRemoteMU,strategy:s.strategy}))})}
localSeriesSummary.sort((a,b)=>b.pendingUnique-a.pendingUnique||b.remoteSegments-a.remoteSegments||a.title.localeCompare(b.title));
const ready=segments.filter(s=>['certification-ready','certification-ready-small','audited-anchor-ready'].includes(s.strategy));
const report={version:4,generatedAt:new Date().toISOString(),mode:'segment-atlas-v4',writesCache:false,baseline:{localCount:pack.localCount,matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed,functionalLinkMissing:pack.functionalLinkMissing},methodology:{networkRequests:false,cacheWrites:false,sourceGlobalAtlas:'global-series-atlas-v4',catalogCandidatesAreDiscoveryOnly:true,historicalMUUsedOnlyAsAnchorCandidates:true,historicalAnchorsRequireOfficialRevalidationBeforeCertification:true,crossPendingSourceReuseExcludedFromSafeRows:true,publicationAllowed:false},totals:{pendingRows:20712,rawUniqueCatalogCandidates:uniqueRows.length,crossPendingDuplicateSourceGroups:duplicateSourceGroups.length,crossPendingDuplicateAffectedRows:uniqueRows.filter(r=>r.crossPendingSourceCollision).length,safeUniqueCatalogCandidates:safeRows.length,segments:segments.length,localSeriesWithSegments:remoteCountByLocal.size,mixedLocalSeries:[...remoteCountByLocal.values()].filter(s=>s.size>1).length,certificationReadySegments:ready.length,certificationReadyPendingRows:ready.reduce((n,s)=>n+s.pendingUniqueCount,0),auditedAnchorReadySegments:segments.filter(s=>s.strategy==='audited-anchor-ready').length,candidateOnlySegments:segments.filter(s=>s.strategy==='candidate-only').length,specialNumberingSegments:segments.filter(s=>s.strategy==='special-numbering-segment').length},duplicateSourceGroups,topCertificationQueue:ready.slice(0,250).map(s=>({segmentId:s.segmentId,localSeriesId:s.localSeriesId,localTitle:s.localTitle,remoteSeriesName:s.remoteSeriesName,pendingUniqueCount:s.pendingUniqueCount,historicalSameRemoteMU:s.historicalSameRemoteMU,auditedPublishedSameRemote:s.auditedPublishedSameRemote,mixedLocalSeries:s.mixedLocalSeries,weirdRatePct:s.weirdRatePct,strategy:s.strategy,priorityScore:s.priorityScore,historicalAnchorCandidates:s.historicalAnchorCandidates,pendingVerificationSamples:s.pendingVerificationSamples})),topByPending:[...segments].sort((a,b)=>b.pendingUniqueCount-a.pendingUniqueCount||b.historicalSameRemoteMU-a.historicalSameRemoteMU).slice(0,250),localSeriesSummary:localSeriesSummary.slice(0,500),segments};
if(report.totals.safeUniqueCatalogCandidates+report.totals.crossPendingDuplicateAffectedRows!==2055)throw new Error('Desglose de candidatos únicos no cuadra.');
await fs.writeFile(outFile,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({baseline:report.baseline,totals:report.totals,top15:report.topCertificationQueue.slice(0,15).map(x=>({local:x.localTitle,remote:x.remoteSeriesName,pending:x.pendingUniqueCount,historicalAnchors:x.historicalSameRemoteMU,auditedAnchors:x.auditedPublishedSameRemote,mixed:x.mixedLocalSeries,weirdPct:x.weirdRatePct,strategy:x.strategy}))},null,2));
