const GOOGLE_ORIGIN='https://www.google.com';
const SHARE_ORIGIN='https://share.marvel.com';
const MARVEL_ORIGIN='https://www.marvel.com';
const MARVEL_SMART_LINK='https://marvel.smart.link/fiir7ec77';
const MARVEL_LEGACY_SHARE='https://share.marvel.com/sharing/legacy/';
const RESOLVER_VERSION=7; // protocolo que espera actualmente la PWA
const CACHE_REV=8; // revisión interna del backend: invalida negativos/ausencias antiguas
const META_TTL=60*60*24*30;
const CATALOG_TTL=60*60*24*7;

function unescapeHtml(value=''){
  return String(value)
    .replace(/\\u002F/gi,'/')
    .replace(/\\u003A/gi,':')
    .replace(/\\\//g,'/')
    .replace(/&amp;/g,'&')
    .replace(/&quot;/g,'"')
    .replace(/&#39;/g,"'")
    .replace(/&#58;/g,':')
    .replace(/&ndash;|&#8211;/g,'-')
    .replace(/&mdash;|&#8212;/g,'-');
}
function stripTags(value=''){return unescapeHtml(String(value).replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim()}
function normalizeText(value=''){
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
}
function normalizeSeriesTitle(value=''){
  return normalizeText(value).replace(/^the\s+/,'').trim();
}
function normalizeIssue(value=''){
  let v=String(value||'').trim().toUpperCase().replace(/\s+/g,'');
  if(/^0+\d+$/.test(v))v=String(Number(v));
  return v;
}
function escapeRegExp(value=''){return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
function exactGoogleQuery(title,issue,year){return `site:marvel.com/comics/issue/ "${title}" "${issue?`#${issue}`:''}" ${year} Marvel Unlimited`}
function luckyUrl(title,issue,year){return `${GOOGLE_ORIGIN}/search?btnI=1&q=${encodeURIComponent(exactGoogleQuery(title,issue,year))}`}
function normalGoogleUrl(title,issue,year){return `${GOOGLE_ORIGIN}/search?q=${encodeURIComponent(exactGoogleQuery(title,issue,year))}`}

function issuePath(value=''){
  try{return new URL(value,MARVEL_ORIGIN).pathname.match(/^\/comics\/issue\/\d+(?:\/[^?#]*)?/i)?.[0]||''}catch{return ''}
}
function isMarvelIssueUrl(value=''){return Boolean(issuePath(value))}
function cleanMarvelIssueUrl(value=''){
  const path=issuePath(value);return path?MARVEL_ORIGIN+path:'';
}
function shareIssueUrl(value=''){
  const path=issuePath(value);return path?SHARE_ORIGIN+path:'';
}
function sourceIdFromIssueUrl(issueUrl=''){try{return new URL(issueUrl).pathname.match(/^\/comics\/issue\/(\d+)/i)?.[1]||''}catch{return ''}}

async function fetchResponse(url,{redirect='follow',lang='en-US,en;q=0.9'}={}){
  return fetch(url,{redirect,headers:{
    'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1',
    'Accept':'text/html,application/xhtml+xml,*/*;q=0.8',
    'Accept-Language':lang
  }});
}
async function fetchHtml(url,opts={}){
  const response=await fetchResponse(url,opts);
  if(!response.ok)throw new Error(`${url} respondió ${response.status}`);
  return response.text();
}

function cacheRequest(path,params={}){
  const u=new URL(`https://marvel-meta-cache.invalid/${path}`);
  for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v??''));
  return new Request(u.toString());
}
async function readCache(key){
  const cache=typeof caches!=='undefined'?caches.default:null;if(!cache)return null;
  const hit=await cache.match(key);if(!hit)return null;
  try{return await hit.json()}catch{return null}
}
async function writeCache(key,data,maxAge=META_TTL){
  const cache=typeof caches!=='undefined'?caches.default:null;if(!cache)return;
  await cache.put(key,Response.json(data,{headers:{'Cache-Control':`public, max-age=${maxAge}`}})).catch(()=>{});
}

function parseSeriesLabel(label=''){
  const clean=stripTags(label);
  const m=clean.match(/^(.*?)\s*\((\d{4})(?:\s*-\s*(?:\d{4}|Present))?\)\s*$/i);
  return{label:clean,title:(m?.[1]||clean).trim(),startYear:m?.[2]||''};
}
function parseSeriesIndex(html=''){
  const out=[],seen=new Set();
  const re=/<a\b[^>]*href=["']([^"']*\/comics\/series\/\d+\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while((m=re.exec(html))){
    let href=unescapeHtml(m[1]);
    try{href=new URL(href,SHARE_ORIGIN).href}catch{continue}
    const parsed=parseSeriesLabel(m[2]);
    const key=href+'|'+parsed.label;if(seen.has(key))continue;seen.add(key);
    out.push({href,label:parsed.label,title:parsed.title,startYear:parsed.startYear,norm:normalizeSeriesTitle(parsed.title)});
  }
  return out;
}
async function getSeriesIndex(){
  const key=cacheRequest(`series-index-v${CACHE_REV}`),cached=await readCache(key);
  if(Array.isArray(cached?.items)&&cached.items.length>100)return cached.items;
  const html=await fetchHtml(`${SHARE_ORIGIN}/comics/series`);
  const items=parseSeriesIndex(html);
  if(items.length<100)throw new Error(`Catálogo Marvel incompleto (${items.length} series)`);
  await writeCache(key,{items},CATALOG_TTL);
  return items;
}
function findSeriesEntry(items,title,year){
  const norm=normalizeSeriesTitle(title),y=String(year||'').trim();
  const exactYear=items.filter(x=>x.norm===norm&&(!y||x.startYear===y));
  if(exactYear.length)return exactYear[0];
  const exactTitle=items.filter(x=>x.norm===norm);
  if(exactTitle.length===1)return exactTitle[0];
  return null;
}

function issueNumberFromLink(text,url){
  const clean=stripTags(text);
  let m=clean.match(/#\s*([0-9]+(?:\.[0-9]+)?|[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)?)/i);
  if(m)return normalizeIssue(m[1]);
  try{
    const slug=decodeURIComponent(new URL(url,MARVEL_ORIGIN).pathname.split('/').pop()||'');
    m=slug.match(/[_-]([0-9]+(?:\.[0-9]+)?)$/i);
    if(m)return normalizeIssue(m[1]);
  }catch{}
  return '';
}
function parseIssueLinks(html=''){
  const map={},all=[];
  const re=/<a\b[^>]*href=["']([^"']*\/comics\/issue\/\d+(?:\/[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while((m=re.exec(html))){
    const publicUrl=cleanMarvelIssueUrl(m[1]);if(!publicUrl)continue;
    const num=issueNumberFromLink(m[2],publicUrl);
    all.push({url:publicUrl,num,text:stripTags(m[2])});
    if(num&&!map[num])map[num]=publicUrl;
  }
  // Algunas páginas insertan URLs en JSON/scripts, sin anchor visible.
  const raw=unescapeHtml(html).replace(/%2F/gi,'/').replace(/%3A/gi,':');
  const matches=raw.match(/(?:https?:\/\/(?:www\.|share\.)?marvel\.com)?\/comics\/issue\/\d+\/[A-Za-z0-9_()%.,+\-]+/gi)||[];
  for(const rawUrl of matches){
    const publicUrl=cleanMarvelIssueUrl(rawUrl.startsWith('http')?rawUrl:MARVEL_ORIGIN+rawUrl);if(!publicUrl)continue;
    const num=issueNumberFromLink('',publicUrl);
    if(num&&!map[num])map[num]=publicUrl;
  }
  return{map,all};
}
async function getSeriesIssues(entry){
  const seriesId=entry.href.match(/\/series\/(\d+)/)?.[1]||normalizeText(entry.label);
  const key=cacheRequest(`series-issues-v${CACHE_REV}`,{seriesId}),cached=await readCache(key);
  if(cached?.map&&Object.keys(cached.map).length)return cached;
  const html=await fetchHtml(entry.href);
  const parsed=parseIssueLinks(html);
  await writeCache(key,parsed,CATALOG_TTL);
  return parsed;
}
async function resolveFromOfficialCatalog(title,issue,year){
  try{
    const items=await getSeriesIndex(),entry=findSeriesEntry(items,title,year);
    if(!entry)return{issueUrl:'',resolverSource:'share-series-catalog',catalogReason:'series-not-found'};
    const issues=await getSeriesIssues(entry),key=normalizeIssue(issue),issueUrl=issues.map[key]||'';
    return{issueUrl,resolverSource:'share-series-catalog',catalogReason:issueUrl?'ok':'issue-not-in-series-page',seriesUrl:entry.href,seriesLabel:entry.label};
  }catch(e){
    console.error('Share catalog resolver:',e);
    return{issueUrl:'',resolverSource:'share-series-catalog-error',catalogReason:String(e?.message||e)};
  }
}

function unwrapGoogleLocation(location=''){
  try{
    const a=new URL(location,GOOGLE_ORIGIN);
    if(isMarvelIssueUrl(a.href))return cleanMarvelIssueUrl(a.href);
    if(/google\./i.test(a.hostname)&&a.pathname==='/url')return cleanMarvelIssueUrl(a.searchParams.get('q')||a.searchParams.get('url')||'');
  }catch{}
  return '';
}
function extractMarvelIssueCandidates(html=''){
  const clean=unescapeHtml(html).replace(/%2F/gi,'/').replace(/%3A/gi,':');
  const found=[...(clean.match(/https?:\/\/(?:www\.|share\.)?marvel\.com\/comics\/issue\/\d+(?:\/[A-Za-z0-9_()%.,+\-]*)?/gi)||[]),...(clean.match(/\/comics\/issue\/\d+(?:\/[A-Za-z0-9_()%.,+\-]*)?/gi)||[])];
  const out=[],seen=new Set();
  for(const raw of found){const u=cleanMarvelIssueUrl(raw.startsWith('http')?raw:MARVEL_ORIGIN+raw);if(u&&!seen.has(u)){seen.add(u);out.push(u)}}
  return out;
}
function extractPageTitle(html=''){
  const clean=unescapeHtml(html);
  for(const p of [/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,/<title[^>]*>([^<]+)<\/title>/i]){const m=clean.match(p);if(m)return stripTags(m[1])}
  return '';
}
function candidateMatches(title,issue,year,pageTitle,issueUrl){
  const expected=normalizeSeriesTitle(title),actual=normalizeSeriesTitle(String(pageTitle).replace(/\|\s*Comic Issues.*$/i,'').replace(/#.*$/,''));
  const titleOk=actual.includes(expected)||expected.includes(actual);
  const issueOk=!issue||new RegExp(`#\\s*${escapeRegExp(String(issue))}(?:\\b|\\s|$)`,'i').test(pageTitle)||issueNumberFromLink('',issueUrl)===normalizeIssue(issue);
  const yearOk=!year||new RegExp(`\\(${escapeRegExp(String(year))}\\)`).test(pageTitle)||String(issueUrl).includes(`_${year}_`);
  return titleOk&&issueOk&&yearOk;
}
async function resolveFromGoogleFallback(title,issue,year){
  try{
    const lucky=luckyUrl(title,issue,year),r=await fetchResponse(lucky,{redirect:'manual',lang:'es-ES,es;q=0.9,en;q=0.6'}),loc=unwrapGoogleLocation(r.headers.get('Location')||'');
    if(loc)return{issueUrl:loc,resolverSource:'google-lucky-fallback'};
    if(r.status===429||/\/sorry\//.test(r.headers.get('Location')||''))return{issueUrl:'',resolverSource:'google-blocked'};
    const candidates=extractMarvelIssueCandidates(await r.text());
    for(const candidate of candidates.slice(0,5)){
      try{const html=await fetchIssueHtml(candidate),pt=extractPageTitle(html);if(candidateMatches(title,issue,year,pt,candidate))return{issueUrl:candidate,resolverSource:'google-html-fallback'}}catch{}
    }
  }catch(e){console.error('Google fallback:',e)}
  try{
    const r=await fetchResponse(normalGoogleUrl(title,issue,year),{redirect:'follow'});
    if(r.status===429||/\/sorry\//.test(r.url||''))return{issueUrl:'',resolverSource:'google-blocked'};
    const candidates=extractMarvelIssueCandidates(await r.text());
    for(const candidate of candidates.slice(0,5)){
      try{const html=await fetchIssueHtml(candidate),pt=extractPageTitle(html);if(candidateMatches(title,issue,year,pt,candidate))return{issueUrl:candidate,resolverSource:'google-fallback'}}catch{}
    }
  }catch(e){console.error('Google normal fallback:',e)}
  return{issueUrl:'',resolverSource:'unresolved'};
}
async function resolveExactIssue(title,issue,year){
  const catalog=await resolveFromOfficialCatalog(title,issue,year);
  if(catalog.issueUrl)return catalog;
  const google=await resolveFromGoogleFallback(title,issue,year);
  return{...catalog,...google,catalogReason:catalog.catalogReason,seriesUrl:catalog.seriesUrl||'',seriesLabel:catalog.seriesLabel||''};
}

function absoluteImage(url=''){let v=unescapeHtml(url).trim();if(v.startsWith('//'))v='https:'+v;return /^https?:\/\//i.test(v)?v:''}
function extractCoverUrl(html=''){
  const clean=unescapeHtml(html);
  const patterns=[/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,/"image"\s*:\s*"(https?:[^"\\]+(?:\\.[^"\\]*)*)"/i,/"image_url"\s*:\s*"([^"]+)"/i,/"portrait_xlarge"\s*:\s*"([^"]+)"/i];
  for(const p of patterns){const m=clean.match(p);if(m){const u=absoluteImage(m[1]);if(u)return u}}
  return '';
}
function extractReaderData(html,issueUrl){
  const clean=unescapeHtml(html),match=clean.match(/https:\/\/read\.marvel\.com\/#\/book\/(\d+)/i);
  const explicitlyUnavailable=/Digital issue is not currently available/i.test(clean);
  return{readerId:match?.[1]||'',webUrl:match?.[0]||issueUrl,explicitlyUnavailable};
}
async function fetchIssueHtml(issueUrl){
  // share.marvel.com es el mismo catálogo oficial y no está sufriendo el 429 de Google.
  const share=shareIssueUrl(issueUrl);
  if(share){try{return await fetchHtml(share)}catch(e){console.error('Share issue fetch:',e)}}
  return fetchHtml(cleanMarvelIssueUrl(issueUrl)||issueUrl);
}
async function resolveLegacyDrn(readerId){
  if(!readerId)return '';
  const html=unescapeHtml(await fetchHtml(`${MARVEL_LEGACY_SHARE}${encodeURIComponent(readerId)}`)).replace(/%3A/gi,':');
  let explicit=html.match(/(?:[?&]|\b)drn=([^&"'<>\s]+)/i)?.[1]||'';
  if(explicit){try{explicit=decodeURIComponent(explicit)}catch{}return explicit}
  return html.match(/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i)?.[0]||'';
}
function buildSmartLink(drn,sourceId){if(!drn||!sourceId)return '';const u=new URL(MARVEL_SMART_LINK);u.searchParams.set('type','issue');u.searchParams.set('drn',drn);u.searchParams.set('sourceId',sourceId);return u.toString()}

function currentCacheKey(title,issue,year){return cacheRequest(`meta-v${CACHE_REV}`,{title,issue,year})}
function legacyCacheKeys(title,issue,year){
  const keys=[];
  for(const rev of [7,6]){const u=new URL(`https://marvel-meta-cache.invalid/v${rev}`);u.searchParams.set('title',title);u.searchParams.set('issue',issue);u.searchParams.set('year',year);keys.push(new Request(u.toString()))}
  {const u=new URL('https://marvel-meta-cache.invalid/item');u.searchParams.set('resolver','5');u.searchParams.set('kind','app-stable');u.searchParams.set('title',title);u.searchParams.set('issue',issue);u.searchParams.set('year',year);keys.push(new Request(u.toString()))}
  return keys;
}
async function findLegacyPositive(title,issue,year){
  for(const key of legacyCacheKeys(title,issue,year)){
    const hit=await readCache(key);if(hit?.smartLink&&hit?.issueUrl)return{...hit,resolverVersion:RESOLVER_VERSION,resolverSource:'legacy-positive-cache'};
  }
  return null;
}
async function resolveUnifiedMeta(title,issue,year){
  const key=currentCacheKey(title,issue,year),cached=await readCache(key);
  if(cached?.smartLink||cached?.reason==='reader-unavailable')return cached;
  const legacy=await findLegacyPositive(title,issue,year);if(legacy){await writeCache(key,legacy);return legacy}
  const resolved=await resolveExactIssue(title,issue,year),issueUrl=resolved.issueUrl;
  if(!issueUrl)return{resolverVersion:RESOLVER_VERSION,resolverSource:resolved.resolverSource,available:false,issueUrl:'',sourceId:'',readerId:'',drn:'',smartLink:'',webUrl:luckyUrl(title,issue,year),coverUrl:'',pageTitle:'',reason:'lookup-unresolved',catalogReason:resolved.catalogReason||'',seriesUrl:resolved.seriesUrl||'',seriesLabel:resolved.seriesLabel||''};
  const sourceId=sourceIdFromIssueUrl(issueUrl),html=await fetchIssueHtml(issueUrl),reader=extractReaderData(html,issueUrl),coverUrl=extractCoverUrl(html),pageTitle=extractPageTitle(html);
  let drn='',smartLink='';
  if(reader.readerId&&sourceId){try{drn=await resolveLegacyDrn(reader.readerId);smartLink=buildSmartLink(drn,sourceId)}catch(e){console.error('DRN resolver:',e)}}
  const reason=smartLink?'ok':reader.explicitlyUnavailable?'reader-unavailable':reader.readerId?'drn-unavailable':'reader-unavailable';
  const data={resolverVersion:RESOLVER_VERSION,resolverSource:resolved.resolverSource,available:Boolean(smartLink),issueUrl,sourceId,readerId:reader.readerId,drn,smartLink,webUrl:reader.webUrl,coverUrl,pageTitle,reason,catalogReason:resolved.catalogReason||'',seriesUrl:resolved.seriesUrl||'',seriesLabel:resolved.seriesLabel||''};
  if(smartLink||reason==='reader-unavailable')await writeCache(key,data);
  return data;
}

async function verifyUrl(url){
  if(!url)return{ok:false,status:0,location:'',error:'missing-url'};
  try{const response=await fetch(url,{redirect:'manual',headers:{'User-Agent':'Mozilla/5.0 (compatible; MarvelLectura-Diagnostic/3.0)','Accept':'text/html,*/*;q=0.8'}});return{ok:response.status>=200&&response.status<400,status:response.status,location:response.headers.get('Location')||'',error:''}}catch(e){return{ok:false,status:0,location:'',error:String(e?.message||e)}}
}
function knownMetaFromUrl(url){
  const issueUrl=url.searchParams.get('knownIssueUrl')||'',smartLink=url.searchParams.get('knownSmartLink')||'';if(!issueUrl||!smartLink)return null;
  return{resolverVersion:RESOLVER_VERSION,available:true,issueUrl,sourceId:url.searchParams.get('knownSourceId')||sourceIdFromIssueUrl(issueUrl),readerId:url.searchParams.get('knownReaderId')||'',drn:url.searchParams.get('knownDrn')||'',smartLink,webUrl:url.searchParams.get('knownWebUrl')||issueUrl,coverUrl:'',pageTitle:url.searchParams.get('knownPageTitle')||'',reason:'client-cache',resolverSource:'client-cache'};
}
async function diagnosticMeta(title,issue,year,known=null){
  const meta=known||await resolveUnifiedMeta(title,issue,year);
  const [appCheck,webCheck]=await Promise.all([
    meta.smartLink?verifyUrl(meta.smartLink):Promise.resolve({ok:false,status:0,location:'',error:'missing-smartlink'}),
    meta.webUrl&&meta.readerId?verifyUrl(meta.webUrl):Promise.resolve({ok:false,status:0,location:'',error:'missing-reader'})
  ]);
  let diagnosticCode='OK';
  if(!meta.issueUrl)diagnosticCode='LOOKUP_UNRESOLVED';
  else if(!meta.readerId)diagnosticCode='NOT_IN_UNLIMITED';
  else if(!meta.drn)diagnosticCode='DRN_MISSING';
  else if(!meta.smartLink)diagnosticCode='SMARTLINK_MISSING';
  else if(!appCheck.ok)diagnosticCode='SMARTLINK_HTTP_ERROR';
  else if(!webCheck.ok)diagnosticCode='WEB_LINK_HTTP_ERROR';
  return{...meta,appCheck,webCheck,diagnosticCode};
}
function redirect(location){return new Response(null,{status:302,headers:{Location:location,'Cache-Control':'private, no-store'}})}
function errorPage(fallback,msg){
  const safe=String(fallback).replace(/&/g,'&amp;').replace(/"/g,'&quot;'),text=String(msg||'No he podido construir el enlace de Marvel Unlimited.').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marvel Unlimited</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17181c}.box{width:min(88vw,430px);text-align:center}.logo{display:inline-block;background:#e62429;color:#fff;padding:5px 8px;font-weight:900;font-size:22px}a{display:block;margin-top:20px;padding:14px;border-radius:14px;background:#fff;color:#333;border:1px solid #ddd8cf;text-decoration:none;font-weight:800}p{color:#74747b;font-size:13px;line-height:1.5}</style></head><body><div class="box"><span class="logo">MARVEL</span><h2>Número localizado</h2><p>${text}</p><a href="${safe}">Abrir este número en la web</a></div></body></html>`,{status:502,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}

export default{async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname!=='/api/marvel/open')return env.ASSETS.fetch(request);
  const title=(url.searchParams.get('title')||'').trim(),issue=(url.searchParams.get('issue')||'').trim(),year=(url.searchParams.get('year')||'').trim(),mode=(url.searchParams.get('mode')||'web').toLowerCase();
  if(!title)return new Response('Falta el título del cómic.',{status:400});
  const lucky=luckyUrl(title,issue,year);
  if(mode==='web')return redirect(lucky);
  try{
    if(mode==='diagnostic')return Response.json({title,issue,year,...await diagnosticMeta(title,issue,year,knownMetaFromUrl(url))},{headers:{'Cache-Control':'no-store'}});
    if(mode==='meta'||mode==='debug')return Response.json({title,issue,year,...await resolveUnifiedMeta(title,issue,year)},{headers:{'Cache-Control':'no-store'}});
    if(mode==='app'||mode==='ios'||mode==='android'){
      const meta=await resolveUnifiedMeta(title,issue,year);
      if(meta.smartLink)return redirect(meta.smartLink);
      const msg=meta.reason==='reader-unavailable'?'Marvel Unlimited no ofrece este número en su lector digital.':meta.reason==='lookup-unresolved'?'No he podido localizar automáticamente este número para abrirlo en Marvel Unlimited.':'Marvel no ha devuelto el identificador móvil de este número.';
      return errorPage(meta.webUrl||lucky,msg);
    }
    return new Response('Modo no reconocido.',{status:400});
  }catch(e){
    console.error('Marvel resolver:',e);
    if(mode==='meta'||mode==='debug'||mode==='diagnostic')return Response.json({resolverVersion:RESOLVER_VERSION,available:false,webUrl:lucky,reason:'resolver-error',diagnosticCode:'RESOLVER_ERROR',error:String(e?.message||e)},{status:200,headers:{'Cache-Control':'no-store'}});
    return errorPage(lucky,'Se ha producido un error al construir el enlace de Marvel Unlimited.');
  }
}};
