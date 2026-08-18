import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import extract from 'extract-zip';

const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const archiveFile=path.join(root,'Marvel_Orden_de_Lectura_PWA.zip');
const reportDir=path.join(root,'artifacts','marvel-missing-drn-seven');
const reportFile=path.join(reportDir,'investigation.json');

const SMART_BASE='https://marvel.smart.link/fiir7ec77';
const ISSUE_BASE='https://www.marvel.com/comics/issue/';
const LEGACY_BASE='https://share.marvel.com/sharing/legacy/';
const READ_BASE='https://read.marvel.com/';
const APPLINK_BASE='https://applink.marvel.com/issue/';
const STATUS_MU=1;
const STATUS_MU_LINK_MISSING=5;
const DRN_RE=/drn:src:marvel:unison::prod:[0-9a-f-]{36}/ig;
const DRN_EXACT_RE=/^drn:src:marvel:unison::prod:[0-9a-f-]{36}$/i;
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1';
const EXPECTED_TOTAL=51002;
const EXPECTED_MATCHED=25329;
const EXPECTED_LINK_READY=25322;
const EXPECTED_LINK_MISSING=7;

const TARGETS=Object.freeze([
  Object.freeze({gcdId:29395,sourceId:78145,readerId:55204}),
  Object.freeze({gcdId:29387,sourceId:78120,readerId:55203}),
  Object.freeze({gcdId:60401,sourceId:18116,readerId:73928}),
  Object.freeze({gcdId:338373,sourceId:2133,readerId:535}),
  Object.freeze({gcdId:521503,sourceId:5888,readerId:6307}),
  Object.freeze({gcdId:521504,sourceId:6037,readerId:6308}),
  Object.freeze({gcdId:1244835,sourceId:49010,readerId:34127}),
]);

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const str=v=>v==null?'':String(v);
const unique=values=>[...new Set(values.filter(Boolean))];
const decodeHtml=v=>str(v)
  .replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
  .replace(/&nbsp;/gi,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)||32));

