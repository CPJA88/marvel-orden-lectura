import baseWorker from './worker-catalog-v11.js';

const MARVEL='https://www.marvel.com';
const SHARE='https://share.marvel.com';
const LEGACY='https://share.marvel.com/sharing/legacy/';
const SMART='https://marvel.smart.link/fiir7ec77';
const CACHE_REV=12;
const META_TTL=60*60*24*30;
const PAGE_TTL=60*60*24*7;

function unescapeHtml(v=''){
  return String(v).replace(/\\u002F/gi,'/').replace(/\\u003A/gi,':').replace(/\\\//g,'/')
    .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#58;/g,':');
}
function stripTags(v=''){return unescapeHtml(String(v).replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim()}
function normalize(v=''){return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim()}
function normalizeSeries(v=''){return normalize(v).replace(/^the\s+/,'').replace(/\s+comics$/,'').trim()}
function tokens(v=''){return normalizeSeries(v).split(/\s+/).filter(Boolean)}
function normalizeIssue(v=''){let s=String(v||'').trim().toUpperCase().replace(/\s+/g,'');if(/^0+\d+$/.test(s))s=String(Number(s));return s}
function numeric(v=''){return /^\d+(?:\.\d+)?$/.test(String(v||''))?Number(v):null}
function similarity(a,b){const A=new Set(tokens(a)),B=new Set(tokens(b));if(!A.size||!B.size)return 0;let common=0;for(const x of A)if(B.has(x))common++;return common/Math.max(A.size,B.size)}

async function fetchHtml(url){const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1','Accept':'text/html,application/xhtml+xml,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9'}});if(!r.ok)throw new Error(`${new URL(url).hostname} HTTP ${r.status}`);return r.text()}
function cacheRequest(path,params={}){const u=new URL(`https://marvel-pagination-cache.invalid/${path}`);for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v??''));return new Request(u.toString())}
async function readCache(key){const c=typeof caches!=='undefined'?caches.default:null;if(!c)return null;const hit=await c.match(key);if(!hit)return null;try{return await hit.json()}catch{return null}}
async function writeCache(key,data,maxAge){const c=typeof caches!=='undefined'?caches.default:null;if(!c)return;await c.put(key,Response.json(data,{headers:{'Cache-Control':`public, max-age=${maxAge}`}})).catch(()=>{})}

function issuePath(v=''){try{return new URL(v,MARVEL).pathname.match(/^\/comics\/issue\/\d+(?:\/[^?#]*)?/i)?.[0]||''}catch{return ''}}
function publicIssueUrl(v=''){const p=issuePath(v);return p?MARVEL+p:''}
function shareIssueUrl(v=''){const p=issuePath(v);return p?SHARE+p:''}
function sourceId(v=''){try{return new URL(v).pathname.match(/^\/comics\/issue\/(\d+)/i)?.[1]||''}catch{return ''}}
function seriesId(v=''){try{return new URL(v).pathname.match(/^\/comics\/series\/(\d+)/i)?.[1]||''}catch{return ''}}
function issueNumberFromSlug(url,year=''){
  try{const slug=decodeURIComponent(new URL(url,MARVEL).pathname.split('/').pop()||''),parts=slug.split(/[_-]+/).filter(Boolean),y=String(year||'');if(y){const yi=parts.lastIndexOf(y);if(yi>=0){for(let i=yi+1;i<parts.length;i++)if(/^\d+(?:\.\d+)?$/.test(parts[i]))return normalizeIssue(parts[i])}}for(let i=parts.length-1;i>=0;i--)if(/^\d+(?:\.\d+)?$/.test(parts[i]))return normalizeIssue(parts[i])}catch{}return '';
}
function urlLooksLikeSeries(url,title,year){let slug='';try{slug=normalize(decodeURIComponent(new URL(url,MARVEL).pathname.split('/').pop()||''))}catch{}const wanted=tokens(title).filter(t=>t!=='comics');if(wanted.length&&wanted.some(t=>!slug.includes(t)))return false;if(year&&!slug.includes(String(year)))return false;return true}
function extractIssueUrls(html=''){
  const clean=unescapeHtml(html).replace(/%2F/gi,'/').replace(/%3A/gi,':'),raw=[...(clean.match(/https?:\/\/(?:www\.|share\.)?marvel\.com\/comics\/issue\/\d+(?:\/[A-Za-z0-9_()%.,+\-]*)?/gi)||[]),...(clean.match(/\/comics\/issue\/\d+(?:\/[A-Za-z0-9_()%.,+\-]*)?/gi)||[])];
  return [...new Set(raw.map(x=>publicIssueUrl(x.startsWith('http')?x:MARVEL+x)).filter(Boolean))];
}
function parsePageMap(html,title,year){const map={};for(const url of extractIssueUrls(html)){if(!urlLooksLikeSeries(url,title,year))continue;const n=issueNumberFromSlug(url,year);if(n&&!map[n])map[n]=url}return map}
function buildPagedUrl(seriesUrl,offset,limit,orderBy){const src=new URL(seriesUrl),u=new URL(MARVEL+src.pathname),sid=seriesId(seriesUrl);u.searchParams.set('byZone','marvel_site_zone');u.searchParams.set('offset',String(offset));u.searchParams.set('byType','comic_series');u.searchParams.set('dateStart','');u.searchParams.set('dateEnd','');u.searchParams.set('type','');u.searchParams.set('orderBy',orderBy);u.searchParams.set('byId',sid);u.searchParams.set('limit',String(limit));return u.toString()}
async function getPagedMap(seriesUrl,title,year,offset,limit,orderBy){
  const sid=seriesId(seriesUrl),key=cacheRequest(`series-page-v${CACHE_REV}`,{sid,offset,limit,orderBy}),cached=await readCache(key);if(cached?.map)return{...cached,fromCache:true};
  const url=buildPagedUrl(seriesUrl,offset,limit,orderBy),started=Date.now();let status=0,html='';try{const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1','Accept':'text/html,application/xhtml+xml,*/*;q=0.8'}});status=r.status;if(r.ok)html=await r.text()}catch(e){return{map:{},url,status:0,error:String(e?.message||e),ms:Date.now()-started,fromCache:false}}
  const map=status>=200&&status<300?parsePageMap(html,title,year):{};const data={map,url,status,error:'',ms:Date.now()-started};if(Object.keys(map).length)await writeCache(key,data,PAGE_TTL);return{...data,fromCache:false};
}
function strategyOffsets(meta,target){
  const keys=(meta.catalogKeys||[]).map(numeric).filter(n=>n!==null),t=numeric(target);if(t===null||!keys.length)return[];
  const max=Math.max(...keys),approx=Math.max(0,Math.floor(Math.max(0,max-t)/20)*20),set=new Set([approx,Math.max(0,approx-20),approx+20]);return [...set].slice(0,3);
}
function extractTitle(html=''){const clean=unescapeHtml(html);for(const re of [/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,/<title[^>]*>([^<]+)<\/title>/i]){const m=clean.match(re);if(m)return stripTags(m[1])}return ''}
function pageMatches(html,title,issue,year){const pt=extractTitle(html),base=pt.replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|Present))?\s*\)/gi,' ').replace(/#.*$/,'').replace(/\|.*$/,' '),titleOk=similarity(title,normalizeSeries(base))>=0.66||normalizeSeries(title)===normalizeSeries(base),issueOk=!issue||new RegExp(`#\\s*${String(issue).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:\\b|\\s|$)`,'i').test(pt),yearOk=!year||pt.includes(`(${year})`)||normalize(pt).includes(String(year));return titleOk&&issueOk&&yearOk}
function absoluteImage(v=''){let s=unescapeHtml(v).trim();if(s.startsWith('//'))s='https:'+s;return /^https?:\/\//i.test(s)?s:''}
function extractCover(html=''){const clean=unescapeHtml(html);for(const re of [/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,/"image_url"\s*:\s*"([^"]+)"/i,/"portrait_xlarge"\s*:\s*"([^"]+)"/i]){const m=clean.match(re);if(m){const u=absoluteImage(m[1]);if(u)return u}}return ''}
function readerData(html,issueUrl){const clean=unescapeHtml(html),m=clean.match(/https:\/\/read\.marvel\.com\/#\/book\/(\d+)/i);return{readerId:m?.[1]||'',webUrl:m?.[0]||issueUrl,unavailable:/Digital issue is not currently available/i.test(clean),unlimited:/Members get unlimited access|Marvel Unlimited/i.test(clean)}}
async function fetchExactIssueHtml(issueUrl,title,issue,year){for(const url of [shareIssueUrl(issueUrl),publicIssueUrl(issueUrl)].filter(Boolean)){try{const html=await fetchHtml(url);if(pageMatches(html,title,issue,year))return html}catch{}}throw new Error('issue-page-mismatch-or-unavailable')}
async function resolveDrn(readerId){if(!readerId)return '';const html=unescapeHtml(await fetchHtml(`${LEGACY}${encodeURIComponent(readerId)}`)).replace(/%3A/gi,':');let d=html.match(/(?:[?&]|\b)drn=([^&"'<>\s]+)/i)?.[1]||'';if(d){try{d=decodeURIComponent(d)}catch{}return d}return html.match(/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i)?.[0]||''}
function smartLink(drn,sid){if(!drn||!sid)return '';const u=new URL(SMART);u.searchParams.set('type','issue');u.searchParams.set('drn',drn);u.searchParams.set('sourceId',sid);return u.toString()}

function metaCacheKey(title,issue,year){return cacheRequest(`meta-v${CACHE_REV}`,{title,issue,year})}
async function resolvePaged(meta,title,issue,year){
  const key=metaCacheKey(title,issue,year),cached=await readCache(key);if(cached?.smartLink||cached?.reason==='reader-unavailable')return cached;
  if(meta.issueUrl||!meta.seriesUrl)return meta;
  const seriesTitle=meta.seriesTitle||title,wanted=normalizeIssue(issue),attempts=[];
  const offsets=strategyOffsets(meta,wanted);
  const strategies=[...offsets.map(offset=>({offset,limit:20,orderBy:'release_date desc',name:`desc-${offset}`})),{offset:0,limit:100,orderBy:'release_date asc',name:'asc-wide'}];
  let issueUrl='';
  for(const s of strategies){const p=await getPagedMap(meta.seriesUrl,seriesTitle,year,s.offset,s.limit,s.orderBy),keys=Object.keys(p.map||{});attempts.push({name:s.name,offset:s.offset,limit:s.limit,orderBy:s.orderBy,url:p.url,status:p.status||0,error:p.error||'',keys:keys.slice(0,120),fromCache:Boolean(p.fromCache),ms:p.ms||0,targetFound:Boolean(p.map?.[wanted])});if(p.map?.[wanted]){issueUrl=p.map[wanted];break}}
  if(!issueUrl)return{...meta,resolverSource:'marvel-series-pagination-unresolved',paginationReason:'target-not-found',paginationAttempts:attempts};
  try{
    const html=await fetchExactIssueHtml(issueUrl,seriesTitle,issue,year),sid=sourceId(issueUrl),reader=readerData(html,issueUrl),coverUrl=extractCover(html),pageTitle=extractTitle(html);let drn='',link='';if(reader.readerId&&sid){drn=await resolveDrn(reader.readerId).catch(()=> '');link=smartLink(drn,sid)}let reason='lookup-unresolved';if(link)reason='ok';else if(reader.unavailable)reason='reader-unavailable';else if(reader.readerId)reason='drn-unavailable';else if(reader.unlimited)reason='reader-id-unresolved';const out={...meta,resolverSource:'marvel-series-pagination',available:Boolean(link),issueUrl,sid,sourceId:sid,readerId:reader.readerId,drn,smartLink:link,webUrl:reader.webUrl,coverUrl,pageTitle,reason,paginationReason:'ok',paginationAttempts:attempts};if(link||reason==='reader-unavailable')await writeCache(key,out,META_TTL);return out;
  }catch(e){return{...meta,resolverSource:'marvel-series-pagination-error',issueUrl,paginationReason:String(e?.message||e),paginationAttempts:attempts}}
}
async function baseMeta(url,env){const u=new URL(url);u.pathname='/api/marvel/open';u.searchParams.set('mode','meta');const r=await baseWorker.fetch(new Request(u.toString(),{headers:{Accept:'application/json'}}),env);return r.json()}
async function verify(url){if(!url)return{ok:false,status:0,error:'missing-url'};try{const r=await fetch(url,{redirect:'manual',headers:{'User-Agent':'Mozilla/5.0 (compatible; MarvelLectura-Diagnostic/7.0)'}});return{ok:r.status>=200&&r.status<400,status:r.status,error:'',location:r.headers.get('Location')||''}}catch(e){return{ok:false,status:0,error:String(e?.message||e),location:''}}}
function diagnosticCode(m,a,w){if(!m.issueUrl)return'LOOKUP_UNRESOLVED';if(m.reason==='reader-unavailable')return'NOT_IN_UNLIMITED';if(!m.readerId)return'READER_ID_MISSING';if(!m.drn)return'DRN_MISSING';if(!m.smartLink)return'SMARTLINK_MISSING';if(!a.ok)return'SMARTLINK_HTTP_ERROR';if(!w.ok)return'WEB_LINK_HTTP_ERROR';return'OK'}
function redirect(location){return new Response(null,{status:302,headers:{Location:location,'Cache-Control':'private, no-store'}})}

export default{async fetch(request,env,ctx){
  const url=new URL(request.url);if(url.pathname!=='/api/marvel/open')return baseWorker.fetch(request,env,ctx);
  const mode=(url.searchParams.get('mode')||'web').toLowerCase();if(mode==='web')return baseWorker.fetch(request,env,ctx);
  if(mode==='diagnostic'&&url.searchParams.get('knownSmartLink'))return baseWorker.fetch(request,env,ctx);
  const title=(url.searchParams.get('title')||'').trim(),issue=(url.searchParams.get('issue')||'').trim(),year=(url.searchParams.get('year')||'').trim();
  let meta=await baseMeta(url,env);if(!meta.smartLink&&meta.reason!=='reader-unavailable')meta=await resolvePaged(meta,title,issue,year);
  if(mode==='meta'||mode==='debug')return Response.json({title,issue,year,...meta},{headers:{'Cache-Control':'no-store'}});
  if(mode==='diagnostic'){const [appCheck,webCheck]=await Promise.all([meta.smartLink?verify(meta.smartLink):Promise.resolve({ok:false,status:0,error:'missing-smartlink'}),meta.webUrl&&meta.readerId?verify(meta.webUrl):Promise.resolve({ok:false,status:0,error:'missing-reader'})]);return Response.json({title,issue,year,...meta,appCheck,webCheck,diagnosticCode:diagnosticCode(meta,appCheck,webCheck)},{headers:{'Cache-Control':'no-store'}})}
  if(['app','ios','android'].includes(mode)){if(meta.smartLink)return redirect(meta.smartLink);return baseWorker.fetch(request,env,ctx)}
  return baseWorker.fetch(request,env,ctx);
}};