/* Marvel Lector v1.2.3 — resolver Marvel-first + diagnóstico V4 */
const CLIENT_RESOLVER_VERSION=4;
const DIAGNOSTIC_KEY='catalogDiagnosticV4';
const DIAGNOSTIC_VERSION=4;
const DIAGNOSTIC_SAMPLE_LIMIT=300;
const DIAGNOSTIC_SAVE_EVERY=5;
const DIAGNOSTIC_DELAY=260;
const DIAGNOSTIC_LABELS={
  OK:'Correctos',
  LOCAL_MISSING:'Falta en datos locales',
  LOOKUP_UNRESOLVED:'Resolver no pudo localizar la ficha',
  POSSIBLE_MISMATCH:'Posible cómic equivocado',
  NOT_IN_UNLIMITED:'Ficha Marvel sin lector Unlimited',
  DRN_MISSING:'Falta DRN móvil',
  SMARTLINK_MISSING:'Falta Smart Link',
  SMARTLINK_HTTP_ERROR:'Smart Link responde con error',
  WEB_LINK_HTTP_ERROR:'Lector web responde con error',
  RESOLVER_ERROR:'Error del resolver',
  NETWORK_ERROR:'Error de red durante diagnóstico'
};
const diagnosticRuntime={running:false,pauseRequested:false,wakeLock:null,unresolvedRun:0};
let diagnosticState=null;

// Solo se considera fresca la metadata del resolver actual. Esto invalida
// falsos "Sin Unlimited" guardados por versiones anteriores.
isFreshMeta=m=>Boolean(m&&Number(m.resolverVersion)===CLIENT_RESOLVER_VERSION&&m.checkedAt&&Date.now()-new Date(m.checkedAt).getTime()<META_MAX_AGE);
platformMode=()=> 'app';

