const GOOGLE_ORIGIN='https://www.google.com';
const MARVEL_ORIGIN='https://www.marvel.com';
const SHARE_ORIGIN='https://share.marvel.com';
const MARVEL_SMART_LINK='https://marvel.smart.link/fiir7ec77';
const MARVEL_LEGACY_SHARE='https://share.marvel.com/sharing/legacy/';
const RESOLVER_VERSION=7; // contrato con la PWA
const CACHE_REV=9;
const META_TTL=60*60*24*30;
const SERIES_TTL=60*60*24*7;
const WALK_LIMIT=110;

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
function stripTags(v=''){return unescapeHtml(String(v).replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim()}
function normalizeText(v=''){return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim()}
function normalizeSeriesTitle(v=''){return normalizeText(v).replace(/^the\s+/,'').trim()}
function titleTokens(v=''){return normalizeSeriesTitle(v).split(/\s+/).filter(x=>x.length>1&&!['the','and'].includes(x))}
function normalizeIssue(v=''){
  let s=String(v||'').trim().toUpperCase().replace(/\s+/g,'');
  if(/^0+\d+$/.test(s))s=String(Number(s));
  return s;
}
function escapeRegExp(v=''){return String(v).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
function exactGoogleQuery(title,issue,year){return `site:marvel.com/comics/issue/ "${title}" "${issue?`#${issue}`:''}" ${year} Marvel Unlimited`}
function luckyUrl(title,issue,year){return `${GOOGLE_ORIGIN}/search?btnI=1&q=${encodeURIComponent(exactGoogleQuery(title,issue,year))}`}
function normalGoogleUrl(title,issue,year){return `${GOOGLE_ORIGIN}/search?q=${encodeURIComponent(exactGoogleQuery(title,issue,year))}`}

async function fetchResponse(url,{redirect='follow',lang='en-US,en;q=0.9'}={}){
  return fetch(url,{redirect,headers:{
    'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1',
    'Accept':'text/html,application/xhtml+xml,*/*;q=0.8',
    'Accept-Language':lang
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

function issuePath(value=''){
  try{return new URL(value,MARVEL_ORIGIN).pathname.match(/^\/comics\/issue\/\d+(?:\/[^?#]*)?/i)?.[0]||''}catch{return ''}
}
function seriesPath(value=''){
  try{return new URL(value,MARVEL_ORIGIN).pathname.match(/^\/comics\/series\/\d+(?:\/[^?#]*)?/i)?.[0]||''}catch{return ''}
}
function cleanMarvelIssueUrl(v=''){const p=issuePath(v);return p?MARVEL_ORIGIN+p:''}
function cleanMarvelSeriesUrl(v=''){const p=seriesPath(v);return p?MARVEL_ORIGIN+p:''}
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
    const href=cleanMarvelSeriesUrl(unescapeHtml(m[1]));if(!href)continue;
    const p=parseSeriesLabel(m[2]);if(!p.title||!p.startYear)continue;
    const key=href+'|'+p.label;if(seen.has(key))continue;seen.add(key);
    out.push({href,label:p.label,title:p.title,startYear:p.startYear,norm:normalizeSeriesTitle(p.title)});
  }
  return out;
}
async function getSeriesIndex(){
  const key=cacheRequest(`series-index-v${CACHE_REV}`),cached=await readCache(key);
  if(Array.isArray(cached?.items)&&cached.items.length>500)return cached.items;
  const attempts=[];
  for(const url of [`${MARVEL_ORIGIN}/comics/series`,`${SHARE_ORIGIN}/comics/series`]){
    try{
      const html=await fetchHtml(url),items=parseSeriesIndex(html);
      attempts.push(`${new URL(url).hostname}:${items.length}`);
      if(items.length>500){await writeCache(key,{items,source:url},SERIES_TTL);return items}
    }catch(e){attempts.push(`${new URL(url).hostname}:${String(e?.message||e)}`)}
  }
  throw new Error(`series-index-unusable [${attempts.join(', ')}]`);
}
function findSeriesEntry(items,title,year){
  const norm=normalizeSeriesTitle(title),y=String(year||'').trim();
  const byTitle=items.filter(x=>x.norm===norm);
  const byYear=byTitle.filter(x=>!y||x.startYear===y);
  if(byYear.length)return byYear[0];
  if(byTitle.length===1)return byTitle[0];
  return null;
}

function issueNumberFromLink(text,url){
  const clean=stripTags(text);
  let m=clean.match(/#\s*([0-9]+(?:\.[0-9]+)?|[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)?)/i);
  if(m)return normalizeIssue(m[1]);
  try{
    const slug=decodeURIComponent(new URL(url,MARVEL_ORIGIN).pathname.split('/').pop()||'');
    m=slug.match(/[_-]([0-9]+(?:\.[0-9]+)?)(?:[_-](?:variant|digital|facsimile))?$/i);
    if(m)return normalizeIssue(m[1]);
  }catch{}
  return '';
}
function belongsToSeries(url,text,title,year){
  const tokens=titleTokens(title);let hay='';
  try{hay=normalizeText(decodeURIComponent(new URL(url,MARVEL_ORIGIN).pathname.split('/').pop()||''))}catch{}
  hay+=' '+normalizeText(stripTags(text));
  if(tokens.some(t=>!hay.includes(t)))return false;
  if(year&&!hay.includes(String(year)))return false;
  return true;
}
function parseIssueLinks(html,title,year){
  const map={},all=[];
  const add=(raw,text='')=>{
    const url=cleanMarvelIssueUrl(unescapeHtml(raw));if(!url||!belongsToSeries(url,text,title,year))return;
    const num=issueNumberFromLink(text,url);if(!num)return;
    if(!map[num])map[num]=url;
    all.push({num,url,text:stripTags(text)});
  };
  const re=/<a\b[^>]*href=["']([^"']*\/comics\/issue\/\d+(?:\/[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;while((m=re.exec(html)))add(m[1],m[2]);
  const raw=unescapeHtml(html).replace(/%2F/gi,'/').replace(/%3A/gi,':');
  const urls=raw.match(/(?:https?:\/\/(?:www\.|share\.)?marvel\.com)?\/comics\/issue\/\d+\/[A-Za-z0-9_()%.,+\-]+/gi)||[];
  for(const u of urls)add(u,'');
  return{map,all};
}
function mergeMaps(a,b){for(const [k,v] of Object.entries(b||{}))if(!a[k])a[k]=v;return a}
function numericIssue(v){return /^\d+(?:\.\d+)?$/.test(String(v||''))?Number(v):null}
function closestProgressCandidate(map,target,currentUrl,seen){
  const t=numericIssue(target);if(t===null)return null;
  let currentNum=issueNumberFromLink('',currentUrl),cur=numericIssue(currentNum),curDist=cur===null?Infinity:Math.abs(cur-t),best=null;
  for(const [n,url] of Object.entries(map)){
    if(seen.has(url))continue;
    const x=numericIssue(n);if(x===null)continue;
    const d=Math.abs(x-t);
    if(d<curDist&&(!best||d<best.d))best={num:n,url,d};
  }
  return best;
}
async function fetchNavigationHtml(issueUrl){
  try{return await fetchHtml(cleanMarvelIssueUrl(issueUrl))}catch(e1){
    const share=shareIssueUrl(issueUrl);if(share){try{return await fetchHtml(share)}catch{}}
    throw e1;
  }
}
async function getSeriesIssueMap(entry,title,year,target){
  const seriesId=seriesIdFromUrl(entry.href)||normalizeText(entry.label),key=cacheRequest(`series-issues-v${CACHE_REV}`,{seriesId});
  const cached=await readCache(key),map={...(cached?.map||{})};
  const wanted=normalizeIssue(target);if(map[wanted])return{map,walked:0,fromCache:true};

  let seriesHtml='';
  try{seriesHtml=await fetchHtml(entry.href)}catch(e){
    const shareUrl=SHARE_ORIGIN+new URL(entry.href).pathname;
    try{seriesHtml=await fetchHtml(shareUrl)}catch{throw new Error(`series-page-unusable ${e?.message||e}`)}
  }
  mergeMaps(map,parseIssueLinks(seriesHtml,title,year).map);
  if(map[wanted]){await writeCache(key,{map},SERIES_TTL);return{map,walked:0,fromCache:false}}

  const t=numericIssue(wanted);
  if(t===null){await writeCache(key,{map},SERIES_TTL);return{map,walked:0,fromCache:false}}
  const seeds=Object.entries(map).map(([n,url])=>({n,url,x:numericIssue(n)})).filter(x=>x.x!==null).sort((a,b)=>Math.abs(a.x-t)-Math.abs(b.x-t));
  if(!seeds.length){await writeCache(key,{map},SERIES_TTL);return{map,walked:0,fromCache:false}}

  let current=seeds[0].url,walked=0;const seen=new Set();
  while(current&&walked<WALK_LIMIT&&!map[wanted]){
    if(seen.has(current))break;seen.add(current);walked++;
    let html;try{html=await fetchNavigationHtml(current)}catch{break}
    const page=parseIssueLinks(html,title,year);mergeMaps(map,page.map);
    if(map[wanted])break;
    const next=closestProgressCandidate(page.map,wanted,current,seen)||closestProgressCandidate(map,wanted,current,seen);
    if(!next)break;current=next.url;
  }
  await writeCache(key,{map,walked,lastTarget:wanted},SERIES_TTL);
  return{map,walked,fromCache:false};
}
async function resolveFromCatalog(title,issue,year){
  try{
    const items=await getSeriesIndex(),entry=findSeriesEntry(items,title,year);
    if(!entry)return{issueUrl:'',resolverSource:'marvel-series-catalog',catalogReason:'series-not-found',seriesLabel:'',seriesUrl:''};
    const result=await getSeriesIssueMap(entry,title,year,issue),wanted=normalizeIssue(issue),issueUrl=result.map[wanted]||'';
    return{issueUrl,resolverSource:'marvel-series-catalog',catalogReason:issueUrl?'ok':'issue-not-found-after-walk',seriesLabel:entry.label,seriesUrl:entry.href,catalogWalked:result.walked,catalogKnownIssues:Object.keys(result.map).length};
  }catch(e){return{issueUrl:'',resolverSource:'marvel-series-catalog-error',catalogReason:String(e?.message||e),seriesLabel:'',seriesUrl:''}}
}

function unwrapGoogleLocation(location=''){
  try{
    const u=new URL(location,GOOGLE_ORIGIN);
    const direct=cleanMarvelIssueUrl(u.href);if(direct)return direct;
    if(/google\./i.test(u.hostname)&&u.pathname==='/url')return cleanMarvelIssueUrl(u.searchParams.get('q')||u.searchParams.get('url')||'');
  }catch{}
  return '';
}
function extractIssueCandidates(html=''){
  const clean=unescapeHtml(html).replace(/%2F/gi,'/').replace(/%3A/gi,':');
  const arr=[...(clean.match(/https?:\/\/(?:www\.|share\.)?marvel\.com\/comics\/issue\/\d+(?:\/[A-Za-z0-9_()%.,+\-]*)?/gi)||[]),...(clean.match(/\/comics\/issue\/\d+(?:\/[A-Za-z0-9_()%.,+\-]*)?/gi)||[])];
  return [...new Set(arr.map(x=>cleanMarvelIssueUrl(x.startsWith('http')?x:MARVEL_ORIGIN+x)).filter(Boolean))];
}
async function resolveGoogleFallback(title,issue,year){
  try{
    const r=await fetchResponse(luckyUrl(title,issue,year),{redirect:'manual',lang:'es-ES,es;q=0.9,en;q=0.6'}),loc=unwrapGoogleLocation(r.headers.get('Location')||'');
    if(loc)return{issueUrl:loc,resolverSource:'google-lucky-fallback'};
    if(r.status===429||/\/sorry\//.test(r.headers.get('Location')||''))return{issueUrl:'',resolverSource:'google-blocked'};
  }catch{}
  try{
    const r=await fetchResponse(normalGoogleUrl(title,issue,year));
    if(r.status===429||/\/sorry\//.test(r.url||''))return{issueUrl:'',resolverSource:'google-blocked'};
    for(const candidate of extractIssueCandidates(await r.text()).slice(0,6)){
      if(belongsToSeries(candidate,'',title,year)&&issueNumberFromLink('',candidate)===normalizeIssue(issue))return{issueUrl:candidate,resolverSource:'google-fallback'};
    }
  }catch{}
  return{issueUrl:'',resolverSource:'unresolved'};
}
async function resolveExactIssue(title,issue,year){
  const catalog=await resolveFromCatalog(title,issue,year);if(catalog.issueUrl)return catalog;
  const google=await resolveGoogleFallback(title,issue,year);
  return{...catalog,...google,catalogReason:catalog.catalogReason,seriesLabel:catalog.seriesLabel,seriesUrl:catalog.seriesUrl,catalogWalked:catalog.catalogWalked||0,catalogKnownIssues:catalog.catalogKnownIssues||0};
}

function absoluteImage(v=''){let s=unescapeHtml(v).trim();if(s.startsWith('//'))s='https:'+s;return /^https?:\/\//i.test(s)?s:''}
function extractCoverUrl(html=''){
  const clean=unescapeHtml(html);
  for(const re of [/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,/"image_url"\s*:\s*"([^"]+)"/i,/"portrait_xlarge"\s*:\s*"([^"]+)"/i,/"image"\s*:\s*"(https?:[^"\\]+(?:\\.[^"\\]*)*)"/i]){
    const m=clean.match(re);if(m){const u=absoluteImage(m[1]);if(u)return u}
  }
  return '';
}
function extractPageTitle(html=''){
  const clean=unescapeHtml(html);
  for(const re of [/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,/<title[^>]*>([^<]+)<\/title>/i]){const m=clean.match(re);if(m)return stripTags(m[1])}
  return '';
}
function extractReaderData(html,issueUrl){
  const clean=unescapeHtml(html),m=clean.match(/https:\/\/read\.marvel\.com\/#\/book\/(\d+)/i);
  return{readerId:m?.[1]||'',webUrl:m?.[0]||issueUrl,explicitlyUnavailable:/Digital issue is not currently available/i.test(clean),explicitlyUnlimited:/Members get unlimited access|Marvel Unlimited/i.test(clean)};
}
async function fetchIssueHtml(issueUrl){
  const share=shareIssueUrl(issueUrl);
  if(share){try{return await fetchHtml(share)}catch{}}
  return fetchHtml(cleanMarvelIssueUrl(issueUrl));
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
  for(const rev of [8,7,6]){keys.push(cacheRequest(`meta-v${rev}`,{title,issue,year}));const u=new URL(`https://marvel-meta-cache.invalid/v${rev}`);u.searchParams.set('title',title);u.searchParams.set('issue',issue);u.searchParams.set('year',year);keys.push(new Request(u.toString()))}
  const old=new URL('https://marvel-meta-cache.invalid/item');old.searchParams.set('resolver','5');old.searchParams.set('kind','app-stable');old.searchParams.set('title',title);old.searchParams.set('issue',issue);old.searchParams.set('year',year);keys.push(new Request(old.toString()));
  return keys;
}
async function findLegacyPositive(title,issue,year){
  for(const key of legacyCacheKeys(title,issue,year)){const hit=await readCache(key);if(hit?.smartLink&&hit?.issueUrl)return{...hit,resolverVersion:RESOLVER_VERSION,resolverSource:'legacy-positive-cache'}}
  return null;
}
async function resolveUnifiedMeta(title,issue,year){
  const key=currentCacheKey(title,issue,year),cached=await readCache(key);
  if(cached?.smartLink||cached?.reason==='reader-unavailable')return cached;
  const legacy=await findLegacyPositive(title,issue,year);if(legacy){await writeCache(key,legacy);return legacy}
  const resolved=await resolveExactIssue(title,issue,year),issueUrl=resolved.issueUrl;
  if(!issueUrl)return{resolverVersion:RESOLVER_VERSION,resolverSource:resolved.resolverSource,available:false,issueUrl:'',sourceId:'',readerId:'',drn:'',smartLink:'',webUrl:luckyUrl(title,issue,year),coverUrl:'',pageTitle:'',reason:'lookup-unresolved',catalogReason:resolved.catalogReason||'',seriesLabel:resolved.seriesLabel||'',seriesUrl:resolved.seriesUrl||'',catalogWalked:resolved.catalogWalked||0,catalogKnownIssues:resolved.catalogKnownIssues||0};
  const sourceId=sourceIdFromIssueUrl(issueUrl),html=await fetchIssueHtml(issueUrl),reader=extractReaderData(html,issueUrl),coverUrl=extractCoverUrl(html),pageTitle=extractPageTitle(html);
  let drn='',smartLink='';
  if(reader.readerId&&sourceId){try{drn=await resolveLegacyDrn(reader.readerId);smartLink=buildSmartLink(drn,sourceId)}catch(e){console.error('DRN resolver:',e)}}
  let reason='lookup-unresolved';
  if(smartLink)reason='ok';else if(reader.explicitlyUnavailable)reason='reader-unavailable';else if(reader.readerId)reason='drn-unavailable';else if(reader.explicitlyUnlimited)reason='reader-id-unresolved';
  const data={resolverVersion:RESOLVER_VERSION,resolverSource:resolved.resolverSource,available:Boolean(smartLink),issueUrl,sourceId,readerId:reader.readerId,drn,smartLink,webUrl:reader.webUrl,coverUrl,pageTitle,reason,catalogReason:resolved.catalogReason||'',seriesLabel:resolved.seriesLabel||'',seriesUrl:resolved.seriesUrl||'',catalogWalked:resolved.catalogWalked||0,catalogKnownIssues:resolved.catalogKnownIssues||0};
  if(smartLink||reason==='reader-unavailable')await writeCache(key,data);
  return data;
}

async function verifyUrl(url){
  if(!url)return{ok:false,status:0,location:'',error:'missing-url'};
  try{const r=await fetch(url,{redirect:'manual',headers:{'User-Agent':'Mozilla/5.0 (compatible; MarvelLectura-Diagnostic/4.0)','Accept':'text/html,*/*;q=0.8'}});return{ok:r.status>=200&&r.status<400,status:r.status,location:r.headers.get('Location')||'',error:''}}catch(e){return{ok:false,status:0,location:'',error:String(e?.message||e)}}
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
  else if(meta.reason==='reader-unavailable')diagnosticCode='NOT_IN_UNLIMITED';
  else if(!meta.readerId)diagnosticCode='READER_ID_MISSING';
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
  const lucky=luckyUrl(title,issue,year);if(mode==='web')return redirect(lucky);
  try{
    if(mode==='diagnostic')return Response.json({title,issue,year,...await diagnosticMeta(title,issue,year,knownMetaFromUrl(url))},{headers:{'Cache-Control':'no-store'}});
    if(mode==='meta'||mode==='debug')return Response.json({title,issue,year,...await resolveUnifiedMeta(title,issue,year)},{headers:{'Cache-Control':'no-store'}});
    if(mode==='app'||mode==='ios'||mode==='android'){
      const meta=await resolveUnifiedMeta(title,issue,year);if(meta.smartLink)return redirect(meta.smartLink);
      const msg=meta.reason==='reader-unavailable'?'Marvel Unlimited no ofrece este número en su lector digital.':meta.reason==='lookup-unresolved'?'No he podido localizar automáticamente este número para abrirlo en Marvel Unlimited.':'Marvel no ha devuelto el identificador móvil de este número.';
      return errorPage(meta.webUrl||lucky,msg);
    }
    return new Response('Modo no reconocido.',{status:400});
  }catch(e){
    console.error('Marvel resolver v9:',e);
    if(mode==='meta'||mode==='debug'||mode==='diagnostic')return Response.json({resolverVersion:RESOLVER_VERSION,available:false,webUrl:lucky,reason:'resolver-error',diagnosticCode:'RESOLVER_ERROR',error:String(e?.message||e)},{status:200,headers:{'Cache-Control':'no-store'}});
    return errorPage(lucky,'Se ha producido un error al construir el enlace de Marvel Unlimited.');
  }
}};