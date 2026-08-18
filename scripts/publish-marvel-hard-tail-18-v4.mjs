import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const auditFile=path.join(root,'artifacts','marvel-not-listed-v4','hard-tail-a3-b2-v4.json');
const fallbackFile=path.join(root,'source','marvel-reader-fallback-v1240.js');
const summaryFile=path.join(root,'artifacts','marvel-not-listed-v4','hard-tail-18-publish-summary-v4.json');
const STATUS={MU:1,NO_DIGITAL:3,NOT_LISTED:4,MU_LINK_MISSING:5};
const DRN_RE=/^drn:src:marvel:unison::prod:[0-9a-f-]{36}$/i;
const str=v=>v==null?'':String(v);
const now=new Date().toISOString();
const EXPECTED=new Map([
  [1875111,[71459,49770,'Uncanny X-Men (2018) #2']],
  [2656662,[115381,68524,'Uncanny X-Men (2024) #2']],
  [2660595,[115382,68526,'Uncanny X-Men (2024) #3']],
  [2667492,[115383,68946,'Uncanny X-Men (2024) #4']],
  [2677596,[115384,69181,'Uncanny X-Men (2024) #5']],
  [2683449,[115385,69182,'Uncanny X-Men (2024) #6']],
  [2686316,[115386,69971,'Uncanny X-Men (2024) #7']],
  [2694917,[115387,69972,'Uncanny X-Men (2024) #8']],
  [2703220,[115388,71160,'Uncanny X-Men (2024) #9']],
  [2711655,[115389,69594,'Uncanny X-Men (2024) #10']],
  [2716445,[115390,72242,'Uncanny X-Men (2024) #11']],
  [2719439,[115391,71486,'Uncanny X-Men (2024) #12']],
  [2722988,[115392,71487,'Uncanny X-Men (2024) #13']],
  [2734699,[115393,73143,'Uncanny X-Men (2024) #14']],
  [2741307,[115394,73144,'Uncanny X-Men (2024) #15']],
  [2749778,[115395,73887,'Uncanny X-Men (2024) #16']],
  [2755222,[115396,74290,'Uncanny X-Men (2024) #17']],
  [2767858,[119442,75542,'Uncanny X-Men (2024) #20']],
]);

function renderFallback(targets){
  const rows=[...targets.entries()].sort((a,b)=>a[0]-b[0]).map(([id,r])=>`    [${id},'${r}'],`).join('\n');
  return `/* Marvel Lector v1.2.50 — fallback reader oficial verificado; generado por auditoría */\n(() => {\n  const SMART_BASE='https://marvel.smart.link/fiir7ec77';\n  const TARGETS=new Map([\n${rows}\n  ]);\n  function readerFallbackHref(m){if(!m||Number(m.preinstalledStatus)!==5)return '';const expected=TARGETS.get(Number(m.id));const readerId=String(m.readerId||'').trim();if(!expected||readerId!==expected||!/^\\d+$/.test(readerId))return '';return `${'${SMART_BASE}'}?type=reader&drn=${'${encodeURIComponent(readerId)}'}`;}\n  if(typeof unlimitedState==='function'){const base=unlimitedState;unlimitedState=function(m){if(readerFallbackHref(m))return{label:'Unlimited ✓',cls:'available'};return base(m);};}\n  if(typeof stableAppHref==='function'){const base=stableAppHref;stableAppHref=function(x,s){const m=typeof state!=='undefined'&&state?.marvel?state.marvel.get(Number(x?.id)):null;return readerFallbackHref(m)||base(x,s);};}\n  function repaintTargets(){if(typeof state==='undefined'||!state?.marvel||typeof updateRenderedMeta!=='function')return;for(const id of TARGETS.keys()){const m=state.marvel.get(id);if(m)updateRenderedMeta(id,m)}}\n  if(typeof requestAnimationFrame==='function')requestAnimationFrame(repaintTargets);if(typeof setTimeout==='function'){setTimeout(repaintTargets,500);setTimeout(repaintTargets,1800)}\n})();\n`;
}
function recompute(pack){
  const c=s=>pack.entries.filter(r=>Number(r[3])===s).length;
  pack.matched=c(STATUS.MU)+c(STATUS.MU_LINK_MISSING);pack.verifiedMU=pack.matched;
  pack.noDigital=c(STATUS.NO_DIGITAL);pack.unavailable=pack.noDigital;pack.notListed=c(STATUS.NOT_LISTED);
  pack.linkReady=pack.entries.filter(r=>Number(r[3])===STATUS.MU&&DRN_RE.test(str(r[5]))).length;
  pack.linkMissing=pack.entries.filter(r=>Number(r[3])===STATUS.MU_LINK_MISSING||(Number(r[3])===STATUS.MU&&!DRN_RE.test(str(r[5])))).length;
}

