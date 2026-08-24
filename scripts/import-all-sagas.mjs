import fs from 'node:fs/promises';
import path from 'node:path';
import{buildGeneratedSaga,loadLibrary,parseIssueLines,parseCbroHtml}from'./saga-importer-lib.mjs';

const root=process.cwd();
const sagasRoot=path.join(root,'source','data','sagas');
const artifactsRoot=path.join(root,'artifacts','sagas');
const cacheRoot=path.join('/tmp','marvel-lector-saga-sources');
const generatedDate='2026-08-24';
const timelineUrl='https://comicbookreadingorders.com/marvel/event-timeline/';
const curatedIds=new Set(['secret-wars-1984','infinity-gauntlet','secret-wars-2015']);

const inlineOrders={
  'reed-richards-and-sue-storms-wedding-1965':['Fantastic Four Annual #3 (1965)'],
  'kree-skrull-war-1971':Array.from({length:9},(_,index)=>`Avengers #${89+index} (1971)`),
  'original-clone-saga-1973':Array.from({length:13},(_,index)=>`Amazing Spider-Man #${139+index} (1974)`),
  'the-night-gwen-stacy-died-1973':['Amazing Spider-Man #121 (1973)','Amazing Spider-Man #122 (1973)'],
  'phoenix-saga-1976':Array.from({length:8},(_,index)=>`X-Men #${101+index} (1976)`),
  'dark-phoenix-saga-1980':Array.from({length:9},(_,index)=>`The X-Men #${129+index} (1980)`),
  'days-of-future-past-1981':['The X-Men #141 (1981)','Uncanny X-Men #142 (1981)'],
  'contest-of-champions-1982':['Marvel Super Hero Contest of Champions #1 (1982)','Marvel Super Hero Contest of Champions #2 (1982)','Marvel Super Hero Contest of Champions #3 (1982)'],
  'mys-tech-wars-1993':Array.from({length:4},(_,index)=>`Mys-Tech Wars #${index+1} (1993)`),
  'legion-quest-1995':['X-Men #38 (1994)','X-Factor #108 (1994)','Uncanny X-Men #319 (1994)','X-Men #39 (1994)','X-Men Legends #1 (2021)','X-Men Legends #2 (2021)','X-Factor #109 (1994)','Uncanny X-Men #320 (1995)','X-Men #40 (1995)','Uncanny X-Men #321 (1995)','X-Men #41 (1995)','Cable #20 (1995)'],
  'marvel-vs-dc-1996':['Marvel versus DC / DC versus Marvel #1 (1996)','Marvel versus DC / DC versus Marvel #2 (1996)','Marvel versus DC / DC versus Marvel #3 (1996)','Marvel versus DC / DC versus Marvel #4 (1996)'],
  'infinity-abyss-2002':Array.from({length:6},(_,index)=>`Infinity Abyss #${index+1} (2002)`),
  'secret-war-2004':Array.from({length:5},(_,index)=>`Secret War #${index+1} (2004)`),
  'iron-man-extremis-2005':Array.from({length:6},(_,index)=>`Iron Man #${index+1} (2005)`),
  'rise-and-fall-of-the-shiar-empire-2006':Array.from({length:12},(_,index)=>`Uncanny X-Men #${475+index} (2006)`),
  'silent-war-2007':Array.from({length:6},(_,index)=>`Silent War #${index+1} (2007)`),
  'world-war-hulk-aftersmash-2007':['World War Hulk: Aftersmash #1 (2008)','Incredible Hulk #112 (2008)','The Incredible Hercules #113 (2008)','The Incredible Hercules #114 (2008)','The Incredible Hercules #115 (2008)','WWH Aftersmash: Damage Control #1 (2008)','WWH Aftersmash: Damage Control #2 (2008)','WWH Aftersmash: Damage Control #3 (2008)',...Array.from({length:5},(_,index)=>`World War Hulk Aftersmash: Warbound #${index+1} (2008)`) ],
  'avengers-the-childrens-crusade-2010':Array.from({length:9},(_,index)=>`Avengers: The Children's Crusade #${index+1} (2010)`),
  'doomwar-2010':Array.from({length:6},(_,index)=>`Doomwar #${index+1} (2010)`),
  'dying-wish-2012':['Amazing Spider-Man #698 (2012)','Amazing Spider-Man #699 (2012)','Amazing Spider-Man #700 (2012)'],
  'imperial-2025':['Imperial #1 (2025)','Imperial #2','Imperial #3','Imperial War: Black Panther #1 (2025)','Imperial War: Planet She-Hulk #1 (2025)','Imperial War: Exiles #1 (2025)','Imperial War: Nova - Centurion #1 (2025)','Imperial War: Imperial Guardians #1 (2025)','Imperial #4'],
  'one-world-under-doom-2025':[
    'Fantastic Four #28 (2022)','One World Under Doom #1 (2025)','Storm #5 (2024)','X-Factor #7 (2024)','Doom Academy #1 (2025)','Thunderbolts: Doomstrike #1 (2025)','Weapon X-Men #1 (2025)','Fantastic Four #29','Red Hulk #1 (2025)',
    ...Array.from({length:5},(_,index)=>`Doctor Strange of Asgard #${index+1} (2025)`),
    'One World Under Doom #2','Fantastic Four #30','Iron Man #6 (2024)','NYX #9 (2024)','Amazing Spider-Man #69 (2022)','Doom Academy #2','Doom’s Division #1 (2025)','Red Hulk #2','Thunderbolts: Doomstrike #2','Amazing Spider-Man #70','Iron Man #7','Superior Avengers #1 (2025)',
    ...Array.from({length:3},(_,index)=>`Avengers Academy: Marvel's Voices Infinity Comic #${43+index} (2025)`),
    ...Array.from({length:3},(_,index)=>`Astonishing Avengers Infinity Comic #${21+index} (2025)`),
    'One World Under Doom #3','Fantastic Four #31','Fantastic Four #32','Fantastic Four #33','Avengers #25 (2023)','Red Hulk #3','Doom Academy #3','Thunderbolts: Doomstrike #3','Doom’s Division #2',
    'Fantastic Four #1 (2025)','Fantastic Four #2 (2025)','Fantastic Four #3 (2025)','One World Under Doom #4','Red Hulk #4','Thunderbolts: Doomstrike #4','Iron Man #8','Doom Academy #4','Thunderbolts: Doomstrike #5','Superior Avengers #2','Avengers #26','Avengers #27','Avengers #28','Doom’s Division #3','Red Hulk #5',
    'One World Under Doom #5','Runaways #1 (2025)','Doomed 2099 #1 (2025)','Doom’s Division #4','Doom Academy #5','Superior Avengers #3','Iron Man #9','G.O.D.S.: One World Under Doom #1 (2025)','Doom’s Division #5','Iron Man #10','Red Hulk #6','Runaways #2','Superior Avengers #4',
    'One World Under Doom #6','Red Hulk #7','Superior Avengers #5','Superior Avengers #6','Runaways #3','One World Under Doom #7','Red Hulk #8','Runaways #4','Red Hulk #9','One World Under Doom #8','Fantastic Four #4 (2025)','Runaways #5','Red Hulk #10','One World Under Doom #9','The Will of Doom #1 (2025)','Captain America #6 (2025)'
  ],
  'x-men-age-of-revelation-2025':[
    'X-Men #19 (2024)','X-Men: Age of Revelation #0 (2025)','X-Men #22 (2024)','X-Men: Age of Revelation Overture #1 (2025)',
    ...Array.from({length:9},(_,index)=>`X-Men: Age of Revelation Infinity Comic #${index+1} (2025)`),
    'Amazing X-Men #1 (2025)','Binary #1 (2025)','Laura Kinney: Sabretooth #1 (2025)','Longshots #1 (2025)','World of Revelation #1 (2025)',
    'Unbreakable X-Men #1 (2025)','Rogue Storm #1 (2025)','Iron & Frost #1 (2025)','Sinister’s Six #1 (2025)',
    'X-Men: Book of Revelation #1 (2025)','The Last Wolverine #1 (2025)','Omega Kids #1 (2025)','Radioactive Spider-Man #1 (2025)',
    'Expatriate X-Men #1 (2025)','Cloak or Dagger #1 (2025)','Undeadpool #1 (2025)','X-Vengers #1 (2025)',
    'Amazing X-Men #2','Binary #2','Longshots #2','Laura Kinney: Sabretooth #2','Unbreakable X-Men #2','Rogue Storm #2','Iron & Frost #2','Sinister’s Six #2','X-Men: Book of Revelation #2','Omega Kids #2','The Last Wolverine #2','Radioactive Spider-Man #2','Undeadpool #2','Cloak or Dagger #2','X-Vengers #2','Expatriate X-Men #2',
    'Amazing X-Men #3','Binary #3','Longshots #3','Laura Kinney: Sabretooth #3','Unbreakable X-Men #3','Sinister’s Six #3','Rogue Storm #3','Iron & Frost #3','X-Men: Book of Revelation #3','The Last Wolverine #3','Omega Kids #3','Radioactive Spider-Man #3','Expatriate X-Men #3','Undeadpool #3','Cloak or Dagger #3','X-Vengers #3',
    'X-Men: Age of Revelation Finale #1 (2025)','X-Men #23 (2024)','X-Men #24 (2024)','X-Men #25 (2024)'
  ],
  'amazing-spider-man-venom-death-spiral-2026':[
    'Amazing Spider-Man / Venom: Death Spiral #1 (2026)',
    'Amazing Spider-Man #23 (2025)',
    'Venom #255 (2025)',
    'Amazing Spider-Man #24 (2025)',
    'Amazing Spider-Man #25 (2025)',
    'Venom #256 (2025)',
    'Amazing Spider-Man #26 (2025)',
    'Venom #257 (2025)',
    'Amazing Spider-Man #27 (2025)',
    'Amazing Spider-Man / Venom: Death Spiral - Body Count #1 (2026)'
  ],
  'avengers-armageddon-2026':[
    'The Will of Doom #1 (2025)',
    'Captain America #6 (2025)',
    'Captain America #7 (2025)',
    'Wolverine: Weapons of Armageddon #1 (2026)',
    'Captain America #8 (2025)',
    'Wolverine: Weapons of Armageddon #2 (2026)',
    'Captain America #9 (2025)',
    'Captain America #10 (2025)',
    'Wolverine: Weapons of Armageddon #3 (2026)',
    'Captain America #11 (2025)',
    'Wolverine: Weapons of Armageddon #4 (2026)',
    'Armageddon / X-Men CGD 2026 #1 (2026)',
    'Avengers: Armageddon #1 (2026)',
    'Captain America #12 (2025)',
    'Avengers: Armageddon #2 (2026)',
    'Captain America #13 (2025)',
    'Captain America #14 (2025)',
    'Avengers: Armageddon #3 (2026)',
    'Captain America #15 (2025)',
    'Avengers: Armageddon #4 (2026)',
    'Avengers: Armageddon #5 (2026)',
    'Captain America #16 (2025)'
  ],
  'dnx-2026':[
    'X-Men #35 (2024)',
    'X-Men #36 (2024)',
    'DNX #1 (2026)',
    'X-Men #37 (2024)',
    'DNX #2 (2026)',
    'X-Men #38 (2024)',
    'Fantastic Four #17 (2025)',
    'DNX #3 (2026)',
    'X-Men #39 (2024)',
    'Fantastic Four #18 (2025)',
    'X-Men #40 (2024)',
    'DNX #4 (2026)',
    'X-Men #41 (2024)',
    'DNX #5 (2026)'
  ],
  'queen-in-black-2026':[
    'Amazing Spider-Man 1000 / Queen in Black CGD 2026 #1 (2026)',
    'Queen in Black #1 (2026)',
    'Queen in Black: Hela #1 (2026)',
    'Queen in Black: Defenders of Light and Dark #1 (2026)',
    'Queen in Black: Venom Unchained #1 (2026)',
    'Queen in Black #2 (2026)',
    'Venom #260 (2025)',
    'Queen in Black: Thor #1 (2026)',
    'Queen in Black #3 (2026)',
    'Queen in Black: Defenders of Light and Dark #2 (2026)',
    'Queen in Black: Venom Unchained #2 (2026)',
    'Venom #261 (2025)',
    'Black Cat #14 (2025)',
    'Queen in Black #4 (2026)',
    'Queen in Black: Defenders of Light and Dark #3 (2026)',
    'Queen in Black #5 (2026)',
    'Queen in Black: Venom Unchained #3 (2026)',
    'Venom #262 (2025)',
    'The Amazing Venom #1 (2026)'
  ]
};

