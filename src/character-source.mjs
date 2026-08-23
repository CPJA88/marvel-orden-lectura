const MCP_ORIGIN='https://www.chronologyproject.com';

export function decodeHtml(value=''){
  return String(value)
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,'<')
    .replace(/&gt;/gi,'>')
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(Number.parseInt(n,16)||32))
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)||32));
}

export function textOnly(value=''){
  return decodeHtml(String(value).replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' '))
    .replace(/\s+/g,' ')
    .trim();
}

export function normalizeCharacterSource(value=''){
  let url;
  try{url=new URL(String(value||''),MCP_ORIGIN+'/')}catch{return null}
  if(url.hostname!=='www.chronologyproject.com'&&url.hostname!=='chronologyproject.com')return null;
  if(!/^\/[a-z0-9_-]+\.php$/i.test(url.pathname))return null;
  const anchor=decodeURIComponent(url.hash.slice(1));
  if(anchor&&!/^[A-Za-z0-9_-]{1,100}$/.test(anchor))return null;
  return{path:url.pathname.slice(1),anchor};
}

export function parseCharacterSearchHtml(html=''){
  const body=String(html);
  const start=body.search(/<p[^>]*>\s*Results for\b/i);
  if(start<0)return[];
  const tail=body.slice(start);
  const end=tail.search(/<p[^>]*>\s*(?:<br\s*\/?\s*>\s*)?The search query\b/i);
  const block=end<0?tail.slice(0,160000):tail.slice(0,end);
  const rows=[];
  const seen=new Set();
  for(const match of block.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    const source=normalizeCharacterSource(match[1]);
    const name=textOnly(match[2]);
    if(!source||!name)continue;
    const key=`${source.path}#${source.anchor}`;
    if(seen.has(key))continue;
    seen.add(key);
    rows.push({name,path:source.path,anchor:source.anchor});
    if(rows.length>=80)break;
  }
  return rows;
}

export function parseTitleKeyHtml(html=''){
  const body=String(html);
  const caption=body.search(/<caption[^>]*>\s*TITLE KEY By KEY\s*<\/caption>/i);
  if(caption<0)return[];
  const tableEnd=body.indexOf('</table>',caption);
  const table=body.slice(caption,tableEnd<0?body.length:tableEnd);
  const rows=[];
  for(const match of table.matchAll(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi)){
    const code=textOnly(match[1]),title=textOnly(match[2]),dates=textOnly(match[3]);
    if(!code||!title||code==='@'||code==="'")continue;
    rows.push({code,title,dates});
  }
  return rows.sort((a,b)=>b.code.length-a.code.length||a.code.localeCompare(b.code));
}

function escapeRegex(value=''){return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
function normalized(value=''){
  return textOnly(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
}

function markerAfter(html,start){
  const tail=html.slice(start);
  const patterns=[
    /<p\b[^>]*\bid=["'][A-Za-z0-9_-]+["'][^>]*>\s*(?:<span\b[^>]*class=["'][^"']*\bchar\b[^"']*["'][^>]*>\s*)?<b\b/gi,
    /<b\b[^>]*>\s*<a\b[^>]*\bname=["'][A-Za-z0-9_-]+["'][^>]*>/gi
  ];
  let next=-1;
  for(const pattern of patterns){const match=pattern.exec(tail);if(match&&(next<0||match.index<next))next=match.index}
  return next<0?-1:start+next;
}

export function extractCharacterSection(html='',anchor='',label=''){
  const body=String(html);
  let start=-1;
  if(anchor){
    const safe=escapeRegex(anchor);
    const marker=new RegExp(`<(?:a|p)\\b[^>]*(?:name|id)=["']${safe}["'][^>]*>`,'i').exec(body);
    if(marker)start=marker.index;
  }
  if(start<0&&label){
    const wanted=normalized(label).split(' EARTH ')[0];
    for(const match of body.matchAll(/<b\b[^>]*>([\s\S]*?)<\/b>\s*<br\s*\/?\s*>/gi)){
      const found=normalized(match[1]);
      if(found===wanted||found.startsWith(wanted+' ')||wanted.startsWith(found+' ')){
        start=match.index;
        break;
      }
    }
  }
  if(start<0)return'';
  const markerEnd=body.indexOf('>',start)+1;
  const next=markerAfter(body,Math.max(markerEnd,start+1));
  const footer=body.indexOf('<hr',Math.max(markerEnd,start+1));
  let end=body.length;
  if(next>=0)end=Math.min(end,next);
  if(footer>=0)end=Math.min(end,footer);
  return body.slice(start,end);
}

function baseKeyForAnnual(raw,keyRows){
  const match=/^([^\s@]+)@(?:\s+|$)/.exec(raw);
  if(!match)return null;
  const base=keyRows.find(row=>row.code===match[1]);
  return base?{base,rest:raw.slice(match[0].length).trim()}:null;
}

function parseIssueToken(token,keyRows){
  let raw=textOnly(token).replace(/^[\[{]+|[\]}]+$/g,'').trim();
  if(!raw||/\bBTS\b/i.test(raw)||/^SEE\b/i.test(raw))return null;
  raw=raw.replace(/\|cf\|.*$/i,'').trim();
  let key=null,rest='',annual=false;
  const annualKey=baseKeyForAnnual(raw,keyRows);
  if(annualKey){key=annualKey.base;rest=annualKey.rest;annual=true}
  if(!key){
    key=keyRows.find(row=>raw===row.code||raw.startsWith(row.code+' '));
    if(!key)return null;
    rest=raw.slice(key.code.length).trim();
  }
  if(/^'\d{2}\b/.test(rest)){annual=true;const yy=Number(rest.slice(1,3));rest=String(yy>=35?1900+yy:2000+yy)}
  let number=rest.split(/\s+/)[0]||'';
  number=number.replace(/-(?:FB|OP|VO|BTS)(?:-[A-Z]+)*$/i,'').replace(/\/(?:\d+|[A-Z])$/i,'').replace(/[;,]+$/,'');
  if(number.startsWith('('))number='';
  let title=annual?`${key.title} ANNUAL`:key.title;
  if(!number){
    const special=key.code.match(/\s+([^\s]*\d[^\s]*)$/)?.[1]||'';
    if(special&&normalized(title).endsWith(normalized(special))){
      number=special;
      title=title.slice(0,title.toUpperCase().lastIndexOf(special.toUpperCase())).trim();
    }
  }
  return{code:key.code,title,dates:key.dates,number,annual,raw};
}

export function parseCharacterAppearances(html='',options={},keyRows=[]){
  const section=extractCharacterSection(html,options.anchor||'',options.label||'');
  if(!section)return[];
  const refs=[];
  const seen=new Set();
  for(const fragment of section.split(/<br\s*\/?\s*>/i)){
    const line=textOnly(fragment);
    if(!line||/^(?:First Appearance|Earliest Chronological Appearance|Last Chronological Appearance):?/i.test(line))continue;
    const lineName=normalized(line),labelName=normalized(options.label||'');
    if(labelName&&(lineName===labelName||lineName.startsWith(labelName+' ')||labelName.startsWith(lineName+' ')))continue;
    for(const token of line.split(/[~=]/)){
      const ref=parseIssueToken(token,keyRows);
      if(!ref)continue;
      const id=`${ref.title}\u0000${ref.number}\u0000${ref.dates}`;
      if(seen.has(id))continue;
      seen.add(id);refs.push(ref);
    }
  }
  return refs;
}