const [pack,audit]=await Promise.all([fs.readFile(cacheFile,'utf8').then(JSON.parse),fs.readFile(auditFile,'utf8').then(JSON.parse)]);
if(Number(pack.localCount)!==51002||pack.entries?.length!==51002||Number(pack.matched)!==29137||Number(pack.noDigital)!==1135||Number(pack.notListed)!==20730||Number(pack.functionalLinkMissing)!==0)throw new Error(`Baseline cambió: ${pack.localCount}/${pack.matched}/${pack.noDigital}/${pack.notListed}/${pack.functionalLinkMissing}`);
if(Number(audit?.version)!==4||audit?.mode!=='hard-tail-a3-b2-v4'||Number(audit?.summary?.unionTargets)!==177||Number(audit?.summary?.uniqueTotal)!==18||Number(audit?.summary?.muTotal)!==18||Number(audit?.summary?.noDigitalTotal)!==0||Number(audit?.summary?.strongUnnumberedTotal)!==49||audit?.summary?.writesCache===true)throw new Error('Auditoría hard-tail incompatible.');
const good=(audit.rows||[]).filter(x=>x.kind==='unique'&&x.proposedKind==='mu'&&x.selected?.functional&&x.selected?.reader?.ok);
if(good.length!==18)throw new Error(`Scope publicable=${good.length}, esperado=18.`);
const seenSources=new Set();
for(const x of good){
  const exp=EXPECTED.get(Number(x.gcdId));if(!exp)throw new Error(`GCD inesperado ${x.gcdId}`);
  if(Number(x.selected.sourceId)!==exp[0]||Number(x.selected.readerId)!==exp[1]||x.selected.officialTitle!==exp[2]||x.selected.availability!=='mu'||!x.selected.strict)throw new Error(`Evidencia divergente GCD ${x.gcdId}`);
  if(seenSources.has(exp[0]))throw new Error(`sourceId repetido ${exp[0]}`);seenSources.add(exp[0]);
}
if(new Set(good.map(x=>Number(x.gcdId))).size!==EXPECTED.size||[...EXPECTED.keys()].some(id=>!good.some(x=>Number(x.gcdId)===id)))throw new Error('Lista exacta de 18 no coincide.');
const byId=new Map(pack.entries.map((r,i)=>[Number(r[0]),i]));
const before=pack.entries.map(r=>JSON.stringify(r));
for(const x of good){
  const id=Number(x.gcdId),sid=Number(x.selected.sourceId),rid=Number(x.selected.readerId),pos=byId.get(id);if(pos==null)throw new Error(`Falta GCD ${id}`);
  const cur=pack.entries[pos];if(Number(cur[3])!==STATUS.NOT_LISTED)throw new Error(`GCD ${id} ya no está pendiente.`);
  for(const r of pack.entries){if(Number(r[0])===id)continue;if(Number(r[1])===sid&&[STATUS.MU,STATUS.NO_DIGITAL,STATUS.MU_LINK_MISSING].includes(Number(r[3])))throw new Error(`sourceId ${sid} ocupado por GCD ${r[0]}`)}
  pack.entries[pos]=[id,sid,rid,STATUS.MU_LINK_MISSING,str(cur[4]),''];
}
const changed=new Set(EXPECTED.keys());for(let i=0;i<pack.entries.length;i++)if(!changed.has(Number(pack.entries[i][0]))&&JSON.stringify(pack.entries[i])!==before[i])throw new Error(`Cambio fuera de scope ${pack.entries[i][0]}`);
if(new Set(pack.entries.map(r=>Number(r[0]))).size!==51002)throw new Error('IDs GCD duplicados o perdidos.');
recompute(pack);
const fallback=new Map();for(const r of pack.entries){if(Number(r[3])!==STATUS.MU_LINK_MISSING)continue;const rid=Number(r[2]);if(!rid)throw new Error(`status5 sin readerId ${r[0]}`);fallback.set(Number(r[0]),String(rid));}
pack.readerFallbackGcdIds=[...fallback.keys()].sort((a,b)=>a-b);pack.readerFallbackReady=fallback.size;pack.functionalLinkReady=pack.linkReady+pack.readerFallbackReady;pack.functionalLinkMissing=Math.max(0,pack.matched-pack.functionalLinkReady);
if(pack.matched!==29155||pack.noDigital!==1135||pack.notListed!==20712||pack.linkReady!==25322||pack.readerFallbackReady!==3833||pack.functionalLinkReady!==29155||pack.functionalLinkMissing!==0)throw new Error(`Conteos inesperados ${pack.matched}/${pack.noDigital}/${pack.notListed}/${pack.linkReady}/${pack.readerFallbackReady}/${pack.functionalLinkReady}/${pack.functionalLinkMissing}`);
for(const [id,[,rid]] of EXPECTED)if(fallback.get(id)!==String(rid))throw new Error(`Fallback incorrecto ${id}`);
pack.generatedAt=now;pack.hardTailAudit={version:4,completedAt:now,publishedStrict18:[...EXPECTED.keys()].sort((a,b)=>a-b),strongUnnumberedPending:49,notFoundPending:98,remainingIdentityPending:61};
pack.functionalLinkAudit={...(pack.functionalLinkAudit||{}),completedAt:now,uuidReady:pack.linkReady,readerFallbackReady:pack.readerFallbackReady,functionalLinkReady:pack.functionalLinkReady,functionalLinkMissing:0};
const summary={version:4,publishedAt:now,changedRows:18,promotedMU:18,promotedReader:18,promotedUuid:0,confirmedNoDigital:0,strongUnnumberedDeferred:49,after:{matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed,linkReady:pack.linkReady,linkMissing:pack.linkMissing,readerFallbackReady:pack.readerFallbackReady,functionalLinkReady:pack.functionalLinkReady,functionalLinkMissing:pack.functionalLinkMissing},published:good.map(x=>({gcdId:Number(x.gcdId),sourceId:Number(x.selected.sourceId),readerId:Number(x.selected.readerId),title:x.selected.officialTitle})).sort((a,b)=>a.gcdId-b.gcdId),unchangedRows:50984};
await fs.writeFile(cacheFile,JSON.stringify(pack));await fs.writeFile(fallbackFile,renderFallback(fallback));await fs.mkdir(path.dirname(summaryFile),{recursive:true});await fs.writeFile(summaryFile,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
