import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const auditFile=path.join(root,'artifacts','marvel-not-listed-v4','alias-official-audit-v4.json');
const fallbackFile=path.join(root,'source','marvel-reader-fallback-v1240.js');
const summaryFile=path.join(root,'artifacts','marvel-not-listed-v4','alias-official-publish-summary-v4.json');
const STATUS={MU:1,NO_DIGITAL:3,NOT_LISTED:4,MU_LINK_MISSING:5};
const DRN_RE=/^drn:src:marvel:unison::prod:[0-9a-f-]{36}$/i;
const str=v=>v==null?'':String(v);
const now=new Date().toISOString();

function renderFallback(targets){
  const rows=[...targets.entries()].sort((a,b)=>a[0]-b[0]).map(([id,r])=>`    [${id},'${r}'],`).join('\n');
  return `/* Marvel Lector v1.2.45 — fallback reader oficial verificado; generado por auditoría */\n(() => {\n  const SMART_BASE='https://marvel.smart.link/fiir7ec77';\n  const TARGETS=new Map([\n${rows}\n  ]);\n  function readerFallbackHref(m){if(!m||Number(m.preinstalledStatus)!==5)return '';const expected=TARGETS.get(Number(m.id));const readerId=String(m.readerId||'').trim();if(!expected||readerId!==expected||!/^\\d+$/.test(readerId))return '';return \`${'${SMART_BASE}'}?type=reader&drn=${'${encodeURIComponent(readerId)}'}\`;}\n  if(typeof unlimitedState==='function'){const base=unlimitedState;unlimitedState=function(m){if(readerFallbackHref(m))return{label:'Unlimited ✓',cls:'available'};return base(m);};}\n  if(typeof stableAppHref==='function'){const base=stableAppHref;stableAppHref=function(x,s){const m=typeof state!=='undefined'&&state?.marvel?state.marvel.get(Number(x?.id)):null;return readerFallbackHref(m)||base(x,s);};}\n  function repaintTargets(){if(typeof state==='undefined'||!state?.marvel||typeof updateRenderedMeta!=='function')return;for(const id of TARGETS.keys()){const m=state.marvel.get(id);if(m)updateRenderedMeta(id,m)}}\n  if(typeof requestAnimationFrame==='function')requestAnimationFrame(repaintTargets);if(typeof setTimeout==='function'){setTimeout(repaintTargets,500);setTimeout(repaintTargets,1800)}\n})();\n`;
}

function recompute(pack){
  const c=s=>pack.entries.filter(r=>Number(r[3])===s).length;
  pack.matched=c(STATUS.MU)+c(STATUS.MU_LINK_MISSING);
  pack.verifiedMU=pack.matched;
  pack.noDigital=c(STATUS.NO_DIGITAL);
  pack.unavailable=pack.noDigital;
  pack.notListed=c(STATUS.NOT_LISTED);
  pack.linkReady=pack.entries.filter(r=>Number(r[3])===STATUS.MU&&DRN_RE.test(str(r[5]))).length;
  pack.linkMissing=pack.entries.filter(r=>Number(r[3])===STATUS.MU_LINK_MISSING||(Number(r[3])===STATUS.MU&&!DRN_RE.test(str(r[5])))).length;
}

const [pack,audit]=await Promise.all([
  fs.readFile(cacheFile,'utf8').then(JSON.parse),
  fs.readFile(auditFile,'utf8').then(JSON.parse),
]);

if(Number(pack.localCount)!==51002||pack.entries?.length!==51002||Number(pack.matched)!==29105||Number(pack.noDigital)!==1131||Number(pack.notListed)!==20766||Number(pack.functionalLinkMissing)!==0){
  throw new Error(`Baseline cambió: ${pack.localCount}/${pack.matched}/${pack.noDigital}/${pack.notListed}/${pack.functionalLinkMissing}`);
}
if(Number(audit?.version)!==4||audit?.mode!=='alias-official-audit-v4'||Number(audit?.summary?.targets)!==2||Number(audit?.summary?.mu)!==1||Number(audit?.summary?.identityMismatch)!==1||Number(audit?.summary?.functional)!==1||audit?.summary?.writesCache===true){
  throw new Error('Auditoría D incompatible o inesperada.');
}
const good=(audit.results||[]).filter(x=>x.kind==='mu'&&x.functional);
const rejected=(audit.results||[]).filter(x=>x.kind==='identity-mismatch');
if(good.length!==1||rejected.length!==1)throw new Error('Scope D no es exactamente 1 MU + 1 mismatch.');
const target=good[0];
if(Number(target.gcdId)!==1206423||Number(target.sourceId)!==50446||Number(target.readerId)!==33477||target.officialTitle!=='Ultimate Spider-Man (2011) #200'||target.availability!=='mu'||!target.reader?.ok){
  throw new Error('El único candidato publicable no coincide con la evidencia esperada.');
}
if(Number(rejected[0].gcdId)!==60543||rejected[0].kind!=='identity-mismatch')throw new Error('El caso X-Men #-1 dejó de estar rechazado.');

