import fs from 'node:fs/promises';
import path from 'node:path';

const NOISE_WORDS=new Set(['a','an','and','annual','the','marvel','comics','comic','vol','volume']);
const SERIES_NOISE=/\b(?:omnibus|collection|collected|trade paperback|hardcover|masterworks|epic collection|gallery edition|facsimile|marvel legends reprint|true believers|director(?:'|’)?s cut|sketchbook|poster book|handbook)\b/i;
const REPRINT_NUMBER=/\[(?:second|third|fourth|fifth|reprint|variant|x-tra|newsstand|direct|jc penney|marvel legends)[^\]]*\]/i;

const SERIES_ALIASES=new Map(Object.entries({
  'amazing spider man':'the amazing spider man',
  'avengers':'the avengers',
  'incredible hulk':'the incredible hulk',
  'uncanny x men':'the uncanny x men',
  'fantastic four':'the fantastic four',
  'spectacular spider man':'the spectacular spider man',
  'punisher':'the punisher',
  'punisher war journal':'the punisher war journal',
  'mighty thor':'the mighty thor',
  'mighty avengers':'the mighty avengers',
  'new mutants':'the new mutants',
  'new warriors':'the new warriors',
  'defenders':'the defenders',
  'invaders':'the invaders',
  'inhumans':'the inhumans',
  'illuminati':'new avengers illuminati',
  'world war hulk aftersmash damage control':'wwh aftersmash damage control',
  'world war hulk aftersmash warbound':'wwh aftersmash warbound',
  'damage control':'wwh aftersmash damage control',
  'peter parker the spectacular spider man':'the spectacular spider man',
  'spirits of vengeance':'ghost rider blaze spirits of vengeance',
  'darkhold':'darkhold pages from the book of sins',
  'inhumans vs x men':'ivx',
  'hulked out heroes':'world war hulks hulked out heroes',
  'daredevil women without fear':'daredevil woman without fear',
  '2020 iron heart':'2020 ironheart',
  'iwolverine':'2020 iwolverine',
  'x men endangered species':'x men endangered species one shot',
  'maximum clonage alpha':'spider man maximum clonage alpha',
  'amazing spider man soul of the hunter':'spider man soul of the hunter',
  'silver sable':'silver sable and the wild pack',
  'iron man director of s h i e l d':'iron man',
  'peter parker spider man':'spider man',
  'marvel super hero contest of champions':'marvel super hero contest of champions',
  'contest of champions 1982':'marvel super hero contest of champions'
}));

export function decodeHtml(value=''){
  const named={amp:'&',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',hellip:'…'};
  return String(value).replace(/&#(x?[0-9a-f]+);/gi,(_,code)=>String.fromCodePoint(code[0].toLowerCase()==='x'?parseInt(code.slice(1),16):parseInt(code,10))).replace(/&([a-z]+);/gi,(entity,name)=>named[name.toLowerCase()]??entity);
}

export function normalizeSeries(value=''){
  return decodeHtml(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[‘’`]/g,"'").replace(/\b(?:vol(?:ume)?\.?\s*\d+)\b/gi,' ').replace(/\bmarvel(?:'s)?\b/g,' marvel ').replace(/[^a-z0-9]+/g,' ').replace(/\b2099\s+a\s+d\b/g,'2099').replace(/\bmi\s+13\b/g,'mi13').replace(/\b2020\s+iron\s+heart\b/g,'2020 ironheart').trim().replace(/^the\s+/,'');
}

export function canonicalSeries(value=''){
  const normalized=normalizeSeries(value);
  return normalizeSeries(SERIES_ALIASES.get(normalized)||normalized);
}

export function normalizeNumber(value=''){
  const cleaned=decodeHtml(value).trim().toLowerCase().replace(/[‘’]/g,"'").replace(/^#/,'').replace(/\s+/g,' ');
  if(/^\[?nn\]?$/.test(cleaned))return'nn';
  return(cleaned.match(/^-?\d+(?:\.\d+)?(?:\.[a-z]+|[a-z]+)?|^\d+\/\d+|^[a-z]+/)?.[0]||cleaned.replace(/[^a-z0-9.-]+/g,'')).replace(/(\d)\.([a-z])/,'$1$2');
}

function extractVolume(series){
  const match=String(series).match(/\s+Vol(?:ume)?\.?\s*(\d+)\s*$/i);
  return{series:match?String(series).slice(0,match.index).replace(/[.\s]+$/,'').trim():String(series).trim(),volume:match?Number(match[1]):null};
}

function parseIssueLine(line){
  const cleaned=decodeHtml(line).replace(/\u00a0/g,' ').replace(/^\s*[•·]\s*/,'').replace(/^Optionally(?:,)?\s+you\s+can\s+read\s+/i,'').replace(/\s+/g,' ').trim();
  if(!cleaned)return null;
  const annual=cleaned.match(/^(.+?)\s+Annual\s+[‘’'](\d{2})(?:\s*[-–—].*)?$/i);
  if(annual){
    const year=Number(annual[2])+(Number(annual[2])<40?2000:1900);
    return{series:`${annual[1].trim()} '${annual[2]}`,number:'1',publicationYear:year,sourceText:cleaned};
  }
  const match=cleaned.match(/^(.+?)\s+#\s*(-?\d+(?:\.\d+)?(?:\.[A-Za-z]+|[A-Za-z]+)?|\d+\/\d+|\[?nn\]?|[A-Za-z]+)(?:\s*\((\d{4})\))?(?:\s*[-–—].*)?$/);
  if(!match)return null;
  const volume=extractVolume(match[1]);
  return{series:volume.series,volume:volume.volume,number:match[2],publicationYear:match[3]?Number(match[3]):null,sourceText:cleaned};
}

export function parseIssueLines(lines,eventYear){
  const parsed=lines.map(parseIssueLine).filter(Boolean);
  const nextYear=new Map();
  for(let index=parsed.length-1;index>=0;index--){
    const ref=parsed[index];
    const key=`${canonicalSeries(ref.series)}|${ref.volume||''}`;
    if(ref.publicationYear)nextYear.set(key,ref.publicationYear);
    else if(nextYear.has(key))ref.publicationYear=nextYear.get(key);
  }
  const previousYear=new Map();
  return parsed.map((ref,index)=>{
    const key=`${canonicalSeries(ref.series)}|${ref.volume||''}`;
    if(ref.publicationYear)previousYear.set(key,ref.publicationYear);
    const publicationYear=ref.publicationYear||previousYear.get(key)||Number(eventYear);
    return{...ref,publicationYear,sourceOrder:index+1};
  });
}

export function parseCbroHtml(html,eventYear){
  const panel=String(html).match(/<div[^>]*role=["']tabpanel["'][^>]*aria-hidden=["']false["'][^>]*>([\s\S]*?)<\/div>/i)||String(html).match(/<div[^>]*role=["']tabpanel["'][^>]*>([\s\S]*?)<\/div>/i);
  if(!panel)return[];
  const text=panel[1].replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/p>/gi,'\n').replace(/<\/li>/gi,'\n').replace(/<[^>]+>/g,'');
  return parseIssueLines(decodeHtml(text).split(/\r?\n/).map(line=>line.trim()).filter(Boolean),eventYear);
}

function yearOf(issue){
  const sale=Number(String(issue?.d||'').slice(0,4));
  return Number.isInteger(sale)&&sale>1900?sale:Number(issue?.a)||0;
}

function titleTokens(value){
  return new Set(canonicalSeries(value).split(/\s+/).filter(token=>token&&!NOISE_WORDS.has(token)));
}

function similarity(left,right){
  const a=titleTokens(left),b=titleTokens(right);
  if(!a.size||!b.size)return 0;
  const overlap=[...a].filter(token=>b.has(token)).length;
  return 2*overlap/(a.size+b.size);
}

export function buildLibraryIndex(seriesRows,issues){
  const seriesById=new Map(seriesRows.map(series=>[Number(series.id),series]));
  const issuesBySeries=new Map();
  for(const issue of issues){
    const series=seriesById.get(Number(issue.s));
    if(!series||SERIES_NOISE.test(series.original||''))continue;
    if(!issuesBySeries.has(Number(issue.s)))issuesBySeries.set(Number(issue.s),[]);
    issuesBySeries.get(Number(issue.s)).push(issue);
  }
  const descriptors=[];
  const byCanonical=new Map();
  for(const [seriesId,seriesIssues]of issuesBySeries){
    const series=seriesById.get(seriesId);
    const key=canonicalSeries(series.original);
    const ordered=[...seriesIssues].sort((a,b)=>String(a.d||'').localeCompare(String(b.d||''))||Number(a.id)-Number(b.id));
    const starts=[...new Set(ordered.filter(issue=>normalizeNumber(issue.n)==='1').map(issue=>String(issue.d||'').slice(0,10)))];
    const volumeByIssueId=new Map();
    let volume=starts.length?0:null;
    for(const issue of ordered){
      if(normalizeNumber(issue.n)==='1'){
        const startIndex=starts.indexOf(String(issue.d||'').slice(0,10));
        if(startIndex>=0)volume=startIndex+1;
      }
      if(volume!=null)volumeByIssueId.set(Number(issue.id),volume);
    }
    const descriptor={seriesId,title:series.original,key,issues:seriesIssues,volumeByIssueId,volumeCount:starts.length};
    descriptors.push(descriptor);
    if(!byCanonical.has(key))byCanonical.set(key,[]);
    byCanonical.get(key).push(descriptor);
  }
  return{seriesById,descriptors,byCanonical};
}

function descriptorCandidates(reference,index){
  const key=canonicalSeries(reference.series);
  const exact=index.byCanonical.get(key)||[];
  if(exact.length)return exact.map(descriptor=>({descriptor,seriesScore:100,method:'exact'}));
  const alias=SERIES_ALIASES.get(normalizeSeries(reference.series));
  if(alias){
    const aliased=index.byCanonical.get(canonicalSeries(alias))||[];
    if(aliased.length)return aliased.map(descriptor=>({descriptor,seriesScore:98,method:'alias'}));
  }
  const fuzzy=index.descriptors.map(descriptor=>({descriptor,similarity:similarity(reference.series,descriptor.title)})).filter(candidate=>candidate.similarity>=0.86).sort((a,b)=>b.similarity-a.similarity||a.descriptor.title.localeCompare(b.descriptor.title));
  if(!fuzzy.length||fuzzy.length>1&&fuzzy[0].similarity-fuzzy[1].similarity<0.08)return[];
  return fuzzy.filter(candidate=>candidate.similarity===fuzzy[0].similarity).map(candidate=>({descriptor:candidate.descriptor,seriesScore:80*candidate.similarity,method:'fuzzy'}));
}

export function matchReference(reference,index,eventYear){
  const wantedNumber=normalizeNumber(reference.number);
  const wantedYear=Math.max(Number(eventYear)||0,Number(reference.publicationYear)||0);
  const candidates=[];
  for(const seriesCandidate of descriptorCandidates(reference,index)){
    for(const issue of seriesCandidate.descriptor.issues){
      const issueNumbers=new Set([normalizeNumber(issue.n),...String(issue.n||'').matchAll(/\(([-\w.]+)\)/g)].map((value,index)=>index?normalizeNumber(value[1]):value));
      const oneShotFallback=wantedNumber==='1'&&seriesCandidate.descriptor.issues.length===1&&issueNumbers.has('nn');
      if(!issueNumbers.has(wantedNumber)&&!oneShotFallback)continue;
      if(issue.c==='reimpresion')continue;
      const issueYear=yearOf(issue);
      const yearDistance=Math.min(Math.abs(issueYear-wantedYear),Math.abs((Number(issue.a)||issueYear)-wantedYear));
      if(Number.isInteger(reference.maxYearDistance)&&yearDistance>reference.maxYearDistance)continue;
      const rawExact=decodeHtml(String(issue.n)).trim().toLowerCase()===decodeHtml(String(reference.number)).trim().toLowerCase();
      let score=seriesCandidate.seriesScore+24-Math.min(yearDistance,50)*10+(rawExact?8:0);
      if(oneShotFallback)score+=6;
      if(reference.volume&&seriesCandidate.descriptor.volumeCount>=reference.volume){
        score+=seriesCandidate.descriptor.volumeByIssueId.get(Number(issue.id))===reference.volume?2:-2;
      }
      if(reference.preferLimited)score+=/limitada|miniserie/i.test(String(issue.f||''))?6:0;
      if(REPRINT_NUMBER.test(String(issue.n)))score-=18;
      if(/reprint|facsimile|variant|second printing|third printing/i.test(`${issue.t||''} ${issue.f||''}`))score-=18;
      candidates.push({issue,score,yearDistance,method:seriesCandidate.method,seriesTitle:seriesCandidate.descriptor.title});
    }
  }
  candidates.sort((a,b)=>b.score-a.score||a.yearDistance-b.yearDistance||Number(a.issue.id)-Number(b.issue.id));
  const best=candidates[0];
  if(!best)return{issue:null,reason:'No existe una coincidencia conservadora por serie, número y año en la biblioteca.',candidates:[]};
  const runnerUp=candidates[1];
  if(runnerUp&&best.score-runnerUp.score<3&&Number(best.issue.id)!==Number(runnerUp.issue.id)){
    return{issue:null,reason:'La biblioteca contiene más de una coincidencia plausible; no se ha elegido una automáticamente.',candidates:candidates.slice(0,5).map(candidate=>Number(candidate.issue.id))};
  }
  return{issue:best.issue,method:best.method,score:best.score,candidates:candidates.slice(0,5).map(candidate=>Number(candidate.issue.id))};
}

function eventTitleKeys(event){
  const values=[event.title,String(event.title).replace(/\s+(?:saga|event)$/i,''),String(event.title).replace(/^x-men:\s*/i,''),String(event.title).replace(/^avengers:\s*/i,'')];
  return new Set(values.map(canonicalSeries).filter(Boolean));
}

function sectionFor(position,total,centralPositions,baseSection){
  if(!centralPositions.length)return total>60?`${baseSection} · Parte ${Math.floor((position-1)/50)+1}`:baseSection;
  const first=centralPositions[0],last=centralPositions.at(-1);
  const section=position<first?'Preludio':position>last?'Epílogo':'Evento';
  const inPhase=position<(first)?position:position<=last?position-first+1:position-last;
  return section==='Evento'&&last-first>70?`${section} · Parte ${Math.floor((inPhase-1)/50)+1}`:section;
}

export function buildGeneratedSaga(event,references,index,{timelineUrl,sourceUrl,sourceUrls=[],centralSeriesNames=[],strictEventYear=false}={}){
  const titleKeys=eventTitleKeys(event);
  const countsBySeries=new Map();
  for(const reference of references){
    const key=canonicalSeries(reference.series);
    countsBySeries.set(key,(countsBySeries.get(key)||0)+1);
  }
  const explicitCentralKeys=new Set(centralSeriesNames.map(canonicalSeries));
  const centralKeys=new Set([...countsBySeries].filter(([key,count])=>(count>=2&&titleKeys.has(key))||explicitCentralKeys.has(key)).map(([key])=>key));
  const hasCentral=centralKeys.size>0;
  const centralPositions=references.filter(reference=>centralKeys.has(canonicalSeries(reference.series))).map(reference=>reference.sourceOrder);
  const entries=[];
  const unresolvedReferences=[];
  const seenIssueIds=new Set();
  for(const reference of references){
    const central=hasCentral?centralKeys.has(canonicalSeries(reference.series)):true;
    const importance=central?'principal':'complete';
    const match=matchReference({...reference,preferLimited:central,...(strictEventYear?{maxYearDistance:0}:{})},index,event.year);
    if(!match.issue){
      unresolvedReferences.push({
        referenceId:`${canonicalSeries(reference.series)}#${normalizeNumber(reference.number)}@${reference.sourceOrder}`,
        series:reference.series,
        number:String(reference.number),
        publicationYear:Number(reference.publicationYear)||Number(event.year),
        targetOrder:reference.sourceOrder,
        reason:match.reason,
        importance,
        ...(match.candidates?.length?{candidateIssueIds:match.candidates}:{}),
        sourceText:reference.sourceText
      });
      continue;
    }
    const issueId=Number(match.issue.id);
    if(seenIssueIds.has(issueId)){
      unresolvedReferences.push({referenceId:`${canonicalSeries(reference.series)}#${normalizeNumber(reference.number)}@${reference.sourceOrder}`,series:reference.series,number:String(reference.number),publicationYear:Number(reference.publicationYear)||Number(event.year),targetOrder:reference.sourceOrder,reason:`La referencia coincide con el issueId ${issueId}, ya utilizado antes en este mismo orden; se conserva como duplicado de fuente sin duplicar el cómic.`,importance,candidateIssueIds:[issueId],sourceText:reference.sourceText});
      continue;
    }
    seenIssueIds.add(issueId);
    entries.push({issueId,order:entries.length+1,section:sectionFor(reference.sourceOrder,references.length,centralPositions,'Orden principal'),type:central?'main':'tie-in',importance});
  }
  const ranks={principal:0,essential:1,complete:2};
  const expectedCounts=Object.fromEntries(Object.keys(ranks).map(mode=>[mode,entries.filter(entry=>ranks[entry.importance]<=ranks[mode]).length]));
  const targetCounts=Object.fromEntries(Object.keys(ranks).map(mode=>[mode,expectedCounts[mode]+unresolvedReferences.filter(reference=>ranks[reference.importance]<=ranks[mode]).length]));
  const sourceName=url=>url?.includes('comicbookreadingorders.com')?'Comic Book Reading Orders':url?.includes('marvel.com')?'Marvel (guía oficial)':url?.includes('comicbookherald.com')?'Comic Book Herald':url?.includes('howtolovecomics.com')?'How To Love Comics':'Fuente documentada';
  const orderSources=[sourceUrl,...sourceUrls].filter(Boolean);
  const sources=[
    ...(timelineUrl?[{name:'Comic Book Reading Orders — Marvel Event Timeline',url:timelineUrl,role:'Cronología e inclusión del evento.'}]:[]),
    ...orderSources.map(url=>({name:sourceName(url),url,role:url.includes('marvel.com')?'Alcance editorial oficial del evento.':'Secuencia y contraste del orden de lectura.'}))
  ].filter((source,index,list)=>list.findIndex(item=>item.url===source.url)===index);
  return{
    schemaVersion:3,
    id:event.id,
    title:event.title,
    year:Number(event.year),
    description:`Orden documentado de ${event.title}: ${references.length} referencias de fuente, ${entries.length} enlazadas con la biblioteca local.`,
    defaultMode:'principal',
    modes:{
      principal:hasCentral?'Miniserie o serie central identificada de forma inequívoca.':'El evento no tiene una miniserie central inequívoca: se conserva como principal todo el orden narrativo documentado.',
      essential:hasCentral?'No se inventa una selección intermedia: hasta revisión editorial, coincide con Principal.':'Coincide con Principal porque el propio evento se articula a través de este orden cruzado.',
      complete:'Todas las referencias incluidas por la fuente; las ausencias de biblioteca se documentan sin crear issueId.'
    },
    editorialPolicy:{kind:'bulk-source-order',centralSeries:[...centralKeys],essentialPolicy:'no-auto-curation',sectionsPolicy:'Fases estructurales respecto a la serie central y partes de 50 números para listas extensas.'},
    sources,
    expectedCounts,
    targetCounts,
    entries,
    unresolvedReferences
  };
}

export async function loadLibrary(root){
  const dataRoot=path.join(root,'public','data');
  const files=(await fs.readdir(dataRoot)).filter(file=>/^principal-\d+\.json$/.test(file)).sort();
  const [seriesRows,...chunks]=await Promise.all([fs.readFile(path.join(dataRoot,'series.json'),'utf8').then(JSON.parse),...files.map(file=>fs.readFile(path.join(dataRoot,file),'utf8').then(JSON.parse))]);
  const issues=chunks.flat();
  return{seriesRows,issues,index:buildLibraryIndex(seriesRows,issues)};
}
