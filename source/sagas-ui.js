/* Marvel Lector v1.3.1 — catálogo y órdenes de lectura de sagas */
(() => {
  'use strict';

  const PAGE_SIZE=120;
  const MODE_LABELS={principal:'Principal',essential:'Esencial',complete:'Completo'};
  const IMPORTANCE_LABELS={principal:'Serie principal',essential:'Esencial',complete:'Completo'};
  const sagaState={
    catalog:[],catalogPromise:null,showAll:false,eventCache:new Map(),activeMeta:null,activeSaga:null,
    issuesById:new Map(),mode:'essential',filtered:[],page:0,loading:false,request:0,missing:[]
  };
  let catalogTimer=null,filterTimer=null;

  const el=id=>document.getElementById(id);
  const bridge=()=>globalThis.MarvelLibraryBridge;
  const core=()=>globalThis.MarvelSagasCore;
  const modeLabel=mode=>MODE_LABELS[mode]||MODE_LABELS.essential;
  const initials=title=>String(title||'Saga').split(/\s+/).filter(Boolean).slice(0,2).map(word=>word[0]).join('').toUpperCase();

  async function fetchJSON(url){
    const response=await fetch(url,{cache:'default',headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  }

  async function ensureCatalog(){
    if(sagaState.catalog.length)return sagaState.catalog;
    if(sagaState.catalogPromise)return sagaState.catalogPromise;
    sagaState.catalogPromise=fetchJSON('data/sagas/catalog.json').then(data=>{
      const events=Array.isArray(data?.events)?data.events:[];
      sagaState.catalog=events.slice().sort((a,b)=>Number(a.year)-Number(b.year)||String(a.title).localeCompare(String(b.title),'es'));
      return sagaState.catalog;
    }).catch(error=>{sagaState.catalogPromise=null;throw error});
    return sagaState.catalogPromise;
  }

  function sagaCard(meta){
    const available=meta.status==='available'&&meta.dataFile;
    const status=available?'Disponible':'Próximamente';
    return `<button type="button" class="saga-card" data-saga-id="${esc(meta.id)}" aria-label="${esc(meta.title)} (${esc(meta.year)})${available?'':' · orden en preparación'}"><span class="saga-card-cover"><span class="saga-card-fallback">${esc(initials(meta.title))}</span>${meta.coverIssueId?`<img src="/api/gcd/cover-image?id=${Number(meta.coverIssueId)}" alt="" loading="lazy" decoding="async">`:''}<span class="saga-card-year">${esc(meta.year)}</span></span><span class="saga-card-body"><strong class="saga-card-title">${esc(meta.title)}</strong><span class="saga-card-copy">${esc(meta.description||'')}</span><span class="saga-card-status"><span class="${available?'available':''}">${status}</span><span class="saga-card-progress" data-saga-progress="${esc(meta.id)}">${available?'Calculando…':'—'}</span></span></span></button>`;
  }

  function bindCatalogCards(){
    document.querySelectorAll('#sagaCatalogGrid .saga-card').forEach(button=>button.addEventListener('click',()=>openSaga(button.dataset.sagaId)));
    document.querySelectorAll('#sagaCatalogGrid .saga-card-cover img').forEach(img=>img.addEventListener('error',()=>{img.hidden=true},{once:true}));
  }

  function renderCatalog(){
    const root=el('sagaCatalogGrid'),count=el('sagaCatalogCount'),input=el('sagaCatalogSearch');
    if(!root||!count)return;
    const query=bridge()?.normalize(input?.value||'')||String(input?.value||'').toLowerCase();
    const tokens=query.split(/\s+/).filter(Boolean);
    const base=tokens.length||sagaState.showAll?sagaState.catalog:sagaState.catalog.filter(meta=>meta.featured);
    const rows=base.filter(meta=>{
      const hay=bridge()?.normalize(`${meta.title} ${meta.year} ${meta.description||''}`)||String(meta.title).toLowerCase();
      return tokens.every(token=>hay.includes(token));
    });
    root.innerHTML=rows.map(sagaCard).join('')||'<div class="notice">No hay sagas que coincidan con la búsqueda.</div>';
    count.textContent=`${fmt.format(rows.length)} ${rows.length===1?'saga':'sagas'}`;
    const other=el('otherSagaBtn');
    if(other){
      other.querySelector('strong').textContent=sagaState.showAll?'SAGAS DESTACADAS':'OTRA SAGA';
      other.querySelector('small').textContent=sagaState.showAll?'Volver a la selección inicial':'Ver catálogo completo';
    }
    bindCatalogCards();
    refreshCatalogProgress();
  }

  async function loadSagaData(meta){
    if(!meta?.dataFile)throw new Error('Este orden todavía está en preparación.');
    if(sagaState.eventCache.has(meta.id))return sagaState.eventCache.get(meta.id);
    const request=fetchJSON(meta.dataFile).then(data=>{
      const validation=core().validateSaga(data);
      if(!validation.valid)throw new Error('El archivo de la saga no supera la validación estructural.');
      return data;
    }).catch(error=>{sagaState.eventCache.delete(meta.id);throw error});
    sagaState.eventCache.set(meta.id,request);
    return request;
  }

  async function refreshCatalogProgress(){
    const available=sagaState.catalog.filter(meta=>meta.status==='available'&&meta.dataFile);
    await Promise.all(available.map(async meta=>{
      try{
        const saga=await loadSagaData(meta);
        const stats=core().sagaProgress(saga,state.progress,meta.defaultMode||saga.defaultMode||'essential');
        document.querySelectorAll(`[data-saga-progress="${meta.id}"]`).forEach(node=>{node.textContent=`${Math.round(stats.percent)}%`});
      }catch{
        document.querySelectorAll(`[data-saga-progress="${meta.id}"]`).forEach(node=>{node.textContent='No disponible'});
      }
    }));
  }

  function fillDecades(){
    const select=el('sagaDecadeFilter');
    if(!select||select.dataset.ready==='true')return;
    const chunks=Array.isArray(state?.meta?.chunks)?state.meta.chunks:[];
    if(!chunks.length)return;
    select.innerHTML='<option value="all">Todas las décadas</option>'+chunks.map(chunk=>`<option value="${esc(chunk.id)}">${chunk.id==='sin-fecha'?'Sin fecha':`${esc(chunk.id)}–${Number(chunk.id)+9}`}</option>`).join('');
    select.dataset.ready='true';
  }

  function resetFilters(render=true){
    for(const id of ['sagaStatusFilter','sagaContentFilter','sagaEraFilter','sagaDecadeFilter'])if(el(id))el(id).value='all';
    if(el('sagaIssueSearch'))el('sagaIssueSearch').value='';
    sagaState.page=0;
    if(render)filterSaga();
  }

  function currentFilters(){
    const normalize=bridge().normalize;
    return{
      status:el('sagaStatusFilter')?.value||'all',
      content:el('sagaContentFilter')?.value||'all',
      era:el('sagaEraFilter')?.value||'all',
      decade:el('sagaDecadeFilter')?.value||'all',
      tokens:normalize(el('sagaIssueSearch')?.value||'').split(/\s+/).filter(Boolean),
      normalize,
      seriesFor:issue=>state.seriesMap.get(Number(issue.s))||{},
      decadeFor:issue=>bridge().getIssueDecade(issue.id)
    };
  }

  function filterSaga(){
    if(!sagaState.activeSaga||sagaState.loading)return;
    const entries=core().entriesForMode(sagaState.activeSaga,sagaState.mode);
    sagaState.filtered=core().filterEntries(entries,sagaState.issuesById,state.progress,currentFilters());
    sagaState.page=0;
    renderSagaIssues();
  }

  function entryHTML(entry){
    const issue=sagaState.issuesById.get(Number(entry.issueId));
    if(!issue)return'';
    const importance=IMPORTANCE_LABELS[entry.importance]||entry.importance;
    return `<div class="saga-entry" data-saga-order="${Number(entry.order)}"><div class="saga-entry-note"><span>#${fmt.format(entry.order)} del evento</span><span aria-hidden="true">·</span><span class="${entry.type==='main'?'main':''}">${entry.type==='main'?'Principal':'Tie-in'}</span>${entry.importance!=='complete'?`<span aria-hidden="true">·</span><span class="${entry.importance==='essential'?'essential':''}">${esc(importance)}</span>`:''}</div>${card(issue,false)}</div>`;
  }

  function renderSagaIssues(){
    const list=el('sagaIssueList'),count=el('sagaResultCount'),more=el('sagaLoadMore');
    if(!list||!count||!more)return;
    if(sagaState.loading){
      list.innerHTML='<div class="saga-loading">Cruzando el orden de la saga con la biblioteca local…</div>';
      count.textContent='Preparando orden…';more.classList.add('hidden');return;
    }
    if(!sagaState.activeSaga){list.replaceChildren();count.textContent='';more.classList.add('hidden');return}
    const max=(sagaState.page+1)*PAGE_SIZE;
    const rows=sagaState.filtered.slice(0,max);
    const phases=[];
    for(const entry of rows){
      let phase=phases[phases.length-1];
      if(!phase||phase.name!==entry.section){phase={name:entry.section,entries:[]};phases.push(phase)}
      phase.entries.push(entry);
    }
    list.innerHTML=phases.map(phase=>`<section class="saga-phase"><div class="saga-phase-head"><h2>${esc(phase.name)}</h2><span>${fmt.format(phase.entries.length)} ${phase.entries.length===1?'número':'números'}</span></div><div class="issue-list">${phase.entries.map(entryHTML).join('')}</div></section>`).join('')||'<div class="notice">No hay resultados con estos filtros.</div>';
    const total=core().entriesForMode(sagaState.activeSaga,sagaState.mode).length;
    count.textContent=`${fmt.format(sagaState.filtered.length)} de ${fmt.format(total)} números`;
    more.classList.toggle('hidden',max>=sagaState.filtered.length);
    wireCards('#sagaIssueList',false);
    observeVisibleCards('#sagaIssueList');
    refreshSagaProgress();
  }

  function refreshSagaProgress(){
    if(!sagaState.activeSaga)return;
    const stats=core().sagaProgress(sagaState.activeSaga,state.progress,sagaState.mode);
    const percent=stats.percent<10?stats.percent.toFixed(1):Math.round(stats.percent).toString();
    if(el('sagaProgressTitle'))el('sagaProgressTitle').textContent=`${sagaState.activeSaga.title} · ${modeLabel(sagaState.mode)}`;
    if(el('sagaProgressText'))el('sagaProgressText').textContent=`${fmt.format(stats.resolved)} / ${fmt.format(stats.total)} resueltos · ${percent}%`;
    if(el('sagaProgressBar'))el('sagaProgressBar').style.width=`${Math.min(stats.percent,100)}%`;
    const button=el('sagaContinue');
    if(button){button.disabled=!stats.pending;button.textContent=stats.pending?'Continuar saga':'Saga completada'}
    if(el('sagaModeDescription'))el('sagaModeDescription').textContent=sagaState.activeSaga.modes?.[sagaState.mode]||'';
  }

  function renderCoverage(){
    const root=el('sagaCoverage');if(!root||!sagaState.activeSaga)return;
    const seriesCount=new Set([...sagaState.issuesById.values()].map(issue=>Number(issue.s))).size;
    const linked=sagaState.activeSaga.entries.length-sagaState.missing.length;
    root.innerHTML=`<strong>${fmt.format(linked)}</strong> referencias enlazadas · <strong>${fmt.format(seriesCount)}</strong> series${sagaState.missing.length?` · <strong>${fmt.format(sagaState.missing.length)}</strong> sin correspondencia`:''}.`;
  }

  function renderSources(){
    const root=el('sagaSourceLine');if(!root||!sagaState.activeSaga)return;
    const sources=(sagaState.activeSaga.sources||[]).map(source=>`<a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.name)}</a>`);
    root.innerHTML=sources.length?`Fuentes y criterio: ${sources.join(' · ')}`:'';
  }

  function selectMode(mode){
    if(!sagaState.activeSaga)return;
    sagaState.mode=core().normalizeMode(mode,sagaState.activeSaga.defaultMode||'essential');
    document.querySelectorAll('[data-saga-mode]').forEach(button=>button.classList.toggle('active',button.dataset.sagaMode===sagaState.mode));
    sagaState.filtered=core().entriesForMode(sagaState.activeSaga,sagaState.mode);
    filterSaga();
  }

  async function openSaga(id){
    const meta=sagaState.catalog.find(item=>item.id===id);
    if(!meta)return;
    if(meta.status!=='available'||!meta.dataFile){toast(`${meta.title}: orden en preparación.`);return}
    const request=++sagaState.request;
    sagaState.activeMeta=meta;sagaState.activeSaga=null;sagaState.issuesById=new Map();sagaState.missing=[];sagaState.loading=true;sagaState.mode=meta.defaultMode||'essential';sagaState.page=0;
    fillDecades();resetFilters(false);
    el('sagaHome')?.classList.add('hidden');el('sagaLibrary')?.classList.remove('hidden');
    if(el('sagaTitle'))el('sagaTitle').textContent=meta.title;
    if(el('sagaYear'))el('sagaYear').textContent=String(meta.year);
    if(el('sagaDescription'))el('sagaDescription').textContent=meta.description||'';
    document.querySelectorAll('[data-saga-mode]').forEach(button=>button.classList.toggle('active',button.dataset.sagaMode===sagaState.mode));
    renderSagaIssues();
    try{
      const saga=await loadSagaData(meta);
      const issuesById=await bridge().ensureIssuesByIds(saga.entries.map(entry=>entry.issueId));
      if(request!==sagaState.request)return;
      sagaState.activeSaga=saga;sagaState.issuesById=issuesById;sagaState.missing=saga.entries.filter(entry=>!issuesById.has(Number(entry.issueId)));sagaState.loading=false;
      if(el('sagaTitle'))el('sagaTitle').textContent=saga.title;
      if(el('sagaDescription'))el('sagaDescription').textContent=saga.description||meta.description||'';
      sagaState.filtered=core().entriesForMode(saga,sagaState.mode);
      renderCoverage();renderSources();filterSaga();
      window.scrollTo({top:0,behavior:'smooth'});
    }catch(error){
      if(request!==sagaState.request)return;
      sagaState.loading=false;console.warn('Saga',error);
      const list=el('sagaIssueList');if(list)list.innerHTML=`<div class="notice">No se pudo abrir esta saga: ${esc(error?.message||'error desconocido')}</div>`;
      if(el('sagaResultCount'))el('sagaResultCount').textContent='Orden no disponible';
    }
  }

  function closeSaga(){
    sagaState.request++;sagaState.activeMeta=null;sagaState.activeSaga=null;sagaState.issuesById=new Map();sagaState.filtered=[];sagaState.missing=[];sagaState.loading=false;
    el('sagaLibrary')?.classList.add('hidden');el('sagaHome')?.classList.remove('hidden');
    renderCatalog();
  }

  async function continueSaga(){
    if(!sagaState.activeSaga)return;
    const entry=core().firstPending(sagaState.activeSaga,state.progress,sagaState.mode);
    if(!entry){toast('Has completado este nivel de la saga.');return}
    const issue=sagaState.issuesById.get(Number(entry.issueId));
    if(!issue){toast('Este número no está disponible en la biblioteca local.');return}
    await openReader(issue);
  }

  async function showSagas(){
    try{await ensureCatalog();renderCatalog()}catch(error){
      console.warn('Catálogo de sagas',error);
      if(el('sagaCatalogGrid'))el('sagaCatalogGrid').innerHTML=`<div class="notice">No se pudo cargar el catálogo de sagas: ${esc(error?.message||'error desconocido')}</div>`;
      if(el('sagaCatalogCount'))el('sagaCatalogCount').textContent='Catálogo no disponible';
    }
  }

  function bindSagas(){
    fillDecades();
    el('sagaCatalogSearch')?.addEventListener('input',()=>{clearTimeout(catalogTimer);catalogTimer=setTimeout(renderCatalog,100)});
    el('otherSagaBtn')?.addEventListener('click',()=>{sagaState.showAll=!sagaState.showAll;renderCatalog()});
    el('sagaBack')?.addEventListener('click',closeSaga);
    document.querySelectorAll('[data-saga-mode]').forEach(button=>button.addEventListener('click',()=>selectMode(button.dataset.sagaMode)));
    for(const id of ['sagaStatusFilter','sagaContentFilter','sagaEraFilter','sagaDecadeFilter'])el(id)?.addEventListener('change',filterSaga);
    el('sagaIssueSearch')?.addEventListener('input',()=>{clearTimeout(filterTimer);filterTimer=setTimeout(filterSaga,100)});
    el('sagaClearFilters')?.addEventListener('click',()=>resetFilters(true));
    el('sagaContinue')?.addEventListener('click',continueSaga);
    el('sagaLoadMore')?.addEventListener('click',()=>{sagaState.page++;renderSagaIssues()});
    document.addEventListener('marvel:view-change',event=>{if(event.detail?.view==='sagas'){fillDecades();showSagas()}});
    document.addEventListener('marvel:progress-change',()=>{
      if(sagaState.activeSaga&&!sagaState.loading)filterSaga();
      refreshCatalogProgress();
    });
  }

  globalThis.MarvelSagas={openSaga,closeSaga,continueSaga,selectMode,filterSaga,showSagas,getState:()=>sagaState};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindSagas,{once:true});
  else bindSagas();
})();
