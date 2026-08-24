import test,{before,after}from'node:test';
import assert from'node:assert/strict';
import fs from'node:fs';
import fsp from'node:fs/promises';
import os from'node:os';
import path from'node:path';
import vm from'node:vm';
import{fileURLToPath}from'node:url';
import extract from'extract-zip';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sagasRoot=path.join(root,'source/data/sagas');
const catalog=JSON.parse(fs.readFileSync(path.join(sagasRoot,'catalog.json'),'utf8'));
const coreSource=fs.readFileSync(path.join(root,'source/sagas-core.js'),'utf8');
const context={};
vm.createContext(context);
vm.runInContext(coreSource,context);
const core=context.MarvelSagasCore;
const available=catalog.events.filter(event=>event.status==='available');
const sagaDocuments=new Map();
const sagaFiles=available.map(meta=>({
  meta,
  saga:(()=>{
    if(!sagaDocuments.has(meta.dataFile))sagaDocuments.set(meta.dataFile,JSON.parse(fs.readFileSync(path.join(root,'source',meta.dataFile),'utf8')));
    const raw=sagaDocuments.get(meta.dataFile);
    return meta.dataKey?raw?.events?.[meta.dataKey]:raw;
  })()
}));
let tempDir,issues,issueById;

before(async()=>{
  tempDir=await fsp.mkdtemp(path.join(os.tmpdir(),'marvel-sagas-catalog-'));
  await extract(path.join(root,'Marvel_Orden_de_Lectura_PWA.zip'),{dir:tempDir});
  const dataDir=path.join(tempDir,'data');
  const files=(await fsp.readdir(dataDir)).filter(file=>/^principal-\d+\.json$/.test(file));
  issues=(await Promise.all(files.map(async file=>JSON.parse(await fsp.readFile(path.join(dataDir,file),'utf8'))))).flat();
  issueById=new Map(issues.map(issue=>[Number(issue.id),issue]));
});

after(async()=>{if(tempDir)await fsp.rm(tempDir,{recursive:true,force:true})});

test('el catálogo base contiene al menos 170 eventos ordenados y con identificadores únicos',()=>{
  assert.equal(catalog.schemaVersion,3);
  assert.ok(catalog.events.length>=170);
  assert.equal(new Set(catalog.events.map(event=>event.id)).size,catalog.events.length);
  assert.equal(new Set(catalog.events.map(event=>`${event.year}\u0000${event.title}`)).size,catalog.events.length);
  for(const event of catalog.events){
    assert.match(event.id,/^[-a-z0-9]+$/);
    assert.ok(event.title);
    assert.ok(Number.isInteger(event.year));
    assert.ok(['planned','available'].includes(event.status));
    assert.ok(event.catalogSource);
    if(event.coverIssueId!=null)assert.ok(Number.isInteger(event.coverIssueId));
    if(event.dataFile!=null)assert.match(event.dataFile,/^data\/sagas\/[-a-z0-9]+\.json$/);
    if(event.dataKey!=null)assert.match(event.dataKey,/^[-a-z0-9]+$/);
  }
  assert.equal(catalog.events.every((event,index)=>{
    if(!index)return true;
    const previous=catalog.events[index-1];
    return previous.year<event.year||(previous.year===event.year&&previous.title.localeCompare(event.title,'es')<=0);
  }),true);
  const ids=new Set(catalog.events.map(event=>event.id));
  const required=['secret-wars-1984','infinity-gauntlet','age-of-apocalypse','house-of-m','civil-war','secret-invasion','siege','avengers-vs-x-men','secret-wars-2015','civil-war-ii','king-in-black','axe-judgment-day','blood-hunt'];
  assert.equal(required.every(id=>ids.has(id)),true);
  const availableIds=new Set(available.map(event=>event.id));
  assert.equal(['secret-wars-1984','infinity-gauntlet','secret-wars-2015'].every(id=>availableIds.has(id)),true);
  assert.equal(['amazing-spider-man-venom-death-spiral-2026','avengers-armageddon-2026','dnx-2026','queen-in-black-2026'].every(id=>availableIds.has(id)),true);
  assert.deepEqual(catalog.events.filter(event=>event.status==='planned').map(event=>event.id),['star-wars-marvel-hope-assembles-2027']);
  assert.equal(new Set(available.map(event=>`${event.dataFile}#${event.dataKey||''}`)).size,available.length);
});

test('todos los eventos disponibles superan el mismo contrato estructural',()=>{
  for(const{meta,saga}of sagaFiles){
    assert.equal(saga.id,meta.id);
    const result=core.validateSaga(saga);
    assert.equal(result.valid,true,meta.id);
    assert.deepEqual(Array.from(result.duplicateIssueIds),[],meta.id);
    assert.deepEqual(Array.from(result.duplicateOrders),[],meta.id);
    assert.deepEqual(Array.from(result.duplicateUnresolvedGcdIds),[],meta.id);
    assert.deepEqual(Array.from(result.duplicateUnresolvedReferenceIds),[],meta.id);
    assert.equal(result.deterministic,true,meta.id);
    assert.equal(result.principalInEssential,true,meta.id);
    assert.equal(result.essentialInComplete,true,meta.id);
    for(const entry of saga.entries){
      assert.deepEqual(Object.keys(entry).sort(),['importance','issueId','order','section','type']);
    }
  }
});

