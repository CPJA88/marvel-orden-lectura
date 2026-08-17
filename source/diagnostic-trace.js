/* Marvel Lector v1.2.10 — trazas técnicas compartibles */
(() => {
  const TRACE_SCHEMA_VERSION=1;
  const TRACE_SCHEMA_KEY='catalogDiagnosticTraceSchema';
  const CURRENT_RESOLVER_VERSION=7;

  function addKnownParams(base,cached){
    if(!cached?.smartLink||!cached?.issueUrl)return;
    base.searchParams.set('knownIssueUrl',cached.issueUrl);
    base.searchParams.set('knownSmartLink',cached.smartLink);
    if(cached.sourceId)base.searchParams.set('knownSourceId',cached.sourceId);
    if(cached.readerId)base.searchParams.set('knownReaderId',cached.readerId);
    if(cached.drn)base.searchParams.set('knownDrn',cached.drn);
    if(cached.webUrl)base.searchParams.set('knownWebUrl',cached.webUrl);
    if(cached.pageTitle)base.searchParams.set('knownPageTitle',cached.pageTitle);
  }

  // El diagnóstico debe reconocer la caché positiva actual aunque diagnostics.js
  // sea una capa antigua. Los negativos nunca se pasan como verdad conocida.
  diagnosticUrl=function(x,s){
    const base=new URL(marvelQuery(x,s,'diagnostic'),location.origin);
    const cached=state.marvel.get(Number(x.id));
    if(cached?.available&&cached?.smartLink&&cached?.issueUrl)addKnownParams(base,cached);
    return{url:base.pathname+base.search,cacheSource:cached?.available&&cached?.smartLink?'PWA-positive-cache':''};
  };

  function traceUrl(x,s){
    const base=new URL('/api/marvel/trace',location.origin);
    base.searchParams.set('title',String(s.original||s.es||seriesName(x.s)||''));
    base.searchParams.set('issue',String(x.n||''));
    base.searchParams.set('year',String(x.a||''));
    base.searchParams.set('date',String(x.sv||x.d||''));
    base.searchParams.set('gcdId',String(x.id||''));
    addKnownParams(base,state.marvel.get(Number(x.id)));
    return base.pathname+base.search;
  }

  async function fetchTrace(x,s){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),90000);
    const started=Date.now();
    try{
      const r=await fetch(traceUrl(x,s),{cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});
      if(!r.ok)throw new Error(`TRACE HTTP ${r.status}`);
      const data=await r.json();
      data.clientMs=Date.now()-started;
      return data;
    }catch(e){
      return{traceVersion:TRACE_SCHEMA_VERSION,failureStage:'TRACE_REQUEST_FAILED',clientMs:Date.now()-started,error:String(e?.name==='AbortError'?'timeout-90s':e?.message||e),attempts:[]};
    }finally{clearTimeout(timer)}
  }

  const previousDiagnoseOne=diagnoseOne;
  diagnoseOne=async function(row){
    const result=await previousDiagnoseOne(row);
    if(!result||result.code==='OK'||result.code==='LOCAL_MISSING')return result;
    const x=await findIssueById(row[1]);
    if(!x)return result;
    const s=state.seriesMap.get(x.s)||{};
    result.sample=result.sample||{};
    result.sample.trace=await fetchTrace(x,s);
    return result;
  };

  function shortUrl(value,max=180){
    const s=String(value||'');
    return s.length>max?s.slice(0,max)+'…':s;
  }
  function attemptLine(a){
    const bits=[a.name||'paso',`HTTP=${a.status??0}`,`ms=${a.ms??0}`];
    if(a.error)bits.push(`error=${a.error}`);
    if(a.signals?.length)bits.push(`signals=${a.signals.join(',')}`);
    if(a.location)bits.push(`location=${shortUrl(a.location)}`);
    if(a.finalUrl&&a.finalUrl!==a.url)bits.push(`final=${shortUrl(a.finalUrl)}`);
    if(a.candidates?.length)bits.push(`candidates=${a.candidates.map(x=>shortUrl(x,110)).join(' ; ')}`);
    return '  - '+bits.join(' | ');
  }
  function appendProbe(lines,label,p){
    if(!p)return;
    lines.push(`${label}: HTTP=${p.status??0} | ms=${p.ms??0}${p.error?` | error=${p.error}`:''}`);
    if(p.pageTitle)lines.push(`  title=${p.pageTitle}`);
    if(p.readerIds?.length)lines.push(`  readerIds=${p.readerIds.join(',')}`);
    if(p.drns?.length)lines.push(`  drns=${p.drns.join(',')}`);
    if(p.coverFound!==undefined)lines.push(`  coverFound=${p.coverFound}${p.coverUrl?` | cover=${shortUrl(p.coverUrl)}`:''}`);
    if(p.signals?.length)lines.push(`  signals=${p.signals.join(',')}`);
  }

  const previousDiagnosticReport=diagnosticReport;
  diagnosticReport=function(d){
    let base=previousDiagnosticReport(d)
      .replace('Versión: v1.2.3-diagnostic','Versión: v1.2.10-trace-diagnostic')
      .replace('El resolver consulta primero el catálogo del propio Marvel y valida título + año de serie + número. Google queda solo como respaldo.','El informe incluye trazas HTTP del resolver real: Google, Marvel, Bing, ficha, readerId, DRN y Smart Link.');
    if(!d)return base;
    const traced=[];
    for(const arr of Object.values(d.samples||{}))for(const s of arr||[])if(s?.trace)traced.push(s);
    if(!traced.length)return base+'\n\nTRAZA TÉCNICA\nTodavía no hay casos problemáticos trazados en este diagnóstico.';

    const lines=['','TRAZA TÉCNICA — PEGAR ESTA SECCIÓN EN CHATGPT',`Esquema: ${TRACE_SCHEMA_VERSION} | Resolver esperado: ${CURRENT_RESOLVER_VERSION}`,'Cada caso muestra exactamente en qué fase se perdió la identificación.'];
    for(const s of traced){
      const t=s.trace||{};
      lines.push('',`=== orden=${s.order??'?'} | gcd=${s.gcdId??'?'} | ${s.title||'Serie'} #${s.issue||'[s/n]'} | año=${s.year||'?'} ===`);
      lines.push(`failureStage=${t.failureStage||'UNKNOWN'} | traceMs=${t.clientMs??t.finalMs??0} | finalResolverMs=${t.finalMs??0}`);
      if(t.error)lines.push(`traceError=${t.error}`);
      const f=t.final||{};
      lines.push(`finalCode=${f.diagnosticCode||s.code||''} | reason=${f.reason||s.reason||''} | resolverVersion=${f.resolverVersion??0} | resolverSource=${f.resolverSource||''}`);
      lines.push(`issueUrl=${f.issueUrl||''}`);
      lines.push(`sourceId=${f.sourceId||''} | readerId=${f.readerId||''} | drn=${f.drn||''}`);
      lines.push(`smartLink=${f.smartLink||''}`);
      lines.push(`coverUrl=${f.coverUrl||''}`);
      if(f.pageTitle)lines.push(`pageTitle=${f.pageTitle}`);
      if(f.error)lines.push(`resolverError=${f.error}`);
      lines.push('SEARCH ATTEMPTS:');
      if(t.attempts?.length)for(const a of t.attempts)lines.push(attemptLine(a));else lines.push('  - sin intentos adicionales');
      appendProbe(lines,'ISSUE PROBE',t.issueProbe);
      appendProbe(lines,'DRN PROBE',t.drnProbe);
      if(t.smartProbe)lines.push(`SMARTLINK PROBE: HTTP=${t.smartProbe.status??0} | ms=${t.smartProbe.ms??0} | location=${shortUrl(t.smartProbe.location||'')}${t.smartProbe.error?` | error=${t.smartProbe.error}`:''}`);
    }
    return base+lines.join('\n');
  };

  // La primera vez que se instala este esquema se descarta el diagnóstico viejo,
  // porque sus muestras no contienen trazas y no sirven para localizar este fallo.
  const previousOpenDiagnostic=openDiagnostic;
  openDiagnostic=async function(){
    const schema=await DB.kvGet(TRACE_SCHEMA_KEY);
    if(schema!==TRACE_SCHEMA_VERSION){
      await DB.kvSet(DIAGNOSTIC_KEY,null);
      await DB.kvSet(TRACE_SCHEMA_KEY,TRACE_SCHEMA_VERSION);
      diagnosticState=null;
    }
    await previousOpenDiagnostic();
    const intro=$('#diagnosticDialog .diagnostic-intro');
    if(intro)intro.textContent='Comprueba el catálogo y, cuando un número falle, registra la traza HTTP completa del resolver. Para localizar este problema basta ejecutar unos 25–30 números, pausar y copiar el informe.';
    const area=$('#diagnosticReport');if(area)area.value=diagnosticReport(diagnosticState);
  };
})();
