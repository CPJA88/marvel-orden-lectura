import stableWorker from './worker-stable.js';

const RESOLVER_VERSION=11;
const GCD='https://www.comics.org';
const GCD_TTL=60*60*24*30;

function redirect(location){
  return new Response(null,{status:302,headers:{Location:location,'Cache-Control':'private, no-store'}});
}
function cacheReq(url){return new Request(url)}
async function cacheJson(key){
  const c=typeof caches!=='undefined'?caches.default:null;if(!c)return null;
  const r=await c.match(key);if(!r)return null;
  try{return await r.json()}catch{return null}
}
async function cachePut(key,response){
  const c=typeof caches!=='undefined'?caches.default:null;if(!c)return;
  await c.put(key,response.clone()).catch(()=>{});
}
function positive(v){return Boolean(v?.smartLink&&v?.issueUrl)}

function addParams(base,title,issue,year){
  base.searchParams.set('title',title);base.searchParams.set('issue',issue);base.searchParams.set('year',year);return base;
}
function legacyPositiveKeys(title,issue,year){
  const keys=[];
  // Resolver estable original que el usuario comprobó abriendo la app correctamente.
  {
    const u=new URL('https://marvel-meta-cache.invalid/item');
    u.searchParams.set('resolver','5');u.searchParams.set('kind','app-stable');
    addParams(u,title,issue,year);keys.push(cacheReq(u.toString()));
  }
  // Cachés de los resolvers unificados/catalogados usados durante las últimas versiones.
  for(const rev of [6,7]){
    const u=addParams(new URL(`https://marvel-meta-cache.invalid/v${rev}`),title,issue,year);
    keys.push(cacheReq(u.toString()));
  }
  for(const rev of [7,8,9,10,11,12,13,14,15,16]){
    const u=addParams(new URL(`https://marvel-meta-cache.invalid/meta-v${rev}`),title,issue,year);
    keys.push(cacheReq(u.toString()));
  }
  for(const rev of [16]){
    const u=addParams(new URL(`https://marvel-neighbor-cache.invalid/meta-v${rev}`),title,issue,year);
    keys.push(cacheReq(u.toString()));
  }
  return keys;
}
async function recoverPositive(title,issue,year){
  for(const key of legacyPositiveKeys(title,issue,year)){
    const hit=await cacheJson(key);
    if(positive(hit))return {...hit,resolverVersion:RESOLVER_VERSION,resolverSource:'recovered-positive-cache',reason:'ok',available:true};
  }
  return null;
}

