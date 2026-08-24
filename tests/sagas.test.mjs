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
const saga=JSON.parse(fs.readFileSync(path.join(root,'source/data/sagas/secret-wars-2015.json'),'utf8'));
const catalog=JSON.parse(fs.readFileSync(path.join(root,'source/data/sagas/catalog.json'),'utf8'));
const coreSource=fs.readFileSync(path.join(root,'source/sagas-core.js'),'utf8');
const uiSource=fs.readFileSync(path.join(root,'source/sagas-ui.js'),'utf8');
const appSource=fs.readFileSync(path.join(root,'source/app.js'),'utf8').replace(/\ninit\(\);\s*$/,'\n');
const html=fs.readFileSync(path.join(root,'source/index.html'),'utf8');
let tempDir,issues,issueById;

function loadCore(context={}){
  vm.createContext(context);vm.runInContext(coreSource,context);return context.MarvelSagasCore;
}

before(async()=>{
  tempDir=await fsp.mkdtemp(path.join(os.tmpdir(),'marvel-sagas-test-'));
  await extract(path.join(root,'Marvel_Orden_de_Lectura_PWA.zip'),{dir:tempDir});
  const dataDir=path.join(tempDir,'data');
  const files=(await fsp.readdir(dataDir)).filter(file=>/^principal-\d+\.json$/.test(file));
  issues=(await Promise.all(files.map(async file=>JSON.parse(await fsp.readFile(path.join(dataDir,file),'utf8'))))).flat();
  issueById=new Map(issues.map(issue=>[Number(issue.id),issue]));
});

after(async()=>{if(tempDir)await fsp.rm(tempDir,{recursive:true,force:true})});

test('Secret Wars enlaza todos sus issueId y las portadas del catálogo con la biblioteca',()=>{
  const missing=saga.entries.filter(entry=>!issueById.has(Number(entry.issueId)));
  const excludedMissing=(saga.excludedReferences||[]).filter(entry=>!issueById.has(Number(entry.issueId)));
  const missingCovers=catalog.events.filter(event=>event.coverIssueId&&!issueById.has(Number(event.coverIssueId)));
  assert.deepEqual(missing,[]);
  assert.deepEqual(excludedMissing,[]);
  assert.deepEqual(missingCovers,[]);
});

test('Secret Wars no duplica issueId y mantiene un orden determinista',()=>{
  const core=loadCore();
  const result=core.validateSaga(saga);
  assert.equal(result.valid,true);
  assert.deepEqual(Array.from(result.duplicateIssueIds),[]);
  assert.deepEqual(Array.from(result.duplicateOrders),[]);
  assert.equal(result.deterministic,true);
  assert.deepEqual(Array.from(core.orderedEntries(saga),entry=>entry.order),Array.from({length:saga.entries.length},(_,index)=>index+1));
});

test('Principal es subconjunto de Esencial y Esencial de Completo',()=>{
  const core=loadCore();
  const principal=new Set(Array.from(core.entriesForMode(saga,'principal'),entry=>entry.issueId));
  const essential=new Set(Array.from(core.entriesForMode(saga,'essential'),entry=>entry.issueId));
  const complete=new Set(Array.from(core.entriesForMode(saga,'complete'),entry=>entry.issueId));
  assert.equal([...principal].every(id=>essential.has(id)),true);
  assert.equal([...essential].every(id=>complete.has(id)),true);
  assert.deepEqual({principal:principal.size,essential:essential.size,complete:complete.size},saga.expectedCounts);
});

