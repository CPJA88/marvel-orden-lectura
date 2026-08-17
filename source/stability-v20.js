/* Marvel Lector v1.2.20 — estabilización: portada same-origin + Smart Links positivos inmutables */
(() => {
  const UNKNOWN_TTL=6*60*60*1000;

  function proxyCover(id){return `/api/gcd/cover-image?id=${encodeURIComponent(Number(id))}`}
  window.gcdCoverProxy=proxyCover;

  function age(m){const t=new Date(m?.checkedAt||0).getTime();return Number.isFinite(t)?Date.now()-t:Infinity}
  function positive(m){return Boolean(m?.smartLink)}

  // Un Smart Link positivo no deja de ser válido porque cambie el número interno
  // de versión del resolver. Esta era una fuente innecesaria de regresiones.
  isFreshMeta=function(m){
    if(!m)return false;
    if(positive(m))return true;
    if(m.reason==='reader-unavailable'&&m.issueUrl)return age(m)<7*24*60*60*1000;
    if(m.reason==='not-verified')return age(m)<UNKNOWN_TTL;
    return age(m)<5*1000;
  };
  unlimitedState=function(m){
    if(positive(m))return{label:'Unlimited ✓',cls:'available'};
    if(m?.reason==='reader-unavailable'&&m?.issueUrl)return{label:'Sin Unlimited',cls:'unavailable'};
    return{label:'Unlimited · sin comprobar',cls:'pending-meta'};
  };

  // Prioridad absoluta al enlace que ya funcionó. No se vuelve a resolver por red.
  stableAppHref=function(x,s){
    const m=state.marvel.get(Number(x.id));
    if(m?.smartLink)return m.smartLink;
    return marvelQuery(x,s,'app');
  };

  function installCover(container,id,klass='issue-cover'){
    if(!container||!id)return;
    const src=proxyCover(id);
    let img=container.querySelector('img');
    if(!img){img=document.createElement('img');container.replaceChildren(img)}
    if(img.dataset.gcdProxyId===String(id))return;
    img.dataset.gcdProxyId=String(id);img.className=klass;img.loading='lazy';img.decoding='async';img.alt='';
    img.onerror=()=>{
      const p=document.createElement('div');p.className=container.classList.contains('reader-cover')?'reader-cover-placeholder':'cover-placeholder';p.textContent='M';container.replaceChildren(p);
    };
    img.src=src;
  }
  function patchVisibleCovers(root=document){
    root.querySelectorAll?.('.issue[data-id]').forEach(el=>installCover(el.querySelector('[data-cover-slot]'),Number(el.dataset.id),'issue-cover'));
  }

  // Cada render de lista/serie queda apuntado al proxy, aunque IndexedDB contenga
  // una antigua URL files1.comics.org que Safari no pueda hotlinkear.
  const previousRenderIssues=window.renderIssues;
  if(typeof previousRenderIssues==='function')window.renderIssues=function(...args){const r=previousRenderIssues.apply(this,args);patchVisibleCovers(document);return r};
  const previousRenderSeriesIssues=window.renderSeriesIssues;
  if(typeof previousRenderSeriesIssues==='function')window.renderSeriesIssues=function(...args){const r=previousRenderSeriesIssues.apply(this,args);patchVisibleCovers(document);return r};

  const previousOpenDetail=window.openDetail;
  if(typeof previousOpenDetail==='function')window.openDetail=async function(id,collection,...args){
    const r=await previousOpenDetail.call(this,id,collection,...args);
    if(!collection)installCover(document.querySelector('#detailCover'),Number(id),'');
    return r;
  };

  const previousRenderReader=window.renderReader;
  if(typeof previousRenderReader==='function')window.renderReader=async function(x,...args){
    const r=await previousRenderReader.call(this,x,...args);
    if(x?.id)installCover(document.querySelector('#readerContent .reader-cover'),Number(x.id),'');
    return r;
  };

  // El cliente anterior intentaba refrescar metadata aunque el backend ya hubiera
  // decidido no hacer descubrimiento masivo. Recuperamos caché positiva una sola vez
  // por número; un resultado desconocido queda quieto durante seis horas.
  const previousFetchMarvelMeta=window.fetchMarvelMeta;
  if(typeof previousFetchMarvelMeta==='function')window.fetchMarvelMeta=async function(x,force=false){
    const cached=state.marvel.get(Number(x.id));
    if(cached?.smartLink)return cached;
    if(!force&&isFreshMeta(cached))return cached;
    return previousFetchMarvelMeta.call(this,x,force);
  };

  const observer=new MutationObserver(records=>{
    for(const rec of records)for(const node of rec.addedNodes){
      if(node.nodeType!==1)continue;
      if(node.matches?.('.issue[data-id]'))installCover(node.querySelector('[data-cover-slot]'),Number(node.dataset.id),'issue-cover');
      patchVisibleCovers(node);
    }
  });
  const start=()=>{patchVisibleCovers(document);observer.observe(document.body,{childList:true,subtree:true})};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
