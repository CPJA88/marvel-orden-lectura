const GOOGLE_ORIGIN='https://www.google.com';
const MARVEL_ORIGIN='https://www.marvel.com';
const SHARE_ORIGIN='https://share.marvel.com';
const MARVEL_SMART_LINK='https://marvel.smart.link/fiir7ec77';
const MARVEL_LEGACY_SHARE='https://share.marvel.com/sharing/legacy/';
const RESOLVER_VERSION=7;
const CACHE_REV=10;
const META_TTL=60*60*24*30;
const SERIES_TTL=60*60*24*7;

function unescapeHtml(v=''){
  return String(v)
    .replace(/\\u002F/gi,'/').replace(/\\u003A/gi,':').replace(/\\\//g,'/')
    .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/&#58;/g,':').replace(/&ndash;|&#8211;/g,'-').replace(/&mdash;|&#8212;/g,'-');
}
function stripTags(v=''){return unescapeHtml(String(v).replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim()}
function normalizeText(v=''){return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim()}
function normalizeSeries(v=''){return normalizeText(v).replace(/^the\s+/,'').replace(/\s+comics$/,'').trim()}
function tokens(v=''){return normalizeSeries(v).split(/\s+/).filter(Boolean)}
function normalizeIssue(v=''){
  let s=String(v||'').trim().toUpperCase().replace(/\s+/g,'');
  if(/^0+\d+$/.test(s))s=String(Number(s));
  return s;
}
function exactGoogleQuery(title,issue,year){return `site:marvel.com/comics/issue/ "${title}" "${issue?`#${issue}`:''}" ${year} Marvel Unlimited`}
function luckyUrl(title,issue,year){return `${GOOGLE_ORIGIN}/search?btnI=1&q=${encodeURIComponent(exactGoogleQuery(title,issue,year))}`}

async function fetchResponse(url,{redirect='follow',lang='en-US,en;q=0.9'}={}){
  return fetch(url,{redirect,headers:{
    'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1',
    'Accept':'text/html,application/xhtml+xml,*/*;q=0.8','Accept-Language':lang
  }});
}
async function fetchHtml(url,opts={}){
  const r=await fetchResponse(url,opts);
  if(!r.ok)throw new Error(`${new URL(url).hostname} HTTP ${r.status}`);
  return r.text();
}
function cacheRequest(path,params={}){
  const u=new URL(`https://marvel-meta-cache.invalid/${path}`);
  for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v??''));
  return new Request(u.toString());
}
async function readCache(key){
  const c=typeof caches!=='undefined'?caches.default:null;if(!c)return null;
  const hit=await c.match(key);if(!hit)return null;
  try{return await hit.json()}catch{return null}
}
async function writeCache(key,data,maxAge=META_TTL){
  const c=typeof caches!=='undefined'?caches.default:null;if(!c)return;
  await c.put(key,Response.json(data,{headers:{'Cache-Control':`public, max-age=${maxAge}`}})).catch(()=>{});
}

function issuePath(v=''){try{return new URL(v,MARVEL_ORIGIN).pathname.match(/^\/comics\/issue\/\d+(?:\/[^?#]*)?/i)?.[0]||''}catch{return ''}}
function seriesPath(v=''){try{return new URL(v,SHARE_ORIGIN).pathname.match(/^\/comics\/series\/\d+(?:\/[^?#]*)?/i)?.[0]||''}catch{return ''}}
function publicIssueUrl(v=''){const p=issuePath(v);return p?MARVEL_ORIGIN+p:''}
function shareIssueUrl(v=''){const p=issuePath(v);return p?SHARE_ORIGIN+p:''}
function sourceIdFromIssueUrl(v=''){try{return new URL(v).pathname.match(/^\/comics\/issue\/(\d+)/i)?.[1]||''}catch{return ''}}
function seriesIdFromUrl(v=''){try{return new URL(v).pathname.match(/^\/comics\/series\/(\d+)/i)?.[1]||''}catch{return ''}}

function parseSeriesLabel(label=''){
  const clean=stripTags(label);
  const m=clean.match(/^(.*?)\s*\((\d{4})(?:\s*-\s*(?:\d{4}|Present))?\)\s*$/i);
  return{label:clean,title:(m?.[1]||clean).trim(),startYear:m?.[2]||''};
}
function parseSeriesIndex(html=''){
  const out=[],seen=new Set();
  const re=/<a\b[^>]*href=["']([^"']*\/comics\/series\/\d+(?:\/[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while((m=re.exec(html))){
    const pth=seriesPath(unescapeHtml(m[1]));if(!pth)continue;
    const parsed=parseSeriesLabel(m[2]);if(!parsed.title||!parsed.startYear)continue;
    const href=SHARE_ORIGIN+pth,key=href+'|'+parsed.label;if(seen.has(key))continue;seen.add(key);
    out.push({href,label:parsed.label,title:parsed.title,startYear:parsed.startYear,norm:normalizeSeries(parsed.title)});
  }
  return out;
}
async function getSeriesIndex(){
  const key=cacheRequest(`series-index-v${CACHE_REV}`),cached=await readCache(key);
  if(Array.isArray(cached?.items)&&cached.items.length>500)return cached.items;
  const html=await fetchHtml(`${SHARE_ORIGIN}/comics/series`),items=parseSeriesIndex(html);
  if(items.length<500)throw new Error(`series-index-incomplete:${items.length}`);
  await writeCache(key,{items},SERIES_TTL);return items;
}
function similarity(a,b){
  const A=new Set(tokens(a)),B=new Set(tokens(b));if(!A.size||!B.size)return 0;
  let common=0;for(const x of A)if(B.has(x))common++;
  return common/Math.max(A.size,B.size);
}
function findSeriesEntry(items,title,year){
  const want=normalizeSeries(title),y=String(year||'').trim();
  const exact=items.filter(x=>x.norm===want&&(!y||x.startYear===y));if(exact.length)return exact[0];
  const sameYear=items.filter(x=>!y||x.startYear===y).map(x=>({x,score:similarity(title,x.title)})).filter(x=>x.score>=0.72).sort((a,b)=>b.score-a.score);
  if(sameYear.length&&(!sameYear[1]||sameYear[0].score>sameYear[1].score||sameYear[0].score===1))return sameYear[0].x;
  const sameTitle=items.filter(x=>x.norm===want);if(sameTitle.length===1)return sameTitle[0];
  return null;
}

function issueNumberFromSlug(url,seriesYear=''){
  try{
    const slug=decodeURIComponent(new URL(url,MARVEL_ORIGIN).pathname.split('/').pop()||'');
    const parts=slug.split(/[_-]+/).filter(Boolean),y=String(seriesYear||'');
    if(y){const yi=parts.lastIndexOf(y);if(yi>=0){for(let i=yi+1;i<parts.length;i++)if(/^\d+(?:\.\d+)?$/.test(parts[i]))return normalizeIssue(parts[i])}}
    for(let i=parts.length-1;i>=0;i--)if(/^\d+(?:\.\d+)?$/.test(parts[i]))return normalizeIssue(parts[i]);
  }catch{}
  return '';
}
function issueNumberFromLink(text,url,seriesYear=''){
  const canonical=issueNumberFromSlug(url,seriesYear);if(canonical)return canonical;
  const clean=stripTags(text),m=clean.match(/#\s*([0-9]+(?:\.[0-9]+)?|[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)?)/i);
  return m?normalizeIssue(m[1]):'';
}
function urlLooksLikeSeries(url,title,year){
  let slug='';try{slug=normalizeText(decodeURIComponent(new URL(url,MARVEL_ORIGIN).pathname.split('/').pop()||''))}catch{}
  const wanted=tokens(title).filter(t=>t!=='comics');
  if(wanted.length&&wanted.some(t=>!slug.includes(t)))return false;
  if(year&&!slug.includes(String(year)))return false;
  return true;
}
function parseSeriesIssues(html,title,year){
  const map={},urls=[],seen=new Set();
  const add=(raw,text='')=>{
    const url=publicIssueUrl(unescapeHtml(raw));if(!url||seen.has(url))return;seen.add(url);
    if(!urlLooksLikeSeries(url,title,year))return;
    const num=issueNumberFromLink(text,url,year);if(!num)return;
    if(!map[num])map[num]=url;urls.push({num,url});
  };
  const re=/<a\b[^>]*href=["']([^"']*\/comics\/issue\/\d+(?:\/[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;while((m=re.exec(html)))add(m[1],m[2]);
  const raw=unescapeHtml(html).replace(/%2F/gi,'/').replace(/%3A/gi,':');
  const matches=raw.match(/(?:https?:\/\/(?:www\.|share\.)?marvel\.com)?\/comics\/issue\/\d+\/[A-Za-z0-9_()%.,+\-]+/gi)||[];
  for(const u of matches)add(u,'');
  return{map,urls};
}
async function getSeriesIssueMap(entry,title,year){
  const sid=seriesIdFromUrl(entry.href)||normalizeText(entry.label),key=cacheRequest(`series-map-v${CACHE_REV}`,{sid});
  const cached=await readCache(key);if(cached?.map&&Object.keys(cached.map).length)return{...cached,fromCache:true};
  let html='';
  try{html=await fetchHtml(entry.href)}catch(e){html=await fetchHtml(MARVEL_ORIGIN+new URL(entry.href).pathname)}
  const parsed=parseSeriesIssues(html,title,year);
  if(Object.keys(parsed.map).length)await writeCache(key,parsed,SERIES_TTL);
  return{...parsed,fromCache:false};
}
async function resolveFromCatalog(title,issue,year){
  try{
    const items=await getSeriesIndex(),entry=findSeriesEntry(items,title,year);
    if(!entry)return{issueUrl:'',resolverSource:'marvel-series-catalog',catalogReason:'series-not-found',seriesLabel:'',seriesUrl:'',catalogKnownIssues:0};
    const result=await getSeriesIssueMap(entry,title,year),wanted=normalizeIssue(issue),issueUrl=result.map[wanted]||'';
    return{issueUrl,resolverSource:'marvel-series-catalog',catalogReason:issueUrl?'ok':'issue-not-in-series-map',seriesLabel:entry.label,seriesUrl:entry.href,catalogKnownIssues:Object.keys(result.map).length,catalogFromCache:Boolean(result.fromCache),catalogKeys:Object.keys(result.map).slice(0,120)};
  }catch(e){return{issueUrl:'',resolverSource:'marvel-series-catalog-error',catalogReason:String(e?.message||e),seriesLabel:'',seriesUrl:'',catalogKnownIssues:0}}
}

function unwrapGoogleLocation(location=''){
  try{const u=new URL(location,GOOGLE_ORIGIN),d=publicIssueUrl(u.href);if(d)return d;if(/google\./i.test(u.hostname)&&u.pathname==='/url')return publicIssueUrl(u.searchParams.get('q')||u.searchParams.get('url')||'')}catch{}
  return '';
}
async function resolveGoogleFallback(title,issue,year){
  try{
    const r=await fetchResponse(luckyUrl(title,issue,year),{redirect:'manual',lang:'es-ES,es;q=0.9,en;q=0.6'}),loc=unwrapGoogleLocation(r.headers.get('Location')||'');
    if(loc)return{issueUrl:loc,resolverSource:'google-lucky-fallback'};
    if(r.status===429||/\/sorry\//.test(r.headers.get('Location')||''))return{issueUrl:'',resolverSource:'google-blocked'};
  }catch{}
  return{issueUrl:'',resolverSource:'unresolved'};
}
async function resolveExactIssue(title,issue,year){
  const catalog=await resolveFromCatalog(title,issue,year);if(catalog.issueUrl)return catalog;
  const google=await resolveGoogleFallback(title,issue,year);
  return{...catalog,...google,catalogReason:catalog.catalogReason,seriesLabel:catalog.seriesLabel,seriesUrl:catalog.seriesUrl,catalogKnownIssues:catalog.catalogKnownIssues||0,catalogKeys:catalog.catalogKeys||[]};
}

function absoluteImage(v=''){let s=unescapeHtml(v).trim();if(s.startsWith('//'))s='https:'+s;return /^https?:\/\//i.test(s)?s:''}
function extractCoverUrl(html=''){
  const clean=unescapeHtml(html);
  for(const re of [/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,/"image_url"\s*:\s*"([^"]+)"/i,/"portrait_xlarge"\s*:\s*"([^"]+)"/i,/"image"\s*:\s*"(https?:[^"\\]+(?:\\.[^"\\]*)*)"/i]){const m=clean.match(re);if(m){const u=absoluteImage(m[1]);if(u)return u}}
  return '';
}
function extractPageTitle(html=''){
  const clean=unescapeHtml(html);for(const re of [/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,/<title[^>]*>([^<]+)<\/title>/i]){const m=clean.match(re);if(m)return stripTags(m[1])}return '';
}
function pageMatches(html,title,issue,year){
  const pt=extractPageTitle(html),base=pt.replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|Present))?\s*\)/gi,' ').replace(/#.*$/,'').replace(/\|.*$/,' '),norm=normalizeSeries(base);
  const titleOk=similarity(title,norm)>=0.72||normalizeSeries(title)===norm;
  const issueOk=!issue||new RegExp(`#\\s*${String(issue).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:\\b|\\s|$)`,'i').test(pt);
  const yearOk=!year||pt.includes(`(${year})`)||normalizeText(pt).includes(String(year));
  return titleOk&&issueOk&&yearOk;
}
function extractReaderData(html,issueUrl){
  const clean=unescapeHtml(html),m=clean.match(/https:\/\/read\.marvel\.com\/#\/book\/(\d+)/i);
  return{readerId:m?.[1]||'',webUrl:m?.[0]||issueUrl,explicitlyUnavailable:/Digital issue is not currently available/i.test(clean),explicitlyUnlimited:/Members get unlimited access|Marvel Unlimited/i.test(clean)};
}
async function fetchValidatedIssueHtml(issueUrl,title,issue,year){
  const attempts=[shareIssueUrl(issueUrl),publicIssueUrl(issueUrl)].filter(Boolean);
  for(const url of attempts){try{const html=await fetchHtml(url);if(pageMatches(html,title,issue,year))return html}catch{}}
  throw new Error('issue-page-mismatch-or-unavailable');
}
async function resolveLegacyDrn(readerId){
  if(!readerId)return '';
  const html=unescapeHtml(await fetchHtml(`${MARVEL_LEGACY_SHARE}${encodeURIComponent(readerId)}`)).replace(/%3A/gi,':');
  let explicit=html.match(/(?:[?&]|\b)drn=([^&"'<>\s]+)/i)?.[1]||'';if(explicit){try{explicit=decodeURIComponent(explicit)}catch{}return explicit}
  return html.match(/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i)?.[0]||'';
}
function buildSmartLink(drn,sourceId){if(!drn||!sourceId)return '';const u=new URL(MARVEL_SMART_LINK);u.searchParams.set('type','issue');u.searchParams.set('drn',drn);u.searchParams.set('sourceId',sourceId);return u.toString()}

function currentCacheKey(title,issue,year){return cacheRequest(`meta-v${CACHE_REV}`,{title,issue,year})}
function legacyCacheKeys(title,issue,year){return [9,8,7,6].map(rev=>cacheRequest(`meta-v${rev}`,{title,issue,year}))}
async function findLegacyPositive(title,issue,year){for(const key of legacyCacheKeys(title,issue,year)){const hit=await readCache(key);if(hit?.smartLink&&hit?.issueUrl)return{...hit,resolverVersion:RESOLVER_VERSION,resolverSource:'legacy-positive-cache'}}return null}
async function resolveUnifiedMeta(title,issue,year){
  const key=currentCacheKey(title,issue,year),cached=await readCache(key);if(cached?.smartLink||cached?.reason==='reader-unavailable')return cached;
  const legacy=await findLegacyPositive(title,issue,year);if(legacy){await writeCache(key,legacy);return legacy}
  const resolved=await resolveExactIssue(title,issue,year),issueUrl=resolved.issueUrl;
  if(!issueUrl)return{resolverVersion:RESOLVER_VERSION,resolverSource:resolved.resolverSource,available:false,issueUrl:'',sourceId:'',readerId:'',drn:'',smartLink:'',webUrl:luckyUrl(title,issue,year),coverUrl:'',pageTitle:'',reason:'lookup-unresolved',catalogReason:resolved.catalogReason||'',seriesLabel:resolved.seriesLabel||'',seriesUrl:resolved.seriesUrl||'',catalogKnownIssues:resolved.catalogKnownIssues||0,catalogKeys:resolved.catalogKeys||[]};
  const sourceId=sourceIdFromIssueUrl(issueUrl),html=await fetchValidatedIssueHtml(issueUrl,title,issue,year),reader=extractReaderData(html,issueUrl),coverUrl=extractCoverUrl(html),pageTitle=extractPageTitle(html);
  let drn='',smartLink='';if(reader.readerId&&sourceId){try{drn=await resolveLegacyDrn(reader.readerId);smartLink=buildSmartLink(drn,sourceId)}catch{}}
  let reason='lookup-unresolved';if(smartLink)reason='ok';else if(reader.explicitlyUnavailable)reason='reader-unavailable';else if(reader.readerId)reason='drn-unavailable';else if(reader.explicitlyUnlimited)reason='reader-id-unresolved';
  const data={resolverVersion:RESOLVER_VERSION,resolverSource:resolved.resolverSource,available:Boolean(smartLink),issueUrl,sourceId,readerId:reader.readerId,drn,smartLink,webUrl:reader.webUrl,coverUrl,pageTitle,reason,catalogReason:resolved.catalogReason||'',seriesLabel:resolved.seriesLabel||'',seriesUrl:resolved.seriesUrl||'',catalogKnownIssues:resolved.catalogKnownIssues||0,catalogKeys:resolved.catalogKeys||[]};
  if(smartLink||reason==='reader-unavailable')await writeCache(key,data);return data;
}
async function verifyUrl(url){if(!url)return{ok:false,status:0,location:'',error:'missing-url'};try{const r=await fetch(url,{redirect:'manual',headers:{'User-Agent':'Mozilla/5.0 (compatible; MarvelLectura-Diagnostic/5.0)','Accept':'text/html,*/*;q=0.8'}});return{ok:r.status>=200&&r.status<400,status:r.status,location:r.headers.get('Location')||'',error:''}}catch(e){return{ok:false,status:0,location:'',error:String(e?.message||e)}}}
function knownMetaFromUrl(url){const issueUrl=url.searchParams.get('knownIssueUrl')||'',smartLink=url.searchParams.get('knownSmartLink')||'';if(!issueUrl||!smartLink)return null;return{resolverVersion:RESOLVER_VERSION,available:true,issueUrl,sourceId:url.searchParams.get('knownSourceId')||sourceIdFromIssueUrl(issueUrl),readerId:url.searchParams.get('knownReaderId')||'',drn:url.searchParams.get('knownDrn')||'',smartLink,webUrl:url.searchParams.get('knownWebUrl')||issueUrl,coverUrl:'',pageTitle:url.searchParams.get('knownPageTitle')||'',reason:'client-cache',resolverSource:'client-cache'}}
async function diagnosticMeta(title,issue,year,known=null){
  const meta=known||await resolveUnifiedMeta(title,issue,year);
  const [appCheck,webCheck]=await Promise.all([meta.smartLink?verifyUrl(meta.smartLink):Promise.resolve({ok:false,status:0,location:'',error:'missing-smartlink'}),meta.webUrl&&meta.readerId?verifyUrl(meta.webUrl):Promise.resolve({ok:false,status:0,location:'',error:'missing-reader'})]);
  let diagnosticCode='OK';if(!meta.issueUrl)diagnosticCode='LOOKUP_UNRESOLVED';else if(meta.reason==='reader-unavailable')diagnosticCode='NOT_IN_UNLIMITED';else if(!meta.readerId)diagnosticCode='READER_ID_MISSING';else if(!meta.drn)diagnosticCode='DRN_MISSING';else if(!meta.smartLink)diagnosticCode='SMARTLINK_MISSING';else if(!appCheck.ok)diagnosticCode='SMARTLINK_HTTP_ERROR';else if(!webCheck.ok)diagnosticCode='WEB_LINK_HTTP_ERROR';
  return{...meta,appCheck,webCheck,diagnosticCode};
}
function redirect(location){return new Response(null,{status:302,headers:{Location:location,'Cache-Control':'private, no-store'}})}
function errorPage(fallback,msg){const safe=String(fallback).replace(/&/g,'&amp;').replace(/"/g,'&quot;'),text=String(msg||'No he podido construir el enlace de Marvel Unlimited.').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marvel Unlimited</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17181c}.box{width:min(88vw,430px);text-align:center}.logo{display:inline-block;background:#e62429;color:#fff;padding:5px 8px;font-weight:900;font-size:22px}a{display:block;margin-top:20px;padding:14px;border-radius:14px;background:#fff;color:#333;border:1px solid #ddd8cf;text-decoration:none;font-weight:800}p{color:#74747b;font-size:13px;line-height:1.5}</style></head><body><div class="box"><span class="logo">MARVEL</span><h2>Número localizado</h2><p>${text}</p><a href="${safe}">Abrir este número en la web</a></div></body></html>`,{status:502,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})}

export default{async fetch(request,env){
  const url=new URL(request.url);if(url.pathname!=='/api/marvel/open')return env.ASSETS.fetch(request);
  const title=(url.searchParams.get('title')||'').trim(),issue=(url.searchParams.get('issue')||'').trim(),year=(url.searchParams.get('year')||'').trim(),mode=(url.searchParams.get('mode')||'web').toLowerCase();if(!title)return new Response('Falta el título del cómic.',{status:400});
  const lucky=luckyUrl(title,issue,year);if(mode==='web')return redirect(lucky);
  try{
    if(mode==='diagnostic')return Response.json({title,issue,year,...await diagnosticMeta(title,issue,year,knownMetaFromUrl(url))},{headers:{'Cache-Control':'no-store'}});
    if(mode==='meta'||mode==='debug')return Response.json({title,issue,year,...await resolveUnifiedMeta(title,issue,year)},{headers:{'Cache-Control':'no-store'}});
    if(mode==='app'||mode==='ios'||mode==='android'){const meta=await resolveUnifiedMeta(title,issue,year);if(meta.smartLink)return redirect(meta.smartLink);const msg=meta.reason==='reader-unavailable'?'Marvel Unlimited no ofrece este número en su lector digital.':meta.reason==='lookup-unresolved'?'No he podido localizar automáticamente este número para abrirlo en Marvel Unlimited.':'Marvel no ha devuelto el identificador móvil de este número.';return errorPage(meta.webUrl||lucky,msg)}
    return new Response('Modo no reconocido.',{status:400});
  }catch(e){if(mode==='meta'||mode==='debug'||mode==='diagnostic')return Response.json({resolverVersion:RESOLVER_VERSION,available:false,webUrl:lucky,reason:'resolver-error',diagnosticCode:'RESOLVER_ERROR',error:String(e?.message||e)},{headers:{'Cache-Control':'no-store'}});return errorPage(lucky,'Se ha producido un error al construir el enlace de Marvel Unlimited.')}
}};