/* Read-only presentation helpers. Inventory balances remain owned by FioriInventory. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.FioriDashboard=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const number=value=>Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:1});
  const positiveUnit=(value,fallback)=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):fallback;
  function unitsText(pairs,settings={}){
    const qty=Math.max(0,Number(pairs)||0),sheet=positiveUnit(settings.pairsPerSheet,72),kit=positiveUnit(settings.pairsPerKit,6);
    const sheets=Math.floor(qty/sheet),rest=qty-sheets*sheet,kits=Math.floor(rest/kit),loose=rest-kits*kit;
    const parts=[];
    if(sheets)parts.push(`${number(sheets)} ${sheets===1?'ficha':'fichas'}`);
    if(kits)parts.push(`${number(kits)} ${kits===1?'kit':'kits'}`);
    if(loose)parts.push(`${number(loose)} ${loose===1?'par avulso':'pares avulsos'}`);
    return parts.join(' + ')||'0 fichas';
  }
  function modelInfo(state,idOrRef){
    const models=state.settings?.models||[],key=String(idOrRef||'').toUpperCase();
    const refOf=m=>String(m?.ref||String(m?.name||'').match(/\b\d{3}R?\b/i)?.[0]||'').toUpperCase();
    const model=models.find(m=>m.id===idOrRef)||models.find(m=>refOf(m)===key);
    const ref=refOf(model)||key;
    const name=String(model?.name||'').trim();
    const description=name.replace(/^(?:modelo\s+|ref\.?\s*)?\d{3}R?(?:\s*[-–—·:]\s*|\s+|$)/i,'').trim()
      ||String(state.settings?.costCatalog?.[ref]?.model||'').trim();
    return {id:model?.id||idOrRef,ref,description:description===ref?'':description};
  }
  function displayStateForWeek(state,week,archived){
    const snapshot=week.modelSnapshot;
    if(!archived||!Array.isArray(snapshot)||!snapshot.length)return state;
    const ids=new Set(snapshot.map(model=>model.id));
    const models=[...snapshot,...(state.settings?.models||[]).filter(model=>!ids.has(model.id))];
    // The catalog has no historical snapshot: do not present its current descriptions as past names.
    return {...state,settings:{...state.settings,models,costCatalog:{}}};
  }
  function mountingCards(state,stock,mountings=[]){
    const list=new Map(mountings.map(m=>[m.id,m]));
    for(const mounting of state.settings?.mountings||[]){
      const balance=stock[mounting.id];
      const hasBalance=Object.values(balance?.models||{}).some(m=>m.cabedal!==0)
        ||Object.values(balance?.lines||{}).some(l=>l.solado!==0||l.palmilha!==0);
      if(!list.has(mounting.id)&&hasBalance)list.set(mounting.id,mounting);
    }
    return [...list.values()].map(mounting=>{
      const balance=stock[mounting.id]||{models:{},lines:{},colorRows:[]};
      const models=Object.entries(balance.models).filter(([,m])=>m.cabedal>0).map(([id,m])=>({
        ...modelInfo(state,id),qty:m.cabedal,
        colors:(balance.colorRows||[]).filter(r=>r.sector==='cabedal'&&r.target===id&&r.qty>0)
          .map(r=>({color:r.color,qty:r.qty}))
      })).sort((a,b)=>a.ref.localeCompare(b.ref,'pt-BR',{numeric:true}));
      const lines=Object.entries(balance.lines).filter(([,line])=>line.solado>0||line.palmilha>0)
        .map(([line,values])=>({line,...values,colors:(balance.colorRows||[])
          .filter(r=>r.target===line&&['solado','palmilha'].includes(r.sector)&&r.qty>0)}))
        .sort((a,b)=>a.line.localeCompare(b.line,'pt-BR',{numeric:true}));
      return {id:mounting.id,name:mounting.name,models,lines,total:models.reduce((sum,m)=>sum+m.qty,0),balance};
    });
  }
  function remainingPlan(state,week,byModel={}){
    const items=Object.entries(week.modelGoals||{}).filter(([,qty])=>Number(qty)>0)
      .map(([id,qty])=>({...modelInfo(state,id),goal:Number(qty),done:Number(byModel[id])||0,
        remaining:Math.max(0,Number(qty)-(Number(byModel[id])||0))}))
      .sort((a,b)=>a.ref.localeCompare(b.ref,'pt-BR',{numeric:true}));
    const total=items.reduce((sum,item)=>sum+item.goal,0),goal=Number(week.goal)||0;
    return {items,total,mismatch:items.length>0&&goal>0&&total!==goal};
  }
  return {unitsText,modelInfo,displayStateForWeek,mountingCards,remainingPlan};
});
