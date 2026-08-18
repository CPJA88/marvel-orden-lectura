import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const cacheFile=path.join(root,'source','marvel-cache','index.json');
const candidatesFile=path.join(root,'artifacts','marvel-not-listed-v4','alias-candidates-v4.json');
const outFile=path.join(root,'artifacts','marvel-not-listed-v4','alias-official-audit-v4.json');
const ISSUE='https://www.marvel.com/comics/issue/';
const SHARE='https://share.marvel.com/sharing/reader/';
const SMART='https://marvel.smart.link/fiir7ec77';
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const STATUS={MU:1,NO_DIGITAL:3,NOT_LISTED:4,MU_LINK_MISSING:5};
const DRN_RE=/drn:src:marvel:unison::prod:[0-9a-f-]{36}/i;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const str=v=>v==null?'':String(v);
const norm=v=>str(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
const normSeries=v=>norm(str(v).replace(/\(\s*\d{4}(?:\s*-\s*(?:\d{4}|present))?\s*\)/gi,' ')).replace(/^the\s+/,'').replace(/\s+comics?$/,'').trim();
const normIssue=v=>{let s=str(v).trim().toUpperCase().replace(/\s+/g,'');if(/^0+\d+$/.test(s))s=String(Number(s));return s};
const yearOf=v=>Number(str(v).match(/\b((?:19|20)\d{2})\b/)?.[1]||0);
const decode=v=>str(v).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)||32));
const plain=v=>decode(str(v).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
function titles(html){const out=[];for(const re of [/<h1\b[^>]*>([\s\S]*?)<\/h1>/ig,/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/ig,/<title[^>]*>([\s\S]*?)<\/title>/ig]){let m;while((m=re.exec(str(html)))){const t=plain(m[1]).replace(/\s*\|\s*Comic Issues\s*\|\s*Marvel.*$/i,'').trim();if(t&&!out.includes(t))out.push(t)}}return out}
function parseTitle(t){const m=decode(t).trim().match(/^(.*?)\s*(?:\(\s*(\d{4})(?:\s*-\s*(?:\d{4}|present))?\s*\))?\s*#\s*([^\s|]+)/i);return m?{series:m[1].trim(),year:Number(m[2]||0),issue:m[3].trim()}:null}
function pageDate(html){const s=str(html);for(const re of [/["'](?:onSaleDate|onsaleDate|datePublished)["']\s*:\s*["'](\d{4}-\d{2}-\d{2})/i,/Published:\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i]){const m=s.match(re);if(m){const d=new Date(m[1]);if(!Number.isNaN(d.valueOf()))return d.toISOString().slice(0,10)}}return''}
function availability(html){const t=plain(html).toLowerCase();const mu=/members get unlimited access to this issue|this content is available through marvel unlimited|get unlimited access to this issue/.test(t);const no=/digital issue (?:is )?not currently available/.test(t);return mu&&!no?'mu':no&&!mu?'no-digital':mu&&no?'conflict':'unknown'}
function extractReaderId(html){const s=str(html);for(const re of [/sharing\/reader\/(\d+)/i,/sharing\/legacy\/(\d+)/i,/read\.marvel\.com\/#\/book\/(\d+)/i,/["'](?:digitalId|readerId)["']\s*:\s*["']?(\d+)/i,/(?:digitalId|readerId)%22%3A(?:%22)?(\d+)/i]){const m=s.match(re);if(m)return Number(m[1])||0}return 0}
const extractDrn=html=>str(html).replace(/\\u003A/gi,':').replace(/%3A/gi,':').match(DRN_RE)?.[0]||'';
const extractCover=html=>decode(str(html).match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]||'').replace(/^http:/i,'https:');
async function get(url,{tries=4,manual=false}={}){let last;for(let i=0;i<tries;i++){try{const r=await fetch(url,{redirect:manual?'manual':'follow',headers:{'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9'},signal:AbortSignal.timeout(25000)});if(r.ok||(manual&&r.status>=300&&r.status<400)||r.status===404||r.status===410)return r;last=new Error(`HTTP ${r.status} ${url}`)}catch(e){last=e}await sleep(Math.min(8000,600*(2**i)))}throw last||new Error(`Sin respuesta ${url}`)}
function identityFromTitles(ts,expectedSeries,expectedIssue){for(const t of ts){const p=parseTitle(t);if(!p)continue;if(normIssue(p.issue)!==normIssue(expectedIssue))continue;if(normSeries(p.series)!==normSeries(expectedSeries))continue;return{ok:true,title:t,parsed:p}}return{ok:false,titles:ts.slice(0,4)}}
async function readerCheck(readerId,expectedSeries,expectedIssue){if(!readerId)return{ok:false,reason:'missing-reader-id'};try{const r=await get(SHARE+readerId,{tries:3});if(!r.ok)return{ok:false,status:r.status};const html=await r.text(),ts=titles(html),id=identityFromTitles(ts,expectedSeries,expectedIssue);return id.ok?{ok:true,title:id.title,smartLink:`${SMART}?type=reader&drn=${readerId}`}:{ok:false,reason:'reader-identity-mismatch',titles:ts.slice(0,4)}}catch(e){return{ok:false,transient:true,reason:e?.message||String(e)}}}

const [pack,candidates]=await Promise.all([fs.readFile(cacheFile,'utf8').then(JSON.parse),fs.readFile(candidatesFile,'utf8').then(JSON.parse)]);
if(Number(pack.localCount)!==51002||pack.entries?.length!==51002||Number(pack.matched)!==29105||Number(pack.noDigital)!==1131||Number(pack.notListed)!==20766||Number(pack.functionalLinkMissing)!==0)throw new Error(`Baseline inesperada ${pack.matched}/${pack.noDigital}/${pack.notListed}/${pack.functionalLinkMissing}`);
if(Number(candidates?.version)!==4||candidates?.mode!=='alias-discovery-candidates'||Number(candidates?.summary?.unique)!==2||Number(candidates?.summary?.ambiguous)!==0||Number(candidates?.summary?.collision)!==0)throw new Error('Candidatos de alias incompatibles.');
const rows=(candidates.rows||[]).filter(x=>x.kind==='unique'&&x.candidate);
if(rows.length!==2)throw new Error(`Se esperaban 2 candidatos únicos, hay ${rows.length}.`);
const byId=new Map(pack.entries.map(r=>[Number(r[0]),r]));
const terminalOwners=new Map();for(const r of pack.entries){const sid=Number(r[1])||0;if(!sid||![STATUS.MU,STATUS.NO_DIGITAL,STATUS.MU_LINK_MISSING].includes(Number(r[3])))continue;const a=terminalOwners.get(sid)||[];a.push(Number(r[0]));terminalOwners.set(sid,a)}
const results=[];
for(const x of rows){const gcdId=Number(x.gcdId),cur=byId.get(gcdId),c=x.candidate;if(!cur||Number(cur[3])!==STATUS.NOT_LISTED){results.push({gcdId,kind:'safety-failure',reason:'target-no-longer-status4'});continue}const sourceId=Number(c.sourceId)||0,collision=(terminalOwners.get(sourceId)||[]).filter(id=>id!==gcdId);if(!sourceId||collision.length){results.push({gcdId,sourceId,kind:'safety-failure',reason:'source-collision',collision});continue}
  try{const r=await get(ISSUE+sourceId);if(r.status===404||r.status===410){results.push({gcdId,sourceId,kind:'not-found'});continue}const html=await r.text(),ts=titles(html),pageId=identityFromTitles(ts,c.seriesName,x.issueNumber),av=availability(html),pd=pageDate(html),readerId=extractReaderId(html)||Number(c.readerId)||0,drn=extractDrn(html),cover=extractCover(html),dateCompatible=!pd||yearOf(pd)===yearOf(x.date),reader=av==='mu'?await readerCheck(readerId,c.seriesName,x.issueNumber):{ok:false,reason:'not-mu'};let uuid={ok:false};if(drn){try{const u=await get(`${SMART}?type=issue&drn=${encodeURIComponent(drn)}&sourceId=${sourceId}`,{manual:true,tries:2});uuid={ok:u.status>=200&&u.status<400&&!([403,429].includes(u.status)),status:u.status}}catch(e){uuid={ok:false,transient:true,reason:e?.message||String(e)}}}const functional=Boolean(reader.ok||uuid.ok);let kind='identity-mismatch';if(pageId.ok&&dateCompatible){if(av==='mu')kind=functional?'mu':'mu-link-missing';else if(av==='no-digital')kind='no-digital';else kind='unknown'}results.push({gcdId,seriesId:Number(x.seriesId),localTitle:x.localTitle,issueNumber:x.issueNumber,date:x.date,aliasId:x.aliasId,sourceId,officialTitle:pageId.ok?pageId.title:(ts[0]||''),officialDate:pd,identityExact:pageId.ok,dateCompatible,availability:av,readerId,drn,cover,reader,uuid,functional,kind})}catch(e){results.push({gcdId,sourceId,kind:'retryable',reason:e?.message||String(e)})}
  await sleep(120)
}
const count=k=>results.filter(x=>x.kind===k).length;
const summary={targets:results.length,mu:count('mu'),noDigital:count('no-digital'),muLinkMissing:count('mu-link-missing'),unknown:count('unknown'),identityMismatch:count('identity-mismatch'),notFound:count('not-found'),retryable:count('retryable'),safetyFailure:count('safety-failure'),functional:results.filter(x=>x.kind==='mu'&&x.functional).length,writesCache:false};
const report={version:4,generatedAt:new Date().toISOString(),mode:'alias-official-audit-v4',baseline:{matched:pack.matched,noDigital:pack.noDigital,notListed:pack.notListed},summary,results};
await fs.mkdir(path.dirname(outFile),{recursive:true});await fs.writeFile(outFile,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
