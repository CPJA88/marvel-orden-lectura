import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const resultsFile=path.join(root,'artifacts','marvel-not-listed-v4','exact-v4-results.json');
const fallbackFile=path.join(root,'source','marvel-reader-fallback-v1240.js');
const publishSummaryFile=path.join(root,'artifacts','marvel-not-listed-v4','publish-summary.json');
const STATUS={MU:1,NO_DIGITAL:3,NOT_LISTED:4,MU_LINK_MISSING:5};
const DRN_RE=/^drn:src:marvel:unison::prod:[0-9a-f-]{36}$/i;
const ORIGINAL_READER_FALLBACKS=new Map([
  [29395,'55204'],[29387,'55203'],[60401,'73928'],[338373,'535'],[521503,'6307'],[521504,'6308'],[1244835,'34127'],
]);
const str=v=>v==null?'':String(v);
const now=new Date().toISOString();

function count(pack,status){return pack.entries.filter(r=>Number(r?.[3])===status).length}
function recompute(pack){
  const c1=count(pack,STATUS.MU),c5=count(pack,STATUS.MU_LINK_MISSING),c3=count(pack,STATUS.NO_DIGITAL),c4=count(pack,STATUS.NOT_LISTED);
  pack.matched=c1+c5;pack.verifiedMU=pack.matched;pack.unavailable=c3;pack.noDigital=c3;pack.notListed=c4;
  pack.linkReady=pack.entries.filter(r=>Number(r?.[3])===STATUS.MU&&DRN_RE.test(str(r?.[5]))).length;
  pack.linkMissing=pack.entries.filter(r=>Number(r?.[3])===STATUS.MU_LINK_MISSING||Number(r?.[3])===STATUS.MU&&!DRN_RE.test(str(r?.[5]))).length;
  pack.linksPrebuilt=pack.linkMissing===0;
  return pack;
}
function renderFallback(targets){
  const rows=[...targets.entries()].sort((a,b)=>a[0]-b[0]).map(([id,reader])=>`    [${id},'${reader}'],`).join('\n');
  return `/* Marvel Lector v1.2.41 — fallback reader oficial verificado; generado por auditoría */\n(() => {\n  const SMART_BASE='https://marvel.smart.link/fiir7ec77';\n  const TARGETS=new Map([\n${rows}\n  ]);\n\n  function readerFallbackHref(m){\n    if(!m||Number(m.preinstalledStatus)!==5)return '';\n    const expected=TARGETS.get(Number(m.id));\n    const readerId=String(m.readerId||'').trim();\n    if(!expected||readerId!==expected||!/^\\d+$/.test(readerId))return '';\n    return \`${'${SMART_BASE}'}?type=reader&drn=${'${encodeURIComponent(readerId)}'}\`;\n  }\n\n  if(typeof unlimitedState==='function'){\n    const baseUnlimitedState=unlimitedState;\n    unlimitedState=function(m){\n      if(readerFallbackHref(m))return{label:'Unlimited ✓',cls:'available'};\n      return baseUnlimitedState(m);\n    };\n  }\n\n  if(typeof stableAppHref==='function'){\n    const baseStableAppHref=stableAppHref;\n    stableAppHref=function(x,s){\n      const m=typeof state!=='undefined'&&state?.marvel?state.marvel.get(Number(x?.id)):null;\n      return readerFallbackHref(m)||baseStableAppHref(x,s);\n    };\n  }\n\n  function repaintTargets(){\n    if(typeof state==='undefined'||!state?.marvel||typeof updateRenderedMeta!=='function')return;\n    for(const id of TARGETS.keys()){const m=state.marvel.get(id);if(m)updateRenderedMeta(id,m)}\n  }\n  if(typeof requestAnimationFrame==='function')requestAnimationFrame(repaintTargets);\n  if(typeof setTimeout==='function'){setTimeout(repaintTargets,500);setTimeout(repaintTargets,1800)}\n})();\n`;
}

const [pack,research]=await Promise.all([fs.readFile(cacheFile,'utf8').then(JSON.parse),fs.readFile(resultsFile,'utf8').then(JSON.parse)]);
if(Number(pack.localCount)!==51002||pack.entries?.length!==51002)throw new Error('Caché base inválida.');
if(Number(pack.matched)!==25329||Number(pack.noDigital)!==1057||Number(pack.notListed)!==24616||Number(pack.linkReady)!==25322||Number(pack.linkMissing)!==7)throw new Error(`Baseline cambió antes de publicar: MU=${pack.matched}, noDigital=${pack.noDigital}, notListed=${pack.notListed}, linkReady=${pack.linkReady}, linkMissing=${pack.linkMissing}`);
if(Number(research?.version)!==4||!Array.isArray(research?.results)||Number(research?.summary?.totalCandidates)!==4009||research.results.length!==4009)throw new Error('Resultado exact-v4 incompleto o incompatible.');
if(Number(research.summary.safetyFailure)!==0)throw new Error(`Safety failures=${research.summary.safetyFailure}`);

