/* Marvel Lector v1.2.6 — hidratación visible prioritaria y resolver estable */
(() => {
  const ACTIVE_RESOLVER_VERSION=5;
  const UI_META_CONCURRENCY=3;
  const BACKGROUND_PREFETCH_LIMIT=8;
  let uiObserver=null;
  let uiMetaActive=0;
  let jobSeq=0;
  const uiJobs=[];
  const uiPending=new Map();

  // La interfaz solo considera fresca metadata del Worker estable actual.
  // Las portadas antiguas pueden seguir mostrándose aunque sus metadatos
  // necesiten revalidación.
  isFreshMeta=m=>Boolean(
    m&&Number(m.resolverVersion)===ACTIVE_RESOLVER_VERSION&&m.checkedAt&&
    Date.now()-new Date(m.checkedAt).getTime()<META_MAX_AGE
  );

  function cachedCover(id){return state.marvel.get(Number(id))?.coverUrl||''}

  // Mantener cualquier portada ya conocida al reconstruir tarjetas por filtros.
  card=function(issue,collection=false){
    let s=state.seriesMap.get(issue.s)||{},title=s.es||s.original||'Serie',translated=s.es&&s.es!==s.original,
      st=progressStatus(issue.id),exact=(issue.pc||'').startsWith('Fecha de venta GCD')&&!String(issue.pc||'').includes('incierta'),
      coverUrl=cachedCover(issue.id);
    let statusClass=st==='read'?'read':st==='skipped-reprint'?'skipped':st==='new-material'?'partial':'';
    let cover=collection?'':`<div class="cover-slot" data-cover-slot>${coverUrl?`<img class="issue-cover" loading="lazy" decoding="async" src="${esc(coverUrl)}" alt="">`:'<div class="cover-placeholder">M</div>'}</div>`;
    return `<article class="issue ${statusClass} ${collection?'collection':''}" data-id="${issue.id}" data-order="${issue.o}" data-series="${issue.s}"><button class="check" aria-label="${st==='pending'?'Marcar leído':'Cambiar estado'}">${statusIcon(st)}</button>${cover}<div class="issue-main"><div class="issue-title">${esc(title)} <span class="muted">#${esc(issue.n||'[s/n]')}</span></div>${translated?`<div class="issue-original">${esc(s.original)}</div>`:''}<div class="issue-meta">${collection?`<span class="badge">${esc(issue.tg||'Edición')}</span>`:`<span class="badge ${issue.c}">${esc(state.meta.labels.content[issue.c]||issue.c)}</span><span class="badge">${esc(state.meta.labels.era[issue.e]||issue.e)}</span>${st!=='pending'?`<span class="badge progress-badge ${st}">${esc(statusText(st))}</span>`:''}${metaBadge(issue.id)}`}</div></div><div class="order-col"><div class="order-num">${collection?'Ed.':'#'+fmt.format(issue.o)}</div><div class="issue-date ${exact?'':'approx'}">${esc(prettyDate(issue.d))}${exact?'':' ≈'}</div></div></article>`;
  };

  function mergeMeta(id,data){
    const old=state.marvel.get(Number(id))||{};
    return {...old,id:Number(id),checkedAt:new Date().toISOString(),...data};
  }

  async function runUiMetaJob(job){
    const x=job.x,id=Number(x.id),old=state.marvel.get(id);
    try{
      const s=state.seriesMap.get(x.s)||{};
      // mode=debug usa resolveAppMeta(): el resolver estable del botón que abre
      // Marvel Unlimited. No usa el resolver masivo del diagnóstico.
      const r=await fetch(marvelQuery(x,s,'debug'),{cache:'no-store',headers:{Accept:'application/json'}});
      if(!r.ok)throw new Error(`Marvel ${r.status}`);
      const data=await r.json(),m=mergeMeta(id,data);
      state.marvel.set(id,m);
      await DB.put('marvel',m);
      updateRenderedMeta(id,m);
      job.resolve(m);
    }catch(e){
      console.warn('Marvel visible meta',id,e);
      // Nunca sustituir una portada/Smart Link válido por un error transitorio.
      if(old)updateRenderedMeta(id,old);
      job.resolve(old||null);
    }finally{
      uiPending.delete(id);
      uiMetaActive--;
      drainUiMetaQueue();
    }
  }

  function drainUiMetaQueue(){
    while(uiMetaActive<UI_META_CONCURRENCY&&uiJobs.length){
      // priority 0 = visible/interactivo; priority 1 = precarga.
      let best=0;
      for(let i=1;i<uiJobs.length;i++){
        if(uiJobs[i].priority<uiJobs[best].priority||
          (uiJobs[i].priority===uiJobs[best].priority&&uiJobs[i].seq<uiJobs[best].seq))best=i;
      }
      const job=uiJobs.splice(best,1)[0];
      uiMetaActive++;
      runUiMetaJob(job);
    }
  }

  function enqueueUiMeta(x,priority=0,force=false){
    const id=Number(x.id),cached=state.marvel.get(id);
    if(!force&&isFreshMeta(cached)){
      updateRenderedMeta(id,cached);
      return Promise.resolve(cached);
    }
    const existing=uiPending.get(id);
    if(existing){
      // Si estaba en precarga y ahora es visible, subir su prioridad.
      if(priority<existing.priority)existing.priority=priority;
      drainUiMetaQueue();
      return existing.promise;
    }
    let resolve;
    const promise=new Promise(r=>resolve=r);
    const job={x,priority,seq:jobSeq++,resolve,promise};
    uiPending.set(id,job);
    uiJobs.push(job);
    drainUiMetaQueue();
    return promise;
  }

  // Todas las llamadas UI (ficha, modo lectura, tarjetas) usan el resolver estable.
  fetchMarvelMeta=async function(x,force=false){return enqueueUiMeta(x,0,force)};

  hydrateIssueMeta=async function(id){
    const n=Number(id),cached=state.marvel.get(n);
    if(cached)updateRenderedMeta(n,cached);
    if(isFreshMeta(cached))return cached;
    const x=await findIssueById(n);if(!x)return null;
    return enqueueUiMeta(x,0,false);
  };

  // Cada render crea observación nueva. No se reutilizan nodos de una era/filtro
  // anterior, que era la causa de tarjetas nuevas que nunca llegaban a hidratarse.
  observeVisibleCards=function(root){
    if(uiObserver){uiObserver.disconnect();uiObserver=null}
    const cards=$$(root+' .issue');
    for(const el of cards){
      const id=Number(el.dataset.id),cached=state.marvel.get(id);
      if(cached)updateRenderedMeta(id,cached);
    }
    if(!('IntersectionObserver'in window)){
      cards.slice(0,24).forEach(el=>hydrateIssueMeta(Number(el.dataset.id)));
      return;
    }
    uiObserver=new IntersectionObserver(entries=>{
      for(const e of entries){
        if(!e.isIntersecting)continue;
        const id=Number(e.target.dataset.id);
        uiObserver?.unobserve(e.target);
        hydrateIssueMeta(id);
      }
    },{rootMargin:'650px 0px'});
    cards.forEach(el=>uiObserver.observe(el));
  };

  // La precarga conserva su utilidad, pero va siempre detrás de lo que el usuario
  // está viendo. Nunca puede ocupar la cola por delante de una portada visible.
  prefetchUpcoming=async function(count=PREFETCH_COUNT){
    const limit=Math.min(Number(count)||0,BACKGROUND_PREFETCH_LIMIT);
    if(limit<=0)return;
    let candidates=[];
    if(Array.isArray(state.filtered)&&state.filtered.length){
      candidates=state.filtered.filter(x=>!isResolved(x.id)).slice(0,limit);
    }else{
      const idx=await ensureSearch();
      for(const r of idx){
        if(isResolved(r[1]))continue;
        const x=await findIssueById(r[1]);if(x)candidates.push(x);
        if(candidates.length>=limit)break;
      }
    }
    for(const x of candidates){
      if(!isFreshMeta(state.marvel.get(Number(x.id))))enqueueUiMeta(x,1,false);
    }
  };

  function repaintVisible(){
    document.querySelectorAll('.issue[data-id]').forEach(el=>{
      const id=Number(el.dataset.id),m=state.marvel.get(id);if(m)updateRenderedMeta(id,m);
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>requestAnimationFrame(repaintVisible));
  else requestAnimationFrame(repaintVisible);
})();
