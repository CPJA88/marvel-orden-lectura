/* Marvel Lector v1.2.1 — botón universal de Unlimited + diagnóstico reanudable */
const DIAGNOSTIC_KEY='catalogDiagnosticV2';
const DIAGNOSTIC_VERSION=2;
const DIAGNOSTIC_SAMPLE_LIMIT=300;
const DIAGNOSTIC_SAVE_EVERY=5;
const DIAGNOSTIC_DELAY=180;
const DIAGNOSTIC_LABELS={
  OK:'Correctos',
  LOCAL_MISSING:'Falta en datos locales',
  NO_MARVEL_MATCH:'Sin coincidencia en Marvel',
  POSSIBLE_MISMATCH:'Posible cómic equivocado',
  NOT_IN_UNLIMITED:'Ficha Marvel sin lector Unlimited',
  DRN_MISSING:'Falta DRN móvil',
  SMARTLINK_MISSING:'Falta Smart Link',
  SMARTLINK_HTTP_ERROR:'Smart Link responde con error',
  WEB_LINK_HTTP_ERROR:'Lector web responde con error',
  RESOLVER_ERROR:'Error del resolver',
  NETWORK_ERROR:'Error de red durante diagnóstico'
};
const diagnosticRuntime={running:false,pauseRequested:false,wakeLock:null};
let diagnosticState=null;

// El Smart Link oficial funciona en ambas plataformas. Se conserva un único modo.
platformMode=()=> 'app';
officialButtons=function(x,s,title){
  let spanish=String(title||s.original||'Marvel'),paniniQuery=`site:panini.es/shp_esp_es/ "${spanish}" "${x.n?'#'+x.n:''}" ${x.a||''} Marvel`,pan='https://www.google.com/search?q='+encodeURIComponent(paniniQuery);
  return `<div class="official-links"><a class="primary full marvel-launch" data-mode="app" href="${esc(marvelQuery(x,s,'app'))}">Abrir en Marvel Unlimited</a><a class="secondary full" target="_blank" rel="noopener" href="${esc(marvelQuery(x,s,'web'))}">Abrir en Marvel Unlimited Web</a><a class="secondary full" target="_blank" rel="noopener" href="${esc(pan)}">Buscar edición en castellano</a></div>`
};

