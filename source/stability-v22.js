/* Marvel Lector v1.2.22 — invariantes: Smart Link positivo y portada por sourceId */
(() => {
  function sourceIdOf(m){
    if(m?.sourceId)return String(m.sourceId);
    return String(m?.issueUrl||'').match(/\/comics\/issue\/(\d+)/i)?.[1]||'';
  }
  function coverFor(id,m){
    const sid=sourceIdOf(m);
    return sid?`/api/marvel/cover?sourceId=${encodeURIComponent(sid)}`:`/api/gcd/cover-image?id=${encodeURIComponent(Number(id))}`;
  }
  function install(container,id,m){
    if(!container||!id)return;
    const src=coverFor(id,m),img=document.createElement('img');img.src=src;img.alt='';img.decoding='async';
    img.onerror=()=>{const p=document.createElement('div');p.className=container.classList.contains('reader-cover')?'reader-cover-placeholder':'cover-placeholder large';p.textContent='M';container.replaceChildren(p)};
    container.replaceChildren(img);
  }

  stableAppHref=function(x,s){
    const m=state.marvel.get(Number(x.id));
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
