/* Marvel Lector v1.4.0 — funciones puras para órdenes de sagas */
((root) => {
  'use strict';

  const MODE_RANK=Object.freeze({principal:0,essential:1,complete:2});
  const RESOLVED_STATUSES=new Set(['read','skipped-reprint','new-material']);
  const hasOwn=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);

  function normalizeMode(mode, fallback='essential'){
    return hasOwn(MODE_RANK,String(mode))?String(mode):fallback;
  }

  function orderedEntries(saga){
    return [...(Array.isArray(saga?.entries)?saga.entries:[])].sort((a,b)=>Number(a.order)-Number(b.order)||Number(a.issueId)-Number(b.issueId));
  }

  function entriesForMode(saga, mode='essential'){
    const selected=normalizeMode(mode,saga?.defaultMode||'essential');
    return orderedEntries(saga).filter(entry=>MODE_RANK[normalizeMode(entry.importance,'complete')]<=MODE_RANK[selected]);
  }

  function progressRecord(progress, issueId){
    if(progress&&typeof progress.get==='function')return progress.get(Number(issueId));
    return progress?.[Number(issueId)]??progress?.[String(issueId)]??null;
  }

  function progressStatus(progress, issueId){
    const record=progressRecord(progress,issueId);
    if(!record)return'pending';
    return record.status||'read';
  }

  function isResolved(progress, issueId){
    return RESOLVED_STATUSES.has(progressStatus(progress,issueId));
  }

  function sagaProgress(saga, progress, mode='essential'){
    const entries=entriesForMode(saga,mode);
    const resolved=entries.reduce((count,entry)=>count+(isResolved(progress,entry.issueId)?1:0),0);
    const read=entries.reduce((count,entry)=>count+(progressStatus(progress,entry.issueId)==='read'?1:0),0);
    const total=entries.length;
    return{mode:normalizeMode(mode,saga?.defaultMode||'essential'),resolved,read,total,pending:Math.max(total-resolved,0),percent:total?resolved/total*100:0};
  }

  function firstPending(saga, progress, mode='essential'){
    return entriesForMode(saga,mode).find(entry=>!isResolved(progress,entry.issueId))||null;
  }

  function filterEntries(entries, issuesById, progress, filters={}){
    const status=filters.status||'all';
    const content=filters.content||'all';
    const era=filters.era||'all';
    const decade=filters.decade||'all';
    const tokens=Array.isArray(filters.tokens)?filters.tokens:[];
    const normalize=typeof filters.normalize==='function'?filters.normalize:(value=>String(value??'').toLowerCase());
    const seriesFor=typeof filters.seriesFor==='function'?filters.seriesFor:(()=>({}));
    const decadeFor=typeof filters.decadeFor==='function'?filters.decadeFor:(issue=>String(issue?.d||'').slice(0,3)+'0');
    return entries.filter(entry=>{
      const issue=issuesById&&typeof issuesById.get==='function'?issuesById.get(Number(entry.issueId)):issuesById?.[entry.issueId];
      if(!issue)return false;
      const current=progressStatus(progress,entry.issueId);
      if(status==='pending'&&isResolved(progress,entry.issueId))return false;
      if(status==='read'&&!isResolved(progress,entry.issueId))return false;
      if(status!=='all'&&status!=='pending'&&status!=='read'&&current!==status)return false;
      if(content!=='all'&&issue.c!==content)return false;
      if(era!=='all'&&issue.e!==era)return false;
      if(decade!=='all'&&String(decadeFor(issue))!==String(decade))return false;
      if(tokens.length){
        const series=seriesFor(issue)||{};
        const hay=normalize(`${series.original||''} ${series.es||''} ${issue.n||''} #${issue.n||''} ${issue.t||''}`);
        if(!tokens.every(token=>hay.includes(token)))return false;
      }
      return true;
    });
  }

  function validateSaga(saga){
    const entries=orderedEntries(saga);
    const unresolvedReferences=Array.isArray(saga?.unresolvedReferences)?saga.unresolvedReferences:[];
    const issueIds=entries.map(entry=>Number(entry.issueId));
    const orders=entries.map(entry=>Number(entry.order));
    const duplicateIssueIds=[...new Set(issueIds.filter((id,index)=>issueIds.indexOf(id)!==index))];
    const duplicateOrders=[...new Set(orders.filter((order,index)=>orders.indexOf(order)!==index))];
    const unresolvedGcdIds=unresolvedReferences.map(reference=>Number(reference.gcdIssueId));
    const duplicateUnresolvedGcdIds=[...new Set(unresolvedGcdIds.filter((id,index)=>unresolvedGcdIds.indexOf(id)!==index))];
    const invalidEntries=entries.filter(entry=>!Number.isInteger(Number(entry.issueId))||!Number.isInteger(Number(entry.order))||!hasOwn(MODE_RANK,entry.importance)||!['main','tie-in'].includes(entry.type)||!String(entry.section||'').trim());
    const invalidUnresolvedReferences=unresolvedReferences.filter(reference=>!Number.isInteger(Number(reference.gcdIssueId))||hasOwn(reference,'issueId')||!String(reference.series||'').trim()||!String(reference.number||'').trim()||!String(reference.reason||'').trim()||!hasOwn(MODE_RANK,reference.importance));
    const deterministic=orders.every((order,index)=>order===index+1)&&duplicateOrders.length===0;
    const principal=new Set(entriesForMode(saga,'principal').map(entry=>entry.issueId));
    const essential=new Set(entriesForMode(saga,'essential').map(entry=>entry.issueId));
    const complete=new Set(entriesForMode(saga,'complete').map(entry=>entry.issueId));
    const principalInEssential=[...principal].every(id=>essential.has(id));
    const essentialInComplete=[...essential].every(id=>complete.has(id));
    return{
      valid:!duplicateIssueIds.length&&!duplicateOrders.length&&!duplicateUnresolvedGcdIds.length&&!invalidEntries.length&&!invalidUnresolvedReferences.length&&deterministic&&principalInEssential&&essentialInComplete,
      duplicateIssueIds,
      duplicateOrders,
      duplicateUnresolvedGcdIds,
      invalidEntries,
      invalidUnresolvedReferences,
      deterministic,
      principalInEssential,
      essentialInComplete
    };
  }

  root.MarvelSagasCore={MODE_RANK,RESOLVED_STATUSES,normalizeMode,orderedEntries,entriesForMode,progressStatus,isResolved,sagaProgress,firstPending,filterEntries,validateSaga};
})(globalThis);
