import { createHash } from 'node:crypto';
import stableWorker from './worker-stable.js';
import gcdWorker from './worker-neighbor-gcd-v16.js';

const MARVEL_API='https://gateway.marvel.com/v1/public/comics';
const LEGACY='https://share.marvel.com/sharing/legacy/';
const SMART='https://marvel.smart.link/fiir7ec77';
const GOOGLE='https://www.google.com';
const RESOLVER_VERSION=9;
const CACHE_REV=17;
const META_TTL=60*60*24*30;

function normalize(v=''){
  return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
}
function normalizeSeries(v=''){
  return normalize(String(v).replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|Present))?\s*\)/gi,' ')).replace(/^the\s+/,'').replace(/\s+comics$/,'').trim();
}
function tokens(v=''){return normalizeSeries(v).split(/\s+/).filter(Boolean)}
function similarity(a,b){
  const A=new Set(tokens(a)),B=new Set(tokens(b));if(!A.size||!B.size)return 0;
  let common=0;for(const x of A)if(B.has(x))common++;
  return common/Math.max(A.size,B.size);
}
function normalizeIssue(v=''){let s=String(v||'').trim().toUpperCase().replace(/\s+/g,'');if(/^0+\d+$/.test(s))s=String(Number(s));return s}
function luckyUrl(title,issue,year){return `${GOOGLE}/search?btnI=1&q=${encodeURIComponent(`site:marvel.com/comics/issue/ "${title}" "#${issue}" ${year} Marvel Unlimited`)}`}
function cleanIssueUrl(v=''){
  try{const u=new URL(v);const m=u.pathname.match(/^\/comics\/issue\/\d+(?:\/[^?#]*)?/i);return m?`https://www.marvel.com${m[0]}`:''}catch{return ''}
}
function detailUrl(comic){
  for(const item of comic?.urls||[]){const u=cleanIssueUrl(item?.url||'');if(u)return u}
  return comic?.id?`https://www.marvel.com/comics/issue/${comic.id}`:'';
}
function apiSeriesName(comic){return String(comic?.series?.name||comic?.title||'').replace(/#.*$/,'').trim()}
function apiMatches(comic,title,issue,year){
  const issueWanted=normalizeIssue(issue),comicIssue=normalizeIssue(comic?.issueNumber);
  const issueOk=!issueWanted||comicIssue===issueWanted||normalize(comic?.title||'').endsWith(normalize(`#${issueWanted}`));
  const titleOk=similarity(title,apiSeriesName(comic))>=0.66||normalizeSeries(title)===normalizeSeries(apiSeriesName(comic));
  const y=String(year||'').trim(),seriesName=String(comic?.series?.name||''),comicTitle=String(comic?.title||'');
  const yearOk=!y||seriesName.includes(`(${y}`)||comicTitle.includes(`(${y})`);
  return titleOk&&issueOk&&yearOk;
}
function titleVariants(title){
  const src=String(title||'').trim(),out=[src],plain=src.replace(/^The\s+/i,'');
  if(plain!==src)out.push(plain);
  const norm=normalizeSeries(src);
  if(norm==='human torch')out.push('Human Torch Comics');
  if(norm==='sub mariner')out.push('Sub-Mariner Comics');
  if(norm==='captain america')out.push('Captain America Comics');
  return [...new Set(out.filter(Boolean))];
}

function cacheRequest(path,params={}){const u=new URL(`https://marvel-api-cache.invalid/${path}`);for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v??''));return new Request(u.toString())}
async function readCache(key){const c=typeof caches!=='undefined'?caches.default:null;if(!c)return null;const hit=await c.match(key);if(!hit)return null;try{return await hit.json()}catch{return null}}
async function writeCache(key,data,maxAge=META_TTL){const c=typeof caches!=='undefined'?caches.default:null;if(!c)return;await c.put(key,Response.json(data,{headers:{'Cache-Control':`public, max-age=${maxAge}`}})).catch(()=>{})}
function metaKey(title,issue,year){return cacheRequest(`meta-v${CACHE_REV}`,{title,issue,year})}
function stableLegacyKey(title,issue,year){const u=new URL('https://marvel-meta-cache.invalid/item');u.searchParams.set('resolver','5');u.searchParams.set('kind','app-stable');u.searchParams.set('title',title);u.searchParams.set('issue',issue);u.searchParams.set('year',year);return new Request(u.toString())}
async function legacyPositive(title,issue,year){const hit=await readCache(stableLegacyKey(title,issue,year));return hit?.smartLink&&hit?.issueUrl?hit:null}

function apiConfigured(env){return Boolean(env?.MARVEL_PUBLIC_KEY&&env?.MARVEL_PRIVATE_KEY)}
function authParams(env){
  const ts=String(Date.now()),hash=createHash('md5').update(ts+String(env.MARVEL_PRIVATE_KEY)+String(env.MARVEL_PUBLIC_KEY)).digest('hex');
  return{ts,apikey:String(env.MARVEL_PUBLIC_KEY),hash};
}
async function apiCall(env,params){
  const u=new URL(MARVEL_API),auth=authParams(env);
  for(const [k,v] of Object.entries({...params,...auth}))if(v!==''&&v!==undefined&&v!==null)u.searchParams.set(k,String(v));
  const started=Date.now();
  try{
    const r=await fetch(u,{headers:{Accept:'application/json','User-Agent':'MarvelReadingGuide/1.3'}}),status=r.status;
    let json={};try{json=await r.json()}catch{}
    return{ok:r.ok,status,ms:Date.now()-started,url:u.toString().replace(String(env.MARVEL_PUBLIC_KEY),'[PUBLIC_KEY]'),json,error:r.ok?'':String(json?.status||json?.message||`HTTP ${status}`)};
  }catch(e){return{ok:false,status:0,ms:Date.now()-started,url:u.toString().replace(String(env.MARVEL_PUBLIC_KEY),'[PUBLIC_KEY]'),json:{},error:String(e?.message||e)}}
}
async function resolveComicFromApi(env,title,issue,year){
  if(!apiConfigured(env))return{comic:null,apiConfigured:false,attempts:[],reason:'api-not-configured'};
  const issueValue=/^\d+(?:\.\d+)?$/.test(String(issue||''))?String(Number(issue)):'';
  const attempts=[];
  for(const variant of titleVariants(title)){
    const call=await apiCall(env,{title:variant,startYear:year,issueNumber:issueValue,noVariants:'true',limit:20});
    attempts.push({kind:'title',query:variant,status:call.status,ms:call.ms,count:call.json?.data?.count??0,total:call.json?.data?.total??0,error:call.error});
    if(call.ok){const rows=call.json?.data?.results||[],match=rows.find(c=>apiMatches(c,title,issue,year));if(match)return{comic:match,apiConfigured:true,attempts,reason:'ok'}}
  }
  const first=tokens(title).slice(0,2).join(' ');
  if(first){
    const call=await apiCall(env,{titleStartsWith:first,startYear:year,issueNumber:issueValue,noVariants:'true',limit:50});
    attempts.push({kind:'titleStartsWith',query:first,status:call.status,ms:call.ms,count:call.json?.data?.count??0,total:call.json?.data?.total??0,error:call.error});
    if(call.ok){const rows=call.json?.data?.results||[],ranked=rows.filter(c=>apiMatches(c,title,issue,year)).sort((a,b)=>similarity(title,apiSeriesName(b))-similarity(title,apiSeriesName(a)));if(ranked[0])return{comic:ranked[0],apiConfigured:true,attempts,reason:'ok'}}
  }
  return{comic:null,apiConfigured:true,attempts,reason:attempts.some(a=>a.status===401||a.status===409)?'api-auth-error':'api-no-match'};
}

function unescapeHtml(v=''){return String(v).replace(/\\u002F/gi,'/').replace(/\\u003A/gi,':').replace(/\\\//g,'/').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'")}
async function resolveDrn(readerId){
  if(!readerId)return '';
  const r=await fetch(`${LEGACY}${encodeURIComponent(readerId)}`,{headers:{'User-Agent':'Mozilla/5.0','Accept':'text/html,*/*;q=0.8'}});if(!r.ok)throw new Error(`share.marvel.com HTTP ${r.status}`);
  const html=unescapeHtml(await r.text()).replace(/%3A/gi,':');let d=html.match(/(?:[?&]|\b)drn=([^&"'<>\s]+)/i)?.[1]||'';
  if(d){try{d=decodeURIComponent(d)}catch{}return d}
  return html.match(/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i)?.[0]||'';
}
function smartLink(drn,sourceId){if(!drn||!sourceId)return '';const u=new URL(SMART);u.searchParams.set('type','issue');u.searchParams.set('drn',drn);u.searchParams.set('sourceId',String(sourceId));return u.toString()}
function apiCover(comic){const p=String(comic?.thumbnail?.path||'').replace(/^http:/,'https:'),ext=String(comic?.thumbnail?.extension||'');return p&&ext?`${p}/portrait_uncanny.${ext}`:''}
async function resolveMeta(env,title,issue,year){
  const key=metaKey(title,issue,year),cached=await readCache(key);if(cached?.smartLink||cached?.reason==='reader-unavailable')return cached;
  const legacy=await legacyPositive(title,issue,year);if(legacy){const data={...legacy,resolverVersion:RESOLVER_VERSION,resolverSource:'legacy-positive-cache',apiConfigured:apiConfigured(env)};await writeCache(key,data);return data}
  const resolved=await resolveComicFromApi(env,title,issue,year);
  if(!resolved.comic){return{resolverVersion:RESOLVER_VERSION,resolverSource:'marvel-api',apiConfigured:resolved.apiConfigured,apiAttempts:resolved.attempts,available:false,issueUrl:'',sourceId:'',readerId:'',digitalId:0,drn:'',smartLink:'',webUrl:luckyUrl(title,issue,year),coverUrl:'',pageTitle:'',reason:resolved.reason,error:resolved.reason==='api-auth-error'?'Marvel API rechazó las credenciales.':''}}
  const comic=resolved.comic,sourceId=String(comic.id||''),readerId=String(comic.digitalId||''),issueUrl=detailUrl(comic),coverUrl=apiCover(comic),pageTitle=String(comic.title||'');
  if(!Number(comic.digitalId||0)){
    const data={resolverVersion:RESOLVER_VERSION,resolverSource:'marvel-api',apiConfigured:true,apiAttempts:resolved.attempts,available:false,issueUrl,sourceId,readerId:'',digitalId:0,drn:'',smartLink:'',webUrl:issueUrl,coverUrl,pageTitle,reason:'reader-unavailable'};await writeCache(key,data);return data;
  }
  let drn='',link='',drnError='';
  try{drn=await resolveDrn(readerId);link=smartLink(drn,sourceId)}catch(e){drnError=String(e?.message||e)}
  const data={resolverVersion:RESOLVER_VERSION,resolverSource:'marvel-api',apiConfigured:true,apiAttempts:resolved.attempts,available:Boolean(link),issueUrl,sourceId,readerId,digitalId:Number(comic.digitalId||0),drn,smartLink:link,webUrl:`https://read.marvel.com/#/book/${readerId}`,coverUrl,pageTitle,reason:link?'ok':'drn-unavailable',drnError};
  if(link)await writeCache(key,data);return data;
}
async function verify(url){if(!url)return{ok:false,status:0,error:'missing-url'};try{const r=await fetch(url,{redirect:'manual',headers:{'User-Agent':'MarvelReadingGuide-Diagnostic/9.0'}});return{ok:r.status>=200&&r.status<400,status:r.status,error:'',location:r.headers.get('Location')||''}}catch(e){return{ok:false,status:0,error:String(e?.message||e),location:''}}}
function diagnosticCode(m,a,w){
  if(m.reason==='api-not-configured')return'MARVEL_API_NOT_CONFIGURED';
  if(m.reason==='api-auth-error')return'MARVEL_API_AUTH_ERROR';
  if(m.reason==='api-no-match')return'LOOKUP_UNRESOLVED';
  if(!m.issueUrl)return'LOOKUP_UNRESOLVED';
  if(m.reason==='reader-unavailable')return'NOT_IN_UNLIMITED';
  if(!m.readerId)return'READER_ID_MISSING';
  if(!m.drn)return'DRN_MISSING';
  if(!m.smartLink)return'SMARTLINK_MISSING';
  if(!a.ok)return'SMARTLINK_HTTP_ERROR';
  if(!w.ok)return'WEB_LINK_HTTP_ERROR';
  return'OK';
}
function redirect(location){return new Response(null,{status:302,headers:{Location:location,'Cache-Control':'private, no-store'}})}
function errorPage(fallback,msg){const safe=String(fallback).replace(/&/g,'&amp;').replace(/"/g,'&quot;'),text=String(msg).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));return new Response(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marvel Unlimited</title><body style="font-family:-apple-system,sans-serif;padding:32px;text-align:center"><h2>Marvel Unlimited</h2><p>${text}</p><a href="${safe}">Abrir este número en la web</a></body></html>`,{status:502,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})}

async function traceResponse(env,title,issue,year,gcdId){
  const started=Date.now(),meta=await resolveMeta(env,title,issue,year);let gcd={status:0,data:{}};
  if(gcdId){const req=new Request(`https://local.invalid/api/gcd/cover?id=${encodeURIComponent(gcdId)}`,{headers:{Accept:'application/json'}});const r=await gcdWorker.fetch(req,env);let data={};try{data=await r.json()}catch{}gcd={status:r.status,data}}
  const attempts=(meta.apiAttempts||[]).map(a=>({name:`marvel-api-${a.kind}`,url:'https://gateway.marvel.com/v1/public/comics',status:a.status||0,ms:a.ms||0,error:a.error||'',signals:[`query:${a.query||''}`,`count:${a.count??0}`,`total:${a.total??0}`],candidates:[]}));
  if(gcdId)attempts.push({name:'gcd-cover-api',url:`https://www.comics.org/api/issue/${gcdId}/`,status:gcd.status||0,ms:0,error:gcd.data?.error||'',signals:[gcd.data?.coverUrl?'COVER_FOUND':'cover-missing'],candidates:gcd.data?.coverUrl?[gcd.data.coverUrl]:[]});
  return{traceVersion:9,generatedAt:new Date().toISOString(),query:{title,issue,year,gcdId},failureStage:meta.reason==='api-not-configured'?'MARVEL_API_NOT_CONFIGURED':meta.reason==='api-auth-error'?'MARVEL_API_AUTH_ERROR':meta.smartLink?'OK':meta.reason==='reader-unavailable'?'CONFIRMED_NOT_IN_UNLIMITED':meta.reason==='api-no-match'?'MARVEL_API_NO_MATCH':meta.reason==='drn-unavailable'?'DRN_NOT_FOUND':'LOOKUP_UNRESOLVED',finalMs:Date.now()-started,final:{...meta,gcdCoverStatus:gcd.status||0,gcdCoverUrl:gcd.data?.coverUrl||'',gcdCoverError:gcd.data?.error||''},attempts,issueProbe:null,drnProbe:null,smartProbe:null};
}

export default{async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname==='/api/gcd/cover')return gcdWorker.fetch(request,env,ctx);
  if(url.pathname==='/api/marvel/config')return Response.json({resolverVersion:RESOLVER_VERSION,configured:apiConfigured(env)},{headers:{'Cache-Control':'no-store'}});
  if(url.pathname==='/api/marvel/trace'){
    const title=(url.searchParams.get('title')||'').trim(),issue=(url.searchParams.get('issue')||'').trim(),year=(url.searchParams.get('year')||'').trim(),gcdId=(url.searchParams.get('gcdId')||'').trim();
    if(!title)return Response.json({error:'missing-title'},{status:400});return Response.json(await traceResponse(env,title,issue,year,gcdId),{headers:{'Cache-Control':'no-store'}});
  }
  if(url.pathname!=='/api/marvel/open')return env.ASSETS.fetch(request);
  const title=(url.searchParams.get('title')||'').trim(),issue=(url.searchParams.get('issue')||'').trim(),year=(url.searchParams.get('year')||'').trim(),mode=(url.searchParams.get('mode')||'web').toLowerCase();if(!title)return new Response('Falta el título.',{status:400});
  const lucky=luckyUrl(title,issue,year);if(mode==='web')return redirect(lucky);
  try{
    const meta=await resolveMeta(env,title,issue,year);
    if(mode==='meta'||mode==='debug')return Response.json({title,issue,year,...meta},{headers:{'Cache-Control':'no-store'}});
    if(mode==='diagnostic'){
      const [appCheck,webCheck]=await Promise.all([meta.smartLink?verify(meta.smartLink):Promise.resolve({ok:false,status:0,error:'missing-smartlink'}),meta.webUrl&&meta.readerId?verify(meta.webUrl):Promise.resolve({ok:false,status:0,error:'missing-reader'})]);
      return Response.json({title,issue,year,...meta,appCheck,webCheck,diagnosticCode:diagnosticCode(meta,appCheck,webCheck)},{headers:{'Cache-Control':'no-store'}});
    }
    if(mode==='app'||mode==='ios'||mode==='android'){
      if(meta.smartLink)return redirect(meta.smartLink);
      if(meta.reason==='api-not-configured')return stableWorker.fetch(request,env,ctx);
      if(meta.reason==='reader-unavailable')return errorPage(meta.webUrl||lucky,'Marvel indica que este número no tiene edición digital disponible.');
      return errorPage(meta.webUrl||lucky,'No he podido construir todavía el enlace de Marvel Unlimited para este número.');
    }
    return new Response('Modo no reconocido.',{status:400});
  }catch(e){if(mode==='meta'||mode==='debug'||mode==='diagnostic')return Response.json({resolverVersion:RESOLVER_VERSION,available:false,reason:'resolver-error',diagnosticCode:'RESOLVER_ERROR',error:String(e?.message||e),webUrl:lucky},{headers:{'Cache-Control':'no-store'}});return stableWorker.fetch(request,env,ctx)}
}};