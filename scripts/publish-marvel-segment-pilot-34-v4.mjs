import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const auditFile=path.join(root,'artifacts','marvel-not-listed-v4','segment-pilot-pending-audit-v4.json');
const summaryFile=path.join(root,'artifacts','marvel-not-listed-v4','segment-pilot-34-publish-summary-v4.json');
const STATUS={MU:1,NO_DIGITAL:3,NOT_LISTED:4,MU_LINK_MISSING:5};
const DRN_RE=/^drn:src:marvel:unison::prod:[0-9a-f-]{36}$/i;
const str=v=>v==null?'':String(v);
const now=new Date().toISOString();
const count=(pack,status)=>pack.entries.filter(r=>Number(r?.[3])===status).length;

function recompute(pack){
  const c1=count(pack,STATUS.MU),c5=count(pack,STATUS.MU_LINK_MISSING),c3=count(pack,STATUS.NO_DIGITAL),c4=count(pack,STATUS.NOT_LISTED);
  pack.matched=c1+c5;
  pack.verifiedMU=pack.matched;
  pack.unavailable=c3;
  pack.noDigital=c3;
  pack.notListed=c4;
  pack.linkReady=pack.entries.filter(r=>Number(r?.[3])===STATUS.MU&&DRN_RE.test(str(r?.[5]))).length;
  pack.linkMissing=pack.entries.filter(r=>Number(r?.[3])===STATUS.MU_LINK_MISSING||Number(r?.[3])===STATUS.MU&&!DRN_RE.test(str(r?.[5]))).length;
  pack.linksPrebuilt=pack.linkMissing===0;
  const fallbackIds=Array.isArray(pack.readerFallbackGcdIds)?pack.readerFallbackGcdIds.map(Number).filter(Number.isFinite):[];
  pack.readerFallbackGcdIds=[...new Set(fallbackIds)].sort((a,b)=>a-b);
  pack.readerFallbackReady=pack.readerFallbackGcdIds.length;
  pack.functionalLinkReady=pack.linkReady+pack.readerFallbackReady;
  pack.functionalLinkMissing=Math.max(0,pack.matched-pack.functionalLinkReady);
  return pack;
}

const[pack,audit]=await Promise.all([
  fs.readFile(cacheFile,'utf8').then(JSON.parse),
  fs.readFile(auditFile,'utf8').then(JSON.parse),
]);

if(Number(pack.localCount)!==51002||pack.entries?.length!==51002)throw new Error('Caché base inválida.');
if(Number(pack.matched)!==29155||Number(pack.noDigital)!==1135||Number(pack.notListed)!==20712||Number(pack.functionalLinkMissing)!==0)throw new Error(`Baseline inesperada ${pack.matched}/${pack.noDigital}/${pack.notListed}/${pack.functionalLinkMissing}`);
if(Number(audit?.version)!==4||audit?.mode!=='segment-pilot-pending-drm-button-audit-v4'||audit?.writesCache!==false)throw new Error('Auditoría piloto incompatible.');
const s=audit.summary||{};
for(const [k,v] of Object.entries({targets:34,mu:34,muUuid:34,muReaderFallback:0,noDigital:0,drnMissing:0,legacyFail:0,landingFail:0,smartlinkFail:0,sourceCollision:0,exception:0,verified:34}))if(Number(s[k])!==v)throw new Error(`Resumen inseguro: ${k}=${s[k]}, esperado=${v}`);
if(!Array.isArray(audit.results)||audit.results.length!==34)throw new Error('La auditoría no contiene exactamente 34 resultados.');

const seenAudit=new Set(),byId=new Map(pack.entries.map((r,i)=>[Number(r[0]),i]));
const terminalOwners=new Map();
for(const r of pack.entries){
  const sid=Number(r?.[1])||0,status=Number(r?.[3]);
  if(!sid||![STATUS.MU,STATUS.NO_DIGITAL,STATUS.MU_LINK_MISSING].includes(status))continue;
  const owners=terminalOwners.get(sid)||[];owners.push(Number(r[0]));terminalOwners.set(sid,owners);
}
const before=pack.entries.map(r=>JSON.stringify(r));
const beforeFallbackIds=JSON.stringify(pack.readerFallbackGcdIds||[]);
const beforeReaderFallbackReady=Number(pack.readerFallbackReady)||0;
const beforeLinkReady=Number(pack.linkReady)||0;
const changed=[];

