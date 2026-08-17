const RESOLVER_VERSION=12;
const GCD='https://www.comics.org';
const GEOFF='https://marvel.geoffrich.net';
const LEGACY='https://share.marvel.com/sharing/legacy/';
const SMART='https://marvel.smart.link/fiir7ec77';
const GCD_TTL=60*60*24*30;
const YEAR_TTL=60*60*24*30;
const META_TTL=60*60*24*90;
const DRN_TTL=60*60*24*90;

function redirect(location){return new Response(null,{status:302,headers:{Location:location,'Cache-Control':'private, no-store'}})}
function cacheReq(url){return new Request(url)}
async function cacheJson(key){const c=typeof caches!=='undefined'?caches.default:null;if(!c)return null;const r=await c.match(key);if(!r)return null;try{return await r.json()}catch{return null}}
async function cachePut(key,response){const c=typeof caches!=='undefined'?caches.default:null;if(!c)return;await c.put(key,response.clone()).catch(()=>{})}
function htmlDecode(v=''){return String(v).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&#x27;/gi,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/\s+/g,' ').trim()}
function stripTags(v=''){return htmlDecode(String(v).replace(/<[^>]*>/g,' '))}
function normalize(v=''){return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim()}
function normalizeSeries(v=''){return normalize(String(v).replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|present))?\s*\)/gi,' ')).replace(/^the\s+/,'').replace(/\s+comics$/,'').trim()}
function normalizeIssue(v=''){let s=String(v||'').trim().toUpperCase().replace(/\s+/g,'');if(/^0+\d+$/.test(s))s=String(Number(s));return s}
function tokenScore(a,b){const A=new Set(normalizeSeries(a).split(' ').filter(Boolean)),B=new Set(normalizeSeries(b).split(' ').filter(Boolean));if(!A.size||!B.size)return 0;let n=0;for(const t of A)if(B.has(t))n++;return n/Math.max(A.size,B.size)}
function buildSmartLink(drn,sourceId){if(!drn||!sourceId)return '';const u=new URL(SMART);u.searchParams.set('type','issue');u.searchParams.set('drn',drn);u.searchParams.set('sourceId',String(sourceId));return u.toString()}
function legacyShare(readerId){return readerId?`${LEGACY}${encodeURIComponent(readerId)}`:''}
function webReader(readerId){return readerId?`https://read.marvel.com/#/book/${encodeURIComponent(readerId)}`:''}

function addParams(base,title,issue,year){base.searchParams.set('title',title);base.searchParams.set('issue',issue);base.searchParams.set('year',year);return base}
function legacyPositiveKeys(title,issue,year){
  const keys=[];
  const stable=new URL('https://marvel-meta-cache.invalid/item');stable.searchParams.set('resolver','5');stable.searchParams.set('kind','app-stable');addParams(stable,title,issue,year);keys.push(cacheReq(stable.toString()));
  for(const rev of [6,7])keys.push(cacheReq(addParams(new URL(`https://marvel-meta-cache.invalid/v${rev}`),title,issue,year).toString()));
  for(const rev of [7,8,9,10,11,12,13,14,15,16,17])keys.push(cacheReq(addParams(new URL(`https://marvel-meta-cache.invalid/meta-v${rev}`),title,issue,year).toString()));
  keys.push(cacheReq(addParams(new URL('https://marvel-neighbor-cache.invalid/meta-v16'),title,issue,year).toString()));
  return keys;
}
async function recoverPositive(title,issue,seriesYear){
  for(const key of legacyPositiveKeys(title,issue,seriesYear)){
    const hit=await cacheJson(key);if(!hit)continue;
    let smartLink=hit.smartLink||'';
    if(!smartLink&&hit.drn&&hit.sourceId)smartLink=buildSmartLink(hit.drn,hit.sourceId);
    if(!smartLink&&hit.readerId&&hit.sourceId){const drn=await resolveDrn(String(hit.readerId)).catch(()=> '');if(drn)smartLink=buildSmartLink(drn,hit.sourceId)}
    if(smartLink)return {...hit,smartLink,available:true,reason:'ok',resolverVersion:RESOLVER_VERSION,resolverSource:'recovered-positive-cache'};
  }
  return null;
}

