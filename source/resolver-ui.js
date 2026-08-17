/* Marvel Lector v1.2.20 — apertura estable: un Smart Link positivo nunca se invalida */
const UI_RESOLVER_VERSION=5;

// Se conserva por compatibilidad para metadata negativa/pendiente. Los positivos
// no dependen de esta función: si existe un Smart Link, se usa directamente.
isFreshMeta=m=>Boolean(m&&Number(m.resolverVersion)===UI_RESOLVER_VERSION&&m.checkedAt&&Date.now()-new Date(m.checkedAt).getTime()<META_MAX_AGE);

function stableAppHref(x,s){
  const m=state.marvel.get(Number(x.id));
  // Un Smart Link ya obtenido es el dato más valioso que tenemos: no se vuelve
  // a resolver ni se invalida por cambios de versión o por diagnósticos posteriores.
  if(m?.smartLink)return m.smartLink;
  return marvelQuery(x,s,'app');
}

officialButtons=function(x,s,title){
  let spanish=String(title||s.original||'Marvel'),paniniQuery=`site:panini.es/shp_esp_es/ "${spanish}" "${x.n?'#'+x.n:''}" ${x.a||''} Marvel`,pan='https://www.google.com/search?q='+encodeURIComponent(paniniQuery),launch=stableAppHref(x,s);
  return `<div class="official-links"><a class="primary full marvel-launch" data-mode="app" href="${esc(launch)}">Abrir en Marvel Unlimited</a><a class="secondary full" target="_blank" rel="noopener" href="${esc(marvelQuery(x,s,'web'))}">Abrir en Marvel Unlimited Web</a><a class="secondary full" target="_blank" rel="noopener" href="${esc(pan)}">Buscar edición en castellano</a></div>`
};

renderReader=async function(x,returned=false){
  if(!x)return;
  let s=state.seriesMap.get(x.s)||{},title=s.es||s.original||'Serie',m=state.marvel.get(x.id),st=progressStatus(x.id),next=await nextPendingRow(x.o),cover=m?.coverUrl?`<img src="${esc(m.coverUrl)}" alt="Portada de ${esc(title)} #${esc(x.n)}">`:'<div class="reader-cover-placeholder">MARVEL</div>',launch=stableAppHref(x,s),mu=unlimitedState(m);
  $('#readerContent').innerHTML=`<div class="reader-progress"><span>#${fmt.format(x.o)} del orden</span><span>${esc(prettyDate(x.d))}</span></div><div class="reader-cover">${cover}</div><span class="eyebrow">MODO LECTURA</span><h2>${esc(title)} #${esc(x.n||'[s/n]')}</h2>${s.es&&s.es!==s.original?`<p class="reader-original">${esc(s.original)}</p>`:''}<div class="reader-tags"><span class="badge ${x.c}">${esc(state.meta.labels.content[x.c]||x.c)}</span><span class="badge marvel-state ${mu.cls}">${esc(mu.label)}</span><span class="badge progress-badge ${st}">${esc(statusText(st))}</span></div>${reprintAdvice(x)}${returned?'<div class="return-prompt"><strong>¿Has terminado este número?</strong><p>Marca el resultado y saltaré automáticamente al siguiente pendiente.</p></div>':''}<a class="primary full reader-launch marvel-launch" href="${esc(launch)}">Abrir en Marvel Unlimited</a><a class="secondary full" target="_blank" rel="noopener" href="${esc(marvelQuery(x,s,'web'))}">Abrir en navegador</a><div class="reader-actions"><button type="button" class="primary" id="readNextBtn">Leído · siguiente</button>${x.c==='reimpresion'?'<button type="button" class="secondary" id="skipNextBtn">Omitir · siguiente</button>':''}${x.c==='mixto'?'<button type="button" class="secondary" id="newNextBtn">Solo material nuevo · siguiente</button>':''}</div>${next?`<p class="next-hint">Después: ${esc(seriesName(next[3]))} #${esc(next[4]||'[s/n]')}</p>`:'<p class="next-hint">No quedan números pendientes.</p>'}`;
  wireProgressActions($('#readerContent'),x);wireLaunchTracking($('#readerContent'),x);$('#readNextBtn').onclick=()=>completeAndNext(x,'read');let sk=$('#skipNextBtn');if(sk)sk.onclick=()=>completeAndNext(x,'skipped-reprint');let nw=$('#newNextBtn');if(nw)nw.onclick=()=>completeAndNext(x,'new-material')
};
