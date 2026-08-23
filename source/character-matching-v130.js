/* Marvel Lector v1.3.0 — cruce de cronologías con la biblioteca GCD */
((root)=>{
  const TITLE_ALIASES=new Map([
    ['origin',['wolverine origin']],
    ['tangled web',['spider man s tangled web']],
    ['marvel saga',['marvel saga official history of marvel universe']],
    ['young allies comics',['young allies']],
    ['sgt fury and his howlin commandos',['sgt fury','sgt fury and his howling commandos']],
    ['power man and iron fist',['power man']],
    ['rom spaceknight',['rom']],
    ['iron man',['invincible iron man']],
    ['thor',['mighty thor']],
    ['peter parker spectacular spider man',['spectacular spider man']],
    ['spectacular spider man magazine',['spectacular spider man']]
  ]);

  function normalizeTitle(value=''){
    return String(value??'')
      .replace(/&hearts;|♥/gi,' heart ')
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLowerCase().replace(/&/g,' and ')
      .replace(/\bvol(?:ume)?\.?\s*\d+\b/g,' ')
      .replace(/\bthe\b/g,' ')
      .replace(/[^a-z0-9]+/g,' ')
      .replace(/\s+/g,' ').trim();
  }
  function normalizeNumber(value=''){
    let number=String(value??'').trim().split(/\s*\(/,1)[0].trim();
    number=number.replace(/#/g,'').replace(/½/g,'1/2').replace(/\s+/g,'').toUpperCase();
    return number.replace(/^0+(?=\d)/,'');
  }
  function numberAliases(issue){
    const raw=String(issue?.n??''),out=new Set([normalizeNumber(raw)]);
    for(const match of raw.matchAll(/\(([^)]+)\)/g)){
      const value=normalizeNumber(match[1]);if(value)out.add(value);
    }
    if(/^\[(?:nn|s\/n)\]$/i.test(raw.trim())){
      const year=String(issue?.d||'').slice(0,4);if(/^\d{4}$/.test(year))out.add(year);
    }
    return[...out].filter(Boolean);
  }
  function parseRanges(value=''){
    const ranges=[];
    for(const part of String(value||'').split(',')){
      const match=part.match(/((?:19|20)\d{2})(?:\s*-\s*((?:19|20)\d{2})?)?/);
      if(!match)continue;
      ranges.push([Number(match[1]),match[0].includes('-')?(match[2]?Number(match[2]):2100):Number(match[1])]);
    }
    return ranges;
  }
  function yearDistance(issue,ranges){
    if(!ranges.length)return 0;
    const years=[Number(String(issue?.d||'').slice(0,4)),Number(issue?.a)].filter(Number.isFinite).filter(Boolean);
    if(!years.length)return 999;
    return Math.min(...years.flatMap(year=>ranges.map(([from,to])=>year<from?from-year:year>to?year-to:0)));
  }
  function add(map,key,value){if(!key)return;const rows=map.get(key)||[];rows.push(value);map.set(key,rows)}
  function uniqueIssues(rows=[]){const found=new Map();for(const issue of rows)if(issue?.id&&!found.has(Number(issue.id)))found.set(Number(issue.id),issue);return[...found.values()]}

  function createIssueIndex(issues=[],seriesMap=new Map()){
    const exact=new Map(),byTitle=new Map(),byNumber=new Map(),titlesByIssue=new Map();
    for(const issue of issues){
      const series=seriesMap.get(Number(issue.s))||{};
      const titles=new Set([series.original,series.es].map(normalizeTitle).filter(Boolean));
      titlesByIssue.set(Number(issue.id),titles);
      const numbers=numberAliases(issue);
      for(const title of titles){
        add(byTitle,title,issue);
        for(const number of numbers)add(exact,`${title}\u0000${number}`,issue);
      }
      for(const number of numbers)add(byNumber,number,issue);
    }
    return{exact,byTitle,byNumber,titlesByIssue};
  }
  function tokenSet(value){return new Set(normalizeTitle(value).split(' ').filter(token=>token&&!['and','of','his','a','an'].includes(token)))}
  function similarity(a,b){
    const left=tokenSet(a),right=tokenSet(b);if(!left.size||!right.size)return{score:0,common:0};
    let common=0;for(const token of left)if(right.has(token))common++;
    return{score:2*common/(left.size+right.size),common};
  }
  function choose(rows,ranges){
    return uniqueIssues(rows).sort((a,b)=>yearDistance(a,ranges)-yearDistance(b,ranges)||Number(a.o)-Number(b.o))[0]||null;
  }
  function matchOne(ref,index){
    const title=normalizeTitle(ref?.title),number=normalizeNumber(ref?.number),ranges=parseRanges(ref?.dates);
    if(!title)return null;
    const titles=[title,...(TITLE_ALIASES.get(title)||[])];
    if(number){
      for(const candidateTitle of titles){const found=choose(index.exact.get(`${candidateTitle}\u0000${number}`)||[],ranges);if(found)return found}
    }else{
      for(const candidateTitle of titles){
        const rows=index.byTitle.get(candidateTitle)||[];
        const likely=rows.filter(issue=>{const values=numberAliases(issue);return values.includes('1')||/^\[(?:NN|S\/N)\]$/.test(String(issue.n||'').toUpperCase())});
        const found=choose(likely.length?likely:rows,ranges);if(found)return found;
      }
    }
    if(!number)return null;
    const refTokens=tokenSet(title);if(refTokens.size<2)return null;
    const candidates=uniqueIssues(index.byNumber.get(number)||[]).map(issue=>{
      let best={score:0,common:0};
      for(const candidateTitle of index.titlesByIssue.get(Number(issue.id))||[]){const next=similarity(title,candidateTitle);if(next.score>best.score)best=next}
      return{issue,...best,distance:yearDistance(issue,ranges)};
    }).filter(row=>row.common>=2&&row.score>=.54)
      .sort((a,b)=>b.score-a.score||a.distance-b.distance||Number(a.issue.o)-Number(b.issue.o));
    return candidates[0]?.issue||null;
  }
  function matchAppearances(refs=[],index){
    const issues=new Map();let matchedRefs=0;
    for(const ref of refs){const issue=matchOne(ref,index);if(!issue)continue;matchedRefs++;if(!issues.has(Number(issue.id)))issues.set(Number(issue.id),issue)}
    const ordered=[...issues.values()].sort((a,b)=>Number(a.o)-Number(b.o));
    return{issues:ordered,sourceRefs:refs.length,matchedRefs,unmatchedRefs:Math.max(refs.length-matchedRefs,0),duplicateRefs:Math.max(matchedRefs-ordered.length,0)};
  }

  root.MarvelCharacterMatching={normalizeTitle,normalizeNumber,parseRanges,createIssueIndex,matchAppearances};
})(globalThis);

