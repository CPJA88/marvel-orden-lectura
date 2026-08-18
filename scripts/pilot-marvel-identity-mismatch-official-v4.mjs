import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const diagFile=path.join(root,'artifacts','marvel-not-listed-v4','identity-mismatch-diagnostic.json');
const outFile=path.join(root,'artifacts','marvel-not-listed-v4','identity-mismatch-official-pilot.json');
const ISSUE='https://www.marvel.com/comics/issue/';
const UA='Mozilla/5.0 AppleWebKit/537.36 Chrome/140 Safari/537.36';
const EXPECTED=429;
const str=v=>v==null?'':String(v);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const norm=v=>str(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
const series=v=>norm(str(v).replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|present))?\s*\)/gi,' ')).replace(/^the\s+/,'').replace(/\s+comics?$/,'').trim();
const issue=v=>{let s=str(v).trim().toUpperCase().replace(/\s+/g,'');if(/^0+\d+$/.test(s))s=String(Number(s));return s};
const decode=v=>str(v).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ');
const text=v=>decode(str(v).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
function title(html){const h=str(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];if(h)return text(h);const o=str(html).match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];return decode(o||str(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').replace(/\s*\|\s*Comic Issues\s*\|\s*Marvel.*$/i,'').trim()}
function parse(t){const m=str(t).match(/^(.*?)\s*(?:\(\s*(\d{4})(?:\s*-\s*(?:\d{4}|present))?\s*\))?\s*#\s*([^\s|]+)/i);return m?{series:m[1].trim(),year:Number(m[2]||0),issue:m[3].trim()}:null}
function pub(html){const s=str(html),j=s.match(/["']datePublished["']\s*:\s*["']([^"']+)/i);if(j){const d=new Date(j[1]);if(Number.isFinite(d.getTime()))return d.toISOString().slice(0,10)}const m=text(s).match(/\bPublished\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/i);if(!m)return'';const d=new Date(`${m[1]} ${m[2]}, ${m[3]} UTC`);return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):''}
function availability(html){const t=text(html).toLowerCase();if(/digital issue (?:is )?not currently available/.test(t))return'no-digital';if(/members get unlimited access to this issue/.test(t)||/get unlimited access to this issue/.test(t))return'mu';return'unknown'}
function dateOk(a,b){if(!a||!b)return false;const x=new Date(`${a}T00:00:00Z`),y=new Date(`${b}T00:00:00Z`);return Math.abs(x-y)/86400000<=240&&Math.abs(x.getUTCFullYear()-y.getUTCFullYear())<=1}
async function get(url){let last;for(let i=0;i<4;i++){try{const r=await fetch(url,{headers:{'User-Agent':UA,'Accept':'text/html,*/*'},signal:AbortSignal.timeout(25000)});if(r.ok||r.status===404||r.status===410)return r;last=new Error(`HTTP ${r.status}`)}catch(e){last=e}await sleep(500*(2**i))}throw last||new Error('Sin respuesta')}
async function inspect(row){const r=await get(ISSUE+row.sourceId);if(r.status===404||r.status===410)return{gcdId:row.gcdId,kind:'not-found',sourceId:row.sourceId};const html=await r.text(),t=title(html),p=parse(t),d=pub(html),av=availability(html);const num=Boolean(p&&issue(p.issue)===issue(row.localIssue));const exact=Boolean(num&&(series(p.series)===series(row.expectedSeries)||series(p.series)===series(row.localTitle)));const alias=Boolean(num&&series(p?.series)===series(row.actualSeries));const dates=dateOk(row.localDate,d);return{gcdId:row.gcdId,sourceId:row.sourceId,title:t,officialDate:d,availability:av,numberExact:num,identityMode:exact?'exact-official-title':alias?'confirmed-repeated-alias':'mismatch',dateCompatible:dates,kind:(exact||alias)&&dates&&(av==='mu'||av==='no-digital')?av:(exact||alias)&&!dates?'date-mismatch':!(exact||alias)?'identity-mismatch':'unknown'}}

const [pack,diag]=await Promise.all([fs.readFile(cacheFile,'utf8').then(JSON.parse),fs.readFile(diagFile,'utf8').then(JSON.parse)]);
if(Number(pack.localCount)!==51002||Number(pack.matched)!==28673||Number(pack.noDigital)!==1131||Number(pack.notListed)!==21198)throw new Error('Baseline V4 cambió.');
const targets=(diag.rows||[]).filter(x=>x.pilotEligible).sort((a,b)=>a.gcdId-b.gcdId);if(targets.length!==EXPECTED)throw new Error(`Targets=${targets.length}, esperado=${EXPECTED}`);
const results=[];let n=0;
for(const row of targets){try{results.push(await inspect(row))}catch(e){results.push({gcdId:row.gcdId,sourceId:row.sourceId,kind:'retryable',reason:e?.message||String(e)})}n++;if(n%25===0)console.log(`${n}/${targets.length}`);await sleep(120)}
const count=k=>results.filter(x=>x.kind===k).length,summary={targets:results.length,mu:count('mu'),noDigital:count('no-digital'),identityMismatch:count('identity-mismatch'),dateMismatch:count('date-mismatch'),unknown:count('unknown'),notFound:count('not-found'),retryable:count('retryable'),exactOfficialTitle:results.filter(x=>x.identityMode==='exact-official-title').length,confirmedRepeatedAlias:results.filter(x=>x.identityMode==='confirmed-repeated-alias').length};
await fs.mkdir(path.dirname(outFile),{recursive:true});await fs.writeFile(outFile,JSON.stringify({version:4,generatedAt:new Date().toISOString(),mode:'identity-mismatch-official-pilot',writesCache:false,baseline:{matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed},summary,results},null,2)+'\n');console.log(JSON.stringify(summary,null,2));