const inlineSourceUrls={
  'legion-quest-1995':'https://comicbookreadingorders.com/marvel/events/age-of-apocalypse-reading-order/',
  'world-war-hulk-aftersmash-2007':'https://comicbookreadingorders.com/marvel/events/world-war-hulk-reading-order/',
  'imperial-2025':['https://www.marvel.com/comics/guides/2518/imperial','https://www.howtolovecomics.com/2025/05/21/imperial-reading-order/'],
  'one-world-under-doom-2025':['https://www.marvel.com/comics/guides/2493/one_world_under_doom','https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/one-world-under-doom/'],
  'x-men-age-of-revelation-2025':['https://www.marvel.com/comics/guides/2522/xmen_age_of_revelation','https://www.howtolovecomics.com/2025/09/24/x-men-age-of-revelation-reading-order/'],
  'amazing-spider-man-venom-death-spiral-2026':['https://www.marvel.com/comics/guides/2530/amazing_spidermanvenom_death_spiral','https://www.howtolovecomics.com/2026/02/11/spider-man-venom-death-spiral-reading-order-checklist/'],
  'avengers-armageddon-2026':['https://www.marvel.com/comics/guides/2531/the_road_to_avengers_armageddon','https://www.howtolovecomics.com/2026/04/15/avengers-armageddon-reading-order/'],
  'dnx-2026':['https://www.marvel.com/articles/comics/the-official-dnx-reading-guide','https://www.howtolovecomics.com/2026/08/16/dnx-reading-order-checklist/'],
  'queen-in-black-2026':['https://www.marvel.com/articles/comics/queen-in-black-finale-tie-in-issues-venomworld-emerges-september-2026','https://www.howtolovecomics.com/2026/04/12/queen-in-black-reading-order/']
};

