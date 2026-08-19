import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const reportFile=path.join(root,'artifacts','marvel-not-listed-v4','phase7-harvested-issue-audit-v4.json');
const summaryFile=path.join(root,'artifacts','marvel-not-listed-v4','phase7-safe-1661-publish-summary-v4.json');
const STATUS={MU:1,NO_DIGITAL:3,NOT_LISTED:4,MU_READER:5};
const DRN_RE=/^drn:src:marvel:unison::prod:[0-9a-f-]{36}$/i;
const str=v=>v==null?'':String(v),now=new Date().toISOString();
const count=(p,s)=>p.entries.filter(r=>Number(r?.[3])===s).length;
function recompute(p){
  const c1=count(p,1),c5=count(p,5),c3=count(p,3),c4=count(p,4);
  p.matched=c1+c5;p.verifiedMU=p.matched;p.unavailable=c3;p.noDigital=c3;p.notListed=c4;
  p.linkReady=p.entries.filter(r=>Number(r?.[3])===1&&DRN_RE.test(str(r?.[5]))).length;
  p.linkMissing=p.entries.filter(r=>Number(r?.[3])===5||Number(r?.[3])===1&&!DRN_RE.test(str(r?.[5]))).length;
  p.linksPrebuilt=p.linkMissing===0;
  p.readerFallbackGcdIds=[...new Set((p.readerFallbackGcdIds||[]).map(Number).filter(Number.isFinite))].sort((a,b)=>a-b);
  p.readerFallbackReady=p.readerFallbackGcdIds.length;
  p.functionalLinkReady=p.linkReady+p.readerFallbackReady;
  p.functionalLinkMissing=Math.max(0,p.matched-p.functionalLinkReady);
  return p;
}

const [pack,report]=await Promise.all([
  fs.readFile(cacheFile,'utf8').then(JSON.parse),
  fs.readFile(reportFile,'utf8').then(JSON.parse),
]);
if(Number(pack.localCount)!==51002||pack.entries?.length!==51002||Number(pack.matched)!==31177||Number(pack.noDigital)!==1135||Number(pack.notListed)!==18690||Number(pack.linkReady)!==27288||Number(pack.readerFallbackReady)!==3889||Number(pack.functionalLinkReady)!==31177||Number(pack.functionalLinkMissing)!==0)throw new Error(`Baseline inesperada ${pack.matched}/${pack.noDigital}/${pack.notListed}/${pack.linkReady}/${pack.readerFallbackReady}/${pack.functionalLinkMissing}`);
const s=report?.summary||{};
if(report?.version!==4||report?.mode!=='phase7-harvested-issue-audit-v4'||report?.writesCache!==false||Number(s.totalSourceIds)!==4812||Number(s.publishableMU)!==624||Number(s.publishableUuid)!==624||Number(s.publishableReader)!==0||Number(s.publishableNoDigital)!==1037||Number(s.crossResultCollision)!==91)throw new Error('Informe fase 7 incompatible.');
if(!Array.isArray(report.results)||report.results.length!==4812)throw new Error('Resultados fase 7 incompletos.');
const publish=report.results.filter(r=>r.publishable===true);
const mus=publish.filter(r=>r.kind==='mu-uuid'),nod=publish.filter(r=>r.kind==='no-digital');
if(publish.length!==1661||mus.length!==624||nod.length!==1037)throw new Error(`Scope publishable incorrecto ${publish.length}/${mus.length}/${nod.length}`);

const byId=new Map(pack.entries.map((r,i)=>[Number(r[0]),i]));
const terminalSource=new Map(),terminalReader=new Map(),terminalDrn=new Map();
for(const r of pack.entries){
  if(![1,3,5].includes(Number(r[3])))continue;
  const id=Number(r[0]),sid=Number(r[1])||0,rid=Number(r[2])||0,drn=str(r[5]).toLowerCase();
  for(const [m,v] of [[terminalSource,sid],[terminalReader,rid],[terminalDrn,DRN_RE.test(drn)?drn:'']])if(v){const a=m.get(v)||[];a.push(id);m.set(v,a)}
}
const seenGcd=new Set(),seenSource=new Set(),seenReader=new Set(),seenDrn=new Set();
for(const r of publish){
  const id=Number(r.gcdId),sid=Number(r.sourceId)||0,rid=Number(r.readerId)||0,drn=str(r.drn).toLowerCase();
  if(!id||!sid||seenGcd.has(id)||seenSource.has(sid))throw new Error(`Duplicidad publishable ${id}/${sid}`);
  seenGcd.add(id);seenSource.add(sid);
  if(r.kind==='mu-uuid'){
    if(r.functional!==true||!rid||!DRN_RE.test(drn)||r.landingUnlimited!==true||r.landingOpenButton!==true||!(Number(r.smartStatus)>=200&&Number(r.smartStatus)<400))throw new Error(`MU inseguro ${id}`);
    if(seenReader.has(rid)||seenDrn.has(drn))throw new Error(`Duplicidad reader/drn ${id}`);seenReader.add(rid);seenDrn.add(drn);
  }else if(r.kind==='no-digital'){
    if(str(r.sourceAvailability)!=='no-digital')throw new Error(`NO_DIGITAL no explícito ${id}`);
  }else throw new Error(`Kind inesperado ${r.kind}`);
}

