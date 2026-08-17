const MARVEL='https://www.marvel.com';
const SHARE='https://share.marvel.com';
const GCD='https://www.comics.org';
const LEGACY='https://share.marvel.com/sharing/legacy/';
const SMART='https://marvel.smart.link/fiir7ec77';
const GOOGLE='https://www.google.com';
const RESOLVER_VERSION=8;
const CACHE_REV=16;
const META_TTL=60*60*24*30;
const SERIES_TTL=60*60*24*14;
const GCD_TTL=60*60*24*30;
const MAX_CRAWL_STEPS=18;

function unescapeHtml(v=''){
  return String(v).replace(/\\u002F/gi,'/').replace(/\\u003A/gi,':').replace(/\\\//g,'/')
    .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#58;/g,':')
    .replace(/&ndash;|&#8211;/g,'-').replace(/&mdash;|&#8212;/g,'-');
}
function stripTags(v=''){return unescapeHtml(String(v).replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim()}
function normalize(v=''){return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim()}
function normalizeSeries(v=''){return normalize(v).replace(/^the\s+/,'').replace(/\s+comics$/,'').trim()}
function tokens(v=''){return normalizeSeries(v).split(/\s+/).filter(Boolean)}
function similarity(a,b){const A=new Set(tokens(a)),B=new Set(tokens(b));if(!A.size||!B.size)return 0;let c=0;for(const x of A)if(B.has(x))c++;return c/Math.max(A.size,B.size)}
function normalizeIssue(v=''){let s=String(v||'').trim().toUpperCase().replace(/\s+/g,'');if(/^0+\d+$/.test(s))s=String(Number(s));return s}
function numeric(v=''){return /^\d+(?:\.\d+)?$/.test(String(v||''))?Number(v):null}
function escapeRegExp(v=''){return String(v).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}

async function fetchResponse(url,{redirect='follow',accept='text/html,application/xhtml+xml,*/*;q=0.8'}={}){
  return fetch(url,{redirect,headers:{
    'User-Agent':'MarvelReadingGuide/1.2 (+https://github.com/CPJA88/marvel-orden-lectura) Mozilla/5.0',
    'Accept':accept,'Accept-Language':'en-US,en;q=0.9'
  }});
}
async function fetchHtml(url){const r=await fetchResponse(url);if(!r.ok)throw new Error(`${new URL(url).hostname} HTTP ${r.status}`);return r.text()}
function cacheRequest(path,params={}){const u=new URL(`https://marvel-neighbor-cache.invalid/${path}`);for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v??''));return new Request(u.toString())}
async function readCache(key){const c=typeof caches!=='undefined'?caches.default:null;if(!c)return null;const hit=await c.match(key);if(!hit)return null;try{return await hit.json()}catch{return null}}
async function writeCache(key,data,maxAge){const c=typeof caches!=='undefined'?caches.default:null;if(!c)return;await c.put(key,Response.json(data,{headers:{'Cache-Control':`public, max-age=${maxAge}`}})).catch(()=>{})}

function issuePath(v=''){try{return new URL(v,MARVEL).pathname.match(/^\/comics\/issue\/\d+(?:\/[^?#]*)?/i)?.[0]||''}catch{return ''}}
function seriesPath(v=''){try{return new URL(v,SHARE).pathname.match(/^\/comics\/series\/\d+(?:\/[^?#]*)?/i)?.[0]||''}catch{return ''}}
function publicIssueUrl(v=''){const p=issuePath(v);return p?MARVEL+p:''}
function shareIssueUrl(v=''){const p=issuePath(v);return p?SHARE+p:''}
function sourceId(v=''){try{return new URL(v,MARVEL).pathname.match(/^\/comics\/issue\/(\d+)/i)?.[1]||''}catch{return ''}}
function seriesId(v=''){try{return new URL(v,SHARE).pathname.match(/^\/comics\/series\/(\d+)/i)?.[1]||''}catch{return ''}}
function issueNumberFromSlug(url,year=''){
  try{
    const slug=decodeURIComponent(new URL(url,MARVEL).pathname.split('/').pop()||''),parts=slug.split(/[_-]+/).filter(Boolean),y=String(year||'');
    if(y){const yi=parts.lastIndexOf(y);if(yi>=0){for(let i=yi+1;i<parts.length;i++)if(/^\d+(?:\.\d+)?$/.test(parts[i]))return normalizeIssue(parts[i])}}
    for(let i=parts.length-1;i>=0;i--)if(/^\d+(?:\.\d+)?$/.test(parts[i]))return normalizeIssue(parts[i]);
  }catch{}
  return '';
}
function urlLooksLikeSeries(url,title,year){
  let slug='';try{slug=normalize(decodeURIComponent(new URL(url,MARVEL).pathname.split('/').pop()||''))}catch{}
  const wanted=tokens(title).filter(t=>t!=='comics');
  if(wanted.length&&wanted.some(t=>!slug.includes(t)))return false;
  if(year&&!slug.includes(String(year)))return false;
  return true;
}
function extractIssueUrls(html=''){
  const clean=unescapeHtml(html).replace(/%2F/gi,'/').replace(/%3A/gi,':');
  const raw=[...(clean.match(/https?:\/\/(?:www\.|share\.)?marvel\.com\/comics\/issue\/\d+(?:\/[A-Za-z0-9_()%.,+\-]*)?/gi)||[]),...(clean.match(/\/comics\/issue\/\d+(?:\/[A-Za-z0-9_()%.,+\-]*)?/gi)||[])];
  return [...new Set(raw.map(x=>publicIssueUrl(x.startsWith('http')?x:MARVEL+x)).filter(Boolean))];
}
function pageMap(html,title,year){const map={};for(const url of extractIssueUrls(html)){if(!urlLooksLikeSeries(url,title,year))continue;const n=issueNumberFromSlug(url,year);if(n&&!map[n])map[n]=url}return map}
function extractTitle(html=''){
  const clean=unescapeHtml(html);for(const re of [/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,/<title[^>]*>([^<]+)<\/title>/i]){const m=clean.match(re);if(m)return stripTags(m[1])}return '';
}
function pageMatches(html,title,issue,year){
  const pt=extractTitle(html),base=pt.replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|Present))?\s*\)/gi,' ').replace(/#.*$/,'').replace(/\|.*$/,' '),norm=normalizeSeries(base);
  const titleOk=similarity(title,norm)>=0.66||normalizeSeries(title)===norm;
  const issueOk=!issue||new RegExp(`#\\s*${escapeRegExp(issue)}(?:\\b|\\s|$)`,'i').test(pt);
  const yearOk=!year||pt.includes(`(${year})`)||normalize(pt).includes(String(year));
  return titleOk&&issueOk&&yearOk;
}
function extractNavUrl(html,label){
  const clean=unescapeHtml(html),word=label==='prev'?'Prev':'Next';
  const patterns=[
    new RegExp(`<a\\b[^>]*href=["']([^"']+)["'][^>]*>\\s*(?:<[^>]+>\\s*)*${word}\\s*(?:<[^>]+>\\s*)*<\\/a>`,'i'),
    new RegExp(`<a\\b[^>]*(?:aria-label|title)=["'][^"']*${word}[^"']*["'][^>]*href=["']([^"']+)["']`,'i'),
    new RegExp(`<a\\b[^>]*href=["']([^"']+)["'][^>]*(?:aria-label|title)=["'][^"']*${word}[^"']*["']`,'i')
  ];
  for(const re of patterns){const m=clean.match(re);if(m){const u=publicIssueUrl(m[1]);if(u)return u}}
  return '';
}

function parseSeriesLabel(label=''){
  const clean=stripTags(label),m=clean.match(/^(.*?)\s*\((\d{4})(?:\s*-\s*(?:\d{4}|Present))?\)\s*$/i);
  return{label:clean,title:(m?.[1]||clean).trim(),startYear:m?.[2]||''};
}
function parseSeriesIndex(html=''){
  const out=[],seen=new Set(),re=/<a\b[^>]*href=["']([^"']*\/comics\/series\/\d+(?:\/[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;
  while((m=re.exec(html))){const p=seriesPath(unescapeHtml(m[1]));if(!p)continue;const parsed=parseSeriesLabel(m[2]);if(!parsed.title||!parsed.startYear)continue;const href=SHARE+p,key=href+'|'+parsed.label;if(seen.has(key))continue;seen.add(key);out.push({href,label:parsed.label,title:parsed.title,startYear:parsed.startYear,norm:normalizeSeries(parsed.title)})}
  return out;
}
async function getSeriesIndex(){
  const key=cacheRequest(`series-index-v${CACHE_REV}`),cached=await readCache(key);if(Array.isArray(cached?.items)&&cached.items.length>500)return cached.items;
  const html=await fetchHtml(`${SHARE}/comics/series`),items=parseSeriesIndex(html);if(items.length<500)throw new Error(`series-index-incomplete:${items.length}`);await writeCache(key,{items},SERIES_TTL);return items;
}
function findSeries(items,title,year){
  const want=normalizeSeries(title),y=String(year||''),exact=items.filter(x=>x.norm===want&&(!y||x.startYear===y));if(exact.length)return exact[0];
  const ranked=items.filter(x=>!y||x.startYear===y).map(x=>({x,score:similarity(title,x.title)})).filter(x=>x.score>=0.66).sort((a,b)=>b.score-a.score);
  if(ranked.length&&(!ranked[1]||ranked[0].score>ranked[1].score))return ranked[0].x;
  const same=items.filter(x=>x.norm===want);return same.length===1?same[0]:null;
}
async function loadSeriesSeed(entry){
  const sid=seriesId(entry.href),key=cacheRequest(`series-crawl-v${CACHE_REV}`,{sid}),cached=await readCache(key);if(cached?.map&&Object.keys(cached.map).length)return{...cached,key};
  let html='';try{html=await fetchHtml(entry.href)}catch{html=await fetchHtml(MARVEL+new URL(entry.href).pathname)}
  const map=pageMap(html,entry.title,entry.startYear),data={sid,seriesTitle:entry.title,seriesYear:entry.startYear,seriesLabel:entry.label,seriesUrl:entry.href,map,updatedAt:Date.now()};await writeCache(key,data,SERIES_TTL);return{...data,key};
}
async function saveSeriesMap(seed){await writeCache(seed.key,{sid:seed.sid,seriesTitle:seed.seriesTitle,seriesYear:seed.seriesYear,seriesLabel:seed.seriesLabel,seriesUrl:seed.seriesUrl,map:seed.map,updatedAt:Date.now()},SERIES_TTL)}
function nearestKnown(map,target){
  const t=numeric(target),rows=Object.entries(map).map(([n,url])=>({n:numeric(n),key:n,url})).filter(x=>x.n!==null&&t!==null);if(!rows.length)return null;rows.sort((a,b)=>Math.abs(a.n-t)-Math.abs(b.n-t));return rows[0];
}
async function crawlToward(seed,target){
  const wanted=normalizeIssue(target);if(seed.map[wanted])return{found:seed.map[wanted],steps:0,complete:true};
  const t=numeric(wanted),start=nearestKnown(seed.map,wanted);if(t===null||!start)return{found:'',steps:0,complete:false,error:'non-numeric-or-no-seed'};
  let current=start.url,currentNum=start.n,steps=0,lastDirection=t<currentNum?'prev':'next';
  const visited=new Set();
  while(current&&steps<MAX_CRAWL_STEPS&&!visited.has(current)){
    visited.add(current);let html='';try{html=await fetchHtml(current)}catch(e){return{found:'',steps,complete:false,error:String(e?.message||e)}}
    const discovered=pageMap(html,seed.seriesTitle,seed.seriesYear);for(const [n,u] of Object.entries(discovered))if(!seed.map[n])seed.map[n]=u;
    if(seed.map[wanted]){await saveSeriesMap(seed);return{found:seed.map[wanted],steps:steps+1,complete:true}}
    let next=extractNavUrl(html,lastDirection);
    if(!next){
      const candidates=Object.entries(discovered).map(([n,u])=>({n:numeric(n),u})).filter(x=>x.n!==null&&((lastDirection==='prev'&&x.n<currentNum)||(lastDirection==='next'&&x.n>currentNum))).sort((a,b)=>lastDirection==='prev'?b.n-a.n:a.n-b.n);
      next=candidates[0]?.u||'';
    }
    if(!next)break;
    const nn=numeric(issueNumberFromSlug(next,seed.seriesYear));if(nn!==null)currentNum=nn;current=next;steps++;
  }
  await saveSeriesMap(seed);return{found:seed.map[wanted]||'',steps,complete:Boolean(seed.map[wanted]),error:''};
}

function absoluteImage(v=''){let s=unescapeHtml(v).trim();if(s.startsWith('//'))s='https:'+s;return /^https?:\/\//i.test(s)?s:''}
function extractCover(html=''){const clean=unescapeHtml(html);for(const re of [/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,/"image_url"\s*:\s*"([^"]+)"/i,/"portrait_xlarge"\s*:\s*"([^"]+)"/i]){const m=clean.match(re);if(m){const u=absoluteImage(m[1]);if(u)return u}}return ''}
function readerData(html,issueUrl){const clean=unescapeHtml(html),m=clean.match(/https:\/\/read\.marvel\.com\/#\/book\/(\d+)/i);return{readerId:m?.[1]||'',webUrl:m?.[0]||issueUrl,unavailable:/Digital issue is not currently available/i.test(clean),unlimited:/Members get unlimited access|Marvel Unlimited/i.test(clean)}}
async function fetchExactIssue(issueUrl,title,issue,year){for(const u of [shareIssueUrl(issueUrl),publicIssueUrl(issueUrl)].filter(Boolean)){try{const html=await fetchHtml(u);if(pageMatches(html,title,issue,year))return html}catch{}}throw new Error('issue-page-mismatch-or-unavailable')}
async function resolveDrn(readerId){if(!readerId)return '';const html=unescapeHtml(await fetchHtml(`${LEGACY}${encodeURIComponent(readerId)}`)).replace(/%3A/gi,':');let d=html.match(/(?:[?&]|\b)drn=([^&"'<>\s]+)/i)?.[1]||'';if(d){try{d=decodeURIComponent(d)}catch{}return d}return html.match(/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i)?.[0]||''}
function smartLink(drn,sid){if(!drn||!sid)return '';const u=new URL(SMART);u.searchParams.set('type','issue');u.searchParams.set('drn',drn);u.searchParams.set('sourceId',sid);return u.toString()}
function luckyUrl(title,issue,year){return `${GOOGLE}/search?btnI=1&q=${encodeURIComponent(`site:marvel.com/comics/issue/ "${title}" "#${issue}" ${year} Marvel Unlimited`)}`}
function metaKey(title,issue,year){return cacheRequest(`meta-v${CACHE_REV}`,{title,issue,year})}
function stableLegacyKey(title,issue,year){const u=new URL('https://marvel-meta-cache.invalid/item');u.searchParams.set('resolver','5');u.searchParams.set('kind','app-stable');u.searchParams.set('title',title);u.searchParams.set('issue',issue);u.searchParams.set('year',year);return new Request(u.toString())}
async function legacyPositive(title,issue,year){const hit=await readCache(stableLegacyKey(title,issue,year));return hit?.smartLink&&hit?.issueUrl?hit:null}
async function metadataFromIssue(issueUrl,title,issue,year,extra={}){
  const html=await fetchExactIssue(issueUrl,title,issue,year),sid=sourceId(issueUrl),reader=readerData(html,issueUrl),coverUrl=extractCover(html),pageTitle=extractTitle(html);let drn='',link='';if(reader.readerId&&sid){try{drn=await resolveDrn(reader.readerId);link=smartLink(drn,sid)}catch{}}
  let reason='lookup-unresolved';if(link)reason='ok';else if(reader.unavailable)reason='reader-unavailable';else if(reader.readerId)reason='drn-unavailable';else if(reader.unlimited)reason='reader-id-unresolved';
  return{resolverVersion:RESOLVER_VERSION,resolverSource:'marvel-neighbor-crawl',available:Boolean(link),issueUrl,sourceId:sid,readerId:reader.readerId,drn,smartLink:link,webUrl:reader.webUrl,coverUrl,pageTitle,reason,...extra};
}
async function resolveMeta(title,issue,year){
  const key=metaKey(title,issue,year),cached=await readCache(key);if(cached?.smartLink||cached?.reason==='reader-unavailable')return cached;
  const legacy=await legacyPositive(title,issue,year);if(legacy)return{...legacy,resolverVersion:RESOLVER_VERSION,resolverSource:'legacy-positive-cache'};
  let items,entry;try{items=await getSeriesIndex();entry=findSeries(items,title,year)}catch(e){return{resolverVersion:RESOLVER_VERSION,resolverSource:'series-index-error',available:false,issueUrl:'',smartLink:'',coverUrl:'',reason:'resolver-error',error:String(e?.message||e),webUrl:luckyUrl(title,issue,year)}}
  if(!entry)return{resolverVersion:RESOLVER_VERSION,resolverSource:'series-not-found',available:false,issueUrl:'',smartLink:'',coverUrl:'',reason:'lookup-unresolved',webUrl:luckyUrl(title,issue,year),crawlReason:'series-not-found'};
  let seed;try{seed=await loadSeriesSeed(entry)}catch(e){return{resolverVersion:RESOLVER_VERSION,resolverSource:'series-seed-error',available:false,issueUrl:'',smartLink:'',coverUrl:'',reason:'resolver-error',webUrl:luckyUrl(title,issue,year),seriesLabel:entry.label,seriesUrl:entry.href,error:String(e?.message||e)}}
  const wanted=normalizeIssue(issue);let issueUrl=seed.map[wanted]||'',crawl={found:issueUrl,steps:0,complete:Boolean(issueUrl)};
  if(!issueUrl)crawl=await crawlToward(seed,wanted);
  issueUrl=crawl.found||'';
  const knownKeys=Object.keys(seed.map).sort((a,b)=>(numeric(a)??999999)-(numeric(b)??999999));
  const common={seriesTitle:seed.seriesTitle,seriesLabel:seed.seriesLabel,seriesUrl:seed.seriesUrl,crawlSteps:crawl.steps||0,crawlKnown:knownKeys.length,crawlMin:knownKeys[0]||'',crawlMax:knownKeys[knownKeys.length-1]||''};
  if(!issueUrl)return{resolverVersion:RESOLVER_VERSION,resolverSource:'marvel-neighbor-crawl',available:false,issueUrl:'',sourceId:'',readerId:'',drn:'',smartLink:'',coverUrl:'',reason:crawl.error?'lookup-unresolved':'series-crawl-pending',webUrl:luckyUrl(title,issue,year),crawlReason:crawl.error||'target-not-reached-in-block',...common};
  try{const data=await metadataFromIssue(issueUrl,seed.seriesTitle,issue,year,common);if(data.smartLink||data.reason==='reader-unavailable')await writeCache(key,data,META_TTL);return data}catch(e){return{resolverVersion:RESOLVER_VERSION,resolverSource:'marvel-neighbor-crawl-error',available:false,issueUrl,smartLink:'',coverUrl:'',reason:'resolver-error',webUrl:issueUrl,error:String(e?.message||e),...common}}
}

async function gcdCover(id){
  const clean=String(id||'').replace(/\D/g,'');if(!clean)return new Response('Falta id GCD',{status:400});
  const key=cacheRequest(`gcd-cover-v1`,{id:clean}),cached=await readCache(key);if(cached)return Response.json(cached,{headers:{'Cache-Control':`public, max-age=${GCD_TTL}`}});
  try{
    const r=await fetchResponse(`${GCD}/api/issue/${clean}/`,{accept:'application/json'});if(!r.ok)return Response.json({id:Number(clean),coverUrl:'',error:`GCD HTTP ${r.status}`},{status:r.status,headers:{'Cache-Control':'no-store'}});
    const data=await r.json(),coverUrl=String(data?.cover||'');const out={id:Number(clean),coverUrl,source:'gcd-api'};await writeCache(key,out,GCD_TTL);return Response.json(out,{headers:{'Cache-Control':`public, max-age=${GCD_TTL}`}});
  }catch(e){return Response.json({id:Number(clean),coverUrl:'',error:String(e?.message||e)},{status:502,headers:{'Cache-Control':'no-store'}})}
}
async function verify(url){if(!url)return{ok:false,status:0,error:'missing-url'};try{const r=await fetch(url,{redirect:'manual',headers:{'User-Agent':'MarvelReadingGuide-Diagnostic/8.0'}});return{ok:r.status>=200&&r.status<400,status:r.status,error:'',location:r.headers.get('Location')||''}}catch(e){return{ok:false,status:0,error:String(e?.message||e),location:''}}}
function diagCode(m,a,w){if(m.reason==='series-crawl-pending')return'LOOKUP_UNRESOLVED';if(!m.issueUrl)return'LOOKUP_UNRESOLVED';if(m.reason==='reader-unavailable')return'NOT_IN_UNLIMITED';if(!m.readerId)return'READER_ID_MISSING';if(!m.drn)return'DRN_MISSING';if(!m.smartLink)return'SMARTLINK_MISSING';if(!a.ok)return'SMARTLINK_HTTP_ERROR';if(!w.ok)return'WEB_LINK_HTTP_ERROR';return'OK'}
function redirect(location){return new Response(null,{status:302,headers:{Location:location,'Cache-Control':'private, no-store'}})}
function errorPage(fallback,msg){const safe=String(fallback).replace(/&/g,'&amp;').replace(/"/g,'&quot;'),text=String(msg).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));return new Response(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marvel Unlimited</title><body style="font-family:-apple-system,sans-serif;padding:32px;text-align:center"><h2>Marvel Unlimited</h2><p>${text}</p><a href="${safe}">Abrir este número en la web</a></body></html>`,{status:502,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})}

export default{async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/api/gcd/cover')return gcdCover(url.searchParams.get('id'));
  if(url.pathname!=='/api/marvel/open')return env.ASSETS.fetch(request);
  const title=(url.searchParams.get('title')||'').trim(),issue=(url.searchParams.get('issue')||'').trim(),year=(url.searchParams.get('year')||'').trim(),mode=(url.searchParams.get('mode')||'web').toLowerCase();if(!title)return new Response('Falta el título.',{status:400});
  const lucky=luckyUrl(title,issue,year);if(mode==='web')return redirect(lucky);
  try{
    const meta=await resolveMeta(title,issue,year);
    if(mode==='meta'||mode==='debug')return Response.json({title,issue,year,...meta},{headers:{'Cache-Control':'no-store'}});
    if(mode==='diagnostic'){
      const [appCheck,webCheck]=await Promise.all([meta.smartLink?verify(meta.smartLink):Promise.resolve({ok:false,status:0,error:'missing-smartlink'}),meta.webUrl&&meta.readerId?verify(meta.webUrl):Promise.resolve({ok:false,status:0,error:'missing-reader'})]);
      return Response.json({title,issue,year,...meta,appCheck,webCheck,diagnosticCode:diagCode(meta,appCheck,webCheck)},{headers:{'Cache-Control':'no-store'}});
    }
    if(['app','ios','android'].includes(mode)){
      if(meta.smartLink)return redirect(meta.smartLink);
      const msg=meta.reason==='series-crawl-pending'?'Estoy completando el índice de esta serie. Vuelve a pulsar en unos segundos.':meta.reason==='reader-unavailable'?'Marvel Unlimited no ofrece este número en su lector digital.':'No he podido construir todavía el enlace exacto de Marvel Unlimited.';
      return errorPage(meta.webUrl||lucky,msg);
    }
    return new Response('Modo no reconocido.',{status:400});
  }catch(e){if(['meta','debug','diagnostic'].includes(mode))return Response.json({resolverVersion:RESOLVER_VERSION,available:false,reason:'resolver-error',error:String(e?.message||e),webUrl:lucky},{headers:{'Cache-Control':'no-store'}});return errorPage(lucky,'Se ha producido un error al construir el enlace de Marvel Unlimited.')}
}};