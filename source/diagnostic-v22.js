/* Marvel Lector v1.2.22 — diagnóstico resolver 13 */
(() => {
  const RESOLVER=13;
  function mergeDiagnostic(id,data){
    const old=state.marvel.get(Number(id))||{},now=new Date().toISOString();
    if(old.smartLink&&!data?.smartLink){
      const m={...old,id:Number(id),lastDiagnosticAt:now,lastDiagnosticReason:data?.reason||data?.error||'',uiCacheVersion:9};
      if(data?.sourceId&&!m.sourceId)m.sourceId=data.sourceId;
      if(data?.issueUrl&&!m.issueUrl)m.issueUrl=data.issueUrl;
      return m;
    }
    const m={...old,...data,id:Number(id),checkedAt:now,uiCacheVersion:9};
    delete m.diagnosticCode;delete m.appCheck;delete m.webCheck;return m;
  }
  diagnosticUrl=function(x,s){
    const base=new URL(marvelQuery(x,s,'diagnostic'),location.origin);
    return{url:base.pathname+base.search,cacheSource:state.marvel.get(Number(x.id))?.smartLink?'PWA-positive-cache':''};
  };
  diagnoseOne=async function(row){
    const x=await findIssueById(row[1]);
    if(!x)return{code:'LOCAL_MISSING',sample:{order:row[0],gcdId:row[1],title:seriesName(row[3]),issue:row[4]||'',year:'',reason:'ID local no encontrado'}};
    const s=state.seriesMap.get(x.s)||{},target=diagnosticUrl(x,s);
    try{
      const r=await fetch(target.url,{cache:'no-store',headers:{Accept:'application/json'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const data=await r.json(),code=data.diagnosticCode||'LOOKUP_UNRESOLVED';
      if(Number(data.resolverVersion)===RESOLVER){const m=mergeDiagnostic(x.id,data);state.marvel.set(Number(x.id),m);await DB.put('marvel',m);updateRenderedMeta(x.id,m)}
      const sample=sampleFromResult(x,s,data,code,target.cacheSource);sample.attempts=data.attempts||[];sample.drn=data.drn||'';sample.smartLink=data.smartLink||'';sample.error=data.error||data.drnError||'';return{code,sample};
    }catch(e){return{code:'NETWORK_ERROR',sample:sampleFromResult(x,s,{error:String(e?.message||e)},'NETWORK_ERROR',target.cacheSource)}}
  };
})();
