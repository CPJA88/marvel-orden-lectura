import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const outDir=path.join(root,'artifacts','marvel-missing-drn-seven');
const outFile=path.join(outDir,'routing-v4.json');
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1';
const SHARE='https://share.marvel.com/sharing/';
const DRN_RE=/drn:src:marvel:unison::prod:[0-9a-f-]{36}/ig;
const TARGETS=Object.freeze([
  {gcdId:29395,sourceId:78145,readerId:55204,title:'Marvel Treasury Edition #13'},
  {gcdId:29387,sourceId:78120,readerId:55203,title:'Marvel Treasury Edition #9'},
  {gcdId:60401,sourceId:18116,readerId:73928,title:'X-Men Unlimited #15'},
  {gcdId:338373,sourceId:2133,readerId:535,title:'Last Hero Standing #1'},
  {gcdId:521503,sourceId:5888,readerId:6307,title:'Magician Apprentice #5'},
  {gcdId:521504,sourceId:6037,readerId:6308,title:'Magician Apprentice #6'},
  {gcdId:1244835,sourceId:49010,readerId:34127,title:'100th Anniversary Special: Avengers #1'},
]);
const CONTROL=Object.freeze({sourceId:80277,readerId:60481,title:'Marvel Treasury Edition #25'});
const str=v=>v==null?'':String(v);
const unique=a=>[...new Set(a.filter(Boolean))];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function decode(v=''){
  let s=str(v).replace(/&amp;/gi,'&').replace(/\\u003A/gi,':').replace(/\\u002F/gi,'/').replace(/\\\//g,'/');
  for(let i=0;i<3;i++){try{const d=decodeURIComponent(s);if(d===s)break;s=d}catch{break}}
  return s;
}
function drns(v=''){return unique((decode(v).match(DRN_RE)||[]).map(x=>x.toLowerCase()))}
function sourceIds(v=''){
  const s=decode(v),out=[];let m;
  const patterns=[/["']sourceId["']\s*:\s*["']?(\d+)["']?/ig,/sourceId=(\d+)/ig];
  for(const re of patterns){while((m=re.exec(s)))out.push(Number(m[1])||0)}
  return unique(out.filter(Boolean));
}
function ctaUrls(v=''){
  const s=decode(v),out=[];let m;
  const re=/https:\/\/marvel(?:-test)?\.smart\.link\/[^"'<>\s]+/ig;
  while((m=re.exec(s)))out.push(m[0].replace(/&quot;.*$/,''));
  return unique(out).slice(0,12);
}
function titleFromState(v=''){
  const s=decode(v);
  const m=s.match(/["']title["']\s*:\s*["']([^"']+)["']/i);
  return m?m[1]:'';
}
function snippets(text='',terms=[],radius=220){
  const s=decode(text),low=s.toLowerCase(),out=[];
  for(const term of terms){let from=0,n=0;while(n<3){const i=low.indexOf(term.toLowerCase(),from);if(i<0)break;out.push({term,snippet:s.slice(Math.max(0,i-radius),Math.min(s.length,i+term.length+radius)).replace(/\s+/g,' ').trim()});from=i+term.length;n++}}
  return out;
}
async function fetchText(url,tries=3){
  let last='';
  for(let i=0;i<tries;i++){
    try{
      const r=await fetch(url,{redirect:'follow',headers:{'User-Agent':UA,'Accept':'text/html,*/*;q=0.8'},signal:AbortSignal.timeout(20000)});
      const body=await r.text().catch(()=> '');
      return{status:r.status,finalUrl:r.url||url,body,error:'',cause:''};
    }catch(e){last=e?.message||String(e);if(i===tries-1)return{status:0,finalUrl:url,body:'',error:last,cause:e?.cause?.code||e?.cause?.message||''};await sleep(600*(i+1))}
  }
  return{status:0,finalUrl:url,body:'',error:last,cause:''};
}
function compactProbe(label,idKind,id,url,res,target){
  const body=res.body||'';
  const foundDrns=drns(body);
  const foundSourceIds=sourceIds(body);
  const ctas=ctaUrls(body);
  const exactSource=foundSourceIds.includes(Number(target.sourceId));
  const exactCtas=ctas.filter(u=>u.includes(`sourceId=${target.sourceId}`));
  const linkedDrns=unique(foundDrns.filter(d=>exactCtas.some(u=>decode(u).includes(d))));
  const accepted=exactSource&&linkedDrns.length===1?linkedDrns:[];
  return{
    label,idKind,id,url,status:res.status,finalUrl:res.finalUrl,error:res.error,cause:res.cause,
    pageTitle:titleFromState(body),sourceIds:foundSourceIds,drns:foundDrns,ctaUrls:ctas,
    exactSource,linkedDrns,acceptedDrns:accepted,
    snippets:snippets(body,['sourceId','drn:src:marvel:unison','smart.link','contentType','This content']),
  };
}
async function probeRoute(label,idKind,id,target){
  const url=`${SHARE}${label}/${encodeURIComponent(String(id))}`;
  const res=await fetchText(url,3);
  return compactProbe(label,idKind,id,url,res,target);
}
async function inspectTarget(target){
  const specs=[
    ['legacy','readerId',target.readerId],
    ['reader','readerId',target.readerId],
    ['issue','sourceId',target.sourceId],
    ['issue','readerId',target.readerId],
    ['reader','sourceId',target.sourceId],
  ];
  const probes=[];
  for(const [route,idKind,id] of specs){
    probes.push(await probeRoute(route,idKind,id,target));
    await sleep(250);
  }
  const accepted=unique(probes.flatMap(p=>p.acceptedDrns));
  return{...target,probes,acceptedDrns:accepted,resolvedDrn:accepted.length===1?accepted[0]:'',outcome:accepted.length===1?'resolved':accepted.length>1?'ambiguous':'unresolved'};
}

await fs.mkdir(outDir,{recursive:true});
console.log('Routing v4: prueba de /sharing/legacy, /sharing/reader y /sharing/issue; 7-only, sin escritura de caché.');
const control=await inspectTarget({...CONTROL,gcdId:0});
console.log(`Control positivo: ${control.outcome}${control.resolvedDrn?` · ${control.resolvedDrn}`:''}`);
const results=[];
for(const [i,t] of TARGETS.entries()){
  console.log(`[${i+1}/7] ${t.title} · sourceId=${t.sourceId} · readerId=${t.readerId}`);
  const r=await inspectTarget(t);
  results.push(r);
  console.log(`  -> ${r.outcome}${r.resolvedDrn?` · ${r.resolvedDrn}`:''}`);
}
const report={
  version:4,generatedAt:new Date().toISOString(),mode:'research-only',writesCache:false,
  control,
  results,
  summary:{
    targets:results.length,
    resolved:results.filter(r=>r.outcome==='resolved').length,
    unresolved:results.filter(r=>r.outcome==='unresolved').length,
    ambiguous:results.filter(r=>r.outcome==='ambiguous').length,
    routesWithExactSource:results.reduce((n,r)=>n+r.probes.filter(p=>p.exactSource).length,0),
    acceptedDrnCount:results.reduce((n,r)=>n+r.acceptedDrns.length,0),
  },
};
await fs.writeFile(outFile,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.summary,null,2));
console.log(`Informe routing v4: ${outFile}`);