const byId=new Map(pack.entries.map((r,i)=>[Number(r[0]),i]));
const pos=byId.get(1206423);
if(pos==null)throw new Error('Falta GCD 1206423.');
const cur=pack.entries[pos];
if(Number(cur[3])!==STATUS.NOT_LISTED)throw new Error('GCD 1206423 ya no está pendiente.');
for(const r of pack.entries){
  if(Number(r[0])===1206423)continue;
  if(Number(r[1])===50446&&[STATUS.MU,STATUS.NO_DIGITAL,STATUS.MU_LINK_MISSING].includes(Number(r[3])))throw new Error(`sourceId 50446 ya pertenece a GCD ${r[0]}`);
}

const before=pack.entries.map(r=>JSON.stringify(r));
pack.entries[pos]=[1206423,50446,33477,STATUS.MU_LINK_MISSING,str(target.cover),''];
for(let i=0;i<pack.entries.length;i++){
  if(i===pos)continue;
  if(JSON.stringify(pack.entries[i])!==before[i])throw new Error(`Cambio fuera de scope ${pack.entries[i][0]}`);
}
recompute(pack);
const fallback=new Map();
for(const r of pack.entries){
  if(Number(r[3])!==STATUS.MU_LINK_MISSING)continue;
  const rid=Number(r[2]);
  if(!rid)throw new Error(`status5 sin readerId: ${r[0]}`);
  fallback.set(Number(r[0]),String(rid));
}
pack.readerFallbackGcdIds=[...fallback.keys()].sort((a,b)=>a-b);
pack.readerFallbackReady=fallback.size;
pack.functionalLinkReady=pack.linkReady+pack.readerFallbackReady;
pack.functionalLinkMissing=Math.max(0,pack.matched-pack.functionalLinkReady);
if(pack.matched!==29106||pack.noDigital!==1131||pack.notListed!==20765||pack.readerFallbackReady!==3784||pack.functionalLinkReady!==29106||pack.functionalLinkMissing!==0){
  throw new Error(`Conteos finales inesperados: ${pack.matched}/${pack.noDigital}/${pack.notListed}/${pack.readerFallbackReady}/${pack.functionalLinkReady}/${pack.functionalLinkMissing}`);
}
if(fallback.get(1206423)!=='33477')throw new Error('Fallback nuevo no coincide con readerId 33477.');
pack.generatedAt=now;
pack.aliasOfficialAudit={version:4,completedAt:now,publishedGcdIds:[1206423],rejectedGcdIds:[60543],promotedMU:1,remainingNotListed:pack.notListed};
pack.functionalLinkAudit={...(pack.functionalLinkAudit||{}),completedAt:now,uuidReady:pack.linkReady,readerFallbackReady:pack.readerFallbackReady,functionalLinkReady:pack.functionalLinkReady,functionalLinkMissing:0};
const summary={version:4,publishedAt:now,changedRows:1,promotedMU:1,promotedReader:1,promotedUuid:0,confirmedNoDigital:0,rejectedIdentityMismatch:[60543],published:[{gcdId:1206423,sourceId:50446,readerId:33477}],after:{matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed,linkReady:pack.linkReady,linkMissing:pack.linkMissing,readerFallbackReady:pack.readerFallbackReady,functionalLinkReady:pack.functionalLinkReady,functionalLinkMissing:pack.functionalLinkMissing},unchangedRows:51001};
await fs.writeFile(cacheFile,JSON.stringify(pack));
await fs.writeFile(fallbackFile,renderFallback(fallback));
await fs.mkdir(path.dirname(summaryFile),{recursive:true});
await fs.writeFile(summaryFile,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
