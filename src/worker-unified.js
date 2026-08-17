const GOOGLE_ORIGIN='https://www.google.com';
const MARVEL_ORIGIN='https://www.marvel.com';
const MARVEL_SMART_LINK='https://marvel.smart.link/fiir7ec77';
const MARVEL_LEGACY_SHARE='https://share.marvel.com/sharing/legacy/';
const RESOLVER_VERSION=6;
const META_TTL=60*60*24*30;

function unescapeHtml(value=''){
  return String(value)
    .replace(/\\u002F/gi,'/')
    .replace(/\\u003A/gi,':')
    .replace(/\\\//g,'/')
    .replace(/&amp;/g,'&')
    .replace(/&quot;/g,'"')
    .replace(/&#39;/g,"'")
    .replace(/&#58;/g,':');
}
function exactGoogleQuery(title,issue,year){return `site:marvel.com/comics/issue/ "${title}" "${issue?`#${issue}`:''}" ${year} Marvel Unlimited`}
function relaxedGoogleQuery(title,issue,year){return `site:marvel.com/comics/issue/ "${title}" "${issue?`#${issue}`:''}" ${year}`}
function luckyUrl(title,issue,year){return `${GOOGLE_ORIGIN}/search?btnI=1&q=${encodeURIComponent(exactGoogleQuery(title,issue,year))}`}
function normalGoogleUrl(title,issue,year,relaxed=false){return `${GOOGLE_ORIGIN}/search?q=${encodeURIComponent(relaxed?relaxedGoogleQuery(title,issue,year):exactGoogleQuery(title,issue,year))}`}
function isMarvelIssueUrl(value=''){try{const u=new URL(value,MARVEL_ORIGIN);return /(^|\.)marvel\.com$/i.test(u.hostname)&&/^\/comics\/issue\/\d+(?:\/|$)/i.test(u.pathname)}catch{return false}}
function cleanMarvelIssueUrl(value=''){try{const u=new URL(value,MARVEL_ORIGIN);if(!isMarvelIssueUrl(u.href))return '';const m=u.pathname.match(/^\/comics\/issue\/\d+(?:\/[^?#]*)?/i);return `${u.protocol}//${u.host}${m?.[0]||u.pathname}`}catch{return ''}}
function sourceIdFromIssueUrl(issueUrl=''){try{return new URL(issueUrl).pathname.match(/^\/comics\/issue\/(\d+)/i)?.[1]||''}catch{return ''}}
function unwrapGoogleLocation(location=''){
  try{
    const a=new URL(location,GOOGLE_ORIGIN);
    if(isMarvelIssueUrl(a.href))return cleanMarvelIssueUrl(a.href);
    if(/google\./i.test(a.hostname)&&a.pathname==='/url'){
      const target=a.searchParams.get('q')||a.searchParams.get('url')||'';
      if(isMarvelIssueUrl(target))return cleanMarvelIssueUrl(target);
    }
  }catch{}
  return '';
}
function extractMarvelIssueFromGoogleHtml(html=''){
  const clean=unescapeHtml(html).replace(/%2F/gi,'/').replace(/%3A/gi,':');
  const direct=clean.match(/https?:\/\/(?:www\.)?marvel\.com\/comics\/issue\/\d+(?:\/[A-Za-z0-9_()%.,+\-]*)?/gi)||[];
  for(const c of direct)if(isMarvelIssueUrl(c))return cleanMarvelIssueUrl(c);
  const links=clean.match(/\/url\?[^"'<>\s]+/gi)||[];
  for(const link of links){try{const p=new URL(link.replace(/&amp;/g,'&'),GOOGLE_ORIGIN),target=p.searchParams.get('q')||p.searchParams.get('url')||'';if(isMarvelIssueUrl(target))return cleanMarvelIssueUrl(target)}catch{}}
  return '';
}
async function fetchGoogle(url,redirect='manual'){
  return fetch(url,{redirect,headers:{'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1','Accept':'text/html,application/xhtml+xml','Accept-Language':'es-ES,es;q=0.9,en;q=0.6'}});
}
async function fetchHtml(url){
  const response=await fetch(url,{redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1','Accept':'text/html,application/xhtml+xml','Accept-Language':'en-US,en;q=0.9'}});
  if(!response.ok)throw new Error(`${url} respondió ${response.status}`);
  return response.text();
}
async function resolveExactIssue(title,issue,year){
  const lucky=luckyUrl(title,issue,year);
  try{
    const response=await fetchGoogle(lucky,'manual'),loc=unwrapGoogleLocation(response.headers.get('Location')||'');
    if(loc)return loc;if(isMarvelIssueUrl(response.url))return cleanMarvelIssueUrl(response.url);
    const from=extractMarvelIssueFromGoogleHtml(await response.text());if(from)return from;
  }catch(e){console.error('Google lucky resolver:',e)}
  for(const relaxed of [false,true]){
    try{const response=await fetchGoogle(normalGoogleUrl(title,issue,year,relaxed),'follow'),from=extractMarvelIssueFromGoogleHtml(await response.text());if(from)return from}catch(e){console.error('Google normal resolver:',e)}
  }
  return '';
}
function absoluteImage(url=''){let v=unescapeHtml(url).trim();if(v.startsWith('//'))v='https:'+v;return /^https?:\/\//i.test(v)?v:''}
function extractCoverUrl(html=''){
  const clean=unescapeHtml(html);
  const patterns=[/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,/"image"\s*:\s*"(https?:[^"\\]+(?:\\.[^"\\]*)*)"/i,/"image_url"\s*:\s*"([^"]+)"/i,/"portrait_xlarge"\s*:\s*"([^"]+)"/i];
  for(const p of patterns){const m=clean.match(p);if(m){const u=absoluteImage(m[1]);if(u)return u}}
  return '';
}
function extractPageTitle(html=''){
  const clean=unescapeHtml(html);
  for(const p of [/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,/<title[^>]*>([^<]+)<\/title>/i]){const m=clean.match(p);if(m)return m[1].replace(/\s+/g,' ').trim()}
  return '';
}
function extractReaderData(html,issueUrl){const clean=unescapeHtml(html),match=clean.match(/https:\/\/read\.marvel\.com\/#\/book\/(\d+)/i);return{readerId:match?.[1]||'',webUrl:match?.[0]||issueUrl}}
async function resolveLegacyDrn(readerId){
  if(!readerId)return '';
  const html=unescapeHtml(await fetchHtml(`${MARVEL_LEGACY_SHARE}${encodeURIComponent(readerId)}`)).replace(/%3A/gi,':');
  let explicit=html.match(/(?:[?&]|\b)drn=([^&"'<>\s]+)/i)?.[1]||'';
  if(explicit){try{explicit=decodeURIComponent(explicit)}catch{}return explicit}
  return html.match(/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i)?.[0]||'';
}
function buildSmartLink(drn,sourceId){if(!drn||!sourceId)return '';const u=new URL(MARVEL_SMART_LINK);u.searchParams.set('type','issue');u.searchParams.set('drn',drn);u.searchParams.set('sourceId',sourceId);return u.toString()}
function currentCacheKey(title,issue,year){const u=new URL('https://marvel-meta-cache.invalid/v6');u.searchParams.set('title',title);u.searchParams.set('issue',issue);u.searchParams.set('year',year);return new Request(u.toString())}
function legacyCacheKeys(title,issue,year){
  const keys=[];
  for(const version of [5]){const u=new URL('https://marvel-meta-cache.invalid/item');u.searchParams.set('resolver',String(version));u.searchParams.set('kind','app-stable');u.searchParams.set('title',title);u.searchParams.set('issue',issue);u.searchParams.set('year',year);keys.push(new Request(u.toString()))}
  {const u=new URL('https://marvel-meta-cache.invalid/item');u.searchParams.set('resolver','4');u.searchParams.set('title',title);u.searchParams.set('issue',issue);u.searchParams.set('year',year);keys.push(new Request(u.toString()))}
  {const u=new URL('https://marvel-meta-cache.invalid/item');u.searchParams.set('title',title);u.searchParams.set('issue',issue);u.searchParams.set('year',year);keys.push(new Request(u.toString()))}
  return keys;
}
async function readCache(key){const cache=typeof caches!=='undefined'?caches.default:null;if(!cache)return null;const hit=await cache.match(key);if(!hit)return null;try{return await hit.json()}catch{return null}}
async function writeCache(key,data){const cache=typeof caches!=='undefined'?caches.default:null;if(!cache)return;await cache.put(key,Response.json(data,{headers:{'Cache-Control':`public, max-age=${META_TTL}`}})).catch(()=>{})}
async function findLegacyPositive(title,issue,year){
  for(const key of legacyCacheKeys(title,issue,year)){
    const hit=await readCache(key);
    if(hit?.smartLink&&hit?.issueUrl){return{...hit,resolverVersion:RESOLVER_VERSION,resolverSource:'legacy-positive-cache'}}
  }
  return null;
}
async function resolveUnifiedMeta(title,issue,year){
  const key=currentCacheKey(title,issue,year),cached=await readCache(key);if(cached?.smartLink)return cached;
  const legacy=await findLegacyPositive(title,issue,year);if(legacy){await writeCache(key,legacy);return legacy}
  const issueUrl=await resolveExactIssue(title,issue,year);
  if(!issueUrl)return{resolverVersion:RESOLVER_VERSION,available:false,issueUrl:'',sourceId:'',readerId:'',drn:'',smartLink:'',webUrl:luckyUrl(title,issue,year),coverUrl:'',pageTitle:'',reason:'lookup-unresolved'};
  const sourceId=sourceIdFromIssueUrl(issueUrl),html=await fetchHtml(issueUrl),reader=extractReaderData(html,issueUrl),coverUrl=extractCoverUrl(html),pageTitle=extractPageTitle(html);
  let drn='',smartLink='';
  if(reader.readerId&&sourceId){try{drn=await resolveLegacyDrn(reader.readerId);smartLink=buildSmartLink(drn,sourceId)}catch(e){console.error('DRN resolver:',e)}}
  const data={resolverVersion:RESOLVER_VERSION,resolverSource:'google-stable',available:Boolean(smartLink),issueUrl,sourceId,readerId:reader.readerId,drn,smartLink,webUrl:reader.webUrl,coverUrl,pageTitle,reason:smartLink?'ok':reader.readerId?'drn-unavailable':'reader-unavailable'};
  if(smartLink||data.reason==='reader-unavailable')await writeCache(key,data);
  return data;
}
async function verifyUrl(url){if(!url)return{ok:false,status:0,location:'',error:'missing-url'};try{const response=await fetch(url,{redirect:'manual',headers:{'User-Agent':'Mozilla/5.0 (compatible; MarvelLectura-Diagnostic/2.1)','Accept':'text/html,*/*;q=0.8'}});return{ok:response.status>=200&&response.status<400,status:response.status,location:response.headers.get('Location')||'',error:''}}catch(e){return{ok:false,status:0,location:'',error:String(e?.message||e)}}}
function knownMetaFromUrl(url){const issueUrl=url.searchParams.get('knownIssueUrl')||'',smartLink=url.searchParams.get('knownSmartLink')||'';if(!issueUrl||!smartLink)return null;return{resolverVersion:RESOLVER_VERSION,available:true,issueUrl,sourceId:url.searchParams.get('knownSourceId')||sourceIdFromIssueUrl(issueUrl),readerId:url.searchParams.get('knownReaderId')||'',drn:url.searchParams.get('knownDrn')||'',smartLink,webUrl:url.searchParams.get('knownWebUrl')||issueUrl,coverUrl:'',pageTitle:url.searchParams.get('knownPageTitle')||'',reason:'client-cache'}}
async function diagnosticMeta(title,issue,year,known=null){
  const meta=known||await resolveUnifiedMeta(title,issue,year);
  const [appCheck,webCheck]=await Promise.all([meta.smartLink?verifyUrl(meta.smartLink):Promise.resolve({ok:false,status:0,location:'',error:'missing-smartlink'}),meta.webUrl&&meta.readerId?verifyUrl(meta.webUrl):Promise.resolve({ok:false,status:0,location:'',error:'missing-reader'})]);
  let diagnosticCode='OK';if(!meta.issueUrl)diagnosticCode='LOOKUP_UNRESOLVED';else if(!meta.readerId)diagnosticCode='NOT_IN_UNLIMITED';else if(!meta.drn)diagnosticCode='DRN_MISSING';else if(!meta.smartLink)diagnosticCode='SMARTLINK_MISSING';else if(!appCheck.ok)diagnosticCode='SMARTLINK_HTTP_ERROR';else if(!webCheck.ok)diagnosticCode='WEB_LINK_HTTP_ERROR';
  return{...meta,appCheck,webCheck,diagnosticCode};
}
function redirect(location){return new Response(null,{status:302,headers:{Location:location,'Cache-Control':'private, no-store'}})}
function errorPage(fallback,msg){const safe=String(fallback).replace(/&/g,'&amp;').replace(/"/g,'&quot;'),text=String(msg||'No he podido construir el enlace de Marvel Unlimited.').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marvel Unlimited</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17181c}.box{width:min(88vw,430px);text-align:center}.logo{display:inline-block;background:#e62429;color:#fff;padding:5px 8px;font-weight:900;font-size:22px}a{display:block;margin-top:20px;padding:14px;border-radius:14px;background:#fff;color:#333;border:1px solid #ddd8cf;text-decoration:none;font-weight:800}p{color:#74747b;font-size:13px;line-height:1.5}</style></head><body><div class="box"><span class="logo">MARVEL</span><h2>Número localizado</h2><p>${text}</p><a href="${safe}">Abrir este número en la web</a></div></body></html>`,{status:502,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})}

export default{async fetch(request,env){
  const url=new URL(request.url);if(url.pathname!=='/api/marvel/open')return env.ASSETS.fetch(request);
  const title=(url.searchParams.get('title')||'').trim(),issue=(url.searchParams.get('issue')||'').trim(),year=(url.searchParams.get('year')||'').trim(),mode=(url.searchParams.get('mode')||'web').toLowerCase();
  if(!title)return new Response('Falta el título del cómic.',{status:400});
  const lucky=luckyUrl(title,issue,year);if(mode==='web')return redirect(lucky);
  try{
    if(mode==='diagnostic')return Response.json({title,issue,year,...await diagnosticMeta(title,issue,year,knownMetaFromUrl(url))},{headers:{'Cache-Control':'no-store'}});
    if(mode==='meta'||mode==='debug')return Response.json({title,issue,year,...await resolveUnifiedMeta(title,issue,year)},{headers:{'Cache-Control':'no-store'}});
    if(mode==='app'||mode==='ios'||mode==='android'){
      const meta=await resolveUnifiedMeta(title,issue,year);if(meta.smartLink)return redirect(meta.smartLink);
      const msg=meta.reason==='reader-unavailable'?'Marvel Unlimited no ofrece este número en su lector digital.':meta.reason==='lookup-unresolved'?'No he podido localizar automáticamente este número para abrirlo en Marvel Unlimited.':'Marvel no ha devuelto el identificador móvil de este número.';return errorPage(meta.webUrl||lucky,msg);
    }
    return new Response('Modo no reconocido.',{status:400});
  }catch(e){
    console.error('Marvel resolver:',e);
    if(mode==='meta'||mode==='debug'||mode==='diagnostic')return Response.json({resolverVersion:RESOLVER_VERSION,available:false,webUrl:lucky,reason:'resolver-error',diagnosticCode:'RESOLVER_ERROR',error:String(e?.message||e)},{status:200,headers:{'Cache-Control':'no-store'}});
    return errorPage(lucky,'Se ha producido un error al construir el enlace de Marvel Unlimited.');
  }
}};