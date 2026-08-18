import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const auditFile=path.join(root,'artifacts','marvel-not-listed-v4','alias-series-harvest-v4.json');
const fallbackFile=path.join(root,'source','marvel-reader-fallback-v1240.js');
const summaryFile=path.join(root,'artifacts','marvel-not-listed-v4','alias-series-harvest-publish-summary-v4.json');
const STATUS={MU:1,NO_DIGITAL:3,NOT_LISTED:4,MU_READER:5};
const DRN_RE=/^drn:src:marvel:unison::prod:[0-9a-f-]{36}$/i;
const str=v=>v==null?'':String(v);
const now=new Date().toISOString();

function renderFallback(targets){
  const rows=[...targets.entries()].sort((a,b)=>a[0]-b[0]).map(([id,r])=>`    [${id},'${r}'],`).join('\n');
  return `/* Marvel Lector v1.2.48 — fallback reader oficial verificado; generado por auditoría */\n(() => {\n  const SMART_BASE='https://marvel.smart.link/fiir7ec77';\n  const TARGETS=new Map([\n${rows}\n  ]);\n  function readerFallbackHref(m){if(!m||Number(m.preinstalledStatus)!==5)return '';const expected=TARGETS.get(Number(m.id));const readerId=String(m.readerId||'').trim();if(!expected||readerId!==expected||!/^\\d+$/.test(readerId))return '';return \`${'${SMART_BASE}'}?type=reader&drn=${'${encodeURIComponent(readerId)}'}\`;}\n  if(typeof unlimitedState==='function'){const base=unlimitedState;unlimitedState=function(m){if(readerFallbackHref(m))return{label:'Unlimited ✓',cls:'available'};return base(m);};}\n  if(typeof stableAppHref==='function'){const base=stableAppHref;stableAppHref=function(x,s){const m=typeof state!=='undefined'&&state?.marvel?state.marvel.get(Number(x?.id)):null;return readerFallbackHref(m)||base(x,s);};}\n  function repaintTargets(){if(typeof state==='undefined'||!state?.marvel||typeof updateRenderedMeta!=='function')return;for(const id of TARGETS.keys()){const m=state.marvel.get(id);if(m)updateRenderedMeta(id,m)}}\n  if(typeof requestAnimationFrame==='function')requestAnimationFrame(repaintTargets);if(typeof setTimeout==='function'){setTimeout(repaintTargets,500);setTimeout(repaintTargets,1800)}\n})();\n`;
}
function recompute(pack){
  const c=s=>pack.entries.filter(r=>Number(r[3])===s).length;
  pack.matched=c(STATUS.MU)+c(STATUS.MU_READER);pack.verifiedMU=pack.matched;
  pack.noDigital=c(STATUS.NO_DIGITAL);pack.unavailable=pack.noDigital;pack.notListed=c(STATUS.NOT_LISTED);
  pack.linkReady=pack.entries.filter(r=>Number(r[3])===STATUS.MU&&DRN_RE.test(str(r[5]))).length;
  pack.linkMissing=pack.entries.filter(r=>Number(r[3])===STATUS.MU_READER||(Number(r[3])===STATUS.MU&&!DRN_RE.test(str(r[5])))).length;
}

const [pack,audit]=await Promise.all([fs.readFile(cacheFile,'utf8').then(JSON.parse),fs.readFile(auditFile,'utf8').then(JSON.parse)]);
if(Number(pack.localCount)!==51002||pack.entries?.length!==51002||Number(pack.matched)!==29106||Number(pack.noDigital)!==1131||Number(pack.notListed)!==20765||Number(pack.linkReady)!==25322||Number(pack.readerFallbackReady)!==3784||Number(pack.functionalLinkReady)!==29106||Number(pack.functionalLinkMissing)!==0)throw new Error(`Baseline cambió: ${pack.localCount}/${pack.matched}/${pack.noDigital}/${pack.notListed}/${pack.linkReady}/${pack.readerFallbackReady}/${pack.functionalLinkReady}/${pack.functionalLinkMissing}`);
if(Number(audit?.version)!==4||audit?.mode!=='alias-series-harvest-v4'||Number(audit?.summary?.targets)!==54||Number(audit?.summary?.unique)!==35||Number(audit?.summary?.mu)!==31||Number(audit?.summary?.noDigital)!==4||Number(audit?.summary?.ambiguous)!==0||Number(audit?.summary?.noCandidate)!==19||audit?.summary?.writesCache===true)throw new Error('Auditoría de series incompatible o inesperada.');
const selected=(audit.rows||[]).filter(x=>x.kind==='unique'&&x.selected);
if(selected.length!==35)throw new Error(`Esperaba 35 seleccionados, obtuvo ${selected.length}`);
const mus=selected.filter(x=>x.selected.availability==='mu');
const nod=selected.filter(x=>x.selected.availability==='no-digital');
if(mus.length!==31||nod.length!==4)throw new Error(`Scope inesperado MU/NO_DIGITAL ${mus.length}/${nod.length}`);
for(const x of mus)if(!x.selected.functional||!x.selected.reader?.ok||!Number(x.selected.readerId)||!Number(x.selected.sourceId))throw new Error(`MU sin evidencia funcional GCD ${x.gcdId}`);
for(const x of nod)if(!Number(x.selected.sourceId))throw new Error(`NO_DIGITAL sin sourceId GCD ${x.gcdId}`);

