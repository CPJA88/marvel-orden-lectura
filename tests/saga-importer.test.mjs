import test from'node:test';
import assert from'node:assert/strict';
import{buildGeneratedSaga,buildLibraryIndex,matchReference,parseCbroHtml,parseIssueLines}from'../scripts/saga-importer-lib.mjs';

test('el parser conserva un orden de fuente determinista y reconoce números con sufijo',()=>{
  const parsed=parseIssueLines(['Avengers #1 (2026)','Avengers #2','Amazing Spider-Man #14AU (2013)'],2026);
  assert.deepEqual(parsed.map(reference=>[reference.series,reference.number,reference.publicationYear,reference.sourceOrder]),[
    ['Avengers','1',2026,1],
    ['Avengers','2',2026,2],
    ['Amazing Spider-Man','14AU',2013,3]
  ]);
  const html='<div role="tabpanel" aria-hidden="false"><p>Avengers #1 (2026)<br>Avengers #2</p></div>';
  assert.deepEqual(parseCbroHtml(html,2026).map(reference=>reference.number),['1','2']);
});

test('la ventana estricta de 2026 impide enlazar un volumen antiguo con el mismo número',()=>{
  const series=[{id:1,original:'Captain America'}];
  const oldIndex=buildLibraryIndex(series,[{id:100,s:1,n:'14',d:'2024-10-30',a:2024,c:'principal'}]);
  const reference={series:'Captain America',number:'14',publicationYear:2025,maxYearDistance:0};
  assert.equal(matchReference(reference,oldIndex,2026).issue,null);
  const currentIndex=buildLibraryIndex(series,[
    {id:100,s:1,n:'14',d:'2024-10-30',a:2024,c:'principal'},
    {id:200,s:1,n:'14',d:'2026-08-05',a:2026,c:'principal'}
  ]);
  assert.equal(matchReference(reference,currentIndex,2026).issue.id,200);
});

test('el importador documenta ausencias y duplicados sin crear issueId',()=>{
  const series=[{id:7,original:'Event'}];
  const index=buildLibraryIndex(series,[{id:700,s:7,n:'1',d:'2020-01-01',a:2020,c:'principal'}]);
  const references=parseIssueLines(['Event #1 (2020)','Event #1 (2020)','Missing Tie-In #1 (2020)'],2020);
  const saga=buildGeneratedSaga({id:'event-2020',title:'Event',year:2020},references,index,{sourceUrl:'https://example.com/order'});
  assert.deepEqual(saga.entries.map(entry=>entry.issueId),[700]);
  assert.equal(saga.unresolvedReferences.length,2);
  assert.equal(saga.unresolvedReferences.every(reference=>reference.referenceId&&!Object.hasOwn(reference,'issueId')),true);
  assert.deepEqual(saga.entries.map(entry=>entry.order),[1]);
  assert.deepEqual(saga.targetCounts,{principal:2,essential:2,complete:3});
});
