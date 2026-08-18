import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const auditFile=path.join(root,'artifacts','marvel-not-listed-v4','identity-mismatch-link-audit.json');
const fallbackFile=path.join(root,'source','marvel-reader-fallback-v1240.js');
const summaryFile=path.join(root,'artifacts','marvel-not-listed-v4','identity-mismatch-publish-summary.json');
const STATUS={MU:1,NO_DIGITAL:3,NOT_LISTED:4,MU_READER:5};
const DRN_RE=/^drn:src:marvel:unison::prod:[0-9a-f-]{36}$/i;
const str=v=>v==null?'':String(v);
const now=new Date().toISOString();
const count=(pack,s)=>pack.entries.filter(r=>Number(r?.[3])===s).length;

function recompute(pack){
  const c1=count(pack,1),c5=count(pack,5),c3=count(pack,3),c4=count(pack,4);
  pack.matched=c1+c5;pack.verifiedMU=pack.matched;pack.unavailable=c3;pack.noDigital=c3;pack.notListed=c4;
  pack.linkReady=pack.entries.filter(r=>Number(r?.[3])===1&&DRN_RE.test(str(r?.[5]))).length;
  pack.linkMissing=pack.entries.filter(r=>Number(r?.[3])===5||Number(r?.[3])===1&&!DRN_RE.test(str(r?.[5]))).length;
  pack.linksPrebuilt=pack.linkMissing===0;
}
function parseFallback(src){const m=new Map();for(const x of src.matchAll(/\[(\d+),'(\d+)'\]/g)){const id=Number(x[1]),rid=x[2];if(m.has(id)&&m.get(id)!==rid)throw new Error(`Fallback duplicado conflictivo ${id}`);m.set(id,rid)}return m}
function renderFallback(targets){const rows=[...targets].sort((a,b)=>a[0]-b[0]).map(([id,r])=>`    [${id},'${r}'],`).join('\n');return `/* Marvel Lector v1.2.42 — fallback reader oficial verificado; generado por auditoría */\n(() => {\n  const SMART_BASE='https://marvel.smart.link/fiir7ec77';\n  const TARGETS=new Map([\n${rows}\n  ]);\n\n  function readerFallbackHref(m){\n    if(!m||Number(m.preinstalledStatus)!==5)return '';\n    const expected=TARGETS.get(Number(m.id));\n    const readerId=String(m.readerId||'').trim();\n    if(!expected||readerId!==expected||!/^\\d+$/.test(readerId))return '';\n    return \`${'${SMART_BASE}'}?type=reader&drn=${'${encodeURIComponent(readerId)}'}\`;\n  }\n\n  if(typeof unlimitedState==='function'){const baseUnlimitedState=unlimitedState;unlimitedState=function(m){if(readerFallbackHref(m))return{label:'Unlimited ✓',cls:'available'};return baseUnlimitedState(m)}}\n  if(typeof stableAppHref==='function'){const baseStableAppHref=stableAppHref;stableAppHref=function(x,s){const m=typeof state!=='undefined'&&state?.marvel?state.marvel.get(Number(x?.id)):null;return readerFallbackHref(m)||baseStableAppHref(x,s)}}\n  function repaintTargets(){if(typeof state==='undefined'||!state?.marvel||typeof updateRenderedMeta!=='function')return;for(const id of TARGETS.keys()){const m=state.marvel.get(id);if(m)updateRenderedMeta(id,m)}}\n  if(typeof requestAnimationFrame==='function')requestAnimationFrame(repaintTargets);\n  if(typeof setTimeout==='function'){setTimeout(repaintTargets,500);setTimeout(repaintTargets,1800)}\n})();\n`}

