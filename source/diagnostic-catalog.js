/* Marvel Lector v1.2.14 — diagnóstico catálogo + búsqueda oficial v4 */
(() => {
  if(typeof diagnosticReport!=='function')return;
  const CATALOG_SCHEMA_KEY='catalogDiagnosticOfficialSeriesSchema';
  const CATALOG_SCHEMA_VERSION=4;

  if(typeof DIAGNOSTIC_LABELS==='object'){
    DIAGNOSTIC_LABELS.READER_ID_MISSING='Ficha Marvel localizada sin readerId';
  }

  const previousDiagnosticReport=diagnosticReport;
  diagnosticReport=function(d){
    const base=previousDiagnosticReport(d)
      .replace('Versión: v1.2.10-trace-diagnostic','Versión: v1.2.14-marvel-search-diagnostic')
      .replace('Versión: v1.2.11-catalog-diagnostic','Versión: v1.2.14-marvel-search-diagnostic')
      .replace('Versión: v1.2.12-catalog-v2-diagnostic','Versión: v1.2.14-marvel-search-diagnostic')
      .replace('Versión: v1.2.13-catalog-v3-diagnostic','Versión: v1.2.14-marvel-search-diagnostic')
      .replace('Esquema: 1 | Resolver esperado: 7','Esquema: 4 | Resolver esperado: 7')
      .replace('Esquema: 2 | Resolver esperado: 7','Esquema: 4 | Resolver esperado: 7')
      .replace('Esquema: 3 | Resolver esperado: 7','Esquema: 4 | Resolver esperado: 7');
    if(!d)return base;
    const rows=[];
    for(const arr of Object.values(d.samples||{}))for(const s of arr||[]){const f=s?.trace?.final;if(f&&(f.catalogReason||f.searchReason||f.seriesUrl||f.seriesLabel))rows.push({s,f})}
    if(!rows.length)return base;
    const lines=['','RESOLUCIÓN OFICIAL MARVEL — CATÁLOGO + SEARCH V4'];
    for(const {s,f} of rows){
      lines.push('',`=== orden=${s.order??'?'} | ${s.title||'Serie'} #${s.issue||'[s/n]'} ===`);
      lines.push(`resolverSource=${f.resolverSource||''} | catalogReason=${f.catalogReason||''} | searchReason=${f.searchReason||''}`);
      lines.push(`catalogKnownIssues=${f.catalogKnownIssues??0} | searchCandidates=${f.searchCandidateCount??0} | searchExact=${f.searchExactCount??0}`);
      if(f.catalogKeys?.length)lines.push(`catalogKeys=${f.catalogKeys.join(',')}`);
      if(f.seriesLabel)lines.push(`seriesLabel=${f.seriesLabel}`);
      if(f.seriesUrl)lines.push(`seriesUrl=${f.seriesUrl}`);
      if(f.searchUrl)lines.push(`searchUrl=${f.searchUrl}`);
      if(f.issueUrl)lines.push(`issueUrl=${f.issueUrl}`);
    }
    return base+lines.join('\n');
  };

  const previousOpenDiagnostic=openDiagnostic;
  openDiagnostic=async function(){
    const schema=await DB.kvGet(CATALOG_SCHEMA_KEY);
    if(schema!==CATALOG_SCHEMA_VERSION){
      await DB.kvSet(DIAGNOSTIC_KEY,null);
      await DB.kvSet(CATALOG_SCHEMA_KEY,CATALOG_SCHEMA_VERSION);
      diagnosticState=null;
    }
    await previousOpenDiagnostic();
    const intro=$('#diagnosticDialog .diagnostic-intro');
    if(intro)intro.textContent='Diagnóstico V4: primero usa la ventana oficial de la serie y, si el número no aparece allí, la búsqueda exacta de Marvel con offset=0. No recorre decenas de fichas y no consulta Google desde Cloudflare.';
    const area=$('#diagnosticReport');if(area)area.value=diagnosticReport(diagnosticState);
  };
})();
