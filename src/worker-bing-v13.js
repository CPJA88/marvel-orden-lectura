import baseWorker from './worker-catalog-v11.js';

const MARVEL='https://www.marvel.com';
const SHARE='https://share.marvel.com';
const BING='https://www.bing.com';
const LEGACY='https://share.marvel.com/sharing/legacy/';
const SMART='https://marvel.smart.link/fiir7ec77';
const CACHE_REV=13;
const META_TTL=60*60*24*30;
const SEARCH_TTL=60*60*24*7;

function unescapeHtml(v=''){
  return String(v).replace(/\\u002F/gi,'/').replace(/\\u003A/gi,':').replace(/\\\//g,'/')
    .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#58;/g,':');
}
function stripTags(v=''){return unescapeHtml(String(v).replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim()}
function normalize(v=''){return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim()}
function normalizeSeries(v=''){return normalize(v).replace(/^the\s+/,'').replace(/\s+comics$/,'').trim()}
function tokens(v=''){return normalizeSeries(v).split(/\s+/).filter(Boolean)}
function similarity(a,b){const A=new Set(tokens(a)),B=new Set(tokens(b));if(!A.size||!B.size)return 0;let common=0;for(const x of A)if(B.has(x))common++;return common/Math.max(A.size,B.size)}
function normalizeIssue(v=''){let s=String(v||'').trim().toUpperCase().replace(/\s+/g,'');if(/^0+\d+$/.test(s))s=String(Number(s));return s}

async function fetchResponse(url,{redirect='follow'}={}){
  return fetch(url,{redirect,headers:{
    'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1',
    'Accept':'text/html,application/xhtml+xml,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9'
  }});
}
async function fetchHtml(url){const r=await fetchResponse(url);if(!r.ok)throw new Error(`${new URL(url).hostname} HTTP ${r.status}`);return r.text()}
function cacheRequest(path,params={}){const u=new URL(`https://marvel-bing-cache.invalid/${path}`);for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v??''));return new Request(u.toString())}
async function readCache(key){const c=typeof caches!=='undefined'?caches.default:null;if(!c)return null;const hit=await c.match(key);if(!hit)return null;try{return await hit.json()}catch{return null}}
async function writeCache(key,data,maxAge){const c=typeof caches!=='undefined'?caches.default:null;if(!c)return;await c.put(key,Response.json(data,{headers:{'Cache-Control':`public, max-age=${maxAge}`}})).catch(()=>{})}

