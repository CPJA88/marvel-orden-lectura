/* Marvel Lector v1.2.23 — caché Marvel completa preinstalada; red solo como fallback */
(() => {
  const ACTIVE_RESOLVER_VERSION=13;
  const UI_CACHE_VERSION=10;
  const UI_META_CONCURRENCY=1;
  const REQUEST_GAP=650;
  const NEGATIVE_RETRY_AGE=15*1000;
  const CONFIRMED_UNAVAILABLE_AGE=7*24*60*60*1000;
  let uiObserver=null,active=0,seq=0,preinstalledPack=null,preinstalledReady=false,preinstalledSeeded=false;
  const queue=[],pending=new Map(),preinstalledMap=new Map();

  function ageOf(m){
    const t=new Date(m?.checkedAt||0).getTime();
    return Number.isFinite(t)?Date.now()-t:Infinity;
  }
  function positive(m){return Boolean(m?.smartLink)}
  function knownAvailable(m){return Boolean(positive(m)||m?.preinstalledStatus===1||(m?.available&&m?.sourceId))}
  function confirmedUnavailable(m){return Boolean(m?.preinstalledStatus===0||(m?.issueUrl&&m?.reason==='reader-unavailable'))}
  function sourceIdOf(m){
    if(m?.sourceId)return String(m.sourceId);
    const hit=String(m?.issueUrl||'').match(/\/comics\/issue\/(\d+)/i);
    return hit?.[1]||'';
  }
  function gcdCover(id){return `/api/gcd/cover-image?id=${encodeURIComponent(Number(id))}`}
  function coverFor(id,m){
    const existing=String(m?.coverUrl||'').trim();
    if(/^https?:\/\//i.test(existing))return existing;
    if(/^\/api\/marvel\/cover\?sourceId=/i.test(existing))return existing;
    const sid=sourceIdOf(m);
    if(sid)return `/api/marvel/cover?sourceId=${encodeURIComponent(sid)}`;
    return gcdCover(id);
  }

  function unpackPreinstalled(row,generatedAt){
    if(!Array.isArray(row)||row.length<4)return null;
    const id=Number(row[0]),sourceId=Number(row[1])||0,readerId=Number(row[2])||0,status=Number(row[3]),coverUrl=String(row[4]||'');
    if(!id)return null;
    return {
      id,
      sourceId:sourceId?String(sourceId):'',
      readerId:readerId?String(readerId):'',
      coverUrl,
      preinstalled:true,
      preinstalledStatus:status,
      available:status===1,
      reason:status===1?'preinstalled-mu':status===0?'reader-unavailable':'preinstalled-ambiguous',
      resolverVersion:ACTIVE_RESOLVER_VERSION,
      uiCacheVersion:UI_CACHE_VERSION,
      checkedAt:generatedAt||'2000-01-01T00:00:00.000Z'
    };
  }
  function mergePreinstalled(id){
    const baked=preinstalledMap.get(Number(id));
    if(!baked)return state.marvel.get(Number(id))||null;
    const old=state.marvel.get(Number(id))||{};
    let merged;
    if(old.smartLink){
      merged={...baked,...old,preinstalled:true,preinstalledStatus:baked.preinstalledStatus};
      if(!merged.coverUrl&&baked.coverUrl)merged.coverUrl=baked.coverUrl;
      merged.available=true;merged.reason='ok';
    }else{
      merged={...old,...baked};
      if(old.drn)merged.drn=old.drn;
      if(old.readerId&&!merged.readerId)merged.readerId=old.readerId;
      if(old.sourceId&&!merged.sourceId)merged.sourceId=old.sourceId;
    }
    state.marvel.set(Number(id),merged);
    return merged;
  }
  function seedAllPreinstalled(){
    if(!preinstalledReady||preinstalledSeeded)return;
    for(const id of preinstalledMap.keys())mergePreinstalled(id);
    preinstalledSeeded=true;
    repaint();
  }
  const preinstalledPromise=(async()=>{
    try{
      const pack=await loadJSON('data/marvel-cache/index.json');
      if(!pack?.ready||!Array.isArray(pack.entries)||!pack.entries.length)return null;
      preinstalledPack=pack;
      for(const row of pack.entries){const item=unpackPreinstalled(row,pack.generatedAt);if(item)preinstalledMap.set(item.id,item)}
      preinstalledReady=true;
      return pack;
    }catch(e){
      console.warn('Caché Marvel preinstalada no disponible',e);
      return null;
    }
  })();

  // init() de app.js empieza antes que este script, pero se detiene en sus await.
  // setupMeta se ejecuta después de cargar IndexedDB; lo envolvemos para sembrar
  // la caché estática sin que pueda ser reemplazada posteriormente por el DB local.
  const baseSetupMeta=setupMeta;
  setupMeta=function(...args){
    const result=baseSetupMeta.apply(this,args);
    preinstalledPromise.then(()=>{seedAllPreinstalled()});
    return result;
  };

  isFreshMeta=m=>{
    if(!m)return false;
    if(m.preinstalled)return true;
    if(positive(m))return true;
    if(Number(m.resolverVersion)!==ACTIVE_RESOLVER_VERSION||Number(m.uiCacheVersion)!==UI_CACHE_VERSION)return false;
    if(confirmedUnavailable(m))return ageOf(m)<CONFIRMED_UNAVAILABLE_AGE;
    return ageOf(m)<NEGATIVE_RETRY_AGE;
  };

  unlimitedState=function(m){
    if(knownAvailable(m))return{label:'Unlimited ✓',cls:'available'};
    if(confirmedUnavailable(m))return{label:'Sin Unlimited',cls:'unavailable'};
    if(m?.preinstalledStatus===2)return{label:'Unlimited · no verificado',cls:'unresolved'};
    if(m?.reason==='drn-unavailable')return{label:'Unlimited · enlace pendiente',cls:'unresolved'};
    if(m?.reason==='resolver-error')return{label:'Unlimited · reintentando',cls:'pending-meta'};
    return{label:preinstalledReady?'Unlimited · no consta':'Unlimited · cargando caché',cls:'pending-meta'};
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
    const src=coverFor(id,m),fallback=gcdCover(id),old=slot.querySelector('img');
    if(old&&old.getAttribute('src')===src)return;
    const img=document.createElement('img');img.className='issue-cover';img.loading='lazy';img.decoding='async';img.alt='';img.src=src;
    img.onerror=()=>{
      if(img.dataset.gcdFallback!=='1'&&img.src!==new URL(fallback,location.href).href){img.dataset.gcdFallback='1';img.src=fallback;return}
      const p=document.createElement('div');p.className='cover-placeholder';p.textContent='M';slot.replaceChildren(p);
    };
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
    const old=state.marvel.get(Number(id))||{},baked=preinstalledMap.get(Number(id)),now=new Date().toISOString();
    if(positive(old)&&!data?.smartLink){
      const merged={...(baked||{}),...old,id:Number(id),checkedAt:old.checkedAt||now,lastCheckedAt:now,lastAttemptReason:data?.reason||data?.error||'unresolved',uiCacheVersion:UI_CACHE_VERSION};
      if(data?.sourceId&&!merged.sourceId)merged.sourceId=data.sourceId;
      if(data?.issueUrl&&!merged.issueUrl)merged.issueUrl=data.issueUrl;
      if(data?.readerId&&!merged.readerId)merged.readerId=data.readerId;
      return merged;
    }
    const merged={...(baked||{}),...old,...data,id:Number(id),checkedAt:now,uiCacheVersion:UI_CACHE_VERSION};
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

  fetchMarvelMeta=async function(x,force=false){
    await preinstalledPromise;
    const baked=mergePreinstalled(Number(x.id));
    if(!force&&baked?.preinstalled)return baked;
    return enqueue(x,0,force);
  };
  hydrateIssueMeta=async function(id){
    await preinstalledPromise;
    const n=Number(id),baked=mergePreinstalled(n),cached=baked||state.marvel.get(n);
    if(cached)updateRenderedMeta(n,cached);
    // Una caché completa no debe volver a analizar tarjetas mientras se hace scroll.
    if(cached?.preinstalled)return cached;
    if(isFreshMeta(cached))return cached;
    const x=await findIssueById(n);if(!x)return null;return enqueue(x,0,false);
  };

  observeVisibleCards=function(root){
    if(uiObserver){uiObserver.disconnect();uiObserver=null}
    const cards=$$(root+' .issue');
    preinstalledPromise.then(()=>{
      if(preinstalledReady&&!preinstalledSeeded)seedAllPreinstalled();
      for(const el of cards){const id=Number(el.dataset.id),m=mergePreinstalled(id)||state.marvel.get(id);if(m)updateRenderedMeta(id,m)}
    });
    cards.slice(0,8).forEach(el=>hydrateIssueMeta(Number(el.dataset.id)));
    if(!('IntersectionObserver'in window))return;
    uiObserver=new IntersectionObserver(entries=>{
      for(const e of entries){if(!e.isIntersecting)continue;const id=Number(e.target.dataset.id);uiObserver?.unobserve(e.target);hydrateIssueMeta(id)}
    },{rootMargin:'350px 0px'});
    cards.slice(8).forEach(el=>uiObserver.observe(el));
  };

  // No hay precarga/resolución remota por lotes: el índice estático sustituye ese trabajo.
  prefetchUpcoming=async function(){await preinstalledPromise;return};

  function repaint(){
    document.querySelectorAll('.issue[data-id]').forEach(el=>{
      const id=Number(el.dataset.id),m=mergePreinstalled(id)||state.marvel.get(id);if(m)updateRenderedMeta(id,m);else installImage(el.querySelector('[data-cover-slot]'),id,null);
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>requestAnimationFrame(repaint));else requestAnimationFrame(repaint);
})();