const [pack,audit,fallbackSrc]=await Promise.all([fs.readFile(cacheFile,'utf8').then(JSON.parse),fs.readFile(auditFile,'utf8').then(JSON.parse),fs.readFile(fallbackFile,'utf8')]);
if(Number(pack.localCount)!==51002||pack.entries?.length!==51002)throw new Error('Caché base inválida.');
if(Number(pack.matched)!==28673||Number(pack.noDigital)!==1131||Number(pack.notListed)!==21198||Number(pack.linkReady)!==25322||Number(pack.linkMissing)!==3351||Number(pack.readerFallbackReady)!==3351||Number(pack.functionalLinkMissing)!==0)throw new Error('Baseline V4 cambió antes de publicar identity mismatch.');
const s=audit?.summary||{};if(audit?.version!==4||s.targets!==429||s.mu!==429||s.functional!==429||s.readerFunctional!==429||s.uuidFunctional!==0||s.missingFunctional!==0||s.notFound!==0||s.availabilityRegression!==0||s.retryable!==0)throw new Error('Auditoría de enlaces no es publicable íntegramente.');
const fallback=parseFallback(fallbackSrc);if(fallback.size!==3351)throw new Error(`Allowlist previa=${fallback.size}, esperado=3351.`);
const before=pack.entries.map(r=>JSON.stringify(r)),byId=new Map(pack.entries.map((r,i)=>[Number(r[0]),i]));
const terminalSource=new Set(pack.entries.filter(r=>[1,3,5].includes(Number(r[3]))).map(r=>Number(r[1])).filter(Boolean));
const incomingSource=new Set(),incomingReader=new Set(),changed=[];
for(const r of audit.results){const id=Number(r.gcdId),sourceId=Number(r.sourceId),readerId=Number(r.readerId);if(r.kind!=='mu'||!r.functional||!r.reader?.ok||!sourceId||!readerId)throw new Error(`Resultado no publicable GCD ${id}`);if(r.drn)throw new Error(`DRN inesperado en GCD ${id}`);if(terminalSource.has(sourceId))throw new Error(`sourceId ya terminal ${sourceId}`);if(incomingSource.has(sourceId))throw new Error(`sourceId duplicado en lote ${sourceId}`);if(incomingReader.has(readerId))throw new Error(`readerId duplicado en lote ${readerId}`);incomingSource.add(sourceId);incomingReader.add(readerId);const pos=byId.get(id);if(pos==null)throw new Error(`GCD inexistente ${id}`);const cur=pack.entries[pos];if(Number(cur[3])!==4)throw new Error(`GCD ${id} dejó de ser status4`);if(fallback.has(id)&&fallback.get(id)!==String(readerId))throw new Error(`Fallback conflictivo GCD ${id}`);pack.entries[pos]=[id,sourceId,readerId,5,str(r.cover||cur[4]),''];fallback.set(id,String(readerId));changed.push(id)}
if(changed.length!==429)throw new Error(`Cambios=${changed.length}, esperado=429`);
const changedSet=new Set(changed);for(let i=0;i<pack.entries.length;i++)if(!changedSet.has(Number(pack.entries[i][0]))&&JSON.stringify(pack.entries[i])!==before[i])throw new Error(`Cambio fuera de scope GCD ${pack.entries[i][0]}`);
if(new Set(pack.entries.map(r=>Number(r[0]))).size!==51002)throw new Error('IDs GCD duplicados o perdidos.');
recompute(pack);if(pack.matched!==29102||pack.noDigital!==1131||pack.notListed!==20769||pack.linkReady!==25322||pack.linkMissing!==3780)throw new Error(`Conteos finales inesperados ${pack.matched}/${pack.noDigital}/${pack.notListed}/${pack.linkReady}/${pack.linkMissing}`);
pack.readerFallbackGcdIds=[...fallback.keys()].sort((a,b)=>a-b);pack.readerFallbackReady=fallback.size;pack.functionalLinkReady=pack.linkReady+pack.readerFallbackReady;pack.functionalLinkMissing=Math.max(0,pack.matched-pack.functionalLinkReady);if(pack.readerFallbackReady!==3780||pack.functionalLinkReady!==29102||pack.functionalLinkMissing!==0)throw new Error('Cobertura funcional final inesperada.');
pack.generatedAt=now;pack.officialCoverageAudit={...(pack.officialCoverageAudit||{}),identityMismatchPass:{completedAt:now,promotedMU:429,readerFunctional:429,remainingIdentityMismatch:64}};pack.functionalLinkAudit={...(pack.functionalLinkAudit||{}),completedAt:now,uuidReady:pack.linkReady,readerFallbackReady:pack.readerFallbackReady,functionalLinkReady:pack.functionalLinkReady,functionalLinkMissing:0,newIdentityMismatchReaderFallbacks:429};
const summary={version:4,publishedAt:now,changedRows:429,promotedMU:429,promotedReader:429,after:{matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed,linkReady:pack.linkReady,linkMissing:pack.linkMissing,readerFallbackReady:pack.readerFallbackReady,functionalLinkReady:pack.functionalLinkReady,functionalLinkMissing:pack.functionalLinkMissing},unchangedRows:50573};
await fs.writeFile(cacheFile,JSON.stringify(pack));await fs.writeFile(fallbackFile,renderFallback(fallback));await fs.writeFile(summaryFile,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
