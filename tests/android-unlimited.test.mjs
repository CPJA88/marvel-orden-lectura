import test from'node:test';
import assert from'node:assert/strict';
import fs from'node:fs';
import vm from'node:vm';

const source=fs.readFileSync(new URL('../source/android-unlimited-v130.js',import.meta.url),'utf8');
const meta={
  sourceId:'16926',
  readerId:'3034',
  drn:'drn:src:marvel:unison::prod:12345678-1234-1234-1234-123456789abc',
  webUrl:'https://www.marvel.com/comics/issue/16926'
};

function load(userAgent,baseHref,storedMeta=meta){
  const context={
    URL,
    encodeURIComponent,
    navigator:{userAgent},
    state:{marvel:new Map([[7,storedMeta]])},
    stableAppHref:()=>baseHref
  };
  vm.createContext(context);vm.runInContext(source,context);return context;
}

test('Android abre un intent dirigido a Marvel Unlimited con fallback web del cómic',()=>{
  const smart='https://marvel.smart.link/fiir7ec77?type=issue&drn='+encodeURIComponent(meta.drn)+'&sourceId=16926';
  const context=load('Mozilla/5.0 (Linux; Android 15; Pixel 9)',smart);
  const href=context.stableAppHref({id:7},{});
  assert.match(href,/^intent:\/\/marvel\.smart\.link\/fiir7ec77\?/);
  assert.match(href,/#Intent;scheme=https;package=com\.marvel\.unlimited;/);
  assert.ok(href.includes('S.browser_fallback_url=https%3A%2F%2Fread.marvel.com%2F%23%2Fbook%2F3034;end'));
});

test('Android deriva el Smart Link desde metadata aunque el href base sea local',()=>{
  const context=load('Android','/api/marvel/open?mode=app');
  const href=context.stableAppHref({id:7},{});
  assert.match(href,/^intent:\/\/marvel\.smart\.link\/fiir7ec77\?/);
  assert.ok(href.includes('sourceId=16926'));
});

test('iPhone conserva el Smart Link HTTPS existente',()=>{
  const smart='https://marvel.smart.link/fiir7ec77?type=issue&sourceId=16926';
  const context=load('Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)',smart);
  assert.equal(context.stableAppHref({id:7},{}),smart);
});

test('rechaza destinos no verificados al construir intents',()=>{
  const context=load('Android','https://example.com/not-marvel');
  assert.equal(context.MarvelAndroidUnlimited.androidIntent('https://example.com/not-marvel','https://www.marvel.com/'),'https://example.com/not-marvel');
});
