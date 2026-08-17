const GOOGLE_ORIGIN='https://www.google.com';
const MARVEL_ORIGIN='https://www.marvel.com';
const MARVEL_SMART_LINK='https://marvel.smart.link/fiir7ec77';
const MARVEL_LEGACY_SHARE='https://share.marvel.com/sharing/legacy/';
const META_TTL=60*60*24*30;
const RESOLVER_VERSION=4;
const STOP_WORDS=new Set(['the','and','marvel','comic','comics']);

function unescapeHtml(value=''){return String(value).replace(/\\u002F/gi,'/').replace(/\\u003A/gi,':').replace(/\\\//g,'/').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#58;/g,':')}
function normalizeText(value=''){return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim()}
function significantTitleTokens(value=''){return normalizeText(value).split(/\s+/).filter(t=>t.length>1&&!STOP_WORDS.has(t))}
function exactGoogleQuery(title,issue,year){return `site:marvel.com/comics/issue/ "${title}" "${issue?`#${issue}`:''}" ${year} Marvel Unlimited`}
function luckyUrl(title,issue,year){return `${GOOGLE_ORIGIN}/search?btnI=1&q=${encodeURIComponent(exactGoogleQuery(title,issue,year))}`}
function normalGoogleUrl(title,issue,year){return `${GOOGLE_ORIGIN}/search?q=${encodeURIComponent(exactGoogleQuery(title,issue,year))}`}
function marvelSearchUrl(title,issue,year){return `${MARVEL_ORIGIN}/search?content_type=comics&query=${encodeURIComponent([title,issue,year].filter(Boolean).join(' '))}`}
function isMarvelIssueUrl(value=''){try{const u=new URL(value,MARVEL_ORIGIN);return /(^|\.)marvel\.com$/i.test(u.hostname)&&/^\/comics\/issue\/\d+(?:\/|$)/i.test(u.pathname)}catch{return false}}
function cleanMarvelIssueUrl(value=''){try{const u=new URL(value,MARVEL_ORIGIN);if(!isMarvelIssueUrl(u.href))return '';const m=u.pathname.match(/^\/comics\/issue\/\d+(?:\/[^?#]*)?/i);return `${u.protocol}//${u.host}${m?.[0]||u.pathname}`}catch{return ''}}
function sourceIdFromIssueUrl(issueUrl=''){try{return new URL(issueUrl).pathname.match(/^\/comics\/issue\/(\d+)/i)?.[1]||''}catch{return ''}}
function unwrapGoogleLocation(location=''){try{const a=new URL(location,GOOGLE_ORIGIN);if(isMarvelIssueUrl(a.href))return cleanMarvelIssueUrl(a.href);if(/google\./i.test(a.hostname)&&a.pathname==='/url'){const target=a.searchParams.get('q')||a.searchParams.get('url')||'';if(isMarvelIssueUrl(target))return cleanMarvelIssueUrl(target)}}catch{}return ''}
function extractMarvelIssueFromGoogleHtml(html=''){const clean=unescapeHtml(html).replace(/%2F/gi,'/').replace(/%3A/gi,':');const direct=clean.match(/https?:\/\/(?:www\.)?marvel\.com\/comics\/issue\/\d+(?:\/[A-Za-z0-9_()%.,+\-]*)?/gi)||[];for(const c of direct)if(isMarvelIssueUrl(c))return cleanMarvelIssueUrl(c);const links=clean.match(/\/url\?[^"'<>\\s]+/gi)||[];for(const link of links){try{const p=new URL(link.replace(/&amp;/g,'&'),GOOGLE_ORIGIN),target=p.searchParams.get('q')||p.searchParams.get('url')||'';if(isMarvelIssueUrl(target))return cleanMarvelIssueUrl(target)}catch{}}return ''}
function extractMarvelIssueCandidates(html=''){const clean=unescapeHtml(html).replace(/%2F/gi,'/').replace(/%3A/gi,':');const found=[...(clean.match(/https?:\/\/(?:www\.)?marvel\.com\/comics\/issue\/\d+(?:\/[A-Za-z0-9_()%.,+\-]*)?/gi)||[]),...(clean.match(/\/comics\/issue\/\d+(?:\/[A-Za-z0-9_()%.,+\-]*)?/gi)||[])];const out=[],seen=new Set();for(const raw of found){const u=cleanMarvelIssueUrl(raw.startsWith('http')?raw:MARVEL_ORIGIN+raw);if(u&&!seen.has(u)){seen.add(u);out.push(u)}}return out}
async function fetchGoogle(url,redirect='manual'){return fetch(url,{redirect,headers:{'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1','Accept':'text/html,application/xhtml+xml','Accept-Language':'es-ES,es;q=0.9,en;q=0.6'}})}
async function fetchHtml(url){const response=await fetch(url,{redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1','Accept':'text/html,application/xhtml+xml','Accept-Language':'en-US,en;q=0.9'}});if(!response.ok)throw new Error(`${url} respondió ${response.status}`);return response.text()}
function extractReaderData(html,issueUrl){const clean=unescapeHtml(html),match=clean.match(/https:\/\/read\.marvel\.com\/#\/book\/(\d+)/i);return{readerId:match?.[1]||'',webUrl:match?.[0]||issueUrl}}
function absoluteImage(url=''){let v=unescapeHtml(url).trim();if(v.startsWith('//'))v='https:'+v;return /^https?:\/\//i.test(v)?v:''}
function extractCoverUrl(html=''){const clean=unescapeHtml(html);let patterns=[/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,/"image"\s*:\s*"(https?:[^"\\]+(?:\\.[^"\\]*)*)"/i,/"image_url"\s*:\s*"([^"]+)"/i];for(const p of patterns){const m=clean.match(p);if(m){const u=absoluteImage(m[1]);if(u)return u}}return ''}
function extractPageTitle(html=''){const clean=unescapeHtml(html);const patterns=[/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,/<title[^>]*>([^<]+)<\/title>/i];for(const p of patterns){const m=clean.match(p);if(m)return m[1].replace(/\s+/g,' ').trim()}return ''}
function escapeRegExp(value=''){return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
function evaluateMatch(title,issue,year,pageTitle,issueUrl){
  const expectedTokens=significantTitleTokens(title),actualTokens=significantTitleTokens(String(pageTitle).replace(/\|\s*Comic Issues.*$/i,'').replace(/\(Variant\)\s*$/i,''));
  const expectedUnique=[...new Set(expectedTokens)],actualSet=new Set(actualTokens);
  const tokenHits=expectedUnique.length?expectedUnique.filter(t=>actualSet.has(t)).length/expectedUnique.length:1;
  const rawTitle=String(pageTitle||'').toLowerCase(),rawIssue=String(issue||'').trim().toLowerCase();
  let issueOk=true;
  if(rawIssue){const re=new RegExp(`#\\s*${escapeRegExp(rawIssue)}(?:\\b|\\s|$)`,'i');let slug='';try{slug=decodeURIComponent(new URL(issueUrl).pathname).toLowerCase()}catch{}const slugRe=new RegExp(`(?:_|-)${escapeRegExp(rawIssue)}(?:$|[_-])`,'i');issueOk=re.test(rawTitle)||slugRe.test(slug)}
  let yearOk=true;if(year){const y=String(year);yearOk=new RegExp(`\\(${escapeRegExp(y)}\\)`).test(rawTitle)||String(issueUrl).includes(`_${y}_`)||String(issueUrl).includes(`-${y}-`)}
  const titleOk=tokenHits>=0.75;
  return{titleOk,issueOk,yearOk,tokenHits:Number(tokenHits.toFixed(2)),possibleMismatch:!(titleOk&&issueOk&&yearOk)}
}
function candidateScore(url,title,issue,year){
  let slug='';try{slug=decodeURIComponent(new URL(url).pathname).toLowerCase()}catch{}
  const tokens=significantTitleTokens(title);let score=0;
  for(const t of tokens)if(slug.includes(t))score+=2;
  if(year&&slug.includes(String(year)))score+=5;
  if(issue){const n=String(issue).toLowerCase();if(new RegExp(`(?:_|-)${escapeRegExp(n)}(?:$|[_-])`).test(slug))score+=6}
  return score
}
async function resolveExactIssueWithMarvel(title,issue,year){
  const queries=[[title,issue,year].filter(Boolean).join(' '),[title,issue].filter(Boolean).join(' ')];
  const tested=new Set();
  for(const query of queries){
    try{
      const html=await fetchHtml(`${MARVEL_ORIGIN}/search?content_type=comics&query=${encodeURIComponent(query)}`);
      const candidates=extractMarvelIssueCandidates(html).sort((a,b)=>candidateScore(b,title,issue,year)-candidateScore(a,title,issue,year)).slice(0,12);
      for(const candidate of candidates){
        if(tested.has(candidate))continue;tested.add(candidate);
        try{
          const issueHtml=await fetchHtml(candidate),pageTitle=extractPageTitle(issueHtml),match=evaluateMatch(title,issue,year,pageTitle,candidate);
          if(!match.possibleMismatch)return candidate
        }catch(e){console.error('Marvel candidate:',e)}
      }
    }catch(e){console.error('Marvel search resolver:',e)}
  }
  return ''
}
async function resolveExactIssueWithGoogle(title,issue,year){const lucky=luckyUrl(title,issue,year);try{const response=await fetchGoogle(lucky,'manual'),loc=unwrapGoogleLocation(response.headers.get('Location')||'');if(loc)return loc;if(isMarvelIssueUrl(response.url))return cleanMarvelIssueUrl(response.url);const html=await response.text(),from=extractMarvelIssueFromGoogleHtml(html);if(from)return from}catch(e){console.error('Google lucky resolver:',e)}try{const response=await fetchGoogle(normalGoogleUrl(title,issue,year),'follow'),html=await response.text(),from=extractMarvelIssueFromGoogleHtml(html);if(from)return from}catch(e){console.error('Google normal resolver:',e)}return ''}
async function resolveExactIssue(title,issue,year){
  const marvel=await resolveExactIssueWithMarvel(title,issue,year);if(marvel)return{issueUrl:marvel,resolverSource:'marvel-search'};
  const google=await resolveExactIssueWithGoogle(title,issue,year);if(google)return{issueUrl:google,resolverSource:'google-fallback'};
  return{issueUrl:'',resolverSource:'unresolved'}
}
async function resolveLegacyDrn(readerId){if(!readerId)return '';const html=await fetchHtml(`${MARVEL_LEGACY_SHARE}${encodeURIComponent(readerId)}`),clean=unescapeHtml(html).replace(/%3A/gi,':');let explicit=clean.match(/(?:[?&]|\b)drn=([^&"'<>\\s]+)/i)?.[1]||'';if(explicit){try{explicit=decodeURIComponent(explicit)}catch{}return explicit}return clean.match(/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i)?.[0]||''}
function buildSmartLink(drn,sourceId){if(!drn||!sourceId)return '';const u=new URL(MARVEL_SMART_LINK);u.searchParams.set('type','issue');u.searchParams.set('drn',drn);u.searchParams.set('sourceId',sourceId);return u.toString()}
function cacheKey(title,issue,year){const u=new URL('https://marvel-meta-cache.invalid/item');u.searchParams.set('resolver',String(RESOLVER_VERSION));u.searchParams.set('title',title);u.searchParams.set('issue',issue);u.searchParams.set('year',year);return new Request(u.toString())}
async function resolveMeta(title,issue,year){
  const key=cacheKey(title,issue,year),cache=typeof caches!=='undefined'?caches.default:null;
  if(cache){const hit=await cache.match(key);if(hit){try{return await hit.json()}catch{}}}
  const resolved=await resolveExactIssue(title,issue,year),issueUrl=resolved.issueUrl;
  if(!issueUrl)return{resolverVersion:RESOLVER_VERSION,resolverSource:resolved.resolverSource,available:false,issueUrl:'',sourceId:'',readerId:'',drn:'',smartLink:'',webUrl:luckyUrl(title,issue,year),coverUrl:'',pageTitle:'',reason:'lookup-unresolved'};
  const sourceId=sourceIdFromIssueUrl(issueUrl),html=await fetchHtml(issueUrl),{readerId,webUrl}=extractReaderData(html,issueUrl),coverUrl=extractCoverUrl(html),pageTitle=extractPageTitle(html);
  const match=evaluateMatch(title,issue,year,pageTitle,issueUrl);
  if(match.possibleMismatch)return{resolverVersion:RESOLVER_VERSION,resolverSource:resolved.resolverSource,available:false,issueUrl,sourceId,readerId:'',drn:'',smartLink:'',webUrl:issueUrl,coverUrl,pageTitle,reason:'possible-mismatch',match};
  let drn='',smartLink='';
  if(readerId&&sourceId){try{drn=await resolveLegacyDrn(readerId);smartLink=buildSmartLink(drn,sourceId)}catch(e){console.error('Legacy DRN:',e)}}
  const data={resolverVersion:RESOLVER_VERSION,resolverSource:resolved.resolverSource,available:Boolean(smartLink),issueUrl,sourceId,readerId,drn,smartLink,webUrl,coverUrl,pageTitle,reason:smartLink?'ok':readerId?'drn-unavailable':'reader-unavailable',match};
  if(cache){const response=Response.json(data,{headers:{'Cache-Control':`public, max-age=${META_TTL}`}});await cache.put(key,response.clone()).catch(()=>{})}
  return data
}
async function verifyUrl(url){if(!url)return{ok:false,status:0,location:'',error:'missing-url'};try{const response=await fetch(url,{method:'GET',redirect:'manual',headers:{'User-Agent':'Mozilla/5.0 (compatible; MarvelLectura-Diagnostic/1.2)','Accept':'text/html,*/*;q=0.8'}});return{ok:response.status>=200&&response.status<400,status:response.status,location:response.headers.get('Location')||'',error:''}}catch(e){return{ok:false,status:0,location:'',error:String(e?.message||e)}}}
function knownMetaFromUrl(url){
  const issueUrl=url.searchParams.get('knownIssueUrl')||'',smartLink=url.searchParams.get('knownSmartLink')||'';
  if(!issueUrl||!smartLink)return null;
  return{resolverVersion:RESOLVER_VERSION,resolverSource:'client-cache',available:true,issueUrl,sourceId:url.searchParams.get('knownSourceId')||sourceIdFromIssueUrl(issueUrl),readerId:url.searchParams.get('knownReaderId')||'',drn:url.searchParams.get('knownDrn')||'',smartLink,webUrl:url.searchParams.get('knownWebUrl')||issueUrl,coverUrl:'',pageTitle:url.searchParams.get('knownPageTitle')||'',reason:'client-cache'}
}
async function diagnosticMeta(title,issue,year,known=null){
  const meta=known||await resolveMeta(title,issue,year);
  const match=meta.issueUrl?evaluateMatch(title,issue,year,meta.pageTitle,meta.issueUrl):{titleOk:false,issueOk:false,yearOk:false,tokenHits:0,possibleMismatch:false};
  const [appCheck,webCheck]=await Promise.all([meta.smartLink?verifyUrl(meta.smartLink):Promise.resolve({ok:false,status:0,location:'',error:'missing-smartlink'}),meta.webUrl&&meta.readerId?verifyUrl(meta.webUrl):Promise.resolve({ok:false,status:0,location:'',error:'missing-reader'})]);
  let diagnosticCode='OK';
  if(!meta.issueUrl)diagnosticCode='LOOKUP_UNRESOLVED';
  else if(meta.reason==='possible-mismatch'||(meta.pageTitle&&match.possibleMismatch))diagnosticCode='POSSIBLE_MISMATCH';
  else if(!meta.readerId)diagnosticCode='NOT_IN_UNLIMITED';
  else if(!meta.drn)diagnosticCode='DRN_MISSING';
  else if(!meta.smartLink)diagnosticCode='SMARTLINK_MISSING';
  else if(!appCheck.ok)diagnosticCode='SMARTLINK_HTTP_ERROR';
  else if(!webCheck.ok)diagnosticCode='WEB_LINK_HTTP_ERROR';
  return{...meta,match,appCheck,webCheck,diagnosticCode}
}
function redirect(location){return new Response(null,{status:302,headers:{Location:location,'Cache-Control':'private, no-store'}})}
function errorPage(fallback,msg='No he podido construir el enlace móvil de Marvel Unlimited.'){const safe=String(fallback).replace(/&/g,'&amp;').replace(/"/g,'&quot;'),text=String(msg).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marvel Unlimited</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f1ec;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17181c}.box{width:min(88vw,430px);text-align:center}.logo{display:inline-block;background:#e62429;color:#fff;padding:5px 8px;font-weight:900;font-size:22px}a{display:block;margin-top:20px;padding:14px;border-radius:14px;background:#fff;color:#333;border:1px solid #ddd8cf;text-decoration:none;font-weight:800}p{color:#74747b;font-size:13px;line-height:1.5}</style></head><body><div class="box"><span class="logo">MARVEL</span><h2>Número localizado</h2><p>${text}</p><a href="${safe}">Abrir este número en la web</a></div></body></html>`,{status:502,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})}

export default{async fetch(request,env){
  const url=new URL(request.url);if(url.pathname!=='/api/marvel/open')return env.ASSETS.fetch(request);
  const title=(url.searchParams.get('title')||'').trim(),issue=(url.searchParams.get('issue')||'').trim(),year=(url.searchParams.get('year')||'').trim(),mode=(url.searchParams.get('mode')||'web').toLowerCase();
  if(!title)return new Response('Falta el título del cómic.',{status:400});const lucky=luckyUrl(title,issue,year);if(mode==='web')return redirect(lucky);
  try{
    if(mode==='diagnostic'){const data=await diagnosticMeta(title,issue,year,knownMetaFromUrl(url));return Response.json({title,issue,year,...data},{headers:{'Cache-Control':'no-store'}})}
    const meta=await resolveMeta(title,issue,year);
    if(mode==='meta')return Response.json(meta,{headers:{'Cache-Control':`public, max-age=${META_TTL}`,'X-Marvel-Resolver':String(RESOLVER_VERSION)}});
    if(mode==='debug')return Response.json({title,issue,year,...meta},{headers:{'Cache-Control':'no-store'}});
    if((mode==='app'||mode==='ios'||mode==='android')&&meta.smartLink)return redirect(meta.smartLink);
    const message=meta.reason==='reader-unavailable'?'Marvel tiene ficha para este número, pero no ofrece lector digital de Unlimited.':meta.reason==='possible-mismatch'?'He localizado una ficha de Marvel, pero no coincide con suficiente seguridad con este número.':'No he podido identificar con seguridad este número en Marvel Unlimited.';
    return errorPage(meta.webUrl||lucky,message);
  }catch(e){console.error('Marvel resolver:',e);if(mode==='meta'||mode==='diagnostic')return Response.json({resolverVersion:RESOLVER_VERSION,available:false,webUrl:lucky,reason:'resolver-error',diagnosticCode:'RESOLVER_ERROR',error:String(e?.message||e)},{status:200,headers:{'Cache-Control':'no-store'}});return errorPage(lucky,'Se ha producido un error al construir el enlace de Marvel Unlimited.')}
}};