for(const r of audit.results){
  const id=Number(r.gcdId),sourceId=Number(r.sourceId),readerId=Number(r.readerId),drn=str(r.drn).toLowerCase();
  if(!id||seenAudit.has(id))throw new Error(`GCD duplicado/inválido en auditoría: ${id}`);seenAudit.add(id);
  if(r.kind!=='mu'||r.linkMode!=='uuid'||r.functional!==true||r.landingUnlimited!==true||r.landingOpenButton!==true)throw new Error(`GCD ${id} no tiene prueba MU completa.`);
  if(!sourceId||!readerId||!DRN_RE.test(drn))throw new Error(`GCD ${id} carece de sourceId/readerId/DRN válido.`);
  if(!(Number(r.smartStatus)>=200&&Number(r.smartStatus)<400))throw new Error(`GCD ${id} smart-link no funcional.`);
  const pos=byId.get(id);if(pos==null)throw new Error(`GCD ${id} no existe en la caché.`);
  const current=pack.entries[pos];if(Number(current[3])!==STATUS.NOT_LISTED)throw new Error(`GCD ${id} dejó de ser NOT_LISTED.`);
  const owners=(terminalOwners.get(sourceId)||[]).filter(x=>x!==id);if(owners.length)throw new Error(`sourceId ${sourceId} de GCD ${id} ya pertenece a terminal ${owners.join(',')}`);
  pack.entries[pos]=[id,sourceId,readerId,STATUS.MU,str(current[4]),drn];
  changed.push(id);
}
if(changed.length!==34)throw new Error(`Scope=${changed.length}, esperado=34.`);

const changedSet=new Set(changed);
for(let i=0;i<pack.entries.length;i++)if(!changedSet.has(Number(pack.entries[i][0]))&&JSON.stringify(pack.entries[i])!==before[i])throw new Error(`Regresión fuera de scope en GCD ${pack.entries[i][0]}.`);
if(new Set(pack.entries.map(r=>Number(r[0]))).size!==51002)throw new Error('IDs GCD duplicados o perdidos.');

recompute(pack);
if(pack.matched!==29189||pack.noDigital!==1135||pack.notListed!==20678)throw new Error(`Conteos finales inesperados ${pack.matched}/${pack.noDigital}/${pack.notListed}`);
if(pack.linkReady!==beforeLinkReady+34)throw new Error(`linkReady no aumentó exactamente 34: ${beforeLinkReady}->${pack.linkReady}`);
if(pack.readerFallbackReady!==beforeReaderFallbackReady||JSON.stringify(pack.readerFallbackGcdIds||[])!==beforeFallbackIds)throw new Error('Se alteraron los fallbacks reader existentes.');
if(pack.functionalLinkMissing!==0||pack.functionalLinkReady!==pack.matched)throw new Error(`Links funcionales incompletos ${pack.functionalLinkReady}/${pack.matched}`);

pack.generatedAt=now;
pack.segmentPilotPublication={version:4,publishedAt:now,sourceAudit:'segment-pilot-pending-drm-button-audit-v4',segments:['5546|new x men 2004 2008','499|astonishing tales 1970'],promotedMU:34,promotedUuid:34,confirmedNoDigital:0};
pack.functionalLinkAudit={...(pack.functionalLinkAudit||{}),completedAt:now,uuidReady:pack.linkReady,readerFallbackReady:pack.readerFallbackReady,functionalLinkReady:pack.functionalLinkReady,functionalLinkMissing:pack.functionalLinkMissing};

const summary={version:4,publishedAt:now,changedRows:34,promotedMU:34,promotedUuid:34,confirmedNoDigital:0,unchangedRows:50968,after:{matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed,linkReady:pack.linkReady,linkMissing:pack.linkMissing,readerFallbackReady:pack.readerFallbackReady,functionalLinkReady:pack.functionalLinkReady,functionalLinkMissing:pack.functionalLinkMissing},changedGcdIds:[...changed].sort((a,b)=>a-b)};
await fs.mkdir(path.dirname(summaryFile),{recursive:true});
await fs.writeFile(cacheFile,JSON.stringify(pack));
await fs.writeFile(summaryFile,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
