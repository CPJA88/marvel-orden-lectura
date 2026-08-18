import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const auditFile=path.join(root,'artifacts','marvel-not-listed-v4','tail-a2-b-audit.json');
const fallbackFile=path.join(root,'source','marvel-reader-fallback-v1240.js');
const summaryFile=path.join(root,'artifacts','marvel-not-listed-v4','tail-a2-b-publish-summary.json');
const STATUS={MU:1,NO_DIGITAL:3,NOT_LISTED:4,MU_LINK_MISSING:5};
const DRN_RE=/^drn:src:marvel:unison::prod:[0-9a-f-]{36}$/i;
const str=v=>v==null?'':String(v);
const now=new Date().toISOString();

function renderFallback(targets){
  const rows=[...targets.entries()].sort((a,b)=>a[0]-b[0]).map(([id,r])=>`    [${id},'${r}'],`).join('\n');
  return `/* Marvel Lector v1.2.43 — fallback reader oficial verificado; generado por auditoría */\n(() => {\n  const SMART_BASE='https://marvel.smart.link/fiir7ec77';\n  const TARGETS=new Map([\n${rows}\n  ]);\n  function readerFallbackHref(m){if(!m||Number(m.preinstalledStatus)!==5)return '';const expected=TARGETS.get(Number(m.id));const readerId=String(m.readerId||'').trim();if(!expected||readerId!==expected||!/^\\d+$/.test(readerId))return '';return \`${'${SMART_BASE}'}?type=reader&drn=${'${encodeURIComponent(readerId)}'}\`;}\n  if(typeof unlimitedState==='function'){const base=unlimitedState;unlimitedState=function(m){if(readerFallbackHref(m))return{label:'Unlimited ✓',cls:'available'};return base(m);};}\n  if(typeof stableAppHref==='function'){const base=stableAppHref;stableAppHref=function(x,s){const m=typeof state!=='undefined'&&state?.marvel?state.marvel.get(Number(x?.id)):null;return readerFallbackHref(m)||base(x,s);};}\n  function repaintTargets(){if(typeof state==='undefined'||!state?.marvel||typeof updateRenderedMeta!=='function')return;for(const id of TARGETS.keys()){const m=state.marvel.get(id);if(m)updateRenderedMeta(id,m)}}\n  if(typeof requestAnimationFrame==='function')requestAnimationFrame(repaintTargets);if(typeof setTimeout==='function'){setTimeout(repaintTargets,500);setTimeout(repaintTargets,1800)}\n})();\n`;
}

function recompute(pack){
  const c=s=>pack.entries.filter(r=>Number(r[3])===s).length;
  pack.matched=c(STATUS.MU)+c(STATUS.MU_LINK_MISSING);
  pack.verifiedMU=pack.matched;
  pack.noDigital=c(STATUS.NO_DIGITAL);
  pack.unavailable=pack.noDigital;
  pack.notListed=c(STATUS.NOT_LISTED);
  pack.linkReady=pack.entries.filter(r=>Number(r[3])===STATUS.MU&&DRN_RE.test(str(r[5]))).length;
  pack.linkMissing=pack.entries.filter(r=>Number(r[3])===STATUS.MU_LINK_MISSING||Number(r[3])===STATUS.MU&&!DRN_RE.test(str(r[5]))).length;
}

const [pack,audit]=await Promise.all([
  fs.readFile(cacheFile,'utf8').then(JSON.parse),
  fs.readFile(auditFile,'utf8').then(JSON.parse),
]);
if(Number(pack.localCount)!==51002||pack.entries?.length!==51002||Number(pack.matched)!==29102||Number(pack.noDigital)!==1131||Number(pack.notListed)!==20769||Number(pack.functionalLinkMissing)!==0)throw new Error(`Baseline cambió: ${pack.matched}/${pack.noDigital}/${pack.notListed}/${pack.functionalLinkMissing}`);
if(Number(audit?.version)!==4||audit?.mode!=='tail-a2-b-audit'||audit?.summary?.writesCache!==false)throw new Error('Auditoría A2+B incompatible.');
const sa=audit.summary?.a2||{},sb=audit.summary?.b||{};
if(Number(sa.targets)!==64||Number(sa.recoverable)!==3||Number(sa.mu)!==3||Number(sa.noDigital)!==0||Number(sa.unresolved)!==61)throw new Error('Resumen A2 cambió.');
if(Number(sb.targets)!==98||Number(sb.uniqueRecovered)!==0||Number(sb.mu)!==0||Number(sb.noDigital)!==0||Number(sb.noCandidate)!==98||Number(sb.ambiguous)!==0)throw new Error('Resumen B cambió.');

const before=pack.entries.map(r=>JSON.stringify(r));
const byId=new Map(pack.entries.map((r,i)=>[Number(r[0]),i]));
const oldFallback=new Map();
for(const id of pack.readerFallbackGcdIds||[]){
  const row=pack.entries[byId.get(Number(id))];
  if(!row||Number(row[3])!==STATUS.MU_LINK_MISSING||!Number(row[2]))throw new Error(`Fallback previo inválido ${id}`);
  oldFallback.set(Number(id),String(Number(row[2])));
}
if(oldFallback.size!==Number(pack.readerFallbackReady))throw new Error('Conteo fallback previo inconsistente.');

