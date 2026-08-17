const RESOLVER_VERSION=13;
const META_API='https://marvel.emreparker.com';
const GCD='https://www.comics.org';
const LEGACY='https://share.marvel.com/sharing/legacy/';
const SMART='https://marvel.smart.link/fiir7ec77';
const YEAR_TTL=60*60*24*30;
const DETAIL_TTL=60*60*24*90;
const META_TTL=60*60*24*90;
const DRN_TTL=60*60*24*90;
const COVER_TTL=60*60*24*30;

function redirect(location){return new Response(null,{status:302,headers:{Location:location,'Cache-Control':'private, no-store'}})}
function cacheReq(url){return new Request(url)}
async function cacheJson(key){const c=typeof caches!=='undefined'?caches.default:null;if(!c)return null;const r=await c.match(key);if(!r)return null;try{return await r.json()}catch{return null}}
async function cachePut(key,response){const c=typeof caches!=='undefined'?caches.default:null;if(!c)return;await c.put(key,response.clone()).catch(()=>{})}
function htmlDecode(v=''){return String(v).replace(/\\u002F/gi,'/').replace(/\\u003A/gi,':').replace(/\\\//g,'/').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&#x27;/gi,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)))}
function normalize(v=''){return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim()}
function normalizeSeries(v=''){
  let s=String(v).replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|present))?\s*\)/gi,' ').replace(/#\s*[^#]+$/,' ');
  s=normalize(s).replace(/^the\s+/,'').replace(/\s+comics$/,'').replace(/\s+comic$/,'').trim();
  return s;
}
function normalizeIssue(v=''){let s=String(v||'').trim().toUpperCase().replace(/\s+/g,'');if(/^0+\d+$/.test(s))s=String(Number(s));return s}
function tokenScore(a,b){const A=new Set(normalizeSeries(a).split(' ').filter(Boolean)),B=new Set(normalizeSeries(b).split(' ').filter(Boolean));if(!A.size||!B.size)return 0;let n=0;for(const t of A)if(B.has(t))n++;return n/Math.max(A.size,B.size)}
function seriesStartYear(v=''){return String(v||'').match(/\((\d{4})/)?.[1]||''}
function releaseYear(date,seriesYear){return String(date||'').match(/\b((?:19|20)\d{2})\b/)?.[1]||String(seriesYear||'')}
function buildSmartLink(drn,sourceId){if(!drn||!sourceId)return '';return `${SMART}?type=issue&drn=${drn}&sourceId=${encodeURIComponent(String(sourceId))}`}
function webReader(readerId){return readerId?`https://read.marvel.com/#/book/${encodeURIComponent(String(readerId))}`:''}
function legacyShare(readerId){return readerId?`${LEGACY}${encodeURIComponent(String(readerId))}`:''}
function sourceIdFromUrl(v=''){try{return new URL(v).pathname.match(/\/comics\/issue\/(\d+)/i)?.[1]||''}catch{return ''}}

async function fetchJson(url){
  const r=await fetch(url,{redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 (compatible; MarvelReadingGuide/1.2.22)','Accept':'application/json','Accept-Language':'en-US,en;q=0.9'}});
  if(!r.ok)throw new Error(`${new URL(url).hostname} HTTP ${r.status}`);
  return r.json();
}

function yearKey(year){return cacheReq(`https://marvel-structured-cache.invalid/year-v22/${year}`)}
async function getYearIndex(year){
  const y=String(year||'').match(/^(19|20)\d{2}$/)?.[0];if(!y)throw new Error('invalid-release-year');
  const key=yearKey(y),cached=await cacheJson(key);if(Array.isArray(cached?.items))return cached.items;
  const items=[];let offset=0,total=Infinity,pages=0;
  while(offset<total&&pages<20){
    const u=new URL('/v1/issues',META_API);u.searchParams.set('year',y);u.searchParams.set('limit','200');u.searchParams.set('offset',String(offset));
    const data=await fetchJson(u.toString()),part=Array.isArray(data?.items)?data.items:[];
    total=Number(data?.total)||part.length;items.push(...part);pages++;
    if(!part.length)break;offset+=part.length;
  }
  const out=Response.json({year:y,items},{headers:{'Cache-Control':`public,max-age=${YEAR_TTL}`}});await cachePut(key,out);return items;
}

function candidateSeries(item){return String(item?.seriesName||item?.title||'').replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|Present))?\s*\).*/i,'').replace(/#\s*.*$/,'').trim()}
function candidateScore(item,title,issue,seriesYear,date){
  if(normalizeIssue(item?.issueNumber)!==normalizeIssue(issue))return -Infinity;
  const local=normalizeSeries(title),remote=normalizeSeries(candidateSeries(item)),sim=Math.max(tokenScore(title,candidateSeries(item)),tokenScore(title,item?.title||''));
  if(!local||!remote||sim<0.6)return -Infinity;
  let score=sim*40;if(local===remote)score+=100;
  const sy=seriesStartYear(item?.seriesName||item?.title||'');if(seriesYear&&sy&&String(seriesYear)===sy)score+=25;
  const ry=releaseYear(date,seriesYear);if(ry&&String(item?.yearPage||'')===ry)score+=20;
  const sale=String(item?.onSaleDate||'');if(date&&sale&&String(date).slice(0,10)===sale.slice(0,10))score+=30;
  return score;
}
async function locateIssue(title,issue,seriesYear,date){
  const base=Number(releaseYear(date,seriesYear));if(!base)return{item:null,attempts:[],error:'missing-release-year'};
  const years=[base,base-1,base+1].filter((v,i,a)=>v>=1939&&v<=2026&&a.indexOf(v)===i),attempts=[];
  for(const y of years){
    try{
      const items=await getYearIndex(y),ranked=items.map(x=>({x,score:candidateScore(x,title,issue,seriesYear,date)})).filter(x=>Number.isFinite(x.score)).sort((a,b)=>b.score-a.score);
      attempts.push({year:y,count:items.length,matches:ranked.length,best:ranked[0]?.score||0});
      if(ranked.length){
        if(ranked[1]&&ranked[0].score-rANKED_SAFE(ranked[1].score)<1)return{item:null,attempts,error:'ambiguous-match'};
        return{item:ranked[0].x,attempts,error:''};
      }
    }catch(e){attempts.push({year:y,count:0,matches:0,error:String(e?.message||e)})}
  }
  return{item:null,attempts,error:'no-exact-match'};
}
function rANKED_SAFE(v){return Number(v)||0}

function detailKey(sourceId){return cacheReq(`https://marvel-structured-cache.invalid/detail-v22/${encodeURIComponent(String(sourceId))}`)}
async function getIssueDetail(sourceId){
  const id=String(sourceId||'').replace(/\D/g,'');if(!id)throw new Error('missing-source-id');
  const key=detailKey(id),cached=await cacheJson(key);if(cached?.id)return cached;
  const data=await fetchJson(`${META_API}/v1/issues/${id}`),out=Response.json(data,{headers:{'Cache-Control':`public,max-age=${DETAIL_TTL}`}});await cachePut(key,out);return data;
}
function coverSource(detail,size='portrait_incredible'){
  let path=String(detail?.cover?.path||'').trim(),ext=String(detail?.cover?.extension||'jpg').trim()||'jpg';if(!path)return '';
  path=path.replace(/^http:/i,'https:').replace(/\/$/,'');return `${path}/${size}.${ext}`;
}

function decodeRepeated(v=''){
  let s=htmlDecode(v);for(let i=0;i<3;i++){try{const d=decodeURIComponent(s);if(d===s)break;s=d}catch{break}}return s;
}
function extractDrn(value=''){
  const text=decodeRepeated(value).replace(/%3A/gi,':');
  const direct=text.match(/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i)?.[0];if(direct)return direct;
  const q=text.match(/(?:[?&]|\b)drn=([^&"'<>\s]+)/i)?.[1]||'';if(q){const d=decodeRepeated(q);const m=d.match(/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i)?.[0];if(m)return m}
  return '';
}
function drnKey(readerId){return cacheReq(`https://marvel-structured-cache.invalid/drn-v22/${encodeURIComponent(String(readerId))}`)}
async function resolveDrn(readerId){
  if(!readerId||String(readerId)==='0')return '';
  const key=drnKey(readerId),cached=await cacheJson(key);if(cached?.drn)return cached.drn;
  const target=legacyShare(readerId),headers={'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1','Accept':'text/html,application/xhtml+xml,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9'};
  let drn='';
  try{
    const first=await fetch(target,{redirect:'manual',headers});drn=extractDrn(first.headers.get('Location')||'');
    if(!drn&&first.status>=200&&first.status<300)drn=extractDrn(await first.text());
  }catch{}
  if(!drn){
    try{const second=await fetch(target,{redirect:'follow',headers});drn=extractDrn(second.url);if(!drn)drn=extractDrn(await second.text())}catch{}
  }
  if(drn){const out=Response.json({readerId:String(readerId),drn},{headers:{'Cache-Control':`public,max-age=${DRN_TTL}`}});await cachePut(key,out)}
  return drn;
}

function addParams(base,title,issue,year){base.searchParams.set('title',title);base.searchParams.set('issue',issue);base.searchParams.set('year',year);return base}
function legacyPositiveKeys(title,issue,year){
  const keys=[];const stable=new URL('https://marvel-meta-cache.invalid/item');stable.searchParams.set('resolver','5');stable.searchParams.set('kind','app-stable');addParams(stable,title,issue,year);keys.push(cacheReq(stable.toString()));
  for(const rev of [6,7])keys.push(cacheReq(addParams(new URL(`https://marvel-meta-cache.invalid/v${rev}`),title,issue,year).toString()));
  for(const rev of [7,8,9,10,11,12,13,14,15,16,17])keys.push(cacheReq(addParams(new URL(`https://marvel-meta-cache.invalid/meta-v${rev}`),title,issue,year).toString()));
  keys.push(cacheReq(addParams(new URL('https://marvel-neighbor-cache.invalid/meta-v16'),title,issue,year).toString()));return keys;
}
async function recoverPositive(title,issue,seriesYear){
  for(const key of legacyPositiveKeys(title,issue,seriesYear)){
    const hit=await cacheJson(key);if(!hit)continue;let smartLink=hit.smartLink||'';
    if(!smartLink&&hit.drn&&hit.sourceId)smartLink=buildSmartLink(hit.drn,hit.sourceId);
    if(!smartLink&&hit.readerId&&hit.sourceId){const drn=await resolveDrn(hit.readerId);if(drn)smartLink=buildSmartLink(drn,hit.sourceId)}
    if(smartLink)return{...hit,smartLink,available:true,reason:'ok',resolverVersion:RESOLVER_VERSION,resolverSource:'recovered-positive-cache'};
  }
  return null;
}
function metaKey(title,issue,seriesYear,date){const u=new URL('https://marvel-structured-cache.invalid/meta-v22');u.searchParams.set('title',title);u.searchParams.set('issue',issue);u.searchParams.set('seriesYear',seriesYear);u.searchParams.set('date',date);return cacheReq(u.toString())}
async function resolveMeta(title,issue,seriesYear,date){
  const key=metaKey(title,issue,seriesYear,date),cached=await cacheJson(key);if(cached?.smartLink)return cached;
  const legacy=await recoverPositive(title,issue,seriesYear);if(legacy){await cachePut(key,Response.json(legacy,{headers:{'Cache-Control':`public,max-age=${META_TTL}`}}));return legacy}
  const located=await locateIssue(title,issue,seriesYear,date);if(!located.item)return{resolverVersion:RESOLVER_VERSION,resolverSource:'structured-year-index',available:false,reason:'not-verified',issueUrl:'',sourceId:'',readerId:'',drn:'',smartLink:'',coverUrl:'',webUrl:'',attempts:located.attempts,error:located.error};
  const sourceId=String(located.item.id||sourceIdFromUrl(located.item.detailUrl)||''),detail=await getIssueDetail(sourceId),readerId=String(detail?.digitalId||''),issueUrl=String(detail?.detailUrl||located.item.detailUrl||''),coverUrl=detail?.cover?.path?`/api/marvel/cover?sourceId=${encodeURIComponent(sourceId)}`:'';
  let drn='',drnError='';if(readerId&&readerId!=='0'){try{drn=await resolveDrn(readerId)}catch(e){drnError=String(e?.message||e)}}
  const smartLink=buildSmartLink(drn,sourceId),explicitUnavailable=(!readerId||readerId==='0')&&!detail?.unlimitedDate;
  const reason=smartLink?'ok':explicitUnavailable?'reader-unavailable':readerId&&readerId!=='0'?'drn-unavailable':'not-verified';
  const data={resolverVersion:RESOLVER_VERSION,resolverSource:'structured-year-index',available:Boolean(smartLink),reason,issueUrl,sourceId,readerId,drn,smartLink,coverUrl,webUrl:webReader(readerId)||issueUrl,pageTitle:String(detail?.title||located.item.title||''),attempts:located.attempts,drnError};
  if(smartLink||reason==='reader-unavailable')await cachePut(key,Response.json(data,{headers:{'Cache-Control':`public,max-age=${META_TTL}`}}));return data;
}

function placeholderSvg(){const body='<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600"><rect width="400" height="600" rx="24" fill="#f0ede6"/><rect x="128" y="220" width="144" height="160" rx="16" fill="#e62429"/><text x="200" y="323" text-anchor="middle" font-family="Arial,sans-serif" font-size="92" font-weight="700" fill="white">M</text></svg>';return new Response(body,{status:200,headers:{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'public,max-age=3600'}})}
async function marvelCover(request){
  const url=new URL(request.url),sourceId=String(url.searchParams.get('sourceId')||'').replace(/\D/g,'');if(!sourceId)return placeholderSvg();
  const browserKey=new Request(url.origin+url.pathname+'?sourceId='+sourceId),c=typeof caches!=='undefined'?caches.default:null;if(c){const hit=await c.match(browserKey);if(hit)return hit}
  try{
    const detail=await getIssueDetail(sourceId);let response=null;
    for(const size of ['portrait_incredible','portrait_uncanny','portrait_xlarge']){
      const src=coverSource(detail,size);if(!src)break;const r=await fetch(src,{redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1','Accept':'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'}});if(r.ok&&/^image\//i.test(r.headers.get('Content-Type')||'')){response=new Response(r.body,{status:200,headers:{'Content-Type':r.headers.get('Content-Type')||'image/jpeg','Cache-Control':`public,max-age=${COVER_TTL},immutable`}});break}
    }
    if(!response)return placeholderSvg();if(c)await c.put(browserKey,response.clone()).catch(()=>{});return response;
  }catch{return placeholderSvg()}
}
async function gcdFallbackCover(request){
  const url=new URL(request.url),id=String(url.searchParams.get('id')||'').replace(/\D/g,'');if(!id)return placeholderSvg();
  try{
    const headers={'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1','Accept':'application/json,text/plain,*/*','Accept-Language':'en-US,en;q=0.9','Referer':`${GCD}/issue/${id}/`};
    const r=await fetch(`${GCD}/api/issue/${id}/`,{redirect:'follow',headers});if(!r.ok)throw new Error(`GCD ${r.status}`);const data=await r.json();let src=String(data?.cover||'').trim();if(src.startsWith('//'))src='https:'+src;src=src.replace(/^http:/i,'https:');if(!src)throw new Error('no-cover');
    const img=await fetch(src,{redirect:'follow',headers:{'User-Agent':headers['User-Agent'],'Accept':'image/avif,image/webp,image/apng,image/*,*/*;q=0.8','Referer':`${GCD}/issue/${id}/`}});if(!img.ok||!/^image\//i.test(img.headers.get('Content-Type')||''))throw new Error('bad-image');return new Response(img.body,{status:200,headers:{'Content-Type':img.headers.get('Content-Type')||'image/jpeg','Cache-Control':`public,max-age=${COVER_TTL}`}})
  }catch{return placeholderSvg()}
}
function errorPage(meta){const target=meta?.readerId?webReader(meta.readerId):(meta?.issueUrl||'https://www.marvel.com/unlimited');return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marvel Unlimited</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17181c}.box{width:min(88vw,430px);text-align:center}.logo{display:inline-block;background:#e62429;color:#fff;padding:5px 8px;font-weight:900;font-size:22px}a{display:block;margin-top:20px;padding:14px;border-radius:14px;background:#fff;color:#222;border:1px solid #ddd8cf;text-decoration:none;font-weight:800}p{color:#74747b;line-height:1.5}</style></head><body><div class="box"><span class="logo">MARVEL</span><h2>Enlace directo no disponible</h2><p>Se ha localizado la ficha cuando ha sido posible, pero no se ha obtenido el DRN necesario. No se redirige a otro cómic.</p><a href="${target}">Abrir en Marvel</a></div></body></html>`,{status:502,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})}

export default{async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/api/marvel/cover')return marvelCover(request);
  if(url.pathname==='/api/gcd/cover-image')return gcdFallbackCover(request);
  if(url.pathname==='/api/gcd/cover')return Response.json({id:Number(url.searchParams.get('id')||0),coverUrl:`/api/gcd/cover-image?id=${encodeURIComponent(url.searchParams.get('id')||'')}`,source:'gcd-fallback'},{headers:{'Cache-Control':'no-store'}});
  if(url.pathname==='/api/marvel/open'){
    const title=(url.searchParams.get('title')||'').trim(),issue=(url.searchParams.get('issue')||'').trim(),seriesYear=(url.searchParams.get('year')||'').trim(),date=(url.searchParams.get('date')||'').trim(),mode=(url.searchParams.get('mode')||'web').toLowerCase();if(!title)return new Response('Falta el título.',{status:400});
    let meta;try{meta=await resolveMeta(title,issue,seriesYear,date)}catch(e){meta={resolverVersion:RESOLVER_VERSION,resolverSource:'structured-year-index-error',available:false,reason:'resolver-error',issueUrl:'',sourceId:'',readerId:'',drn:'',smartLink:'',coverUrl:'',webUrl:'',error:String(e?.message||e)}}
    let diagnosticCode='LOOKUP_UNRESOLVED';if(meta.smartLink)diagnosticCode='OK';else if(meta.reason==='reader-unavailable')diagnosticCode='NOT_IN_UNLIMITED';else if(meta.readerId&&!meta.drn)diagnosticCode='DRN_MISSING';else if(meta.reason==='resolver-error')diagnosticCode='RESOLVER_ERROR';
    if(mode==='meta'||mode==='debug'||mode==='diagnostic')return Response.json({title,issue,year:seriesYear,date,...meta,diagnosticCode},{headers:{'Cache-Control':'private,no-store'}});
    if(mode==='app'||mode==='ios'||mode==='android'){if(meta.smartLink)return redirect(meta.smartLink);return errorPage(meta)}
    if(mode==='web'){if(meta.readerId&&meta.readerId!=='0')return redirect(webReader(meta.readerId));if(meta.issueUrl)return redirect(meta.issueUrl);return errorPage(meta)}
    return new Response('Modo no reconocido.',{status:400});
  }
  return env.ASSETS.fetch(request);
}};