/* Marvel Lector v1.2.15 — diagnóstico de paginación oficial v5 */
(() => {
  if(typeof diagnosticReport!=='function')return;
  const CATALOG_SCHEMA_KEY='catalogDiagnosticOfficialSeriesSchema';
  const CATALOG_SCHEMA_VERSION=5;

  if(typeof DIAGNOSTIC_LABELS==='object'){
    DIAGNOSTIC_LABELS.READER_ID_MISSING='Ficha Marvel localizada sin readerId';
  }

  const previousDiagnosticReport=diagnosticReport;
  diagnosticReport=function(d){
    const base=previousDiagnosticReport(d)
      .replace('Versión: v1.2.10-trace-diagnostic','Versión: v1.2.15-series-pagination-diagnostic')
      .replace('Versión: v1.2.11-catalog-diagnostic','Versión: v1.2.15-series-pagination-diagnostic')
      .replace('Versión: v1.2.12-catalog-v2-diagnostic','Versión: v1.2.15-series-pagination-diagnostic')
      .replace('Versión: v1.2.13-catalog-v3-diagnostic','Versión: v1.2.15-series-pagination-diagnostic')
      .replace('Versión: v1.2.14-marvel-search-diagnostic','Versión: v1.2.15-series-pagination-diagnostic')
      .replace('Esquema: 1 | Resolver esperado: 7','Esquema: 5 | Resolver esperado: 7')
      .replace('Esquema: 2 | Resolver esperado: 7','Esquema: 5 | Resolver esperado: 7')
      .replace('Esquema: 3 | Resolver esperado: 7','Esquema: 5 | Resolver esperado: 7')
      .replace('Esquema: 4 | Resolver esperado: 7','Esquema: 5 | Resolver esperado: 7')
      .replace('El informe incluye trazas HTTP del resolver real: Google, Marvel, Bing, ficha, readerId, DRN y Smart Link.','El informe traza la paginación de la serie oficial de Marvel, la ficha localizada, readerId, DRN y Smart Link. No lanza búsquedas externas adicionales.');
    if(!d)return base;
    const rows=[];
    for(const arr of Object.values(d.samples||{}))for(const s of arr||[]){const f=s?.trace?.final;if(f&&(f.catalogReason||f.paginationReason||f.seriesUrl||f.seriesLabel))rows.push({s,f})}
    if(!rows.length)return base;
    const lines=['','PAGINACIÓN OFICIAL DE SERIES MARVEL — V5'];
    for(const {s,f} of rows){
      lines.push('',`=== orden=${s.order??'?'} | ${s.title||'Serie'} #${s.issue||'[s/n]'} ===`);
      lines.push(`resolverSource=${f.resolverSource||''} | catalogReason=${f.catalogReason||''} | paginationReason=${f.paginationReason||''}`);
      lines.push(`catalogKnownIssues=${f.catalogKnownIssues??0}`);
      if(f.catalogKeys?.length)lines.push(`catalogKeysIniciales=${f.catalogKeys.join(',')}`);
      if(f.seriesLabel)lines.push(`seriesLabel=${f.seriesLabel}`);
      if(f.seriesUrl)lines.push(`seriesUrl=${f.seriesUrl}`);
      for(const p of f.paginationAttempts||[]){
        lines.push(`page=${p.name||''} | offset=${p.offset??0} | limit=${p.limit??0} | order=${p.orderBy||''} | HTTP=${p.status??0} | target=${p.targetFound?'SI':'NO'} | keys=${(p.keys||[]).join(',')}${p.error?` | error=${p.error}`:''}`);
      }
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
    if(intro)intro.textContent='Diagnóstico V5: si el número no está entre los 20 visibles de su serie, calcula la página/offset donde debería encontrarse y registra exactamente qué números devuelve Marvel. No usa Google ni Marvel Search para diagnosticar.';
    const area=$('#diagnosticReport');if(area)area.value=diagnosticReport(diagnosticState);
  };
})();