const centralSeriesOverrides={
  'imperial-2025':['Imperial'],
  'one-world-under-doom-2025':['One World Under Doom'],
  'x-men-age-of-revelation-2025':['X-Men: Age of Revelation','X-Men: Age of Revelation Overture','X-Men: Age of Revelation Finale'],
  'avengers-armageddon-2026':['Avengers: Armageddon'],
  'dnx-2026':['DNX'],
  'queen-in-black-2026':['Queen in Black']
};

function cacheName(url){
  return Buffer.from(url).toString('base64url')+'.html';
}

async function fetchCached(url){
  await fs.mkdir(cacheRoot,{recursive:true});
  const file=path.join(cacheRoot,cacheName(url));
  try{return await fs.readFile(file,'utf8')}catch{}
  const response=await fetch(url,{headers:{Accept:'text/html','User-Agent':'MarvelLectorSagaImporter/1.5 (+https://github.com/CPJA88/marvel-orden-lectura)'}});
  if(!response.ok)throw new Error(`${url}: HTTP ${response.status}`);
  const html=await response.text();
  await fs.writeFile(file,html);
  return html;
}

async function mapLimit(rows,limit,callback){
  const output=new Array(rows.length);let cursor=0;
  async function worker(){
    while(cursor<rows.length){const index=cursor++;output[index]=await callback(rows[index],index)}
  }
  await Promise.all(Array.from({length:Math.min(limit,rows.length)},worker));
  return output;
}

