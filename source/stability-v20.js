/* Marvel Lector v1.2.20 — estabilización: portada same-origin + Smart Links positivos inmutables */
(() => {
  const UNKNOWN_TTL=6*60*60*1000;
  let currentDetailId=0,currentReaderId=0;

  function proxyCover(id){return `/api/gcd/cover-image?id=${encodeURIComponent(Number(id))}`}
  window.gcdCoverProxy=proxyCover;

  function age(m){const t=new Date(m?.checkedAt||0).getTime();return Number.isFinite(t)?Date.now()-t:Infinity}
  function positive(m){return Boolean(m?.smartLink)}

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

  // Cualquier Smart Link que ya fue obtenido tiene prioridad absoluta. No depende
  // de resolverVersion, checkedAt ni de una comprobación posterior que pueda fallar.
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
    if(img.dataset.gcdProxyId===String(id)&&img.getAttribute('src')===src)return;
    img.dataset.gcdProxyId=String(id);img.className=klass;img.loading='lazy';img.decoding='async';img.alt='';
    img.onerror=()=>{
      const p=document.createElement('div');p.className=container.classList.contains('reader-cover')?'reader-cover-placeholder':'cover-placeholder';p.textContent='M';container.replaceChildren(p);
    };
    img.src=src;
  }
  function patchVisibleCovers(root=document){
    root.querySelectorAll?.('.issue[data-id]').forEach(el=>installCover(el.querySelector('[data-cover-slot]'),Number(el.dataset.id),'issue-cover'));
  }
  function patchOpenSheets(){
    if(currentDetailId)installCover(document.querySelector('#detailCover'),currentDetailId,'');
    if(currentReaderId)installCover(document.querySelector('#readerContent .reader-cover'),currentReaderId,'');
  }

  const previousRenderIssues=window.renderIssues;
  if(typeof previousRenderIssues==='function')window.renderIssues=function(...args){const r=previousRenderIssues.apply(this,args);patchVisibleCovers(document);return r};
  const previousRenderSeriesIssues=window.renderSeriesIssues;
  if(typeof previousRenderSeriesIssues==='function')window.renderSeriesIssues=function(...args){const r=previousRenderSeriesIssues.apply(this,args);patchVisibleCovers(document);return r};

  const previousOpenDetail=window.openDetail;
  if(typeof previousOpenDetail==='function')window.openDetail=async function(id,collection,...args){
    currentDetailId=collection?0:Number(id);
    const r=await previousOpenDetail.call(this,id,collection,...args);
    patchOpenSheets();return r;
  };

  const previousRenderReader=window.renderReader;
  if(typeof previousRenderReader==='function')window.renderReader=async function(x,...args){
    currentReaderId=Number(x?.id)||0;
    const r=await previousRenderReader.call(this,x,...args);
    patchOpenSheets();return r;
  };

  const previousFetchMarvelMeta=window.fetchMarvelMeta;
  if(typeof previousFetchMarvelMeta==='function')window.fetchMarvelMeta=async function(x,force=false){
    const cached=state.marvel.get(Number(x.id));
    if(cached?.smartLink)return cached;
    if(!force&&isFreshMeta(cached))return cached;
    return previousFetchMarvelMeta.call(this,x,force);
  };

  // Algunas funciones antiguas repintaban la portada del detalle después de que
  // llegara metadata. El observer vuelve a imponer el proxy local en ese momento.
  const observer=new MutationObserver(records=>{
    for(const rec of records)for(const node of rec.addedNodes){
      if(node.nodeType!==1)continue;
      if(node.matches?.('.issue[data-id]'))installCover(node.querySelector('[data-cover-slot]'),Number(node.dataset.id),'issue-cover');
      patchVisibleCovers(node);
      if(node.closest?.('#detailCover')||node.querySelector?.('#detailCover'))patchOpenSheets();
      if(node.closest?.('#readerContent .reader-cover')||node.querySelector?.('.reader-cover'))patchOpenSheets();
    }
  });
  const start=()=>{patchVisibleCovers(document);patchOpenSheets();observer.observe(document.body,{childList:true,subtree:true})};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