const before=pack.entries.map(r=>JSON.stringify(r));
const fallbackBefore=JSON.stringify(pack.readerFallbackGcdIds||[]),fallbackReadyBefore=Number(pack.readerFallbackReady)||0;
const changed=[];
for(const r of publish){
  const id=Number(r.gcdId),sid=Number(r.sourceId),rid=Number(r.readerId)||0,drn=str(r.drn).toLowerCase(),pos=byId.get(id);
  if(pos==null||Number(pack.entries[pos][3])!==STATUS.NOT_LISTED)throw new Error(`GCD ${id} dejó status4`);
  const cur=pack.entries[pos];
  const sourceOwners=(terminalSource.get(sid)||[]).filter(x=>x!==id);if(sourceOwners.length)throw new Error(`source collision ${id}: ${sourceOwners}`);
  if(r.kind==='mu-uuid'){
    const readerOwners=(terminalReader.get(rid)||[]).filter(x=>x!==id),drnOwners=(terminalDrn.get(drn)||[]).filter(x=>x!==id);
    if(readerOwners.length)throw new Error(`reader collision ${id}: ${readerOwners}`);if(drnOwners.length)throw new Error(`drn collision ${id}: ${drnOwners}`);
    pack.entries[pos]=[id,sid,rid,STATUS.MU,str(cur[4]),drn];
  }else{
    pack.entries[pos]=[id,sid,0,STATUS.NO_DIGITAL,str(cur[4]),''];
  }
  changed.push(id);
}
if(changed.length!==1661||new Set(changed).size!==1661)throw new Error('Changed scope incorrecto.');
const changedSet=new Set(changed);for(let i=0;i<pack.entries.length;i++)if(!changedSet.has(Number(pack.entries[i][0]))&&JSON.stringify(pack.entries[i])!==before[i])throw new Error(`Regresión fuera de scope ${pack.entries[i][0]}`);
if(new Set(pack.entries.map(r=>Number(r[0]))).size!==51002)throw new Error('GCD duplicados/perdidos.');
recompute(pack);
if(pack.matched!==31801||pack.noDigital!==2172||pack.notListed!==17029||pack.linkReady!==27912||pack.readerFallbackReady!==fallbackReadyBefore||JSON.stringify(pack.readerFallbackGcdIds||[])!==fallbackBefore||pack.functionalLinkReady!==31801||pack.functionalLinkMissing!==0)throw new Error(`Final inesperado ${pack.matched}/${pack.noDigital}/${pack.notListed}/${pack.linkReady}/${pack.readerFallbackReady}/${pack.functionalLinkReady}/${pack.functionalLinkMissing}`);
pack.generatedAt=now;
pack.phase7HarvestPublication={version:4,publishedAt:now,totalAudited:4812,changedRows:1661,promotedMU:624,promotedUuid:624,confirmedNoDigital:1037,discardedBySafety:4812-1661};
pack.functionalLinkAudit={...(pack.functionalLinkAudit||{}),completedAt:now,uuidReady:pack.linkReady,readerFallbackReady:pack.readerFallbackReady,functionalLinkReady:pack.functionalLinkReady,functionalLinkMissing:pack.functionalLinkMissing};
const summary={version:4,publishedAt:now,changedRows:1661,promotedMU:624,promotedUuid:624,promotedReader:0,confirmedNoDigital:1037,unchangedRows:49341,after:{matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed,linkReady:pack.linkReady,linkMissing:pack.linkMissing,readerFallbackReady:pack.readerFallbackReady,functionalLinkReady:pack.functionalLinkReady,functionalLinkMissing:pack.functionalLinkMissing}};
await fs.writeFile(cacheFile,JSON.stringify(pack));
await fs.writeFile(summaryFile,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
