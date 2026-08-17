/* Marvel Lector v1.2.18 — diagnóstico vecinos Marvel + portadas GCD v8 */
(() => {
  if(typeof diagnosticReport!=='function')return;
  const CATALOG_SCHEMA_KEY='catalogDiagnosticOfficialSeriesSchema';
  const CATALOG_SCHEMA_VERSION=8;

  if(typeof DIAGNOSTIC_LABELS==='object'){
    DIAGNOSTIC_LABELS.READER_ID_MISSING='Ficha Marvel localizada sin readerId';
  }

  const previousDiagnosticReport=diagnosticReport;
  diagnosticReport=function(d){
    const base=previousDiagnosticReport(d)
      .replace(/Versión: v[^\n]+/,'Versión: v1.2.18-neighbor-gcd-diagnostic')
      .replace(/Esquema: \d+ \| Resolver esperado: \d+/,'Esquema: 8 | Resolver esperado: 8')
      .replace(/IMPORTANTE\n[^\n]+/,'IMPORTANTE\nLas portadas se comprueban de forma independiente mediante el ID de GCD. Marvel Unlimited se resuelve construyendo el índice de cada serie por bloques pequeños de números vecinos; no usa Google, Bing, Marvel Search ni Load More.');
    if(!d)return base;
    const rows=[];
    for(const arr of Object.values(d.samples||{}))for(const s of arr||[]){
      const f=s?.trace?.final;
      if(f&&(f.crawlReason||f.seriesUrl||f.gcdCoverStatus||f.gcdCoverUrl))rows.push({s,f});
    }
    if(!rows.length)return base;
    const lines=['','RESOLUCIÓN POR VECINOS MARVEL + PORTADA GCD — V8'];
    for(const {s,f} of rows){
      lines.push('',`=== orden=${s.order??'?'} | gcd=${s.gcdId??'?'} | ${s.title||'Serie'} #${s.issue||'[s/n]'} ===`);
      lines.push(`resolverSource=${f.resolverSource||''} | reason=${f.reason||''} | crawlReason=${f.crawlReason||''}`);
      lines.push(`crawlSteps=${f.crawlSteps??0} | crawlKnown=${f.crawlKnown??0} | crawlRange=${f.crawlMin||'?'}-${f.crawlMax||'?'}`);
      if(f.seriesLabel)lines.push(`seriesLabel=${f.seriesLabel}`);
      if(f.seriesUrl)lines.push(`seriesUrl=${f.seriesUrl}`);
      if(f.issueUrl)lines.push(`issueUrl=${f.issueUrl}`);
      lines.push(`gcdCoverHTTP=${f.gcdCoverStatus??0} | gcdCover=${f.gcdCoverUrl||''}${f.gcdCoverError?` | error=${f.gcdCoverError}`:''}`);
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
    if(intro)intro.textContent='Diagnóstico V8: comprueba la portada directamente en GCD y, por separado, el progreso del índice incremental de Marvel Unlimited. Un crawl pendiente significa que la serie aún se está completando, no que el número no exista.';
    const area=$('#diagnosticReport');if(area)area.value=diagnosticReport(diagnosticState);
  };
})();
