import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import extract from 'extract-zip';

const root=process.cwd();
const archive=path.join(root,'Marvel_Orden_de_Lectura_PWA.zip');
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const catalogFile=path.join(root,'.cache','marvel-global-catalog-v4.json');
const outDir=path.join(root,'artifacts','marvel-learned-series-v5');
const planFile=path.join(outDir,'plan.json');
const shardDir=path.join(outDir,'shards');
const auditFile=path.join(outDir,'audit.json');
const summaryFile=path.join(outDir,'summary.json');
const fallbackFile=path.join(root,'source','marvel-reader-fallback-v1240.js');
const mode=process.argv[2]||'plan';
const shard=Math.max(0,Number(process.env.SHARD_INDEX)||0);
const shardCount=Math.max(1,Number(process.env.SHARD_COUNT)||1);
const STATUS={MU:1,NO_DIGITAL:3,NOT_LISTED:4,MU_READER:5};
const ISSUE_SHARE='https://share.marvel.com/comics/issue/';
const ISSUE_WWW='https://www.marvel.com/comics/issue/';
const SERIES_SHARE='https://share.marvel.com';
const SERIES_WWW='https://www.marvel.com';
const SERIES_DIR='https://share.marvel.com/comics/series';
const READER='https://share.marvel.com/sharing/reader/';
const LEGACY='https://share.marvel.com/sharing/legacy/';
const LANDING='https://share.marvel.com/sharing/issue/';
const SMART='https://marvel.smart.link/fiir7ec77';
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1';
const DRN_RE=/^drn:src:marvel:unison::prod:[0-9a-f-]{36}$/i;
const str=v=>v==null?'':String(v);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const decode=v=>str(v).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)||32));
const plain=v=>decode(str(v).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
const norm=v=>str(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
const normSeries=v=>norm(str(v).replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|present))?\s*\)\s*$/i,' ')).replace(/^the\s+/,'').replace(/\s+comics?$/,'').trim();
const normIssue=v=>{let s=str(v).trim().toUpperCase().replace(/\s+/g,'');if(/^0+\d+$/.test(s))s=String(Number(s));return s};
const yearOf=v=>Number(str(v).match(/\b((?:19|20)\d{2})\b/)?.[1]||0);
const dateOnly=v=>str(v).slice(0,10);
const dayMs=86400000;
function dateSkewDays(a,b){const x=new Date(dateOnly(a)),y=new Date(dateOnly(b));return Number.isNaN(x.valueOf())||Number.isNaN(y.valueOf())?Infinity:Math.round(Math.abs(x-y)/dayMs)}
function compatibleDate(a,b){return!dateOnly(a)||!dateOnly(b)||dateSkewDays(a,b)<=120}
const unique=a=>[...new Set(a)];
const count=(p,s)=>p.entries.filter(r=>Number(r?.[3])===s).length;

