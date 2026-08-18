import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const atlasFile=path.join(root,'artifacts','marvel-not-listed-v4','segment-atlas-v4.json');
const pilotPublishFile=path.join(root,'artifacts','marvel-not-listed-v4','segment-pilot-34-publish-summary-v4.json');
const outDir=path.join(root,'artifacts','marvel-not-listed-v4','clean-candidates-v4-shards');
const shard=Math.max(0,Number(process.env.SHARD_INDEX)||0),shardCount=Math.max(1,Number(process.env.SHARD_COUNT)||1);
const LEGACY='https://share.marvel.com/sharing/legacy/';
const LANDING='https://share.marvel.com/sharing/issue/';
const SMART='https://marvel.smart.link/fiir7ec77';
const DRN_RE=/^drn:src:marvel:unison::prod:[0-9a-f-]{36}$/i;
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const str=v=>v==null?'':String(v);
const decode=v=>str(v).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ');
const transport=v=>decode(str(v)).replace(/\\u003A/gi,':').replace(/\\u002F/gi,'/').replace(/\\\//g,'/').replace(/%3A/gi,':').replace(/%2F/gi,'/');
const plain=v=>decode(str(v).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
function extractDrn(html){const s=transport(html);let x=s.match(/(?:[?&]|\b)drn=([^&"'<>\s]+)/i)?.[1]||'';if(x){try{x=decodeURIComponent(x)}catch{}const m=x.match(DRN_RE);if(m)return m[0].toLowerCase()}return(s.match(DRN_RE)?.[0]||'').toLowerCase()}
function signal(html){const t=plain(html).toLowerCase();return{unlimited:/this content is available through marvel unlimited/.test(t),openButton:/open in marvel unlimited/.test(t)}}
function smartLink(drn,sourceId){const u=new URL(SMART);u.searchParams.set('type','issue');u.searchParams.set('drn',drn);u.searchParams.set('sourceId',String(sourceId));return u.toString()}
async function get(url,{tries=3,redirect='follow'}={}){let last;for(let i=0;i<tries;i++){try{const r=await fetch(url,{redirect,headers:{'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(25000)});if(r.ok||r.status===404||r.status===410||(redirect==='manual'&&r.status>=300&&r.status<400))return r;last=new Error(`HTTP ${r.status}`)}catch(e){last=e}await sleep(250*(i+1))}throw last}
async function inspect(row,terminal,dupReaders){
  const {gcdId,sourceId,readerId}=row;
  const sourceOwners=(terminal.source.get(sourceId)||[]).filter(x=>x!==gcdId);if(sourceOwners.length)return{...row,kind:'source-collision',owners:sourceOwners};
  if(!readerId)return{...row,kind:'no-reader-id'};
  if(dupReaders.has(readerId))return{...row,kind:'reader-collision-pending'};
  const readerOwners=(terminal.reader.get(readerId)||[]).filter(x=>x!==gcdId);if(readerOwners.length)return{...row,kind:'reader-collision-terminal',owners:readerOwners};
  let lr;try{lr=await get(LEGACY+readerId)}catch(e){return{...row,kind:'legacy-exception',error:e?.message||String(e)}}
  if(!lr.ok)return{...row,kind:'legacy-http',http:lr.status};
  const drn=extractDrn(await lr.text());if(!DRN_RE.test(drn))return{...row,kind:'drn-missing'};
  const drnOwners=(terminal.drn.get(drn)||[]).filter(x=>x!==gcdId);if(drnOwners.length)return{...row,kind:'drn-collision-terminal',drn,owners:drnOwners};
  let lp;try{lp=await get(LANDING+encodeURIComponent(drn))}catch(e){return{...row,kind:'landing-exception',drn,error:e?.message||String(e)}}
  if(!lp.ok)return{...row,kind:'landing-http',drn,http:lp.status};
  const sig=signal(await lp.text());if(!sig.unlimited||!sig.openButton)return{...row,kind:'landing-not-mu',drn,...sig};
  const url=smartLink(drn,sourceId);let sm;try{sm=await get(url,{tries:2,redirect:'manual'})}catch(e){return{...row,kind:'smartlink-exception',drn,smartLink:url,error:e?.message||String(e)}}
  if(!(sm.status>=200&&sm.status<400&&sm.status!==404))return{...row,kind:'smartlink-fail',drn,smartLink:url,http:sm.status};
  return{...row,kind:'mu',drn,landingUnlimited:true,landingOpenButton:true,smartLink:url,smartStatus:sm.status,smartLocation:sm.headers.get('location')||'',functional:true};
}

const[pack,atlas,pilot]=await Promise.all([fs.readFile(cacheFile,'utf8').then(JSON.parse),fs.readFile(atlasFile,'utf8').then(JSON.parse),fs.readFile(pilotPublishFile,'utf8').then(JSON.parse)]);
if(Number(pack.localCount)!==51002||pack.entries?.length!==51002||Number(pack.matched)!==29189||Number(pack.noDigital)!==1135||Number(pack.notListed)!==20678||Number(pack.functionalLinkMissing)!==0)throw new Error('Baseline actual inesperada.');
if(atlas?.mode!=='segment-atlas-v4'||Number(atlas?.totals?.safeUniqueCatalogCandidates)!==2017)throw new Error('Atlas incompatible.');
if(Number(pilot?.promotedUuid)!==34||pilot?.changedGcdIds?.length!==34)throw new Error('Publicación piloto incompatible.');
const all=[];for(const s of atlas.segments||[])for(const r of s.pendingRows||[])all.push({gcdId:Number(r.gcdId),localSeriesId:Number(s.localSeriesId),localTitle:s.localTitle,remoteSeriesName:s.remoteSeriesName,issueNumber:str(r.issueNumber),date:str(r.date),sourceId:Number(r.sourceId),readerId:Number(r.readerId)||0,remoteIssueNumber:str(r.remoteIssueNumber),remoteOnSale:str(r.remoteOnSale),catalogMode:r.catalogMode});
if(all.length!==2017||new Set(all.map(x=>x.gcdId)).size!==2017)throw new Error(`Atlas rows=${all.length}, esperaba 2017 únicas.`);
const cacheById=new Map(pack.entries.map(r=>[Number(r[0]),r])),pilotIds=new Set(pilot.changedGcdIds.map(Number));
const nonPending=all.filter(x=>Number(cacheById.get(x.gcdId)?.[3])!==4);if(nonPending.length!==34||nonPending.some(x=>!pilotIds.has(x.gcdId)||Number(cacheById.get(x.gcdId)?.[3])!==1))throw new Error('Los 34 no-pendientes del atlas no coinciden con el piloto publicado.');
const targets=all.filter(x=>Number(cacheById.get(x.gcdId)?.[3])===4).sort((a,b)=>a.gcdId-b.gcdId);if(targets.length!==1983)throw new Error(`Targets=${targets.length}, esperaba 1983.`);
const terminal={source:new Map(),reader:new Map(),drn:new Map()};for(const r of pack.entries){if(![1,3,5].includes(Number(r[3])))continue;const id=Number(r[0]),sid=Number(r[1])||0,rid=Number(r[2])||0,drn=str(r[5]).toLowerCase();if(sid){const a=terminal.source.get(sid)||[];a.push(id);terminal.source.set(sid,a)}if(rid){const a=terminal.reader.get(rid)||[];a.push(id);terminal.reader.set(rid,a)}if(DRN_RE.test(drn)){const a=terminal.drn.get(drn)||[];a.push(id);terminal.drn.set(drn,a)}}
const readerGroups=new Map();for(const x of targets)if(x.readerId){const a=readerGroups.get(x.readerId)||[];a.push(x.gcdId);readerGroups.set(x.readerId,a)}const dupReaders=new Set([...readerGroups].filter(([,ids])=>ids.length>1).map(([rid])=>rid));
const shardTargets=targets.filter((_,i)=>i%shardCount===shard),results=[];
console.log(`Phase5 shard ${shard+1}/${shardCount}: ${shardTargets.length}/${targets.length}`);
for(const [i,row] of shardTargets.entries()){results.push(await inspect(row,terminal,dupReaders).catch(e=>({...row,kind:'exception',error:e?.message||String(e)})));if((i+1)%25===0)console.log(`${i+1}/${shardTargets.length}`);await sleep(45)}
const kinds={};for(const r of results)kinds[r.kind]=(kinds[r.kind]||0)+1;
const report={version:4,generatedAt:new Date().toISOString(),mode:'clean-candidates-drm-v4-shard',writesCache:false,shard,shardCount,totalTargets:1983,targetCount:shardTargets.length,baseline:{matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed,functionalLinkMissing:pack.functionalLinkMissing},safety:{cacheWritten:false,atlasSafeUniqueCandidates:2017,pilotPublishedExcluded:34,status4Required:true,terminalSourceReaderDrnCollisionProtection:true,pendingReaderCollisionProtection:true,officialLegacyDrnRequired:true,officialLandingUnlimitedAndOpenButtonRequired:true,functionalSmartLinkRequired:true},summary:{...kinds,mu:results.filter(r=>r.kind==='mu').length},results};
await fs.mkdir(outDir,{recursive:true});await fs.writeFile(path.join(outDir,`shard-${shard}.json`),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary,null,2));
