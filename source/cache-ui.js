/* Marvel Lector v1.2.7 — caché Marvel no destructiva + reintento de no resueltos */
(() => {
  const ACTIVE_RESOLVER_VERSION=5;
  const UI_CACHE_VERSION=2;
  const UI_META_CONCURRENCY=3;
  const BACKGROUND_PREFETCH_LIMIT=8;
  const NEGATIVE_RETRY_AGE=2*60*1000;
  const CONFIRMED_UNAVAILABLE_AGE=7*24*60*60*1000;
  let uiObserver=null;
  let uiMetaActive=0;
  let jobSeq=0;
  const uiJobs=[];
  const uiPending=new Map();

  function ageOf(m){
    if(!m?.checkedAt)return Infinity;
    const t=new Date(m.checkedAt).getTime();
    return Number.isFinite(t)?Date.now()-t:Infinity;
  }
  function isPositiveMeta(m){return Boolean(m?.available&&m?.smartLink&&m?.issueUrl)}
  function isConfirmedUnavailable(m){return Boolean(m?.issueUrl&&m?.reason==='reader-unavailable')}

  // Un Smart Link ya resuelto es un dato positivo y se conserva aunque proceda
  // de la versión anterior. Los negativos ambiguos duran solo dos minutos.
  isFreshMeta=m=>{
    if(!m)return false;
    const age=ageOf(m);
    if(isPositiveMeta(m))return age<META_MAX_AGE;
    if(Number(m.resolverVersion)!==ACTIVE_RESOLVER_VERSION||Number(m.uiCacheVersion)!==UI_CACHE_VERSION)return false;
    if(isConfirmedUnavailable(m))return age<CONFIRMED_UNAVAILABLE_AGE;
    return age<NEGATIVE_RETRY_AGE;
  };

  function cachedCover(id){return state.marvel.get(Number(id))?.coverUrl||''}

  // El estado visual nunca degrada un Smart Link conocido a gris solo porque
  // toque revalidarlo. Si ya funcionó, se muestra como disponible.
  unlimitedState=function(m){
    if(isPositiveMeta(m))return{label:'Unlimited ✓',cls:'available'};
    if(isConfirmedUnavailable(m)&&isFreshMeta(m))return{label:'Sin Unlimited',cls:'unavailable'};
    if(m?.reason==='possible-mismatch'&&isFreshMeta(m))return{label:'Coincidencia dudosa',cls:'unresolved'};
    if(m?.reason==='drn-unavailable'&&isFreshMeta(m))return{label:'Unlimited · enlace pendiente',cls:'unresolved'};
    if(m&&isFreshMeta(m))return{label:'No identificado',cls:'unresolved'};
    return{label:'Unlimited · comprobando',cls:'pending-meta'};
  };
  metaBadge=function(id){
    const st=unlimitedState(state.marvel.get(Number(id)));
    return `<span class="badge marvel-state ${st.cls}" data-meta-badge>${st.label}</span>`;
  };

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
    const now=new Date().toISOString();
    const incomingPositive=isPositiveMeta(data);
    const oldPositive=isPositiveMeta(old);

    // Si ya teníamos un enlace funcional, una respuesta ambigua o un fallo
    // temporal NO puede destruirlo. Guardamos el intento para diagnóstico.
    if(oldPositive&&!incomingPositive){
      return {
        ...old,
        id:Number(id),
        checkedAt:old.checkedAt||now,
        uiCacheVersion:UI_CACHE_VERSION,
        lastCheckedAt:now,
        lastAttemptReason:data?.reason||data?.error||'unresolved',
        coverUrl:old.coverUrl||data?.coverUrl||''
      };
    }

    const merged={
      ...old,
      ...data,
      id:Number(id),
      checkedAt:now,
      uiCacheVersion:UI_CACHE_VERSION
    };
    // Nunca borrar una portada buena porque una respuesta nueva no incluya og:image.
    merged.coverUrl=data?.coverUrl||old.coverUrl||'';
    // Tampoco borrar identificadores positivos con cadenas vacías en una actualización.
    if(incomingPositive){
      merged.issueUrl=data.issueUrl||old.issueUrl||'';
      merged.sourceId=data.sourceId||old.sourceId||'';
      merged.readerId=data.readerId||old.readerId||'';
      merged.drn=data.drn||old.drn||'';
      merged.smartLink=data.smartLink||old.smartLink||'';
      merged.webUrl=data.webUrl||old.webUrl||'';
      merged.available=Boolean(merged.smartLink);
      merged.reason=merged.available?'ok':data.reason;
    }
    return merged;
  }

  async function runUiMetaJob(job){
    const x=job.x,id=Number(x.id),old=state.marvel.get(id);
    try{
      const s=state.seriesMap.get(x.s)||{};
      // mode=debug y mode=app comparten resolveAppMeta en el Worker estable.
      // Se solicita JSON para poder pintar portada + estado sin navegar fuera.
      const r=await fetch(marvelQuery(x,s,'debug'),{cache:'no-store',headers:{Accept:'application/json'}});
      if(!r.ok)throw new Error(`Marvel ${r.status}`);
      const data=await r.json(),m=mergeMeta(id,data);
      state.marvel.set(id,m);
      await DB.put('marvel',m);
      updateRenderedMeta(id,m);
      job.resolve(m);
    }catch(e){
      console.warn('Marvel visible meta',id,e);
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

  fetchMarvelMeta=async function(x,force=false){return enqueueUiMeta(x,0,force)};

  hydrateIssueMeta=async function(id){
    const n=Number(id),cached=state.marvel.get(n);
    if(cached)updateRenderedMeta(n,cached);
    if(isFreshMeta(cached))return cached;
    const x=await findIssueById(n);if(!x)return null;
    return enqueueUiMeta(x,0,false);
  };

  // Cada render: los primeros elementos se hidratan inmediatamente. El observer
  // solo se usa para lo que queda por debajo, por lo que Safari no puede dejar
  // toda la vista inicial eternamente en placeholders.
  observeVisibleCards=function(root){
    if(uiObserver){uiObserver.disconnect();uiObserver=null}
    const cards=$$(root+' .issue');
    for(const el of cards){
      const id=Number(el.dataset.id),cached=state.marvel.get(id);
      if(cached)updateRenderedMeta(id,cached);
    }
    cards.slice(0,18).forEach(el=>hydrateIssueMeta(Number(el.dataset.id)));
    if(!('IntersectionObserver'in window))return;
    uiObserver=new IntersectionObserver(entries=>{
      for(const e of entries){
        if(!e.isIntersecting)continue;
        const id=Number(e.target.dataset.id);
        uiObserver?.unobserve(e.target);
        hydrateIssueMeta(id);
      }
    },{rootMargin:'700px 0px'});
    cards.slice(18).forEach(el=>uiObserver.observe(el));
  };

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