test('Sagas usa setProgress y el mismo state.progress global que Biblioteca',async()=>{
  const context={console,URL,URLSearchParams,Intl,Map,Set,Date,Promise,Blob,navigator:{userAgent:''},window:{},document:{querySelector(){return null},querySelectorAll(){return[]},dispatchEvent(){}},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail}}};
  vm.createContext(context);vm.runInContext(appSource,context);vm.runInContext(coreSource,context);
  vm.runInContext('DB.put=async()=>{};DB.del=async()=>{};DB.kvSet=async()=>{};toast=()=>{};updateStats=()=>{};renderIssues=()=>{};renderRecop=()=>{};requestIdle=()=>{};prefetchUpcoming=async()=>{};',context);
  context.sagaData=saga;
  const issueId=saga.entries.find(entry=>entry.importance==='principal').issueId;
  await vm.runInContext(`setProgress(${issueId},1,'read',false)`,context);
  assert.equal(vm.runInContext(`progressStatus(${issueId})`,context),'read');
  assert.equal(vm.runInContext(`MarvelSagasCore.sagaProgress(sagaData,state.progress,'principal').resolved`,context),1);
  await vm.runInContext(`setProgress(${issueId},1,'pending',false)`,context);
  assert.equal(vm.runInContext(`progressStatus(${issueId})`,context),'pending');
  assert.equal(vm.runInContext(`MarvelSagasCore.sagaProgress(sagaData,state.progress,'principal').resolved`,context),0);
  assert.match(uiSource,/state\.progress/);
  assert.doesNotMatch(uiSource,/indexedDB\.open|createObjectStore\(['"]sagas/);
});

test('Continuar saga devuelve el primer pendiente por order del evento',()=>{
  const core=loadCore();
  const ordered=Array.from(core.entriesForMode(saga,'principal'));
  const progress=new Map(ordered.slice(0,3).map(entry=>[entry.issueId,{id:entry.issueId,status:'read'}]));
  const pending=core.firstPending(saga,progress,'principal');
  assert.equal(pending.issueId,ordered[3].issueId);
  assert.equal(pending.order,ordered[3].order);
  assert.notEqual(issueById.get(pending.issueId).o,pending.order);
});

test('cambiar de modo recalcula el porcentaje sin guardar otro progreso',()=>{
  const core=loadCore();
  const principal=Array.from(core.entriesForMode(saga,'principal'));
  const progress=new Map(principal.map(entry=>[entry.issueId,{id:entry.issueId,status:'read'}]));
  const mainStats=core.sagaProgress(saga,progress,'principal');
  const essentialStats=core.sagaProgress(saga,progress,'essential');
  const completeStats=core.sagaProgress(saga,progress,'complete');
  assert.equal(mainStats.percent,100);
  assert.equal(essentialStats.resolved,9);
  assert.equal(essentialStats.total,38);
  assert.equal(completeStats.resolved,9);
  assert.equal(completeStats.total,264);
  assert.ok(essentialStats.percent>completeStats.percent);
});

test('los filtros de saga no mutan ni corrompen el progreso',()=>{
  const core=loadCore();
  const entries=Array.from(core.entriesForMode(saga,'complete')).slice(0,30);
  const progress=new Map(entries.slice(0,4).map(entry=>[entry.issueId,{id:entry.issueId,status:'read'}]));
  const before=JSON.stringify([...progress]);
  const filtered=core.filterEntries(entries,issueById,progress,{status:'pending',content:'all',era:'marvel',decade:'2010',tokens:[],seriesFor:issue=>({original:String(issue.s)}),decadeFor:issue=>String(issue.d).slice(0,3)+'0'});
  assert.ok(filtered.every(entry=>!progress.has(entry.issueId)));
  assert.equal(JSON.stringify([...progress]),before);
});

test('la UI de Sagas reutiliza tarjetas, detalles, portadas y navegación existentes',()=>{
  assert.match(uiSource,/card\(issue,false\)/);
  assert.match(uiSource,/wireCards\('#sagaIssueList',false\)/);
  assert.match(uiSource,/observeVisibleCards\('#sagaIssueList'\)/);
  assert.match(uiSource,/\/api\/gcd\/cover-image\?id=/);
  assert.match(uiSource,/await openReader\(issue\)/);
  assert.match(uiSource,/dataFileCache:new Map\(\)/);
  assert.match(uiSource,/raw\?\.events\?\.\[meta\.dataKey\]/);
  assert.doesNotMatch(uiSource,/function\s+marvelQuery|\/api\/marvel\/open/);
  assert.match(html,/id="charactersView"/);
  assert.match(html,/id="sagasView"/);
  assert.deepEqual([...html.matchAll(/data-view="([^"]+)"/g)].map(match=>match[1]),['principal','characters','sagas','info']);
  assert.doesNotThrow(()=>new vm.Script(coreSource));
  assert.doesNotThrow(()=>new vm.Script(uiSource));
});

test('cambiar repetidamente entre Lectura, Personajes, Sagas y Guía no produce errores',async()=>{
  class ClassList{
    constructor(active=false){this.values=new Set(active?['active']:[])}
    add(value){this.values.add(value)}remove(value){this.values.delete(value)}
    toggle(value,force){if(force===undefined){if(this.values.has(value))this.values.delete(value);else this.values.add(value);return this.values.has(value)}if(force)this.values.add(value);else this.values.delete(value);return force}
    contains(value){return this.values.has(value)}
  }
  const names=['principal','characters','sagas','info'];
  const tabs=names.map((name,index)=>({dataset:{view:name},classList:new ClassList(index===0)}));
  const views=Object.fromEntries(names.map((name,index)=>[name,{id:`${name}View`,classList:new ClassList(index===0)}]));
  const document={querySelector(selector){return selector.startsWith('#')?views[selector.slice(1,-4)]||null:null},querySelectorAll(selector){return selector==='.tab'?tabs:selector==='.view'?Object.values(views):[]},dispatchEvent(){}};
  const context={console,URL,URLSearchParams,Intl,Map,Set,Date,Promise,Blob,navigator:{userAgent:''},window:{},document,CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail}}};
  vm.createContext(context);vm.runInContext(appSource,context);
  for(let round=0;round<25;round++)for(const name of names)await vm.runInContext(`switchView('${name}')`,context);
  assert.equal(tabs.find(tab=>tab.dataset.view==='info').classList.contains('active'),true);
  assert.equal(views.info.classList.contains('active'),true);
  assert.equal(Object.values(views).filter(view=>view.classList.contains('active')).length,1);
});
