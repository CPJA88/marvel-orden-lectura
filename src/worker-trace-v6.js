import baseWorker from './worker-bing-v13.js';

function classify(f){
  if(f?.smartLink)return'OK';
  if(!f?.issueUrl){
    if(f?.resolverSource==='bing-throttled')return'BING_THROTTLED';
    if(f?.bingReason==='network-error')return'BING_NETWORK_ERROR';
    if(f?.bingReason==='no-candidate')return'BING_NO_CANDIDATE';
    if(f?.bingReason==='candidate-mismatch'||f?.resolverSource==='bing-candidate-mismatch')return'BING_CANDIDATE_MISMATCH';
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
  const attempts=[];
  if(f.bingSearchUrl)attempts.push({name:'bing-search',url:f.bingSearchUrl,status:f.bingStatus||0,ms:f.bingMs||0,error:f.bingError||'',signals:[`reason:${f.bingReason||''}`,`candidates:${(f.bingCandidates||[]).length}`],candidates:f.bingCandidates||[]});
  for(const p of f.bingProbes||[]){
    for(const a of p.attempts||[])attempts.push({name:'bing-candidate-probe',url:a.url||p.candidate,status:a.status||0,ms:a.ms||0,error:a.error||'',signals:[`score:${p.score??0}`,a.matches?'MATCH':'mismatch',a.pageTitle?`title:${a.pageTitle}`:''].filter(Boolean),candidates:[]});
  }
  return Response.json({traceVersion:6,generatedAt:new Date().toISOString(),query:{title,issue,year},failureStage:classify(f),finalMs:Date.now()-started,final:{diagnosticCode:f.diagnosticCode||'',reason:f.reason||'',resolverVersion:f.resolverVersion||0,resolverSource:f.resolverSource||'',catalogReason:f.catalogReason||'',seriesTitle:f.seriesTitle||'',seriesLabel:f.seriesLabel||'',seriesUrl:f.seriesUrl||'',catalogKnownIssues:f.catalogKnownIssues||0,catalogKeys:f.catalogKeys||[],bingReason:f.bingReason||'',bingStatus:f.bingStatus||0,bingMs:f.bingMs||0,bingSearchUrl:f.bingSearchUrl||'',bingCandidates:f.bingCandidates||[],issueUrl:f.issueUrl||'',sourceId:f.sourceId||'',readerId:f.readerId||'',drn:f.drn||'',smartLink:f.smartLink||'',webUrl:f.webUrl||'',coverUrl:f.coverUrl||'',pageTitle:f.pageTitle||'',appStatus:f.appCheck?.status??0,webStatus:f.webCheck?.status??0,error:f.error||''},attempts,issueProbe:null,drnProbe:null,smartProbe:null},{headers:{'Cache-Control':'no-store'}});
}
export default{async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname==='/api/marvel/trace')return traceMarvel(request,env);return baseWorker.fetch(request,env,ctx)}};
