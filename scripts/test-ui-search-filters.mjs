import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import extract from 'extract-zip';

const root=process.cwd();
const archive=path.join(root,'Marvel_Orden_de_Lectura_PWA.zip');
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'marvel-ui-data-'));
await extract(archive,{dir:tmp});

const read=async p=>JSON.parse(await fs.readFile(path.join(tmp,p),'utf8'));
const meta=await read('data/meta.json');
const search=await read('data/search.json');
const series=await read('data/series.json');
const chunkIds=meta.chunks.map(c=>c.id);
const chunkIdStrings=new Set(chunkIds.map(String));
const rawChunkSet=new Set(chunkIds);
const issueById=new Map();
const issues=[];
for(const c of meta.chunks){
  const rows=await read('data/'+c.file);
  for(const x of rows){issues.push(x);issueById.set(Number(x.id),x)}
}

const uniq=a=>[...new Set(a)].sort((a,b)=>String(a).localeCompare(String(b),'es'));
const countBy=(arr,fn)=>Object.fromEntries([...arr.reduce((m,x)=>{const k=String(fn(x));m.set(k,(m.get(k)||0)+1);return m},new Map())].sort((a,b)=>a[0].localeCompare(b[0],'es')));
const expectedContent=['original','mixto','reimpresion','sin-datos'];
const expectedEra=['timely','atlas','marvel'];
const searchRowsWithRawDecade=search.filter(r=>rawChunkSet.has(r?.[7])).length;
const searchRowsWithStringDecade=search.filter(r=>chunkIdStrings.has(String(r?.[7]))).length;
const missingIssueRefs=search.filter(r=>!issueById.has(Number(r?.[1]))).slice(0,20).map(r=>r?.[1]);
const byIdSearch=new Map(search.map(r=>[Number(r?.[1]),r]));
const missingSearchRefs=issues.filter(x=>!byIdSearch.has(Number(x.id))).slice(0,20).map(x=>x.id);

let searchFieldMismatches=0;
const mismatchSamples=[];
for(const x of issues){
  const r=byIdSearch.get(Number(x.id));
  if(!r)continue;
  const mismatch=String(r[5])!==String(x.c)||String(r[6])!==String(x.e);
  if(mismatch){
    searchFieldMismatches++;
    if(mismatchSamples.length<20)mismatchSamples.push({id:x.id,issueContent:x.c,searchContent:r[5],issueEra:x.e,searchEra:r[6],searchDecade:r[7]});
  }
}

const initial=meta.chunks[0];
const initialRows=initial?await read('data/'+initial.file):[];
const seriesMap=new Map(series.map(s=>[Number(s.id),s]));
const normalize=s=>String(s??'').toLocaleLowerCase('es');
const hayForIssue=x=>{const s=seriesMap.get(Number(x.s))||{};return normalize(`${s.original||''} ${s.es||''} ${x.n||''} ${x.t||''}`)};
const captainGlobal=issues.filter(x=>hayForIssue(x).includes('captain america')).length;
const captainInitial=initialRows.filter(x=>hayForIssue(x).includes('captain america')).length;
const captainViaCurrentSearchLogic=search.filter(r=>(String(initial?.id)==='all'||r[7]===initial?.id)).map(r=>issueById.get(Number(r[1]))).filter(Boolean).filter(x=>hayForIssue(x).includes('captain america')).length;

const report={
  mainCount:meta.mainCount,
  issueCount:issues.length,
  searchCount:search.length,
  chunkIds,
  chunkIdTypes:uniq(chunkIds.map(v=>typeof v)),
  searchDecadeTypes:uniq(search.map(r=>typeof r?.[7])),
  searchRowsWithRawDecade,
  searchRowsWithStringDecade,
  issueContentValues:countBy(issues,x=>x.c),
  searchContentValues:countBy(search,r=>r?.[5]),
  issueEraValues:countBy(issues,x=>x.e),
  searchEraValues:countBy(search,r=>r?.[6]),
  expectedContentMissing:expectedContent.filter(v=>!issues.some(x=>String(x.c)===v)),
  expectedEraMissing:expectedEra.filter(v=>!issues.some(x=>String(x.e)===v)),
  missingIssueRefs,
  missingSearchRefs,
  searchFieldMismatches,
  mismatchSamples,
  initialChunk:{id:initial?.id,file:initial?.file,count:initialRows.length,content:countBy(initialRows,x=>x.c),era:countBy(initialRows,x=>x.e)},
  captainAmerica:{global:captainGlobal,initialChunk:captainInitial,currentSearchLogic:captainViaCurrentSearchLogic}
};
console.log(JSON.stringify(report,null,2));
await fs.mkdir(path.join(root,'artifacts'),{recursive:true});
await fs.writeFile(path.join(root,'artifacts','ui-search-filter-diagnostic.json'),JSON.stringify(report,null,2)+'\n');

const critical=[];
if(issues.length!==Number(meta.mainCount))critical.push(`issueCount ${issues.length} != meta.mainCount ${meta.mainCount}`);
if(search.length!==issues.length)critical.push(`searchCount ${search.length} != issueCount ${issues.length}`);
if(missingIssueRefs.length)critical.push(`search referencia IDs ausentes: ${missingIssueRefs.join(',')}`);
if(missingSearchRefs.length)critical.push(`hay issues sin search row: ${missingSearchRefs.join(',')}`);
if(searchFieldMismatches)critical.push(`content/era no coincide entre search y chunks: ${searchFieldMismatches}`);
if(searchRowsWithStringDecade!==search.length)critical.push(`hay ${search.length-searchRowsWithStringDecade} search rows con década inexistente`);
if(searchRowsWithRawDecade!==search.length)critical.push(`TIPO DE DÉCADA INCOMPATIBLE: refresh usa === y sólo ${searchRowsWithRawDecade}/${search.length} coinciden estrictamente`);
if(expectedContent.some(v=>!issues.some(x=>String(x.c)===v)))critical.push('valores contentFilter no coinciden con los chunks');
if(expectedEra.some(v=>!issues.some(x=>String(x.e)===v)))critical.push('valores eraFilter no coinciden con los chunks');
if(critical.length)throw new Error('Diagnóstico UI: '+critical.join(' | '));
