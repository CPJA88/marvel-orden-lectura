import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd(),dir=path.join(root,'artifacts','marvel-not-listed-v4','clean-candidates-v4-shards');
const outResults=path.join(root,'artifacts','marvel-not-listed-v4','clean-candidates-drm-v4-results.json');
const outSummary=path.join(root,'artifacts','marvel-not-listed-v4','clean-candidates-drm-v4-summary.json');
const DRN_RE=/^drn:src:marvel:unison::prod:[0-9a-f-]{36}$/i;
const shardCount=8,reports=[];
for(let i=0;i<shardCount;i++)reports.push(JSON.parse(await fs.readFile(path.join(dir,`shard-${i}.json`),'utf8')));
for(let i=0;i<shardCount;i++){const r=reports[i];if(r.version!==4||r.mode!=='clean-candidates-drm-v4-shard'||r.writesCache!==false||r.shard!==i||r.shardCount!==8||r.totalTargets!==1983)throw new Error(`Shard ${i} incompatible.`);if(r.baseline.matched!==29189||r.baseline.noDigital!==1135||r.baseline.notListed!==20678||r.baseline.functionalLinkMissing!==0)throw new Error(`Baseline shard ${i} incompatible.`)}
const results=reports.flatMap(r=>r.results||[]).sort((a,b)=>a.gcdId-b.gcdId);if(results.length!==1983||new Set(results.map(r=>Number(r.gcdId))).size!==1983)throw new Error(`Resultados únicos=${results.length}, esperaba 1983.`);
const mu=results.filter(r=>r.kind==='mu');for(const r of mu)if(!Number(r.sourceId)||!Number(r.readerId)||!DRN_RE.test(String(r.drn||''))||r.landingUnlimited!==true||r.landingOpenButton!==true||r.functional!==true||!(Number(r.smartStatus)>=200&&Number(r.smartStatus)<400))throw new Error(`MU inseguro GCD ${r.gcdId}`);
function dup(field,normal=x=>x){const m=new Map();for(const r of mu){const v=normal(r[field]);if(!v)continue;const a=m.get(v)||[];a.push(r.gcdId);m.set(v,a)}return[...m].filter(([,ids])=>ids.length>1).map(([value,gcdIds])=>({value,gcdIds}));}
const duplicateSource=dup('sourceId',Number),duplicateReader=dup('readerId',Number),duplicateDrn=dup('drn',x=>String(x||'').toLowerCase());const unsafeIds=new Set([...duplicateSource,...duplicateReader,...duplicateDrn].flatMap(g=>g.gcdIds.map(Number)));
for(const r of results)r.publishable=r.kind==='mu'&&!unsafeIds.has(Number(r.gcdId));
const kindCounts={};for(const r of results)kindCounts[r.kind]=(kindCounts[r.kind]||0)+1;
const summary={version:4,generatedAt:new Date().toISOString(),mode:'clean-candidates-drm-v4-summary',writesCache:false,totalTargets:1983,muRaw:mu.length,muPublishable:results.filter(r=>r.publishable).length,muExcludedByCrossResultCollision:unsafeIds.size,unresolved:1983-mu.length,duplicatePositiveSourceGroups:duplicateSource.length,duplicatePositiveReaderGroups:duplicateReader.length,duplicatePositiveDrnGroups:duplicateDrn.length,kindCounts,baseline:{matched:29189,noDigital:1135,notListed:20678,functionalLinkMissing:0},safety:{cacheWritten:false,noNegativeClassificationFromFailure:true,publishableRequiresMuButtonAndFunctionalLink:true,crossResultSourceReaderDrnCollisionsExcluded:true}};
await fs.writeFile(outResults,JSON.stringify({version:4,generatedAt:summary.generatedAt,mode:'clean-candidates-drm-v4-results',writesCache:false,summary,duplicateSource,duplicateReader,duplicateDrn,results},null,2)+'\n');await fs.writeFile(outSummary,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
