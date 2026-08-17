"use strict";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const state={
  meta:null,series:[],seriesMap:new Map(),chunks:new Map(),recopChunks:new Map(),search:null,
  progress:new Map(),marvel:new Map(),view:'principal',page:0,pageSize:120,filtered:[],activeSeries:null,
  recopPage:0,recopItems:[],readerIssue:null,seriesRows:[],seriesPage:0,seriesPageSize:100,prefetching:new Set()
};
const fmt=new Intl.NumberFormat('es-ES');
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const PREFETCH_COUNT=16, META_MAX_AGE=45*24*60*60*1000, MAX_META_CONCURRENCY=3;
let metaActive=0,metaWait=[];
async function withMetaSlot(fn){if(metaActive>=MAX_META_CONCURRENCY)await new Promise(r=>metaWait.push(r));metaActive++;try{return await fn()}finally{metaActive--;metaWait.shift()?.()}}
function prettyDate(s){if(!s)return 'Sin fecha';let m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);if(!m)return s;return `${m[3]}/${m[2]}/${m[1]}`}
function seriesName(sid){let s=state.seriesMap.get(Number(sid));return s?.es||s?.original||'Serie desconocida'}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),2400)}
function progressStatus(id){return state.progress.get(Number(id))?.status|| (state.progress.has(Number(id))?'read':'pending')}
function isResolved(id){return ['read','skipped-reprint','new-material'].includes(progressStatus(id))}
function statusText(status){return ({read:'Leído','skipped-reprint':'Reimpresión omitida','new-material':'Material nuevo leído',pending:'Pendiente'})[status]||status}
function statusIcon(status){return ({read:'✓','skipped-reprint':'↷','new-material':'◐',pending:''})[status]||''}
function isFreshMeta(m){return m&&m.checkedAt&&Date.now()-new Date(m.checkedAt).getTime()<META_MAX_AGE}
function platformMode(){return /Android/i.test(navigator.userAgent)?'android':'ios'}