function unlimitedState(m){
  if(!m||!isFreshMeta(m))return{label:'Unlimited · …',cls:'pending-meta'};
  if(m.available&&m.smartLink)return{label:'Unlimited ✓',cls:'available'};
  if(m.reason==='reader-unavailable')return{label:'Sin Unlimited',cls:'unavailable'};
  if(m.reason==='drn-unavailable')return{label:'Unlimited · enlace pendiente',cls:'unresolved'};
  if(m.reason==='possible-mismatch')return{label:'Coincidencia dudosa',cls:'unresolved'};
  if(m.reason==='lookup-unresolved'||m.reason==='resolver-error')return{label:'No identificado',cls:'unresolved'};
  return{label:'No identificado',cls:'unresolved'};
}
metaBadge=function(id){const st=unlimitedState(state.marvel.get(Number(id)));return `<span class="badge marvel-state ${st.cls}" data-meta-badge>${st.label}</span>`};
updateRenderedMeta=function(id,m){
  $$(`[data-id="${id}"]`).forEach(el=>{
    let b=el.querySelector('[data-meta-badge]')||el.querySelector('.marvel-state');
    if(b){const st=unlimitedState(m);b.className=`badge marvel-state ${st.cls}`;b.textContent=st.label}
    let slot=el.querySelector('[data-cover-slot]');
    if(slot&&m?.coverUrl)slot.innerHTML=`<img class="issue-cover" loading="lazy" decoding="async" src="${esc(m.coverUrl)}" alt="">`
  })
};

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
  let lines=['MARVEL ORDEN DE LECTURA — INFORME DE DIAGNÓSTICO','Versión: v1.2.3-diagnostic',`Generado: ${new Date().toLocaleString('es-ES')}`,`Comprobados: ${fmt.format(d.cursor)} / ${fmt.format(d.total)}`,`Progreso: ${diagnosticPercent(d).toFixed(2)}%`,`Duración acumulada aproximada: ${diagDuration(d)}`,`Estado: ${d.completedAt?'COMPLETADO':diagnosticRuntime.running?'EN CURSO':'PAUSADO / INCOMPLETO'}`,'','IMPORTANTE','El resolver consulta primero el catálogo del propio Marvel y valida título + año de serie + número. Google queda solo como respaldo.','LOOKUP_UNRESOLVED significa que no se obtuvo una ficha con suficiente seguridad; no equivale a "Sin Unlimited".','','RESUMEN'];
  let codes=Object.keys(DIAGNOSTIC_LABELS);for(let code of codes)lines.push(`${code} | ${DIAGNOSTIC_LABELS[code]} | ${fmt.format(d.counts?.[code]||0)}`);
  lines.push('','DETALLES DE POSIBLES FALLOS','Se guardan hasta 300 ejemplos por categoría. Todos los números sí se contrastan durante la ejecución.');
  for(let code of codes.filter(c=>c!=='OK')){
    let arr=d.samples?.[code]||[],count=d.counts?.[code]||0;if(!count)continue;
    lines.push('',`[${code}] ${DIAGNOSTIC_LABELS[code]} — ${fmt.format(count)} casos`);
    for(let s of arr){
      let bits=[`orden=${s.order??'?'}`,`gcd=${s.gcdId??'?'}`,`${s.title||'Serie'} #${s.issue||'[s/n]'}`,`año=${s.year||'?'}`];
      if(s.resolverSource)bits.push(`resolver=${s.resolverSource}`);
      if(s.cacheSource)bits.push(`origen=${s.cacheSource}`);
      if(s.pageTitle)bits.push(`marvel="${s.pageTitle}"`);
      if(s.sourceId)bits.push(`sourceId=${s.sourceId}`);
      if(s.readerId)bits.push(`readerId=${s.readerId}`);
      if(s.appStatus!==undefined)bits.push(`appHTTP=${s.appStatus}`);
      if(s.webStatus!==undefined)bits.push(`webHTTP=${s.webStatus}`);
      if(s.reason)bits.push(`reason=${s.reason}`);
      if(s.issueUrl)bits.push(`issueUrl=${s.issueUrl}`);
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
  let ok=d.counts?.OK||0,problems=Math.max(0,d.cursor-ok),stats=$('#diagnosticStats');if(stats)stats.innerHTML=`<div><strong>${fmt.format(ok)}</strong><span>correctos</span></div><div><strong>${fmt.format(problems)}</strong><span>a revisar</span></div><div><strong>${fmt.format(d.total-d.cursor)}</strong><span>pendientes</span></div>`;
  let area=$('#diagnosticReport');if(area)area.value=diagnosticReport(d);
  let start=$('#diagnosticStartBtn');if(start){start.disabled=diagnosticRuntime.running;start.textContent=d.completedAt?'Ejecutar de nuevo':d.cursor?'Reanudar diagnóstico':'Iniciar diagnóstico'}
  let pause=$('#diagnosticPauseBtn');if(pause)pause.disabled=!diagnosticRuntime.running;
}
async function saveDiagnostic(force=false){if(!diagnosticState)return;diagnosticState.updatedAt=new Date().toISOString();if(force||diagnosticState.cursor%DIAGNOSTIC_SAVE_EVERY===0)await DB.kvSet(DIAGNOSTIC_KEY,diagnosticState)}
async function acquireDiagnosticWakeLock(){try{if('wakeLock'in navigator)diagnosticRuntime.wakeLock=await navigator.wakeLock.request('screen')}catch{}}
async function releaseDiagnosticWakeLock(){try{await diagnosticRuntime.wakeLock?.release()}catch{}diagnosticRuntime.wakeLock=null}
function sampleFromResult(x,s,data,code,cacheSource=''){return{order:x?.o,gcdId:x?.id,title:s?.original||s?.es||seriesName(x?.s),issue:x?.n||'',year:x?.a||'',code,cacheSource,resolverSource:data?.resolverSource||'',reason:data?.reason||data?.error||'',pageTitle:data?.pageTitle||'',issueUrl:data?.issueUrl||'',sourceId:data?.sourceId||'',readerId:data?.readerId||'',appStatus:data?.appCheck?.status??0,webStatus:data?.webCheck?.status??0}}
function diagnosticUrl(x,s){
  let base=new URL(marvelQuery(x,s,'diagnostic'),location.origin),cached=state.marvel.get(Number(x.id));
  if(cached?.available&&cached?.smartLink&&cached?.issueUrl&&Number(cached.resolverVersion)===CLIENT_RESOLVER_VERSION){
    base.searchParams.set('knownIssueUrl',cached.issueUrl);base.searchParams.set('knownSmartLink',cached.smartLink);
    if(cached.sourceId)base.searchParams.set('knownSourceId',cached.sourceId);if(cached.readerId)base.searchParams.set('knownReaderId',cached.readerId);
    if(cached.drn)base.searchParams.set('knownDrn',cached.drn);if(cached.webUrl)base.searchParams.set('knownWebUrl',cached.webUrl);if(cached.pageTitle)base.searchParams.set('knownPageTitle',cached.pageTitle)
  }
  return{url:base.pathname+base.search,cacheSource:cached?.available&&cached?.smartLink&&Number(cached.resolverVersion)===CLIENT_RESOLVER_VERSION?'PWA-cache':''}
}
async function diagnoseOne(row){
  let x=await findIssueById(row[1]);if(!x)return{code:'LOCAL_MISSING',sample:{order:row[0],gcdId:row[1],title:seriesName(row[3]),issue:row[4]||'',year:'',reason:'search.json referencia un ID que no existe en su chunk'}};
  let s=state.seriesMap.get(x.s)||{},target=diagnosticUrl(x,s);
  try{
    let r=await fetch(target.url,{cache:'no-store',headers:{Accept:'application/json'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);let data=await r.json(),code=data.diagnosticCode||'RESOLVER_ERROR';
    if(data.resolverVersion===CLIENT_RESOLVER_VERSION){
      let m={id:Number(x.id),checkedAt:new Date().toISOString(),...data};delete m.appCheck;delete m.webCheck;delete m.diagnosticCode;delete m.match;
      state.marvel.set(Number(x.id),m);await DB.put('marvel',m);updateRenderedMeta(x.id,m)
    }
    return{code,sample:sampleFromResult(x,s,data,code,target.cacheSource)};
  }catch(e){return{code:'NETWORK_ERROR',sample:sampleFromResult(x,s,{error:String(e?.message||e)},'NETWORK_ERROR',target.cacheSource)}}
}
async function startDiagnostic(){
  if(diagnosticRuntime.running)return;let idx=await ensureSearch();
  if(!diagnosticState||diagnosticState.version!==DIAGNOSTIC_VERSION||diagnosticState.total!==idx.length||diagnosticState.completedAt){diagnosticState=emptyDiagnostic(idx.length);await DB.kvSet(DIAGNOSTIC_KEY,diagnosticState)}
  diagnosticRuntime.running=true;diagnosticRuntime.pauseRequested=false;diagnosticRuntime.unresolvedRun=0;await acquireDiagnosticWakeLock();renderDiagnostic();
  try{
    while(diagnosticState.cursor<idx.length&&!diagnosticRuntime.pauseRequested){
      let row=idx[diagnosticState.cursor],result=await diagnoseOne(row);diagnosticCount(diagnosticState,result.code);diagnosticSample(diagnosticState,result.code,result.sample);diagnosticState.cursor++;await saveDiagnostic();renderDiagnostic();
      if(result.code==='LOOKUP_UNRESOLVED')diagnosticRuntime.unresolvedRun++;else diagnosticRuntime.unresolvedRun=0;
      if(diagnosticRuntime.unresolvedRun>=20){diagnosticRuntime.pauseRequested=true;toast('Diagnóstico pausado: 20 búsquedas seguidas sin resolver. Pásame el informe antes de continuar.')}
      if(result.code==='NETWORK_ERROR'||result.code==='RESOLVER_ERROR')await diagnosticSleep(1200);else if(result.code==='LOOKUP_UNRESOLVED')await diagnosticSleep(600);else await diagnosticSleep(DIAGNOSTIC_DELAY);
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
  let reset=$('#resetBtn'),group=document.createElement('div');group.className='settings-group';group.innerHTML='<button id="diagnosticBtn" type="button" class="secondary full">Ejecutar diagnóstico</button><p class="small muted">Contrasta el catálogo con la búsqueda oficial de Marvel, valida Unlimited y guarda el avance.</p>';settings.insertBefore(group,reset);
  let dialog=document.createElement('dialog');dialog.id='diagnosticDialog';dialog.innerHTML='<div class="dialog-card diagnostic-card"><div class="sheet-handle" aria-hidden="true"></div><button class="dialog-close" type="button" aria-label="Cerrar">×</button><span class="eyebrow">DIAGNÓSTICO</span><h2>Comprobar catálogo y enlaces</h2><p class="diagnostic-intro">La búsqueda del propio Marvel es ahora la fuente principal. Solo se etiqueta “Sin Unlimited” cuando existe una ficha Marvel y esa ficha carece de lector digital.</p><div class="diagnostic-progress"><div id="diagnosticProgressBar"></div></div><div id="diagnosticStatus" class="diagnostic-status">Preparando…</div><div id="diagnosticStats" class="diagnostic-stats"></div><div class="diagnostic-actions"><button id="diagnosticStartBtn" type="button" class="primary">Iniciar diagnóstico</button><button id="diagnosticPauseBtn" type="button" class="secondary" disabled>Pausar</button><button id="diagnosticResetBtn" type="button" class="secondary">Reiniciar</button></div><textarea id="diagnosticReport" readonly spellcheck="false" aria-label="Informe de diagnóstico"></textarea><div class="diagnostic-actions two"><button id="diagnosticCopyBtn" type="button" class="primary">Copiar informe</button><button id="diagnosticDownloadBtn" type="button" class="secondary">Descargar TXT</button></div></div>';
  document.body.appendChild(dialog);$('#diagnosticBtn').onclick=openDiagnostic;dialog.querySelector('.dialog-close').onclick=()=>dialog.close();$('#diagnosticStartBtn').onclick=startDiagnostic;$('#diagnosticPauseBtn').onclick=pauseDiagnostic;$('#diagnosticResetBtn').onclick=resetDiagnostic;$('#diagnosticCopyBtn').onclick=copyDiagnostic;$('#diagnosticDownloadBtn').onclick=downloadDiagnostic;
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installDiagnosticUi);else installDiagnosticUi();