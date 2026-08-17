/* Marvel Lector v1.2.18 — compatibilidad diagnóstico V8 */
(() => {
  const DIAG_RESOLVER_VERSION=8;

  if(typeof DIAGNOSTIC_LABELS==='object'){
    DIAGNOSTIC_LABELS.COVER_MISSING='GCD no tiene portada para este número';
    DIAGNOSTIC_LABELS.COVER_LOOKUP_ERROR='No se pudo consultar la portada en GCD';
  }

  diagnosticUrl=function(x,s){
    const base=new URL(marvelQuery(x,s,'diagnostic'),location.origin),cached=state.marvel.get(Number(x.id));
    base.searchParams.set('gcdId',String(x.id||''));
    if(cached?.available&&cached?.smartLink&&cached?.issueUrl){
      base.searchParams.set('knownIssueUrl',cached.issueUrl);
      base.searchParams.set('knownSmartLink',cached.smartLink);
      if(cached.sourceId)base.searchParams.set('knownSourceId',cached.sourceId);
      if(cached.readerId)base.searchParams.set('knownReaderId',cached.readerId);
      if(cached.drn)base.searchParams.set('knownDrn',cached.drn);
      if(cached.webUrl)base.searchParams.set('knownWebUrl',cached.webUrl);
      if(cached.pageTitle)base.searchParams.set('knownPageTitle',cached.pageTitle);
      if(cached.coverUrl)base.searchParams.set('knownCoverUrl',cached.coverUrl);
    }
    return{url:base.pathname+base.search,cacheSource:cached?.available&&cached?.smartLink?'PWA-positive-cache':''};
  };

  diagnoseOne=async function(row){
    const x=await findIssueById(row[1]);
    if(!x)return{code:'LOCAL_MISSING',sample:{order:row[0],gcdId:row[1],title:seriesName(row[3]),issue:row[4]||'',year:'',reason:'search.json referencia un ID que no existe en su chunk'}};
    const s=state.seriesMap.get(x.s)||{},target=diagnosticUrl(x,s);
    try{
      const r=await fetch(target.url,{cache:'no-store',headers:{Accept:'application/json'}});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const data=await r.json(),code=data.diagnosticCode||'RESOLVER_ERROR';
      if(Number(data.resolverVersion)===DIAG_RESOLVER_VERSION||target.cacheSource){
        const old=state.marvel.get(Number(x.id))||{};
        const m={...old,id:Number(x.id),checkedAt:new Date().toISOString(),...data};
        if(data.gcdCoverUrl)m.coverUrl=data.gcdCoverUrl;
        if(data.gcdCoverStatus!==undefined)m.gcdCoverCheckedAt=new Date().toISOString();
        delete m.appCheck;delete m.webCheck;delete m.diagnosticCode;delete m.match;
        state.marvel.set(Number(x.id),m);await DB.put('marvel',m);updateRenderedMeta(x.id,m);
      }
      const sample=sampleFromResult(x,s,data,code,target.cacheSource);
      sample.gcdCoverStatus=data.gcdCoverStatus??0;
      sample.gcdCoverUrl=data.gcdCoverUrl||'';
      sample.gcdCoverError=data.gcdCoverError||'';
      sample.crawlReason=data.crawlReason||'';
      sample.crawlSteps=data.crawlSteps??0;
      sample.crawlKnown=data.crawlKnown??0;
      sample.crawlMin=data.crawlMin||'';
      sample.crawlMax=data.crawlMax||'';
      return{code,sample};
    }catch(e){
      return{code:'NETWORK_ERROR',sample:sampleFromResult(x,s,{error:String(e?.message||e)},'NETWORK_ERROR',target.cacheSource)};
    }
  };
})();
