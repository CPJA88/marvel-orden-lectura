import test from'node:test';
import assert from'node:assert/strict';
import worker from'../src/worker-characters-v27.js';

const keyHtml=`<table><caption>TITLE KEY By KEY</caption>
  <tr><td>ASM</td><td>Amazing Spider-Man</td><td>1963-</td></tr>
</table>`;
const characterHtml='<p id="SPIDER"><span class="char"><b>SPIDER-MAN/PETER PARKER</b></span><br>ASM 1<br>ASM 2-BTS<br><hr>';

test('el Worker entrega apariciones narrativas estructuradas',async t=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async input=>{
    const url=new URL(String(input));
    const response=url.pathname==='/key.php'?new Response(keyHtml,{status:200}):url.pathname==='/spidey.php'?new Response(characterHtml,{status:200}):null;
    if(response){Object.defineProperty(response,'url',{value:url.toString()});return response}
    throw new Error(`URL inesperada: ${url}`);
  };
  t.after(()=>{globalThis.fetch=originalFetch});
  const response=await worker.fetch(new Request('https://app.invalid/api/characters/appearances?path=spidey.php&anchor=SPIDER&name=SPIDER-MAN%2FPETER%20PARKER'),{},{});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.appearances.length,1);
  assert.deepEqual(body.appearances[0],{
    code:'ASM',title:'Amazing Spider-Man',dates:'1963-',number:'1',annual:false,raw:'ASM 1'
  });
  assert.equal(body.excluded,'cover-ad-mention-bts');
});

test('el Worker valida método y ruta de fuente',async()=>{
  const method=await worker.fetch(new Request('https://app.invalid/api/characters/search?q=spider',{method:'POST'}),{},{});
  assert.equal(method.status,405);
  const source=await worker.fetch(new Request('https://app.invalid/api/characters/appearances?path=https%3A%2F%2Fevil.invalid%2Fx.php&name=X'),{},{});
  assert.equal(source.status,400);
});
