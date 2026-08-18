/* Marvel Lector v1.2.33 — biblioteca en memoria + pantalla de compilación inicial */
(() => {
  let refreshTicket=0;
  let allIssues=null;
  let allIssuesPromise=null;
  let bindingsInstalled=false;
  let searchTimer=null;
  let bootFinished=false;
  const issueDecade=new Map();

  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const normalize=v=>String(v??'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLocaleLowerCase('es')
    .replace(/[^a-z0-9.]+/g,' ')
    .trim();
  const tokensOf=v=>normalize(v).split(/\s+/).filter(Boolean);

  function bootEls(){return{
    root:document.getElementById('bootScreen'),
    bar:document.getElementById('bootBar'),
    percent:document.getElementById('bootPercent'),
    stage:document.getElementById('bootStage'),
    detail:document.getElementById('bootDetail'),
    retry:document.getElementById('bootRetry')
  }}
  function bootProgress(percent,stage,detail=''){
    const e=bootEls(),pct=Math.max(0,Math.min(100,Math.round(percent)));
    if(e.root){e.root.hidden=false;e.root.classList.remove('boot-error','boot-complete');e.root.setAttribute('aria-busy','true')}
    if(e.bar)e.bar.style.width=pct+'%';
    if(e.percent)e.percent.textContent=pct+'%';
    if(e.stage&&stage)e.stage.textContent=stage;
    if(e.detail)e.detail.textContent=detail;
    if(e.retry)e.retry.hidden=true;
  }
  function bootError(err){
    const e=bootEls();
    if(e.root){e.root.hidden=false;e.root.classList.add('boot-error');e.root.setAttribute('aria-busy','false')}
    if(e.stage)e.stage.textContent='No se pudo preparar la biblioteca';
    if(e.detail)e.detail.textContent=String(err?.message||err||'Error desconocido');
    if(e.retry)e.retry.hidden=false;
  }
  async function finishBoot(){
    if(bootFinished)return;
    bootFinished=true;
    bootProgress(100,'Biblioteca preparada','51.002 cómics listos para buscar y filtrar');
    const e=bootEls();
    if(e.root)e.root.classList.add('boot-complete');
    await sleep(260);
    if(e.root){e.root.hidden=true;e.root.setAttribute('aria-busy','false')}
    document.body.classList.remove('booting');
  }

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
      const total=Number(state.meta?.mainCount)||chunks.reduce((n,c)=>n+Number(c.count||0),0)||51002;
      let loadedRows=0,completedChunks=0;
      bootProgress(7,'Preparando biblioteca',`0 / ${fmt.format(total)} cómics`);
      const loaded=await Promise.all(chunks.map(async c=>{
        const rows=await loadPrincipalChunk(c);
        for(const x of rows)issueDecade.set(Number(x.id),String(c.id));
        loadedRows+=rows.length;
        completedChunks++;
        const pct=7+(loadedRows/total)*83;
        const decade=String(c.id)==='sin-fecha'?'sin fecha':`${c.id}–${Number(c.id)+9}`;
        bootProgress(pct,'Cargando biblioteca',`${fmt.format(loadedRows)} / ${fmt.format(total)} cómics · ${completedChunks}/${chunks.length} bloques · ${decade}`);
        return rows;
      }));
      bootProgress(93,'Ordenando cronología',`${fmt.format(loadedRows)} cómics cargados`);
      const flat=loaded.flat();
      flat.sort((a,b)=>Number(a.o)-Number(b.o));
      if(total&&flat.length!==total)throw new Error(`Biblioteca incompleta: ${flat.length}/${total}`);
      bootProgress(97,'Preparando búsqueda y filtros',`${fmt.format(flat.length)} cómics indexados en memoria`);
      allIssues=flat;
      return allIssues;
    })().catch(e=>{allIssuesPromise=null;bootError(e);throw e});
    return allIssuesPromise;
  }

  function issueMatchesText(x,tokens){
    if(!tokens.length)return true;
    const s=state.seriesMap.get(Number(x.s))||{};
    const n=String(x.n??'');
    const hay=normalize(`${s.original||''} ${s.es||''} ${n} #${n} ${x.t||''}`);
    return tokens.every(t=>hay.includes(t));
  }

  async function refreshV133(){
    const ticket=++refreshTicket;
    const search=document.getElementById('searchInput');
    const status=document.getElementById('statusFilter');
    const content=document.getElementById('contentFilter');
    const era=document.getElementById('eraFilter');
    const decade=document.getElementById('decadeFilter');
    const count=document.getElementById('resultCount');
    if(!search||!status||!content||!era||!decade)return;

    state.page=0;
    if(count&&!allIssues)count.textContent='Preparando biblioteca…';

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
      if(!bootFinished)await finishBoot();
    }catch(e){
      if(ticket!==refreshTicket)return;
      console.error('Búsqueda/filtros v1.2.33',e);
      if(count)count.textContent='Error al cargar la biblioteca';
      const list=document.getElementById('issueList');
      if(list&&!state.filtered?.length)list.innerHTML='<div class="notice">No se pudo cargar la biblioteca completa. Usa Reintentar en la pantalla de preparación.</div>';
    }
  }

  // Sustituimos la ruta antigua antes de que init() termine sus cargas asíncronas.
  refresh=refreshV133;
  selectInitialDecade=async function(){
    const decade=document.getElementById('decadeFilter');
    if(decade)decade.value='all';
    bootProgress(3,'Iniciando Marvel Lector','Preparando datos locales…');
    await refreshV133();
  };

  function retryBoot(){
    allIssuesPromise=null;
    bootFinished=false;
    document.body.classList.add('booting');
    bootProgress(3,'Reintentando preparación','Comprobando los bloques pendientes…');
    refreshV133();
  }

  function installBindings(){
    if(bindingsInstalled)return;
    const ids=['statusFilter','contentFilter','eraFilter','decadeFilter'];
    const controls=ids.map(id=>document.getElementById(id));
    const search=document.getElementById('searchInput');
    const clear=document.getElementById('clearFilters');
    const retry=document.getElementById('bootRetry');
    if(controls.some(x=>!x)||!search||!clear)return;
    bindingsInstalled=true;

    // Captura evita que sobreviva ningún listener de refresh de versiones anteriores.
    for(const el of controls){
      el.addEventListener('change',ev=>{
        ev.stopImmediatePropagation();
        refreshV133();
      },true);
    }
    search.addEventListener('input',ev=>{
      ev.stopImmediatePropagation();
      clearTimeout(searchTimer);
      searchTimer=setTimeout(refreshV133,120);
    },true);
    clear.addEventListener('click',ev=>{
      ev.preventDefault();
      ev.stopImmediatePropagation();
      for(const el of controls)el.value='all';
      search.value='';
      state.activeSeries=null;
      refreshV133();
    },true);
    if(retry)retry.onclick=retryBoot;
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
  bootProgress(1,'Iniciando Marvel Lector','Preparando biblioteca…');
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',waitForInit,{once:true});
  else waitForInit();
})();
