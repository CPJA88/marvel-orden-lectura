/* Marvel Lector v1.2.32 — filtros en memoria, carga paralela y sin bloqueos */
(() => {
  let refreshTicket=0;
  let allIssues=null;
  let allIssuesPromise=null;
  let bindingsInstalled=false;
  let searchTimer=null;
  const issueDecade=new Map();

  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const normalize=v=>String(v??'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLocaleLowerCase('es')
    .replace(/[^a-z0-9.]+/g,' ')
    .trim();
  const tokensOf=v=>normalize(v).split(/\s+/).filter(Boolean);

  async function fetchJSON(url,tries=3){
    let last=null;
    for(let attempt=1;attempt<=tries;attempt++){
      const ctrl=new AbortController();
      const timer=setTimeout(()=>ctrl.abort(),15000);
      try{
        const r=await fetch(url,{cache:'default',signal:ctrl.signal});
        if(!r.ok)throw new Error(`${url}: HTTP ${r.status}`);
        return await r.json();
      }catch(e){
        last=e;
        if(attempt<tries)await sleep(350*attempt);
      }finally{clearTimeout(timer)}
    }
    throw last||new Error(`No se pudo cargar ${url}`);
  }

  async function loadPrincipalChunk(c){
    const key=String(c.id);
    if(state.chunks.has(key))return state.chunks.get(key);
    if(state.chunks.has(c.id))return state.chunks.get(c.id);
    const rows=await fetchJSON('data/'+c.file);
    state.chunks.set(c.id,rows);
    state.chunks.set(key,rows);
    return rows;
  }

  async function ensureAllIssues(){
    if(allIssues)return allIssues;
    if(allIssuesPromise)return allIssuesPromise;
    allIssuesPromise=(async()=>{
      const chunks=Array.isArray(state.meta?.chunks)?state.meta.chunks:[];
      if(!chunks.length)throw new Error('No hay bloques de la biblioteca disponibles.');
      const loaded=await Promise.all(chunks.map(async c=>{
        const rows=await loadPrincipalChunk(c);
        for(const x of rows)issueDecade.set(Number(x.id),String(c.id));
        return rows;
      }));
      const flat=loaded.flat();
      flat.sort((a,b)=>Number(a.o)-Number(b.o));
      if(Number(state.meta?.mainCount)&&flat.length!==Number(state.meta.mainCount)){
        throw new Error(`Biblioteca incompleta: ${flat.length}/${state.meta.mainCount}`);
      }
      allIssues=flat;
      return allIssues;
    })().catch(e=>{allIssuesPromise=null;throw e});
    return allIssuesPromise;
  }

  function issueMatchesText(x,tokens){
    if(!tokens.length)return true;
    const s=state.seriesMap.get(Number(x.s))||{};
    const n=String(x.n??'');
    const hay=normalize(`${s.original||''} ${s.es||''} ${n} #${n} ${x.t||''}`);
    return tokens.every(t=>hay.includes(t));
  }

  async function refreshV132(){
    const ticket=++refreshTicket;
    const search=document.getElementById('searchInput');
    const status=document.getElementById('statusFilter');
    const content=document.getElementById('contentFilter');
    const era=document.getElementById('eraFilter');
    const decade=document.getElementById('decadeFilter');
    const count=document.getElementById('resultCount');
    if(!search||!status||!content||!era||!decade)return;

    state.page=0;
    if(count)count.textContent='Cargando biblioteca…';

    try{
      const source=await ensureAllIssues();
      if(ticket!==refreshTicket)return;
      const q=tokensOf(search.value);
      const st=status.value;
      const ct=content.value;
      const er=era.value;
      const dec=String(decade.value||'all');
      const filtered=[];

      for(const x of source){
        if(dec!=='all'&&issueDecade.get(Number(x.id))!==dec)continue;
        if(st!=='all'&&!matchesStatus(x,st))continue;
        if(ct!=='all'&&x.c!==ct)continue;
        if(er!=='all'&&x.e!==er)continue;
        if(state.activeSeries!==null&&Number(x.s)!==Number(state.activeSeries))continue;
        if(!issueMatchesText(x,q))continue;
        filtered.push(x);
      }

      if(ticket!==refreshTicket)return;
      state.filtered=filtered;
      renderIssues();
      updateActiveSeries();
    }catch(e){
      if(ticket!==refreshTicket)return;
      console.error('Búsqueda/filtros v1.2.32',e);
      if(count)count.textContent='Error al cargar la biblioteca';
      const list=document.getElementById('issueList');
      if(list&&!state.filtered?.length)list.innerHTML='<div class="notice">No se pudo cargar la biblioteca completa. Pulsa Restablecer para reintentar.</div>';
      if(typeof toast==='function')toast('No se pudo cargar la biblioteca completa');
    }
  }

  // Sustituimos la ruta antigua antes de que init() termine sus cargas asíncronas.
  refresh=refreshV132;
  selectInitialDecade=async function(){
    const decade=document.getElementById('decadeFilter');
    if(decade)decade.value='all';
    await refreshV132();
  };

  function installBindings(){
    if(bindingsInstalled)return;
    const ids=['statusFilter','contentFilter','eraFilter','decadeFilter'];
    const controls=ids.map(id=>document.getElementById(id));
    const search=document.getElementById('searchInput');
    const clear=document.getElementById('clearFilters');
    if(controls.some(x=>!x)||!search||!clear)return;
    bindingsInstalled=true;

    // Captura evita que sobreviva ningún listener de refresh de versiones anteriores.
    for(const el of controls){
      el.addEventListener('change',ev=>{
        ev.stopImmediatePropagation();
        refreshV132();
      },true);
    }
    search.addEventListener('input',ev=>{
      ev.stopImmediatePropagation();
      clearTimeout(searchTimer);
      searchTimer=setTimeout(refreshV132,120);
    },true);
    clear.addEventListener('click',ev=>{
      ev.preventDefault();
      ev.stopImmediatePropagation();
      for(const el of controls)el.value='all';
      search.value='';
      state.activeSeries=null;
      allIssuesPromise=allIssues?Promise.resolve(allIssues):null;
      refreshV132();
    },true);
  }

  const baseBind=typeof bind==='function'?bind:null;
  if(baseBind){
    bind=function(...args){
      const r=baseBind.apply(this,args);
      installBindings();
      return r;
    };
  }

  function waitForInit(){
    installBindings();
    if(!bindingsInstalled)setTimeout(waitForInit,100);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',waitForInit,{once:true});
  else waitForInit();
})();
