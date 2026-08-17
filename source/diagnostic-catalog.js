/* Marvel Lector v1.2.17 — diagnóstico Load More oficial v7 */
(() => {
  if(typeof diagnosticReport!=='function')return;
  const CATALOG_SCHEMA_KEY='catalogDiagnosticOfficialSeriesSchema';
  const CATALOG_SCHEMA_VERSION=7;

  if(typeof DIAGNOSTIC_LABELS==='object'){
    DIAGNOSTIC_LABELS.READER_ID_MISSING='Ficha Marvel localizada sin readerId';
  }

  const previousDiagnosticReport=diagnosticReport;
  diagnosticReport=function(d){
    const base=previousDiagnosticReport(d)
      .replace(/Versión: v[^\n]+/,'Versión: v1.2.17-marvel-loadmore-diagnostic')
      .replace(/Esquema: \d+ \| Resolver esperado: 7/,'Esquema: 7 | Resolver esperado: 7')
      .replace(/IMPORTANTE\n[^\n]+/,'IMPORTANTE\nEl informe prueba la petición histórica real de «Load More» de Marvel (offset + limit=18 + count=20 + totalcount) y registra exactamente qué números devuelve.');
    if(!d)return base;
    const rows=[];
    for(const arr of Object.values(d.samples||{}))for(const s of arr||[]){const f=s?.trace?.final;if(f&&(f.catalogReason||f.loadMoreReason||f.seriesUrl||f.seriesLabel))rows.push({s,f})}
    if(!rows.length)return base;
    const lines=['','LOAD MORE OFICIAL MARVEL — V7'];
    for(const {s,f} of rows){
      lines.push('',`=== orden=${s.order??'?'} | ${s.title||'Serie'} #${s.issue||'[s/n]'} ===`);
      lines.push(`resolverSource=${f.resolverSource||''} | catalogReason=${f.catalogReason||''} | loadMoreReason=${f.loadMoreReason||''}`);
      lines.push(`catalogKnownIssues=${f.catalogKnownIssues??0} | totalDetectado=${f.loadMoreTotal??0}`);
      if(f.catalogKeys?.length)lines.push(`catalogKeysIniciales=${f.catalogKeys.join(',')}`);
      if(f.seriesLabel)lines.push(`seriesLabel=${f.seriesLabel}`);
      if(f.seriesUrl)lines.push(`seriesUrl=${f.seriesUrl}`);
      for(const p of f.loadMoreAttempts||[]){
        lines.push(`loadMore offset=${p.offset??0} | HTTP=${p.status??0} | target=${p.targetFound?'SI':'NO'} | sameAsInitial=${p.sameAsInitial?'SI':'NO'} | keys=${(p.keys||[]).join(',')}${p.error?` | error=${p.error}`:''}`);
        if(p.url)lines.push(`  url=${p.url}`);
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
    if(intro)intro.textContent='Diagnóstico V7: reproduce la petición real que Marvel usaba para «Load More», incluyendo count=20 y limit=18. Si Marvel ignora también esta forma, el informe lo marcará explícitamente y descartaremos la paginación definitivamente.';
    const area=$('#diagnosticReport');if(area)area.value=diagnosticReport(diagnosticState);
  };
})();
