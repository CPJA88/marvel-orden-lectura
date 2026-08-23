/* Marvel Lector v1.3.0 — órdenes de lectura por personaje */
(() => {
  const PAGE_SIZE=120;
  const viewState={
    character:null,
    base:[],
    filtered:[],
    page:0,
    loading:false,
    stats:null,
    request:0,
    controller:null,
    indexPromise:null,
    searchResults:[]
  };
  let filterTimer=null;

  const el=id=>document.getElementById(id);
  const bridge=()=>globalThis.MarvelLibraryBridge;
  const matcher=()=>globalThis.MarvelCharacterMatching;
  const friendlyName=value=>String(value||'Personaje').split('/')[0].replace(/\s*\(EARTH[^)]*\)\s*$/i,'').trim()||'Personaje';

  function fillDecades(){
    const select=el('characterDecadeFilter');
    if(!select||select.options.length)return;
    const chunks=Array.isArray(state?.meta?.chunks)?state.meta.chunks:[];
    select.innerHTML='<option value="all">Todas las décadas</option>'+chunks.map(c=>`<option value="${esc(c.id)}">${c.id==='sin-fecha'?'Sin fecha':`${esc(c.id)}–${Number(c.id)+9}`} · ${fmt.format(c.count)}</option>`).join('');
  }

  function resetFilters(render=true){
    for(const id of ['characterStatusFilter','characterContentFilter','characterEraFilter','characterDecadeFilter'])if(el(id))el(id).value='all';
    if(el('characterIssueSearch'))el('characterIssueSearch').value='';
    if(render)filterCharacter();
  }

  function textMatches(issue,tokens){
    if(!tokens.length)return true;
    const series=state.seriesMap.get(Number(issue.s))||{};
    const hay=bridge().normalize(`${series.original||''} ${series.es||''} ${issue.n||''} #${issue.n||''} ${issue.t||''}`);
    return tokens.every(token=>hay.includes(token));
  }

  function filterCharacter(){
    if(!viewState.character||viewState.loading)return;
    const query=bridge().normalize(el('characterIssueSearch')?.value||'').split(/\s+/).filter(Boolean);
    const status=el('characterStatusFilter')?.value||'all';
    const content=el('characterContentFilter')?.value||'all';
    const era=el('characterEraFilter')?.value||'all';
    const decade=el('characterDecadeFilter')?.value||'all';
    viewState.page=0;
    viewState.filtered=viewState.base.filter(issue=>
      (decade==='all'||bridge().getIssueDecade(issue.id)===decade)&&
      matchesStatus(issue,status)&&
      (content==='all'||issue.c===content)&&
      (era==='all'||issue.e===era)&&
      textMatches(issue,query)
    );
    renderCharacterIssues();
  }

  function renderCharacterIssues(){
    const list=el('characterIssueList'),count=el('characterResultCount'),more=el('characterLoadMore');
    if(!list||!count||!more)return;
    if(viewState.loading){
      list.innerHTML='<div class="character-loading">Preparando la cronología y cruzándola con la biblioteca…</div>';
      count.textContent='Preparando orden…';
      more.classList.add('hidden');
      return;
    }
    const max=(viewState.page+1)*PAGE_SIZE;
    const rows=viewState.filtered.slice(0,max);
    list.innerHTML=rows.map(issue=>card(issue,false)).join('')||'<div class="notice">No hay resultados con estos filtros.</div>';
    count.textContent=`${fmt.format(viewState.filtered.length)} resultados`;
    more.classList.toggle('hidden',max>=viewState.filtered.length);
    wireCards('#characterIssueList',false);
    observeVisibleCards('#characterIssueList');
  }

  function renderCoverage(stats){
    const coverage=el('characterCoverage');
    if(!coverage)return;
    if(!stats){coverage.textContent='';return}
    const pieces=[`${fmt.format(stats.issues.length)} números de la biblioteca`,`${fmt.format(stats.matchedRefs)} de ${fmt.format(stats.sourceRefs)} referencias emparejadas`];
    if(stats.unmatchedRefs)pieces.push(`${fmt.format(stats.unmatchedRefs)} sin correspondencia en este export`);
    coverage.textContent=pieces.join(' · ')+'.';
  }

  async function ensureIndex(){
    if(viewState.indexPromise)return viewState.indexPromise;
    viewState.indexPromise=(async()=>{
      const issues=await bridge().ensureAllIssues();
      await new Promise(resolve=>typeof requestAnimationFrame==='function'?requestAnimationFrame(()=>setTimeout(resolve,0)):setTimeout(resolve,0));
      return matcher().createIssueIndex(issues,state.seriesMap);
    })().catch(error=>{viewState.indexPromise=null;throw error});
    return viewState.indexPromise;
  }

  async function responseJson(url,options={}){
    const response=await fetch(url,{...options,headers:{Accept:'application/json',...(options.headers||{})}});
    let data=null;
    try{data=await response.json()}catch{}
    if(!response.ok)throw new Error(data?.error||`La consulta respondió con HTTP ${response.status}.`);
    return data;
  }

  function safeSourceLink(value){
    try{
      const url=new URL(String(value||''));
      if(url.protocol==='https:'&&(url.hostname==='www.chronologyproject.com'||url.hostname==='chronologyproject.com'))return url.toString();
    }catch{}
    return'https://www.chronologyproject.com/';
  }

  async function loadCharacter(character){
    const sourceName=String(character?.name||'').trim(),path=String(character?.path||''),anchor=String(character?.anchor||''),label=String(character?.label||friendlyName(sourceName));
    if(!sourceName||!path)return;
    const request=++viewState.request;
    viewState.controller?.abort();
    viewState.controller=new AbortController();
    viewState.character={name:sourceName,path,anchor,label};
    viewState.base=[];viewState.filtered=[];viewState.stats=null;viewState.loading=true;
    fillDecades();resetFilters(false);
    el('characterHome')?.classList.add('hidden');
    el('characterLibrary')?.classList.remove('hidden');
    if(el('characterTitle'))el('characterTitle').textContent=label;
    renderCoverage(null);renderCharacterIssues();
    try{
      const params=new URLSearchParams({path,anchor,name:sourceName});
      const[data,index]=await Promise.all([
        responseJson(`/api/characters/appearances?${params}`,{signal:viewState.controller.signal}),
        ensureIndex()
      ]);
      if(request!==viewState.request)return;
      const stats=matcher().matchAppearances(data.appearances,index);
      if(!stats.issues.length)throw new Error('No hay números de esta cronología en la biblioteca local.');
      viewState.stats=stats;viewState.base=stats.issues;viewState.filtered=stats.issues.slice();viewState.loading=false;
      if(el('characterSourceLink'))el('characterSourceLink').href=safeSourceLink(data.source?.url);
      renderCoverage(stats);renderCharacterIssues();
    }catch(error){
      if(error?.name==='AbortError'||request!==viewState.request)return;
      console.warn('Orden por personaje',error);
      viewState.loading=false;viewState.base=[];viewState.filtered=[];
      const list=el('characterIssueList');if(list)list.innerHTML=`<div class="notice">No se pudo preparar este orden: ${esc(error?.message||'error desconocido')}</div>`;
      if(el('characterResultCount'))el('characterResultCount').textContent='Orden no disponible';
      el('characterLoadMore')?.classList.add('hidden');
    }
  }

  function closeCharacter(){
    viewState.request++;viewState.controller?.abort();viewState.controller=null;viewState.loading=false;
    viewState.character=null;viewState.base=[];viewState.filtered=[];viewState.stats=null;
    el('characterLibrary')?.classList.add('hidden');el('characterHome')?.classList.remove('hidden');
  }

  function showLookup(){
    el('characterSearchPanel')?.classList.remove('hidden');
    requestAnimationFrame(()=>el('characterLookupInput')?.focus());
  }
  function closeLookup(){
    el('characterSearchPanel')?.classList.add('hidden');
    if(el('characterLookupStatus'))el('characterLookupStatus').textContent='';
    if(el('characterLookupResults'))el('characterLookupResults').replaceChildren();
  }

  function renderLookupResults(results){
    const root=el('characterLookupResults');if(!root)return;
    root.replaceChildren();viewState.searchResults=results;
    for(const[result,index]of results.slice(0,30).entries()){
      const button=document.createElement('button');button.type='button';button.className='character-result';button.dataset.characterIndex=String(index);
      const name=document.createElement('span');name.textContent=result.name;
      const arrow=document.createElement('b');arrow.setAttribute('aria-hidden','true');arrow.textContent='›';
      button.append(name,arrow);button.onclick=()=>loadCharacter({...result,label:friendlyName(result.name)});
      root.append(button);
    }
  }

  async function searchCharacters(){
    const input=el('characterLookupInput'),button=el('characterLookupBtn'),status=el('characterLookupStatus');
    const query=String(input?.value||'').trim();
    if(query.length<2){if(status)status.textContent='Escribe al menos dos caracteres.';return}
    if(button)button.disabled=true;if(status)status.textContent='Buscando personajes…';
    try{
      const data=await responseJson(`/api/characters/search?q=${encodeURIComponent(query)}`);
      const results=Array.isArray(data.results)?data.results:[];
      renderLookupResults(results);
      if(status)status.textContent=results.length?`${fmt.format(results.length)} coincidencias`:'No se encontraron personajes.';
    }catch(error){
      renderLookupResults([]);if(status)status.textContent=error?.message||'No se pudo completar la búsqueda.';
    }finally{if(button)button.disabled=false}
  }

  function bindCharacters(){
    fillDecades();
    document.querySelectorAll('.character-choice[data-character-path]').forEach(button=>button.addEventListener('click',()=>loadCharacter({
      name:button.dataset.characterName,
      label:button.dataset.characterLabel,
      path:button.dataset.characterPath,
      anchor:button.dataset.characterAnchor||''
    })));
    document.querySelectorAll('.character-portrait img').forEach(img=>img.addEventListener('error',()=>{img.hidden=true},{once:true}));
    el('otherCharacterBtn')?.addEventListener('click',showLookup);
    el('characterLookupClose')?.addEventListener('click',closeLookup);
    el('characterLookupBtn')?.addEventListener('click',searchCharacters);
    el('characterLookupInput')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();searchCharacters()}});
    el('characterBack')?.addEventListener('click',closeCharacter);
    for(const id of ['characterStatusFilter','characterContentFilter','characterEraFilter','characterDecadeFilter'])el(id)?.addEventListener('change',filterCharacter);
    el('characterIssueSearch')?.addEventListener('input',()=>{clearTimeout(filterTimer);filterTimer=setTimeout(filterCharacter,120)});
    el('characterClearFilters')?.addEventListener('click',()=>resetFilters(true));
    el('characterLoadMore')?.addEventListener('click',()=>{viewState.page++;renderCharacterIssues()});
    document.addEventListener('marvel:view-change',event=>{if(event.detail?.view==='characters')fillDecades()});
    document.addEventListener('marvel:progress-change',()=>{if(viewState.character&&!viewState.loading)filterCharacter()});
  }

  globalThis.MarvelCharacters={loadCharacter,closeCharacter,searchCharacters};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindCharacters,{once:true});
  else bindCharacters();
})();
