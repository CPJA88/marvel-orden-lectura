import test from'node:test';
import assert from'node:assert/strict';
import fs from'node:fs';
import vm from'node:vm';

function loadMatcher(){
  const context={URL};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL('../source/character-matching-v130.js',import.meta.url),'utf8'),context);
  return context.MarvelCharacterMatching;
}

test('cruza alias, numeración heredada y especiales sin duplicar',()=>{
  const matcher=loadMatcher();
  const series=new Map([
    [1,{original:'The Amazing Spider-Man'}],
    [2,{original:'The Invincible Iron Man'}],
    [3,{original:'Wolverine Origin'}],
    [4,{original:'Marvel Holiday Special'}]
  ]);
  const issues=[
    {id:10,s:1,n:'1',d:'1963-03-01',a:1963,o:30},
    {id:20,s:2,n:'54 (1)',d:'1963-01-01',a:1963,o:20},
    {id:30,s:3,n:'1',d:'2001-09-01',a:2001,o:40},
    {id:40,s:4,n:'[nn]',d:'1996-12-01',a:1996,o:50}
  ];
  const refs=[
    {title:'Amazing Spider-Man',number:'1',dates:'1963-'},
    {title:'Iron Man',number:'1',dates:'1963-1968'},
    {title:'Origin',number:'1',dates:'2001-2002'},
    {title:'Marvel Holiday Special',number:'1996',dates:'1996'},
    {title:'Amazing Spider-Man',number:'1',dates:'1963-'}
  ];
  const result=matcher.matchAppearances(refs,matcher.createIssueIndex(issues,series));
  assert.deepEqual(Array.from(result.issues,issue=>issue.id),[20,10,30,40]);
  assert.equal(result.matchedRefs,5);
  assert.equal(result.duplicateRefs,1);
  assert.equal(result.unmatchedRefs,0);
});

test('no usa una coincidencia difusa débil',()=>{
  const matcher=loadMatcher();
  const series=new Map([[1,{original:'Fantastic Four'}]]);
  const issues=[{id:1,s:1,n:'1',d:'1961-01-01',a:1961,o:1}];
  const result=matcher.matchAppearances([{title:'Thor',number:'1',dates:'1961'}],matcher.createIssueIndex(issues,series));
  assert.equal(result.issues.length,0);
  assert.equal(result.unmatchedRefs,1);
});
