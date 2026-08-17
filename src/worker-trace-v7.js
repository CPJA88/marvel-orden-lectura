import baseWorker from './worker-loadmore-v14.js';

function classify(f){
  if(f?.smartLink)return'OK';
  if(!f?.issueUrl){
    if(f?.loadMoreReason==='query-ignored')return'MARVEL_LOADMORE_QUERY_IGNORED';
    if(f?.loadMoreReason==='target-not-found')return'MARVEL_LOADMORE_TARGET_NOT_FOUND';
    if(f?.loadMoreReason==='series-not-found')return'CATALOG_SERIES_NOT_FOUND';
    return'LOOKUP_UNRESOLVED';
  }
  if(f?.reason==='reader-unavailable')return'CONFIRMED_NOT_IN_UNLIMITED';
  if(!f?.readerId)return'READER_ID_NOT_FOUND';
  if(!f?.drn)return'DRN_NOT_FOUND';
  return f?.reason||'UNKNOWN';
}
async function traceMarvel(request,env){
  const original=new URL(request.url),title=(original.searchParams.get('title')||'').trim(),issue=(original.searchParams.get('issue')||'').trim(),year=(original.searchParams.get('year')||'').trim();
  if(!title)return Response.json({error:'missing-title'},{status:400});
  const u=new URL(original);u.pathname='/api/marvel/open';u.searchParams.set('mode','diagnostic');
  const started=Date.now();let f={};
  try{const r=await baseWorker.fetch(new Request(u.toString(),{headers:{Accept:'application/json'}}),env);f=await r.json();f._httpStatus=r.status}catch(e){f={diagnosticCode:'RESOLVER_ERROR',reason:'trace-base-error',error:String(e?.message||e)}}
  const attempts=(f.loadMoreAttempts||[]).map(a=>({name:`loadmore-${a.offset??0}`,url:a.url||'',status:a.status||0,ms:a.ms||0,error:a.error||'',signals:[`offset:${a.offset??0}`,`keys:${(a.keys||[]).join(',')}`,a.sameAsInitial?'SAME_AS_INITIAL':'different',a.targetFound?'TARGET_FOUND':'target-not-found',`total:${a.totalDetected||f.loadMoreTotal||0}`,a.fromCache?'page-cache':''].filter(Boolean),candidates:[]}));
  return Response.json({traceVersion:7,generatedAt:new Date().toISOString(),query:{title,issue,year},failureStage:classify(f),finalMs:Date.now()-started,final:{diagnosticCode:f.diagnosticCode||'',reason:f.reason||'',resolverVersion:f.resolverVersion||0,resolverSource:f.resolverSource||'',catalogReason:f.catalogReason||'',seriesTitle:f.seriesTitle||'',seriesLabel:f.seriesLabel||'',seriesUrl:f.seriesUrl||'',catalogKnownIssues:f.catalogKnownIssues||0,catalogKeys:f.catalogKeys||[],loadMoreReason:f.loadMoreReason||'',loadMoreTotal:f.loadMoreTotal||0,loadMoreAttempts:f.loadMoreAttempts||[],issueUrl:f.issueUrl||'',sourceId:f.sourceId||'',readerId:f.readerId||'',drn:f.drn||'',smartLink:f.smartLink||'',webUrl:f.webUrl||'',coverUrl:f.coverUrl||'',pageTitle:f.pageTitle||'',appStatus:f.appCheck?.status??0,webStatus:f.webCheck?.status??0,error:f.error||''},attempts,issueProbe:null,drnProbe:null,smartProbe:null},{headers:{'Cache-Control':'no-store'}});
}
export default{async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname==='/api/marvel/trace')return traceMarvel(request,env);return baseWorker.fetch(request,env,ctx)}};
