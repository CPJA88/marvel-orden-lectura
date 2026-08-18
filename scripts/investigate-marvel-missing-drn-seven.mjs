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
const STATUS_MU=1;
const STATUS_MU_LINK_MISSING=5;
const DRN_RE=/drn:src:marvel:unison::prod:[0-9a-f-]{36}/ig;
const DRN_EXACT_RE=/^drn:src:marvel:unison::prod:[0-9a-f-]{36}$/i;
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1';
const EXPECTED_TOTAL=51002;
const EXPECTED_MATCHED=25329;
const EXPECTED_LINK_READY=25322;
const EXPECTED_LINK_MISSING=7;

// Allowlist cerrada. Este script aborta si la caché no coincide exactamente con estos siete casos.
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
const normalize=v=>str(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
const normalizeSeries=v=>normalize(str(v).replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|present))?\s*\)/gi,' ')).replace(/^the\s+/,'').replace(/\s+comics?$/,'').trim();
const normalizeIssue=v=>{let s=str(v).trim().toUpperCase().replace(/\s+/g,'');if(/^0+\d+$/.test(s))s=String(Number(s));return s};
const tokenScore=(a,b)=>{const A=new Set(normalizeSeries(a).split(' ').filter(Boolean)),B=new Set(normalizeSeries(b).split(' ').filter(Boolean));if(!A.size||!B.size)return 0;let n=0;for(const t of A)if(B.has(t))n++;return n/Math.max(A.size,B.size)};

