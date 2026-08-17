import baseWorker from './worker-stability-v22.js';

const RESOLVER_VERSION=13;
const SMART='https://marvel.smart.link/fiir7ec77';
const LEGACY='https://share.marvel.com/sharing/legacy/';
const DRN_TTL=60*60*24*90;

function smartLink(drn,sourceId){return drn&&sourceId?`${SMART}?type=issue&drn=${drn}&sourceId=${encodeURIComponent(String(sourceId))}`:''}
function webReader(readerId){return readerId?`https://read.marvel.com/#/book/${encodeURIComponent(String(readerId))}`:''}
function redirect(location){return new Response(null,{status:302,headers:{Location:location,'Cache-Control':'private,no-store'}})}
function cacheKey(readerId){return new Request(`https://marvel-preinstalled-cache.invalid/drn-v24/${encodeURIComponent(String(readerId))}`)}
async function cachedDrn(readerId){
  const c=typeof caches!=='undefined'?caches.default:null;if(!c)return '';
  const hit=await c.match(cacheKey(readerId));if(!hit)return '';
  try{return (await hit.json())?.drn||''}catch{return ''}
}
async function storeDrn(readerId,drn){
  const c=typeof caches!=='undefined'?caches.default:null;if(!c||!drn)return;
  await c.put(cacheKey(readerId),Response.json({readerId:String(readerId),drn},{headers:{'Cache-Control':`public,max-age=${DRN_TTL}`}})).catch(()=>{});
}
function decode(v=''){
  let s=String(v).replace(/&amp;/g,'&').replace(/\\u003A/gi,':').replace(/\\u002F/gi,'/');
  for(let i=0;i<3;i++){try{const d=decodeURIComponent(s);if(d===s)break;s=d}catch{break}}return s;
}
function extractDrn(v=''){return decode(v).replace(/%3A/gi,':').match(/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i)?.[0]||''}
async function resolveDrn(readerId){
  if(!readerId||String(readerId)==='0')return '';
  const old=await cachedDrn(readerId);if(old)return old;
  const target=LEGACY+encodeURIComponent(String(readerId)),headers={'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1','Accept':'text/html,application/xhtml+xml,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9'};
  let drn='';
  try{
    const r=await fetch(target,{redirect:'manual',headers});drn=extractDrn(r.headers.get('Location')||'');
    if(!drn&&r.status>=200&&r.status<300)drn=extractDrn(await r.text());
  }catch{}
  if(!drn){
    try{const r=await fetch(target,{redirect:'follow',headers});drn=extractDrn(r.url)||extractDrn(await r.text())}catch{}
  }
  if(drn)await storeDrn(readerId,drn);return drn;
}
function errorPage(readerId){
  const target=readerId?webReader(readerId):'https://www.marvel.com/unlimited';
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marvel Unlimited</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17181c}.box{width:min(88vw,430px);text-align:center}.logo{display:inline-block;background:#e62429;color:#fff;padding:5px 8px;font-weight:900;font-size:22px}a{display:block;margin-top:20px;padding:14px;border-radius:14px;background:#fff;color:#222;border:1px solid #ddd8cf;text-decoration:none;font-weight:800}p{color:#74747b;line-height:1.5}</style></head><body><div class="box"><span class="logo">MARVEL</span><h2>Enlace directo pendiente</h2><p>El cómic está identificado, pero no se ha obtenido todavía el DRN del Smart Link. No se sustituye por otro número.</p><a href="${target}">Abrir en Marvel</a></div></body></html>`,{status:502,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})
}

async function fromPreinstalled(url){
  const sourceId=String(url.searchParams.get('sourceId')||'').replace(/\D/g,''),readerId=String(url.searchParams.get('readerId')||'').replace(/\D/g,''),status=Number(url.searchParams.get('preinstalledStatus')),mode=(url.searchParams.get('mode')||'web').toLowerCase();
  if(!sourceId&&!readerId&&url.searchParams.get('preinstalledStatus')===null)return null;
  if(status===3&&!readerId){
    const meta={resolverVersion:RESOLVER_VERSION,resolverSource:'preinstalled-cache',available:false,reason:'reader-unavailable',sourceId,readerId:'',drn:'',smartLink:'',coverUrl:sourceId?`/api/marvel/cover?sourceId=${sourceId}`:'',webUrl:'',diagnosticCode:'NOT_IN_UNLIMITED'};
    if(['meta','debug','diagnostic'].includes(mode))return Response.json(meta,{headers:{'Cache-Control':'private,no-store'}});
    return errorPage('');
  }
  if(!sourceId||!readerId)return null;
  let drn=String(url.searchParams.get('drn')||'').trim();if(!drn)drn=await resolveDrn(readerId);
  const link=smartLink(drn,sourceId),meta={resolverVersion:RESOLVER_VERSION,resolverSource:'preinstalled-cache',available:Boolean(link),reason:link?'ok':'drn-unavailable',sourceId,readerId,drn,smartLink:link,coverUrl:`/api/marvel/cover?sourceId=${sourceId}`,webUrl:webReader(readerId),diagnosticCode:link?'OK':'DRN_MISSING'};
  if(['meta','debug','diagnostic'].includes(mode))return Response.json(meta,{headers:{'Cache-Control':'private,no-store'}});
  if(mode==='web')return redirect(webReader(readerId));
  if(['app','ios','android'].includes(mode))return link?redirect(link):errorPage(readerId);
  return null;
}

export default{async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname==='/api/marvel/open'){
    const response=await fromPreinstalled(url);if(response)return response;
  }
  return baseWorker.fetch(request,env,ctx);
}};