const byId=new Map(pack.entries.map((r,i)=>[Number(r[0]),i]));
const terminalOwners=new Map();
for(const r of pack.entries){const sid=Number(r[1])||0;if(!sid||![STATUS.MU,STATUS.NO_DIGITAL,STATUS.MU_READER].includes(Number(r[3])))continue;const a=terminalOwners.get(sid)||[];a.push(Number(r[0]));terminalOwners.set(sid,a)}
const incomingSources=new Set(),incomingGcd=new Set();
for(const x of selected){const id=Number(x.gcdId),sid=Number(x.selected.sourceId);if(!id||!sid||incomingGcd.has(id)||incomingSources.has(sid))throw new Error(`Duplicado entrante GCD/source ${id}/${sid}`);incomingGcd.add(id);incomingSources.add(sid);const pos=byId.get(id);if(pos==null||Number(pack.entries[pos][3])!==STATUS.NOT_LISTED)throw new Error(`GCD ${id} ya no está pendiente`);const owners=terminalOwners.get(sid)||[];if(owners.some(owner=>owner!==id))throw new Error(`sourceId ${sid} ocupado por terminal ${owners.join(',')}`)}

const before=pack.entries.map(r=>JSON.stringify(r));
for(const x of selected){const id=Number(x.gcdId),pos=byId.get(id),cur=pack.entries[pos],cover=str(x.selected.cover||cur[4]);if(x.selected.availability==='mu')pack.entries[pos]=[id,Number(x.selected.sourceId),Number(x.selected.readerId),STATUS.MU_READER,cover,''];else pack.entries[pos]=[id,Number(x.selected.sourceId),0,STATUS.NO_DIGITAL,cover,'']}
for(let i=0;i<pack.entries.length;i++){if(incomingGcd.has(Number(pack.entries[i][0])))continue;if(JSON.stringify(pack.entries[i])!==before[i])throw new Error(`Cambio fuera de scope GCD ${pack.entries[i][0]}`)}
if(new Set(pack.entries.map(r=>Number(r[0]))).size!==51002)throw new Error('IDs GCD duplicados o perdidos.');
recompute(pack);
const fallback=new Map();for(const r of pack.entries){if(Number(r[3])!==STATUS.MU_READER)continue;const rid=Number(r[2]);if(!rid)throw new Error(`status5 sin readerId: ${r[0]}`);fallback.set(Number(r[0]),String(rid))}
pack.readerFallbackGcdIds=[...fallback.keys()].sort((a,b)=>a-b);pack.readerFallbackReady=fallback.size;pack.functionalLinkReady=pack.linkReady+pack.readerFallbackReady;pack.functionalLinkMissing=Math.max(0,pack.matched-pack.functionalLinkReady);
if(pack.matched!==29137||pack.noDigital!==1135||pack.notListed!==20730||pack.linkReady!==25322||pack.linkMissing!==3815||pack.readerFallbackReady!==3815||pack.functionalLinkReady!==29137||pack.functionalLinkMissing!==0)throw new Error(`Conteos finales inesperados: ${pack.matched}/${pack.noDigital}/${pack.notListed}/${pack.linkReady}/${pack.linkMissing}/${pack.readerFallbackReady}/${pack.functionalLinkReady}/${pack.functionalLinkMissing}`);
for(const x of mus)if(fallback.get(Number(x.gcdId))!==String(Number(x.selected.readerId)))throw new Error(`Fallback nuevo incorrecto GCD ${x.gcdId}`);
pack.generatedAt=now;pack.seriesHarvestAudit={version:4,completedAt:now,publishedGcdIds:selected.map(x=>Number(x.gcdId)).sort((a,b)=>a-b),promotedMU:31,confirmedNoDigital:4,remainingFrom54:19,remainingNotListed:pack.notListed};
pack.functionalLinkAudit={...(pack.functionalLinkAudit||{}),completedAt:now,uuidReady:pack.linkReady,readerFallbackReady:pack.readerFallbackReady,functionalLinkReady:pack.functionalLinkReady,functionalLinkMissing:0};
pack.linkAudit={...(pack.linkAudit||{}),allLinksVerified:pack.linkMissing===0,linkMissing:pack.linkMissing,updatedAt:now};
const summary={version:4,publishedAt:now,changedRows:35,promotedMU:31,promotedReader:31,promotedUuid:0,confirmedNoDigital:4,remainingFrom54:19,after:{matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed,linkReady:pack.linkReady,linkMissing:pack.linkMissing,readerFallbackReady:pack.readerFallbackReady,functionalLinkReady:pack.functionalLinkReady,functionalLinkMissing:pack.functionalLinkMissing},unchangedRows:50967};
await fs.writeFile(cacheFile,JSON.stringify(pack));await fs.writeFile(fallbackFile,renderFallback(fallback));await fs.mkdir(path.dirname(summaryFile),{recursive:true});await fs.writeFile(summaryFile,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
