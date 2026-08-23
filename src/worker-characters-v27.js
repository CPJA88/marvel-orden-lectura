import baseWorker from './worker-preinstalled-v26.js';
import{parseCharacterAppearances,parseCharacterSearchHtml,parseTitleKeyHtml,normalizeCharacterSource}from'./character-source.mjs';

const MCP='https://www.chronologyproject.com';
const SOURCE_VERSION='mcp-2026-v1';
const SEARCH_TTL=60*60*24;
const APPEARANCE_TTL=60*60*24*7;
const MAX_SOURCE_BYTES=1_500_000;
const FETCH_TIMEOUT_MS=20_000;

function json(data,status=200,ttl=0){
  const headers={'Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':ttl?`public,max-age=${ttl},stale-while-revalidate=${ttl}`:'private,no-store'};
  return Response.json(data,{status,headers});
}

async function readTextBounded(response,maxBytes=MAX_SOURCE_BYTES){
  if(!response.body)return'';
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let total=0,text='';
  try{
    while(true){
      const{done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>maxBytes){await reader.cancel();throw new Error('La fuente de personajes superó el tamaño permitido.')}
      text+=decoder.decode(value,{stream:true});
    }
    return text+decoder.decode();
  }finally{reader.releaseLock()}
}

async function fetchMcp(path,searchParams=null){
  const source=normalizeCharacterSource(path);
  if(!source)throw new Error('Fuente de personaje no válida.');
  const url=new URL(source.path,MCP+'/');
  if(searchParams)for(const[key,value]of searchParams)url.searchParams.set(key,value);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),FETCH_TIMEOUT_MS);
  try{
    const response=await fetch(url,{redirect:'follow',signal:controller.signal,headers:{
      'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 MarvelOrdenLectura/1.3',
      'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language':'en-US,en;q=0.9',
      'Referer':MCP+'/'
    }});
    if(!normalizeCharacterSource(response.url))throw new Error('La fuente de personajes redirigió fuera del dominio permitido.');
    if(!response.ok)throw new Error(`La fuente de personajes respondió con HTTP ${response.status}.`);
    const body=await readTextBounded(response);
    if(!body||/security service to protect itself|access denied|just a moment/i.test(body))throw new Error('La fuente de personajes no está disponible temporalmente.');
    return body;
  }catch(error){
    if(error?.name==='AbortError')throw new Error('La fuente de personajes tardó demasiado en responder.');
    throw error;
  }finally{clearTimeout(timer)}
}

function cacheRequest(url,kind){
  const key=new URL(`https://character-cache.invalid/${SOURCE_VERSION}/${kind}`);
  for(const[name,value]of [...url.searchParams].sort(([a],[b])=>a.localeCompare(b)))key.searchParams.append(name,value);
  return new Request(key.toString());
}

async function cachedResponse(key){
  const cache=typeof caches!=='undefined'?caches.default:null;
  return cache?cache.match(key):null;
}

function rememberResponse(key,response,ctx){
  const cache=typeof caches!=='undefined'?caches.default:null;
  if(cache&&ctx?.waitUntil)ctx.waitUntil(cache.put(key,response.clone()).catch(()=>{}));
}

function searchRank(name,query){
  const clean=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const n=clean(name),primary=clean(String(name).split('/')[0]),q=clean(query);
  let rank=primary===q?0:primary.startsWith(q)?1:n.includes(q)?2:3;
  if(/\bearth\b|alternate universe|ultimate universe|2099/i.test(name))rank+=4;
  return rank;
}

async function characterSearch(url,ctx){
  const query=String(url.searchParams.get('q')||'').trim();
  if(query.length<2||query.length>60)return json({error:'Escribe entre 2 y 60 caracteres.'},400);
  const key=cacheRequest(url,'search'),hit=await cachedResponse(key);if(hit)return hit;
  const html=await fetchMcp('searchthemcp.php',new URLSearchParams({searchForCharacters:query}));
  const results=parseCharacterSearchHtml(html).sort((a,b)=>searchRank(a.name,query)-searchRank(b.name,query)||a.name.localeCompare(b.name));
  const response=json({query,results,source:{name:'Marvel Chronology Project',url:MCP+'/searchthemcp.php'}},200,SEARCH_TTL);
  rememberResponse(key,response,ctx);return response;
}

async function characterAppearances(url,ctx){
  const path=String(url.searchParams.get('path')||''),anchor=String(url.searchParams.get('anchor')||''),label=String(url.searchParams.get('name')||'').trim();
  const source=normalizeCharacterSource(`${path}${anchor?'#'+anchor:''}`);
  if(!source||!label||label.length>180)return json({error:'Personaje o fuente no válidos.'},400);
  const key=cacheRequest(url,'appearances'),hit=await cachedResponse(key);if(hit)return hit;
  const[characterHtml,keyHtml]=await Promise.all([fetchMcp(source.path),fetchMcp('key.php')]);
  const titleKey=parseTitleKeyHtml(keyHtml),appearances=parseCharacterAppearances(characterHtml,{anchor:source.anchor,label},titleKey);
  if(!appearances.length)return json({error:'No se encontraron apariciones narrativas para este personaje.'},404);
  const sourceUrl=`${MCP}/${source.path}${source.anchor?'#'+encodeURIComponent(source.anchor):''}`;
  const response=json({name:label,appearances,excluded:'cover-ad-mention-bts',source:{name:'Marvel Chronology Project',url:sourceUrl}},200,APPEARANCE_TTL);
  rememberResponse(key,response,ctx);return response;
}

export default{async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname==='/api/characters/search'||url.pathname==='/api/characters/appearances'){
    if(request.method!=='GET')return json({error:'Método no permitido.'},405);
    try{return url.pathname.endsWith('/search')?await characterSearch(url,ctx):await characterAppearances(url,ctx)}
    catch(error){console.warn('characters',url.pathname,error);return json({error:error?.message||'No se pudo consultar la fuente de personajes.'},502)}
  }
  return baseWorker.fetch(request,env,ctx);
}};