const before=pack.entries.map(r=>JSON.stringify(r)),byId=new Map(pack.entries.map((r,i)=>[Number(r[0]),i]));
const fallbackTargets=new Map(ORIGINAL_READER_FALLBACKS);let promotedMU=0,promotedUuid=0,promotedReader=0,promotedPendingLink=0,confirmedNoDigital=0;
const changedIds=[];
for(const r of research.results){
  if(r.kind!=='mu'&&r.kind!=='no-digital')continue;
  const id=Number(r.gcdId),pos=byId.get(id);if(pos==null)throw new Error(`GCD ${id} no existe.`);const current=pack.entries[pos];if(Number(current[3])!==STATUS.NOT_LISTED)throw new Error(`GCD ${id} dejó de ser NOT_LISTED antes de publicar.`);
  if(r.kind==='no-digital'){
    if(!Number(r.sourceId))throw new Error(`NO_DIGITAL sin sourceId: ${id}`);
    pack.entries[pos]=[id,Number(r.sourceId),0,STATUS.NO_DIGITAL,str(r.cover),''];confirmedNoDigital++;changedIds.push(id);continue;
  }
  if(!Number(r.sourceId))throw new Error(`MU sin sourceId: ${id}`);
  const uuidOk=Boolean(r.uuid?.ok&&DRN_RE.test(str(r.drn))),readerOk=Boolean(r.reader?.ok&&Number(r.readerId));
  if(uuidOk){pack.entries[pos]=[id,Number(r.sourceId),Number(r.readerId)||0,STATUS.MU,str(r.cover),str(r.drn).toLowerCase()];promotedUuid++}
  else if(readerOk){pack.entries[pos]=[id,Number(r.sourceId),Number(r.readerId),STATUS.MU_LINK_MISSING,str(r.cover),''];fallbackTargets.set(id,String(Number(r.readerId)));promotedReader++}
  else{pack.entries[pos]=[id,Number(r.sourceId),0,STATUS.MU_LINK_MISSING,str(r.cover),''];promotedPendingLink++}
  promotedMU++;changedIds.push(id);
}

const changedSet=new Set(changedIds);for(let i=0;i<pack.entries.length;i++)if(!changedSet.has(Number(pack.entries[i][0]))&&JSON.stringify(pack.entries[i])!==before[i])throw new Error(`Regresión fuera del scope en GCD ${pack.entries[i][0]}.`);
if(new Set(pack.entries.map(r=>Number(r[0]))).size!==51002)throw new Error('IDs GCD duplicados o perdidos.');
for(const [id,reader] of ORIGINAL_READER_FALLBACKS){const row=pack.entries[byId.get(id)];if(Number(row?.[3])!==STATUS.MU_LINK_MISSING||String(Number(row?.[2])||'')!==reader)throw new Error(`Se alteró el fallback original GCD ${id}.`)}

recompute(pack);const expectedMatched=25329+promotedMU,expectedNoDigital=1057+confirmedNoDigital,expectedNotListed=24616-promotedMU-confirmedNoDigital;
if(pack.matched!==expectedMatched||pack.noDigital!==expectedNoDigital||pack.notListed!==expectedNotListed)throw new Error(`Conteos inesperados tras merge: ${pack.matched}/${pack.noDigital}/${pack.notListed}`);
pack.readerFallbackGcdIds=[...fallbackTargets.keys()].sort((a,b)=>a-b);pack.readerFallbackReady=fallbackTargets.size;pack.functionalLinkReady=pack.linkReady+pack.readerFallbackReady;pack.functionalLinkMissing=Math.max(0,pack.matched-pack.functionalLinkReady);
pack.generatedAt=now;pack.officialCoverageAudit={...(pack.officialCoverageAudit||{}),version:4,completed:true,completedAt:now,authority:'marvel.com/comics/issue plus share.marvel.com/sharing/reader; discovery candidates only from exact normalized title + issue number + publication year',exactCandidatePass:{candidateCount:4009,promotedMU,confirmedNoDigital,remainingUnresolvedFromPass:4009-promotedMU-confirmedNoDigital,remainingNotListed:pack.notListed}};
pack.functionalLinkAudit={version:1,completedAt:now,uuidReady:pack.linkReady,readerFallbackReady:pack.readerFallbackReady,functionalLinkReady:pack.functionalLinkReady,functionalLinkMissing:pack.functionalLinkMissing,originalReaderFallbacks:ORIGINAL_READER_FALLBACKS.size,newReaderFallbacks:promotedReader,newUuidLinks:promotedUuid,newMuLinkPending:promotedPendingLink};
pack.linkAudit={...(pack.linkAudit||{}),allLinksVerified:pack.linkMissing===0,linkMissing:pack.linkMissing,updatedAt:now};

const publishSummary={version:4,publishedAt:now,changedRows:changedIds.length,promotedMU,promotedUuid,promotedReader,promotedPendingLink,confirmedNoDigital,after:{matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed,linkReady:pack.linkReady,linkMissing:pack.linkMissing,readerFallbackReady:pack.readerFallbackReady,functionalLinkReady:pack.functionalLinkReady,functionalLinkMissing:pack.functionalLinkMissing},unchangedRows:51002-changedIds.length};
await fs.mkdir(path.dirname(publishSummaryFile),{recursive:true});await fs.writeFile(cacheFile,JSON.stringify(pack));await fs.writeFile(fallbackFile,renderFallback(fallbackTargets));await fs.writeFile(publishSummaryFile,JSON.stringify(publishSummary,null,2)+'\n');console.log(JSON.stringify(publishSummary,null,2));
