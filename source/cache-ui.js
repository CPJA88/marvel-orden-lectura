/* Marvel Lector v1.2.22 — metadata estructurada + portadas Marvel por sourceId */
(() => {
  const ACTIVE_RESOLVER_VERSION=13;
  const UI_CACHE_VERSION=9;
  const UI_META_CONCURRENCY=1;
  const REQUEST_GAP=650;
  const NEGATIVE_RETRY_AGE=15*1000;
  const CONFIRMED_UNAVAILABLE_AGE=7*24*60*60*1000;
  let uiObserver=null,active=0,seq=0;
  const queue=[],pending=new Map();

  function ageOf(m){
    const t=new Date(m?.checkedAt||0).getTime();
    return Number.isFinite(t)?Date.now()-t:Infinity;
  }
  function positive(m){return Boolean(m?.smartLink)}
  function confirmedUnavailable(m){return Boolean(m?.issueUrl&&m?.reason==='reader-unavailable')}
  function sourceIdOf(m){
    if(m?.sourceId)return String(m.sourceId);
    const hit=String(m?.issueUrl||'').match(/\/comics\/issue\/(\d+)/i);
    return hit?.[1]||'';
  }
  function coverFor(id,m){
    const sid=sourceIdOf(m);
    if(sid)return `/api/marvel/cover?sourceId=${encodeURIComponent(sid)}`;
    if(/^\/api\/marvel\/cover\?sourceId=/i.test(String(m?.coverUrl||'')))return m.coverUrl;
    return `/api/gcd/cover-image?id=${encodeURIComponent(Number(id))}`;
  }

  isFreshMeta=m=>{
    if(!m)return false;
    if(positive(m))return true;
    if(Number(m.resolverVersion)!==ACTIVE_RESOLVER_VERSION||Number(m.uiCacheVersion)!==UI_CACHE_VERSION)return false;
    if(confirmedUnavailable(m))return ageOf(m)<CONFIRMED_UNAVAILABLE_AGE;
    return ageOf(m)<NEGATIVE_RETRY_AGE;
  };

  unlimitedState=function(m){
    if(positive(m))return{label:'Unlimited ✓',cls:'available'};
    if(confirmedUnavailable(m)&&isFreshMeta(m))return{label:'Sin Unlimited',cls:'unavailable'};
    if(m?.reason==='drn-unavailable')return{label:'Unlimited · enlace pendiente',cls:'unresolved'};
    if(m?.reason==='resolver-error')return{label:'Unlimited · reintentando',cls:'pending-meta'};
    return{label:'Unlimited · sin comprobar',cls:'pending-meta'};
  };
  metaBadge=function(id){
    const st=unlimitedState(state.marvel.get(Number(id)));
    return `<span class="badge marvel-state ${st.cls}" data-meta-badge>${st.label}</span>`;
  };

  function coverMarkup(issue){
    const src=coverFor(issue.id,state.marvel.get(Number(issue.id)));
    return `<div class="cover-slot" data-cover-slot><img class="issue-cover" loading="lazy" decoding="async" src="${esc(src)}" alt=""></div>`;
  }

  card=function(issue,collection=false){
    let s=state.seriesMap.get(issue.s)||{},title=s.es||s.original||'Serie',translated=s.es&&s.es!==s.original,
      st=progressStatus(issue.id),exact=(issue.pc||'').startsWith('Fecha de venta GCD')&&!String(issue.pc||'').includes('incierta');
    let statusClass=st==='read'?'read':st==='skipped-reprint'?'skipped':st==='new-material'?'partial':'';
    return `<article class="issue ${statusClass} ${collection?'collection':''}" data-id="${issue.id}" data-order="${issue.o}" data-series="${issue.s}"><button class="check" aria-label="${st==='pending'?'Marcar leído':'Cambiar estado'}">${statusIcon(st)}</button>${collection?'':coverMarkup(issue)}<div class="issue-main"><div class="issue-title">${esc(title)} <span class="muted">#${esc(issue.n||'[s/n]')}</span></div>${translated?`<div class="issue-original">${esc(s.original)}</div>`:''}<div class="issue-meta">${collection?`<span class="badge">${esc(issue.tg||'Edición')}</span>`:`<span class="badge ${issue.c}">${esc(state.meta.labels.content[issue.c]||issue.c)}</span><span class="badge">${esc(state.meta.labels.era[issue.e]||issue.e)}</span>${st!=='pending'?`<span class="badge progress-badge ${st}">${esc(statusText(st))}</span>`:''}${metaBadge(issue.id)}`}</div></div><div class="order-col"><div class="order-num">${collection?'Ed.':'#'+fmt.format(issue.o)}</div><div class="issue-date ${exact?'':'approx'}">${esc(prettyDate(issue.d))}${exact?'':' ≈'}</div></div></article>`;
  };

  function installImage(slot,id,m){
    if(!slot)return;
    const src=coverFor(id,m),old=slot.querySelector('img');
    if(old&&old.getAttribute('src')===src)return;
    const img=document.createElement('img');img.className='issue-cover';img.loading='lazy';img.decoding='async';img.alt='';img.src=src;
    img.onerror=()=>{const p=document.createElement('div');p.className='cover-placeholder';p.textContent='M';slot.replaceChildren(p)};
    slot.replaceChildren(img);
  }

  updateRenderedMeta=function(id,m){
    $$(`[data-id="${id}"]`).forEach(el=>{
      const b=el.querySelector('[data-meta-badge]')||el.querySelector('.marvel-state');
      if(b){const st=unlimitedState(m);b.className=`badge marvel-state ${st.cls}`;b.textContent=st.label}
      installImage(el.querySelector('[data-cover-slot]'),Number(id),m);
    });
  };

  function mergeMeta(id,data){
    const old=state.marvel.get(Number(id))||{},now=new Date().toISOString();
    if(positive(old)&&!data?.smartLink){
      const merged={...old,id:Number(id),checkedAt:old.checkedAt||now,lastCheckedAt:now,lastAttemptReason:data?.reason||data?.error||'unresolved',uiCacheVersion:UI_CACHE_VERSION};
      if(data?.sourceId&&!merged.sourceId)merged.sourceId=data.sourceId;
      if(data?.issueUrl&&!merged.issueUrl)merged.issueUrl=data.issueUrl;
      if(data?.readerId&&!merged.readerId)merged.readerId=data.readerId;
      return merged;
    }
    const merged={...old,...data,id:Number(id),checkedAt:now,uiCacheVersion:UI_CACHE_VERSION};
    if(old.smartLink&&!merged.smartLink){merged.smartLink=old.smartLink;merged.available=true;merged.reason='ok'}
    if(!merged.sourceId&&old.sourceId)merged.sourceId=old.sourceId;
    return merged;
  }

  async function runJob(job){
    const x=job.x,id=Number(x.id),old=state.marvel.get(id);
    try{
      const s=state.seriesMap.get(x.s)||{},r=await fetch(marvelQuery(x,s,'meta'),{cache:'no-store',headers:{Accept:'application/json'}});
      if(!r.ok)throw new Error(`Marvel ${r.status}`);
      const data=await r.json(),m=mergeMeta(id,data);
      state.marvel.set(id,m);await DB.put('marvel',m);updateRenderedMeta(id,m);job.resolve(m);
    }catch(e){
      console.warn('Marvel metadata',id,e);
      const m=old||{id,checkedAt:new Date().toISOString(),resolverVersion:ACTIVE_RESOLVER_VERSION,uiCacheVersion:UI_CACHE_VERSION,available:false,reason:'resolver-error'};
      if(!old){state.marvel.set(id,m);await DB.put('marvel',m)}
      updateRenderedMeta(id,m);job.resolve(m);
    }finally{
      pending.delete(id);await new Promise(r=>setTimeout(r,REQUEST_GAP));active--;drain();
    }
  }
  function drain(){
    while(active<UI_META_CONCURRENCY&&queue.length){
      let best=0;for(let i=1;i<queue.length;i++)if(queue[i].priority<queue[best].priority||(queue[i].priority===queue[best].priority&&queue[i].seq<queue[best].seq))best=i;
      const job=queue.splice(best,1)[0];active++;runJob(job);
    }
  }
  function enqueue(x,priority=0,force=false){
    const id=Number(x.id),cached=state.marvel.get(id);
    if(!force&&isFreshMeta(cached)){updateRenderedMeta(id,cached);return Promise.resolve(cached)}
    const existing=pending.get(id);if(existing)return existing.promise;
    let resolve;const promise=new Promise(r=>resolve=r),job={x,priority,seq:seq++,resolve,promise};pending.set(id,job);queue.push(job);drain();return promise;
  }

  fetchMarvelMeta=async function(x,force=false){return enqueue(x,0,force)};
  hydrateIssueMeta=async function(id){
    const n=Number(id),cached=state.marvel.get(n);if(cached)updateRenderedMeta(n,cached);
    if(isFreshMeta(cached))return cached;
    const x=await findIssueById(n);if(!x)return null;return enqueue(x,0,false);
  };

  observeVisibleCards=function(root){
    if(uiObserver){uiObserver.disconnect();uiObserver=null}
    const cards=$$(root+' .issue');
    for(const el of cards){const id=Number(el.dataset.id),m=state.marvel.get(id);if(m)updateRenderedMeta(id,m)}
    cards.slice(0,6).forEach(el=>hydrateIssueMeta(Number(el.dataset.id)));
    if(!('IntersectionObserver'in window))return;
    uiObserver=new IntersectionObserver(entries=>{
      for(const e of entries){if(!e.isIntersecting)continue;const id=Number(e.target.dataset.id);uiObserver?.unobserve(e.target);hydrateIssueMeta(id)}
    },{rootMargin:'350px 0px'});
    cards.slice(6).forEach(el=>uiObserver.observe(el));
  };

  prefetchUpcoming=async function(){return};

  function repaint(){
    document.querySelectorAll('.issue[data-id]').forEach(el=>{
      const id=Number(el.dataset.id),m=state.marvel.get(id);if(m)updateRenderedMeta(id,m);else installImage(el.querySelector('[data-cover-slot]'),id,null);
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>requestAnimationFrame(repaint));else requestAnimationFrame(repaint);
})();
