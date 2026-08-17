/* Marvel Lector v1.2.5 — persistencia visual de portadas y metadata resolver v5 */
(() => {
  const ACTIVE_RESOLVER_VERSION=5;

  // El Worker estable usa resolverVersion 5. La capa anterior seguía esperando
  // la versión 4 y convertía cualquier resultado nuevo en "pendiente".
  isFreshMeta=m=>Boolean(
    m&&Number(m.resolverVersion)===ACTIVE_RESOLVER_VERSION&&m.checkedAt&&
    Date.now()-new Date(m.checkedAt).getTime()<META_MAX_AGE
  );

  // Mantén la portada ya conocida al reconstruir una tarjeta por filtros/eras.
  // Su disponibilidad puede refrescarse después, pero la imagen no debe parpadear
  // ni volver al placeholder por el mero hecho de cambiar de vista.
  card=function(issue,collection=false){
    let s=state.seriesMap.get(issue.s)||{},title=s.es||s.original||'Serie',translated=s.es&&s.es!==s.original,
      st=progressStatus(issue.id),exact=(issue.pc||'').startsWith('Fecha de venta GCD')&&!String(issue.pc||'').includes('incierta'),
      cached=state.marvel.get(Number(issue.id));
    let statusClass=st==='read'?'read':st==='skipped-reprint'?'skipped':st==='new-material'?'partial':'';
    let cover=collection?'':`<div class="cover-slot" data-cover-slot>${cached?.coverUrl?`<img class="issue-cover" loading="lazy" decoding="async" src="${esc(cached.coverUrl)}" alt="">`:'<div class="cover-placeholder">M</div>'}</div>`;
    return `<article class="issue ${statusClass} ${collection?'collection':''}" data-id="${issue.id}" data-order="${issue.o}" data-series="${issue.s}"><button class="check" aria-label="${st==='pending'?'Marcar leído':'Cambiar estado'}">${statusIcon(st)}</button>${cover}<div class="issue-main"><div class="issue-title">${esc(title)} <span class="muted">#${esc(issue.n||'[s/n]')}</span></div>${translated?`<div class="issue-original">${esc(s.original)}</div>`:''}<div class="issue-meta">${collection?`<span class="badge">${esc(issue.tg||'Edición')}</span>`:`<span class="badge ${issue.c}">${esc(state.meta.labels.content[issue.c]||issue.c)}</span><span class="badge">${esc(state.meta.labels.era[issue.e]||issue.e)}</span>${st!=='pending'?`<span class="badge progress-badge ${st}">${esc(statusText(st))}</span>`:''}${metaBadge(issue.id)}`}</div></div><div class="order-col"><div class="order-num">${collection?'Ed.':'#'+fmt.format(issue.o)}</div><div class="issue-date ${exact?'':'approx'}">${esc(prettyDate(issue.d))}${exact?'':' ≈'}</div></div></article>`;
  };

  // Al entrar una tarjeta en pantalla, pinta primero cualquier dato local ya
  // conocido y solo después decide si hace falta consultar de nuevo al Worker.
  hydrateIssueMeta=async function(id){
    let x=await findIssueById(id);if(!x)return;
    let cached=state.marvel.get(Number(id));
    if(cached)updateRenderedMeta(id,cached);
    if(isFreshMeta(cached))return;
    await fetchMarvelMeta(x);
  };

  // Si ya había metadatos v5 en IndexedDB al arrancar, repíntalos en cuanto la
  // lista exista. Esto evita esperar a otra interacción del usuario.
  const repaintVisible=()=>{
    document.querySelectorAll('.issue[data-id]').forEach(el=>{
      const id=Number(el.dataset.id),m=state.marvel.get(id);if(m)updateRenderedMeta(id,m);
    });
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>requestAnimationFrame(repaintVisible));
  else requestAnimationFrame(repaintVisible);
})();
