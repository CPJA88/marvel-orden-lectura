import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import extract from 'extract-zip';

const root=process.cwd();
const archive=path.join(root,'Marvel_Orden_de_Lectura_PWA.zip');
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const resultsFile=path.join(root,'artifacts','marvel-not-listed-v4','exact-v4-results.json');
const outFile=path.join(root,'artifacts','marvel-not-listed-v4','identity-mismatch-diagnostic.json');
const EXPECTED_MISMATCH=493;
const STATUS={MU:1,NO_DIGITAL:3,NOT_LISTED:4,MU_LINK_MISSING:5};

const str=v=>v==null?'':String(v);
const normalize=v=>str(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
const normalizeSeries=v=>normalize(str(v).replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|present))?\s*\)/gi,' ')).replace(/^the\s+/,'').replace(/\s+comics?$/,'').trim();
const normalizeIssue=v=>{let s=str(v).trim().toUpperCase().replace(/\s+/g,'');if(/^0+\d+$/.test(s))s=String(Number(s));return s};
const yearOf=v=>Number(str(v).match(/\b((?:19|20)\d{2})\b/)?.[1]||0);
const decodeHtml=v=>str(v).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)||32));
const parseIssueTitle=title=>{const clean=decodeHtml(title).replace(/\s*\|\s*Comic Issues\s*\|\s*Marvel.*$/i,'').trim();const m=clean.match(/^(.*?)\s*(?:\(\s*(\d{4})(?:\s*-\s*(?:\d{4}|present))?\s*\))?\s*#\s*([^\s|]+)/i);return m?{series:m[1].trim(),year:Number(m[2]||0),issue:m[3].trim()}:null};
const tokens=v=>new Set(normalizeSeries(v).split(/\s+/).filter(Boolean));
function jaccard(a,b){const A=tokens(a),B=tokens(b);if(!A.size&&!B.size)return 1;let hit=0;for(const x of A)if(B.has(x))hit++;return hit/(A.size+B.size-hit||1)}
function lexicalClass(expected,actual){const a=normalizeSeries(expected),b=normalizeSeries(actual);if(!a||!b)return'unknown';if(a===b)return'exact-normalized';if(a.includes(b)||b.includes(a))return'contained-title';const j=jaccard(expected,actual);if(j>=0.8)return'near-title-80';if(j>=0.6)return'near-title-60';return'different-series'}

async function loadLocal(){
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'marvel-mismatch-v4-'));
  try{
    await extract(archive,{dir:tmp});
    const data=path.join(tmp,'data');
    const [meta,series]=await Promise.all([
      fs.readFile(path.join(data,'meta.json'),'utf8').then(JSON.parse),
      fs.readFile(path.join(data,'series.json'),'utf8').then(JSON.parse),
    ]);
    const sm=new Map(series.map(s=>[Number(s.id),s])),byId=new Map();
    for(const c of meta.chunks||[])for(const x of JSON.parse(await fs.readFile(path.join(data,c.file),'utf8'))){
      const s=sm.get(Number(x.s))||{};
      byId.set(Number(x.id),{
        gcdId:Number(x.id),seriesId:Number(x.s),title:s.original||s.es||'',issueNumber:str(x.n),
        date:str(x.sv||x.d),seriesYear:str(x.a||s.year||s.y),
      });
    }
    return byId;
  } finally { await fs.rm(tmp,{recursive:true,force:true}); }
}

const [pack,research,local]=await Promise.all([
  fs.readFile(cacheFile,'utf8').then(JSON.parse),
  fs.readFile(resultsFile,'utf8').then(JSON.parse),
  loadLocal(),
]);
if(Number(pack.localCount)!==51002||pack.entries?.length!==51002)throw new Error('Caché local inválida.');
if(Number(pack.matched)!==28673||Number(pack.noDigital)!==1131||Number(pack.notListed)!==21198)throw new Error(`Baseline V4 publicada inesperada: ${pack.matched}/${pack.noDigital}/${pack.notListed}`);
if(Number(research?.version)!==4||!Array.isArray(research?.results)||Number(research?.summary?.identityMismatch)!==EXPECTED_MISMATCH)throw new Error('Resultado exact-v4 incompatible.');

const mismatches=research.results.filter(r=>r.kind==='identity-mismatch');
if(mismatches.length!==EXPECTED_MISMATCH)throw new Error(`identityMismatch=${mismatches.length}, esperado=${EXPECTED_MISMATCH}`);
const currentById=new Map(pack.entries.map(r=>[Number(r[0]),r]));
const sourceOwners=new Map();
for(const r of pack.entries){const sourceId=Number(r?.[1])||0;if(!sourceId)continue;const a=sourceOwners.get(sourceId)||[];a.push({gcdId:Number(r[0]),status:Number(r[3])});sourceOwners.set(sourceId,a)}
const mismatchSourceCounts=new Map();for(const r of mismatches){const id=Number(r.sourceId)||0;if(id)mismatchSourceCounts.set(id,(mismatchSourceCounts.get(id)||0)+1)}