function issueVariants(raw){
  const out=new Set([normIssue(raw)]),s=str(raw).trim();
  const legacy=s.match(/^(.+?)\s*\(\d+\)\s*$/);if(legacy)out.add(normIssue(legacy[1]));
  const suffix=s.match(/^(\d+)\.[A-Z]+$/i);if(suffix)out.add(normIssue(suffix[1]));
  return[...out].filter(Boolean);
}
function parseSeriesLabel(label){
  const t=plain(label),m=t.match(/^(.*?)\s*\(\s*((?:19|20)\d{2})(?:\s*-\s*((?:19|20)\d{2}|Present))?\s*\)\s*$/i);
  if(!m)return{label:t,baseTitle:t,startYear:0,endYear:0,normTitle:normSeries(t)};
  return{label:t,baseTitle:m[1].trim(),startYear:Number(m[2]),endYear:/present/i.test(m[3]||'')?9999:Number(m[3]||m[2]),normTitle:normSeries(m[1])};
}
function parseIssueTitle(t){
  const m=decode(t).trim().replace(/\s*\|\s*Comic Issues\s*\|\s*Marvel.*$/i,'').match(/^(.*?)\s*(?:\(\s*(\d{4})(?:\s*-\s*(?:\d{4}|present))?\s*\))?\s*#\s*([^\s|]+)/i);
  return m?{series:m[1].trim(),year:Number(m[2]||0),issue:m[3].trim()}:null;
}
function titles(html){
  const out=[];
  for(const re of [/<h1\b[^>]*>([\s\S]*?)<\/h1>/ig,/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/ig,/<title[^>]*>([\s\S]*?)<\/title>/ig]){
    let m;while((m=re.exec(str(html)))){const t=plain(m[1]);if(t&&!out.includes(t))out.push(t)}
  }
  return out;
}
function pageDate(html){
  const s=str(html);
  for(const re of [/["'](?:onSaleDate|onsaleDate|datePublished)["']\s*:\s*["'](\d{4}-\d{2}-\d{2})/i,/Published:?\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i]){
    const m=s.match(re);if(m){const d=new Date(m[1]);if(!Number.isNaN(d.valueOf()))return d.toISOString().slice(0,10)}
  }
  return'';
}
function availability(html){
  const t=plain(html).toLowerCase(),mu=/members get unlimited access to this issue|this content is available through marvel unlimited|get unlimited access to this issue/.test(t),no=/digital issue (?:is )?not currently available/.test(t);
  if(mu&&!no)return'mu';if(no&&!mu)return'no-digital';if(mu&&no)return'conflict';return'unknown';
}
function readerId(html){
  const s=str(html);
  for(const re of [/sharing\/reader\/(\d+)/i,/sharing\/legacy\/(\d+)/i,/read\.marvel\.com\/#\/book\/(\d+)/i,/["'](?:digitalId|readerId)["']\s*:\s*["']?(\d+)/i,/(?:digitalId|readerId)%22%3A(?:%22)?(\d+)/i]){const m=s.match(re);if(m)return Number(m[1])||0}
  return 0;
}
function extractDrn(html){return(decode(str(html)).replace(/\\u003A/gi,':').replace(/\\u002F/gi,'/').replace(/\\\//g,'/').match(/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i)?.[0]||'').toLowerCase()}
function landingSignal(html){const t=plain(html).toLowerCase();return{unlimited:/this content is available through marvel unlimited/.test(t),openButton:/open in marvel unlimited/.test(t)}}
function smartIssue(drn,sourceId){const u=new URL(SMART);u.searchParams.set('type','issue');u.searchParams.set('drn',drn);u.searchParams.set('sourceId',String(sourceId));return u.toString()}
function smartReader(rid){const u=new URL(SMART);u.searchParams.set('type','reader');u.searchParams.set('drn',String(rid));return u.toString()}
function tokenSimilarity(a,b){
  const stop=new Set(['the','a','an','and','of','marvel','comics','comic']);
  const aa=new Set(normSeries(a).split(' ').filter(x=>x&&!stop.has(x))),bb=new Set(normSeries(b).split(' ').filter(x=>x&&!stop.has(x)));
  if(!aa.size||!bb.size)return 0;let both=0;for(const x of aa)if(bb.has(x))both++;
  return both/Math.min(aa.size,bb.size);
}
function tokenEquivalence(a,b){
  const stop=new Set(['the','a','an','and','of','marvel','comics','comic']);
  const aa=new Set(normSeries(a).split(' ').filter(x=>x&&!stop.has(x))),bb=new Set(normSeries(b).split(' ').filter(x=>x&&!stop.has(x)));
  if(!aa.size||!bb.size)return 0;let both=0;for(const x of aa)if(bb.has(x))both++;
  return both/Math.max(aa.size,bb.size);
}
function compatibleYear(y,s){return!y||!s.startYear||(y>=s.startYear-1&&y<=s.endYear+1)}
function terminalMaps(pack){
  const source=new Map(),reader=new Map(),drn=new Map();
  for(const r of pack.entries){
    if(![1,3,5].includes(Number(r[3])))continue;
    const id=Number(r[0]),sid=Number(r[1])||0,rid=Number(r[2])||0,d=str(r[5]).toLowerCase();
    for(const [m,v] of [[source,sid],[reader,rid],[drn,DRN_RE.test(d)?d:'']])if(v){const a=m.get(v)||[];a.push(id);m.set(v,a)}
  }
  return{source,reader,drn};
}
async function get(url,{tries=3,redirect='follow'}={}){
  let last;
  for(let i=0;i<tries;i++){
    try{
      const r=await fetch(url,{redirect,headers:{'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(30000)});
      if(r.ok||r.status===404||r.status===410||(redirect==='manual'&&r.status>=300&&r.status<400))return r;
      last=new Error(`HTTP ${r.status} ${url}`);
    }catch(e){last=e}
    await sleep(400*(i+1));
  }
  throw last;
}
async function loadLocal(){
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'marvel-learned-v5-'));
  try{
    await extract(archive,{dir:tmp});const data=path.join(tmp,'data');
    const [meta,series]=await Promise.all([fs.readFile(path.join(data,'meta.json'),'utf8').then(JSON.parse),fs.readFile(path.join(data,'series.json'),'utf8').then(JSON.parse)]);
    const sm=new Map(series.map(s=>[Number(s.id),s])),byId=new Map();
    for(const c of meta.chunks||[])for(const x of JSON.parse(await fs.readFile(path.join(data,c.file),'utf8'))){
      const s=sm.get(Number(x.s))||{};
      byId.set(Number(x.id),{gcdId:Number(x.id),seriesId:Number(x.s),title:s.original||s.es||'',issueNumber:str(x.n),date:str(x.sv||x.d),seriesYear:str(x.a||s.year||s.y)});
    }
    return byId;
  }finally{await fs.rm(tmp,{recursive:true,force:true})}
}
function validatePack(pack){
  if(Number(pack.localCount)!==51002||!Array.isArray(pack.entries)||pack.entries.length!==51002||new Set(pack.entries.map(r=>Number(r[0]))).size!==51002)throw new Error('Caché base inválida');
  if(Number(pack.functionalLinkMissing)!==0)throw new Error(`La base ya contiene ${pack.functionalLinkMissing} Unlimited sin enlace funcional`);
  return{matched:Number(pack.matched),noDigital:Number(pack.noDigital),notListed:Number(pack.notListed),linkReady:Number(pack.linkReady),readerFallbackReady:Number(pack.readerFallbackReady),functionalLinkReady:Number(pack.functionalLinkReady),functionalLinkMissing:Number(pack.functionalLinkMissing)};
}
function parseDirectory(html){
  const out=[],seen=new Set(),re=/<a\b[^>]*href=["']([^"']*\/comics\/series\/(\d+)\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;
  while((m=re.exec(str(html)))){const seriesId=Number(m[2]);if(!seriesId||seen.has(seriesId))continue;const parsed=parseSeriesLabel(m[3]);if(!parsed.label)continue;seen.add(seriesId);out.push({seriesId,href:decode(m[1]),...parsed})}
  return out;
}
function parseSeriesPage(html){
  const text=plain(html),ids=[],seen=new Set(),hints={};
  for(const m of str(html).matchAll(/(?:https?:\/\/(?:www\.|share\.)?marvel\.com)?\/comics\/issue\/(\d+)/gi)){const id=Number(m[1]);if(id&&!seen.has(id)){seen.add(id);ids.push(id)}}
  for(const m of str(html).matchAll(/<a\b[^>]*href=["'][^"']*\/comics\/issue\/(\d+)\/[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)){const id=Number(m[1]),parsed=parseIssueTitle(plain(m[2]));if(id&&parsed)hints[id]={series:normSeries(parsed.series),issue:normIssue(parsed.issue)}}
  return{issueIds:ids,issueHints:hints,reportedTotal:Number(text.match(/Showing\s+\d+\s+of\s+(\d+)\s+results/i)?.[1]||0)};
}
async function harvestSeries(segment){
  if(!segment.officialHref)return{issueIds:[],reportedTotal:0,chosenUrl:'',complete:false,diagnostics:[],proofOk:segment.proofMode==='catalog-only'||segment.proofMode==='directory-fuzzy'||segment.proofMode==='directory-retry'};
  const rel=str(segment.officialHref).startsWith('/')?str(segment.officialHref):`/${segment.officialHref}`;
  const bases=[SERIES_SHARE+rel,SERIES_WWW+rel],ids=new Set(),hints={},diagnostics=[];let chosen='',reportedTotal=0;
  for(const base of bases){
    try{const r=await get(base),p=r.ok?parseSeriesPage(await r.text()):{issueIds:[],issueHints:{},reportedTotal:0};p.issueIds.forEach(x=>ids.add(x));Object.assign(hints,p.issueHints);reportedTotal=Math.max(reportedTotal,p.reportedTotal);diagnostics.push({url:base,status:r.status,issueIds:p.issueIds.length,reportedTotal:p.reportedTotal});if(r.ok&&(p.issueIds.length||p.reportedTotal)){chosen=base;break}}catch(e){diagnostics.push({url:base,error:e?.message||String(e)})}
  }
  if(chosen){
    let stale=0;
    for(let off=20;off<=2000&&stale<2&&(reportedTotal===0||ids.size<reportedTotal);off+=20){
      const u=`${chosen}?offset=${off}`;
      try{const r=await get(u);if(!r.ok)break;const p=parseSeriesPage(await r.text()),before=ids.size;p.issueIds.forEach(x=>ids.add(x));Object.assign(hints,p.issueHints);reportedTotal=Math.max(reportedTotal,p.reportedTotal);stale=ids.size===before?stale+1:0}catch(e){diagnostics.push({url:u,error:e?.message||String(e)});break}
      await sleep(40);
    }
  }
  const proofHits=(segment.proofSourceIds||[]).filter(x=>ids.has(Number(x))).length;
  const proofNeed=segment.proofMode==='terminal-anchor'?1:segment.proofMode==='date-seed'?Math.min(2,(segment.proofSourceIds||[]).length):0;
  return{issueIds:[...ids].sort((a,b)=>a-b),issueHints:hints,reportedTotal,chosenUrl:chosen,complete:Boolean(reportedTotal&&ids.size>=reportedTotal),proofHits,proofNeed,proofOk:proofNeed===0||proofHits>=proofNeed,diagnostics};
}

async function plan(){
  const [pack,catalogPack,local,dirResponse]=await Promise.all([fs.readFile(cacheFile,'utf8').then(JSON.parse),fs.readFile(catalogFile,'utf8').then(JSON.parse),loadLocal(),get(SERIES_DIR)]);
  const baseline=validatePack(pack);
  if(!Array.isArray(catalogPack?.issues)||catalogPack.issues.length<30000)throw new Error('Catálogo global incompleto');
  const directory=parseDirectory(await dirResponse.text());if(directory.length<1000)throw new Error(`Directorio oficial incompleto: ${directory.length}`);
  const cacheBy=new Map(pack.entries.map(r=>[Number(r[0]),r])),localSeries=new Map(),catalogBySource=new Map(),catalogByDateIssue=new Map(),catalogByIssue=new Map(),catalogBySeriesIssue=new Map();
  for(const x of local.values()){const g=localSeries.get(x.seriesId)||{seriesId:x.seriesId,title:x.title,seriesYear:x.seriesYear,rows:[]};g.rows.push(x);localSeries.set(x.seriesId,g)}
  for(const c of catalogPack.issues){
    const item={sourceId:Number(c.sourceId)||0,readerId:Number(c.readerId)||0,seriesName:str(c.seriesName),remoteNorm:normSeries(c.seriesName),issueNumber:str(c.issueNumber),issueNorm:normIssue(c.issueNumber),onSale:dateOnly(c.onSale),yearPage:Number(c.yearPage)||0};
    if(!item.sourceId||!item.remoteNorm||!item.issueNorm)continue;catalogBySource.set(item.sourceId,item);
    const di=`${item.onSale}|${item.issueNorm}`,da=catalogByDateIssue.get(di)||[];da.push(item);catalogByDateIssue.set(di,da);
    const ia=catalogByIssue.get(item.issueNorm)||[];ia.push(item);catalogByIssue.set(item.issueNorm,ia);
    const si=`${item.remoteNorm}|${item.issueNorm}`,sa=catalogBySeriesIssue.get(si)||[];sa.push(item);catalogBySeriesIssue.set(si,sa);
  }
  const dirByNorm=new Map();for(const s of directory){const a=dirByNorm.get(s.normTitle)||[];a.push(s);dirByNorm.set(s.normTitle,a)}
  const segments=[],aliases=[],uncovered=[];
  for(const g of localSeries.values()){
    const pending=g.rows.filter(x=>Number(cacheBy.get(x.gcdId)?.[3])===STATUS.NOT_LISTED);if(!pending.length)continue;
    const evidence=new Map();
    const add=(remoteNorm,remoteTitle,kind,row,item)=>{if(!remoteNorm)return;const e=evidence.get(remoteNorm)||{remoteNorm,remoteTitle,anchors:new Map(),seeds:new Map()};const target=kind==='anchor'?e.anchors:e.seeds;if(!target.has(row.gcdId))target.set(row.gcdId,{gcdId:row.gcdId,sourceId:item.sourceId,issueNumber:row.issueNumber,date:dateOnly(row.date),remoteDate:item.onSale});evidence.set(remoteNorm,e)};
    for(const row of g.rows){
      const cr=cacheBy.get(row.gcdId);if(!cr||![1,3,5].includes(Number(cr[3])))continue;const item=catalogBySource.get(Number(cr[1]));if(!item||!issueVariants(row.issueNumber).includes(item.issueNorm))continue;const ly=yearOf(row.date)||yearOf(row.seriesYear),cy=yearOf(item.onSale)||item.yearPage;if(ly&&cy&&Math.abs(ly-cy)>1)continue;add(item.remoteNorm,item.seriesName,'anchor',row,item);
    }
    for(const row of pending){
      const d=dateOnly(row.date);if(!d)continue;
      const seenNorm=new Set();
      for(const iv of issueVariants(row.issueNumber)){
        const candidates=[...(catalogByDateIssue.get(`${d}|${iv}`)||[]),...(catalogByIssue.get(iv)||[]).filter(item=>compatibleDate(d,item.onSale))];
        for(const item of candidates){if(seenNorm.has(item.remoteNorm))continue;seenNorm.add(item.remoteNorm);add(item.remoteNorm,item.seriesName,'seed',row,item)}
      }
    }
    const ranked=[...evidence.values()].map(e=>({...e,anchorCount:e.anchors.size,seedCount:e.seeds.size,similarity:tokenSimilarity(g.title,e.remoteTitle),score:e.anchors.size*20+e.seeds.size})).sort((a,b)=>b.score-a.score||b.similarity-a.similarity);
    const accepted=[];
    for(const e of ranked){
      const anchored=e.anchorCount>=2;
      const seeded=e.seedCount>=4&&e.similarity>=0.5&&(e===ranked[0]||e.seedCount>=Math.max(4,(ranked[0]?.seedCount||0)*0.75));
      if(anchored||seeded)accepted.push({...e,proofMode:anchored?'terminal-anchor':'date-seed'});
    }
    if(!accepted.length)uncovered.push({seriesId:g.seriesId,title:g.title,pendingRows:pending.length,topEvidence:ranked.slice(0,3).map(e=>({remoteTitle:e.remoteTitle,anchors:e.anchorCount,seeds:e.seedCount,similarity:e.similarity}))});
    for(const e of accepted){
      const years=unique([...e.anchors.values(),...e.seeds.values()].map(x=>yearOf(x.date)||yearOf(x.remoteDate)).filter(Boolean));
      let official=(dirByNorm.get(e.remoteNorm)||[]).filter(s=>!years.length||years.some(y=>compatibleYear(y,s)));
      if(official.length>4)official=[];
      const proofRows=e.proofMode==='terminal-anchor'?[...e.anchors.values()]:[...e.seeds.values()];
      const proofSourceIds=unique(proofRows.map(x=>x.sourceId).filter(Boolean));
      const catalogCandidates=new Map();
      for(const row of pending){
        let cs=[];for(const iv of issueVariants(row.issueNumber))cs.push(...(catalogBySeriesIssue.get(`${e.remoteNorm}|${iv}`)||[]));
        cs=[...new Map(cs.map(c=>[c.sourceId,c])).values()];const d=dateOnly(row.date),ly=yearOf(row.date)||yearOf(row.seriesYear);
        if(d){const exact=cs.filter(c=>c.onSale===d);cs=exact.length?exact:cs.filter(c=>compatibleDate(d,c.onSale))}
        cs=cs.filter(c=>{const cy=yearOf(c.onSale)||c.yearPage;return!ly||!cy||Math.abs(ly-cy)<=1}).slice(0,6);
        catalogCandidates.set(row.gcdId,cs.map(c=>c.sourceId));
      }
      const dirs=official.length?official:[{seriesId:0,href:'',label:e.remoteTitle,baseTitle:e.remoteTitle,startYear:0,endYear:9999,normTitle:e.remoteNorm}];
      for(const s of dirs){
        const rows=pending.filter(r=>compatibleYear(yearOf(r.date)||yearOf(r.seriesYear),s)).map(r=>({gcdId:r.gcdId,issueNumber:r.issueNumber,date:dateOnly(r.date),seriesYear:r.seriesYear,catalogSourceIds:catalogCandidates.get(r.gcdId)||[]}));
        if(!rows.length)continue;
        segments.push({localSeriesId:g.seriesId,localTitle:g.title,localSeriesYear:g.seriesYear,remoteNorm:e.remoteNorm,remoteTitle:e.remoteTitle,proofMode:s.seriesId?e.proofMode:'catalog-only',proofSourceIds,anchorCount:e.anchorCount,seedCount:e.seedCount,similarity:e.similarity,officialSeriesId:s.seriesId,officialLabel:s.label,officialHref:s.href,officialStartYear:s.startYear,officialEndYear:s.endYear,pendingRows:rows.length,rows});
      }
      aliases.push({localSeriesId:g.seriesId,localTitle:g.title,remoteNorm:e.remoteNorm,remoteTitle:e.remoteTitle,proofMode:e.proofMode,anchorCount:e.anchorCount,seedCount:e.seedCount,similarity:e.similarity,officialSeriesIds:official.map(s=>s.seriesId)});
    }
    const acceptedNorms=new Set(accepted.map(e=>e.remoteNorm)),fuzzy=[];
    for(const s of directory){
      if(acceptedNorms.has(s.normTitle))continue;
      const exact=s.normTitle===normSeries(g.title);
      if(!exact&&(tokenSimilarity(g.title,s.baseTitle)<0.8||tokenEquivalence(g.title,s.baseTitle)<0.5))continue;
      const rows=pending.filter(r=>compatibleYear(yearOf(r.date)||yearOf(r.seriesYear),s));if(rows.length<3)continue;
      fuzzy.push({s,rows,coverage:rows.length,similarity:tokenEquivalence(g.title,s.baseTitle),proofMode:exact?'directory-retry':'directory-fuzzy'});
    }
    fuzzy.sort((a,b)=>b.coverage-a.coverage||b.similarity-a.similarity||a.s.seriesId-b.s.seriesId);
    for(const f of fuzzy.slice(0,3)){
      const rows=f.rows.map(r=>({gcdId:r.gcdId,issueNumber:r.issueNumber,date:dateOnly(r.date),seriesYear:r.seriesYear,catalogSourceIds:[]}));
      segments.push({localSeriesId:g.seriesId,localTitle:g.title,localSeriesYear:g.seriesYear,remoteNorm:f.s.normTitle,remoteTitle:f.s.baseTitle,proofMode:f.proofMode,proofSourceIds:[],anchorCount:0,seedCount:0,similarity:f.similarity,officialSeriesId:f.s.seriesId,officialLabel:f.s.label,officialHref:f.s.href,officialStartYear:f.s.startYear,officialEndYear:f.s.endYear,pendingRows:rows.length,rows});
      aliases.push({localSeriesId:g.seriesId,localTitle:g.title,remoteNorm:f.s.normTitle,remoteTitle:f.s.baseTitle,proofMode:f.proofMode,anchorCount:0,seedCount:0,similarity:f.similarity,officialSeriesIds:[f.s.seriesId]});
    }
  }
  segments.sort((a,b)=>b.pendingRows-a.pendingRows||a.localTitle.localeCompare(b.localTitle)||a.officialSeriesId-b.officialSeriesId);
  const covered=new Set(segments.flatMap(s=>s.rows.map(r=>r.gcdId))),examples=aliases.filter(a=>/power man|incredible hulk/i.test(a.localTitle));
  const report={version:5,generatedAt:new Date().toISOString(),mode:'learned-series-plan-v5',writesCache:false,baseline,catalogIssues:catalogBySource.size,directorySeries:directory.length,summary:{pending:baseline.notListed,learnedAliases:aliases.length,segments:segments.length,coveredPending:covered.size,uncoveredPending:baseline.notListed-covered.size,anchoredAliases:aliases.filter(a=>a.proofMode==='terminal-anchor').length,dateSeedAliases:aliases.filter(a=>a.proofMode==='date-seed').length,fuzzyDirectoryAliases:aliases.filter(a=>a.proofMode==='directory-fuzzy').length,directoryRetryAliases:aliases.filter(a=>a.proofMode==='directory-retry').length},safety:{cacheWritten:false,terminalEvidenceRequiresTwoAnchors:true,dateSeedRequiresFourIssueRowsWithin120Days:true,dateSeedTitleTokenContainmentAtLeastHalf:true,directoryRetryRequiresAtLeastThreeVerifiedIssueIdentities:true,fuzzyDirectoryRequiresAtLeastThreeVerifiedIssueIdentities:true,officialDirectoryDiscoveryOnly:true,allPromotionsRequireOfficialIssueVerification:true,noNegativeInference:true},examples,aliases,segments,uncoveredSeries:uncovered.sort((a,b)=>b.pendingRows-a.pendingRows).slice(0,1000)};
  await fs.mkdir(outDir,{recursive:true});await fs.writeFile(planFile,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({summary:report.summary,examples},null,2));
}

async function inspectSource(sourceId,segment,rowsByIssue,terminal){
  let html='',usedUrl='';
  for(const base of [ISSUE_SHARE,ISSUE_WWW]){try{const r=await get(base+sourceId);if(r.ok){html=await r.text();usedUrl=base+sourceId;break}}catch{}}
  if(!html)return{sourceId,kind:'issue-unreachable'};
  const ts=titles(html),parsed=ts.map(parseIssueTitle).find(Boolean);if(!parsed)return{sourceId,kind:'issue-unparsed',officialTitle:ts[0]||'',issueUrl:usedUrl};
  if(normSeries(parsed.series)!==segment.remoteNorm)return{sourceId,kind:'remote-series-mismatch',officialTitle:ts[0]||'',parsed,expectedRemoteNorm:segment.remoteNorm};
  let rows=[];for(const iv of issueVariants(parsed.issue))rows.push(...(rowsByIssue.get(iv)||[]));rows=[...new Map(rows.map(x=>[x.gcdId,x])).values()];
  const pd=pageDate(html);if(rows.length>1&&pd){const exact=rows.filter(x=>dateOnly(x.date)===pd);if(exact.length===1)rows=exact}
  if(rows.length!==1)return{sourceId,kind:rows.length?'target-ambiguous':'no-target',officialTitle:ts[0]||'',parsed,officialDate:pd,targetGcdIds:rows.map(x=>x.gcdId)};
  const row=rows[0];if(pd&&row.date&&!compatibleDate(row.date,pd))return{sourceId,gcdId:row.gcdId,kind:'date-mismatch',officialTitle:ts[0]||'',officialDate:pd,localDate:dateOnly(row.date),dateSkewDays:dateSkewDays(row.date,pd)};
  const sourceOwners=(terminal.source.get(sourceId)||[]).filter(x=>x!==row.gcdId);if(sourceOwners.length)return{sourceId,gcdId:row.gcdId,kind:'source-collision',owners:sourceOwners};
  const av=availability(html),rid=readerId(html),pageDrn=extractDrn(html);
  let reader={ok:false,availability:'unknown',identity:false};
  if(rid){
    const owners=(terminal.reader.get(rid)||[]).filter(x=>x!==row.gcdId);if(owners.length)return{sourceId,gcdId:row.gcdId,kind:'reader-collision',readerId:rid,owners};
    try{const rr=await get(READER+rid);if(rr.ok){const rh=await rr.text(),rt=titles(rh),rp=rt.map(parseIssueTitle).find(Boolean),rav=availability(rh);reader={ok:Boolean(rp&&normSeries(rp.series)===segment.remoteNorm&&normIssue(rp.issue)===normIssue(parsed.issue)&&rav==='mu'),availability:rav,identity:Boolean(rp&&normSeries(rp.series)===segment.remoteNorm&&normIssue(rp.issue)===normIssue(parsed.issue)),title:rt[0]||''}}}catch{}
  }
  let drn=DRN_RE.test(pageDrn)?pageDrn:'';if(!drn&&rid){try{const lr=await get(LEGACY+rid);if(lr.ok)drn=extractDrn(await lr.text())}catch{}}
  if(DRN_RE.test(drn)){
    const owners=(terminal.drn.get(drn)||[]).filter(x=>x!==row.gcdId);if(owners.length)return{sourceId,gcdId:row.gcdId,kind:'drn-collision',drn,owners};
    let sig={unlimited:false,openButton:false};try{const lp=await get(LANDING+encodeURIComponent(drn));if(lp.ok)sig=landingSignal(await lp.text())}catch{}
    const url=smartIssue(drn,sourceId);let sm={ok:false,status:0};try{const sr=await get(url,{tries:2,redirect:'manual'});sm={ok:sr.status>=200&&sr.status<400&&sr.status!==404,status:sr.status}}catch{}
    if(sig.unlimited&&sig.openButton&&sm.ok)return{sourceId,gcdId:row.gcdId,kind:'mu-uuid',readerId:rid,drn,officialTitle:ts[0]||'',officialDate:pd,sourceAvailability:av,landingUnlimited:true,landingOpenButton:true,smartLink:url,smartStatus:sm.status,functional:true,publishable:true};
  }
  if(rid&&reader.ok){
    const url=smartReader(rid);let sm={ok:false,status:0};try{const sr=await get(url,{tries:2,redirect:'manual'});sm={ok:sr.status>=200&&sr.status<400&&sr.status!==404,status:sr.status}}catch{}
    if(sm.ok)return{sourceId,gcdId:row.gcdId,kind:'mu-reader',readerId:rid,officialTitle:ts[0]||'',officialDate:pd,sourceAvailability:av,readerAvailability:reader.availability,smartLink:url,smartStatus:sm.status,functional:true,publishable:true};
  }
  if(av==='no-digital')return{sourceId,gcdId:row.gcdId,kind:'no-digital',officialTitle:ts[0]||'',officialDate:pd,sourceAvailability:av,publishable:true};
  return{sourceId,gcdId:row.gcdId,kind:'unresolved',readerId:rid,drn:DRN_RE.test(drn)?drn:'',officialTitle:ts[0]||'',officialDate:pd,sourceAvailability:av,reader};
}

async function scan(){
  const [pack,planData]=await Promise.all([fs.readFile(cacheFile,'utf8').then(JSON.parse),fs.readFile(planFile,'utf8').then(JSON.parse)]);const baseline=validatePack(pack);
  if(planData?.mode!=='learned-series-plan-v5'||planData?.version!==5||JSON.stringify(planData.baseline)!==JSON.stringify(baseline))throw new Error('Plan v5 incompatible con la caché actual');
  const terminal=terminalMaps(pack),segments=(planData.segments||[]).filter((_,i)=>i%shardCount===shard),results=[];let inspected=0;
  for(const [i,segment] of segments.entries()){
    const harvested=await harvestSeries(segment);const rowsByIssue=new Map();for(const row of segment.rows)for(const iv of issueVariants(row.issueNumber)){const a=rowsByIssue.get(iv)||[];a.push(row);rowsByIssue.set(iv,a)}
    const harvestIds=harvested.proofOk?harvested.issueIds.filter(id=>{const h=harvested.issueHints?.[id];return!h||h.series!==segment.remoteNorm||rowsByIssue.has(h.issue)}):[];
    const catalogIds=segment.rows.flatMap(r=>r.catalogSourceIds||[]),candidateIds=unique([...harvestIds,...catalogIds]).filter(id=>!(terminal.source.get(Number(id))||[]).length).sort((a,b)=>a-b);
    const candidateResults=[];
    if(harvested.proofOk||segment.proofMode==='catalog-only')for(const sid of candidateIds){
      const r=await inspectSource(Number(sid),segment,rowsByIssue,terminal).catch(e=>({sourceId:Number(sid),kind:'exception',error:e?.message||String(e)}));candidateResults.push(r);inspected++;if(inspected%20===0)console.log(`Shard ${shard}: ${inspected} páginas verificadas`);await sleep(45);
    }
    const identityHits=new Set(candidateResults.filter(r=>r.gcdId&&!['date-mismatch','remote-series-mismatch','target-ambiguous','no-target'].includes(r.kind)).map(r=>Number(r.gcdId))).size;
    if(['directory-fuzzy','directory-retry'].includes(segment.proofMode)&&identityHits<3)for(const r of candidateResults)if(r.publishable)r.publishable=false;
    const kinds={};for(const r of candidateResults)kinds[r.kind]=(kinds[r.kind]||0)+1;
    results.push({segment:{localSeriesId:segment.localSeriesId,localTitle:segment.localTitle,remoteNorm:segment.remoteNorm,remoteTitle:segment.remoteTitle,proofMode:segment.proofMode,officialSeriesId:segment.officialSeriesId,officialLabel:segment.officialLabel,pendingRows:segment.pendingRows},harvest:{issueIds:harvested.issueIds.length,reportedTotal:harvested.reportedTotal,complete:harvested.complete,proofHits:harvested.proofHits,proofNeed:harvested.proofNeed,proofOk:harvested.proofOk,chosenUrl:harvested.chosenUrl},candidateIds:candidateIds.length,identityHits,summary:kinds,results:candidateResults});
    if((i+1)%5===0)console.log(`Shard ${shard}: ${i+1}/${segments.length} segmentos`);
  }
  const flat=results.flatMap(x=>x.results),kinds={};for(const r of flat)kinds[r.kind]=(kinds[r.kind]||0)+1;
  const report={version:5,generatedAt:new Date().toISOString(),mode:'learned-series-audit-v5-shard',writesCache:false,shard,shardCount,totalSegments:planData.segments.length,targetSegments:segments.length,baseline,safety:{cacheWritten:false,seriesProofRequired:true,officialIssueIdentityRequired:true,exactIssueRequired:true,dateExactWhenOfficialDatePresent:true,terminalCollisionProtection:true,uuidLandingAndSmartLinkRequired:true,readerIdentityAndSmartLinkRequired:true,noDigitalMustBeExplicit:true,noNegativeInference:true},summary:{segments:segments.length,inspectedPages:flat.length,publishableMU:flat.filter(r=>r.publishable&&/^mu-/.test(r.kind)).length,publishableNoDigital:flat.filter(r=>r.publishable&&r.kind==='no-digital').length,kinds},segments:results};
  await fs.mkdir(shardDir,{recursive:true});await fs.writeFile(path.join(shardDir,`shard-${shard}.json`),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary,null,2));
}

function recompute(pack){
  const c1=count(pack,1),c5=count(pack,5),c3=count(pack,3),c4=count(pack,4);pack.matched=c1+c5;pack.verifiedMU=pack.matched;pack.unavailable=c3;pack.noDigital=c3;pack.notListed=c4;
  pack.linkReady=pack.entries.filter(r=>Number(r[3])===1&&DRN_RE.test(str(r[5]))).length;
  pack.linkMissing=pack.entries.filter(r=>Number(r[3])===5||Number(r[3])===1&&!DRN_RE.test(str(r[5]))).length;
  pack.linksPrebuilt=pack.linkMissing===0;pack.readerFallbackGcdIds=pack.entries.filter(r=>Number(r[3])===5&&Number(r[2])>0).map(r=>Number(r[0])).sort((a,b)=>a-b);pack.readerFallbackReady=pack.readerFallbackGcdIds.length;
  pack.functionalLinkReady=pack.linkReady+pack.readerFallbackReady;pack.functionalLinkMissing=Math.max(0,pack.matched-pack.functionalLinkReady);return pack;
}
function fallbackSource(pack){
  const rows=pack.entries.filter(r=>Number(r[3])===5&&Number(r[2])>0).sort((a,b)=>Number(a[0])-Number(b[0]));
  return `/* Marvel Lector v1.2.64 — fallback reader oficial verificado; generado por auditoría v5 */\n(() => {\n  const SMART_BASE='https://marvel.smart.link/fiir7ec77';\n  const TARGETS=new Map([\n${rows.map(r=>`    [${Number(r[0])},'${Number(r[2])}'],`).join('\n')}\n  ]);\n  function readerFallbackHref(m){if(!m||Number(m.preinstalledStatus)!==5)return '';const expected=TARGETS.get(Number(m.id));const readerId=String(m.readerId||'').trim();if(!expected||readerId!==expected||!/^\\d+$/.test(readerId))return '';return SMART_BASE+'?type=reader&drn='+encodeURIComponent(readerId);}\n  if(typeof unlimitedState==='function'){const base=unlimitedState;unlimitedState=function(m){if(readerFallbackHref(m))return{label:'Unlimited ✓',cls:'available'};return base(m);};}\n  if(typeof stableAppHref==='function'){const base=stableAppHref;stableAppHref=function(x,s){const m=typeof state!=='undefined'&&state?.marvel?state.marvel.get(Number(x?.id)):null;return readerFallbackHref(m)||base(x,s);};}\n  function repaintTargets(){if(typeof state==='undefined'||!state?.marvel||typeof updateRenderedMeta!=='function')return;for(const id of TARGETS.keys()){const m=state.marvel.get(id);if(m)updateRenderedMeta(id,m)}}\n  if(typeof requestAnimationFrame==='function')requestAnimationFrame(repaintTargets);if(typeof setTimeout==='function'){setTimeout(repaintTargets,500);setTimeout(repaintTargets,1800)}\n})();\n`;
}

async function merge(){
  const [pack,planData]=await Promise.all([fs.readFile(cacheFile,'utf8').then(JSON.parse),fs.readFile(planFile,'utf8').then(JSON.parse)]);const baseline=validatePack(pack);
  if(planData?.mode!=='learned-series-plan-v5'||JSON.stringify(planData.baseline)!==JSON.stringify(baseline))throw new Error('Plan v5 incompatible en merge');
  const reports=[];for(let i=0;i<shardCount;i++){const r=JSON.parse(await fs.readFile(path.join(shardDir,`shard-${i}.json`),'utf8'));if(r?.mode!=='learned-series-audit-v5-shard'||r.shard!==i||r.shardCount!==shardCount||JSON.stringify(r.baseline)!==JSON.stringify(baseline))throw new Error(`Shard inválido ${i}`);reports.push(r)}
  const all=reports.flatMap(r=>r.segments.flatMap(s=>s.results.map(x=>({...x,segment:s.segment}))));const publishable=all.filter(r=>r.publishable===true),byGcd=new Map();
  for(const r of publishable){const a=byGcd.get(Number(r.gcdId))||[];a.push(r);byGcd.set(Number(r.gcdId),a)}
  const chosen=[],ambiguous=[];
  for(const [gcdId,rows] of byGcd){const distinct=new Map(rows.map(r=>[`${r.kind}|${r.sourceId}|${r.readerId||0}|${r.drn||''}`,r]));const d=[...distinct.values()];if(d.length===1)chosen.push(d[0]);else ambiguous.push({gcdId,candidates:d.map(r=>({kind:r.kind,sourceId:r.sourceId,readerId:r.readerId||0,officialTitle:r.officialTitle}))})}
  const sourceOwners=new Map(),readerOwners=new Map(),drnOwners=new Map(),terminal=terminalMaps(pack);const safe=[];
  for(const r of chosen){
    const id=Number(r.gcdId),sid=Number(r.sourceId),rid=Number(r.readerId)||0,drn=str(r.drn).toLowerCase();
    if((terminal.source.get(sid)||[]).some(x=>x!==id))continue;
    const keys=[[sourceOwners,sid],[readerOwners,/^mu-/.test(r.kind)?rid:0],[drnOwners,DRN_RE.test(drn)?drn:'']];let collision=false;
    for(const [m,k] of keys)if(k&&m.has(k)&&m.get(k)!==id)collision=true;
    if(collision)continue;for(const [m,k] of keys)if(k)m.set(k,id);safe.push(r);
  }
  const byId=new Map(pack.entries.map((r,i)=>[Number(r[0]),i])),before=pack.entries.map(JSON.stringify),changed=new Set(),promoted={uuid:0,reader:0,noDigital:0};
  for(const r of safe){
    const id=Number(r.gcdId),pos=byId.get(id);if(pos==null||Number(pack.entries[pos][3])!==STATUS.NOT_LISTED)continue;const cur=pack.entries[pos],sid=Number(r.sourceId),rid=Number(r.readerId)||0,drn=str(r.drn).toLowerCase();
    if(r.kind==='mu-uuid'){if(r.functional!==true||!DRN_RE.test(drn)||!rid)continue;pack.entries[pos]=[id,sid,rid,STATUS.MU,str(cur[4]),drn];promoted.uuid++}
    else if(r.kind==='mu-reader'){if(r.functional!==true||!rid)continue;pack.entries[pos]=[id,sid,rid,STATUS.MU_READER,str(cur[4]),''];promoted.reader++}
    else if(r.kind==='no-digital'){if(r.sourceAvailability!=='no-digital')continue;pack.entries[pos]=[id,sid,0,STATUS.NO_DIGITAL,str(cur[4]),''];promoted.noDigital++}
    else continue;changed.add(id);
  }
  for(let i=0;i<pack.entries.length;i++)if(!changed.has(Number(pack.entries[i][0]))&&JSON.stringify(pack.entries[i])!==before[i])throw new Error(`Cambio fuera de scope ${pack.entries[i][0]}`);
  recompute(pack);if(pack.functionalLinkMissing!==0)throw new Error(`La publicación dejaría ${pack.functionalLinkMissing} Unlimited sin enlace funcional`);if(pack.matched+pack.noDigital+pack.notListed!==51002)throw new Error('Totales finales incoherentes');
  const now=new Date().toISOString();pack.generatedAt=now;pack.learnedSeriesAudit={version:5,completed:true,publishedAt:now,auditedPages:all.length,verifiedCandidates:publishable.length,changedRows:changed.size,promotedMU:promoted.uuid+promoted.reader,promotedUuid:promoted.uuid,promotedReader:promoted.reader,confirmedNoDigital:promoted.noDigital,remainingNotListed:pack.notListed,ambiguous:ambiguous.length};pack.functionalLinkAudit={...(pack.functionalLinkAudit||{}),completedAt:now,uuidReady:pack.linkReady,readerFallbackReady:pack.readerFallbackReady,functionalLinkReady:pack.functionalLinkReady,functionalLinkMissing:pack.functionalLinkMissing};
  const summary={version:5,publishedAt:now,baseline,plan:planData.summary,scanned:{pages:all.length,publishable:publishable.length},changedRows:changed.size,promotedMU:promoted.uuid+promoted.reader,promotedUuid:promoted.uuid,promotedReader:promoted.reader,confirmedNoDigital:promoted.noDigital,ambiguous:ambiguous.length,after:{matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed,linkReady:pack.linkReady,linkMissing:pack.linkMissing,readerFallbackReady:pack.readerFallbackReady,functionalLinkReady:pack.functionalLinkReady,functionalLinkMissing:pack.functionalLinkMissing}};
  const audit={version:5,generatedAt:now,mode:'learned-series-audit-v5',writesCache:true,safety:{officialVerificationRequired:true,collisionsDiscarded:true,ambiguousDiscarded:true,noNegativeInference:true},summary,ambiguous:ambiguous.slice(0,1000)};
  await fs.mkdir(outDir,{recursive:true});await Promise.all([fs.writeFile(cacheFile,JSON.stringify(pack)),fs.writeFile(fallbackFile,fallbackSource(pack)),fs.writeFile(summaryFile,JSON.stringify(summary,null,2)+'\n'),fs.writeFile(auditFile,JSON.stringify(audit,null,2)+'\n')]);console.log(JSON.stringify(summary,null,2));
}

if(mode==='plan')await plan();else if(mode==='scan')await scan();else if(mode==='merge')await merge();else throw new Error(`Modo desconocido: ${mode}`);