function diagnosticSleep(ms){return new Promise(r=>setTimeout(r,ms))}
function emptyDiagnostic(total){return{version:DIAGNOSTIC_VERSION,total,cursor:0,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),completedAt:null,counts:{},samples:{}}}
function diagnosticCount(d,code){d.counts[code]=(d.counts[code]||0)+1}
function diagnosticSample(d,code,sample){if(code==='OK')return;let arr=d.samples[code]||(d.samples[code]=[]);if(arr.length<DIAGNOSTIC_SAMPLE_LIMIT)arr.push(sample)}
function diagnosticPercent(d){return d?.total?Math.min(100,(d.cursor/d.total)*100):0}
function diagDuration(d){let start=new Date(d.startedAt||Date.now()).getTime(),end=d.completedAt?new Date(d.completedAt).getTime():Date.now(),mins=Math.max(0,Math.round((end-start)/60000));return mins<60?`${mins} min`:`${Math.floor(mins/60)} h ${mins%60} min`}
function diagnosticReport(d){
  if(!d)return 'Todavía no hay un diagnóstico guardado.';
  let lines=['MARVEL ORDEN DE LECTURA — INFORME DE DIAGNÓSTICO','Versión: v1.2.1-diagnostic',`Generado: ${new Date().toLocaleString('es-ES')}`,`Comprobados: ${fmt.format(d.cursor)} / ${fmt.format(d.total)}`,`Progreso: ${diagnosticPercent(d).toFixed(2)}%`,`Duración acumulada aproximada: ${diagDuration(d)}`,`Estado: ${d.completedAt?'COMPLETADO':diagnosticRuntime.running?'EN CURSO':'PAUSADO / INCOMPLETO'}`,'','RESUMEN'];
  let codes=Object.keys(DIAGNOSTIC_LABELS);for(let code of codes)lines.push(`${code} | ${DIAGNOSTIC_LABELS[code]} | ${fmt.format(d.counts?.[code]||0)}`);
  lines.push('','DETALLES DE POSIBLES FALLOS','Se guardan hasta 300 ejemplos por categoría para que el informe siga siendo manejable. Todos los cómics sí se contrastan durante la ejecución.');
  for(let code of codes.filter(c=>c!=='OK')){
    let arr=d.samples?.[code]||[],count=d.counts?.[code]||0;if(!count)continue;
    lines.push('',`[${code}] ${DIAGNOSTIC_LABELS[code]} — ${fmt.format(count)} casos`);
    for(let s of arr){
      let bits=[`orden=${s.order??'?'}`,`gcd=${s.gcdId??'?'}`,`${s.title||'Serie'} #${s.issue||'[s/n]'}`,`año=${s.year||'?'}`];
      if(s.pageTitle)bits.push(`marvel="${s.pageTitle}"`);if(s.sourceId)bits.push(`sourceId=${s.sourceId}`);if(s.readerId)bits.push(`readerId=${s.readerId}`);if(s.appStatus!==undefined)bits.push(`appHTTP=${s.appStatus}`);if(s.webStatus!==undefined)bits.push(`webHTTP=${s.webStatus}`);if(s.reason)bits.push(`reason=${s.reason}`);if(s.issueUrl)bits.push(`issueUrl=${s.issueUrl}`);
      lines.push('- '+bits.join(' | '));
    }
    if(count>arr.length)lines.push(`... ${fmt.format(count-arr.length)} casos adicionales no incluidos en el texto.`);
  }
  return lines.join('\n')
}
function renderDiagnostic(){
  let d=diagnosticState;if(!d)return;
  let pct=diagnosticPercent(d),bar=$('#diagnosticProgressBar');if(bar)bar.style.width=pct+'%';
  let status=$('#diagnosticStatus');if(status)status.textContent=`${fmt.format(d.cursor)} / ${fmt.format(d.total)} · ${pct.toFixed(2)}% · ${diagnosticRuntime.running?'Ejecutándose':d.completedAt?'Completado':'Pausado'}`;
  let ok=d.counts?.OK||0,problems=Math.max(0,d.cursor-ok);let stats=$('#diagnosticStats');if(stats)stats.innerHTML=`<div><strong>${fmt.format(ok)}</strong><span>correctos</span></div><div><strong>${fmt.format(problems)}</strong><span>a revisar</span></div><div><strong>${fmt.format(d.total-d.cursor)}</strong><span>pendientes</span></div>`;
  let area=$('#diagnosticReport');if(area)area.value=diagnosticReport(d);
  let start=$('#diagnosticStartBtn');if(start){start.disabled=diagnosticRuntime.running;start.textContent=d.completedAt?'Ejecutar de nuevo':d.cursor?'Reanudar diagnóstico':'Iniciar diagnóstico'}
  let pause=$('#diagnosticPauseBtn');if(pause)pause.disabled=!diagnosticRuntime.running;
}
async function saveDiagnostic(force=false){if(!diagnosticState)return;diagnosticState.updatedAt=new Date().toISOString();if(force||diagnosticState.cursor%DIAGNOSTIC_SAVE_EVERY===0)await DB.kvSet(DIAGNOSTIC_KEY,diagnosticState)}
async function acquireDiagnosticWakeLock(){try{if('wakeLock'in navigator)diagnosticRuntime.wakeLock=await navigator.wakeLock.request('screen')}catch{}}
async function releaseDiagnosticWakeLock(){try{await diagnosticRuntime.wakeLock?.release()}catch{}diagnosticRuntime.wakeLock=null}
function sampleFromResult(x,s,data,code){return{order:x?.o,gcdId:x?.id,title:s?.original||s?.es||seriesName(x?.s),issue:x?.n||'',year:x?.a||'',code,reason:data?.reason||data?.error||'',pageTitle:data?.pageTitle||'',issueUrl:data?.issueUrl||'',sourceId:data?.sourceId||'',readerId:data?.readerId||'',appStatus:data?.appCheck?.status??0,webStatus:data?.webCheck?.status??0}}
async function diagnoseOne(row){
  let x=await findIssueById(row[1]);if(!x)return{code:'LOCAL_MISSING',sample:{order:row[0],gcdId:row[1],title:seriesName(row[3]),issue:row[4]||'',year:'',reason:'search.json referencia un ID que no existe en su chunk'}};
  let s=state.seriesMap.get(x.s)||{};
  try{
    let r=await fetch(marvelQuery(x,s,'diagnostic'),{cache:'no-store',headers:{Accept:'application/json'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);let data=await r.json(),code=data.diagnosticCode||'RESOLVER_ERROR';
    return{code,sample:sampleFromResult(x,s,data,code)};
  }catch(e){return{code:'NETWORK_ERROR',sample:sampleFromResult(x,s,{error:String(e?.message||e)},'NETWORK_ERROR')}}
}
async function startDiagnostic(){
  if(diagnosticRuntime.running)return;let idx=await ensureSearch();
  if(!diagnosticState||diagnosticState.version!==DIAGNOSTIC_VERSION||diagnosticState.total!==idx.length||diagnosticState.completedAt){diagnosticState=emptyDiagnostic(idx.length);await DB.kvSet(DIAGNOSTIC_KEY,diagnosticState)}
  diagnosticRuntime.running=true;diagnosticRuntime.pauseRequested=false;await acquireDiagnosticWakeLock();renderDiagnostic();
  try{
    while(diagnosticState.cursor<idx.length&&!diagnosticRuntime.pauseRequested){
      let row=idx[diagnosticState.cursor],result=await diagnoseOne(row);diagnosticCount(diagnosticState,result.code);diagnosticSample(diagnosticState,result.code,result.sample);diagnosticState.cursor++;await saveDiagnostic();renderDiagnostic();
      if(result.code==='NETWORK_ERROR'||result.code==='RESOLVER_ERROR')await diagnosticSleep(900);else await diagnosticSleep(DIAGNOSTIC_DELAY);
    }
    if(diagnosticState.cursor>=idx.length){diagnosticState.completedAt=new Date().toISOString();toast('Diagnóstico completo')}
  }finally{diagnosticRuntime.running=false;await saveDiagnostic(true);await releaseDiagnosticWakeLock();renderDiagnostic()}
}
async function pauseDiagnostic(){diagnosticRuntime.pauseRequested=true;$('#diagnosticPauseBtn').disabled=true;toast('El diagnóstico se pausará tras esta comprobación')}
async function resetDiagnostic(){if(diagnosticRuntime.running){toast('Pausa primero el diagnóstico');return}if(!confirm('¿Borrar el diagnóstico guardado y empezar desde cero?'))return;let idx=await ensureSearch();diagnosticState=emptyDiagnostic(idx.length);await DB.kvSet(DIAGNOSTIC_KEY,diagnosticState);renderDiagnostic()}
async function copyDiagnostic(){let text=diagnosticReport(diagnosticState);try{await navigator.clipboard.writeText(text);toast('Informe copiado')}catch{let area=$('#diagnosticReport');area.focus();area.select();document.execCommand('copy');toast('Informe copiado')}}
function downloadDiagnostic(){let text=diagnosticReport(diagnosticState),blob=new Blob([text],{type:'text/plain;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`marvel-diagnostico-${new Date().toISOString().slice(0,10)}.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
async function openDiagnostic(){
  $('#settingsDialog').close();let idx=await ensureSearch(),saved=await DB.kvGet(DIAGNOSTIC_KEY);diagnosticState=saved&&saved.version===DIAGNOSTIC_VERSION&&saved.total===idx.length?saved:emptyDiagnostic(idx.length);if(!saved||saved.version!==DIAGNOSTIC_VERSION||saved.total!==idx.length)await DB.kvSet(DIAGNOSTIC_KEY,diagnosticState);renderDiagnostic();$('#diagnosticDialog').showModal()
}
function installDiagnosticUi(){
  let settings=$('#settingsDialog .settings-card');if(!settings||$('#diagnosticBtn'))return;
  let reset=$('#resetBtn'),group=document.createElement('div');group.className='settings-group';group.innerHTML='<button id="diagnosticBtn" type="button" class="secondary full">Ejecutar diagnóstico</button><p class="small muted">Contrasta el catálogo completo con Marvel y comprueba sus enlaces. Es reanudable y puede tardar varias horas.</p>';settings.insertBefore(group,reset);
  let dialog=document.createElement('dialog');dialog.id='diagnosticDialog';dialog.innerHTML='<div class="dialog-card diagnostic-card"><div class="sheet-handle" aria-hidden="true"></div><button class="dialog-close" type="button" aria-label="Cerrar">×</button><span class="eyebrow">DIAGNÓSTICO</span><h2>Comprobar catálogo y enlaces</h2><p class="diagnostic-intro">Se comprueba cada entrada del orden principal contra Marvel, el lector web y el Smart Link de Marvel Unlimited. El proceso guarda su avance y puede reanudarse.</p><div class="diagnostic-progress"><div id="diagnosticProgressBar"></div></div><div id="diagnosticStatus" class="diagnostic-status">Preparando…</div><div id="diagnosticStats" class="diagnostic-stats"></div><div class="diagnostic-actions"><button id="diagnosticStartBtn" type="button" class="primary">Iniciar diagnóstico</button><button id="diagnosticPauseBtn" type="button" class="secondary" disabled>Pausar</button><button id="diagnosticResetBtn" type="button" class="secondary">Reiniciar</button></div><textarea id="diagnosticReport" readonly spellcheck="false" aria-label="Informe de diagnóstico"></textarea><div class="diagnostic-actions two"><button id="diagnosticCopyBtn" type="button" class="primary">Copiar informe</button><button id="diagnosticDownloadBtn" type="button" class="secondary">Descargar TXT</button></div></div>';
  document.body.appendChild(dialog);$('#diagnosticBtn').onclick=openDiagnostic;dialog.querySelector('.dialog-close').onclick=()=>dialog.close();$('#diagnosticStartBtn').onclick=startDiagnostic;$('#diagnosticPauseBtn').onclick=pauseDiagnostic;$('#diagnosticResetBtn').onclick=resetDiagnostic;$('#diagnosticCopyBtn').onclick=copyDiagnostic;$('#diagnosticDownloadBtn').onclick=downloadDiagnostic;
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installDiagnosticUi);else installDiagnosticUi();