function decadeOf(year){return`${Math.floor(Number(year)/10)*10}s`}
function json(value){return JSON.stringify(value,null,2)+'\n'}

const catalogPath=path.join(sagasRoot,'catalog.json');
const catalog=JSON.parse(await fs.readFile(catalogPath,'utf8'));
const library=await loadLibrary(root);
const targetEvents=catalog.events.filter(event=>!curatedIds.has(event.id)&&(event.catalogSource==='cbro-timeline'||inlineOrders[event.id]));
console.log(`Biblioteca: ${library.issues.length} números. Importando ${targetEvents.length} eventos históricos en un solo lote…`);

const sourceResults=await mapLimit(targetEvents,6,async(event,index)=>{
  try{
    let references,sourceUrl,sourceUrls=[];
    if(inlineOrders[event.id]){
      references=parseIssueLines(inlineOrders[event.id],event.year);
      const configured=inlineSourceUrls[event.id]||timelineUrl;
      [sourceUrl,...sourceUrls]=Array.isArray(configured)?configured:[configured];
    }else{
      sourceUrl=event.referenceUrl;
      if(!sourceUrl)throw new Error('El catálogo no proporciona una fuente de orden.');
      references=parseCbroHtml(await fetchCached(sourceUrl),event.year);
    }
    if(!references.length)throw new Error('La fuente no produjo referencias de números individuales.');
    const saga=buildGeneratedSaga(event,references,library.index,{timelineUrl,sourceUrl,sourceUrls,centralSeriesNames:centralSeriesOverrides[event.id]||[],strictEventYear:Number(event.year)>=2026});
    console.log(`[${index+1}/${targetEvents.length}] ${event.title}: ${saga.entries.length}/${references.length} enlazadas`);
    return{event,saga,references,error:null};
  }catch(error){
    console.warn(`[${index+1}/${targetEvents.length}] ${event.title}: ERROR ${error.message}`);
    return{event,saga:null,references:[],error:error.message};
  }
});

