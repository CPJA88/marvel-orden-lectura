import baseWorker from './worker-neighbor-gcd-v16.js';

function knownMeta(url){
  const issueUrl=url.searchParams.get('knownIssueUrl')||'',smartLink=url.searchParams.get('knownSmartLink')||'';
  if(!issueUrl||!smartLink)return null;
  return{
    resolverVersion:8,resolverSource:'pwa-positive-cache',available:true,reason:'ok',issueUrl,smartLink,
    sourceId:url.searchParams.get('knownSourceId')||'',readerId:url.searchParams.get('knownReaderId')||'',
    drn:url.searchParams.get('knownDrn')||'',webUrl:url.searchParams.get('knownWebUrl')||issueUrl,
    pageTitle:url.searchParams.get('knownPageTitle')||'',coverUrl:url.searchParams.get('knownCoverUrl')||''
  };
}
function classify(f){
  if(f?.diagnosticCode==='COVER_MISSING')return'COVER_MISSING_GCD';
  if(f?.diagnosticCode==='COVER_LOOKUP_ERROR')return'COVER_LOOKUP_ERROR';
  if(f?.smartLink)return'OK';
  if(f?.reason==='series-crawl-pending')return'SERIES_NEIGHBOR_CRAWL_PENDING';
  if(f?.crawlReason==='series-not-found')return'CATALOG_SERIES_NOT_FOUND';
  if(!f?.issueUrl)return'LOOKUP_UNRESOLVED';
  if(f?.reason==='reader-unavailable')return'CONFIRMED_NOT_IN_UNLIMITED';
  if(!f?.readerId)return'READER_ID_NOT_FOUND';
  if(!f?.drn)return'DRN_NOT_FOUND';
  return f?.reason||'UNKNOWN';
}
async function fetchJson(url,env){
  const r=await baseWorker.fetch(new Request(url,{headers:{Accept:'application/json'}}),env);let data={};
  try{data=await r.json()}catch{}
  return{status:r.status,data};
}
async function gcdCheck(original,env){
  const gcdId=(original.searchParams.get('gcdId')||'').trim();
  if(!gcdId)return{status:0,data:{},id:''};
  const g=new URL(original);g.pathname='/api/gcd/cover';g.search='';g.searchParams.set('id',gcdId);
  try{const r=await fetchJson(g.toString(),env);return{...r,id:gcdId}}catch(e){return{status:0,data:{error:String(e?.message||e)},id:gcdId}}
}
async function diagnosticData(original,env){
  const known=knownMeta(original);let f={},httpStatus=200;
  if(known){f={...known,diagnosticCode:'OK',appCheck:{status:200,ok:true},webCheck:{status:200,ok:true}}}
  else{
    const diag=new URL(original);diag.pathname='/api/marvel/open';diag.searchParams.set('mode','diagnostic');
    try{const r=await fetchJson(diag.toString(),env);f=r.data;httpStatus=r.status}catch(e){f={diagnosticCode:'RESOLVER_ERROR',reason:'trace-base-error',error:String(e?.message||e)};httpStatus=502}
  }
  const gcd=await gcdCheck(original,env);
  if(gcd.id){
    f.gcdCoverStatus=gcd.status||0;f.gcdCoverUrl=gcd.data?.coverUrl||'';f.gcdCoverError=gcd.data?.error||'';
    if(f.diagnosticCode==='OK'){
      if(gcd.status!==200)f.diagnosticCode='COVER_LOOKUP_ERROR';
      else if(!gcd.data?.coverUrl)f.diagnosticCode='COVER_MISSING';
    }
  }
  return{f,httpStatus,gcd};
}
async function traceMarvel(request,env){
  const original=new URL(request.url),title=(original.searchParams.get('title')||'').trim(),issue=(original.searchParams.get('issue')||'').trim(),year=(original.searchParams.get('year')||'').trim();
  if(!title)return Response.json({error:'missing-title'},{status:400});
  const started=Date.now(),{f,httpStatus,gcd}=await diagnosticData(original,env);
  const attempts=[{name:'series-neighbor-crawl',url:f.seriesUrl||'',status:httpStatus||0,ms:Date.now()-started,error:f.error||'',signals:[`steps:${f.crawlSteps??0}`,`known:${f.crawlKnown??0}`,`range:${f.crawlMin||'?'}-${f.crawlMax||'?'}`,`reason:${f.crawlReason||f.reason||''}`],candidates:[]}];
  if(gcd.id)attempts.push({name:'gcd-cover-api',url:`https://www.comics.org/api/issue/${gcd.id}/`,status:gcd.status||0,ms:0,error:gcd.data?.error||'',signals:[gcd.data?.coverUrl?'COVER_FOUND':'cover-missing'],candidates:gcd.data?.coverUrl?[gcd.data.coverUrl]:[]});
  return Response.json({traceVersion:8,generatedAt:new Date().toISOString(),query:{title,issue,year,gcdId:gcd.id},failureStage:classify(f),finalMs:Date.now()-started,final:{diagnosticCode:f.diagnosticCode||'',reason:f.reason||'',resolverVersion:f.resolverVersion||0,resolverSource:f.resolverSource||'',seriesTitle:f.seriesTitle||'',seriesLabel:f.seriesLabel||'',seriesUrl:f.seriesUrl||'',crawlReason:f.crawlReason||'',crawlSteps:f.crawlSteps||0,crawlKnown:f.crawlKnown||0,crawlMin:f.crawlMin||'',crawlMax:f.crawlMax||'',issueUrl:f.issueUrl||'',sourceId:f.sourceId||'',readerId:f.readerId||'',drn:f.drn||'',smartLink:f.smartLink||'',webUrl:f.webUrl||'',coverUrl:f.coverUrl||'',pageTitle:f.pageTitle||'',gcdCoverStatus:f.gcdCoverStatus||0,gcdCoverUrl:f.gcdCoverUrl||'',gcdCoverError:f.gcdCoverError||'',appStatus:f.appCheck?.status??0,webStatus:f.webCheck?.status??0,error:f.error||''},attempts,issueProbe:null,drnProbe:null,smartProbe:null},{headers:{'Cache-Control':'no-store'}});
}
export default{async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname==='/api/marvel/trace')return traceMarvel(request,env);
  if(url.pathname==='/api/marvel/open'&&(url.searchParams.get('mode')||'').toLowerCase()==='diagnostic'){
    const {f}=await diagnosticData(url,env);return Response.json(f,{headers:{'Cache-Control':'no-store'}});
  }
  return baseWorker.fetch(request,env,ctx);
}};
