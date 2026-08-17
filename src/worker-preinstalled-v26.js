import baseWorker from './worker-preinstalled-v24.js';

const MARMOTA='https://marmota.me';
const TTL=60*60*24*30;

function redirect(location){return new Response(null,{status:302,headers:{Location:location,'Cache-Control':'private,no-store'}})}
function normalize(v=''){
  return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
}
function slug(v=''){
  return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[’']/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}
function htmlDecode(v=''){
  return String(v).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)||32));
}
function cacheKey(title,year){return new Request(`https://marmota-cache.invalid/series-v1?title=${encodeURIComponent(title)}&year=${encodeURIComponent(year)}`)}
async function readCache(key){const c=typeof caches!=='undefined'?caches.default:null;if(!c)return'';const r=await c.match(key);if(!r)return'';try{return (await r.json())?.url||''}catch{return''}}
async function writeCache(key,url){const c=typeof caches!=='undefined'?caches.default:null;if(!c||!url)return;await c.put(key,Response.json({url},{headers:{'Cache-Control':`public,max-age=${TTL}`}})).catch(()=>{})}
async function probe(url){
  try{const r=await fetch(url,{redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 (compatible; MarvelOrdenLectura/1.2.26)','Accept':'text/html,application/xhtml+xml,*/*;q=0.8','Accept-Language':'es-ES,es;q=0.9,en;q=0.7'}});return r.ok?r:null}catch{return null}
}
function titleFromHtml(html=''){
  const raw=String(html).match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'';
  return htmlDecode(raw.replace(/<[^>]+>/g,' ')).replace(/\s*-\s*Marmota Comics\s*$/i,'').trim();
}
function identityMatches(expected,year,found){
  const a=normalize(expected),b=normalize(found);if(!a||!b)return false;
  const titleOk=a===b||b.startsWith(a+' ')||a.startsWith(b+' ');
  if(!titleOk)return false;
  if(!year)return true;
  const fy=String(found).match(/\b(19|20)\d{2}\b/)?.[0]||'';
  return !fy||fy===String(year);
}
function candidateUrls(title,year){
  const base=slug(title),withoutThe=base.replace(/^the-/,'');
  const out=[];
  if(base&&year)out.push(`${MARMOTA}/comic/${base}-${year}/`);
  if(base)out.push(`${MARMOTA}/comic/${base}/`);
  if(withoutThe!==base&&year)out.push(`${MARMOTA}/comic/${withoutThe}-${year}/`);
  if(withoutThe!==base)out.push(`${MARMOTA}/comic/${withoutThe}/`);
  return [...new Set(out)];
}
async function resolveMarmota(title,year){
  const key=cacheKey(title,year),cached=await readCache(key);if(cached)return cached;
  for(const url of candidateUrls(title,year)){
    const r=await probe(url);if(!r)continue;
    const html=await r.text();if(identityMatches(title,year,titleFromHtml(html))){await writeCache(key,r.url||url);return r.url||url}
  }
  return `${MARMOTA}/?s=${encodeURIComponent([title,year].filter(Boolean).join(' '))}&post_type=wp-manga`;
}

export default{async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname==='/api/marmota/open'){
    const title=String(url.searchParams.get('title')||'').trim(),year=String(url.searchParams.get('year')||'').replace(/\D/g,'').slice(0,4);
    if(!title)return redirect(MARMOTA);
    return redirect(await resolveMarmota(title,year));
  }
  return baseWorker.fetch(request,env,ctx);
}};