const bundles=new Map();
for(const result of sourceResults.filter(result=>result.saga)){
  const decade=decadeOf(result.event.year);
  if(!bundles.has(decade))bundles.set(decade,{});
  bundles.get(decade)[result.event.id]=result.saga;
}
for(const [decade,events]of [...bundles].sort()){
  await fs.writeFile(path.join(sagasRoot,`events-${decade}.json`),json({schemaVersion:1,generatedAt:generatedDate,source:'Comic Book Reading Orders + biblioteca local GCD',events}));
}

const resultById=new Map(sourceResults.map(result=>[result.event.id,result]));
catalog.schemaVersion=3;
catalog.catalogVersion=`${generatedDate}-bulk`;
catalog.scope.caveat='Catálogo masivo basado en la cronología de CBRO y ampliado con guías oficiales de Marvel para 2025–2027. Los IDs se enlazan solo mediante coincidencias deterministas con la biblioteca; toda ausencia o ambigüedad permanece documentada dentro del evento.';
catalog.events=catalog.events.map(event=>{
  if(curatedIds.has(event.id))return event;
  const result=resultById.get(event.id);
  if(!result?.saga){
    const{dataFile,dataKey,linkedReferences,targetReferences,unresolvedReferences,...base}=event;
    const availabilityReason=event.id==='star-wars-marvel-hope-assembles-2027'?'Anunciado para enero de 2027: todavía no hay números publicados ni issueId reales en la biblioteca.':result?.error||'Evento anunciado o todavía sin un orden individual publicable.';
    return{...base,status:'planned',availabilityReason};
  }
  const saga=result.saga;
  const{availabilityReason,...base}=event;
  return{...base,description:saga.description,status:'available',coverIssueId:saga.entries.find(entry=>entry.importance==='principal')?.issueId||saga.entries[0]?.issueId,defaultMode:saga.defaultMode,dataFile:`data/sagas/events-${decadeOf(event.year)}.json`,dataKey:event.id,linkedReferences:saga.entries.length,targetReferences:saga.entries.length+saga.unresolvedReferences.length,unresolvedReferences:saga.unresolvedReferences.length};
});
await fs.writeFile(catalogPath,json(catalog));

