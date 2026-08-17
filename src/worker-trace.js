import baseWorker from './worker-unified.js';

const GOOGLE='https://www.google.com';
const BING='https://www.bing.com';
const MARVEL='https://www.marvel.com';
const SHARE='https://share.marvel.com/sharing/legacy/';

function unescapeHtml(value=''){
  return String(value)
    .replace(/\\u002F/gi,'/')
    .replace(/\\u003A/gi,':')
    .replace(/\\\//g,'/')
    .replace(/&amp;/g,'&')
    .replace(/&quot;/g,'"')
    .replace(/&#39;/g,"'")
    .replace(/&#58;/g,':');
}
function exactQuery(title,issue,year){return `site:marvel.com/comics/issue/ "${title}" "${issue?`#${issue}`:''}" ${year} Marvel Unlimited`}
function relaxedQuery(title,issue,year){return `site:marvel.com/comics/issue/ "${title}" "${issue?`#${issue}`:''}" ${year}`}
function cleanIssueUrl(value=''){
  try{
    const u=new URL(value,MARVEL);
    if(!/(^|\.)marvel\.com$/i.test(u.hostname)||!/^\/comics\/issue\/\d+(?:\/|$)/i.test(u.pathname))return '';
    const m=u.pathname.match(/^\/comics\/issue\/\d+(?:\/[^?#]*)?/i);
    return `${u.protocol}//${u.host}${m?.[0]||u.pathname}`;
  }catch{return ''}
}
function candidatesFromHtml(html=''){
  const clean=unescapeHtml(html).replace(/%2F/gi,'/').replace(/%3A/gi,':');
  const values=[
    ...(clean.match(/https?:\/\/(?:www\.)?marvel\.com\/comics\/issue\/\d+(?:\/[A-Za-z0-9_()%.,+\-]*)?/gi)||[]),
    ...(clean.match(/\/comics\/issue\/\d+(?:\/[A-Za-z0-9_()%.,+\-]*)?/gi)||[])
  ];
  const out=[],seen=new Set();
  for(const raw of values){
    const u=cleanIssueUrl(raw.startsWith('http')?raw:MARVEL+raw);
    if(u&&!seen.has(u)){seen.add(u);out.push(u)}
  }
  return out.slice(0,12);
}
function candidateFromLocation(location=''){
  try{
    const u=new URL(location,GOOGLE);
    const direct=cleanIssueUrl(u.href);if(direct)return direct;
    if(/google\./i.test(u.hostname)&&u.pathname==='/url')return cleanIssueUrl(u.searchParams.get('q')||u.searchParams.get('url')||'');
  }catch{}
  return '';
}
function blockSignals(text=''){
  const t=String(text).toLowerCase();
  const found=[];
  if(t.includes('unusual traffic'))found.push('google-unusual-traffic');
  if(t.includes('captcha'))found.push('captcha');
  if(t.includes('verify you are human'))found.push('human-verification');
  if(t.includes('access denied'))found.push('access-denied');
  if(t.includes('too many requests'))found.push('too-many-requests');
  if(t.includes('temporarily unavailable'))found.push('temporarily-unavailable');
  return found;
}
async function probe(name,url,{redirect='follow',readBody=true}={}){
  const started=Date.now();
  try{
    const response=await fetch(url,{redirect,headers:{
      'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1',
      'Accept':'text/html,application/xhtml+xml,*/*;q=0.8',
      'Accept-Language':'es-ES,es;q=0.9,en;q=0.6'
    }});
    let text='';
    if(readBody){try{text=(await response.text()).slice(0,700000)}catch{}}
    const location=response.headers.get('Location')||'';
    const candidates=candidatesFromHtml(text);
    const fromLocation=candidateFromLocation(location);
    if(fromLocation&&!candidates.includes(fromLocation))candidates.unshift(fromLocation);
    return {
      name,url,status:response.status,ok:response.ok,ms:Date.now()-started,
      finalUrl:response.url||'',location,contentType:response.headers.get('Content-Type')||'',
      candidates:candidates.slice(0,8),signals:blockSignals(text),_text:text
    };
  }catch(e){
    return{name,url,status:0,ok:false,ms:Date.now()-started,finalUrl:'',location:'',contentType:'',candidates:[],signals:[],error:String(e?.message||e),_text:''};
  }
}
function publicProbe(p){const {_text,...rest}=p;return rest}
function pageSignals(html=''){
  const clean=unescapeHtml(html);
  const readerIds=[...clean.matchAll(/https:\/\/read\.marvel\.com\/#\/book\/(\d+)/gi)].map(m=>m[1]);
  const drns=[...clean.matchAll(/drn:src:marvel:unison::prod:[0-9a-f-]{36}/gi)].map(m=>m[0]);
  let title='';
  for(const re of [/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,/<title[^>]*>([^<]+)<\/title>/i]){const m=clean.match(re);if(m){title=m[1].replace(/\s+/g,' ').trim();break}}
  let cover='';
  for(const re of [/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,/"image_url"\s*:\s*"([^"]+)"/i,/"portrait_xlarge"\s*:\s*"([^"]+)"/i]){const m=clean.match(re);if(m){cover=unescapeHtml(m[1]);break}}
  return{pageTitle:title,readerIds:[...new Set(readerIds)].slice(0,5),drns:[...new Set(drns)].slice(0,5),coverFound:Boolean(cover),coverUrl:cover};
}
function classify(finalData,attempts,issueProbe,drnProbe,smartProbe){
  if(finalData?.smartLink)return 'OK';
  if(!finalData?.issueUrl){
    const blocked=attempts.some(a=>a.status===429||a.status===403||a.signals?.length);
    const anyCandidate=attempts.some(a=>a.candidates?.length);
    if(blocked)return 'SEARCH_BLOCKED_OR_THROTTLED';
    if(anyCandidate)return 'CANDIDATE_FOUND_BUT_RESOLVER_REJECTED';
    return 'NO_SEARCH_CANDIDATE';
  }
  if(issueProbe&&!issueProbe.ok)return 'MARVEL_ISSUE_HTTP_ERROR';
  if(!finalData?.readerId)return 'READER_ID_NOT_FOUND';
  if(drnProbe&&!drnProbe.ok)return 'DRN_ENDPOINT_HTTP_ERROR';
  if(!finalData?.drn)return 'DRN_NOT_FOUND';
  if(!finalData?.smartLink)return 'SMARTLINK_NOT_BUILT';
  if(smartProbe&&!smartProbe.ok)return 'SMARTLINK_HTTP_ERROR';
  return finalData?.reason||'UNKNOWN';
}

async function traceMarvel(request,env){
  const original=new URL(request.url);
  const title=(original.searchParams.get('title')||'').trim();
  const issue=(original.searchParams.get('issue')||'').trim();
  const year=(original.searchParams.get('year')||'').trim();
  if(!title)return Response.json({error:'missing-title'},{status:400});

  const diagUrl=new URL(original);
  diagUrl.pathname='/api/marvel/open';
  diagUrl.searchParams.set('mode','diagnostic');
  const finalStarted=Date.now();
  let finalData={};
  try{
    const r=await baseWorker.fetch(new Request(diagUrl.toString(),{method:'GET',headers:{Accept:'application/json'}}),env);
    finalData=await r.json();
    finalData._httpStatus=r.status;
  }catch(e){finalData={diagnosticCode:'RESOLVER_ERROR',reason:'trace-base-error',error:String(e?.message||e)}}
  const finalMs=Date.now()-finalStarted;

  const attempts=[];
  if(finalData.diagnosticCode!=='OK'){
    const lucky=await probe('google-lucky',`${GOOGLE}/search?btnI=1&q=${encodeURIComponent(exactQuery(title,issue,year))}`,{redirect:'manual'});attempts.push(lucky);
    const normal=await probe('google-exact',`${GOOGLE}/search?q=${encodeURIComponent(exactQuery(title,issue,year))}`);attempts.push(normal);
    const relaxed=await probe('google-relaxed',`${GOOGLE}/search?q=${encodeURIComponent(relaxedQuery(title,issue,year))}`);attempts.push(relaxed);
    const marvel=await probe('marvel-search',`${MARVEL}/search?content_type=comics&query=${encodeURIComponent([title,issue,year].filter(Boolean).join(' '))}`);attempts.push(marvel);
    const bing=await probe('bing-search',`${BING}/search?q=${encodeURIComponent(relaxedQuery(title,issue,year))}`);attempts.push(bing);
  }

  let issueUrl=finalData.issueUrl||'';
  if(!issueUrl){for(const a of attempts){if(a.candidates?.[0]){issueUrl=a.candidates[0];break}}}
  let issueProbe=null,issueDetails=null,drnProbe=null,drnDetails=null,smartProbe=null;
  if(issueUrl){
    issueProbe=await probe('marvel-issue',issueUrl,{redirect:'follow'});
    issueDetails=pageSignals(issueProbe._text);
    const readerId=finalData.readerId||issueDetails.readerIds?.[0]||'';
    if(readerId){
      drnProbe=await probe('share-legacy',`${SHARE}${encodeURIComponent(readerId)}`,{redirect:'follow'});
      drnDetails=pageSignals(drnProbe._text);
    }
  }
  if(finalData.smartLink)smartProbe=await probe('smart-link',finalData.smartLink,{redirect:'manual',readBody:false});

  const failureStage=classify(finalData,attempts,issueProbe,drnProbe,smartProbe);
  return Response.json({
    traceVersion:1,
    generatedAt:new Date().toISOString(),
    query:{title,issue,year},
    failureStage,
    finalMs,
    final:{
      diagnosticCode:finalData.diagnosticCode||'',reason:finalData.reason||'',resolverVersion:finalData.resolverVersion||0,
      resolverSource:finalData.resolverSource||'',issueUrl:finalData.issueUrl||'',sourceId:finalData.sourceId||'',
      readerId:finalData.readerId||'',drn:finalData.drn||'',smartLink:finalData.smartLink||'',webUrl:finalData.webUrl||'',
      coverUrl:finalData.coverUrl||'',pageTitle:finalData.pageTitle||'',appStatus:finalData.appCheck?.status??0,webStatus:finalData.webCheck?.status??0,
      error:finalData.error||''
    },
    attempts:attempts.map(publicProbe),
    issueProbe:issueProbe?{...publicProbe(issueProbe),...issueDetails}:null,
    drnProbe:drnProbe?{...publicProbe(drnProbe),...drnDetails}:null,
    smartProbe:smartProbe?publicProbe(smartProbe):null
  },{headers:{'Cache-Control':'no-store'}});
}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/api/marvel/trace')return traceMarvel(request,env);
    return baseWorker.fetch(request,env,ctx);
  }
};