function issuePath(v=''){try{return new URL(v,MARVEL).pathname.match(/^\/comics\/issue\/\d+(?:\/[^?#]*)?/i)?.[0]||''}catch{return ''}}
function publicIssueUrl(v=''){const p=issuePath(v);return p?MARVEL+p:''}
function shareIssueUrl(v=''){const p=issuePath(v);return p?SHARE+p:''}
function sourceId(v=''){try{return new URL(v,MARVEL).pathname.match(/^\/comics\/issue\/(\d+)/i)?.[1]||''}catch{return ''}}

function b64DecodeUrlSafe(v=''){
  try{
    let s=String(v||'').replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';
    return atob(s);
  }catch{return ''}
}
function decodeBingU(v=''){
  let s=String(v||'').trim();try{s=decodeURIComponent(s)}catch{}
  if(s.startsWith('a1'))s=b64DecodeUrlSafe(s.slice(2));
  try{s=decodeURIComponent(s)}catch{}
  return /^https?:\/\//i.test(s)?s:'';
}
function addCandidate(out,seen,raw){const u=publicIssueUrl(raw);if(u&&!seen.has(u)){seen.add(u);out.push(u)}}
function extractBingCandidates(html=''){
  const out=[],seen=new Set(),clean=unescapeHtml(html);
  for(const u of clean.match(/https?:\/\/(?:www\.)?marvel\.com\/comics\/issue\/\d+(?:\/[A-Za-z0-9_()%.,+\-]*)?/gi)||[])addCandidate(out,seen,u);
  let decoded=clean;try{decoded=decodeURIComponent(clean)}catch{}
  if(decoded!==clean)for(const u of decoded.match(/https?:\/\/(?:www\.)?marvel\.com\/comics\/issue\/\d+(?:\/[A-Za-z0-9_()%.,+\-]*)?/gi)||[])addCandidate(out,seen,u);
  const hrefRe=/href=["']([^"']+)["']/gi;let m;
  while((m=hrefRe.exec(clean))){
    const href=unescapeHtml(m[1]);addCandidate(out,seen,href);
    try{
      const u=new URL(href,BING);
      for(const key of ['u','url','q','r']){const val=u.searchParams.get(key)||'';if(!val)continue;const d=key==='u'?decodeBingU(val):val;addCandidate(out,seen,d)}
    }catch{}
  }
  const rawU=/[?&](?:amp;)?u=(a1[A-Za-z0-9_\-=%]+)/gi;
  while((m=rawU.exec(clean)))addCandidate(out,seen,decodeBingU(m[1]));
  return out;
}
function bingQuery(title,issue,year){return `site:marvel.com/comics/issue/ "${title}" "${issue?`#${issue}`:''}" ${year}`}
function bingUrl(title,issue,year){const u=new URL('/search',BING);u.searchParams.set('q',bingQuery(title,issue,year));u.searchParams.set('count','10');u.searchParams.set('setlang','en-US');return u.toString()}

function extractTitle(html=''){const clean=unescapeHtml(html);for(const re of [/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,/<title[^>]*>([^<]+)<\/title>/i]){const m=clean.match(re);if(m)return stripTags(m[1])}return ''}
function pageMatches(html,title,issue,year){
  const pt=extractTitle(html),base=pt.replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|Present))?\s*\)/gi,' ').replace(/#.*$/,'').replace(/\|.*$/,' '),norm=normalizeSeries(base);
  const titleOk=similarity(title,norm)>=0.66||normalizeSeries(title)===norm;
  const issueOk=!issue||new RegExp(`#\\s*${String(issue).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:\\b|\\s|$)`,'i').test(pt);
  const yearOk=!year||pt.includes(`(${year})`)||normalize(pt).includes(String(year));
  return titleOk&&issueOk&&yearOk;
}
function issueNumberFromSlug(url,year=''){
  try{const slug=decodeURIComponent(new URL(url,MARVEL).pathname.split('/').pop()||''),parts=slug.split(/[_-]+/).filter(Boolean),y=String(year||'');if(y){const yi=parts.lastIndexOf(y);if(yi>=0){for(let i=yi+1;i<parts.length;i++)if(/^\d+(?:\.\d+)?$/.test(parts[i]))return normalizeIssue(parts[i])}}for(let i=parts.length-1;i>=0;i--)if(/^\d+(?:\.\d+)?$/.test(parts[i]))return normalizeIssue(parts[i])}catch{}return '';
}
function rankCandidates(candidates,title,issue,year){const wanted=normalizeIssue(issue);return [...candidates].map(url=>{let score=0;const slug=normalize(decodeURIComponent(new URL(url).pathname.split('/').pop()||''));for(const t of tokens(title))if(slug.includes(t))score+=2;if(year&&slug.includes(String(year)))score+=3;if(issueNumberFromSlug(url,year)===wanted)score+=8;return{url,score}}).sort((a,b)=>b.score-a.score)}
async function probeCandidate(url,title,issue,year){
  const attempts=[];
  for(const candidateUrl of [shareIssueUrl(url),publicIssueUrl(url)].filter(Boolean)){
    const started=Date.now();try{const r=await fetchResponse(candidateUrl),status=r.status,html=r.ok?await r.text():'';attempts.push({url:candidateUrl,status,ms:Date.now()-started,pageTitle:html?extractTitle(html):'',matches:html?pageMatches(html,title,issue,year):false});if(html&&pageMatches(html,title,issue,year))return{ok:true,issueUrl:publicIssueUrl(url),html,attempts}}catch(e){attempts.push({url:candidateUrl,status:0,ms:Date.now()-started,error:String(e?.message||e),matches:false})}
  }
  return{ok:false,issueUrl:'',html:'',attempts};
}
async function resolveFromBing(title,issue,year){
  const key=cacheRequest(`search-v${CACHE_REV}`,{title,issue,year}),cached=await readCache(key);if(cached?.issueUrl||cached?.bingReason==='no-exact-candidate')return{...cached,fromCache:true};
  const searchUrl=bingUrl(title,issue,year),started=Date.now();let r,html='';
  try{r=await fetchResponse(searchUrl);if(r.ok)html=await r.text()}catch(e){return{issueUrl:'',bingReason:'network-error',bingStatus:0,bingMs:Date.now()-started,bingError:String(e?.message||e),bingSearchUrl:searchUrl,bingCandidates:[],bingProbes:[],fromCache:false}}
  const status=r.status,all=extractBingCandidates(html),ranked=rankCandidates(all,title,issue,year),probes=[];
  if(status===429||status===403)return{issueUrl:'',bingReason:'throttled',bingStatus:status,bingMs:Date.now()-started,bingSearchUrl:searchUrl,bingCandidates:ranked.slice(0,10).map(x=>x.url),bingProbes:probes,fromCache:false};
  for(const item of ranked.slice(0,6)){
    const p=await probeCandidate(item.url,title,issue,year);probes.push({candidate:item.url,score:item.score,attempts:p.attempts});if(p.ok){const data={issueUrl:p.issueUrl,issueHtml:p.html,bingReason:'ok',bingStatus:status,bingMs:Date.now()-started,bingSearchUrl:searchUrl,bingCandidates:ranked.slice(0,10).map(x=>x.url),bingProbes:probes};await writeCache(key,{...data,issueHtml:''},SEARCH_TTL);return{...data,fromCache:false}}
  }
  const data={issueUrl:'',bingReason:ranked.length?'candidate-mismatch':'no-candidate',bingStatus:status,bingMs:Date.now()-started,bingSearchUrl:searchUrl,bingCandidates:ranked.slice(0,10).map(x=>x.url),bingProbes:probes};await writeCache(key,data,60*60);return{...data,fromCache:false};
}

function absoluteImage(v=''){let s=unescapeHtml(v).trim();if(s.startsWith('//'))s='https:'+s;return /^https?:\/\//i.test(s)?s:''}
function extractCover(html=''){const clean=unescapeHtml(html);for(const re of [/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,/"image_url"\s*:\s*"([^"]+)"/i,/"portrait_xlarge"\s*:\s*"([^"]+)"/i]){const m=clean.match(re);if(m){const u=absoluteImage(m[1]);if(u)return u}}return ''}
function readerData(html,issueUrl){const clean=unescapeHtml(html),m=clean.match(/https:\/\/read\.marvel\.com\/#\/book\/(\d+)/i);return{readerId:m?.[1]||'',webUrl:m?.[0]||issueUrl,unavailable:/Digital issue is not currently available/i.test(clean),unlimited:/Members get unlimited access|Marvel Unlimited/i.test(clean)}}
async function resolveDrn(readerId){if(!readerId)return '';const html=unescapeHtml(await fetchHtml(`${LEGACY}${encodeURIComponent(readerId)}`)).replace(/%3A/gi,':');let d=html.match(/(?:[?&]|\b)drn=([^&"'<>\s]+)/i)?.[1]||'';if(d){try{d=decodeURIComponent(d)}catch{}return d}return html.match(/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i)?.[0]||''}
function smartLink(drn,sid){if(!drn||!sid)return '';const u=new URL(SMART);u.searchParams.set('type','issue');u.searchParams.set('drn',drn);u.searchParams.set('sourceId',sid);return u.toString()}

function metaCacheKey(title,issue,year){return cacheRequest(`meta-v${CACHE_REV}`,{title,issue,year})}
async function baseMeta(url,env){const u=new URL(url);u.pathname='/api/marvel/open';u.searchParams.set('mode','meta');const r=await baseWorker.fetch(new Request(u.toString(),{headers:{Accept:'application/json'}}),env);return r.json()}
async function resolveMeta(url,env,title,issue,year){
  const key=metaCacheKey(title,issue,year),cached=await readCache(key);if(cached?.smartLink||cached?.reason==='reader-unavailable')return cached;
  const base=await baseMeta(url,env);if(base.smartLink||base.reason==='reader-unavailable')return base;
  const officialTitle=base.seriesTitle||title,bing=await resolveFromBing(officialTitle,issue,year);
  if(!bing.issueUrl)return{...base,resolverSource:bing.bingReason==='throttled'?'bing-throttled':'bing-unresolved',bingReason:bing.bingReason,bingStatus:bing.bingStatus,bingMs:bing.bingMs,bingError:bing.bingError||'',bingSearchUrl:bing.bingSearchUrl,bingCandidates:bing.bingCandidates||[],bingProbes:bing.bingProbes||[],reason:'lookup-unresolved'};
  let html=bing.issueHtml||'';if(!html){const p=await probeCandidate(bing.issueUrl,officialTitle,issue,year);html=p.html;if(!p.ok)return{...base,resolverSource:'bing-candidate-mismatch',bingReason:'cached-candidate-mismatch',bingStatus:bing.bingStatus,bingSearchUrl:bing.bingSearchUrl,bingCandidates:bing.bingCandidates||[],bingProbes:[...(bing.bingProbes||[]),...(p.attempts?.length?[{candidate:bing.issueUrl,score:0,attempts:p.attempts}]:[])],reason:'lookup-unresolved'}}
  const sid=sourceId(bing.issueUrl),reader=readerData(html,bing.issueUrl),coverUrl=extractCover(html),pageTitle=extractTitle(html);let drn='',link='';if(reader.readerId&&sid){try{drn=await resolveDrn(reader.readerId);link=smartLink(drn,sid)}catch{}}
  let reason='lookup-unresolved';if(link)reason='ok';else if(reader.unavailable)reason='reader-unavailable';else if(reader.readerId)reason='drn-unavailable';else if(reader.unlimited)reason='reader-id-unresolved';
  const out={...base,resolverSource:'bing-exact',available:Boolean(link),issueUrl:bing.issueUrl,sourceId:sid,readerId:reader.readerId,drn,smartLink:link,webUrl:reader.webUrl,coverUrl,pageTitle,reason,bingReason:bing.bingReason,bingStatus:bing.bingStatus,bingMs:bing.bingMs,bingSearchUrl:bing.bingSearchUrl,bingCandidates:bing.bingCandidates||[],bingProbes:bing.bingProbes||[]};if(link||reason==='reader-unavailable')await writeCache(key,out,META_TTL);return out;
}
async function verify(url){if(!url)return{ok:false,status:0,error:'missing-url',location:''};try{const r=await fetch(url,{redirect:'manual',headers:{'User-Agent':'Mozilla/5.0 (compatible; MarvelLectura-Diagnostic/8.0)'}});return{ok:r.status>=200&&r.status<400,status:r.status,error:'',location:r.headers.get('Location')||''}}catch(e){return{ok:false,status:0,error:String(e?.message||e),location:''}}}
function diagnosticCode(m,a,w){if(!m.issueUrl)return'LOOKUP_UNRESOLVED';if(m.reason==='reader-unavailable')return'NOT_IN_UNLIMITED';if(!m.readerId)return'READER_ID_MISSING';if(!m.drn)return'DRN_MISSING';if(!m.smartLink)return'SMARTLINK_MISSING';if(!a.ok)return'SMARTLINK_HTTP_ERROR';if(!w.ok)return'WEB_LINK_HTTP_ERROR';return'OK'}
function redirect(location){return new Response(null,{status:302,headers:{Location:location,'Cache-Control':'private, no-store'}})}
function errorPage(fallback,msg){const safe=String(fallback||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;'),text=String(msg||'No he podido construir el enlace de Marvel Unlimited.').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marvel Unlimited</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17181c}.box{width:min(88vw,430px);text-align:center}.logo{display:inline-block;background:#e62429;color:#fff;padding:5px 8px;font-weight:900;font-size:22px}a{display:block;margin-top:20px;padding:14px;border-radius:14px;background:#fff;color:#333;border:1px solid #ddd8cf;text-decoration:none;font-weight:800}p{color:#74747b;font-size:13px;line-height:1.5}</style></head><body><div class="box"><span class="logo">MARVEL</span><h2>Número localizado</h2><p>${text}</p><a href="${safe}">Abrir este número en la web</a></div></body></html>`,{status:502,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})}

export default{async fetch(request,env,ctx){
  const url=new URL(request.url);if(url.pathname!=='/api/marvel/open')return baseWorker.fetch(request,env,ctx);
  const mode=(url.searchParams.get('mode')||'web').toLowerCase();if(mode==='web')return baseWorker.fetch(request,env,ctx);
  if(mode==='diagnostic'&&url.searchParams.get('knownSmartLink'))return baseWorker.fetch(request,env,ctx);
  const title=(url.searchParams.get('title')||'').trim(),issue=(url.searchParams.get('issue')||'').trim(),year=(url.searchParams.get('year')||'').trim();if(!title)return new Response('Falta el título del cómic.',{status:400});
  try{
    const meta=await resolveMeta(url,env,title,issue,year);
    if(mode==='meta'||mode==='debug')return Response.json({title,issue,year,...meta},{headers:{'Cache-Control':'no-store'}});
    if(mode==='diagnostic'){const [appCheck,webCheck]=await Promise.all([meta.smartLink?verify(meta.smartLink):Promise.resolve({ok:false,status:0,error:'missing-smartlink'}),meta.webUrl&&meta.readerId?verify(meta.webUrl):Promise.resolve({ok:false,status:0,error:'missing-reader'})]);return Response.json({title,issue,year,...meta,appCheck,webCheck,diagnosticCode:diagnosticCode(meta,appCheck,webCheck)},{headers:{'Cache-Control':'no-store'}})}
    if(['app','ios','android'].includes(mode)){if(meta.smartLink)return redirect(meta.smartLink);const fallback=meta.webUrl||`${MARVEL}/comics`;const msg=meta.reason==='reader-unavailable'?'Marvel Unlimited no ofrece este número en su lector digital.':meta.resolverSource==='bing-throttled'?'El buscador auxiliar está limitando temporalmente las consultas. Inténtalo de nuevo más tarde.':'No he podido localizar automáticamente este número para abrirlo en Marvel Unlimited.';return errorPage(fallback,msg)}
    return new Response('Modo no reconocido.',{status:400});
  }catch(e){if(['meta','debug','diagnostic'].includes(mode))return Response.json({resolverVersion:7,available:false,reason:'resolver-error',diagnosticCode:'RESOLVER_ERROR',error:String(e?.message||e)},{headers:{'Cache-Control':'no-store'}});return errorPage(`${MARVEL}/comics`,'Se ha producido un error al construir el enlace de Marvel Unlimited.')}
}};
