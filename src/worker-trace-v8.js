import baseWorker from './worker-neighbor-gcd-v16.js';

function classify(f){
  if(f?.smartLink)return'OK';
  if(f?.reason==='series-crawl-pending')return'SERIES_NEIGHBOR_CRAWL_PENDING';
  if(f?.crawlReason==='series-not-found')return'CATALOG_SERIES_NOT_FOUND';
  if(!f?.issueUrl)return'LOOKUP_UNRESOLVED';
  if(f?.reason==='reader-unavailable')return'CONFIRMED_NOT_IN_UNLIMITED';
  if(!f?.readerId)return'READER_ID_NOT_FOUND';
  if(!f?.drn)return'DRN_NOT_FOUND';
  return f?.reason||'UNKNOWN';
}
async function fetchJson(url,env){const r=await baseWorker.fetch(new Request(url,{headers:{Accept:'application/json'}}),env);let data={};try{data=await r.json()}catch{}return{status:r.status,data}}
async function traceMarvel(request,env){
  const original=new URL(request.url),title=(original.searchParams.get('title')||'').trim(),issue=(original.searchParams.get('issue')||'').trim(),year=(original.searchParams.get('year')||'').trim(),gcdId=(original.searchParams.get('gcdId')||'').trim();
  if(!title)return Response.json({error:'missing-title'},{status:400});
  const diag=new URL(original);diag.pathname='/api/marvel/open';diag.searchParams.set('mode','diagnostic');
  const started=Date.now();let f={};
  try{const r=await fetchJson(diag.toString(),env);f=r.data;f._httpStatus=r.status}catch(e){f={diagnosticCode:'RESOLVER_ERROR',reason:'trace-base-error',error:String(e?.message||e)}}
  let gcd={status:0,data:{}};
  if(gcdId){const g=new URL(original);g.pathname='/api/gcd/cover';g.search='';g.searchParams.set('id',gcdId);try{gcd=await fetchJson(g.toString(),env)}catch(e){gcd={status:0,data:{error:String(e?.message||e)}}}}
  const attempts=[{name:'series-neighbor-crawl',url:f.seriesUrl||'',status:f._httpStatus||0,ms:Date.now()-started,error:f.error||'',signals:[`steps:${f.crawlSteps??0}`,`known:${f.crawlKnown??0}`,`range:${f.crawlMin||'?'}-${f.crawlMax||'?'}`,`reason:${f.crawlReason||f.reason||''}`],candidates:[]}];
  if(gcdId)attempts.push({name:'gcd-cover-api',url:`https://www.comics.org/api/issue/${gcdId}/`,status:gcd.status||0,ms:0,error:gcd.data?.error||'',signals:[gcd.data?.coverUrl?'COVER_FOUND':'cover-missing'],candidates:gcd.data?.coverUrl?[gcd.data.coverUrl]:[]});
  return Response.json({traceVersion:8,generatedAt:new Date().toISOString(),query:{title,issue,year,gcdId},failureStage:classify(f),finalMs:Date.now()-started,final:{diagnosticCode:f.diagnosticCode||'',reason:f.reason||'',resolverVersion:f.resolverVersion||0,resolverSource:f.resolverSource||'',seriesTitle:f.seriesTitle||'',seriesLabel:f.seriesLabel||'',seriesUrl:f.seriesUrl||'',crawlReason:f.crawlReason||'',crawlSteps:f.crawlSteps||0,crawlKnown:f.crawlKnown||0,crawlMin:f.crawlMin||'',crawlMax:f.crawlMax||'',issueUrl:f.issueUrl||'',sourceId:f.sourceId||'',readerId:f.readerId||'',drn:f.drn||'',smartLink:f.smartLink||'',webUrl:f.webUrl||'',coverUrl:f.coverUrl||'',pageTitle:f.pageTitle||'',gcdCoverStatus:gcd.status||0,gcdCoverUrl:gcd.data?.coverUrl||'',gcdCoverError:gcd.data?.error||'',appStatus:f.appCheck?.status??0,webStatus:f.webCheck?.status??0,error:f.error||''},attempts,issueProbe:null,drnProbe:null,smartProbe:null},{headers:{'Cache-Control':'no-store'}});
}
export default{async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname==='/api/marvel/trace')return traceMarvel(request,env);return baseWorker.fetch(request,env,ctx)}};
