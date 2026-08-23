import test from'node:test';
import assert from'node:assert/strict';
import{
  normalizeCharacterSource,
  parseCharacterSearchHtml,
  parseTitleKeyHtml,
  extractCharacterSection,
  parseCharacterAppearances
}from'../src/character-source.mjs';

test('solo acepta páginas PHP del dominio de la fuente',()=>{
  assert.deepEqual(normalizeCharacterSource('https://www.chronologyproject.com/spidey.php#SPIDER'),{path:'spidey.php',anchor:'SPIDER'});
  assert.equal(normalizeCharacterSource('https://example.com/spidey.php#SPIDER'),null);
  assert.equal(normalizeCharacterSource('../private/key.php'),null);
  assert.equal(normalizeCharacterSource('spidey.html'),null);
});

test('extrae y deduplica resultados de búsqueda de personajes',()=>{
  const html=`<p>Results for spider</p>
    <a href="spidey.php#SPIDER">SPIDER-MAN/PETER PARKER</a><br>
    <a href="spidey.php#SPIDER">duplicado</a><br>
    <a href="https://evil.invalid/x.php">fuera</a>
    <p>The search query returned 2 rows</p>`;
  assert.deepEqual(parseCharacterSearchHtml(html),[
    {name:'SPIDER-MAN/PETER PARKER',path:'spidey.php',anchor:'SPIDER'}
  ]);
});

test('lee la clave de títulos y la sección exacta del personaje',()=>{
  const keyHtml=`<table><caption>TITLE KEY By KEY</caption>
    <tr><td>ASM</td><td>Amazing Spider-Man</td><td>1963-</td></tr>
    <tr><td>CA</td><td>Captain America</td><td>1968-1996</td></tr>
  </table>`;
  const keys=parseTitleKeyHtml(keyHtml);
  assert.deepEqual(keys.map(row=>row.code),['ASM','CA']);

  const page=`<p id="SPIDER"><span class="char"><b>SPIDER-MAN/PETER PARKER</b></span><br>
    ASM 1<br>ASM 2-FB ~ ASM 3-VO<br>ASM 4-BTS<br>ASM@ 1/2<br>ASM '64<br>
    <p id="VENOM"><span class="char"><b>VENOM</b></span><br>ASM 300<br><hr>`;
  assert.match(extractCharacterSection(page,'SPIDER','SPIDER-MAN/PETER PARKER'),/ASM 1/);
  assert.doesNotMatch(extractCharacterSection(page,'SPIDER','SPIDER-MAN/PETER PARKER'),/ASM 300/);
  assert.deepEqual(parseCharacterAppearances(page,{anchor:'SPIDER',label:'SPIDER-MAN/PETER PARKER'},keys).map(ref=>[ref.title,ref.number]),[
    ['Amazing Spider-Man','1'],
    ['Amazing Spider-Man','2'],
    ['Amazing Spider-Man','3'],
    ['Amazing Spider-Man ANNUAL','1'],
    ['Amazing Spider-Man ANNUAL','1964']
  ]);
});

test('también reconoce el formato antiguo con anclas name',()=>{
  const keys=[{code:'UXM',title:'Uncanny X-Men',dates:'1981-2011'}];
  const page='<b><a name="STORM"></a>STORM/ORORO MUNROE</b><br>UXM 100-OP<br><b><a name="NEXT"></a>NEXT</b><br>UXM 101<br>';
  assert.deepEqual(parseCharacterAppearances(page,{anchor:'STORM',label:'STORM/ORORO MUNROE'},keys).map(ref=>ref.number),['100']);
});
