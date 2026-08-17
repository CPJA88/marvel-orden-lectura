import legacyWorker from './worker-stability-v22.js';

const RESOLVER_VERSION=13;
const META_API='https://marvel.emreparker.com';
const LEGACY='https://share.marvel.com/sharing/legacy/';
const SMART='https://marvel.smart.link/fiir7ec77';
const DRN_TTL=60*60*24*90;
const DETAIL_TTL=60*60*24*90;

function redirect(location){return new Response(null,{status:302,headers:{Location:location,'Cache-Control':'private, no-store'}})}
function cacheReq(url){return new Request(url)}
async function cacheJson(key){const c=typeof caches!=='undefined'?caches.default:null;if(!c)return null;const r=await c.match(key);if(!r)return null;try{return await r.json()}catch{return null}}
async function cachePut(key,response){const c=typeof caches!=='undefined'?caches.default:null;if(!c)return;await c.put(key,response.clone()).catch(()=>{})}
function buildSmartLink(drn,sourceId){return drn&&sourceId?`${SMART}?type=issue&drn=${drn}&sourceId=${encodeURIComponent(String(sourceId))}`:''}
function webReader(readerId){return readerId?`https://read.marvel.com/#/book/${encodeURIComponent(String(readerId))}`:''}
function legacyShare(readerId){return readerId?`${LEGACY}${encodeURIComponent(String(readerId))}`:''}
function issuePage(sourceId){return sourceId?`https://www.marvel.com/comics/issue/${encodeURIComponent(String(sourceId))}`:''}
function cleanId(v){return String(v||'').replace(/\D/g,'')}
function htmlDecode(v=''){return String(v).replace(/\\u002F/gi,'/').replace(/\\u003A/gi,':').replace(/\\\//g,'/').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&#x27;/gi,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)))}
function decodeRepeated(v=''){let s=htmlDecode(v);for(let i=0;i<3;i++){try{const d=decodeURIComponent(s);if(d===s)break;s=d}catch{break}}return s}
function extractDrn(value=''){
  const text=decodeRepeated(value).replace(/%3A/gi,':');
  const direct=text.match(/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i)?.[0];if(direct)return direct;
  const q=text.match(/(?:[?&]|\b)drn=([^&"'<>\s]+)/i)?.[1]||'';
  if(q){const d=decodeRepeated(q);return d.match(/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i)?.[0]||''}
  return '';
}
function drnKey(readerId){return cacheReq(`https://marvel-structured-cache.invalid/drn-v22/${encodeURIComponent(String(readerId))}`)}
async function resolveDrn(readerId){
  if(!readerId||String(readerId)==='0')return '';
  const key=drnKey(readerId),cached=await cacheJson(key);if(cached?.drn)return cached.drn;
  const target=legacyShare(readerId),headers={'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1','Accept':'text/html,application/xhtml+xml,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9'};
  let drn='';
  try{
    const first=await fetch(target,{redirect:'manual',headers});
    drn=extractDrn(first.headers.get('Location')||'');
    if(!drn&&first.status>=200&&first.status<300)drn=extractDrn(await first.text());
  }catch{}
  if(!drn){
    try{const second=await fetch(target,{redirect:'follow',headers});drn=extractDrn(second.url);if(!drn)drn=extractDrn(await second.text())}catch{}
  }
  if(drn)await cachePut(key,Response.json({readerId:String(readerId),drn},{headers:{'Cache-Control':`public,max-age=${DRN_TTL}`}}));
  return drn;
}
function detailKey(sourceId){return cacheReq(`https://marvel-structured-cache.invalid/detail-v22/${encodeURIComponent(String(sourceId))}`)}
async function getIssueDetail(sourceId){
  const key=detailKey(sourceId),cached=await cacheJson(key);if(cached?.id)return cached;
  const r=await fetch(`${META_API}/v1/issues/${encodeURIComponent(sourceId)}`,{redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 (compatible; MarvelReadingGuide/1.2.23)','Accept':'application/json'}});
  if(!r.ok)throw new Error(`metadata HTTP ${r.status}`);
  const data=await r.json();
  await cachePut(key,Response.json(data,{headers:{'Cache-Control':`public,max-age=${DETAIL_TTL}`}}));
  return data;
}
async function fromPreinstalled(url){
  const sourceId=cleanId(url.searchParams.get('sourceId')),givenReader=cleanId(url.searchParams.get('readerId')),status=Number(url.searchParams.get('preinstalledStatus'));
  if(!sourceId&&status===0)return{resolverVersion:RESOLVER_VERSION,resolverSource:'preinstalled-cache',available:false,reason:'reader-unavailable',sourceId:'',readerId:'',drn:'',smartLink:'',issueUrl:'',webUrl:''};
  if(!sourceId)return null;
  let readerId=givenReader,detail=null,detailError='';
  if(!readerId){
    try{detail=await getIssueDetail(sourceId);readerId=cleanId(detail?.digitalId)}catch(e){detailError=String(e?.message||e)}
  }
  const issueUrl=String(detail?.detailUrl||issuePage(sourceId));
  let drn='';if(readerId){try{drn=await resolveDrn(readerId)}catch{}}
  const smartLink=buildSmartLink(drn,sourceId),available=status===1||Boolean(readerId);
  const reason=smartLink?'ok':available?'drn-unavailable':'reader-unavailable';
  return{resolverVersion:RESOLVER_VERSION,resolverSource:'preinstalled-cache',available,reason,sourceId,readerId,drn,smartLink,issueUrl,webUrl:webReader(readerId)||issueUrl,detailError};
}
function errorPage(meta){
  const target=meta?.readerId?webReader(meta.readerId):(meta?.issueUrl||'https://www.marvel.com/unlimited');
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marvel Unlimited</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17181c}.box{width:min(88vw,430px);text-align:center}.logo{display:inline-block;background:#e62429;color:#fff;padding:5px 8px;font-weight:900;font-size:22px}a{display:block;margin-top:20px;padding:14px;border-radius:14px;background:#fff;color:#222;border:1px solid #ddd8cf;text-decoration:none;font-weight:800}p{color:#74747b;line-height:1.5}</style></head><body><div class="box"><span class="logo">MARVEL</span><h2>Enlace directo no disponible</h2><p>No se ha podido obtener el DRN para este número. No se sustituye por otro cómic.</p><a href="${target}">Abrir en Marvel</a></div></body></html>`,{status:502,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}

export default{async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/api/marvel/open'&&(url.searchParams.has('sourceId')||url.searchParams.get('preinstalledStatus')==='0')){
    const mode=(url.searchParams.get('mode')||'web').toLowerCase();
    let meta;try{meta=await fromPreinstalled(url)}catch(e){meta={resolverVersion:RESOLVER_VERSION,resolverSource:'preinstalled-cache-error',available:false,reason:'resolver-error',sourceId:cleanId(url.searchParams.get('sourceId')),readerId:cleanId(url.searchParams.get('readerId')),drn:'',smartLink:'',issueUrl:issuePage(cleanId(url.searchParams.get('sourceId'))),webUrl:'',error:String(e?.message||e)}}
    if(meta){
      let diagnosticCode='LOOKUP_UNRESOLVED';if(meta.smartLink)diagnosticCode='OK';else if(meta.reason==='reader-unavailable')diagnosticCode='NOT_IN_UNLIMITED';else if(meta.readerId&&!meta.drn)diagnosticCode='DRN_MISSING';else if(meta.reason==='resolver-error')diagnosticCode='RESOLVER_ERROR';
      if(mode==='meta'||mode==='debug'||mode==='diagnostic')return Response.json({...meta,diagnosticCode},{headers:{'Cache-Control':'private,no-store'}});
      if(mode==='app'||mode==='ios'||mode==='android'){if(meta.smartLink)return redirect(meta.smartLink);return errorPage(meta)}
      if(mode==='web'){if(meta.readerId)return redirect(webReader(meta.readerId));if(meta.issueUrl)return redirect(meta.issueUrl);return errorPage(meta)}
    }
  }
  return legacyWorker.fetch(request,env);
}};