const DB={
  db:null,
  async open(){return new Promise((res,rej)=>{let r=indexedDB.open('marvel-lectura',2);r.onupgradeneeded=()=>{let d=r.result;if(!d.objectStoreNames.contains('progress'))d.createObjectStore('progress',{keyPath:'id'});if(!d.objectStoreNames.contains('kv'))d.createObjectStore('kv');if(!d.objectStoreNames.contains('marvel'))d.createObjectStore('marvel',{keyPath:'id'})};r.onsuccess=()=>{this.db=r.result;res()};r.onerror=()=>rej(r.error)})},
  tx(store,mode='readonly'){return this.db.transaction(store,mode).objectStore(store)},
  async getAll(store){return new Promise((res,rej)=>{let r=this.tx(store).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})},
  async put(store,v){return new Promise((res,rej)=>{let r=this.tx(store,'readwrite').put(v);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})},
  async del(store,id){return new Promise((res,rej)=>{let r=this.tx(store,'readwrite').delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})},
  async clear(store){return new Promise((res,rej)=>{let r=this.tx(store,'readwrite').clear();r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})},
  async kvGet(k){return new Promise((res,rej)=>{let r=this.tx('kv').get(k);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})},
  async kvSet(k,v){return new Promise((res,rej)=>{let r=this.tx('kv','readwrite').put(v,k);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
};

async function loadJSON(url){let r=await fetch(url);if(!r.ok)throw new Error(`${url}: ${r.status}`);return r.json()}
async function init(){
  try{
    await DB.open();
    [state.meta,state.series]=await Promise.all([loadJSON('data/meta.json'),loadJSON('data/series.json')]);
    state.seriesMap=new Map(state.series.map(s=>[s.id,s]));
    let [progress,marvel]=await Promise.all([DB.getAll('progress'),DB.getAll('marvel')]);
    state.progress=new Map(progress.map(p=>[Number(p.id),p]));
    state.marvel=new Map(marvel.map(m=>[Number(m.id),m]));
    setupMeta();bind();await selectInitialDecade();updateStats();registerSW();
    requestIdle(()=>prefetchUpcoming(PREFETCH_COUNT));
    document.addEventListener('visibilitychange',handleReturnFromMarvel);
    window.addEventListener('pageshow',handleReturnFromMarvel);
  }catch(e){console.error(e);$('#issueList').innerHTML=`<div class="notice">No se pudo iniciar la aplicación: ${esc(e.message)}</div>`}
}
function requestIdle(fn){if('requestIdleCallback'in window)requestIdleCallback(fn,{timeout:1800});else setTimeout(fn,500)}
function setupMeta(){
  let m=state.meta;$('#dumpDate').textContent=m.dumpDate;$('#scopeMain').textContent=fmt.format(m.mainCount);$('#scopeRecop').textContent=fmt.format(m.collectionsCount);$('#scopeFirst').textContent=prettyDate(m.earliest);$('#scopeLast').textContent=prettyDate(m.latest);
  let opts=['<option value="all">Todas las décadas</option>'].concat(m.chunks.map(c=>`<option value="${c.id}">${c.id==='sin-fecha'?'Sin fecha':c.id+'–'+(Number(c.id)+9)} · ${fmt.format(c.count)}</option>`)).join('');
  $('#decadeFilter').innerHTML=opts;$('#recopDecade').innerHTML=m.collectionChunks.map(c=>`<option value="${c.id}">${c.id==='sin-fecha'?'Sin fecha':c.id+'–'+(Number(c.id)+9)} · ${fmt.format(c.count)}</option>`).join('')
}
function bind(){
  $$('.tab').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
  ['statusFilter','contentFilter','eraFilter','decadeFilter'].forEach(id=>$('#'+id).addEventListener('change',refresh));
  let debounce;$('#searchInput').addEventListener('input',()=>{clearTimeout(debounce);debounce=setTimeout(refresh,180)});
  $('#clearFilters').onclick=()=>{['statusFilter','contentFilter','eraFilter','decadeFilter'].forEach(id=>$('#'+id).value='all');$('#searchInput').value='';state.activeSeries=null;refresh()};
  $('#loadMore').onclick=()=>{state.page++;renderIssues()};$('#recopMore').onclick=()=>{state.recopPage++;renderRecop()};$('#recopDecade').onchange=loadRecop;
  $('#continueBtn').onclick=continueReading;$('#randomBtn').onclick=goLast;$('#settingsBtn').onclick=()=>$('#settingsDialog').showModal();
  $('#exportBtn').onclick=exportProgress;$('#importInput').onchange=importProgress;$('#resetBtn').onclick=resetProgress;$('#requestStorageBtn').onclick=requestPersistentStorage;$('#offlineBtn').onclick=downloadOffline;
  $('#seriesMore').onclick=()=>{state.seriesPage++;renderSeriesIssues()};
}

async function selectInitialDecade(){let last=await DB.kvGet('lastOrder');let chunk=state.meta.chunks[0];if(last)chunk=state.meta.chunks.find(c=>last>=c.from&&last<=c.to)||chunk;$('#decadeFilter').value=chunk.id;await refresh()}
async function ensureChunk(id){if(state.chunks.has(id))return state.chunks.get(id);let c=state.meta.chunks.find(x=>x.id===id);if(!c)return[];let data=await loadJSON('data/'+c.file);state.chunks.set(id,data);return data}
async function ensureSearch(){if(state.search)return state.search;toast('Preparando búsqueda completa…');state.search=await loadJSON('data/search.json');return state.search}
function matchText(issue,q){if(!q)return true;let s=state.seriesMap.get(issue.s);let hay=`${s?.original||''} ${s?.es||''} ${issue.n||''} ${issue.t||''}`.toLocaleLowerCase('es');return hay.includes(q)}
function matchesStatus(x,filter){let st=progressStatus(x.id);if(filter==='all')return true;if(filter==='pending')return st==='pending';if(filter==='read')return st==='read';if(filter==='skipped')return st==='skipped-reprint';if(filter==='new-material')return st==='new-material';return true}
async function refresh(){
  state.page=0;let q=$('#searchInput').value.trim().toLocaleLowerCase('es'),dec=$('#decadeFilter').value,st=$('#statusFilter').value,ct=$('#contentFilter').value,era=$('#eraFilter').value,base=[];
  if(q||state.activeSeries!==null){let idx=await ensureSearch();let candidates=idx.filter(r=>(dec==='all'||r[7]===dec)&&(ct==='all'||r[5]===ct)&&(era==='all'||r[6]===era)&&(state.activeSeries===null||r[3]===state.activeSeries));let ids=new Set(candidates.map(r=>r[1])),need=[...new Set(candidates.map(r=>r[7]))];for(let d of need){let ch=await ensureChunk(d);for(let x of ch)if(ids.has(x.id))base.push(x)}base.sort((a,b)=>a.o-b.o);if(q)base=base.filter(x=>matchText(x,q))}
  else if(dec==='all'){for(let c of state.meta.chunks){let ch=await ensureChunk(c.id);base.push(...ch)}}else base=await ensureChunk(dec);
  state.filtered=base.filter(x=>matchesStatus(x,st)&&(ct==='all'||x.c===ct)&&(era==='all'||x.e===era));renderIssues();updateActiveSeries()
}
function updateActiveSeries(){let el=$('#activeSeries');if(state.activeSeries===null){el.classList.add('hidden');return}let s=state.seriesMap.get(state.activeSeries);el.innerHTML=`Serie: <strong>${esc(s?.es||s?.original)}</strong> <button class="link-btn" id="openSeriesPage">abrir ficha</button> <button class="link-btn" id="clearSeries">quitar</button>`;el.classList.remove('hidden');$('#openSeriesPage').onclick=()=>openSeries(state.activeSeries);$('#clearSeries').onclick=()=>{state.activeSeries=null;refresh()}}
function metaBadge(id){let m=state.marvel.get(Number(id));if(!isFreshMeta(m))return '<span class="badge marvel-state pending-meta" data-meta-badge>Unlimited · …</span>';return m.available?'<span class="badge marvel-state available">Unlimited ✓</span>':'<span class="badge marvel-state unavailable">Sin Unlimited</span>'}
function card(issue,collection=false){
  let s=state.seriesMap.get(issue.s)||{},title=s.es||s.original||'Serie',translated=s.es&&s.es!==s.original,st=progressStatus(issue.id),exact=(issue.pc||'').startsWith('Fecha de venta GCD')&&!String(issue.pc||'').includes('incierta');
  let statusClass=st==='read'?'read':st==='skipped-reprint'?'skipped':st==='new-material'?'partial':'';
  return `<article class="issue ${statusClass} ${collection?'collection':''}" data-id="${issue.id}" data-order="${issue.o}" data-series="${issue.s}"><button class="check" aria-label="${st==='pending'?'Marcar leído':'Cambiar estado'}">${statusIcon(st)}</button>${collection?'':`<div class="cover-slot" data-cover-slot><div class="cover-placeholder">M</div></div>`}<div class="issue-main"><div class="issue-title">${esc(title)} <span class="muted">#${esc(issue.n||'[s/n]')}</span></div>${translated?`<div class="issue-original">${esc(s.original)}</div>`:''}<div class="issue-meta">${collection?`<span class="badge">${esc(issue.tg||'Edición')}</span>`:`<span class="badge ${issue.c}">${esc(state.meta.labels.content[issue.c]||issue.c)}</span><span class="badge">${esc(state.meta.labels.era[issue.e]||issue.e)}</span>${st!=='pending'?`<span class="badge progress-badge ${st}">${esc(statusText(st))}</span>`:''}${metaBadge(issue.id)}`}</div></div><div class="order-col"><div class="order-num">${collection?'Ed.':'#'+fmt.format(issue.o)}</div><div class="issue-date ${exact?'':'approx'}">${esc(prettyDate(issue.d))}${exact?'':' ≈'}</div></div></article>`
}
function renderIssues(){let max=(state.page+1)*state.pageSize,rows=state.filtered.slice(0,max);$('#issueList').innerHTML=rows.map(x=>card(x)).join('')||'<div class="notice">No hay resultados con estos filtros.</div>';$('#resultCount').textContent=`${fmt.format(state.filtered.length)} resultados`;$('#loadMore').classList.toggle('hidden',max>=state.filtered.length);wireCards('#issueList',false);observeVisibleCards('#issueList')}
function wireCards(sel,collection){$$(sel+' .issue').forEach(el=>{let id=Number(el.dataset.id);el.querySelector('.check').onclick=async ev=>{ev.stopPropagation();await setProgress(id,Number(el.dataset.order),progressStatus(id)==='read'?'pending':'read',collection)};el.onclick=()=>openDetail(id,collection)})}
async function setProgress(id,order,status,collection=false){
  if(status==='pending'){await DB.del('progress',id);state.progress.delete(id);toast('Marcado como pendiente')}
  else{let p={id,status,readAt:new Date().toISOString(),order,collection};await DB.put('progress',p);state.progress.set(Number(id),p);if(!collection)await DB.kvSet('lastOrder',order);toast(statusText(status))}
  updateStats();if(collection)renderRecop();else renderIssues();if(state.readerIssue?.id===Number(id))await renderReader(state.readerIssue);requestIdle(()=>prefetchUpcoming(PREFETCH_COUNT))
}
function updateStats(){let vals=[...state.progress.values()].filter(p=>!p.collection),read=vals.filter(p=>(p.status||'read')==='read').length,resolved=vals.filter(p=>['read','skipped-reprint','new-material'].includes(p.status||'read')).length,total=state.meta?.mainCount||0,pending=Math.max(total-resolved,0),pct=total?resolved/total*100:0;$('#readCount').textContent=fmt.format(read);$('#pendingCount').textContent=fmt.format(pending);$('#percentCount').textContent=(pct<10?pct.toFixed(2):pct.toFixed(1))+'%';$('#progressText').textContent=`${fmt.format(resolved)} resueltos / ${fmt.format(total)}`;$('#progressBar').style.width=Math.min(pct,100)+'%'}

async function findIssueById(id){for(let v of state.chunks.values()){let x=v.find(i=>i.id===Number(id));if(x)return x}let idx=await ensureSearch(),row=idx.find(r=>r[1]===Number(id));if(!row)return null;let ch=await ensureChunk(row[7]);return ch.find(i=>i.id===Number(id))||null}
async function nextPendingRow(afterOrder=0,seriesId=null){let idx=await ensureSearch();return idx.find(r=>r[0]>afterOrder&&!isResolved(r[1])&&(seriesId===null||r[3]===seriesId))||null}
async function continueReading(){let row=await nextPendingRow(0);if(!row){toast('Has resuelto todo el orden principal.');return}await openReaderByRow(row)}
async function goLast(){let last=await DB.kvGet('lastOrder');if(!last){continueReading();return}let idx=await ensureSearch(),row=idx.find(r=>r[0]===last)||idx.find(r=>r[0]>last);if(row)await jumpToIndexRow(row)}
async function jumpToIndexRow(row){let dec=row[7];$('#decadeFilter').value=dec;$('#statusFilter').value='all';$('#searchInput').value='';state.activeSeries=null;await refresh();let pos=state.filtered.findIndex(x=>x.id===row[1]);state.page=Math.floor(Math.max(pos,0)/state.pageSize);renderIssues();requestAnimationFrame(()=>document.querySelector(`[data-id="${row[1]}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}))}

function marvelQuery(x,s,mode){let qs=new URLSearchParams({title:String(s.original||seriesName(x.s)),issue:String(x.n||''),year:String(x.a||''),date:String(x.sv||x.d||''),gcdId:String(x.id)});return `/api/marvel/open?${qs.toString()}&mode=${mode}`}
async function fetchMarvelMeta(x,force=false){
  let cached=state.marvel.get(Number(x.id));if(!force&&isFreshMeta(cached))return cached;if(state.prefetching.has(Number(x.id)))return cached||null;state.prefetching.add(Number(x.id));
  try{return await withMetaSlot(async()=>{let s=state.seriesMap.get(x.s)||{};let r=await fetch(marvelQuery(x,s,'meta'),{headers:{Accept:'application/json'}});if(!r.ok)throw new Error(`Marvel ${r.status}`);let data=await r.json();let m={id:Number(x.id),checkedAt:new Date().toISOString(),...data};state.marvel.set(Number(x.id),m);await DB.put('marvel',m);updateRenderedMeta(x.id,m);return m})}catch(e){console.warn('Marvel meta',x.id,e);let m={id:Number(x.id),checkedAt:new Date().toISOString(),available:false,error:true};state.marvel.set(Number(x.id),m);await DB.put('marvel',m);updateRenderedMeta(x.id,m);return m}finally{state.prefetching.delete(Number(x.id))}
}
function updateRenderedMeta(id,m){$$(`[data-id="${id}"]`).forEach(el=>{let b=el.querySelector('[data-meta-badge]')||el.querySelector('.marvel-state');if(b){b.className=`badge marvel-state ${m.available?'available':'unavailable'}`;b.textContent=m.available?'Unlimited ✓':'Sin Unlimited'}let slot=el.querySelector('[data-cover-slot]');if(slot&&m.coverUrl)slot.innerHTML=`<img class="issue-cover" loading="lazy" decoding="async" src="${esc(m.coverUrl)}" alt="">`})}
let coverObserver=null;
function observeVisibleCards(root){if(!('IntersectionObserver'in window)){ $$(root+' .issue').slice(0,20).forEach(el=>hydrateIssueMeta(Number(el.dataset.id)));return }if(!coverObserver)coverObserver=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){hydrateIssueMeta(Number(e.target.dataset.id));coverObserver.unobserve(e.target)}}),{rootMargin:'350px 0px'});$$(root+' .issue').forEach(el=>coverObserver.observe(el))}
async function hydrateIssueMeta(id){let x=await findIssueById(id);if(!x)return;let cached=state.marvel.get(id);if(isFreshMeta(cached)){updateRenderedMeta(id,cached);return}await fetchMarvelMeta(x)}
async function prefetchUpcoming(count=PREFETCH_COUNT){let idx=await ensureSearch(),rows=idx.filter(r=>!isResolved(r[1])).slice(0,count);for(let i=0;i<rows.length;i+=2){await Promise.all(rows.slice(i,i+2).map(async r=>{let x=await findIssueById(r[1]);if(x&&!isFreshMeta(state.marvel.get(x.id)))await fetchMarvelMeta(x)}))}}

function reprintAdvice(x){if(x.c==='reimpresion')return `<div class="reprint-advice pure"><strong>Reimpresión completa</strong><p>GCD clasifica este número como reimpresión. Puedes omitirlo sin contarlo como lectura pendiente.</p><button type="button" class="secondary full" data-progress-action="skipped-reprint">Omitir reimpresión</button></div>`;if(x.c==='mixto')return `<div class="reprint-advice mixed"><strong>Número mixto</strong><p>GCD indica que mezcla material nuevo y reimpreso. El export actual de la PWA no conserva el desglose por historia, así que no se inventan títulos ni páginas. Si lees solo el material nuevo, puedes cerrarlo como completado sin releer lo ya publicado.</p><button type="button" class="secondary full" data-progress-action="new-material">Marcar material nuevo como leído</button></div>`;return ''}
function officialButtons(x,s,title){let spanish=String(title||s.original||'Marvel'),paniniQuery=`site:panini.es/shp_esp_es/ "${spanish}" "${x.n?'#'+x.n:''}" ${x.a||''} Marvel`,pan='https://www.google.com/search?q='+encodeURIComponent(paniniQuery);return `<div class="official-links"><a class="primary full marvel-launch" data-mode="android" href="${esc(marvelQuery(x,s,'android'))}">Abrir en Marvel Unlimited Android</a><a class="primary full marvel-launch" data-mode="ios" href="${esc(marvelQuery(x,s,'ios'))}">Abrir en Marvel Unlimited iOS</a><a class="secondary full" target="_blank" rel="noopener" href="${esc(marvelQuery(x,s,'web'))}">Abrir en Marvel Unlimited Web</a><a class="secondary full" target="_blank" rel="noopener" href="${esc(pan)}">Buscar edición en castellano</a></div>`}
async function openDetail(id,collection){
  let x=collection?(()=>{for(let v of state.recopChunks.values()){let f=v.find(i=>i.id===Number(id));if(f)return f}})():await findIssueById(id);if(!x)return;let s=state.seriesMap.get(x.s)||{},title=s.es||s.original,translated=s.es&&s.es!==s.original,exact=(x.pc||'').startsWith('Fecha de venta GCD')&&!String(x.pc||'').includes('incierta'),m=state.marvel.get(x.id);
  $('#dialogContent').innerHTML=`${!collection?`<div class="detail-cover" id="detailCover">${m?.coverUrl?`<img src="${esc(m.coverUrl)}" alt="">`:'<div class="cover-placeholder large">MARVEL</div>'}</div>`:''}<h2 class="detail-title">${esc(title)} #${esc(x.n||'[s/n]')}</h2>${translated?`<div class="detail-original">Título original: ${esc(s.original)}</div>`:''}<div class="detail-grid"><div><span>${collection?'Fecha orientativa':'Fecha de orden'}</span><strong>${esc(prettyDate(x.d))}${!exact&&!collection?' · aproximada':''}</strong></div><div><span>Año de la serie</span><strong>${esc(x.a||'—')}</strong></div>${collection?`<div><span>Tipo GCD</span><strong>${esc(x.tg||'—')}</strong></div>`:`<div><span>Precisión</span><strong>${esc(x.pc||'—')}</strong></div><div><span>Contenido</span><strong>${esc(state.meta.labels.content[x.c]||x.c)}</strong></div><div><span>Etapa</span><strong>${esc(state.meta.labels.era[x.e]||x.e)}</strong></div><div><span>Estado</span><strong>${esc(statusText(progressStatus(x.id)))}</strong></div>`}<div><span>Fecha de venta GCD</span><strong>${esc(prettyDate(x.sv))}</strong></div><div><span>Fecha de portada/publicación</span><strong>${esc(x.fp||'—')}</strong></div><div><span>Editorial de indicia</span><strong>${esc(x.ed||'—')}</strong></div><div><span>Páginas</span><strong>${esc(x.pg||'—')}</strong></div><div><span>Precio original</span><strong>${esc(x.pr||'—')}</strong></div><div><span>ID GCD</span><strong>${x.id}</strong></div></div>${!collection?reprintAdvice(x):''}${!collection?officialButtons(x,s,title):''}${!collection?`<button type="button" class="secondary full" id="openReaderBtn">Abrir modo lectura</button><button type="button" class="secondary full" id="seriesPageBtn">Abrir ficha de esta serie</button>`:''}`;
  $('#issueDialog').showModal();
  if(!collection){$('#openReaderBtn').onclick=()=>{$('#issueDialog').close();openReader(x)};$('#seriesPageBtn').onclick=()=>{$('#issueDialog').close();openSeries(x.s)};wireProgressActions($('#dialogContent'),x);wireLaunchTracking($('#dialogContent'),x);if(!isFreshMeta(m))fetchMarvelMeta(x).then(mm=>{let c=$('#detailCover');if(c&&mm?.coverUrl)c.innerHTML=`<img src="${esc(mm.coverUrl)}" alt="">`})}
}
function wireProgressActions(root,x){root.querySelectorAll('[data-progress-action]').forEach(b=>b.onclick=async()=>{await setProgress(x.id,x.o,b.dataset.progressAction,false);if($('#issueDialog').open)$('#issueDialog').close()})}
function wireLaunchTracking(root,x){root.querySelectorAll('.marvel-launch').forEach(a=>a.addEventListener('click',()=>rememberLaunch(x)))}
async function rememberLaunch(x){await DB.kvSet('lastMarvelLaunch',{id:x.id,at:Date.now()})}
async function handleReturnFromMarvel(){if(document.visibilityState==='hidden')return;let rec=await DB.kvGet('lastMarvelLaunch');if(!rec||Date.now()-rec.at>30*60*1000)return;await DB.kvSet('lastMarvelLaunch',null);let x=await findIssueById(rec.id);if(!x||isResolved(x.id))return;await openReader(x,true)}

async function openReaderByRow(row){let x=await findIssueById(row[1]);if(x)await openReader(x)}
async function openReader(x,returned=false){state.readerIssue=x;await renderReader(x,returned);if(!$('#readerDialog').open)$('#readerDialog').showModal();if(!isFreshMeta(state.marvel.get(x.id)))fetchMarvelMeta(x).then(()=>{if(state.readerIssue?.id===x.id&&$('#readerDialog').open)renderReader(x,returned)});requestIdle(()=>prefetchUpcoming(PREFETCH_COUNT))}
async function renderReader(x,returned=false){
  if(!x)return;let s=state.seriesMap.get(x.s)||{},title=s.es||s.original||'Serie',m=state.marvel.get(x.id),st=progressStatus(x.id),next=await nextPendingRow(x.o),cover=m?.coverUrl?`<img src="${esc(m.coverUrl)}" alt="Portada de ${esc(title)} #${esc(x.n)}">`:'<div class="reader-cover-placeholder">MARVEL</div>',mode=platformMode(),launch=marvelQuery(x,s,mode);
  $('#readerContent').innerHTML=`<div class="reader-progress"><span>#${fmt.format(x.o)} del orden</span><span>${esc(prettyDate(x.d))}</span></div><div class="reader-cover">${cover}</div><span class="eyebrow">MODO LECTURA</span><h2>${esc(title)} #${esc(x.n||'[s/n]')}</h2>${s.es&&s.es!==s.original?`<p class="reader-original">${esc(s.original)}</p>`:''}<div class="reader-tags"><span class="badge ${x.c}">${esc(state.meta.labels.content[x.c]||x.c)}</span>${m?`<span class="badge marvel-state ${m.available?'available':'unavailable'}">${m.available?'Unlimited ✓':'Sin Unlimited'}</span>`:''}<span class="badge progress-badge ${st}">${esc(statusText(st))}</span></div>${reprintAdvice(x)}${returned?'<div class="return-prompt"><strong>¿Has terminado este número?</strong><p>Marca el resultado y saltaré automáticamente al siguiente pendiente.</p></div>':''}<a class="primary full reader-launch marvel-launch" href="${esc(launch)}">Abrir en Marvel Unlimited</a><a class="secondary full" target="_blank" rel="noopener" href="${esc(marvelQuery(x,s,'web'))}">Abrir en navegador</a><div class="reader-actions"><button type="button" class="primary" id="readNextBtn">Leído · siguiente</button>${x.c==='reimpresion'?'<button type="button" class="secondary" id="skipNextBtn">Omitir · siguiente</button>':''}${x.c==='mixto'?'<button type="button" class="secondary" id="newNextBtn">Solo material nuevo · siguiente</button>':''}</div>${next?`<p class="next-hint">Después: ${esc(seriesName(next[3]))} #${esc(next[4]||'[s/n]')}</p>`:'<p class="next-hint">No quedan números pendientes.</p>'}`;
  wireProgressActions($('#readerContent'),x);wireLaunchTracking($('#readerContent'),x);$('#readNextBtn').onclick=()=>completeAndNext(x,'read');let sk=$('#skipNextBtn');if(sk)sk.onclick=()=>completeAndNext(x,'skipped-reprint');let nw=$('#newNextBtn');if(nw)nw.onclick=()=>completeAndNext(x,'new-material')
}
async function completeAndNext(x,status){await setProgress(x.id,x.o,status,false);let row=await nextPendingRow(x.o);if(!row){$('#readerDialog').close();toast('No quedan números pendientes.');return}let next=await findIssueById(row[1]);if(next)await openReader(next)}

async function openSeries(seriesId){
  let idx=await ensureSearch(),rows=idx.filter(r=>r[3]===Number(seriesId));state.seriesRows=rows;state.seriesPage=0;let s=state.seriesMap.get(Number(seriesId))||{},resolved=rows.filter(r=>isResolved(r[1])).length,read=rows.filter(r=>progressStatus(r[1])==='read').length,pct=rows.length?resolved/rows.length*100:0,next=rows.find(r=>!isResolved(r[1]));
  $('#seriesHeader').innerHTML=`<span class="eyebrow">SERIE</span><h2>${esc(s.es||s.original||'Serie')}</h2>${s.es&&s.es!==s.original?`<p>${esc(s.original)}</p>`:''}<div class="series-stats"><div><strong>${fmt.format(read)}</strong><span>leídos</span></div><div><strong>${fmt.format(rows.length-resolved)}</strong><span>pendientes</span></div><div><strong>${pct.toFixed(pct<10?1:0)}%</strong><span>completado</span></div></div>${next?`<button type="button" class="primary full" id="seriesContinue">Continuar esta serie · #${esc(next[4]||'[s/n]')}</button>`:'<div class="notice">Serie completamente resuelta.</div>'}`;
  if(next)$('#seriesContinue').onclick=async()=>{let x=await findIssueById(next[1]);$('#seriesDialog').close();if(x)openReader(x)};
  renderSeriesIssues();if(!$('#seriesDialog').open)$('#seriesDialog').showModal()
}
async function renderSeriesIssues(){let max=(state.seriesPage+1)*state.seriesPageSize,rows=state.seriesRows.slice(0,max),issues=[];for(let d of [...new Set(rows.map(r=>r[7]))]){let ch=await ensureChunk(d),ids=new Set(rows.filter(r=>r[7]===d).map(r=>r[1]));issues.push(...ch.filter(x=>ids.has(x.id)))}issues.sort((a,b)=>a.o-b.o);$('#seriesIssueList').innerHTML=issues.map(x=>card(x)).join('');$('#seriesMore').classList.toggle('hidden',max>=state.seriesRows.length);wireCards('#seriesIssueList',false);observeVisibleCards('#seriesIssueList')}

async function switchView(v){state.view=v;$$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.view===v));$$('.view').forEach(el=>el.classList.remove('active'));$('#'+v+'View').classList.add('active');if(v==='recop'&&!state.recopItems.length)await loadRecop()}
async function loadRecop(){let id=$('#recopDecade').value,c=state.meta.collectionChunks.find(x=>x.id===id);if(!c)return;let arr=state.recopChunks.get(id);if(!arr){arr=await loadJSON('data/'+c.file);state.recopChunks.set(id,arr)}state.recopItems=arr;state.recopPage=0;renderRecop()}
function renderRecop(){let max=(state.recopPage+1)*state.pageSize,rows=state.recopItems.slice(0,max);$('#recopList').innerHTML=rows.map(x=>card(x,true)).join('');$('#recopMore').classList.toggle('hidden',max>=state.recopItems.length);wireCards('#recopList',true)}
function exportProgress(){let payload={app:'Marvel Orden de Lectura',version:2,exportedAt:new Date().toISOString(),progress:[...state.progress.values()]};let blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`marvel-progreso-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Copia de progreso exportada')}
async function importProgress(ev){let file=ev.target.files?.[0];if(!file)return;try{let data=JSON.parse(await file.text());if(!Array.isArray(data.progress))throw new Error('Formato no reconocido');for(let p of data.progress){if(!p?.id)continue;if(!p.status)p.status='read';await DB.put('progress',p);state.progress.set(Number(p.id),p)}updateStats();if(state.view==='principal')renderIssues();else if(state.view==='recop')renderRecop();toast(`Importados ${fmt.format(data.progress.length)} registros`)}catch(e){toast('No se pudo importar la copia')}finally{ev.target.value=''}}
async function resetProgress(){if(!confirm('¿Borrar todas las marcas de lectura de este dispositivo? Esta acción no se puede deshacer salvo que tengas una copia exportada.'))return;await DB.clear('progress');state.progress.clear();updateStats();renderIssues();toast('Progreso borrado')}
async function requestPersistentStorage(){if(!navigator.storage?.persist){toast('Este navegador no ofrece esta función');return}let ok=await navigator.storage.persist();toast(ok?'Almacenamiento persistente concedido':'El navegador no lo ha concedido')}
async function downloadOffline(){if(!('caches'in window)){toast('La caché offline no está disponible');return}let b=$('#offlineBtn');b.disabled=true;let old=b.textContent;try{let files=['data/meta.json','data/series.json','data/search.json',...state.meta.chunks.map(c=>'data/'+c.file),...state.meta.collectionChunks.map(c=>'data/'+c.file)];let cache=await caches.open('marvel-lectura-v1.2.0');for(let i=0;i<files.length;i++){b.textContent=`Descargando base offline… ${i+1}/${files.length}`;let r=await fetch(files[i]);if(!r.ok)throw new Error(files[i]);await cache.put(files[i],r.clone())}b.textContent='Base completa disponible offline ✓';toast('Base completa guardada para uso offline')}catch(e){console.error(e);b.textContent=old;toast('No se pudo completar la descarga offline')}finally{b.disabled=false}}
function registerSW(){if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(console.warn)}
init();
