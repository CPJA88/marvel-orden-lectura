/* Marvel Lector v1.2.11 — detalles del catálogo oficial en diagnóstico */
(() => {
  if(typeof diagnosticReport!=='function')return;
  const CATALOG_SCHEMA_KEY='catalogDiagnosticOfficialSeriesSchema';
  const CATALOG_SCHEMA_VERSION=1;

  const previousDiagnosticReport=diagnosticReport;
  diagnosticReport=function(d){
    const base=previousDiagnosticReport(d)
      .replace('Versión: v1.2.10-trace-diagnostic','Versión: v1.2.11-catalog-diagnostic');
    if(!d)return base;
    const rows=[];
    for(const arr of Object.values(d.samples||{})){
      for(const s of arr||[]){
        const f=s?.trace?.final;
        if(!f)continue;
        if(f.catalogReason||f.seriesUrl||f.seriesLabel||f.resolverSource==='share-series-catalog')rows.push({s,f});
      }
    }
    if(!rows.length)return base;
    const lines=['','CATÁLOGO OFICIAL MARVEL — RESOLUCIÓN POR SERIE'];
    for(const {s,f} of rows){
      lines.push('',`=== orden=${s.order??'?'} | ${s.title||'Serie'} #${s.issue||'[s/n]'} ===`);
      lines.push(`resolverSource=${f.resolverSource||''} | catalogReason=${f.catalogReason||''}`);
      if(f.seriesLabel)lines.push(`seriesLabel=${f.seriesLabel}`);
      if(f.seriesUrl)lines.push(`seriesUrl=${f.seriesUrl}`);
      if(f.issueUrl)lines.push(`issueUrl=${f.issueUrl}`);
    }
    return base+lines.join('\n');
  };

  // No mezclar los siete falsos LOOKUP_UNRESOLVED de la etapa Google/429 con
  // resultados del nuevo resolver basado en el catálogo oficial de series.
  const previousOpenDiagnostic=openDiagnostic;
  openDiagnostic=async function(){
    const schema=await DB.kvGet(CATALOG_SCHEMA_KEY);
    if(schema!==CATALOG_SCHEMA_VERSION){
      await DB.kvSet(DIAGNOSTIC_KEY,null);
      await DB.kvSet(CATALOG_SCHEMA_KEY,CATALOG_SCHEMA_VERSION);
      diagnosticState=null;
    }
    await previousOpenDiagnostic();
    const area=$('#diagnosticReport');if(area)area.value=diagnosticReport(diagnosticState);
  };
})();
