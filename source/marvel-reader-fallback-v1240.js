/* Marvel Lector v1.2.40 — fallback oficial reader para los 7 UUID DRN no expuestos */
(() => {
  const SMART_BASE='https://marvel.smart.link/fiir7ec77';
  const TARGETS=new Map([
    [29395,'55204'],
    [29387,'55203'],
    [60401,'73928'],
    [338373,'535'],
    [521503,'6307'],
    [521504,'6308'],
    [1244835,'34127'],
  ]);

  function readerFallbackHref(m){
    if(!m||Number(m.preinstalledStatus)!==5)return '';
    const expected=TARGETS.get(Number(m.id));
    const readerId=String(m.readerId||'').trim();
    if(!expected||readerId!==expected||!/^\d+$/.test(readerId))return '';
    return `${SMART_BASE}?type=reader&drn=${encodeURIComponent(readerId)}`;
  }

  // Status 5 sigue significando que Marvel no expone el UUID DRN. Para estos siete
  // casos, Marvel sí publica una ruta reader oficial y específica del mismo número.
  if(typeof unlimitedState==='function'){
    const baseUnlimitedState=unlimitedState;
    unlimitedState=function(m){
      if(readerFallbackHref(m))return{label:'Unlimited ✓',cls:'available'};
      return baseUnlimitedState(m);
    };
  }

  if(typeof stableAppHref==='function'){
    const baseStableAppHref=stableAppHref;
    stableAppHref=function(x,s){
      const m=typeof state!=='undefined'&&state?.marvel?state.marvel.get(Number(x?.id)):null;
      return readerFallbackHref(m)||baseStableAppHref(x,s);
    };
  }

  // Recalcula las insignias cuando la caché preinstalada haya terminado de hidratarse.
  function repaintTargets(){
    if(typeof state==='undefined'||!state?.marvel||typeof updateRenderedMeta!=='function')return;
    for(const id of TARGETS.keys()){
      const m=state.marvel.get(id);
      if(m)updateRenderedMeta(id,m);
    }
  }
  if(typeof requestAnimationFrame==='function')requestAnimationFrame(repaintTargets);
  if(typeof setTimeout==='function'){
    setTimeout(repaintTargets,500);
    setTimeout(repaintTargets,1800);
  }
})();
