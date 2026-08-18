import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const outDir=path.join(root,'artifacts','marvel-not-listed-v4');
const outFile=path.join(outDir,'positive-identifiers.json');
const POSITIVE=new Set([1,5]);
const str=v=>v==null?'':String(v).trim();

function duplicates(rows,index,{string=false}={}){
  const by=new Map();
  for(const r of rows){const raw=string?str(r?.[index]):Number(r?.[index])||0;if(!raw)continue;const a=by.get(raw)||[];a.push(Number(r[0]));by.set(raw,a)}
  const dup=[...by.entries()].filter(([,ids])=>ids.length>1).sort((a,b)=>b[1].length-a[1].length);
  return{nonEmptyRows:[...by.values()].reduce((n,a)=>n+a.length,0),uniqueValues:by.size,duplicateValues:dup.length,rowsInDuplicateGroups:dup.reduce((n,[,ids])=>n+ids.length,0),extraDuplicateAssignments:dup.reduce((n,[,ids])=>n+ids.length-1,0),examples:dup.slice(0,50).map(([value,gcdIds])=>({value,gcdIds}))};
}

const pack=JSON.parse(await fs.readFile(cacheFile,'utf8'));
if(Number(pack.localCount)!==51002||!Array.isArray(pack.entries)||pack.entries.length!==51002)throw new Error('Baseline de caché inválida.');
const positives=pack.entries.filter(r=>POSITIVE.has(Number(r?.[3])));
if(positives.length!==25329)throw new Error(`Positivos=${positives.length}, esperado=25329.`);
const report={version:4,generatedAt:new Date().toISOString(),mode:'diagnostic-only',writesCache:false,positiveRows:positives.length,status1:positives.filter(r=>Number(r[3])===1).length,status5:positives.filter(r=>Number(r[3])===5).length,sourceIds:duplicates(positives,1),readerIds:duplicates(positives,2),drns:duplicates(positives,5,{string:true})};
await fs.mkdir(outDir,{recursive:true});await fs.writeFile(outFile,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({positiveRows:report.positiveRows,sourceIds:report.sourceIds,readerIds:report.readerIds,drns:report.drns},null,2));
