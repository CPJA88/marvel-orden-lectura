import fs from 'node:fs/promises';
import path from 'node:path';
import dns from 'node:dns/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileP=promisify(execFile);
const root=process.cwd();
const outDir=path.join(root,'artifacts','marvel-missing-drn-seven');
const outFile=path.join(outDir,'routing-v3.json');
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1';
const LEGACY='https://share.marvel.com/sharing/legacy/';
const APPLINK='https://applink.marvel.com/issue/';
const SMART='https://marvel.smart.link/fiir7ec77';
const DRN_RE=/drn:src:marvel:unison::prod:[0-9a-f-]{36}/ig;
const TARGETS=Object.freeze([
  {gcdId:29395,sourceId:78145,readerId:55204},
  {gcdId:29387,sourceId:78120,readerId:55203},
  {gcdId:60401,sourceId:18116,readerId:73928},
  {gcdId:338373,sourceId:2133,readerId:535},
  {gcdId:521503,sourceId:5888,readerId:6307},
  {gcdId:521504,sourceId:6037,readerId:6308},
  {gcdId:1244835,sourceId:49010,readerId:34127},
]);
// Control positivo ya resuelto previamente. Nunca se usa como candidato para ninguno de los siete.
const CONTROL=Object.freeze({readerId:60481,label:'known-working-legacy-control'});
const str=v=>v==null?'':String(v);
const unique=a=>[...new Set(a.filter(Boolean))];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function decode(v=''){
  let s=str(v).replace(/&amp;/gi,'&').replace(/\\u003A/gi,':').replace(/\\u002F/gi,'/').replace(/\\\//g,'/');
  for(let i=0;i<3;i++){try{const d=decodeURIComponent(s);if(d===s)break;s=d}catch{break}}
  return s;
}
function drns(v=''){return unique((decode(v).match(DRN_RE)||[]).map(x=>x.toLowerCase()))}
function snippets(text='',terms=[],radius=240){
  const s=decode(text),low=s.toLowerCase(),out=[];
  for(const term of terms){let from=0,n=0;while(n<4){const i=low.indexOf(term.toLowerCase(),from);if(i<0)break;out.push({term,snippet:s.slice(Math.max(0,i-radius),Math.min(s.length,i+term.length+radius)).replace(/\s+/g,' ').trim()});from=i+term.length;n++}}
  return out.slice(0,32);
}
function scriptUrls(html='',base='https://share.marvel.com'){
  const out=[];let m;const re=/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/ig;
  while((m=re.exec(html))){try{out.push(new URL(decode(m[1]),base).toString())}catch{}}
  return unique(out).filter(u=>/^https?:/i.test(u));
}
function endpointHints(js=''){
  const s=decode(js),out=[];
  const abs=/https?:\/\/[^"'`<>\s)]+/ig;let m;
  while((m=abs.exec(s))){if(/(?:api|sharing|unison|reader|smart\.link|marvel)/i.test(m[0]))out.push(m[0])}
  const rel=/["'`]((?:\/[^"'`\s]{1,180})?(?:sharing|api|unison|reader)[^"'`\s]{0,180})["'`]/ig;
  while((m=rel.exec(s)))out.push(m[1]);
  return unique(out).slice(0,60);
}
async function fetchText(url,tries=3){
  let last='';
  for(let i=0;i<tries;i++){
    try{
      const r=await fetch(url,{redirect:'follow',headers:{'User-Agent':UA,'Accept':'text/html,application/javascript,*/*;q=0.8'},signal:AbortSignal.timeout(20000)});
      const body=await r.text().catch(()=> '');
      return{ok:r.ok,status:r.status,url:r.url||url,body,error:'',cause:''};
    }catch(e){last=e?.message||String(e);const cause=e?.cause?.code||e?.cause?.message||'';if(i===tries-1)return{ok:false,status:0,url,body:'',error:last,cause:str(cause)};await sleep(500*(i+1))}
  }
  return{ok:false,status:0,url,body:'',error:last,cause:''};
}
function parseCurlHeaders(text=''){
  const blocks=str(text).split(/\r?\n\r?\n/).map(x=>x.trim()).filter(Boolean);
  const hops=[];
  for(const b of blocks){
    const lines=b.split(/\r?\n/);const first=lines[0]||'';const sm=first.match(/^HTTP\/\S+\s+(\d+)/i);if(!sm)continue;
    const locations=lines.filter(l=>/^location:/i.test(l)).map(l=>l.replace(/^location:\s*/i,'').trim());
    hops.push({status:Number(sm[1])||0,locations,drns:drns(b)});
  }
  return{hops,drns:drns(text),locations:unique(hops.flatMap(h=>h.locations))};
}
async function curlProbe(url,{ipv4=false,http11=false,label='' }={}){
  const args=['-sS','-D','-','-o','/dev/null','--max-redirs','0','--connect-timeout','10','--max-time','22','-A',UA];
  if(ipv4)args.unshift('-4');
  if(http11)args.unshift('--http1.1');
  args.push(url);
  try{
    const {stdout,stderr}=await execFileP('curl',args,{maxBuffer:1024*1024,timeout:30000});
    const parsed=parseCurlHeaders(stdout);
    return{label,url,exitCode:0,stderr:str(stderr).trim(),...parsed};
  }catch(e){
    const stdout=str(e?.stdout),stderr=str(e?.stderr);
    const parsed=parseCurlHeaders(stdout);
    return{label,url,exitCode:Number(e?.code)||-1,stderr:stderr.trim(),error:e?.message||String(e),...parsed};
  }
}
async function verifyTargetDrn(target,drn){
  const url=`${SMART}?type=issue&drn=${encodeURIComponent(drn)}&sourceId=${encodeURIComponent(String(target.sourceId))}`;
  const probe=await curlProbe(url,{ipv4:true,http11:true,label:'verify-smartlink'});
  const statuses=probe.hops.map(h=>h.status);
  const hard=statuses.includes(404)||statuses.includes(410);
  const operational=probe.exitCode===0&&!hard&&statuses.some(s=>s>=200&&s<400);
  return{operational,hard,url,probe};
}
async function inspectLegacy(readerId,label){
  const url=LEGACY+encodeURIComponent(String(readerId));
  const r=await fetchText(url,3);
  const html=r.body||'';
  return{
    label,readerId,url,status:r.status,finalUrl:r.url,error:r.error,cause:r.cause,
    drns:drns(html),
    snippets:snippets(html,['drn:src:marvel:unison','sharing/issue','sharing/legacy','sourceId','contentType','smart.link','__marvel_mu__']),
    scripts:scriptUrls(html,r.url||url),
    body:html,
  };
}
async function inspectBundle(url){
  const r=await fetchText(url,2),body=r.body||'';
  return{
    url,status:r.status,finalUrl:r.url,error:r.error,cause:r.cause,
    drns:drns(body),
    endpointHints:endpointHints(body),
    snippets:snippets(body,['sharing/legacy','sharing/issue','drn:src:marvel:unison','unison','sourceId','smart.link','contentType']),
  };
}

await fs.mkdir(outDir,{recursive:true});
const dnsInfo={};
for(const host of ['applink.marvel.com','comicstore.marvel.com','share.marvel.com','marvel.smart.link']){
  try{dnsInfo[host]={ok:true,addresses:await dns.lookup(host,{all:true})}}catch(e){dnsInfo[host]={ok:false,error:e?.message||String(e),code:e?.code||''}}
}

console.log('Routing v3: diagnóstico 7-only + un control positivo, sin escritura de caché.');
const control=await inspectLegacy(CONTROL.readerId,CONTROL.label);
const targetLegacy=await inspectLegacy(TARGETS[0].readerId,'target-55204');
const scriptSet=unique([...control.scripts,...targetLegacy.scripts]).slice(0,8);
const bundles=[];
for(const [i,url] of scriptSet.entries()){
  console.log(`Bundle ${i+1}/${scriptSet.length}: ${url}`);
  bundles.push(await inspectBundle(url));
}
// No persistimos HTML completo para mantener el artifact razonable.
delete control.body;delete targetLegacy.body;

const results=[];
for(const [i,t] of TARGETS.entries()){
  const applinkUrl=APPLINK+encodeURIComponent(String(t.readerId));
  console.log(`[${i+1}/7] curl applink GCD=${t.gcdId} readerId=${t.readerId}`);
  const probes=[];
  probes.push(await curlProbe(applinkUrl,{label:'curl-default'}));
  if(probes[0].exitCode!==0||!probes[0].hops.length)probes.push(await curlProbe(applinkUrl,{http11:true,label:'curl-http1.1'}));
  if(probes.every(p=>p.exitCode!==0||!p.hops.length))probes.push(await curlProbe(applinkUrl,{ipv4:true,http11:true,label:'curl-ipv4-http1.1'}));
  const authenticCandidates=unique(probes.flatMap(p=>[...p.drns,...p.locations.flatMap(drns)]));
  const verified=[];
  for(const d of authenticCandidates){verified.push({drn:d,verification:await verifyTargetDrn(t,d)})}
  results.push({...t,applinkUrl,probes,authenticCandidates,verified,acceptedDrns:verified.filter(x=>x.verification.operational).map(x=>x.drn)});
}

const acceptedTotal=results.reduce((n,r)=>n+r.acceptedDrns.length,0);
const report={
  version:3,
  generatedAt:new Date().toISOString(),
  mode:'research-only',
  writesCache:false,
  scope:{targets:TARGETS,control:{readerId:CONTROL.readerId,purpose:'routing regression only; never a target candidate'}},
  dns:dnsInfo,
  controlLegacy:control,
  targetLegacyExample:targetLegacy,
  bundles,
  results,
  summary:{targets:TARGETS.length,applinkWithHttpResponse:results.filter(r=>r.probes.some(p=>p.hops.length)).length,targetsWithAuthenticDrn:results.filter(r=>r.authenticCandidates.length).length,acceptedDrnCount:acceptedTotal},
};
await fs.writeFile(outFile,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.summary,null,2));
console.log(`Informe routing v3: ${outFile}`);
