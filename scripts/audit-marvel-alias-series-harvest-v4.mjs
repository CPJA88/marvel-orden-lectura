import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const directFile=path.join(root,'artifacts','marvel-not-listed-v4','alias-direct-search-v4.json');
const outFile=path.join(root,'artifacts','marvel-not-listed-v4','alias-series-harvest-v4.json');
const ISSUE='https://www.marvel.com/comics/issue/';
const SHARE='https://share.marvel.com/sharing/reader/';
const UA='Mozilla/5.0 AppleWebKit/537.36 Chrome/140 Safari/537.36';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const str=v=>v==null?'':String(v);
const norm=v=>str(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
const normSeries=v=>norm(str(v).replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|present))?\s*\)/gi,' ')).replace(/^the\s+/,'').replace(/\s+comics?$/,'').trim();
const normIssue=v=>str(v).trim().toUpperCase().replace(/\s+/g,'');
const yearOf=v=>Number(str(v).match(/\b((?:19|20)\d{2})\b/)?.[1]||0);
const decode=v=>str(v).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ');
const plain=v=>decode(str(v).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
function titles(html){const out=[];for(const re of [/<h1\b[^>]*>([\s\S]*?)<\/h1>/ig,/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/ig,/<title[^>]*>([\s\S]*?)<\/title>/ig]){let m;while((m=re.exec(str(html)))){const t=plain(m[1]).replace(/\s*\|\s*Comic Issues\s*\|\s*Marvel.*$/i,'').trim();if(t&&!out.includes(t))out.push(t)}}return out}
function parseTitle(t){const m=decode(t).trim().match(/^(.*?)\s*(?:\(\s*(\d{4})(?:\s*-\s*(?:\d{4}|present))?\s*\))?\s*#\s*([^\s|]+)/i);return m?{series:m[1].trim(),year:Number(m[2]||0),issue:m[3].trim()}:null}
function issueVariants(raw){const out=new Set([normIssue(raw)]);const legacy=str(raw).trim().match(/^(.+?)\s*\(\d+\)\s*$/);if(legacy)out.add(normIssue(legacy[1]));const suffix=str(raw).trim().match(/^(\d+)\.[A-Z]+$/i);if(suffix)out.add(normIssue(suffix[1]));return out}
function readerId(html){const s=str(html);for(const re of [/sharing\/reader\/(\d+)/i,/sharing\/legacy\/(\d+)/i,/read\.marvel\.com\/#\/book\/(\d+)/i,/["'](?:digitalId|readerId)["']\s*:\s*["']?(\d+)/i,/(?:digitalId|readerId)%22%3A(?:%22)?(\d+)/i]){const m=s.match(re);if(m)return Number(m[1])||0}return 0}
function availability(html){const t=plain(html).toLowerCase(),mu=/members get unlimited access to this issue|this content is available through marvel unlimited|get unlimited access to this issue/.test(t),no=/digital issue (?:is )?not currently available/.test(t);if(mu&&!no)return'mu';if(no&&!mu)return'no-digital';return'unknown'}
function pageDate(html){const s=str(html);for(const re of [/["'](?:onSaleDate|onsaleDate|datePublished)["']\s*:\s*["'](\d{4}-\d{2}-\d{2})/i,/Published:\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i]){const m=s.match(re);if(m){const d=new Date(m[1]);if(!Number.isNaN(d.valueOf()))return d.toISOString().slice(0,10)}}return''}
async function get(url,tries=3){let last;for(let i=0;i<tries;i++){try{const r=await fetch(url,{headers:{'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(25000)});if(r.ok||r.status===404||r.status===410)return r;last=new Error(`HTTP ${r.status} ${url}`)}catch(e){last=e}await sleep(400*(i+1))}throw last}
function issueIdsFromHtml(html){const out=[],seen=new Set();for(const m of str(html).matchAll(/(?:https?:\/\/www\.marvel\.com)?\/comics\/issue\/(\d+)/gi)){const id=Number(m[1]);if(id&&!seen.has(id)){seen.add(id);out.push(id)}}return out}
function seriesSpec(row){const y=yearOf(row.date);if(row.localTitle==='Ultimate Comics Spider-Man')return{id:13831,slug:'ultimate_comics_spiderman_2011_2013',expected:'ultimate comics spider man'};if(row.localTitle==='Uncanny X-Men'&&y===2013)return{id:17602,slug:'uncanny_x-men_2013_-_2015',expected:'uncanny x men'};if(row.localTitle==='Uncanny X-Men'&&(y===2018||y===2019))return{id:26038,slug:'uncanny_x-men_2018_-_2019',expected:'uncanny x men'};if(row.localTitle==='Uncanny X-Men'&&y>=2024)return{id:39425,slug:'uncanny_x-men_2024_-_present',expected:'uncanny x men'};return null}
function identity(ts,row,spec){const issues=issueVariants(row.issueNumber);for(const t of ts){const p=parseTitle(t);if(!p)continue;if(normSeries(p.series)!==spec.expected)continue;if(!issues.has(normIssue(p.issue)))continue;return{ok:true,title:t,parsed:p}}return{ok:false}}
async function inspect(sourceId,row,spec){const r=await get(ISSUE+sourceId);if(r.status===404||r.status===410)return null;const html=await r.text(),ts=titles(html),id=identity(ts,row,spec);if(!id.ok)return null;const pd=pageDate(html),localDate=str(row.date).slice(0,10);if(pd&&localDate&&pd!==localDate)return null;const av=availability(html),rid=readerId(html);let reader={ok:false};if(av==='mu'&&rid){const rr=await get(SHARE+rid).catch(()=>null);if(rr?.ok){const rh=await rr.text(),rt=titles(rh),ri=identity(rt,row,spec);reader=ri.ok?{ok:true,title:ri.title}:{ok:false,titles:rt.slice(0,3)}}}const functional=av==='mu'&&reader.ok;return{sourceId,officialTitle:id.title,officialDate:pd,availability:av,readerId:rid,reader,functional}}

const [pack,direct]=await Promise.all([fs.readFile(cacheFile,'utf8').then(JSON.parse),fs.readFile(directFile,'utf8').then(JSON.parse)]);
if(Number(pack.localCount)!==51002||pack.entries?.length!==51002||Number(pack.matched)!==29106||Number(pack.noDigital)!==1131||Number(pack.notListed)!==20765||Number(pack.functionalLinkMissing)!==0)throw new Error(`Baseline inesperada ${pack.matched}/${pack.noDigital}/${pack.notListed}/${pack.functionalLinkMissing}`);
const targets=(direct.rows||[]).filter(x=>x.kind==='none');if(targets.length!==54)throw new Error(`Esperaba 54 targets, obtuvo ${targets.length}`);
const byId=new Map(pack.entries.map(r=>[Number(r[0]),r]));for(const x of targets)if(Number(byId.get(Number(x.gcdId))?.[3])!==4)throw new Error(`Target ${x.gcdId} dejó status4`);
const terminalOwners=new Map();for(const r of pack.entries){const sid=Number(r[1])||0;if(!sid||![1,3,5].includes(Number(r[3])))continue;const a=terminalOwners.get(sid)||[];a.push(Number(r[0]));terminalOwners.set(sid,a)}

const specs=new Map();for(const row of targets){const s=seriesSpec(row);if(!s)throw new Error(`Sin serie oficial para ${row.gcdId}`);specs.set(s.id,s)}
const idsBySeries=new Map();const pageDiagnostics=[];
for(const spec of specs.values()){
  const ids=new Set();
  const base=`https://www.marvel.com/comics/series/${spec.id}/${spec.slug}`;
  const variants=[base,`${base}?offset=20`,`${base}?offset=40`,`${base}?offset=60`,`${base}?offset=20&limit=20`,`${base}?limit=100`];
  for(const u of variants){try{const r=await get(u);if(!r.ok)continue;const html=await r.text(),found=issueIdsFromHtml(html);found.forEach(id=>ids.add(id));pageDiagnostics.push({seriesId:spec.id,url:u,issueIds:found.length})}catch(e){pageDiagnostics.push({seriesId:spec.id,url:u,error:e?.message||String(e)})}await sleep(80)}
  idsBySeries.set(spec.id,ids);
}
// Seeds manually identified on official Marvel pages; every seed is re-fetched and re-validated below.
const seeds=new Map([
  [875744,[38394]],
  [1168417,[48673]],
  [1875095,[71457]],
  [2649993,[115380]],
]);
const rows=[];
for(const [i,row] of targets.entries()){
  const spec=seriesSpec(row),candidateIds=new Set(idsBySeries.get(spec.id)||[]);for(const sid of seeds.get(Number(row.gcdId))||[])candidateIds.add(sid);
  const valid=[];for(const sid of candidateIds){if((terminalOwners.get(sid)||[]).some(id=>id!==Number(row.gcdId)))continue;try{const x=await inspect(sid,row,spec);if(x&&((x.availability==='mu'&&x.functional)||x.availability==='no-digital'))valid.push(x)}catch{}if(valid.length>1)break;await sleep(45)}
  rows.push({...row,officialSeriesId:spec.id,harvestedIds:candidateIds.size,validCandidates:valid,kind:valid.length===1?'unique':valid.length>1?'ambiguous':'none',selected:valid.length===1?valid[0]:null});if((i+1)%10===0)console.log(`Series harvest ${i+1}/54`)
}
const summary={targets:54,unique:rows.filter(x=>x.kind==='unique').length,mu:rows.filter(x=>x.selected?.availability==='mu').length,noDigital:rows.filter(x=>x.selected?.availability==='no-digital').length,ambiguous:rows.filter(x=>x.kind==='ambiguous').length,noCandidate:rows.filter(x=>x.kind==='none').length,writesCache:false};
const report={version:4,generatedAt:new Date().toISOString(),mode:'alias-series-harvest-v4',baseline:{matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed},summary,pageDiagnostics,rows};
await fs.mkdir(path.dirname(outFile),{recursive:true});await fs.writeFile(outFile,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