const reportRows=sourceResults.map(({event,saga,references,error})=>({id:event.id,title:event.title,year:event.year,status:saga?'available':'planned',sourceReferences:references.length,linkedReferences:saga?.entries.length||0,unresolvedReferences:saga?.unresolvedReferences.length||0,counts:saga?.expectedCounts||null,targetCounts:saga?.targetCounts||null,error}));
const totals=reportRows.reduce((sum,row)=>({events:sum.events+1,available:sum.available+(row.status==='available'),sourceReferences:sum.sourceReferences+row.sourceReferences,linkedReferences:sum.linkedReferences+row.linkedReferences,unresolvedReferences:sum.unresolvedReferences+row.unresolvedReferences}),{events:0,available:0,sourceReferences:0,linkedReferences:0,unresolvedReferences:0});
const curatedTotals={events:3,available:3,sourceReferences:372,linkedReferences:370,unresolvedReferences:2};
const catalogTotals={events:catalog.events.length,available:catalog.events.filter(event=>event.status==='available').length,planned:catalog.events.filter(event=>event.status==='planned').length,sourceReferences:totals.sourceReferences+curatedTotals.sourceReferences,linkedReferences:totals.linkedReferences+curatedTotals.linkedReferences,unresolvedReferences:totals.unresolvedReferences+curatedTotals.unresolvedReferences};
await fs.mkdir(artifactsRoot,{recursive:true});
await fs.writeFile(path.join(artifactsRoot,'all-events-import-validation.json'),json({generatedAt:generatedDate,timelineUrl,curatedEvents:[...curatedIds],totals,curatedTotals,catalogTotals,events:reportRows}));
const markdown=['# Importación masiva de sagas Marvel','',`Fecha de generación: ${generatedDate}.`,`Fuente cronológica: ${timelineUrl}.`,'',`Catálogo final: **${catalogTotals.available} de ${catalogTotals.events}** eventos disponibles; **${catalogTotals.linkedReferences} de ${catalogTotals.sourceReferences}** referencias enlazadas; **${catalogTotals.unresolvedReferences}** ausentes o ambiguas documentadas; **${catalogTotals.planned}** anuncio futuro todavía sin números publicados.`,'',`Lote generado: **${totals.events}** eventos; **${totals.linkedReferences} / ${totals.sourceReferences}** referencias enlazadas. Los tres eventos curados aportan otras **${curatedTotals.linkedReferences} / ${curatedTotals.sourceReferences}**.`,'','| Año | Evento | Fuente | Enlazadas | Pendientes | Estado |','|---:|---|---:|---:|---:|---|',...reportRows.map(row=>`| ${row.year} | ${row.title.replace(/\|/g,'\\|')} | ${row.sourceReferences} | ${row.linkedReferences} | ${row.unresolvedReferences} | ${row.error?`Error: ${row.error}`:'Disponible'} |`),'','## Criterio editorial','','- Los tres eventos previamente curados conservan sus archivos y niveles Principal/Esencial/Completo.','- Si la fuente contiene una serie central homónima inequívoca, esa serie forma Principal y el resto entra solo en Completo.','- Si no existe serie central inequívoca, el orden cruzado completo forma Principal.','- Esencial no se rellena automáticamente: coincide con Principal hasta una futura revisión editorial manual.','- Para referencias anunciadas en 2026 se exige coincidencia exacta de año, evitando enlazarlas con volúmenes antiguos de igual numeración.','- Ninguna ambigüedad genera un `issueId`; queda en `unresolvedReferences`.',''];
await fs.writeFile(path.join(artifactsRoot,'all-events-import-validation.md'),markdown.join('\n'));
console.log(`Importación terminada: ${totals.available}/${totals.events} eventos; ${totals.linkedReferences}/${totals.sourceReferences} referencias enlazadas; ${totals.unresolvedReferences} documentadas.`);
