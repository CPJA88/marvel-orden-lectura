/* Marvel Lector v1.2.35 — un NO_DIGITAL antiguo no se presenta como definitivo hasta reauditarlo */
(() => {
  let coverageV2=false;
  let coverageLoaded=false;
  const baseUnlimitedState=typeof unlimitedState==='function'?unlimitedState:null;
  if(!baseUnlimitedState)return;

  unlimitedState=function(m){
    const status=Number(m?.preinstalledStatus);
    if(status===4)return{label:'Pendiente de verificación oficial',cls:'unresolved'};
    if(status===3&&!coverageV2)return{label:'Unlimited · revalidando',cls:'unresolved'};
    return baseUnlimitedState(m);
  };

  function repaint(){
    if(typeof state==='undefined'||!state?.marvel||typeof updateRenderedMeta!=='function')return;
    for(const [id,m] of state.marvel)updateRenderedMeta(Number(id),m);
  }

  async function loadCoverageState(){
    try{
      const pack=typeof loadJSON==='function'?await loadJSON('data/marvel-cache/index.json'):await fetch('data/marvel-cache/index.json').then(r=>r.json());
      const audit=pack?.officialCoverageAudit;
      coverageV2=Boolean(audit?.completed&&Number(audit?.version)>=2);
      coverageLoaded=true;
      globalThis.__marvelOfficialCoverageAudit=audit||null;
      repaint();
    }catch(e){
      console.warn('No se pudo leer el estado de revalidación oficial',e);
      coverageLoaded=true;
      coverageV2=false;
      repaint();
    }
  }

  loadCoverageState();
  setTimeout(()=>{if(!coverageLoaded)repaint()},1500);
})();