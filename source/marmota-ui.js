/* Marvel Lector v1.2.26 — acceso a colección en Marmota */
(() => {
  function marmotaQuery(x,s,title){
    const original=String(s?.original||title||'').trim();
    const year=String(x?.a||s?.year||s?.y||'').trim();
    const qs=new URLSearchParams({title:original,year});
    return `/api/marmota/open?${qs.toString()}`;
  }
  function marmotaButton(x,s,title){
    return `<a class="secondary full marmota-launch" target="_blank" rel="noopener" href="${esc(marmotaQuery(x,s,title))}">Abrir en Marmota</a>`;
  }

  if(typeof officialButtons==='function'){
    const baseOfficialButtons=officialButtons;
    officialButtons=function(x,s,title){
      return baseOfficialButtons(x,s,title).replace('</div>',`${marmotaButton(x,s,title)}</div>`);
    };
  }

  if(typeof renderReader==='function'){
    const baseRenderReader=renderReader;
    renderReader=async function(x,returned=false){
      const result=await baseRenderReader(x,returned);
      if(!x)return result;
      const root=document.querySelector('#readerContent');
      if(!root||root.querySelector('.marmota-launch'))return result;
      const s=state.seriesMap.get(x.s)||{},title=s.es||s.original||'Serie';
      const button=document.createElement('a');
      button.className='secondary full marmota-launch';
      button.target='_blank';
      button.rel='noopener';
      button.href=marmotaQuery(x,s,title);
      button.textContent='Abrir en Marmota';
      const marvelLaunch=root.querySelector('.marvel-launch');
      if(marvelLaunch)marvelLaunch.insertAdjacentElement('afterend',button);
      else root.appendChild(button);
      return result;
    };
  }
})();
