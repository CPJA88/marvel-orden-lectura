/* Marvel Lector v1.2.21 — diagnóstico del índice MU anual */
(() => {
  const RESOLVER=12;
  const SCHEMA=12;
  const SCHEMA_KEY='catalogDiagnosticYearIndexSchema';

  function mergeDiagnosticMeta(id,data){
    const old=state.marvel.get(Number(id))||{};
    if(old.smartLink&&!data?.smartLink){
      return {...old,id:Number(id),lastDiagnosticAt:new Date().toISOString(),lastDiagnosticReason:data?.reason||data?.error||'',coverUrl:old.coverUrl||''};
    }
    const m={...old,...data,id:Number(id),checkedAt:new Date().toISOString(),uiCacheVersion:8};
    if(old.smartLink&&!m.smartLink){m.smartLink=old.smartLink;m.available=true;m.reason='ok'}
    if(/^\/api\/gcd\/cover-image\?id=/.test(String(old.coverUrl||''))&&!/^\/api\/gcd\/cover-image\?id=/.test(String(data?.coverUrl||'')))m.coverUrl=old.coverUrl;
    delete m.diagnosticCode;delete m.appCheck;delete m.webCheck;return m;
  }

  diagnosticUrl=function(x,s){
    const base=new URL(marvelQuery(x,s,'diagnostic'),location.origin),cached=state.marvel.get(Number(x.id));
    return{url:base.pathname+base.search,cacheSource:cached?.smartLink?'PWA-positive-cache':''};
  };

  diagnoseOne=async function(row){
    const x=await findIssueById(row[1]);
    if(!x)return{code:'LOCAL_MISSING',sample:{order:row[0],gcdId:row[1],title:seriesName(row[3]),issue:row[4]||'',year:'',reason:'ID no encontrado en los chunks locales'}};
    const s=state.seriesMap.get(x.s)||{},target=diagnosticUrl(x,s);
    try{
      const r=await fetch(target.url,{cache:'no-store',headers:{Accept:'application/json'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const data=await r.json(),code=data.diagnosticCode||'LOOKUP_UNRESOLVED';
      if(Number(data.resolverVersion)===RESOLVER){
        const m=mergeDiagnosticMeta(x.id,data);state.marvel.set(Number(x.id),m);await DB.put('marvel',m);updateRenderedMeta(x.id,m);
      }
      const sample=sampleFromResult(x,s,data,code,target.cacheSource);
      sample.geoffrichAttempts=data.geoffrichAttempts||[];sample.drn=data.drn||'';sample.smartLink=data.smartLink||'';sample.error=data.error||data.drnError||'';
      return{code,sample};
    }catch(e){return{code:'NETWORK_ERROR',sample:sampleFromResult(x,s,{error:String(e?.message||e)},'NETWORK_ERROR',target.cacheSource)}}
  };

  const baseReport=diagnosticReport;
  diagnosticReport=function(d){
    let text=baseReport(d)
      .replace(/Versión: v[^\n]+/,'Versión: v1.2.21-year-index-diagnostic')
      .replace(/El resolver consulta primero[^\n]+/,'El resolver usa un índice histórico de Marvel Unlimited agrupado por año para obtener sourceId + readerId; después pide a share.marvel.com el DRN y construye el Smart Link probado. Las portadas se sirven por proxy GCD independiente.');
    if(!d)return text;
    const rows=[];for(const arr of Object.values(d.samples||{}))for(const s of arr||[])if(s?.geoffrichAttempts?.length||s?.readerId||s?.drn||s?.smartLink)rows.push(s);
    if(!rows.length)return text;
    const lines=['','TRAZA V12 — ÍNDICE MU ANUAL'];
    for(const s of rows){
      lines.push('',`=== orden=${s.order??'?'} | gcd=${s.gcdId??'?'} | ${s.title||'Serie'} #${s.issue||'[s/n]'} ===`);
      lines.push(`resolver=${s.resolverSource||''} | reason=${s.reason||''}`);
      if(s.geoffrichAttempts?.length)lines.push('años='+s.geoffrichAttempts.map(a=>`${a.year}:${a.matched?'MATCH':'no'}(${a.count??0})${a.error?`[${a.error}]`:''}`).join(' ; '));
      lines.push(`sourceId=${s.sourceId||''} | readerId=${s.readerId||''} | drn=${s.drn||''}`);
      lines.push(`smartLink=${s.smartLink||''}`);
      if(s.issueUrl)lines.push(`issueUrl=${s.issueUrl}`);
      if(s.error)lines.push(`error=${s.error}`);
    }
    return text+lines.join('\n');
  };

  const baseOpen=openDiagnostic;
  openDiagnostic=async function(){
    const schema=await DB.kvGet(SCHEMA_KEY);
    if(schema!==SCHEMA){await DB.kvSet(DIAGNOSTIC_KEY,null);await DB.kvSet(SCHEMA_KEY,SCHEMA);diagnosticState=null}
    await baseOpen();
    const intro=$('#diagnosticDialog .diagnostic-intro');if(intro)intro.textContent='Diagnóstico V12: comprueba la coincidencia título+número en el índice MU anual y, si existe readerId, la conversión actual readerId → DRN → Smart Link. No usa Google, Bing ni búsquedas en marvel.com.';
    const area=$('#diagnosticReport');if(area)area.value=diagnosticReport(diagnosticState);
  };
})();
