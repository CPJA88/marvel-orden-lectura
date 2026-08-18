import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const pilotFile=path.join(root,'artifacts','marvel-not-listed-v4','identity-mismatch-official-pilot.json');
const diagFile=path.join(root,'artifacts','marvel-not-listed-v4','identity-mismatch-diagnostic.json');
const outFile=path.join(root,'artifacts','marvel-not-listed-v4','identity-mismatch-link-audit.json');
const ISSUE='https://www.marvel.com/comics/issue/';
const SHARE='https://share.marvel.com/sharing/reader/';
const SMART='https://marvel.smart.link/fiir7ec77';
const UA='Mozilla/5.0 AppleWebKit/537.36 Chrome/140 Safari/537.36';
const DRN_RE=/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i;
const str=v=>v==null?'':String(v),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const norm=v=>str(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
const series=v=>norm(str(v).replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|present))?\s*\)/gi,' ')).replace(/^the\s+/,'').replace(/\s+comics?$/,'').trim();
const issue=v=>{let s=str(v).trim().toUpperCase().replace(/\s+/g,'');if(/^0+\d+$/.test(s))s=String(Number(s));return s};
const decode=v=>str(v).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ');
const text=v=>decode(str(v).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
function title(html){const h=str(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];if(h)return text(h);return decode(str(html).match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]||str(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').replace(/\s*\|\s*Comic Issues\s*\|\s*Marvel.*$/i,'').trim()}
function parse(t){const m=str(t).match(/^(.*?)\s*(?:\(\s*(\d{4})(?:\s*-\s*(?:\d{4}|present))?\s*\))?\s*#\s*([^\s|]+)/i);return m?{series:m[1].trim(),issue:m[3].trim()}:null}
function readerId(html){const s=str(html);for(const re of [/sharing\/reader\/(\d+)/i,/sharing\/legacy\/(\d+)/i,/read\.marvel\.com\/#\/book\/(\d+)/i,/["'](?:digitalId|readerId)["']\s*:\s*["']?(\d+)/i,/(?:digitalId|readerId)%22%3A(?:%22)?(\d+)/i]){const m=s.match(re);if(m)return Number(m[1])||0}return 0}
const drn=html=>str(html).replace(/\\u003A/gi,':').replace(/%3A/gi,':').match(DRN_RE)?.[0]||'';
const cover=html=>decode(str(html).match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]||'').replace(/^http:/i,'https:');
function availability(html){const t=text(html).toLowerCase();if(/digital issue (?:is )?not currently available/.test(t))return'no-digital';if(/members get unlimited access to this issue/.test(t)||/get unlimited access to this issue/.test(t)||/this content is available through marvel unlimited/.test(t))return'mu';return'unknown'}
async function get(url,{manual=false,tries=4}={}){let last;for(let i=0;i<tries;i++){try{const r=await fetch(url,{redirect:manual?'manual':'follow',headers:{'User-Agent':UA,'Accept':'text/html,*/*'},signal:AbortSignal.timeout(25000)});if(r.ok||(manual&&r.status>=300&&r.status<400)||r.status===404||r.status===410)return r;last=new Error(`HTTP ${r.status}`)}catch(e){last=e}await sleep(500*(2**i))}throw last||new Error('Sin respuesta')}
async function inspect(row,meta){const r=await get(ISSUE+row.sourceId);if(r.status===404||r.status===410)return{gcdId:row.gcdId,sourceId:row.sourceId,kind:'not-found'};const html=await r.text(),rid=readerId(html),d=drn(html),c=cover(html),av=availability(html);if(av!=='mu')return{gcdId:row.gcdId,sourceId:row.sourceId,kind:'availability-regression',availability:av};let reader={ok:false,reason:'missing-reader-id'};if(rid){try{const rr=await get(SHARE+rid,{tries:3});if(rr.ok){const t=title(await rr.text()),p=parse(t);reader={ok:Boolean(p&&issue(p.issue)===issue(meta.localIssue)&&series(p.series)===series(meta.actualSeries)),title:t,smartLink:`${SMART}?type=reader&drn=${rid}`}}}catch(e){reader={ok:false,transient:true,reason:e?.message||String(e)}}let uuid={ok:false,reason:'missing-drn'};if(d){try{const ur=await get(`${SMART}?type=issue&drn=${encodeURIComponent(d)}&sourceId=${row.sourceId}`,{manual:true,tries:2});uuid={ok:ur.status>=200&&ur.status<400&&![403,429].includes(ur.status),status:ur.status,location:ur.headers.get('location')||''}}catch(e){uuid={ok:false,transient:true,reason:e?.message||String(e)}}return{gcdId:row.gcdId,sourceId:row.sourceId,readerId:rid,drn:d,cover:c,kind:'mu',reader,uuid,functional:Boolean(reader.ok||uuid.ok)}}

const [pack,pilot,diag]=await Promise.all([fs.readFile(cacheFile,'utf8').then(JSON.parse),fs.readFile(pilotFile,'utf8').then(JSON.parse),fs.readFile(diagFile,'utf8').then(JSON.parse)]);
if(Number(pack.localCount)!==51002||Number(pack.matched)!==28673||Number(pack.noDigital)!==1131||Number(pack.notListed)!==21198)throw new Error('Baseline V4 cambió.');
if(Number(pilot?.summary?.targets)!==429||Number(pilot?.summary?.mu)!==429)throw new Error('Piloto oficial no está íntegramente confirmado.');
const meta=new Map((diag.rows||[]).filter(x=>x.pilotEligible).map(x=>[Number(x.gcdId),x])),byId=new Map(pack.entries.map(r=>[Number(r[0]),r]));
const terminalSource=new Set(pack.entries.filter(r=>[1,3,5].includes(Number(r[3]))).map(r=>Number(r[1])).filter(Boolean));
const results=[];for(const row of pilot.results){const cur=byId.get(Number(row.gcdId));if(!cur||Number(cur[3])!==4)throw new Error(`GCD ${row.gcdId} dejó de ser NOT_LISTED.`);if(terminalSource.has(Number(row.sourceId)))throw new Error(`sourceId ocupado: ${row.sourceId}`);const m=meta.get(Number(row.gcdId));if(!m)throw new Error(`Sin metadata ${row.gcdId}`);try{results.push(await inspect(row,m))}catch(e){results.push({gcdId:row.gcdId,sourceId:row.sourceId,kind:'retryable',reason:e?.message||String(e)})}if(results.length%25===0)console.log(`${results.length}/429`);await sleep(120)}
const count=k=>results.filter(x=>x.kind===k).length,summary={targets:results.length,mu:count('mu'),functional:results.filter(x=>x.kind==='mu'&&x.functional).length,readerFunctional:results.filter(x=>x.reader?.ok).length,uuidFunctional:results.filter(x=>x.uuid?.ok).length,missingFunctional:results.filter(x=>x.kind==='mu'&&!x.functional).length,notFound:count('not-found'),availabilityRegression:count('availability-regression'),retryable:count('retryable')};
await fs.writeFile(outFile,JSON.stringify({version:4,generatedAt:new Date().toISOString(),mode:'identity-mismatch-link-audit',writesCache:false,baseline:{matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed},summary,results},null,2)+'\n');console.log(JSON.stringify(summary,null,2));
