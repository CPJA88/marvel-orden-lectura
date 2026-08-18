/* Marvel Lector v1.2.31 — búsqueda/filtros globales, rápidos y sin carreras */
(() => {
  let refreshTicket=0;
  let decadeExplicit=false;
  let autoGlobalized=false;
  let autoDecade='';

  const decadeEl=document.getElementById('decadeFilter');
  const clearEl=document.getElementById('clearFilters');

  // La década elegida automáticamente al arrancar sirve para navegar, pero no debe
  // limitar silenciosamente una búsqueda o un filtro global. Si el usuario toca
  // expresamente la década, sí se respeta como filtro combinado.
  decadeEl?.addEventListener('change',()=>{
    decadeExplicit=true;
    autoGlobalized=false;
    autoDecade='';
  },{capture:true});
  clearEl?.addEventListener('click',()=>{
    decadeExplicit=false;
    autoGlobalized=false;
    autoDecade='';
  },{capture:true});

  function normalizeSearch(v){
    return String(v??'')
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLocaleLowerCase('es')
      .replace(/[^a-z0-9.]+/g,' ')
      .trim();
  }
  function queryTokens(q){return normalizeSearch(q).split(/\s+/).filter(Boolean)}
  function rowMatchesQuery(row,tokens){
    if(!tokens.length)return true;
    const s=state.seriesMap.get(Number(row?.[3]))||{};
    const n=String(row?.[4]??'');
    const hay=normalizeSearch(`${s.original||''} ${s.es||''} ${n} #${n}`);
    return tokens.every(t=>hay.includes(t));
  }
  function hasGlobalCriteria(q,st,ct,era){
    return Boolean(q)||state.activeSeries!==null||st!=='all'||ct!=='all'||era!=='all';
  }
  function maybeAdjustAutomaticDecade(q,st,ct,era){
    if(!decadeEl||decadeExplicit)return;
    const active=hasGlobalCriteria(q,st,ct,era);
    if(active&&decadeEl.value!=='all'){
      autoDecade=decadeEl.value;
      autoGlobalized=true;
      decadeEl.value='all';
      return;
    }
    if(!active&&autoGlobalized&&autoDecade){
      decadeEl.value=autoDecade;
      autoGlobalized=false;
      autoDecade='';
    }
  }

  const baseSelectInitialDecade=typeof selectInitialDecade==='function'?selectInitialDecade:null;
  if(baseSelectInitialDecade){
    selectInitialDecade=async function(...args){
      decadeExplicit=false;autoGlobalized=false;autoDecade='';
      return baseSelectInitialDecade.apply(this,args);
    };
  }
  const baseJumpToIndexRow=typeof jumpToIndexRow==='function'?jumpToIndexRow:null;
  if(baseJumpToIndexRow){
    jumpToIndexRow=async function(...args){
      decadeExplicit=false;autoGlobalized=false;autoDecade='';
      return baseJumpToIndexRow.apply(this,args);
    };
  }

  refresh=async function(){
    const ticket=++refreshTicket;
    const searchInput=document.getElementById('searchInput');
    const statusFilter=document.getElementById('statusFilter');
    const contentFilter=document.getElementById('contentFilter');
    const eraFilter=document.getElementById('eraFilter');
    if(!searchInput||!statusFilter||!contentFilter||!eraFilter||!decadeEl)return;

    let q=searchInput.value.trim();
    let st=statusFilter.value,ct=contentFilter.value,era=eraFilter.value;
    maybeAdjustAutomaticDecade(q,st,ct,era);
    const dec=decadeEl.value;
    const tokens=queryTokens(q);
    const useIndex=Boolean(tokens.length)||state.activeSeries!==null||st!=='all'||ct!=='all'||era!=='all';
    state.page=0;
    const resultCount=document.getElementById('resultCount');
    if(resultCount)resultCount.textContent=useIndex?'Buscando…':'Cargando…';

    try{
      let base=[];
      if(useIndex){
        const idx=await ensureSearch();
        if(ticket!==refreshTicket)return;
        const candidates=idx.filter(r=>
          (dec==='all'||String(r?.[7])===String(dec))&&
          (ct==='all'||r?.[5]===ct)&&
          (era==='all'||r?.[6]===era)&&
          (state.activeSeries===null||Number(r?.[3])===Number(state.activeSeries))&&
          matchesStatus({id:Number(r?.[1])},st)&&
          rowMatchesQuery(r,tokens)
        );
        const ids=new Set(candidates.map(r=>Number(r?.[1])));
        const need=[...new Set(candidates.map(r=>String(r?.[7])))];
        for(const d of need){
          const ch=await ensureChunk(d);
          if(ticket!==refreshTicket)return;
          for(const x of ch)if(ids.has(Number(x.id)))base.push(x);
        }
        base.sort((a,b)=>a.o-b.o);
      }else if(dec==='all'){
        for(const c of state.meta.chunks){
          const ch=await ensureChunk(c.id);
          if(ticket!==refreshTicket)return;
          base.push(...ch);
        }
      }else{
        base=await ensureChunk(dec);
        if(ticket!==refreshTicket)return;
      }

      const filtered=base.filter(x=>
        matchesStatus(x,st)&&
        (ct==='all'||x.c===ct)&&
        (era==='all'||x.e===era)
      );
      if(ticket!==refreshTicket)return;
      state.filtered=filtered;
      renderIssues();
      updateActiveSeries();
    }catch(e){
      if(ticket!==refreshTicket)return;
      console.error('Búsqueda/filtros',e);
      if(resultCount)resultCount.textContent='No se pudieron aplicar los filtros';
      if(typeof toast==='function')toast('No se pudieron aplicar la búsqueda o los filtros');
    }
  };
})();
