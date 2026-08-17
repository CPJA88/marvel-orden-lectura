/* Marvel Lector v1.2.19 — diagnóstico final Marvel API v9 */
(() => {
  const DIAG_RESOLVER_VERSION=9;
  const DIAG_SCHEMA_VERSION=9;
  const DIAG_SCHEMA_KEY='catalogDiagnosticMarvelApiSchema';

  if(typeof DIAGNOSTIC_LABELS==='object'){
    DIAGNOSTIC_LABELS.MARVEL_API_NOT_CONFIGURED='Faltan los secretos de Marvel API en Cloudflare';
    DIAGNOSTIC_LABELS.MARVEL_API_AUTH_ERROR='Marvel API rechazó las credenciales';
    DIAGNOSTIC_LABELS.READER_ID_MISSING='Ficha Marvel localizada sin lector digital';
    DIAGNOSTIC_LABELS.COVER_MISSING='GCD no tiene portada para este número';
    DIAGNOSTIC_LABELS.COVER_LOOKUP_ERROR='No se pudo consultar la portada en GCD';
  }

  function addKnown(base,cached){
    if(!cached?.smartLink||!cached?.issueUrl)return;
    base.searchParams.set('knownIssueUrl',cached.issueUrl);
    base.searchParams.set('knownSmartLink',cached.smartLink);
    if(cached.sourceId)base.searchParams.set('knownSourceId',cached.sourceId);
    if(cached.readerId)base.searchParams.set('knownReaderId',cached.readerId);
    if(cached.drn)base.searchParams.set('knownDrn',cached.drn);
    if(cached.webUrl)base.searchParams.set('knownWebUrl',cached.webUrl);
    if(cached.pageTitle)base.searchParams.set('knownPageTitle',cached.pageTitle);
  }

  diagnosticUrl=function(x,s){
    const base=new URL(marvelQuery(x,s,'diagnostic'),location.origin),cached=state.marvel.get(Number(x.id));
    base.searchParams.set('gcdId',String(x.id||''));
    addKnown(base,cached);
    return{url:base.pathname+base.search,cacheSource:cached?.available&&cached?.smartLink?'PWA-positive-cache':''};
  };

  function traceUrl(x,s){
    const base=new URL('/api/marvel/trace',location.origin);
    base.searchParams.set('title',String(s.original||s.es||seriesName(x.s)||''));
    base.searchParams.set('issue',String(x.n||''));
    base.searchParams.set('year',String(x.a||''));
    base.searchParams.set('gcdId',String(x.id||''));
    addKnown(base,state.marvel.get(Number(x.id)));
    return base.pathname+base.search;
  }

  async function fetchTraceV9(x,s){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000),started=Date.now();
    try{
      const r=await fetch(traceUrl(x,s),{cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});
      if(!r.ok)throw new Error(`TRACE HTTP ${r.status}`);
      const data=await r.json();data.clientMs=Date.now()-started;return data;
    }catch(e){
      return{traceVersion:DIAG_SCHEMA_VERSION,failureStage:'TRACE_REQUEST_FAILED',clientMs:Date.now()-started,error:String(e?.name==='AbortError'?'timeout-45s':e?.message||e),attempts:[]};
    }finally{clearTimeout(timer)}
  }

  async function fetchGcdCover(id){
    try{
      const r=await fetch(`/api/gcd/cover?id=${encodeURIComponent(id)}`,{cache:'no-store',headers:{Accept:'application/json'}}),data=await r.json().catch(()=>({}));
      return{status:r.status,coverUrl:data.coverUrl||'',error:data.error||(!r.ok?`GCD HTTP ${r.status}`:'')};
    }catch(e){return{status:0,coverUrl:'',error:String(e?.message||e)}}
  }

  diagnoseOne=async function(row){
    const x=await findIssueById(row[1]);
    if(!x)return{code:'LOCAL_MISSING',sample:{order:row[0],gcdId:row[1],title:seriesName(row[3]),issue:row[4]||'',year:'',reason:'search.json referencia un ID que no existe en su chunk'}};
    const s=state.seriesMap.get(x.s)||{},target=diagnosticUrl(x,s);
    try{
      const [r,cover]=await Promise.all([
        fetch(target.url,{cache:'no-store',headers:{Accept:'application/json'}}),
        fetchGcdCover(x.id)
      ]);
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const data=await r.json();
      let code=data.diagnosticCode||'RESOLVER_ERROR';
      if(code==='OK'&&!cover.coverUrl)code=cover.error?'COVER_LOOKUP_ERROR':'COVER_MISSING';

      if(Number(data.resolverVersion)===DIAG_RESOLVER_VERSION||target.cacheSource){
        const old=state.marvel.get(Number(x.id))||{};
        const m={...old,id:Number(x.id),checkedAt:new Date().toISOString(),...data,uiCacheVersion:7};
        if(cover.coverUrl){m.coverUrl=cover.coverUrl;m.coverSource='gcd-api'}
        if(cover.status!==undefined)m.gcdCoverCheckedAt=new Date().toISOString();
        delete m.appCheck;delete m.webCheck;delete m.diagnosticCode;delete m.match;
        state.marvel.set(Number(x.id),m);await DB.put('marvel',m);updateRenderedMeta(x.id,m);
      }

      const sample=sampleFromResult(x,s,data,code,target.cacheSource);
      sample.gcdCoverStatus=cover.status;
      sample.gcdCoverUrl=cover.coverUrl;
      sample.gcdCoverError=cover.error;
      sample.apiConfigured=Boolean(data.apiConfigured);
      sample.apiAttempts=data.apiAttempts||[];
      if(code!=='OK'&&code!=='LOCAL_MISSING')sample.trace=await fetchTraceV9(x,s);
      return{code,sample};
    }catch(e){
      const sample=sampleFromResult(x,s,{error:String(e?.message||e)},'NETWORK_ERROR',target.cacheSource);
      sample.trace=await fetchTraceV9(x,s);
      return{code:'NETWORK_ERROR',sample};
    }
  };

  const previousDiagnosticReport=diagnosticReport;
  diagnosticReport=function(d){
    let base=previousDiagnosticReport(d)
      .replace(/Versión: v[^\n]+/,'Versión: v1.2.19-marvel-api-diagnostic')
      .replace(/Esquema: \d+ \| Resolver esperado: \d+/g,'Esquema: 9 | Resolver esperado: 9')
      .replace(/IMPORTANTE\n[^\n]+/,'IMPORTANTE\nLas portadas se verifican por ID en GCD. Marvel Unlimited se identifica mediante la API oficial de Marvel; el HTML público de marvel.com ya no se usa para metadata.')
      .replace('El informe incluye trazas HTTP del resolver real: Google, Marvel, Bing, ficha, readerId, DRN y Smart Link.','El informe traza Marvel API, GCD, digitalId/readerId, DRN y Smart Link.');
    const oldMarker='\nRESOLUCIÓN POR VECINOS MARVEL + PORTADA GCD — V8';
    if(base.includes(oldMarker))base=base.split(oldMarker)[0];
    if(!d)return base;

    const rows=[];
    for(const arr of Object.values(d.samples||{}))for(const s of arr||[])if(s?.trace?.final)rows.push({s,f:s.trace.final});
    if(!rows.length)return base;
    const lines=['','MARVEL API + PORTADAS GCD — V9'];
    for(const {s,f} of rows){
      lines.push('',`=== orden=${s.order??'?'} | gcd=${s.gcdId??'?'} | ${s.title||'Serie'} #${s.issue||'[s/n]'} ===`);
      lines.push(`resolverSource=${f.resolverSource||''} | reason=${f.reason||''} | apiConfigured=${f.apiConfigured?'SI':'NO'}`);
      if(f.pageTitle)lines.push(`marvelTitle=${f.pageTitle}`);
      if(f.issueUrl)lines.push(`issueUrl=${f.issueUrl}`);
      lines.push(`sourceId=${f.sourceId||''} | digitalId/readerId=${f.digitalId||f.readerId||''} | drn=${f.drn||''}`);
      lines.push(`smartLink=${f.smartLink||''}`);
      lines.push(`gcdCoverHTTP=${f.gcdCoverStatus??s.gcdCoverStatus??0} | gcdCover=${f.gcdCoverUrl||s.gcdCoverUrl||''}${(f.gcdCoverError||s.gcdCoverError)?` | error=${f.gcdCoverError||s.gcdCoverError}`:''}`);
    }
    return base+lines.join('\n');
  };

  openDiagnostic=async function(){
    $('#settingsDialog').close();
    const idx=await ensureSearch(),schema=await DB.kvGet(DIAG_SCHEMA_KEY);
    let saved=await DB.kvGet(DIAGNOSTIC_KEY);
    if(schema!==DIAG_SCHEMA_VERSION||!saved||saved.version!==DIAGNOSTIC_VERSION||saved.total!==idx.length){
      diagnosticState=emptyDiagnostic(idx.length);
      await DB.kvSet(DIAGNOSTIC_KEY,diagnosticState);
      await DB.kvSet(DIAG_SCHEMA_KEY,DIAG_SCHEMA_VERSION);
    }else diagnosticState=saved;
    renderDiagnostic();
    const intro=$('#diagnosticDialog .diagnostic-intro');
    if(intro)intro.textContent='Diagnóstico V9: portada por GCD y disponibilidad/enlace por Marvel API oficial. Si las claves aún no están configuradas en Cloudflare, lo indicará como MARVEL_API_NOT_CONFIGURED sin confundirlo con un cómic ausente.';
    const area=$('#diagnosticReport');if(area)area.value=diagnosticReport(diagnosticState);
    $('#diagnosticDialog').showModal();
  };
})();
