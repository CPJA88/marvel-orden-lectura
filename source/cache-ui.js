/* Marvel Lector v1.2.19 — portadas GCD + Marvel API oficial */
(() => {
  const ACTIVE_RESOLVER_VERSION=9;
  const UI_CACHE_VERSION=7;
  const UI_META_CONCURRENCY=1;
  const BACKGROUND_PREFETCH_LIMIT=0;
  const NEGATIVE_RETRY_AGE=5*1000;
  const CONFIRMED_UNAVAILABLE_AGE=7*24*60*60*1000;
  const API_CONFIG_RETRY_AGE=30*1000;
  const API_NO_MATCH_RETRY_AGE=10*60*1000;
  const REQUEST_GAP=350;
  const MAX_FAILURE_RETRIES=1;
  const GCD_COVER_MAX_AGE=30*24*60*60*1000;
  const GCD_COVER_GAP=350;
  let uiObserver=null;
  let active=0;
  let seq=0;
  const queue=[];
  const pending=new Map();
  const retryCounts=new Map();

  let coverActive=false;
  const coverQueue=[];
  const coverPending=new Map();

  function ageOf(m,key='checkedAt'){
    if(!m?.[key])return Infinity;
    const t=new Date(m[key]).getTime();
    return Number.isFinite(t)?Date.now()-t:Infinity;
  }
  function isPositiveMeta(m){return Boolean(m?.available&&m?.smartLink&&m?.issueUrl)}
  function isConfirmedUnavailable(m){return Boolean(m?.issueUrl&&m?.reason==='reader-unavailable')}
  function isTransientFailure(m){return Boolean(m&&m.reason==='resolver-error')}

  isFreshMeta=m=>{
    if(!m)return false;
    const age=ageOf(m);
    if(isPositiveMeta(m))return age<META_MAX_AGE;
    if(Number(m.resolverVersion)!==ACTIVE_RESOLVER_VERSION||Number(m.uiCacheVersion)!==UI_CACHE_VERSION)return false;
    if(isConfirmedUnavailable(m))return age<CONFIRMED_UNAVAILABLE_AGE;
    if(m.reason==='api-not-configured'||m.reason==='api-auth-error')return age<API_CONFIG_RETRY_AGE;
    if(m.reason==='api-no-match')return age<API_NO_MATCH_RETRY_AGE;
    return age<NEGATIVE_RETRY_AGE;
  };

  unlimitedState=function(m){
    if(isPositiveMeta(m))return{label:'Unlimited ✓',cls:'available'};
    if(isConfirmedUnavailable(m)&&isFreshMeta(m))return{label:'Sin Unlimited',cls:'unavailable'};
    if(m?.reason==='drn-unavailable')return{label:'Unlimited · enlace pendiente',cls:'unresolved'};
    if(m?.reason==='api-auth-error')return{label:'Unlimited · error API',cls:'unresolved'};
    if(m?.reason==='api-not-configured')return{label:'Unlimited · sin comprobar',cls:'pending-meta'};
    if(m?.reason==='api-no-match')return{label:'Unlimited · sin comprobar',cls:'pending-meta'};
    if(isTransientFailure(m)&&ageOf(m)<20*1000)return{label:'Unlimited · comprobando',cls:'pending-meta'};
    return{label:'Unlimited · comprobando',cls:'pending-meta'};
  };
  metaBadge=function(id){
    const st=unlimitedState(state.marvel.get(Number(id)));
    return `<span class="badge marvel-state ${st.cls}" data-meta-badge>${st.label}</span>`;
  };

  function cachedCover(id){return state.marvel.get(Number(id))?.coverUrl||''}

  card=function(issue,collection=false){
    let s=state.seriesMap.get(issue.s)||{},title=s.es||s.original||'Serie',translated=s.es&&s.es!==s.original,
      st=progressStatus(issue.id),exact=(issue.pc||'').startsWith('Fecha de venta GCD')&&!String(issue.pc||'').includes('incierta'),
      coverUrl=cachedCover(issue.id);
    let statusClass=st==='read'?'read':st==='skipped-reprint'?'skipped':st==='new-material'?'partial':'';
    let cover=collection?'':`<div class="cover-slot" data-cover-slot>${coverUrl?`<img class="issue-cover" loading="lazy" decoding="async" src="${esc(coverUrl)}" alt="">`:'<div class="cover-placeholder">M</div>'}</div>`;
    return `<article class="issue ${statusClass} ${collection?'collection':''}" data-id="${issue.id}" data-order="${issue.o}" data-series="${issue.s}"><button class="check" aria-label="${st==='pending'?'Marcar leído':'Cambiar estado'}">${statusIcon(st)}</button>${cover}<div class="issue-main"><div class="issue-title">${esc(title)} <span class="muted">#${esc(issue.n||'[s/n]')}</span></div>${translated?`<div class="issue-original">${esc(s.original)}</div>`:''}<div class="issue-meta">${collection?`<span class="badge">${esc(issue.tg||'Edición')}</span>`:`<span class="badge ${issue.c}">${esc(state.meta.labels.content[issue.c]||issue.c)}</span><span class="badge">${esc(state.meta.labels.era[issue.e]||issue.e)}</span>${st!=='pending'?`<span class="badge progress-badge ${st}">${esc(statusText(st))}</span>`:''}${metaBadge(issue.id)}`}</div></div><div class="order-col"><div class="order-num">${collection?'Ed.':'#'+fmt.format(issue.o)}</div><div class="issue-date ${exact?'':'approx'}">${esc(prettyDate(issue.d))}${exact?'':' ≈'}</div></div></article>`;
  };

  updateRenderedMeta=function(id,m){
    $$(`[data-id="${id}"]`).forEach(el=>{
      const b=el.querySelector('[data-meta-badge]')||el.querySelector('.marvel-state');
      if(b){const st=unlimitedState(m);b.className=`badge marvel-state ${st.cls}`;b.textContent=st.label}
      const slot=el.querySelector('[data-cover-slot]');
      if(slot&&m?.coverUrl&&!slot.querySelector('img'))slot.innerHTML=`<img class="issue-cover" loading="lazy" decoding="async" src="${esc(m.coverUrl)}" alt="">`;
    });
  };

  function mergeMeta(id,data){
    const old=state.marvel.get(Number(id))||{},now=new Date().toISOString();
    const oldPositive=isPositiveMeta(old),incomingPositive=isPositiveMeta(data);
    if(oldPositive&&!incomingPositive){
      return {...old,id:Number(id),uiCacheVersion:UI_CACHE_VERSION,lastCheckedAt:now,lastAttemptReason:data?.reason||data?.error||'unresolved',coverUrl:old.coverUrl||data?.coverUrl||''};
    }
    const merged={...old,...data,id:Number(id),checkedAt:now,uiCacheVersion:UI_CACHE_VERSION};
    if(!data?.coverUrl&&old.coverUrl)merged.coverUrl=old.coverUrl;
    if(!data?.smartLink&&old.smartLink&&oldPositive){
      merged.available=true;merged.smartLink=old.smartLink;merged.issueUrl=old.issueUrl;merged.sourceId=old.sourceId;merged.readerId=old.readerId;merged.drn=old.drn;merged.reason='ok';
    }
    return merged;
  }

  function coverIsFresh(m){return Boolean(m?.coverUrl)||ageOf(m,'gcdCoverCheckedAt')<GCD_COVER_MAX_AGE}
  function drainCoverQueue(){
    if(coverActive||!coverQueue.length)return;
    coverActive=true;
    const job=coverQueue.shift();
    (async()=>{
      const id=job.id,old=state.marvel.get(id)||{};
      try{
        const r=await fetch(`/api/gcd/cover?id=${encodeURIComponent(id)}`,{cache:'no-store',headers:{Accept:'application/json'}});
        if(!r.ok)throw new Error(`GCD ${r.status}`);
        const data=await r.json(),now=new Date().toISOString();
        const m={...old,id,gcdCoverCheckedAt:now,coverSource:data.coverUrl?'gcd-api':old.coverSource||'',coverUrl:data.coverUrl||old.coverUrl||''};
        state.marvel.set(id,m);await DB.put('marvel',m);updateRenderedMeta(id,m);job.resolve(m);
      }catch(e){
        console.warn('GCD cover',id,e);job.resolve(old||null);
      }finally{
        coverPending.delete(id);
        setTimeout(()=>{coverActive=false;drainCoverQueue()},GCD_COVER_GAP);
      }
    })();
  }
  function ensureGcdCover(id){
    const n=Number(id),cached=state.marvel.get(n);
    if(coverIsFresh(cached)){if(cached)updateRenderedMeta(n,cached);return Promise.resolve(cached||null)}
    if(coverPending.has(n))return coverPending.get(n);
    let resolve;const promise=new Promise(r=>resolve=r);
    coverPending.set(n,promise);coverQueue.push({id:n,resolve});drainCoverQueue();return promise;
  }

  function scheduleRetry(x,m,priority){
    const id=Number(x.id);
    if(priority!==0||!isTransientFailure(m)){retryCounts.delete(id);return}
    const done=retryCounts.get(id)||0;
    if(done>=MAX_FAILURE_RETRIES)return;
    retryCounts.set(id,done+1);
    setTimeout(()=>{
      const current=state.marvel.get(id);
      if(isPositiveMeta(current)||isConfirmedUnavailable(current))return;
      enqueue(x,0,true);
    },1800);
  }

  async function runJob(job){
    const x=job.x,id=Number(x.id),old=state.marvel.get(id);
    try{
      const s=state.seriesMap.get(x.s)||{};
      const r=await fetch(marvelQuery(x,s,'meta'),{cache:'no-store',headers:{Accept:'application/json'}});
      if(!r.ok)throw new Error(`Marvel ${r.status}`);
      const data=await r.json(),m=mergeMeta(id,data);
      state.marvel.set(id,m);await DB.put('marvel',m);updateRenderedMeta(id,m);scheduleRetry(x,m,job.priority);job.resolve(m);
    }catch(e){
      console.warn('Marvel UI meta',id,e);
      if(old)updateRenderedMeta(id,old);
      const fallback=old||{id,checkedAt:new Date().toISOString(),resolverVersion:ACTIVE_RESOLVER_VERSION,uiCacheVersion:UI_CACHE_VERSION,available:false,reason:'resolver-error'};
      if(!old){state.marvel.set(id,fallback);await DB.put('marvel',fallback);updateRenderedMeta(id,fallback)}
      scheduleRetry(x,fallback,job.priority);job.resolve(old||fallback);
    }finally{
      pending.delete(id);
      await new Promise(r=>setTimeout(r,REQUEST_GAP));
      active--;drain();
    }
  }
  function drain(){
    while(active<UI_META_CONCURRENCY&&queue.length){
      let best=0;
      for(let i=1;i<queue.length;i++)if(queue[i].priority<queue[best].priority||(queue[i].priority===queue[best].priority&&queue[i].seq<queue[best].seq))best=i;
      const job=queue.splice(best,1)[0];active++;runJob(job);
    }
  }
  function enqueue(x,priority=0,force=false){
    const id=Number(x.id),cached=state.marvel.get(id);
    if(!force&&isFreshMeta(cached)){updateRenderedMeta(id,cached);return Promise.resolve(cached)}
    const existing=pending.get(id);
    if(existing){if(priority<existing.priority)existing.priority=priority;return existing.promise}
    let resolve;const promise=new Promise(r=>resolve=r),job={x,priority,seq:seq++,resolve,promise};
    pending.set(id,job);queue.push(job);drain();return promise;
  }

  fetchMarvelMeta=async function(x,force=false){ensureGcdCover(Number(x.id));return enqueue(x,0,force)};
  hydrateIssueMeta=async function(id){
    const n=Number(id),cached=state.marvel.get(n);if(cached)updateRenderedMeta(n,cached);
    ensureGcdCover(n);
    if(isFreshMeta(cached))return cached;
    const x=await findIssueById(n);if(!x)return null;return enqueue(x,0,false);
  };

  observeVisibleCards=function(root){
    if(uiObserver){uiObserver.disconnect();uiObserver=null}
    const cards=$$(root+' .issue');
    for(const el of cards){const id=Number(el.dataset.id),m=state.marvel.get(id);if(m)updateRenderedMeta(id,m)}
    cards.slice(0,10).forEach(el=>hydrateIssueMeta(Number(el.dataset.id)));
    if(!('IntersectionObserver'in window))return;
    uiObserver=new IntersectionObserver(entries=>{
      for(const e of entries){if(!e.isIntersecting)continue;const id=Number(e.target.dataset.id);uiObserver?.unobserve(e.target);hydrateIssueMeta(id)}
    },{rootMargin:'500px 0px'});
    cards.slice(10).forEach(el=>uiObserver.observe(el));
  };

  prefetchUpcoming=async function(){return};

  function repaint(){document.querySelectorAll('.issue[data-id]').forEach(el=>{const id=Number(el.dataset.id),m=state.marvel.get(id);if(m)updateRenderedMeta(id,m);ensureGcdCover(id)})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>requestAnimationFrame(repaint));else requestAnimationFrame(repaint);
})();
