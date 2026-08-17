import baseWorker from './worker-catalog-v9.js';

const MARVEL='https://www.marvel.com';
const GOOGLE='https://www.google.com';
const SHARE='https://share.marvel.com/sharing/legacy/';

function unescapeHtml(v=''){
  return String(v).replace(/\\u002F/gi,'/').replace(/\\u003A/gi,':').replace(/\\\//g,'/').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
}
function normalize(v=''){return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim()}
function seriesCount(html=''){return (html.match(/\/comics\/series\/\d+\//gi)||[]).length}
function issueUrls(html=''){
  const clean=unescapeHtml(html).replace(/%2F/gi,'/').replace(/%3A/gi,':');
  const found=clean.match(/https?:\/\/(?:www\.|share\.)?marvel\.com\/comics\/issue\/\d+(?:\/[A-Za-z0-9_()%.,+\-]*)?/gi)||[];
  return [...new Set(found)].slice(0,12);
}
function signals(html=''){
  const t=String(html).toLowerCase(),out=[];
  if(t.includes('captcha'))out.push('captcha');
  if(t.includes('too many requests'))out.push('too-many-requests');
  if(t.includes('unusual traffic'))out.push('unusual-traffic');
  if(t.includes('access denied'))out.push('access-denied');
  return out;
}
async function probe(name,url,{redirect='follow',body=true}={}){
  const start=Date.now();
  try{
    const r=await fetch(url,{redirect,headers:{'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1','Accept':'text/html,application/xhtml+xml,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9'}});
    const text=body?await r.text():'';
    return{name,url,status:r.status,ok:r.ok,ms:Date.now()-start,finalUrl:r.url||'',location:r.headers.get('Location')||'',contentType:r.headers.get('Content-Type')||'',signals:signals(text),candidates:issueUrls(text),_text:text};
  }catch(e){return{name,url,status:0,ok:false,ms:Date.now()-start,error:String(e?.message||e),signals:[],candidates:[],_text:''}}
}
function publicProbe(p){const {_text,...rest}=p;return rest}
function pageSignals(html=''){
  const clean=unescapeHtml(html),readerIds=[...clean.matchAll(/https:\/\/read\.marvel\.com\/#\/book\/(\d+)/gi)].map(m=>m[1]),drns=[...clean.matchAll(/drn:src:marvel:unison::prod:[0-9a-f-]{36}/gi)].map(m=>m[0]);
  let title='',cover='';
  for(const re of [/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,/<title[^>]*>([^<]+)<\/title>/i]){const m=clean.match(re);if(m){title=m[1].replace(/\s+/g,' ').trim();break}}
  for(const re of [/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,/"image_url"\s*:\s*"([^"]+)"/i,/"portrait_xlarge"\s*:\s*"([^"]+)"/i]){const m=clean.match(re);if(m){cover=unescapeHtml(m[1]);break}}
  return{pageTitle:title,readerIds:[...new Set(readerIds)].slice(0,5),drns:[...new Set(drns)].slice(0,5),coverFound:Boolean(cover),coverUrl:cover};
}
function classify(f){
  if(f?.smartLink)return 'OK';
  if(!f?.issueUrl){
    if(String(f?.catalogReason||'').startsWith('series-index-unusable'))return 'CATALOG_INDEX_UNUSABLE';
    if(f?.catalogReason==='series-not-found')return 'CATALOG_SERIES_NOT_FOUND';
    if(f?.catalogReason==='issue-not-found-after-walk')return 'CATALOG_ISSUE_NOT_FOUND_AFTER_WALK';
    if(f?.resolverSource==='google-blocked')return 'GOOGLE_BLOCKED_AFTER_CATALOG';
    return 'LOOKUP_UNRESOLVED';
  }
  if(f?.reason==='reader-unavailable')return 'CONFIRMED_NOT_IN_UNLIMITED';
  if(!f?.readerId)return 'READER_ID_NOT_FOUND';
  if(!f?.drn)return 'DRN_NOT_FOUND';
  return f?.reason||'UNKNOWN';
}
async function traceMarvel(request,env){
  const original=new URL(request.url),title=(original.searchParams.get('title')||'').trim(),issue=(original.searchParams.get('issue')||'').trim(),year=(original.searchParams.get('year')||'').trim();
  if(!title)return Response.json({error:'missing-title'},{status:400});
  const diagUrl=new URL(original);diagUrl.pathname='/api/marvel/open';diagUrl.searchParams.set('mode','diagnostic');
  const started=Date.now();let finalData={};
  try{const r=await baseWorker.fetch(new Request(diagUrl.toString(),{headers:{Accept:'application/json'}}),env);finalData=await r.json();finalData._httpStatus=r.status}catch(e){finalData={diagnosticCode:'RESOLVER_ERROR',reason:'trace-base-error',error:String(e?.message||e)}}
  const finalMs=Date.now()-started,attempts=[];

  if(finalData.diagnosticCode!=='OK'){
    const idx=await probe('marvel-series-index',`${MARVEL}/comics/series`);
    const idxPublic=publicProbe(idx);idxPublic.signals=[...(idxPublic.signals||[]),`series-links:${seriesCount(idx._text)}`,normalize(idx._text).includes(normalize(title))?'requested-title-visible':'requested-title-not-visible'];attempts.push(idxPublic);
    if(finalData.seriesUrl){
      const sp=await probe('marvel-series-page',finalData.seriesUrl);
      const spp=publicProbe(sp);spp.signals=[...(spp.signals||[]),`issue-links:${issueUrls(sp._text).length}`];attempts.push(spp);
    }
    if(finalData.resolverSource==='google-blocked'||String(finalData.catalogReason||'').includes('unusable')){
      const q=`site:marvel.com/comics/issue/ "${title}" "${issue?`#${issue}`:''}" ${year} Marvel Unlimited`;
      attempts.push(publicProbe(await probe('google-fallback-check',`${GOOGLE}/search?btnI=1&q=${encodeURIComponent(q)}`,{redirect:'manual'})));
    }
  }

  let issueProbe=null,issueDetails=null,drnProbe=null,drnDetails=null,smartProbe=null;
  if(finalData.issueUrl){issueProbe=await probe('marvel-issue',finalData.issueUrl);issueDetails=pageSignals(issueProbe._text);const rid=finalData.readerId||issueDetails.readerIds?.[0]||'';if(rid){drnProbe=await probe('share-legacy',`${SHARE}${encodeURIComponent(rid)}`);drnDetails=pageSignals(drnProbe._text)}}
  if(finalData.smartLink)smartProbe=await probe('smart-link',finalData.smartLink,{redirect:'manual',body:false});
  return Response.json({traceVersion:2,generatedAt:new Date().toISOString(),query:{title,issue,year},failureStage:classify(finalData),finalMs,final:{diagnosticCode:finalData.diagnosticCode||'',reason:finalData.reason||'',resolverVersion:finalData.resolverVersion||0,resolverSource:finalData.resolverSource||'',catalogReason:finalData.catalogReason||'',seriesLabel:finalData.seriesLabel||'',seriesUrl:finalData.seriesUrl||'',catalogWalked:finalData.catalogWalked||0,catalogKnownIssues:finalData.catalogKnownIssues||0,issueUrl:finalData.issueUrl||'',sourceId:finalData.sourceId||'',readerId:finalData.readerId||'',drn:finalData.drn||'',smartLink:finalData.smartLink||'',webUrl:finalData.webUrl||'',coverUrl:finalData.coverUrl||'',pageTitle:finalData.pageTitle||'',appStatus:finalData.appCheck?.status??0,webStatus:finalData.webCheck?.status??0,error:finalData.error||''},attempts,issueProbe:issueProbe?{...publicProbe(issueProbe),...issueDetails}:null,drnProbe:drnProbe?{...publicProbe(drnProbe),...drnDetails}:null,smartProbe:smartProbe?publicProbe(smartProbe):null},{headers:{'Cache-Control':'no-store'}});
}
export default{async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname==='/api/marvel/trace')return traceMarvel(request,env);return baseWorker.fetch(request,env,ctx)}};