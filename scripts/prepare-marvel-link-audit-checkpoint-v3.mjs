import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const checkpointDir=path.join(root,'.cache','marvel-link-audit-v1');
const checkpointFile=path.join(checkpointDir,'checkpoint.json');
const STATUS_MU=1;
const STATUS_MU_LINK_MISSING=5;
const DRN_RE=/^drn:src:marvel:unison::prod:[0-9a-f-]{36}$/i;
const str=v=>v==null?'':String(v);

function signatureOf(pack){
  return [pack.version,pack.resolverVersion,pack.generatedAt,pack.localCount,pack.matched,pack.linkReady,pack.linkMissing].join('|');
}

const pack=JSON.parse(await fs.readFile(cacheFile,'utf8'));
if(Number(pack.version)<3||!Array.isArray(pack.entries)||Number(pack.localCount)!==51002){
  throw new Error('Caché Marvel V3 inválida; no se prepara el checkpoint de deeplinks.');
}

const targets=new Map();
for(const row of pack.entries){
  const status=Number(row?.[3]);
  if(status!==STATUS_MU&&status!==STATUS_MU_LINK_MISSING)continue;
  const gcdId=Number(row?.[0])||0;
  targets.set(String(gcdId),{
    gcdId,
    sourceId:Number(row?.[1])||0,
    readerId:Number(row?.[2])||0,
    storedDrn:str(row?.[5]),
  });
}

let old={version:2,results:{}};
try{old=JSON.parse(await fs.readFile(checkpointFile,'utf8'))}catch{}
const oldResults=old?.results&&typeof old.results==='object'?old.results:{};
const kept={};
let rejectedChanged=0,rejectedFailure=0,rejectedMissing=0;

for(const [id,t] of targets){
  const r=oldResults[id];
  if(!r){rejectedMissing++;continue}
  if(r.ok!==true){rejectedFailure++;continue}
  const sameIds=Number(r.sourceId)===t.sourceId&&Number(r.readerId)===t.readerId;
  const checkpointDrn=str(r.drn);
  const sameDrn=DRN_RE.test(checkpointDrn)&&DRN_RE.test(t.storedDrn)&&checkpointDrn.toLowerCase()===t.storedDrn.toLowerCase();
  if(!sameIds||!sameDrn){rejectedChanged++;continue}
  kept[id]=r;
}

const signature=signatureOf(pack);
await fs.mkdir(checkpointDir,{recursive:true});
await fs.writeFile(checkpointFile,JSON.stringify({
  version:2,
  signature,
  updatedAt:new Date().toISOString(),
  processed:Object.keys(kept).length,
  total:targets.size,
  results:kept,
  preparedBy:'v3-fingerprint-reuse',
}));

console.log(JSON.stringify({
  targets:targets.size,
  checkpointCandidates:Object.keys(oldResults).length,
  reused:Object.keys(kept).length,
  pending:targets.size-Object.keys(kept).length,
  rejectedChanged,
  rejectedFailure,
  rejectedMissing,
  signature,
},null,2));
