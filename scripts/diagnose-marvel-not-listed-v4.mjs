import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const outDir=path.join(root,'artifacts','marvel-not-listed-v4');
const outFile=path.join(outDir,'diagnostic.json');
const STATUS={UNKNOWN:0,MU:1,AMBIGUOUS:2,NO_DIGITAL:3,NOT_LISTED:4,MU_LINK_MISSING:5};
const EXPECTED={localCount:51002,matched:25329,noDigital:1057,notListed:24616,linkReady:25322,linkMissing:7};
const str=v=>v==null?'':String(v);
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');

function countStatus(entries,status){return entries.filter(r=>Number(r?.[3])===status).length}
function duplicateSummary(rows,index){
  const by=new Map();
  for(const r of rows){const id=Number(r?.[index])||0;if(!id)continue;const a=by.get(id)||[];a.push(Number(r[0]));by.set(id,a)}
  const dup=[...by.entries()].filter(([,ids])=>ids.length>1).sort((a,b)=>b[1].length-a[1].length);
  return{unique:by.size,duplicateValues:dup.length,duplicateRows:dup.reduce((n,[,ids])=>n+ids.length,0),examples:dup.slice(0,20).map(([value,gcdIds])=>({value,gcdIds}))};
}

const pack=JSON.parse(await fs.readFile(cacheFile,'utf8'));
if(!Array.isArray(pack.entries)||Number(pack.localCount)!==EXPECTED.localCount||pack.entries.length!==EXPECTED.localCount)throw new Error(`Caché base inesperada: localCount=${pack.localCount}; entries=${pack.entries?.length}`);
const current={
  localCount:Number(pack.localCount),
  matched:Number(pack.matched),
  noDigital:Number(pack.noDigital??pack.unavailable),
  notListed:Number(pack.notListed),
  linkReady:Number(pack.linkReady),
  linkMissing:Number(pack.linkMissing),
};
for(const [k,v] of Object.entries(EXPECTED))if(current[k]!==v)throw new Error(`Baseline cambió: ${k}=${current[k]} esperado=${v}`);

const entries=pack.entries;
const targets=entries.filter(r=>Number(r?.[3])===STATUS.NOT_LISTED);
const protectedRows=entries.filter(r=>Number(r?.[3])!==STATUS.NOT_LISTED);
if(targets.length!==EXPECTED.notListed)throw new Error(`NOT_LISTED=${targets.length}, esperado=${EXPECTED.notListed}`);
if(protectedRows.length!==26386)throw new Error(`Filas protegidas=${protectedRows.length}, esperado=26386`);

const cohorts={both:[],sourceOnly:[],readerOnly:[],neither:[]};
const stale={drn:[],cover:[]};
for(const r of targets){
  const gcdId=Number(r[0]),sourceId=Number(r[1])||0,readerId=Number(r[2])||0,cover=str(r[4]),drn=str(r[5]);
  const item={gcdId,sourceId,readerId};
  if(sourceId&&readerId)cohorts.both.push(item);
  else if(sourceId)cohorts.sourceOnly.push(item);
  else if(readerId)cohorts.readerOnly.push(item);
  else cohorts.neither.push(item);
  if(drn)stale.drn.push({...item,drn});
  if(cover)stale.cover.push({...item,cover});
}

const directOfficial=cohorts.both.length+cohorts.sourceOnly.length+cohorts.readerOnly.length;
const statusCounts={
  unknown:countStatus(entries,STATUS.UNKNOWN),
  mu:countStatus(entries,STATUS.MU),
  ambiguous:countStatus(entries,STATUS.AMBIGUOUS),
  noDigital:countStatus(entries,STATUS.NO_DIGITAL),
  notListed:countStatus(entries,STATUS.NOT_LISTED),
  muLinkMissing:countStatus(entries,STATUS.MU_LINK_MISSING),
};
if(Object.values(statusCounts).reduce((a,b)=>a+b,0)!==EXPECTED.localCount)throw new Error('Los estados no suman 51.002.');

const report={
  version:4,
  generatedAt:new Date().toISOString(),
  mode:'diagnostic-only',
  writesCache:false,
  baseline:current,
  statusCounts,
  safety:{
    targetStatus:STATUS.NOT_LISTED,
    targetRows:targets.length,
    protectedRows:protectedRows.length,
    protectedRowsSha256:sha(JSON.stringify(protectedRows)),
    targetRowsSha256:sha(JSON.stringify(targets)),
  },
  identifierCoverage:{
    both:cohorts.both.length,
    sourceOnly:cohorts.sourceOnly.length,
    readerOnly:cohorts.readerOnly.length,
    neither:cohorts.neither.length,
    directOfficialRouteCandidates:directOfficial,
    discoveryRequired:cohorts.neither.length,
    directOfficialRoutePct:Number((directOfficial/targets.length*100).toFixed(2)),
    discoveryRequiredPct:Number((cohorts.neither.length/targets.length*100).toFixed(2)),
  },
  identifierIntegrity:{
    sourceIds:duplicateSummary(targets,1),
    readerIds:duplicateSummary(targets,2),
    staleDrnCount:stale.drn.length,
    staleCoverCount:stale.cover.length,
  },
  examples:{
    both:cohorts.both.slice(0,30),
    sourceOnly:cohorts.sourceOnly.slice(0,30),
    readerOnly:cohorts.readerOnly.slice(0,30),
    neither:cohorts.neither.slice(0,30),
    staleDrn:stale.drn.slice(0,20),
  },
  nextPassPlan:{
    phaseA:'Probe marvel.com/comics/issue/<sourceId> for sourceId-bearing NOT_LISTED rows, with strict identity verification.',
    phaseB:'Probe share.marvel.com/sharing/reader/<readerId> for readerId-bearing rows and accept Unlimited only on exact comic identity.',
    phaseC:'Run candidate discovery only for rows with neither sourceId nor readerId; verify every candidate against an official Marvel page before classification.',
    invariant:'Never mutate a row whose current status is not NOT_LISTED; fingerprint all protected rows before publication.',
  },
};

await fs.mkdir(outDir,{recursive:true});
await fs.writeFile(outFile,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({baseline:report.baseline,identifierCoverage:report.identifierCoverage,identifierIntegrity:{sourceIds:report.identifierIntegrity.sourceIds,readerIds:report.identifierIntegrity.readerIds,staleDrnCount:report.identifierIntegrity.staleDrnCount}},null,2));
console.log(`Informe: ${outFile}`);