function cleanGcdId(value){return String(value||'').replace(/\D/g,'')}
function normalizeImageUrl(value=''){
  let u=String(value||'').trim();if(u.startsWith('//'))u='https:'+u;
  u=u.replace('https://files1.comics.org//','https://files1.comics.org/');
  return /^https?:\/\//i.test(u)?u:'';
}
async function gcdSourceCover(id){
  const clean=cleanGcdId(id);if(!clean)throw new Error('missing-gcd-id');
  const key=cacheReq(`https://gcd-cover-meta.invalid/v2?id=${clean}`),cached=await cacheJson(key);
  if(cached?.sourceCoverUrl)return cached.sourceCoverUrl;
  const r=await fetch(`${GCD}/api/issue/${clean}/`,{headers:{Accept:'application/json','User-Agent':'MarvelReadingGuide/1.2.20'}});
  if(!r.ok)throw new Error(`GCD API HTTP ${r.status}`);
  const data=await r.json(),sourceCoverUrl=normalizeImageUrl(data?.cover||'');
  if(!sourceCoverUrl)throw new Error('gcd-cover-missing');
  const out=Response.json({sourceCoverUrl},{headers:{'Cache-Control':`public,max-age=${GCD_TTL}`}});
  await cachePut(key,out);return sourceCoverUrl;
}
async function gcdCoverMeta(request){
  const url=new URL(request.url),id=cleanGcdId(url.searchParams.get('id'));
  if(!id)return Response.json({error:'missing-gcd-id'},{status:400});
  try{
    const sourceCoverUrl=await gcdSourceCover(id);
    return Response.json({id:Number(id),coverUrl:`/api/gcd/cover-image?id=${encodeURIComponent(id)}`,sourceCoverUrl,source:'gcd-proxy'},{headers:{'Cache-Control':`public,max-age=${GCD_TTL}`}});
  }catch(e){
    return Response.json({id:Number(id),coverUrl:'',sourceCoverUrl:'',source:'gcd-proxy',error:String(e?.message||e)},{status:404,headers:{'Cache-Control':'public,max-age=3600'}});
  }
}
function placeholderSvg(){
  const body='<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600"><rect width="400" height="600" rx="24" fill="#f0ede6"/><rect x="128" y="220" width="144" height="160" rx="16" fill="#e62429"/><text x="200" y="323" text-anchor="middle" font-family="Arial,sans-serif" font-size="92" font-weight="700" fill="white">M</text></svg>';
  return new Response(body,{status:200,headers:{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'public,max-age=3600'}});
}
async function gcdCoverImage(request){
  const url=new URL(request.url),id=cleanGcdId(url.searchParams.get('id'));
  if(!id)return placeholderSvg();
  const browserKey=new Request(url.origin+url.pathname+'?id='+encodeURIComponent(id));
  const c=typeof caches!=='undefined'?caches.default:null;
  if(c){const hit=await c.match(browserKey);if(hit)return hit}
  try{
    const source=await gcdSourceCover(id);
    const upstream=await fetch(source,{redirect:'follow',headers:{
      'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
      'Accept':'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Referer':`${GCD}/issue/${id}/`
    }});
    if(!upstream.ok)throw new Error(`GCD image HTTP ${upstream.status}`);
    const type=upstream.headers.get('Content-Type')||'image/jpeg';
    if(!/^image\//i.test(type))throw new Error(`GCD invalid content-type ${type}`);
    const headers=new Headers({'Content-Type':type,'Cache-Control':`public,max-age=${GCD_TTL},immutable`});
    const etag=upstream.headers.get('ETag');if(etag)headers.set('ETag',etag);
    const response=new Response(upstream.body,{status:200,headers});
    if(c)await c.put(browserKey,response.clone()).catch(()=>{});
    return response;
  }catch(e){
    console.error('GCD cover proxy',id,e);return placeholderSvg();
  }
}

function unknown(title,issue,year){
  return Response.json({title,issue,year,resolverVersion:RESOLVER_VERSION,resolverSource:'stable-no-background-lookup',available:false,issueUrl:'',sourceId:'',readerId:'',drn:'',smartLink:'',coverUrl:'',pageTitle:'',reason:'not-verified',diagnosticCode:'LOOKUP_UNRESOLVED'},{headers:{'Cache-Control':'private,no-store'}});
}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/api/gcd/cover')return gcdCoverMeta(request);
    if(url.pathname==='/api/gcd/cover-image')return gcdCoverImage(request);

    if(url.pathname==='/api/marvel/open'){
      const title=(url.searchParams.get('title')||'').trim(),issue=(url.searchParams.get('issue')||'').trim(),year=(url.searchParams.get('year')||'').trim();
      const mode=(url.searchParams.get('mode')||'web').toLowerCase();
      if(title){
        const recovered=await recoverPositive(title,issue,year);
        if(recovered){
          if(mode==='app'||mode==='ios'||mode==='android')return redirect(recovered.smartLink);
          if(mode==='meta'||mode==='debug'||mode==='diagnostic')return Response.json({title,issue,year,...recovered,diagnosticCode:'OK'},{headers:{'Cache-Control':'private,no-store'}});
        }
      }
      // Nunca hacemos descubrimiento masivo en segundo plano. En un toque explícito
      // conservamos el resolver interactivo original como último recurso.
      if(mode==='app'||mode==='ios'||mode==='android'||mode==='web')return stableWorker.fetch(request,env,ctx);
      if(mode==='meta'||mode==='debug'||mode==='diagnostic')return unknown(title,issue,year);
    }
    return env.ASSETS.fetch(request);
  }
};
