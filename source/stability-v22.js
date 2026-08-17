/* Marvel Lector v1.2.25 — Smart Link estable + bloqueo de cachés no verificadas */
(() => {
  let verifiedPack=false,packLoaded=false;

  function sourceIdOf(m){
    if(m?.sourceId)return String(m.sourceId);
    return String(m?.issueUrl||'').match(/\/comics\/issue\/(\d+)/i)?.[1]||'';
  }
  function gcdCover(id){return `/api/gcd/cover-image?id=${encodeURIComponent(Number(id))}`}
  function coverFor(id,m){
    if(m?.preinstalled&&!verifiedPack)return gcdCover(id);
    const existing=String(m?.coverUrl||'').trim();
    if(/^https?:\/\//i.test(existing))return existing;
    if(/^\/api\/marvel\/cover\?sourceId=/i.test(existing))return existing;
    const sid=sourceIdOf(m);
    return sid?`/api/marvel/cover?sourceId=${encodeURIComponent(sid)}`:gcdCover(id);
  }
  function install(container,id,m){
    if(!container||!id)return;
    const src=coverFor(id,m),fallback=gcdCover(id),img=document.createElement('img');img.src=src;img.alt='';img.decoding='async';
    img.onerror=()=>{
      if(img.dataset.gcdFallback!=='1'&&img.src!==new URL(fallback,location.href).href){img.dataset.gcdFallback='1';img.src=fallback;return}
      const p=document.createElement('div');p.className=container.classList.contains('reader-cover')?'reader-cover-placeholder':'cover-placeholder large';p.textContent='M';container.replaceChildren(p);
    };
    container.replaceChildren(img);
  }

  const baseMarvelQuery=marvelQuery;
  marvelQuery=function(x,s,mode){
    const raw=baseMarvelQuery(x,s,mode),m=state.marvel.get(Number(x.id));
    if(!m||(!m.sourceId&&!m.readerId&&!m.drn&&m.preinstalledStatus===undefined))return raw;
    if(m.preinstalled&&!verifiedPack)return raw;
    const u=new URL(raw,location.origin);
    if(m.sourceId)u.searchParams.set('sourceId',String(m.sourceId));
    if(m.readerId)u.searchParams.set('readerId',String(m.readerId));
    if(m.drn)u.searchParams.set('drn',String(m.drn));
    if(m.preinstalledStatus!==undefined)u.searchParams.set('preinstalledStatus',String(m.preinstalledStatus));
    return u.pathname+u.search;
  };

  const baseUnlimitedState=unlimitedState;
  unlimitedState=function(m){
    if(m?.preinstalled&&(!packLoaded||!verifiedPack))return{label:'Unlimited · caché pendiente de verificar',cls:'unresolved'};
    if(m?.preinstalledStatus===5)return{label:'Unlimited · enlace pendiente',cls:'unresolved'};
    return baseUnlimitedState(m);
  };

  function repaintVerification(){
    document.querySelectorAll('.issue[data-id]').forEach(el=>{
      const id=Number(el.dataset.id),m=state.marvel.get(id);
      if(typeof updateRenderedMeta==='function'&&m)updateRenderedMeta(id,m);
    });
  }
  fetch('data/marvel-cache/index.json',{cache:'no-cache'}).then(r=>r.ok?r.json():null).then(pack=>{
    verifiedPack=Boolean(pack&&Number(pack.version)>=3&&pack.officiallyVerified===true);
    packLoaded=true;repaintVerification();
  }).catch(()=>{packLoaded=true;verifiedPack=false;repaintVerification()});

  stableAppHref=function(x,s){
    const m=state.marvel.get(Number(x.id));
    if(m?.preinstalled&&!verifiedPack)return baseMarvelQuery(x,s,'app');
    if(m?.smartLink)return m.smartLink;
    return marvelQuery(x,s,'app');
  };

  const oldDetail=window.openDetail;
  if(typeof oldDetail==='function')window.openDetail=async function(id,collection,...args){
    const r=await oldDetail.call(this,id,collection,...args);
    if(!collection)install(document.querySelector('#detailCover'),Number(id),state.marvel.get(Number(id)));
    return r;
  };

  const oldReader=window.renderReader;
  if(typeof oldReader==='function')window.renderReader=async function(x,...args){
    const r=await oldReader.call(this,x,...args);
    if(x?.id)install(document.querySelector('#readerContent .reader-cover'),Number(x.id),state.marvel.get(Number(x.id)));
    return r;
  };
})();
