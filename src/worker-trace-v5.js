import baseWorker from './worker-catalog-v12.js';

function classify(f){
  if(f?.smartLink)return'OK';
  if(!f?.issueUrl){
    if(f?.paginationReason==='target-not-found')return'SERIES_PAGINATION_TARGET_NOT_FOUND';
    if(f?.catalogReason==='series-not-found')return'CATALOG_SERIES_NOT_FOUND';
    if(String(f?.catalogReason||'').includes('HTTP'))return'CATALOG_HTTP_ERROR';
    return'LOOKUP_UNRESOLVED';
  }
  if(f?.reason==='reader-unavailable')return'CONFIRMED_NOT_IN_UNLIMITED';
  if(!f?.readerId)return'READER_ID_NOT_FOUND';
  if(!f?.drn)return'DRN_NOT_FOUND';
  if(!f?.smartLink)return'SMARTLINK_NOT_BUILT';
  return f?.reason||'UNKNOWN';
}
function attemptFromPage(p){return{name:p.name||'series-page',url:p.url||'',status:p.status??0,ok:(p.status??0)>=200&&(p.status??0)<300,ms:p.ms??0,error:p.error||'',signals:[`offset:${p.offset??0}`,`limit:${p.limit??0}`,`order:${p.orderBy||''}`,`keys:${(p.keys||[]).join(',')}`,p.targetFound?'target-found':'target-not-found',p.fromCache?'page-cache':'network']}}

async function traceMarvel(request,env){
  const original=new URL(request.url),title=(original.searchParams.get('title')||'').trim(),issue=(original.searchParams.get('issue')||'').trim(),year=(original.searchParams.get('year')||'').trim();
  if(!title)return Response.json({error:'missing-title'},{status:400});
  const diag=new URL(original);diag.pathname='/api/marvel/open';diag.searchParams.set('mode','diagnostic');
  const started=Date.now();let f={};
  try{const r=await baseWorker.fetch(new Request(diag.toString(),{headers:{Accept:'application/json'}}),env);f=await r.json();f._httpStatus=r.status}catch(e){f={diagnosticCode:'RESOLVER_ERROR',reason:'trace-base-error',error:String(e?.message||e)}}
  const attempts=(f.paginationAttempts||[]).map(attemptFromPage);
  return Response.json({
    traceVersion:5,generatedAt:new Date().toISOString(),query:{title,issue,year},failureStage:classify(f),finalMs:Date.now()-started,
    final:{diagnosticCode:f.diagnosticCode||'',reason:f.reason||'',resolverVersion:f.resolverVersion||0,resolverSource:f.resolverSource||'',catalogReason:f.catalogReason||'',seriesTitle:f.seriesTitle||'',seriesLabel:f.seriesLabel||'',seriesUrl:f.seriesUrl||'',catalogKnownIssues:f.catalogKnownIssues||0,catalogKeys:f.catalogKeys||[],paginationReason:f.paginationReason||'',paginationAttempts:f.paginationAttempts||[],issueUrl:f.issueUrl||'',sourceId:f.sourceId||'',readerId:f.readerId||'',drn:f.drn||'',smartLink:f.smartLink||'',webUrl:f.webUrl||'',coverUrl:f.coverUrl||'',pageTitle:f.pageTitle||'',appStatus:f.appCheck?.status??0,webStatus:f.webCheck?.status??0,error:f.error||''},
    attempts,issueProbe:null,drnProbe:null,smartProbe:null
  },{headers:{'Cache-Control':'no-store'}});
}

export default{async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname==='/api/marvel/trace')return traceMarvel(request,env);return baseWorker.fetch(request,env,ctx)}};