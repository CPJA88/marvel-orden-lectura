import baseWorker from './worker-catalog-v10.js';

const MARVEL='https://www.marvel.com';
const SHARE='https://share.marvel.com';
const LEGACY='https://share.marvel.com/sharing/legacy/';

function unescapeHtml(v=''){return String(v).replace(/\\u002F/gi,'/').replace(/\\u003A/gi,':').replace(/\\\//g,'/').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'")}
async function probe(name,url,{redirect='follow',body=true}={}){
  const start=Date.now();
  try{
    const r=await fetch(url,{redirect,headers:{'User-Agent':'Mozilla/5.0 (compatible; MarvelLectura-Diagnostic/5.1)','Accept':'text/html,application/xhtml+xml,*/*;q=0.8'}});
    const text=body?await r.text():'';
    return{name,url,status:r.status,ok:r.ok,ms:Date.now()-start,finalUrl:r.url||'',location:r.headers.get('Location')||'',error:'',_text:text};
  }catch(e){return{name,url,status:0,ok:false,ms:Date.now()-start,finalUrl:'',location:'',error:String(e?.message||e),_text:''}}
}
function publicProbe(p){const {_text,...x}=p;return x}
function pageSignals(html=''){
  const clean=unescapeHtml(html),readerIds=[...clean.matchAll(/https:\/\/read\.marvel\.com\/#\/book\/(\d+)/gi)].map(m=>m[1]),drns=[...clean.matchAll(/drn:src:marvel:unison::prod:[0-9a-f-]{36}/gi)].map(m=>m[0]);
  let title='',cover='';
  for(const re of [/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,/<title[^>]*>([^<]+)<\/title>/i]){const m=clean.match(re);if(m){title=m[1].replace(/\s+/g,' ').trim();break}}
  for(const re of [/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,/"image_url"\s*:\s*"([^"]+)"/i]){const m=clean.match(re);if(m){cover=unescapeHtml(m[1]);break}}
  return{pageTitle:title,readerIds:[...new Set(readerIds)].slice(0,5),drns:[...new Set(drns)].slice(0,5),coverFound:Boolean(cover),coverUrl:cover};
}
function classify(f){
  if(f?.smartLink)return 'OK';
  if(!f?.issueUrl){
    if(f?.catalogReason==='series-not-found')return 'CATALOG_SERIES_NOT_FOUND';
    if(f?.catalogReason==='issue-not-in-series-map')return 'CATALOG_ISSUE_NOT_IN_MAP';
    if(String(f?.catalogReason||'').includes('HTTP')||String(f?.catalogReason||'').includes('incomplete'))return 'CATALOG_HTTP_OR_PARSE_ERROR';
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
  const start=Date.now();let f={};
  try{const r=await baseWorker.fetch(new Request(diagUrl.toString(),{headers:{Accept:'application/json'}}),env);f=await r.json();f._httpStatus=r.status}catch(e){f={diagnosticCode:'RESOLVER_ERROR',reason:'trace-base-error',error:String(e?.message||e)}}
  const attempts=[];
  // El diagnóstico no repite búsquedas. Solo inspecciona la fuente concreta que falló.
  if(f.seriesUrl&&!f.issueUrl){attempts.push(publicProbe(await probe('series-page',f.seriesUrl)))}
  else if(!f.seriesUrl&&f.catalogReason==='series-not-found'){attempts.push(publicProbe(await probe('series-index',`${SHARE}/comics/series`)))}

  let issueProbe=null,drnProbe=null,smartProbe=null;
  if(f.issueUrl){
    const shareIssue=`${SHARE}${new URL(f.issueUrl).pathname}`;issueProbe=await probe('issue-page',shareIssue);const sig=pageSignals(issueProbe._text);issueProbe={...publicProbe(issueProbe),...sig};
    const rid=f.readerId||sig.readerIds?.[0]||'';if(rid&&!f.drn){const p=await probe('legacy-drn',`${LEGACY}${encodeURIComponent(rid)}`);drnProbe={...publicProbe(p),...pageSignals(p._text)}}
  }
  if(f.smartLink)smartProbe=publicProbe(await probe('smart-link',f.smartLink,{redirect:'manual',body:false}));
  return Response.json({traceVersion:3,generatedAt:new Date().toISOString(),query:{title,issue,year},failureStage:classify(f),finalMs:Date.now()-start,final:{diagnosticCode:f.diagnosticCode||'',reason:f.reason||'',resolverVersion:f.resolverVersion||0,resolverSource:f.resolverSource||'',catalogReason:f.catalogReason||'',seriesLabel:f.seriesLabel||'',seriesUrl:f.seriesUrl||'',catalogKnownIssues:f.catalogKnownIssues||0,catalogKeys:f.catalogKeys||[],issueUrl:f.issueUrl||'',sourceId:f.sourceId||'',readerId:f.readerId||'',drn:f.drn||'',smartLink:f.smartLink||'',webUrl:f.webUrl||'',coverUrl:f.coverUrl||'',pageTitle:f.pageTitle||'',appStatus:f.appCheck?.status??0,webStatus:f.webCheck?.status??0,error:f.error||''},attempts,issueProbe,drnProbe,smartProbe},{headers:{'Cache-Control':'no-store'}});
}
export default{async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname==='/api/marvel/trace')return traceMarvel(request,env);return baseWorker.fetch(request,env,ctx)}};