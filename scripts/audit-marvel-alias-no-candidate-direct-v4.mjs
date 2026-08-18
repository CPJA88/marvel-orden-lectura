import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const candidatesFile=path.join(root,'artifacts','marvel-not-listed-v4','alias-candidates-v4.json');
const outFile=path.join(root,'artifacts','marvel-not-listed-v4','alias-direct-search-v4.json');
const ISSUE='https://www.marvel.com/comics/issue/';
const SEARCH='https://www.marvel.com/search';
const SHARE='https://share.marvel.com/sharing/reader/';
const UA='Mozilla/5.0 AppleWebKit/537.36 Chrome/140 Safari/537.36';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const str=v=>v==null?'':String(v);
const norm=v=>str(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
const series=v=>norm(str(v).replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|present))?\s*\)/gi,' ')).replace(/^the\s+/,'').replace(/\s+comics?$/,'').trim();
const issue=v=>str(v).trim().toUpperCase().replace(/\s+/g,'');
const year=v=>Number(str(v).match(/\b((?:19|20)\d{2})\b/)?.[1]||0);
const decode=v=>str(v).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ');
const plain=v=>decode(str(v).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
function titles(html){const out=[];for(const re of [/<h1\b[^>]*>([\s\S]*?)<\/h1>/ig,/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/ig,/<title[^>]*>([\s\S]*?)<\/title>/ig]){let m;while((m=re.exec(str(html)))){const t=plain(m[1]).replace(/\s*\|\s*Comic Issues\s*\|\s*Marvel.*$/i,'').trim();if(t&&!out.includes(t))out.push(t)}}return out}
function parseTitle(t){const m=decode(t).trim().match(/^(.*?)\s*(?:\(\s*(\d{4})(?:\s*-\s*(?:\d{4}|present))?\s*\))?\s*#\s*([^\s|]+)/i);return m?{series:m[1].trim(),year:Number(m[2]||0),issue:m[3].trim()}:null}
function issueVariants(raw){const out=new Set([issue(raw)]);const m=str(raw).trim().match(/^(.+?)\s*\(\d+\)\s*$/);if(m)out.add(issue(m[1]));return out}
function readerId(html){const s=str(html);for(const re of [/sharing\/reader\/(\d+)/i,/sharing\/legacy\/(\d+)/i,/read\.marvel\.com\/#\/book\/(\d+)/i,/["'](?:digitalId|readerId)["']\s*:\s*["']?(\d+)/i]){const m=s.match(re);if(m)return Number(m[1])||0}return 0}
function availability(html){const t=plain(html).toLowerCase(),mu=/members get unlimited access to this issue|this content is available through marvel unlimited|get unlimited access to this issue/.test(t),no=/digital issue (?:is )?not currently available/.test(t);return mu&&!no?'mu':no&&!mu?'no-digital':'unknown'}
function pageDate(html){const s=str(html);for(const re of [/["'](?:onSaleDate|onsaleDate|datePublished)["']\s*:\s*["'](\d{4}-\d{2}-\d{2})/i,/Published:\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i]){const m=s.match(re);if(m){const d=new Date(m[1]);if(!Number.isNaN(d.valueOf()))return d.toISOString().slice(0,10)}}return''}
async function get(url,tries=3){let last;for(let i=0;i<tries;i++){try{const r=await fetch(url,{headers:{'User-Agent':UA,'Accept':'text/html,*/*','Accept-Language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(25000)});if(r.ok||r.status===404||r.status===410)return r;last=new Error(`HTTP ${r.status}`)}catch(e){last=e}await sleep(400*(i+1))}throw last}
function idsFromSearch(html){const out=[],seen=new Set();for(const m of str(html).matchAll(/(?:https?:\/\/www\.marvel\.com)?\/comics\/issue\/(\d+)/gi)){const id=Number(m[1]);if(id&&!seen.has(id)){seen.add(id);out.push(id)}if(out.length>=12)break}return out}
function allowedSeries(row){return new Set([series(row.localTitle),series(row.remoteNorm)].filter(Boolean))}
function identityOk(ts,row){const iv=issueVariants(row.issueNumber),as=allowedSeries(row);for(const t of ts){const p=parseTitle(t);if(!p)continue;if(!iv.has(issue(p.issue)))continue;if(as.has(series(p.series)))return{ok:true,title:t,parsed:p}}return{ok:false}}
async function inspect(sid,row){const r=await get(ISSUE+sid);if(r.status===404||r.status===410)return null;const html=await r.text(),ts=titles(html),id=identityOk(ts,row),pd=pageDate(html),av=availability(html),rid=readerId(html);if(!id.ok)return null;const ly=year(row.date),py=year(pd)||id.parsed.year||0;if(ly&&py&&Math.abs(ly-py)>1)return null;let reader={ok:false};if(av==='mu'&&rid){const rr=await get(SHARE+rid).catch(()=>null);if(rr?.ok){const rt=titles(await rr.text()),ri=identityOk(rt,row);reader=ri.ok?{ok:true,title:ri.title}:{ok:false,titles:rt.slice(0,3)}}}return{sourceId:sid,officialTitle:id.title,officialDate:pd,availability:av,readerId:rid,reader,functional:av==='mu'&&reader.ok}}
async function searchIds(row){const raw=str(row.issueNumber),iv=[...issueVariants(raw)],queries=[];for(const n of iv){queries.push(`${row.localTitle} ${n} ${year(row.date)||''}`.trim());if(row.remoteNorm)queries.push(`${row.remoteNorm} ${n} ${year(row.date)||''}`.trim())}const out=[],seen=new Set();for(const q of [...new Set(queries)]){const u=new URL(SEARCH);u.searchParams.set('content_type','comics');u.searchParams.set('query',q);try{const r=await get(u.toString());if(r.ok)for(const id of idsFromSearch(await r.text()))if(!seen.has(id)){seen.add(id);out.push(id)}}catch{}if(out.length>=12)break;await sleep(80)}return out.slice(0,12)}

const [pack,cand]=await Promise.all([fs.readFile(cacheFile,'utf8').then(JSON.parse),fs.readFile(candidatesFile,'utf8').then(JSON.parse)]);
if(Number(pack.localCount)!==51002||pack.entries?.length!==51002)throw new Error('Cache base inválida.');
const byId=new Map(pack.entries.map(r=>[Number(r[0]),r]));
const targets=(cand.rows||[]).filter(x=>x.kind==='none');
if(targets.length!==54)throw new Error(`Esperaba 54 sin candidato, obtuvo ${targets.length}`);
for(const x of targets)if(Number(byId.get(Number(x.gcdId))?.[3])!==4)throw new Error(`Target ${x.gcdId} dejó status4`);
const terminalOwners=new Map();for(const r of pack.entries){const sid=Number(r[1])||0;if(!sid||![1,3,5].includes(Number(r[3])))continue;const a=terminalOwners.get(sid)||[];a.push(Number(r[0]));terminalOwners.set(sid,a)}
const rows=[];for(const [i,row] of targets.entries()){const ids=await searchIds(row),valid=[];for(const sid of ids){if((terminalOwners.get(sid)||[]).some(id=>id!==Number(row.gcdId)))continue;try{const x=await inspect(sid,row);if(x&&((x.availability==='mu'&&x.functional)||x.availability==='no-digital'))valid.push(x)}catch{}if(valid.length>1)break;await sleep(70)}rows.push({...row,searchIds:ids,validCandidates:valid,kind:valid.length===1?'unique':valid.length>1?'ambiguous':'none',selected:valid.length===1?valid[0]:null});if((i+1)%10===0)console.log(`Direct ${i+1}/54`)}
const summary={targets:54,unique:rows.filter(x=>x.kind==='unique').length,mu:rows.filter(x=>x.selected?.availability==='mu').length,noDigital:rows.filter(x=>x.selected?.availability==='no-digital').length,ambiguous:rows.filter(x=>x.kind==='ambiguous').length,noCandidate:rows.filter(x=>x.kind==='none').length,writesCache:false};
await fs.mkdir(path.dirname(outFile),{recursive:true});await fs.writeFile(outFile,JSON.stringify({version:4,generatedAt:new Date().toISOString(),mode:'alias-direct-search-v4',baseline:{matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed},summary,rows},null,2)+'\n');console.log(JSON.stringify(summary,null,2));
