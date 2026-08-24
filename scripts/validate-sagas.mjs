import fs from'node:fs/promises';
import path from'node:path';
import vm from'node:vm';

const root=process.cwd();
const sourceRoot=path.join(root,'source');
const publicData=path.join(root,'public','data');
const sagasRoot=path.join(sourceRoot,'data','sagas');
const catalog=JSON.parse(await fs.readFile(path.join(sagasRoot,'catalog.json'),'utf8'));
const context={};
vm.createContext(context);
vm.runInContext(await fs.readFile(path.join(sourceRoot,'sagas-core.js'),'utf8'),context);
const core=context.MarvelSagasCore;

const chunkFiles=(await fs.readdir(publicData)).filter(file=>/^principal-\d+\.json$/.test(file));
if(!chunkFiles.length)throw new Error('No existe la biblioteca preparada. Ejecuta npm run build antes de validar las sagas.');
const issues=(await Promise.all(chunkFiles.map(async file=>JSON.parse(await fs.readFile(path.join(publicData,file),'utf8'))))).flat();
const issueById=new Map(issues.map(issue=>[Number(issue.id),issue]));
const events=Array.isArray(catalog.events)?catalog.events:[];
const ids=events.map(event=>event.id);
const duplicateCatalogIds=[...new Set(ids.filter((id,index)=>ids.indexOf(id)!==index))];
const titleYears=events.map(event=>`${event.year}\u0000${event.title}`);
const duplicateCatalogTitleYears=[...new Set(titleYears.filter((key,index)=>titleYears.indexOf(key)!==index))];
const invalidCatalogEvents=events.filter(event=>!/^[-a-z0-9]+$/.test(String(event.id||''))||!String(event.title||'').trim()||!Number.isInteger(Number(event.year))||!['planned','available'].includes(event.status)||!String(event.catalogSource||'').trim()||(event.coverIssueId!=null&&!Number.isInteger(Number(event.coverIssueId)))||(event.dataFile!=null&&!/^data\/sagas\/[-a-z0-9]+\.json$/.test(String(event.dataFile))));
const deterministicCatalog=events.every((event,index)=>{
  if(!index)return true;
  const previous=events[index-1];
  return Number(previous.year)<Number(event.year)||(Number(previous.year)===Number(event.year)&&String(previous.title).localeCompare(String(event.title),'es')<=0);
});
const available=events.filter(event=>event.status==='available');
const missingDataFiles=available.filter(event=>!event.dataFile).map(event=>event.id);
const duplicateDataFiles=[...new Set(available.map(event=>event.dataFile).filter((file,index,list)=>file&&list.indexOf(file)!==index))];
const coverIds=events.map(event=>Number(event.coverIssueId)).filter(Boolean);
const missingCovers=coverIds.filter(id=>!issueById.has(id));
const modeRank={principal:0,essential:1,complete:2};
const reports=[];

for(const meta of available){
  if(!meta.dataFile)continue;
  const relative=String(meta.dataFile).replace(/^data\/sagas\//,'');
  const saga=JSON.parse(await fs.readFile(path.join(sagasRoot,relative),'utf8'));
  const entries=core.orderedEntries(saga);
  const structure=core.validateSaga(saga);
  const missing=entries.filter(entry=>!issueById.has(Number(entry.issueId))).map(entry=>entry.issueId);
  const unresolved=Array.isArray(saga.unresolvedReferences)?saga.unresolvedReferences:[];
  const unresolvedNowLinked=unresolved.filter(reference=>issueById.has(Number(reference.gcdIssueId))).map(reference=>reference.gcdIssueId);
  const counts=Object.fromEntries(Object.keys(modeRank).map(mode=>[mode,core.entriesForMode(saga,mode).length]));
  const targetCounts=Object.fromEntries(Object.keys(modeRank).map(mode=>[
    mode,
    counts[mode]+unresolved.filter(reference=>modeRank[reference.importance]<=modeRank[mode]).length
  ]));
  const expectedMatches=Object.entries(saga.expectedCounts||{}).every(([mode,count])=>counts[mode]===Number(count));
  const targetMatches=Object.entries(saga.targetCounts||saga.expectedCounts||{}).every(([mode,count])=>targetCounts[mode]===Number(count));
  const seriesCount=new Set(entries.map(entry=>issueById.get(Number(entry.issueId))?.s).filter(Number.isFinite)).size;
  reports.push({
    id:saga.id,
    saga:`${saga.title} (${saga.year})`,
    counts,
    targetCounts,
    seriesCount,
    linkedReferences:entries.length-missing.length,
    missingReferences:missing,
    unresolvedReferences:unresolved,
    unresolvedReferencesNowInLibrary:unresolvedNowLinked,
    duplicateIssueIds:structure.duplicateIssueIds,
    duplicateOrders:structure.duplicateOrders,
    duplicateUnresolvedGcdIds:structure.duplicateUnresolvedGcdIds,
    deterministicOrder:structure.deterministic,
    principalInEssential:structure.principalInEssential,
    essentialInComplete:structure.essentialInComplete,
    expectedMatches,
    targetMatches,
    valid:structure.valid&&!missing.length&&!unresolvedNowLinked.length&&expectedMatches&&targetMatches&&saga.id===meta.id
  });
}

const report={
  catalogVersion:catalog.catalogVersion||null,
  generatedAt:new Date().toISOString(),
  catalogEvents:events.length,
  availableEvents:available.length,
  plannedEvents:events.length-available.length,
  deterministicCatalog,
  duplicateCatalogIds,
  duplicateCatalogTitleYears,
  invalidCatalogEvents:invalidCatalogEvents.map(event=>event.id||event.title||null),
  duplicateDataFiles,
  missingDataFiles,
  catalogCoverIdsMissingFromLibrary:missingCovers,
  sagas:reports,
  valid:deterministicCatalog&&!duplicateCatalogIds.length&&!duplicateCatalogTitleYears.length&&!invalidCatalogEvents.length&&!duplicateDataFiles.length&&!missingDataFiles.length&&!missingCovers.length&&reports.length===available.length&&reports.every(saga=>saga.valid)
};

console.log(JSON.stringify(report,null,2));
if(!report.valid)process.exitCode=1;
