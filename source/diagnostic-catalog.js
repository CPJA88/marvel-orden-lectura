/* Marvel Lector v1.2.16 — diagnóstico del fallback Bing v6 */
(() => {
  if(typeof diagnosticReport!=='function')return;
  const CATALOG_SCHEMA_KEY='catalogDiagnosticOfficialSeriesSchema';
  const CATALOG_SCHEMA_VERSION=6;

  if(typeof DIAGNOSTIC_LABELS==='object'){
    DIAGNOSTIC_LABELS.READER_ID_MISSING='Ficha Marvel localizada sin readerId';
  }

  const previousDiagnosticReport=diagnosticReport;
  diagnosticReport=function(d){
    const base=previousDiagnosticReport(d)
      .replace(/Versión: v[^\n]+/,'Versión: v1.2.16-bing-diagnostic')
      .replace(/Esquema: \d+ \| Resolver esperado: 7/,'Esquema: 6 | Resolver esperado: 7')
      .replace('El informe incluye trazas HTTP del resolver real: Google, Marvel, Bing, ficha, readerId, DRN y Smart Link.','El informe traza el catálogo oficial de Marvel y, solo cuando falta el número, un resolver Bing exacto que decodifica sus enlaces y valida la ficha resultante en Marvel.')
      .replace('El informe traza la paginación de la serie oficial de Marvel, la ficha localizada, readerId, DRN y Smart Link. No lanza búsquedas externas adicionales.','El informe traza el catálogo oficial de Marvel y, solo cuando falta el número, un resolver Bing exacto que decodifica sus enlaces y valida la ficha resultante en Marvel.');
    if(!d)return base;
    const rows=[];
    for(const arr of Object.values(d.samples||{}))for(const s of arr||[]){const f=s?.trace?.final;if(f&&(f.catalogReason||f.bingReason||f.seriesUrl||f.seriesLabel))rows.push({s,f})}
    if(!rows.length)return base;
    const lines=['','RESOLUCIÓN MARVEL + BING EXACTO — V6'];
    for(const {s,f} of rows){
      lines.push('',`=== orden=${s.order??'?'} | ${s.title||'Serie'} #${s.issue||'[s/n]'} ===`);
      lines.push(`resolverSource=${f.resolverSource||''} | catalogReason=${f.catalogReason||''} | bingReason=${f.bingReason||''}`);
      lines.push(`catalogKnownIssues=${f.catalogKnownIssues??0} | bingHTTP=${f.bingStatus??0} | bingMs=${f.bingMs??0} | bingCandidates=${(f.bingCandidates||[]).length}`);
      if(f.catalogKeys?.length)lines.push(`catalogKeysIniciales=${f.catalogKeys.join(',')}`);
      if(f.seriesLabel)lines.push(`seriesLabel=${f.seriesLabel}`);
      if(f.seriesUrl)lines.push(`seriesUrl=${f.seriesUrl}`);
      if(f.bingSearchUrl)lines.push(`bingSearchUrl=${f.bingSearchUrl}`);
      if(f.bingCandidates?.length)lines.push(`bingCandidates=${f.bingCandidates.join(' ; ')}`);
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
    if(intro)intro.textContent='Diagnóstico V6: usa primero el catálogo oficial. Si falta el número, consulta Bing una sola vez, decodifica sus enlaces y valida cada candidato contra título + año + número en Marvel. El informe indica si Bing bloquea, no devuelve candidatos o devuelve una ficha equivocada.';
    const area=$('#diagnosticReport');if(area)area.value=diagnosticReport(diagnosticState);
  };
})();