function unique(values){return [...new Set(values.filter(Boolean))]}
function extractDrns(v=''){
  const m=decodeRepeated(v).match(DRN_RE)||[];
  return unique(m.map(x=>x.toLowerCase()));
}
function extractReaderIds(v=''){
  const s=decodeRepeated(v),out=[];
  const patterns=[
    /sharing\/legacy\/(\d+)/ig,
    /read\.marvel\.com\/#\/book\/(\d+)/ig,
    /["'](?:digitalId|digital_id|readerId|reader_id)["']\s*[:=]\s*["']?(\d+)/ig,
    /(?:digitalId|readerId)%22%3A(?:%22)?(\d+)/ig,
  ];
  for(const re of patterns){let m;while((m=re.exec(s)))out.push(Number(m[1])||0)}
  return unique(out.filter(Boolean));
}
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
  const readMention=/read (?:this )?(?:issue|comic)|read now/.test(t);
  const noDigital=/digital issue (?:is )?not currently available/.test(t)||/digital edition (?:is )?not currently available/.test(t);
  if(strongMu&&!noDigital)return{state:'mu',strongMu,muMention,readMention,noDigital};
  if(noDigital&&!strongMu)return{state:'no-digital',strongMu,muMention,readMention,noDigital};
  if(strongMu&&noDigital)return{state:'conflict',strongMu,muMention,readMention,noDigital};
  return{state:'unknown',strongMu,muMention,readMention,noDigital};
}
function snippetsAround(text='',terms=['drn','digitalId','readerId','marvel unlimited','sharing/legacy','read.marvel.com','smart.link']){
  const raw=decodeRepeated(text),lower=raw.toLowerCase(),out=[];
  for(const term of terms){
    let from=0,count=0;
    while(count<4){
      const i=lower.indexOf(term.toLowerCase(),from);if(i<0)break;
      const a=Math.max(0,i-180),b=Math.min(raw.length,i+term.length+260);
      out.push({term,snippet:raw.slice(a,b).replace(/\s+/g,' ').trim()});
      from=i+term.length;count++;
    }
  }
  return out.slice(0,24);
}
function isAllowedHost(host=''){
  const h=str(host).toLowerCase();
  return h==='marvel.com'||h.endsWith('.marvel.com')||h==='marvel.smart.link'||h.endsWith('.smart.link');
}
function interestingUrls(html='',baseUrl=''){
  const out=[];let m;
  const attr=/(?:href|src|content)\s*=\s*["']([^"']+)["']/ig;
  while((m=attr.exec(html))){
    const raw=decodeRepeated(m[1]);
    if(!/(marvel|smart\.link|sharing\/legacy|read|digital|unison|graphql|\/api\/)/i.test(raw))continue;
    try{
      const u=new URL(raw,baseUrl||'https://www.marvel.com');
      if(!['http:','https:'].includes(u.protocol)||!isAllowedHost(u.hostname))continue;
      out.push(u.toString());
    }catch{}
  }
  const absolute=/https?:\\?\/\\?\/[^"'<>\s)]+/ig;
  while((m=absolute.exec(html))){
    const raw=decodeRepeated(m[0].replace(/\\\//g,'/'));
    if(!/(marvel|smart\.link|sharing\/legacy|read|digital|unison|graphql|\/api\/)/i.test(raw))continue;
    try{const u=new URL(raw);if(isAllowedHost(u.hostname))out.push(u.toString())}catch{}
  }
  return unique(out).slice(0,40);
}
function sourceIdFromUrl(v=''){
  try{return Number(new URL(v,'https://www.marvel.com').pathname.match(/\/comics\/issue\/(\d+)/i)?.[1]||0)}catch{return 0}
}

async function request(url,{redirect='manual',tries=4,accept='text/html,application/xhtml+xml,*/*;q=0.8'}={}){
  let lastError='',lastStatus=0;
  for(let attempt=1;attempt<=tries;attempt++){
    try{
      const r=await fetch(url,{redirect,headers:{'User-Agent':UA,'Accept':accept,'Accept-Language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(25000)});
      lastStatus=Number(r.status)||0;
      const location=r.headers.get('location')||'';
      const contentType=r.headers.get('content-type')||'';
      let body='';
      if(![204,304].includes(r.status)){try{body=await r.text()}catch{}}
      const transient=r.status===403||r.status===429||r.status>=500;
      if(transient&&attempt<tries){
        const retry=Number(r.headers.get('retry-after')||0);
        await sleep(retry?Math.min(30000,retry*1000):Math.min(12000,1000*(2**(attempt-1))));
        continue;
      }
      return{ok:r.ok,status:r.status,url:r.url||url,location,contentType,body,transient,attempts:attempt,error:''};
    }catch(e){
      lastError=e?.message||String(e);
      if(attempt<tries){await sleep(Math.min(12000,1000*(2**(attempt-1))));continue}
    }
  }
  return{ok:false,status:lastStatus,url,location:'',contentType:'',body:'',transient:true,attempts:tries,error:lastError||'network'};
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

  const targetMap=new Map(TARGETS.map(t=>[t.gcdId,t]));
  const missing=[];
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
  for(const t of TARGETS){if(!missing.some(m=>m.gcdId===t.gcdId))throw new Error(`Falta el objetivo esperado GCD ${t.gcdId}.`)}
  return missing;
}

function addCandidate(map,value,method,route){
  for(const drn of extractDrns(value)){
    if(!DRN_EXACT_RE.test(drn))continue;
    const item=map.get(drn)||{drn,methods:[],routes:[],verification:null};
    if(!item.methods.includes(method))item.methods.push(method);
    if(route&&!item.routes.includes(route))item.routes.push(route);
    map.set(drn,item);
  }
}
function compactRoute(label,url,res,{includeBodyEvidence=false}={}){
  const body=res.body||'';
  return{
    label,url,status:Number(res.status)||0,finalUrl:res.url||url,location:res.location||'',transient:Boolean(res.transient),attempts:Number(res.attempts)||0,error:res.error||'',
    drns:unique([...extractDrns(res.url),...extractDrns(res.location),...extractDrns(body)]),
    readerIds:extractReaderIds(body),
    interestingUrls:includeBodyEvidence?interestingUrls(body,res.url||url):[],
    snippets:includeBodyEvidence?snippetsAround(body):[],
  };
}
async function inspectRoute(label,url,{follow=false,includeBodyEvidence=false}={}){
  const res=await request(url,{redirect:follow?'follow':'manual',tries:4});
  return{res,route:compactRoute(label,url,res,{includeBodyEvidence})};
}
async function verifyCandidate(sourceId,drn){
  const url=`${SMART_BASE}?type=issue&drn=${encodeURIComponent(drn)}&sourceId=${encodeURIComponent(String(sourceId))}`;
  const manual=await request(url,{redirect:'manual',tries:4});
  const hard=[404,410].includes(Number(manual.status));
  if(hard)return{ok:false,hard:true,retryable:false,url,manual:compactRoute('verify-smartlink-manual',url,manual),follow:null};
  if(manual.transient||!manual.status)return{ok:false,hard:false,retryable:true,url,manual:compactRoute('verify-smartlink-manual',url,manual),follow:null};
  const manualAccept=(manual.status>=200&&manual.status<300)||(manual.status>=300&&manual.status<400&&Boolean(manual.location));
  if(!manualAccept)return{ok:false,hard:false,retryable:true,url,manual:compactRoute('verify-smartlink-manual',url,manual),follow:null};
  const follow=await request(url,{redirect:'follow',tries:3});
  const followHard=[404,410].includes(Number(follow.status));
  const followAccept=!followHard&&!follow.transient&&Number(follow.status)>=200&&Number(follow.status)<400;
  return{ok:Boolean(followAccept),hard:followHard,retryable:!followAccept&&!followHard,url,manual:compactRoute('verify-smartlink-manual',url,manual),follow:compactRoute('verify-smartlink-follow',url,follow)};
}

async function investigateOne(target,local){
  const candidates=new Map(),routes=[];
  const issueUrl=ISSUE_BASE+encodeURIComponent(String(target.sourceId));

  const officialFollow=await inspectRoute('official-issue-follow',issueUrl,{follow:true,includeBodyEvidence:true});
  routes.push(officialFollow.route);
  const html=officialFollow.res.body||'';
  const title=pageTitle(html),identityMatch=sameIdentity(local,title),av=availability(html);
  addCandidate(candidates,officialFollow.res.url,'official-final-url','official-issue-follow');
  addCandidate(candidates,officialFollow.res.location,'official-location','official-issue-follow');
  addCandidate(candidates,html,'official-html','official-issue-follow');

  const officialManual=await inspectRoute('official-issue-manual',issueUrl,{follow:false,includeBodyEvidence:false});
  routes.push(officialManual.route);
  addCandidate(candidates,officialManual.res.url,'official-manual-url','official-issue-manual');
  addCandidate(candidates,officialManual.res.location,'official-manual-location','official-issue-manual');
  addCandidate(candidates,officialManual.res.body,'official-manual-body','official-issue-manual');

  const pageReaderIds=unique([target.readerId,...extractReaderIds(html),...officialManual.route.readerIds]).slice(0,8);
  for(const readerId of pageReaderIds){
    const legacyUrl=LEGACY_BASE+encodeURIComponent(String(readerId));
    for(const follow of [false,true]){
      const x=await inspectRoute(`legacy-reader-${readerId}-${follow?'follow':'manual'}`,legacyUrl,{follow,includeBodyEvidence:false});
      routes.push(x.route);
      addCandidate(candidates,x.res.url,`legacy-reader-${readerId}`,x.route.label);
      addCandidate(candidates,x.res.location,`legacy-reader-${readerId}`,x.route.label);
      addCandidate(candidates,x.res.body,`legacy-reader-${readerId}`,x.route.label);
      await sleep(250);
    }
  }

  const smartSourceUrl=`${SMART_BASE}?type=issue&sourceId=${encodeURIComponent(String(target.sourceId))}`;
  for(const follow of [false,true]){
    const x=await inspectRoute(`smartlink-sourceId-${follow?'follow':'manual'}`,smartSourceUrl,{follow,includeBodyEvidence:false});
    routes.push(x.route);
    addCandidate(candidates,x.res.url,'smartlink-sourceId',x.route.label);
    addCandidate(candidates,x.res.location,'smartlink-sourceId',x.route.label);
    addCandidate(candidates,x.res.body,'smartlink-sourceId',x.route.label);
    await sleep(250);
  }

  // Sólo seguimos URLs oficiales/smartlink descubiertas en la propia página de este issue.
  const discovered=unique(officialFollow.route.interestingUrls)
    .filter(u=>u!==issueUrl&&sourceIdFromUrl(u)!==target.sourceId)
    .filter(u=>/(sharing\/legacy|read\.marvel\.com|smart\.link|digital|unison|graphql|\/api\/)/i.test(u))
    .slice(0,12);
  for(const url of discovered){
    const x=await inspectRoute('official-discovered-route',url,{follow:false,includeBodyEvidence:false});
    routes.push(x.route);
    addCandidate(candidates,x.res.url,'official-discovered-route',url);
    addCandidate(candidates,x.res.location,'official-discovered-route',url);
    addCandidate(candidates,x.res.body,'official-discovered-route',url);
    await sleep(300);
  }

  // El reader web se inspecciona sólo con el readerId ya asociado oficialmente a este objetivo.
  const readUrl=`${READ_BASE}#/book/${encodeURIComponent(String(target.readerId))}`;
  const read=await inspectRoute('read-marvel-reader',readUrl,{follow:true,includeBodyEvidence:true});
  routes.push(read.route);
  addCandidate(candidates,read.res.url,'read-marvel-reader','read-marvel-reader');
  addCandidate(candidates,read.res.location,'read-marvel-reader','read-marvel-reader');
  addCandidate(candidates,read.res.body,'read-marvel-reader','read-marvel-reader');

  for(const item of candidates.values()){
    item.verification=await verifyCandidate(target.sourceId,item.drn);
    await sleep(350);
  }
  const verified=[...candidates.values()].filter(c=>c.verification?.ok===true);
  const transientRoutes=routes.filter(r=>r.transient||!r.status).length;
  const uniqueVerified=unique(verified.map(v=>v.drn));
  const resolvedDrn=identityMatch&&av.state==='mu'&&uniqueVerified.length===1?uniqueVerified[0]:'';

  let outcome='unresolved';
  if(!identityMatch)outcome='identity-mismatch';
  else if(av.state==='no-digital')outcome='official-no-digital';
  else if(av.state==='conflict')outcome='official-availability-conflict';
  else if(resolvedDrn)outcome='resolved';
  else if(av.state!=='mu')outcome='official-unlimited-not-proven';
  else if(uniqueVerified.length>1)outcome='multiple-verified-drn';
  else if(transientRoutes)outcome='transient';

  return{
    gcdId:target.gcdId,sourceId:target.sourceId,readerId:target.readerId,
    local,
    official:{url:issueUrl,status:officialFollow.route.status,finalUrl:officialFollow.route.finalUrl,title,identityMatch,availability:av,pageReaderIds,htmlDrns:extractDrns(html),interestingUrls:officialFollow.route.interestingUrls,snippets:officialFollow.route.snippets},
    routes,
    candidates:[...candidates.values()],
    verifiedDrns:uniqueVerified,
    resolvedDrn,
    outcome,
    coverageCorrectionRecommended:identityMatch&&av.state==='no-digital',
  };
}

await fs.mkdir(reportDir,{recursive:true});
const pack=JSON.parse(await fs.readFile(cacheFile,'utf8'));
const missing=validateCache(pack);
const localMap=await loadLocalTargets();
console.log(`Investigación aislada: ${missing.length} objetivos; 25.322 deeplinks previos quedan fuera del alcance.`);

const results=[];
for(const [i,target] of TARGETS.entries()){
  const local=localMap.get(target.gcdId);
  console.log(`[${i+1}/${TARGETS.length}] GCD=${target.gcdId} · ${local.title} #${local.issueNumber} · sourceId=${target.sourceId} · readerId=${target.readerId}`);
  const result=await investigateOne(target,local);
  results.push(result);
  console.log(`  -> ${result.outcome}${result.resolvedDrn?` · ${result.resolvedDrn}`:''}`);
  await sleep(700);
}

const summary={
  total:results.length,
  identityMatched:results.filter(r=>r.official.identityMatch).length,
  unlimitedConfirmed:results.filter(r=>r.official.availability.state==='mu').length,
  noDigitalConfirmed:results.filter(r=>r.official.availability.state==='no-digital').length,
  resolved:results.filter(r=>r.outcome==='resolved').length,
  unresolved:results.filter(r=>r.outcome!=='resolved').length,
  transient:results.filter(r=>r.outcome==='transient').length,
  coverageCorrectionsRecommended:results.filter(r=>r.coverageCorrectionRecommended).length,
  verifiedDrnCandidates:results.reduce((n,r)=>n+r.verifiedDrns.length,0),
};
const report={
  version:1,
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