function cleanGcdId(value){return String(value||'').replace(/\D/g,'')}
function normalizeImageUrl(value=''){let u=String(value||'').trim();if(u.startsWith('//'))u='https:'+u;u=u.replace('https://files1.comics.org//','https://files1.comics.org/');return /^https?:\/\//i.test(u)?u:''}
async function gcdSourceCover(id){
  const clean=cleanGcdId(id);if(!clean)throw new Error('missing-gcd-id');
  const key=cacheReq(`https://gcd-cover-meta.invalid/v3?id=${clean}`),cached=await cacheJson(key);if(cached?.sourceCoverUrl)return cached.sourceCoverUrl;
  const r=await fetch(`${GCD}/api/issue/${clean}/`,{headers:{Accept:'application/json','User-Agent':'MarvelReadingGuide/1.2.21'}});if(!r.ok)throw new Error(`GCD API HTTP ${r.status}`);
  const data=await r.json(),sourceCoverUrl=normalizeImageUrl(data?.cover||'');if(!sourceCoverUrl)throw new Error('gcd-cover-missing');
  const out=Response.json({sourceCoverUrl},{headers:{'Cache-Control':`public,max-age=${GCD_TTL}`}});await cachePut(key,out);return sourceCoverUrl;
}
async function gcdCoverMeta(request){
  const url=new URL(request.url),id=cleanGcdId(url.searchParams.get('id'));if(!id)return Response.json({error:'missing-gcd-id'},{status:400});
  try{const sourceCoverUrl=await gcdSourceCover(id);return Response.json({id:Number(id),coverUrl:`/api/gcd/cover-image?id=${id}`,sourceCoverUrl,source:'gcd-proxy'},{headers:{'Cache-Control':`public,max-age=${GCD_TTL}`}})}
  catch(e){return Response.json({id:Number(id),coverUrl:'',sourceCoverUrl:'',source:'gcd-proxy',error:String(e?.message||e)},{status:404,headers:{'Cache-Control':'public,max-age=3600'}})}
}
function placeholderSvg(){const body='<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600"><rect width="400" height="600" rx="24" fill="#f0ede6"/><rect x="128" y="220" width="144" height="160" rx="16" fill="#e62429"/><text x="200" y="323" text-anchor="middle" font-family="Arial,sans-serif" font-size="92" font-weight="700" fill="white">M</text></svg>';return new Response(body,{status:200,headers:{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'public,max-age=3600'}})}
async function gcdCoverImage(request){
  const url=new URL(request.url),id=cleanGcdId(url.searchParams.get('id'));if(!id)return placeholderSvg();
  const browserKey=new Request(url.origin+url.pathname+'?id='+id),c=typeof caches!=='undefined'?caches.default:null;if(c){const hit=await c.match(browserKey);if(hit)return hit}
  try{
    const source=await gcdSourceCover(id),upstream=await fetch(source,{redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1','Accept':'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8','Referer':`${GCD}/issue/${id}/`}});
    if(!upstream.ok)throw new Error(`GCD image HTTP ${upstream.status}`);const type=upstream.headers.get('Content-Type')||'image/jpeg';if(!/^image\//i.test(type))throw new Error(`GCD invalid content-type ${type}`);
    const response=new Response(upstream.body,{status:200,headers:{'Content-Type':type,'Cache-Control':`public,max-age=${GCD_TTL},immutable`}});if(c)await c.put(browserKey,response.clone()).catch(()=>{});return response;
  }catch(e){console.error('GCD cover proxy',id,e);return placeholderSvg()}
}

function parseComicTitle(title=''){
  const clean=stripTags(title);
  let m=clean.match(/^(.*?)\s*\((\d{4})(?:\s*-\s*(?:\d{4}|Present))?\)\s*#\s*(.+?)\s*$/i);
  if(m)return{series:m[1].trim(),seriesYear:m[2],issue:normalizeIssue(m[3]),title:clean};
  m=clean.match(/^(.*?)\s*#\s*(.+?)\s*$/);return m?{series:m[1].trim(),seriesYear:'',issue:normalizeIssue(m[2]),title:clean}:{series:clean,seriesYear:'',issue:'',title:clean};
}
function parseYearHtml(html,year){
  const reads=[];const readRe=/href=["']https:\/\/read\.marvel\.com\/#\/book\/(\d+)["']/gi;let m;
  while((m=readRe.exec(html)))reads.push({readerId:m[1],index:m.index});
  const out=[];
  for(let i=0;i<reads.length;i++){
    const start=reads[i].index,end=i+1<reads.length?reads[i+1].index:Math.min(html.length,start+20000),seg=html.slice(start,end);
    const detail=seg.match(/href=["'](https:\/\/(?:www\.)?marvel\.com\/comics\/issue\/(\d+)(?:\/[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/i);if(!detail)continue;
    const parsed=parseComicTitle(detail[3]);
    out.push({readerId:reads[i].readerId,sourceId:detail[2],issueUrl:htmlDecode(detail[1]),title:parsed.title,series:parsed.series,seriesYear:parsed.seriesYear,issue:parsed.issue,releaseYear:String(year)});
  }
  return out;
}
async function getYearIndex(year){
  const y=String(year||'').match(/^(19|20)\d{2}$/)?.[0];if(!y)throw new Error('invalid-release-year');
  const key=cacheReq(`https://marvel-geoffrich-cache.invalid/year-v2/${y}`),cached=await cacheJson(key);if(Array.isArray(cached?.items)&&cached.items.length)return cached.items;
  const r=await fetch(`${GEOFF}/year/${y}`,{headers:{'User-Agent':'Mozilla/5.0 (compatible; MarvelReadingGuide/1.2.21)','Accept':'text/html,application/xhtml+xml'}});if(!r.ok)throw new Error(`geoffrich HTTP ${r.status}`);
  const html=await r.text(),items=parseYearHtml(html,y);if(!items.length)throw new Error('geoffrich-year-parse-empty');
  const out=Response.json({year:y,items},{headers:{'Cache-Control':`public,max-age=${YEAR_TTL}`}});await cachePut(key,out);return items;
}
function releaseYearFrom(date,seriesYear){const m=String(date||'').match(/\b((?:19|20)\d{2})\b/);return m?.[1]||String(seriesYear||'')}
function matchCandidate(items,title,issue,seriesYear){
  const wantIssue=normalizeIssue(issue),wantSeries=normalizeSeries(title),wantYear=String(seriesYear||''),cands=items.filter(x=>x.issue===wantIssue);if(!cands.length)return null;
  const ranked=cands.map(x=>{const exact=normalizeSeries(x.series)===wantSeries?1:0,year=x.seriesYear&&wantYear&&x.seriesYear===wantYear?1:0,score=tokenScore(title,x.series);return{x,rank:exact*100+year*20+score*10}}).sort((a,b)=>b.rank-a.rank);
  const best=ranked[0];if(!best)return null;
  const acceptable=normalizeSeries(best.x.series)===wantSeries||(best.x.seriesYear===wantYear&&tokenScore(title,best.x.series)>=0.66);return acceptable?best.x:null;
}
async function locateViaGeoffrich(title,issue,seriesYear,date){
  const base=Number(releaseYearFrom(date,seriesYear));if(!base)return{match:null,attempts:[],error:'missing-release-year'};
  const years=[base,base-1,base+1].filter((v,i,a)=>v>=1939&&v<=2026&&a.indexOf(v)===i),attempts=[];
  for(const year of years){
    try{const items=await getYearIndex(year),match=matchCandidate(items,title,issue,seriesYear);attempts.push({year,count:items.length,matched:Boolean(match)});if(match)return{match,attempts,error:''}}
    catch(e){attempts.push({year,count:0,matched:false,error:String(e?.message||e)})}
  }
  return{match:null,attempts,error:'no-exact-match'};
}
async function resolveDrn(readerId){
  if(!readerId||readerId==='0')return '';
  const key=cacheReq(`https://marvel-drn-cache.invalid/v2/${encodeURIComponent(readerId)}`),cached=await cacheJson(key);if(cached?.drn)return cached.drn;
  const r=await fetch(legacyShare(readerId),{headers:{'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1','Accept':'text/html,application/xhtml+xml,*/*;q=0.8'}});if(!r.ok)throw new Error(`share.marvel.com HTTP ${r.status}`);
  const html=htmlDecode(await r.text()).replace(/%3A/gi,':');let drn=html.match(/(?:[?&]|\b)drn=([^&"'<>\s]+)/i)?.[1]||'';if(drn){try{drn=decodeURIComponent(drn)}catch{}}
  if(!drn)drn=html.match(/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i)?.[0]||'';
  if(drn){const out=Response.json({readerId,drn},{headers:{'Cache-Control':`public,max-age=${DRN_TTL}`}});await cachePut(key,out)}return drn;
}
function metaKey(title,issue,seriesYear,date){const u=new URL('https://marvel-geoffrich-cache.invalid/meta-v21');u.searchParams.set('title',title);u.searchParams.set('issue',issue);u.searchParams.set('seriesYear',seriesYear);u.searchParams.set('date',date);return cacheReq(u.toString())}
async function resolveMeta(title,issue,seriesYear,date){
  const key=metaKey(title,issue,seriesYear,date),cached=await cacheJson(key);if(cached?.smartLink)return cached;
  const legacy=await recoverPositive(title,issue,seriesYear);if(legacy){await cachePut(key,Response.json(legacy,{headers:{'Cache-Control':`public,max-age=${META_TTL}`}}));return legacy}
  const located=await locateViaGeoffrich(title,issue,seriesYear,date);if(!located.match)return{resolverVersion:RESOLVER_VERSION,resolverSource:'geoffrich-year-index',available:false,reason:'not-verified',issueUrl:'',sourceId:'',readerId:'',drn:'',smartLink:'',webUrl:'',geoffrichAttempts:located.attempts,error:located.error};
  const x=located.match;let drn='',drnError='';try{drn=await resolveDrn(x.readerId)}catch(e){drnError=String(e?.message||e)}
  const smartLink=buildSmartLink(drn,x.sourceId),data={resolverVersion:RESOLVER_VERSION,resolverSource:'geoffrich-year-index',available:Boolean(smartLink),reason:smartLink?'ok':(x.readerId&&x.readerId!=='0'?'reader-link-found':'not-verified'),issueUrl:x.issueUrl,sourceId:x.sourceId,readerId:x.readerId,drn,smartLink,webUrl:webReader(x.readerId)||x.issueUrl,pageTitle:x.title,coverUrl:'',geoffrichAttempts:located.attempts,drnError};
  if(smartLink)await cachePut(key,Response.json(data,{headers:{'Cache-Control':`public,max-age=${META_TTL}`}}));return data;
}
function errorPage(meta){
  const target=meta?.readerId?legacyShare(meta.readerId):(meta?.issueUrl||'https://www.marvel.com/unlimited'),label=meta?.readerId?'Abrir enlace alternativo de Marvel':'Abrir Marvel Unlimited';
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marvel Unlimited</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17181c}.box{width:min(88vw,430px);text-align:center}.logo{display:inline-block;background:#e62429;color:#fff;padding:5px 8px;font-weight:900;font-size:22px}a{display:block;margin-top:20px;padding:14px;border-radius:14px;background:#fff;color:#222;border:1px solid #ddd8cf;text-decoration:none;font-weight:800}p{color:#74747b;line-height:1.5}</style></head><body><div class="box"><span class="logo">MARVEL</span><h2>Enlace directo no disponible</h2><p>No he podido construir el Smart Link automático. No se ha sustituido por otro cómic.</p><a href="${target}">${label}</a></div></body></html>`,{status:502,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})
}

export default{async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname==='/api/gcd/cover')return gcdCoverMeta(request);
  if(url.pathname==='/api/gcd/cover-image')return gcdCoverImage(request);
  if(url.pathname==='/api/marvel/open'){
    const title=(url.searchParams.get('title')||'').trim(),issue=(url.searchParams.get('issue')||'').trim(),seriesYear=(url.searchParams.get('year')||'').trim(),date=(url.searchParams.get('date')||'').trim(),mode=(url.searchParams.get('mode')||'web').toLowerCase();if(!title)return new Response('Falta el título.',{status:400});
    const meta=await resolveMeta(title,issue,seriesYear,date);
    if(mode==='meta'||mode==='debug'||mode==='diagnostic')return Response.json({title,issue,year:seriesYear,date,...meta,diagnosticCode:meta.smartLink?'OK':'LOOKUP_UNRESOLVED'},{headers:{'Cache-Control':'private,no-store'}});
    if(mode==='app'||mode==='ios'||mode==='android'){
      if(meta.smartLink)return redirect(meta.smartLink);
      if(meta.readerId&&meta.readerId!=='0')return redirect(legacyShare(meta.readerId));
      return errorPage(meta);
    }
    if(mode==='web'){
      if(meta.readerId&&meta.readerId!=='0')return redirect(webReader(meta.readerId));
      if(meta.issueUrl)return redirect(meta.issueUrl);
      return errorPage(meta);
    }
    return new Response('Modo no reconocido.',{status:400});
  }
  return env.ASSETS.fetch(request);
}};
