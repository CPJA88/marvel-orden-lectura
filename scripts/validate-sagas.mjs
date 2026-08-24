import fs from'node:fs/promises';
import path from'node:path';
import vm from'node:vm';

const root=process.cwd();
const sourceRoot=path.join(root,'source');
const publicData=path.join(root,'public','data');
const saga=JSON.parse(await fs.readFile(path.join(sourceRoot,'data','sagas','secret-wars-2015.json'),'utf8'));
const catalog=JSON.parse(await fs.readFile(path.join(sourceRoot,'data','sagas','catalog.json'),'utf8'));
const context={};
vm.createContext(context);
vm.runInContext(await fs.readFile(path.join(sourceRoot,'sagas-core.js'),'utf8'),context);
const core=context.MarvelSagasCore;

const chunkFiles=(await fs.readdir(publicData)).filter(file=>/^principal-\d+\.json$/.test(file));
if(!chunkFiles.length)throw new Error('No existe la biblioteca preparada. Ejecuta npm run build antes de validar las sagas.');
const issues=(await Promise.all(chunkFiles.map(async file=>JSON.parse(await fs.readFile(path.join(publicData,file),'utf8'))))).flat();
const issueById=new Map(issues.map(issue=>[Number(issue.id),issue]));
const entries=core.orderedEntries(saga);
const structure=core.validateSaga(saga);
const missing=entries.filter(entry=>!issueById.has(Number(entry.issueId))).map(entry=>entry.issueId);
const excludedMissing=(saga.excludedReferences||[]).filter(entry=>!issueById.has(Number(entry.issueId))).map(entry=>entry.issueId);
const counts=Object.fromEntries(['principal','essential','complete'].map(mode=>[mode,core.entriesForMode(saga,mode).length]));
const seriesCount=new Set(entries.map(entry=>issueById.get(Number(entry.issueId))?.s).filter(Number.isFinite)).size;
const coverIds=(catalog.events||[]).map(event=>Number(event.coverIssueId)).filter(Boolean);
const missingCovers=coverIds.filter(id=>!issueById.has(id));
const expectedMatches=Object.entries(saga.expectedCounts||{}).every(([mode,count])=>counts[mode]===Number(count));
const report={
  saga:`${saga.title} (${saga.year})`,
  generatedAt:new Date().toISOString(),
  counts,
  seriesCount,
  linkedReferences:entries.length-missing.length,
  missingReferences:missing,
  duplicateIssueIds:structure.duplicateIssueIds,
  duplicateOrders:structure.duplicateOrders,
  deterministicOrder:structure.deterministic,
  principalInEssential:structure.principalInEssential,
  essentialInComplete:structure.essentialInComplete,
  deliberatelyExcluded:saga.excludedReferences||[],
  excludedReferencesMissingFromLibrary:excludedMissing,
  catalogCoverIdsMissingFromLibrary:missingCovers,
  valid:structure.valid&&!missing.length&&!excludedMissing.length&&!missingCovers.length&&expectedMatches
};

console.log(JSON.stringify(report,null,2));
if(!report.valid)process.exitCode=1;