const rows=[];
for(const r of mismatches){
  const gcdId=Number(r.gcdId),loc=local.get(gcdId),current=currentById.get(gcdId),parsed=parseIssueTitle(r.title);
  if(!loc||!current)throw new Error(`Falta GCD ${gcdId}.`);
  if(Number(current[3])!==STATUS.NOT_LISTED)throw new Error(`Mismatch GCD ${gcdId} ya no es NOT_LISTED.`);
  const actualSeries=parsed?.series||'',actualIssue=parsed?.issue||'',expectedSeries=str(r.expectedSeries),expectedIssue=str(r.expectedIssue);
  const issueExact=Boolean(parsed&&normalizeIssue(actualIssue)===normalizeIssue(expectedIssue)&&normalizeIssue(expectedIssue)===normalizeIssue(loc.issueNumber));
  const lexical=parsed?lexicalClass(expectedSeries,actualSeries):'parse-failure';
  const owners=(sourceOwners.get(Number(r.sourceId))||[]).filter(x=>x.gcdId!==gcdId);
  const occupiedTerminal=owners.filter(x=>[STATUS.MU,STATUS.NO_DIGITAL,STATUS.MU_LINK_MISSING].includes(x.status));
  const pairKey=parsed?`${normalizeSeries(expectedSeries)} => ${normalizeSeries(actualSeries)}`:'parse-failure';
  rows.push({
    gcdId,seriesId:loc.seriesId,localTitle:loc.title,localIssue:loc.issueNumber,localDate:loc.date,localYear:yearOf(loc.date),
    sourceId:Number(r.sourceId)||0,expectedSeries,expectedIssue,officialPageTitle:str(r.title),actualSeries,actualIssue,
    parsed:Boolean(parsed),issueExact,lexicalClass:lexical,lexicalJaccard:parsed?Number(jaccard(expectedSeries,actualSeries).toFixed(3)):0,
    pairKey,sourceIdMismatchUses:mismatchSourceCounts.get(Number(r.sourceId))||0,
    sourceIdOtherOwners:owners,sourceIdOccupiedByTerminal:occupiedTerminal.length>0,
  });
}

const pairMap=new Map();
for(const x of rows){const p=pairMap.get(x.pairKey)||{pairKey:x.pairKey,expectedSeries:x.expectedSeries,actualSeries:x.actualSeries,count:0,issueExact:0,sourceCollision:0,seriesIds:new Set(),years:new Set(),examples:[]};p.count++;if(x.issueExact)p.issueExact++;if(x.sourceIdOccupiedByTerminal)p.sourceCollision++;p.seriesIds.add(x.seriesId);if(x.localYear)p.years.add(x.localYear);if(p.examples.length<8)p.examples.push({gcdId:x.gcdId,issue:x.localIssue,date:x.localDate,sourceId:x.sourceId,page:x.officialPageTitle});pairMap.set(x.pairKey,p)}
const pairs=[...pairMap.values()].map(p=>({...p,seriesIds:[...p.seriesIds].sort((a,b)=>a-b),years:[...p.years].sort((a,b)=>a-b)})).sort((a,b)=>b.count-a.count||a.pairKey.localeCompare(b.pairKey));
const pairCount=new Map(pairs.map(p=>[p.pairKey,p.count]));
for(const x of rows){
  const repeated=(pairCount.get(x.pairKey)||0)>=2;
  x.pilotEligible=Boolean(x.parsed&&x.issueExact&&!x.sourceIdOccupiedByTerminal&&repeated);
  x.pilotTier=!x.parsed?'parse-failure':!x.issueExact?'issue-mismatch':x.sourceIdOccupiedByTerminal?'source-collision':repeated?'repeated-alias-pair':'singleton-alias-pair';
}

const by=(fn)=>Object.fromEntries([...rows.reduce((m,x)=>{const k=fn(x);m.set(k,(m.get(k)||0)+1);return m},new Map())].sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
const byDecade=by(x=>x.localYear?`${Math.floor(x.localYear/10)*10}s`:'unknown');
const summary={
  totalMismatch:rows.length,
  parsed:rows.filter(x=>x.parsed).length,
  parseFailure:rows.filter(x=>!x.parsed).length,
  issueExact:rows.filter(x=>x.issueExact).length,
  issueMismatch:rows.filter(x=>x.parsed&&!x.issueExact).length,
  sourceIdOccupiedByTerminal:rows.filter(x=>x.sourceIdOccupiedByTerminal).length,
  repeatedAliasPairRows:rows.filter(x=>(pairCount.get(x.pairKey)||0)>=2).length,
  singletonAliasPairRows:rows.filter(x=>(pairCount.get(x.pairKey)||0)===1).length,
  pilotEligible:rows.filter(x=>x.pilotEligible).length,
  uniqueAliasPairs:pairs.length,
  repeatedAliasPairs:pairs.filter(p=>p.count>=2).length,
  lexicalClass:by(x=>x.lexicalClass),pilotTier:by(x=>x.pilotTier),byDecade,
};
const report={version:4,generatedAt:new Date().toISOString(),mode:'identity-mismatch-diagnostic',writesCache:false,baseline:{localCount:pack.localCount,matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed},summary,pairs,rows};
await fs.mkdir(path.dirname(outFile),{recursive:true});
await fs.writeFile(outFile,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