function decodeRepeated(v=''){
  let s=decodeHtml(str(v)).replace(/\\u003A/gi,':').replace(/\\u002F/gi,'/').replace(/\\u0026/gi,'&');
  for(let i=0;i<4;i++){
    try{const d=decodeURIComponent(s);if(d===s)break;s=d}catch{break}
  }
  return s;
}
function normalizedEmbedded(v=''){
  return decodeRepeated(v).replace(/\\"/g,'"').replace(/\\\//g,'/');
}
function extractDrns(v=''){
  const m=decodeRepeated(v).match(DRN_RE)||[];
  return unique(m.map(x=>x.toLowerCase()));
}
function extractReaderIds(v=''){
  const s=decodeRepeated(v),out=[];
  const patterns=[
    /sharing\/legacy\/(\d+)/ig,
    /read\.marvel\.com\/#\/book\/(\d+)/ig,
    /["'](?:digitalId|digital_id|digitalComicID|readerId|reader_id)["']\s*[:=]\s*["']?(\d+)/ig,
    /(?:digitalId|digitalComicID|readerId)%22%3A(?:%22)?(\d+)/ig,
  ];
  for(const re of patterns){let m;while((m=re.exec(s)))out.push(Number(m[1])||0)}
  return unique(out.filter(Boolean));
}

const normalize=v=>str(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
const normalizeSeries=v=>normalize(str(v).replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|present))?\s*\)/gi,' ')).replace(/^the\s+/,'').replace(/\s+comics?$/,'').trim();
const normalizeIssue=v=>{let s=str(v).trim().toUpperCase().replace(/\s+/g,'');if(/^0+\d+$/.test(s))s=String(Number(s));return s};
const tokenScore=(a,b)=>{
  const A=new Set(normalizeSeries(a).split(' ').filter(Boolean)),B=new Set(normalizeSeries(b).split(' ').filter(Boolean));
  if(!A.size||!B.size)return 0;
  let n=0;for(const t of A)if(B.has(t))n++;
  return n/Math.max(A.size,B.size);
};
function plainHtml(html=''){
  return decodeHtml(str(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
}
function pageTitle(html=''){
  return decodeHtml(str(html).match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    ||str(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'')
    .replace(/\s*\|\s*Comic Issues\s*\|\s*Marvel.*$/i,'').trim();
}
function parseIssueTitle(title=''){
  const m=decodeHtml(title).trim().match(/^(.*?)\s*(?:\(\s*(\d{4})(?:\s*-\s*(?:\d{4}|present))?\s*\))?\s*#\s*([^\s|]+)/i);
  return m?{series:m[1].trim(),year:m[2]||'',issue:m[3].trim()}:null;
}
function sameIdentity(local,title){
  const p=parseIssueTitle(title);if(!p)return false;
  if(normalizeIssue(p.issue)!==normalizeIssue(local.issueNumber))return false;
  if(local.seriesYear&&p.year&&String(local.seriesYear)!==String(p.year))return false;
  const a=normalizeSeries(local.title),b=normalizeSeries(p.series);if(!a||!b)return false;
  return a===b||a.includes(b)||b.includes(a)||tokenScore(a,b)>=0.82;
}
function availability(html=''){
  const t=plainHtml(html).toLowerCase();
  const strongMu=/members get unlimited access to this issue/.test(t)||/get unlimited access to this issue/.test(t);
  const muMention=/marvel unlimited/.test(t);
  const noDigital=/digital issue (?:is )?not currently available/.test(t)||/digital edition (?:is )?not currently available/.test(t);
  if(strongMu&&!noDigital)return{state:'mu',strongMu,muMention,noDigital};
  if(noDigital&&!strongMu)return{state:'no-digital',strongMu,muMention,noDigital};
  if(strongMu&&noDigital)return{state:'conflict',strongMu,muMention,noDigital};
  return{state:'unknown',strongMu,muMention,noDigital};
}
function snippetsAround(text='',terms=['purchaseMobileUrl','applink.marvel.com','digitalComicID','readerUrl','sharing/legacy','smart.link','unison','drn','graphql','/api/']){
  const raw=normalizedEmbedded(text),lower=raw.toLowerCase(),out=[];
  for(const term of terms){
    let from=0,count=0;
    while(count<3){
      const i=lower.indexOf(term.toLowerCase(),from);if(i<0)break;
      const a=Math.max(0,i-180),b=Math.min(raw.length,i+term.length+300);
      out.push({term,snippet:raw.slice(a,b).replace(/\s+/g,' ').trim()});
      from=i+term.length;count++;
    }
  }
  return out.slice(0,24);
}
function isMarvelControlledHost(host=''){
  const h=str(host).toLowerCase();
  return h==='marvel.com'||h.endsWith('.marvel.com')||h==='marvel.smart.link'||h.endsWith('.smart.link');
}
function isTraceableMarketingHost(host=''){
  const h=str(host).toLowerCase();
  return isMarvelControlledHost(h)||h.endsWith('.onelink.me')||h.endsWith('.app.link')||h.endsWith('.adjust.com')||h.endsWith('.appsflyer.com');
}
function isTerminalStoreHost(host=''){
  const h=str(host).toLowerCase();
  return h==='itunes.apple.com'||h==='apps.apple.com'||h==='play.google.com';
}
function absoluteUrls(text=''){
  const s=normalizedEmbedded(text),out=[];
  const re=/https?:\/\/[^"'<>\\\s)]+/ig;let m;
  while((m=re.exec(s))){
    try{const u=new URL(m[0]);out.push(u.toString())}catch{}
  }
  return unique(out);
}
function officialScriptUrls(html=''){
  return absoluteUrls(html)
    .filter(u=>{try{const x=new URL(u);return x.hostname==='assets-cdn.marvel.com'&&/\.js(?:$|\?)/i.test(x.pathname+x.search)}catch{return false}})
    .filter(u=>/comics-issue|_manifest|runtime/i.test(u))
    .slice(0,4);
}
function targetEmbeddedEvidence(html,target){
  const s=normalizedEmbedded(html),id=String(target.readerId);
  const expectedReader=`https://read.marvel.com/#/book/${id}`;
  const expectedApplink=`${APPLINK_BASE}${id}`;
  const readerIndex=s.indexOf(expectedReader);
  const digitalIndex=s.search(new RegExp(`["']digitalComicID["']\\s*:\\s*["']${id}["']`,'i'));
  const index=readerIndex>=0?readerIndex:digitalIndex;
  const window=index>=0?s.slice(Math.max(0,index-3500),Math.min(s.length,index+3500)):'';
  const purchaseUrl=(window.match(new RegExp(`https://comicstore\\.marvel\\.com/[^"'<>\\\\s]*?/digital-comic/${id}(?=["'\\\\s<]|$)`,'i'))||[])[0]||'';
  return{
    found:index>=0,
    readerUrlExposed:s.includes(expectedReader),
    applinkExposed:s.includes(expectedApplink),
    expectedReaderUrl:expectedReader,
    expectedApplinkUrl:expectedApplink,
    purchaseUrl,
    inMuInTargetWindow:/"inMU"\s*:\s*true/i.test(window),
    pagesCount:Number((window.match(/"pagesCount"\s*:\s*(\d+)/i)||[])[1]||0),
    targetWindowDrns:extractDrns(window),
    snippet:index>=0?window.replace(/\s+/g,' ').slice(0,7000):'',
  };
}

async function request(url,{redirect='manual',tries=4,accept='text/html,application/xhtml+xml,*/*;q=0.8'}={}){
  let lastError='',lastStatus=0;
  for(let attempt=1;attempt<=tries;attempt++){
    try{
      const r=await fetch(url,{redirect,headers:{'User-Agent':UA,'Accept':accept,'Accept-Language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(25000)});
      lastStatus=Number(r.status)||0;
      const location=r.headers.get('location')||'',contentType=r.headers.get('content-type')||'';
      let body='';if(![204,304].includes(r.status)){try{body=await r.text()}catch{}}
      const transient=r.status===403||r.status===429||r.status>=500;
      if(transient&&attempt<tries){
        const retry=Number(r.headers.get('retry-after')||0);
        await sleep(retry?Math.min(30000,retry*1000):Math.min(12000,900*(2**(attempt-1))));
        continue;
      }
      return{ok:r.ok,status:r.status,url:r.url||url,location,contentType,body,transient,attempts:attempt,error:''};
    }catch(e){
      lastError=e?.message||String(e);
      if(attempt<tries){await sleep(Math.min(12000,900*(2**(attempt-1))));continue}
    }
  }
  return{ok:false,status:lastStatus,url,location:'',contentType:'',body:'',transient:true,attempts:tries,error:lastError||'network'};
}
function safeHost(url=''){try{return new URL(url).hostname}catch{return''}}
function compactRoute(label,url,res,{bodyEvidence=false}={}){
  const body=res.body||'';
  return{
    label,url,status:Number(res.status)||0,finalUrl:res.url||url,location:res.location||'',
    transient:Boolean(res.transient),attempts:Number(res.attempts)||0,error:res.error||'',
    drns:unique([...extractDrns(res.url),...extractDrns(res.location),...(isMarvelControlledHost(safeHost(url))?extractDrns(body):[])]),
    readerIds:isMarvelControlledHost(safeHost(url))?extractReaderIds(body):[],
    snippets:bodyEvidence?snippetsAround(body):[],
  };
}
async function traceRedirectChain(label,startUrl,{maxHops=8,bodyEvidence=false}={}){
  const routes=[],candidateValues=[];
  let current=startUrl;
  for(let hop=0;hop<maxHops;hop++){
    const res=await request(current,{redirect:'manual',tries:4});
    const route=compactRoute(`${label}-hop-${hop+1}`,current,res,{bodyEvidence:bodyEvidence&&hop===0});
    routes.push(route);
    candidateValues.push({value:res.url||current,emittedBy:safeHost(current),kind:'response-url'});
    candidateValues.push({value:res.location||'',emittedBy:safeHost(current),kind:'location'});
    if(isMarvelControlledHost(safeHost(current)))candidateValues.push({value:res.body||'',emittedBy:safeHost(current),kind:'body'});
    if(res.transient||!res.status||res.status<300||res.status>=400||!res.location)break;
    let next='';try{next=new URL(res.location,current).toString()}catch{break}
    const host=safeHost(next);
    if(isTerminalStoreHost(host))break;
    if(!isTraceableMarketingHost(host))break;
    current=next;
    await sleep(180);
  }
  return{routes,candidateValues,transient:routes.some(r=>r.transient||!r.status)};
}
function addCandidate(map,value,method,route,{provenance='target-bound'}={}){
  for(const drn of extractDrns(value)){
    if(!DRN_EXACT_RE.test(drn))continue;
    const item=map.get(drn)||{drn,methods:[],routes:[],provenance:[],verification:null,accepted:false};
    if(!item.methods.includes(method))item.methods.push(method);
    if(route&&!item.routes.includes(route))item.routes.push(route);
    if(!item.provenance.includes(provenance))item.provenance.push(provenance);
    map.set(drn,item);
  }
}
function addTraceCandidates(map,trace,method){
  for(const item of trace.candidateValues){
    addCandidate(map,item.value,method,`${method}:${item.kind}`,{provenance:`target-bound:${item.emittedBy||'unknown'}`});
  }
}
async function verifySmartlink(sourceId,drn){
  const url=`${SMART_BASE}?type=issue&drn=${encodeURIComponent(drn)}&sourceId=${encodeURIComponent(String(sourceId))}`;
  const res=await request(url,{redirect:'manual',tries:4});
  const status=Number(res.status)||0,location=res.location||'';
  const hard=[404,410].includes(status);
  const operational=!hard&&!res.transient&&((status>=200&&status<300)||(status>=300&&status<400&&Boolean(location)));
  return{
    operational,hard,retryable:!hard&&!operational,url,
    check:compactRoute('verify-smartlink-manual',url,res),
    note:'La respuesta del smartlink sólo prueba operatividad; la identidad del DRN exige procedencia target-bound.',
  };
}

async function loadLocalTargets(){
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'marvel-seven-'));
  try{
    await extract(archiveFile,{dir:tmp});
    const dataDir=path.join(tmp,'data');
    const meta=JSON.parse(await fs.readFile(path.join(dataDir,'meta.json'),'utf8'));
    const series=JSON.parse(await fs.readFile(path.join(dataDir,'series.json'),'utf8'));
    const seriesMap=new Map(series.map(s=>[Number(s.id),s]));
    const wanted=new Set(TARGETS.map(t=>t.gcdId)),found=new Map();
    for(const chunk of meta.chunks||[]){
      const rows=JSON.parse(await fs.readFile(path.join(dataDir,chunk.file),'utf8'));
      for(const x of rows){
        const gcdId=Number(x.id)||0;if(!wanted.has(gcdId))continue;
        const s=seriesMap.get(Number(x.s))||{};
        found.set(gcdId,{gcdId,title:str(s.original||s.es||''),issueNumber:str(x.n),seriesYear:str(x.a||s.year||s.y),date:str(x.sv||x.d),seriesId:Number(x.s)||0});
      }
      if(found.size===wanted.size)break;
    }
    if(found.size!==TARGETS.length)throw new Error(`El ZIP local sólo permitió identificar ${found.size}/${TARGETS.length} objetivos.`);
    return found;
  }finally{await fs.rm(tmp,{recursive:true,force:true})}
}
function validateCache(pack){
  if(Number(pack.version)<3||!pack.officialCoverageAudit?.completed||Number(pack.officialCoverageAudit?.version)<3)throw new Error('La caché no conserva una auditoría oficial V3 completada.');
  if(Number(pack.localCount)!==EXPECTED_TOTAL||!Array.isArray(pack.entries)||pack.entries.length!==EXPECTED_TOTAL)throw new Error('La caché no contiene exactamente 51.002 entradas.');
  if(Number(pack.matched)!==EXPECTED_MATCHED)throw new Error(`matched inesperado: ${pack.matched}`);
  if(Number(pack.linkReady)!==EXPECTED_LINK_READY||Number(pack.linkMissing)!==EXPECTED_LINK_MISSING)throw new Error(`Estado de deeplinks inesperado: linkReady=${pack.linkReady}, linkMissing=${pack.linkMissing}`);

  const targetMap=new Map(TARGETS.map(t=>[t.gcdId,t])),missing=[];
  for(let i=0;i<pack.entries.length;i++){
    const row=pack.entries[i],status=Number(row?.[3]),drn=str(row?.[5]);
    if(status===STATUS_MU_LINK_MISSING||(status===STATUS_MU&&!DRN_EXACT_RE.test(drn))){
      missing.push({index:i,gcdId:Number(row?.[0])||0,sourceId:Number(row?.[1])||0,readerId:Number(row?.[2])||0,status,drn});
    }
  }
  if(missing.length!==TARGETS.length)throw new Error(`Hay ${missing.length} entradas Unlimited sin DRN, no exactamente 7.`);
  for(const m of missing){
    const expected=targetMap.get(m.gcdId);if(!expected)throw new Error(`Apareció un pendiente fuera de allowlist: GCD ${m.gcdId}.`);
    if(m.sourceId!==expected.sourceId||m.readerId!==expected.readerId)throw new Error(`Fingerprint alterado para GCD ${m.gcdId}: sourceId=${m.sourceId}, readerId=${m.readerId}.`);
    if(m.drn)throw new Error(`GCD ${m.gcdId} ya contiene un DRN no vacío; se aborta para no pisarlo.`);
  }
  for(const t of TARGETS)if(!missing.some(m=>m.gcdId===t.gcdId))throw new Error(`Falta el objetivo esperado GCD ${t.gcdId}.`);
  return missing;
}

const staticScriptCache=new Map();
async function inspectStaticScript(url){
  if(staticScriptCache.has(url))return staticScriptCache.get(url);
  const promise=(async()=>{
    const res=await request(url,{redirect:'follow',tries:3,accept:'application/javascript,text/javascript,*/*;q=0.8'});
    return{
      url,status:Number(res.status)||0,finalUrl:res.url||url,transient:Boolean(res.transient),error:res.error||'',
      snippets:snippetsAround(res.body||'',['purchaseMobileUrl','applink','digitalComicID','readerUrl','sharing/legacy','smart.link','unison','drn','graphql','/api/']).slice(0,20),
    };
  })();
  staticScriptCache.set(url,promise);return promise;
}

async function investigateOne(target,local){
  const candidates=new Map(),routes=[];
  const issueUrl=ISSUE_BASE+encodeURIComponent(String(target.sourceId));
  const official=await request(issueUrl,{redirect:'follow',tries:4});
  const officialRoute=compactRoute('official-issue',issueUrl,official,{bodyEvidence:true});
  routes.push(officialRoute);
  const html=official.body||'',title=pageTitle(html),identityMatch=sameIdentity(local,title),av=availability(html);
  const embedded=targetEmbeddedEvidence(html,target);
  for(const drn of embedded.targetWindowDrns)addCandidate(candidates,drn,'official-target-record','official-target-record',{provenance:'target-bound:official-issue-json'});

  const legacyTrace=await traceRedirectChain('legacy-target',LEGACY_BASE+encodeURIComponent(String(target.readerId)),{bodyEvidence:true});
  routes.push(...legacyTrace.routes);addTraceCandidates(candidates,legacyTrace,'legacy-target');

  let applinkTrace=null;
  if(embedded.applinkExposed){
    applinkTrace=await traceRedirectChain('applink-target',embedded.expectedApplinkUrl,{bodyEvidence:true});
    routes.push(...applinkTrace.routes);addTraceCandidates(candidates,applinkTrace,'applink-target');
  }

  const smartSource=`${SMART_BASE}?type=issue&sourceId=${encodeURIComponent(String(target.sourceId))}`;
  const smartTrace=await traceRedirectChain('smartlink-sourceId',smartSource,{bodyEvidence:true});
  routes.push(...smartTrace.routes);addTraceCandidates(candidates,smartTrace,'smartlink-sourceId');

  const readUrl=`${READ_BASE}#/book/${encodeURIComponent(String(target.readerId))}`;
  const readRes=await request(readUrl,{redirect:'follow',tries:3});
  routes.push(compactRoute('read-marvel-target',readUrl,readRes,{bodyEvidence:true}));
  if(isMarvelControlledHost(safeHost(readRes.url||readUrl))){
    addCandidate(candidates,readRes.body||'','read-marvel-target','read-marvel-target',{provenance:'target-bound:reader-url'});
  }

  let purchaseTrace=null;
  if(embedded.purchaseUrl){
    purchaseTrace=await traceRedirectChain('comicstore-target',embedded.purchaseUrl,{bodyEvidence:true});
    routes.push(...purchaseTrace.routes);addTraceCandidates(candidates,purchaseTrace,'comicstore-target');
  }

  const scriptEvidence=[];
  for(const scriptUrl of officialScriptUrls(html).slice(0,2)){
    scriptEvidence.push(await inspectStaticScript(scriptUrl));
  }

  for(const item of candidates.values()){
    item.verification=await verifySmartlink(target.sourceId,item.drn);
    item.accepted=item.provenance.some(p=>p.startsWith('target-bound:'))&&item.verification.operational===true;
    await sleep(250);
  }

  const accepted=[...candidates.values()].filter(c=>c.accepted);
  const acceptedDrns=unique(accepted.map(c=>c.drn));
  const resolvedDrn=identityMatch&&av.state==='mu'&&embedded.found&&embedded.readerUrlExposed&&acceptedDrns.length===1?acceptedDrns[0]:'';
  const essentialTransient=Boolean(official.transient||legacyTrace.transient||(applinkTrace?.transient)||smartTrace.transient||(purchaseTrace?.transient));

  let outcome='unresolved-target-drn-not-exposed';
  if(!identityMatch)outcome='identity-mismatch';
  else if(av.state==='no-digital')outcome='official-no-digital';
  else if(av.state==='conflict')outcome='official-availability-conflict';
  else if(av.state!=='mu'||!embedded.inMuInTargetWindow)outcome='official-unlimited-not-proven';
  else if(resolvedDrn)outcome='resolved';
  else if(acceptedDrns.length>1)outcome='multiple-authentic-target-drn';
  else if(essentialTransient)outcome='transient';

  const allPageReaderIds=unique(extractReaderIds(html));
  return{
    gcdId:target.gcdId,sourceId:target.sourceId,readerId:target.readerId,local,
    official:{
      url:issueUrl,status:officialRoute.status,finalUrl:officialRoute.finalUrl,title,identityMatch,availability:av,
      targetEmbedded:embedded,
      allPageReaderIds,
      neighbourReaderIds:allPageReaderIds.filter(id=>id!==target.readerId),
      note:'Los neighbourReaderIds se registran sólo como contexto y nunca se consultan para obtener candidatos DRN.',
      snippets:officialRoute.snippets,
    },
    routes,
    staticScriptEvidence:scriptEvidence,
    candidates:[...candidates.values()],
    acceptedDrns,
    resolvedDrn,
    outcome,
    coverageCorrectionRecommended:identityMatch&&av.state==='no-digital',
  };
}

await fs.mkdir(reportDir,{recursive:true});
const pack=JSON.parse(await fs.readFile(cacheFile,'utf8'));
const missing=validateCache(pack);
const localMap=await loadLocalTargets();
console.log(`Investigación aislada v2: ${missing.length} objetivos; 25.322 deeplinks previos quedan fuera del alcance.`);

const results=[];
for(const [i,target] of TARGETS.entries()){
  const local=localMap.get(target.gcdId);
  console.log(`[${i+1}/${TARGETS.length}] GCD=${target.gcdId} · ${local.title} #${local.issueNumber} · sourceId=${target.sourceId} · readerId=${target.readerId}`);
  const result=await investigateOne(target,local);
  results.push(result);
  console.log(`  -> ${result.outcome}${result.resolvedDrn?` · ${result.resolvedDrn}`:''}`);
  await sleep(500);
}

const summary={
  total:results.length,
  identityMatched:results.filter(r=>r.official.identityMatch).length,
  unlimitedConfirmed:results.filter(r=>r.official.availability.state==='mu'&&r.official.targetEmbedded.inMuInTargetWindow).length,
  noDigitalConfirmed:results.filter(r=>r.official.availability.state==='no-digital').length,
  applinkExposed:results.filter(r=>r.official.targetEmbedded.applinkExposed).length,
  resolved:results.filter(r=>r.outcome==='resolved').length,
  unresolved:results.filter(r=>r.outcome!=='resolved').length,
  transient:results.filter(r=>r.outcome==='transient').length,
  coverageCorrectionsRecommended:results.filter(r=>r.coverageCorrectionRecommended).length,
  authenticTargetDrnCandidates:results.reduce((n,r)=>n+r.acceptedDrns.length,0),
};
const report={
  version:2,
  generatedAt:new Date().toISOString(),
  mode:'research-only',
  cacheGuards:{localCount:pack.localCount,matched:pack.matched,linkReady:pack.linkReady,linkMissing:pack.linkMissing,expectedPending:TARGETS},
  writesCache:false,
  summary,
  results,
};
await fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
console.log(`Informe: ${reportFile}`);