const proposals=(audit.a2||[]).filter(x=>x.recoverable&&x.selected).map(x=>({gcdId:Number(x.gcdId),kind:x.proposedKind,selected:x.selected}));
if(proposals.length!==3||new Set(proposals.map(x=>x.gcdId)).size!==3||proposals.some(x=>x.kind!=='mu'))throw new Error('Scope publicable A2 distinto de 3 MU.');
if((audit.b||[]).some(x=>x.unique&&x.selected))throw new Error('B contiene una propuesta inesperada.');

const terminalOwners=new Map();
for(const r of pack.entries){
  const sid=Number(r[1])||0;
  if(!sid||![1,3,5].includes(Number(r[3])))continue;
  const a=terminalOwners.get(sid)||[];a.push(Number(r[0]));terminalOwners.set(sid,a);
}
const selectedSourceIds=new Set(),changed=[];
let promotedReader=0,promotedUuid=0;
for(const p of proposals){
  const pos=byId.get(p.gcdId);if(pos==null)throw new Error(`GCD inexistente ${p.gcdId}`);
  const cur=pack.entries[pos];if(Number(cur[3])!==STATUS.NOT_LISTED)throw new Error(`GCD ${p.gcdId} dejó status4`);
  const s=p.selected,sid=Number(s.sourceId)||0;if(!sid)throw new Error(`Sin sourceId ${p.gcdId}`);
  if(terminalOwners.has(sid)||selectedSourceIds.has(sid))throw new Error(`sourceId ${sid} colisiona`);selectedSourceIds.add(sid);
  if(s.availability!=='mu'||!s.functional||!s.reader?.ok)throw new Error(`MU no funcional ${p.gcdId}`);
  const uuidOk=Boolean(s.uuid?.ok&&DRN_RE.test(str(s.drn))),readerOk=Boolean(Number(s.readerId));
  if(uuidOk){pack.entries[pos]=[p.gcdId,sid,Number(s.readerId)||0,STATUS.MU,str(s.cover),str(s.drn).toLowerCase()];promotedUuid++;}
  else if(readerOk){pack.entries[pos]=[p.gcdId,sid,Number(s.readerId),STATUS.MU_LINK_MISSING,str(s.cover),''];promotedReader++;}
  else throw new Error(`MU sin identificador publicable ${p.gcdId}`);
  changed.push(p.gcdId);
}

const changedSet=new Set(changed);
for(let i=0;i<pack.entries.length;i++)if(!changedSet.has(Number(pack.entries[i][0]))&&JSON.stringify(pack.entries[i])!==before[i])throw new Error(`Cambio fuera de scope ${pack.entries[i][0]}`);
if(new Set(pack.entries.map(r=>Number(r[0]))).size!==51002)throw new Error('IDs GCD alterados.');
recompute(pack);
const fallback=new Map();
for(const r of pack.entries)if(Number(r[3])===STATUS.MU_LINK_MISSING){if(!Number(r[2]))throw new Error(`status5 sin readerId ${r[0]}`);fallback.set(Number(r[0]),String(Number(r[2])))}
for(const [id,r] of oldFallback)if(fallback.get(id)!==r)throw new Error(`Se alteró fallback previo ${id}`);
pack.readerFallbackGcdIds=[...fallback.keys()].sort((a,b)=>a-b);
pack.readerFallbackReady=fallback.size;
pack.functionalLinkReady=pack.linkReady+pack.readerFallbackReady;
pack.functionalLinkMissing=Math.max(0,pack.matched-pack.functionalLinkReady);
if(pack.matched!==29105||pack.noDigital!==1131||pack.notListed!==20766||pack.functionalLinkMissing!==0)throw new Error(`Conteos finales inesperados ${pack.matched}/${pack.noDigital}/${pack.notListed}/${pack.functionalLinkMissing}`);
pack.generatedAt=now;
pack.tailAudit={version:4,completedAt:now,a2Targets:64,bTargets:98,promotedMU:3,confirmedNoDigital:0,remainingNotListed:pack.notListed};
pack.functionalLinkAudit={...(pack.functionalLinkAudit||{}),completedAt:now,uuidReady:pack.linkReady,readerFallbackReady:pack.readerFallbackReady,functionalLinkReady:pack.functionalLinkReady,functionalLinkMissing:0};
const summary={version:4,publishedAt:now,changedRows:3,promotedMU:3,promotedReader,promotedUuid,confirmedNoDigital:0,byOrigin:{a2:3,b:0},after:{matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed,linkReady:pack.linkReady,linkMissing:pack.linkMissing,readerFallbackReady:pack.readerFallbackReady,functionalLinkReady:pack.functionalLinkReady,functionalLinkMissing:pack.functionalLinkMissing},unchangedRows:50999};
await fs.writeFile(cacheFile,JSON.stringify(pack));
await fs.writeFile(fallbackFile,renderFallback(fallback));
await fs.mkdir(path.dirname(summaryFile),{recursive:true});
await fs.writeFile(summaryFile,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
