/* Marvel Lector v1.2.29 — la caché V3 verificada manda sobre metadata antigua */
(() => {
  const terminalNegative=new Set([0,2,3,4]);

  function sanitizePreinstalled(m){
    if(!m||!m.preinstalled)return m;
    const status=Number(m.preinstalledStatus);
    if(!terminalNegative.has(status)&&status!==5)return m;

    const clean={...m};
    if(terminalNegative.has(status)){
      clean.smartLink='';
      clean.drn='';
      clean.readerId='';
      clean.available=false;
      if(status===3)clean.reason='reader-unavailable';
      else if(status===4){clean.reason='preinstalled-not-listed';clean.sourceId=''}
      else if(status===2)clean.reason='preinstalled-ambiguous';
      else clean.reason='preinstalled-unknown';
    }else if(status===5){
      // Unlimited verificado, pero sin deeplink fiable. No reutilizar uno antiguo.
      clean.smartLink='';
      clean.drn='';
      clean.available=true;
      clean.reason='drn-unavailable';
    }
    if(clean.id&&typeof state!=='undefined'&&state?.marvel)state.marvel.set(Number(clean.id),clean);
    return clean;
  }

  function persistClean(m){
    if(!m?.id||typeof DB==='undefined'||!DB?.put)return;
    Promise.resolve(DB.put('marvel',m)).catch(()=>{});
  }

  function sweep(){
    if(typeof state==='undefined'||!state?.marvel)return;
    for(const [id,m] of state.marvel){
      const clean=sanitizePreinstalled(m);
      if(clean!==m||clean?.smartLink!==m?.smartLink){state.marvel.set(Number(id),clean);persistClean(clean)}
    }
  }

  if(typeof unlimitedState==='function'){
    const baseUnlimitedState=unlimitedState;
    unlimitedState=function(m){
      const clean=sanitizePreinstalled(m),status=Number(clean?.preinstalledStatus);
      if(status===3)return{label:'Sin Unlimited',cls:'unavailable'};
      if(status===4)return{label:'No consta en Unlimited',cls:'unresolved'};
      if(status===5)return{label:'Unlimited ✓ · enlace pendiente',cls:'unresolved'};
      if(status===2)return{label:'Unlimited · coincidencia dudosa',cls:'unresolved'};
      if(status===0)return{label:'No consta en Unlimited',cls:'unresolved'};
      return baseUnlimitedState(clean);
    };
  }

  if(typeof updateRenderedMeta==='function'){
    const baseUpdateRenderedMeta=updateRenderedMeta;
    updateRenderedMeta=function(id,m){
      const clean=sanitizePreinstalled(m);
      if(clean&&clean!==m)persistClean(clean);
      return baseUpdateRenderedMeta(id,clean);
    };
  }

  if(typeof fetchMarvelMeta==='function'){
    const baseFetchMarvelMeta=fetchMarvelMeta;
    fetchMarvelMeta=async function(...args){
      const m=await baseFetchMarvelMeta.apply(this,args),clean=sanitizePreinstalled(m);
      if(clean&&clean!==m)persistClean(clean);
      return clean;
    };
  }

  if(typeof hydrateIssueMeta==='function'){
    const baseHydrateIssueMeta=hydrateIssueMeta;
    hydrateIssueMeta=async function(...args){
      const m=await baseHydrateIssueMeta.apply(this,args),clean=sanitizePreinstalled(m);
      if(clean&&clean!==m)persistClean(clean);
      return clean;
    };
  }

  // La precarga V3 de cache-ui es asíncrona; varias pasadas limpian IndexedDB antiguo
  // sin volver a consultar Marvel durante el scroll.
  sweep();
  setTimeout(sweep,250);
  setTimeout(sweep,1200);
  setTimeout(sweep,4000);
})();
