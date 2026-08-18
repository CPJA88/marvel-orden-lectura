import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import extract from 'extract-zip';

const root=process.cwd();
const archive=path.join(root,'Marvel_Orden_de_Lectura_PWA.zip');
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const diagFile=path.join(root,'artifacts','marvel-not-listed-v4','identity-mismatch-diagnostic.json');
const pilotFile=path.join(root,'artifacts','marvel-not-listed-v4','identity-mismatch-official-pilot.json');
const linkFile=path.join(root,'artifacts','marvel-not-listed-v4','identity-mismatch-link-audit.json');
const tailFile=path.join(root,'artifacts','marvel-not-listed-v4','tail-a2-b-audit.json');
const catalogFile=path.join(root,'.cache','marvel-global-catalog-v4.json');
const dictFile=path.join(root,'artifacts','marvel-not-listed-v4','alias-dictionary-v4.json');
const candidatesFile=path.join(root,'artifacts','marvel-not-listed-v4','alias-candidates-v4.json');
const STATUS={MU:1,NO_DIGITAL:3,NOT_LISTED:4,MU_LINK_MISSING:5};
const str=v=>v==null?'':String(v);
const normalize=v=>str(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
const normalizeSeries=v=>normalize(str(v).replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|present))?\s*\)/gi,' ')).replace(/^the\s+/,'').replace(/\s+comics?$/,'').trim();
const normalizeIssue=v=>{let s=str(v).trim().toUpperCase().replace(/\s+/g,'');if(/^0+\d+$/.test(s))s=String(Number(s));return s};
const yearOf=v=>Number(str(v).match(/\b((?:19|20)\d{2})\b/)?.[1]||0);
const decode=v=>str(v).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)||32));
function parseIssueTitle(t){const m=decode(t).trim().match(/^(.*?)\s*(?:\(\s*(\d{4})(?:\s*-\s*(?:\d{4}|present))?\s*\))?\s*#\s*([^\s|]+)/i);return m?{series:m[1].trim(),year:Number(m[2]||0),issue:m[3].trim()}:null}

async function loadLocal(){
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'marvel-alias-v4-'));
  try{
    await extract(archive,{dir:tmp});
    const data=path.join(tmp,'data');
    const [meta,series]=await Promise.all([
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

const [pack,diag,pilot,links,tail,catalogPack,localById]=await Promise.all([
  fs.readFile(cacheFile,'utf8').then(JSON.parse),
  fs.readFile(diagFile,'utf8').then(JSON.parse),
  fs.readFile(pilotFile,'utf8').then(JSON.parse),
  fs.readFile(linkFile,'utf8').then(JSON.parse),
  fs.readFile(tailFile,'utf8').then(JSON.parse),
  fs.readFile(catalogFile,'utf8').then(JSON.parse),
  loadLocal(),
]);
if(Number(pack.localCount)!==51002||pack.entries?.length!==51002||Number(pack.matched)!==29105||Number(pack.noDigital)!==1131||Number(pack.notListed)!==20766||Number(pack.functionalLinkMissing)!==0)throw new Error(`Baseline inesperada ${pack.matched}/${pack.noDigital}/${pack.notListed}/${pack.functionalLinkMissing}`);
if(Number(pilot?.summary?.targets)!==429||Number(pilot?.summary?.confirmedRepeatedAlias)!==429)throw new Error('Piloto oficial de alias incompleto.');
if(Number(links?.summary?.targets)!==429||Number(links?.summary?.functional)!==429)throw new Error('Auditoría funcional de alias incompleta.');
if(Number(tail?.summary?.a2?.recoverable)!==3||Number(tail?.summary?.a2?.mu)!==3)throw new Error('Tail A2 incompatible.');
if(!Array.isArray(catalogPack?.issues)||catalogPack.issues.length<30000)throw new Error('Catálogo global V4 ausente.');
const cacheById=new Map(pack.entries.map(r=>[Number(r[0]),r]));
const diagById=new Map((diag.rows||[]).map(r=>[Number(r.gcdId),r]));
const linkById=new Map((links.results||[]).map(r=>[Number(r.gcdId),r]));

const evidence=[];
for(const p of pilot.results||[]){
  if(!['mu','no-digital'].includes(p.kind)||!p.numberExact||!p.dateCompatible)continue;
  const d=diagById.get(Number(p.gcdId)),l=linkById.get(Number(p.gcdId)),row=cacheById.get(Number(p.gcdId));
  if(!d||!l||!row||!l.functional||Number(row[1])!==Number(p.sourceId)||![STATUS.MU,STATUS.NO_DIGITAL,STATUS.MU_LINK_MISSING].includes(Number(row[3])))throw new Error(`Evidencia repetida inconsistente ${p.gcdId}`);
  const remote=parseIssueTitle(p.title)?.series||d.actualSeries;
  const local=localById.get(Number(p.gcdId));
  if(!local||!remote)throw new Error(`Sin título de evidencia ${p.gcdId}`);
  evidence.push({gcdId:Number(p.gcdId),sourceId:Number(p.sourceId),localSeries:local.title,remoteSeries:remote,seriesId:local.seriesId,issue:local.issueNumber,date:local.date,origin:'official-repeated-alias',functional:true});
}
for(const x of tail.a2||[]){
  if(!x.recoverable||x.proposedKind!=='mu'||!x.selected?.functional||!x.selected?.reader?.ok)continue;
  const row=cacheById.get(Number(x.gcdId));if(!row||Number(row[1])!==Number(x.selected.sourceId)||Number(row[3])!==STATUS.MU_LINK_MISSING)throw new Error(`Evidencia A2 no publicada ${x.gcdId}`);
  const remote=parseIssueTitle(x.selected.reader.title)?.series||parseIssueTitle(x.selected.titles?.[0])?.series||'';
  const local=localById.get(Number(x.gcdId));if(!local||!remote)throw new Error(`Sin título A2 ${x.gcdId}`);
  evidence.push({gcdId:Number(x.gcdId),sourceId:Number(x.selected.sourceId),localSeries:local.title,remoteSeries:remote,seriesId:local.seriesId,issue:local.issueNumber,date:local.date,origin:'official-singleton-a2',functional:true});
}
if(evidence.length!==432)throw new Error(`Evidencias=${evidence.length}, esperadas=432`);

const grouped=new Map();
for(const e of evidence){
  const localNorm=normalizeSeries(e.localSeries),remoteNorm=normalizeSeries(e.remoteSeries);if(!localNorm||!remoteNorm||localNorm===remoteNorm)continue;
  const g=grouped.get(localNorm)||{localNorm,localNames:new Set(),remote:new Map(),seriesIds:new Set(),evidence:[]};
  g.localNames.add(e.localSeries);g.seriesIds.add(e.seriesId);const r=g.remote.get(remoteNorm)||{remoteNorm,names:new Set(),count:0};r.names.add(e.remoteSeries);r.count++;g.remote.set(remoteNorm,r);g.evidence.push(e);grouped.set(localNorm,g);
}
const trusted=[],conflicts=[];
for(const g of grouped.values()){
  if(g.remote.size!==1){conflicts.push({localNorm:g.localNorm,targets:[...g.remote.values()].map(r=>({remoteNorm:r.remoteNorm,names:[...r.names],count:r.count})),evidenceCount:g.evidence.length});continue}
  const r=[...g.remote.values()][0];trusted.push({aliasId:`${g.localNorm}=>${r.remoteNorm}`,localNorm:g.localNorm,remoteNorm:r.remoteNorm,localNames:[...g.localNames].sort(),remoteNames:[...r.names].sort(),seriesIds:[...g.seriesIds].sort((a,b)=>a-b),evidenceCount:g.evidence.length,evidenceOrigins:Object.fromEntries([...g.evidence.reduce((m,e)=>(m.set(e.origin,(m.get(e.origin)||0)+1),m),new Map())]),evidenceGcdIds:g.evidence.map(e=>e.gcdId).sort((a,b)=>a-b),evidenceSourceIds:[...new Set(g.evidence.map(e=>e.sourceId))].sort((a,b)=>a-b),trust:g.evidence.length>=2?'repeated-official':'singleton-official-functional'});
}
trusted.sort((a,b)=>b.evidenceCount-a.evidenceCount||a.aliasId.localeCompare(b.aliasId));
if(conflicts.length)throw new Error(`Conflictos de alias detectados: ${conflicts.length}`);

const terminalSourceOwners=new Map();
for(const r of pack.entries){const sid=Number(r[1])||0;if(!sid||![1,3,5].includes(Number(r[3])))continue;const a=terminalSourceOwners.get(sid)||[];a.push(Number(r[0]));terminalSourceOwners.set(sid,a)}
const catalogIndex=new Map();
for(const c of catalogPack.issues){const k=`${normalizeSeries(c.seriesName)}|${normalizeIssue(c.issueNumber)}`;if(k.startsWith('|')||k.endsWith('|'))continue;const a=catalogIndex.get(k)||[];a.push(c);catalogIndex.set(k,a)}
function candidateYear(c){return Number(yearOf(c?.onSale)||c?.yearPage||0)}
function candidateFor(local,alias){
  const key=`${alias.remoteNorm}|${normalizeIssue(local.issueNumber)}`,all=catalogIndex.get(key)||[],ly=yearOf(local.date);
  let matches=all.filter(c=>{const cy=candidateYear(c);return Boolean(ly&&cy&&Math.abs(ly-cy)<=1)});
  if(matches.length>1){const exact=matches.filter(c=>str(c.onSale).slice(0,10)===str(local.date).slice(0,10));if(exact.length===1)matches=exact}
  const rows=matches.map(c=>({sourceId:Number(c.sourceId)||0,readerId:Number(c.readerId)||0,seriesName:str(c.seriesName),issueNumber:str(c.issueNumber),onSale:str(c.onSale),yearPage:Number(c.yearPage)||0,collisionOwners:(terminalSourceOwners.get(Number(c.sourceId)||0)||[]).filter(id=>id!==local.gcdId)}));
  const clean=rows.filter(c=>c.sourceId&&!c.collisionOwners.length);
  return{all:rows,clean};
}

const aliasByLocal=new Map(trusted.map(a=>[a.localNorm,a]));
const candidateRows=[];
for(const r of pack.entries){if(Number(r[3])!==STATUS.NOT_LISTED)continue;const local=localById.get(Number(r[0]));if(!local)continue;const alias=aliasByLocal.get(normalizeSeries(local.title));if(!alias)continue;const found=candidateFor(local,alias);let kind='none',candidate=null;if(found.clean.length===1){kind='unique';candidate=found.clean[0]}else if(found.clean.length>1)kind='ambiguous';else if(found.all.some(x=>x.collisionOwners.length))kind='collision';candidateRows.push({gcdId:local.gcdId,seriesId:local.seriesId,localTitle:local.title,issueNumber:local.issueNumber,date:local.date,aliasId:alias.aliasId,remoteNorm:alias.remoteNorm,kind,candidate,candidates:kind==='ambiguous'?found.clean.slice(0,8):kind==='collision'?found.all.slice(0,8):undefined});}

for(const a of trusted){const rows=candidateRows.filter(x=>x.aliasId===a.aliasId);a.pendingRows=rows.length;a.discovery={unique:rows.filter(x=>x.kind==='unique').length,ambiguous:rows.filter(x=>x.kind==='ambiguous').length,collision:rows.filter(x=>x.kind==='collision').length,noCandidate:rows.filter(x=>x.kind==='none').length};}
const summary={trustedAliases:trusted.length,conflicts:conflicts.length,evidenceRows:evidence.length,pendingInAliasSeries:candidateRows.length,uniqueDiscoveryCandidates:candidateRows.filter(x=>x.kind==='unique').length,ambiguous:candidateRows.filter(x=>x.kind==='ambiguous').length,sourceCollision:candidateRows.filter(x=>x.kind==='collision').length,noCandidate:candidateRows.filter(x=>x.kind==='none').length,writesCache:false};
const dictionary={version:4,generatedAt:new Date().toISOString(),mode:'official-alias-dictionary',baseline:{localCount:pack.localCount,matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed},summary,aliases:trusted,conflicts,safety:{cacheWritten:false,evidenceSources:['identity-mismatch-official-pilot','identity-mismatch-link-audit','tail-a2-b-audit'],oldPositiveAnchorsUsed:false,requiresZeroAliasConflicts:true}};
const candidates={version:4,generatedAt:new Date().toISOString(),mode:'alias-discovery-candidates',writesCache:false,summary:{targets:candidateRows.length,unique:summary.uniqueDiscoveryCandidates,ambiguous:summary.ambiguous,collision:summary.sourceCollision,noCandidate:summary.noCandidate},rows:candidateRows};
await fs.mkdir(path.dirname(dictFile),{recursive:true});await fs.writeFile(dictFile,JSON.stringify(dictionary,null,2)+'\n');await fs.writeFile(candidatesFile,JSON.stringify(candidates,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