test('los paquetes por década exponen exactamente cada saga mediante dataKey',()=>{
  for(const{meta,saga}of sagaFiles){
    assert.ok(saga,meta.id);
    if(meta.dataKey){
      assert.equal(meta.dataKey,meta.id);
      assert.match(meta.dataFile,/^data\/sagas\/events-\d{4}s\.json$/);
    }
  }
  assert.ok(new Set(available.map(event=>event.dataFile)).size<available.length,'los paquetes deben compartirse entre eventos');
});

test('todos los issueId disponibles y todas las portadas apuntan a la biblioteca',()=>{
  for(const{meta,saga}of sagaFiles){
    assert.deepEqual(saga.entries.filter(entry=>!issueById.has(Number(entry.issueId))),[],meta.id);
  }
  assert.deepEqual(catalog.events.filter(event=>event.coverIssueId&&!issueById.has(Number(event.coverIssueId))),[]);
});

test('los conteos enlazados y editoriales son deterministas en los tres modos',()=>{
  const ranks={principal:0,essential:1,complete:2};
  for(const{meta,saga}of sagaFiles){
    for(const mode of Object.keys(ranks)){
      const linked=core.entriesForMode(saga,mode).length;
      assert.equal(linked,saga.expectedCounts[mode],`${meta.id} ${mode}`);
      const unresolved=(saga.unresolvedReferences||[]).filter(reference=>ranks[reference.importance]<=ranks[mode]).length;
      const targetCounts=saga.targetCounts||saga.expectedCounts;
      assert.equal(linked+unresolved,targetCounts[mode],`${meta.id} target ${mode}`);
      assert.equal(core.unresolvedForMode(saga,mode).length,unresolved,`${meta.id} unresolved ${mode}`);
    }
  }
});

test('los cuatro eventos de 2026 conservan las referencias futuras sin asignar IDs antiguos',()=>{
  const expectedTargets=new Map([
    ['amazing-spider-man-venom-death-spiral-2026',10],
    ['avengers-armageddon-2026',22],
    ['dnx-2026',14],
    ['queen-in-black-2026',19]
  ]);
  for(const[id,total]of expectedTargets){
    const saga=sagaFiles.find(item=>item.meta.id===id).saga;
    assert.equal(saga.targetCounts.complete,total,id);
    assert.equal(saga.entries.length+(saga.unresolvedReferences||[]).length,total,id);
    assert.equal((saga.unresolvedReferences||[]).every(reference=>!Object.hasOwn(reference,'issueId')&&reference.referenceId&&reference.reason),true,id);
  }
});

test('Secret Wars 1984 queda completa y reutiliza los mismos issueId de la biblioteca',()=>{
  const saga=sagaFiles.find(item=>item.meta.id==='secret-wars-1984').saga;
  assert.deepEqual(saga.expectedCounts,{principal:12,essential:26,complete:57});
  assert.deepEqual(saga.targetCounts,saga.expectedCounts);
  assert.equal((saga.unresolvedReferences||[]).length,0);
  assert.equal(core.entriesForMode(saga,'principal')[0].issueId,76314);
  assert.equal(core.entriesForMode(saga,'principal').at(-1).issueId,76325);
});

test('Infinity Gauntlet documenta sin ocultar los dos originales ausentes',()=>{
  const saga=sagaFiles.find(item=>item.meta.id==='infinity-gauntlet').saga;
  assert.deepEqual(saga.expectedCounts,{principal:6,essential:19,complete:49});
  assert.deepEqual(saga.targetCounts,{principal:6,essential:21,complete:51});
  assert.deepEqual(saga.unresolvedReferences.map(reference=>reference.gcdIssueId),[47348,47386]);
  assert.equal(saga.unresolvedReferences.every(reference=>!Object.hasOwn(reference,'issueId')&&reference.reason),true);
  assert.equal(saga.unresolvedReferences.every(reference=>!issueById.has(Number(reference.gcdIssueId))),true);
});

test('progreso, filtros y Continuar saga siguen siendo globales para cada archivo',()=>{
  for(const{meta,saga}of sagaFiles){
    const principal=Array.from(core.entriesForMode(saga,'principal'));
    const progress=new Map(principal.slice(0,2).map(entry=>[entry.issueId,{id:entry.issueId,status:'read'}]));
    assert.equal(core.sagaProgress(saga,progress,'principal').resolved,Math.min(2,principal.length),meta.id);
    assert.equal(core.firstPending(saga,progress,'principal')?.issueId,principal[2]?.issueId,meta.id);
    const before=JSON.stringify([...progress]);
    core.filterEntries(core.entriesForMode(saga,'complete'),issueById,progress,{status:'pending',tokens:[],seriesFor:()=>({}),decadeFor:()=>''});
    assert.equal(JSON.stringify([...progress]),before,meta.id);
  }
});
