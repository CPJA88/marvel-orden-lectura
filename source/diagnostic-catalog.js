/* Marvel Lector v1.2.11 — detalles del catálogo oficial en diagnóstico */
(() => {
  if(typeof diagnosticReport!=='function')return;
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
})();
