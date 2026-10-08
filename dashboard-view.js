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
  const materialSheetSize=(settings={})=>positiveUnit(settings.pairsPerSheet,72);
  function materialUnitsText(pairs,settings={}){
    const qty=Number(pairs??0),sheet=materialSheetSize(settings);
    if(!Number.isSafeInteger(qty))return 'Quantidade inválida';
    if(qty<0)return `${number(qty)} pares (saldo negativo)`;
    const sheets=Math.floor(qty/sheet),rest=qty%sheet,parts=[];
    if(sheets)parts.push(`${number(sheets)} ${sheets===1?'ficha':'fichas'}`);
    if(rest)parts.push(`${number(rest)} ${rest===1?'par':'pares'}`);
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
  // Display projection only: these values never create costs, obligations or historical snapshots.
  // Unknown history is explicitly estimated. Corrupt saved entry rates remain unpriced.
  // Returns {mountings, invalidEntries}; monetary fields are integer cents, or null on
  // aggregate overflow (with an error). Consumers must never display those nulls as zero.
  function productionValues(state,entries=[],mountings=[]){
    const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
    const positive=value=>Number.isSafeInteger(value)&&value>0;
    const validId=value=>typeof value==='string'&&value.trim()!==''&&value===value.trim();
    const validDate=value=>{
      if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.slice(0,4)==='0000')return false;
      const date=new Date(value+'T12:00:00Z');
      return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
    };
    const moneyCents=(value,allowZero=false)=>{
      // Do not coerce null, strings or sub-cent values into confirmed money.
      if(typeof value!=='number'||!Number.isFinite(value)||value<0||(!allowZero&&value===0))return null;
      const raw=String(value);
      if(!/^\d+(?:\.\d{1,2})?$/.test(raw))return null;
      const [whole,fraction='']=raw.split('.'),cents=Number(whole+fraction.padEnd(2,'0'));
      return positive(cents)||(allowZero&&cents===0)?cents:null;
    };
    const settings=object(state?.settings)?state.settings:{},current=Array.isArray(settings.mountings)?settings.mountings:[];
    const supplied=Array.isArray(mountings)?mountings:[],rows=new Map(),invalidEntries=[];
    function ensure(id,entry){
      if(!rows.has(id)){
        const snapshot=supplied.find(m=>object(m)&&m.id===id),mounting=current.find(m=>object(m)&&m.id===id);
        rows.set(id,{id,name:snapshot?.name||mounting?.name||entry?.mountingName||id||'Montagem não identificada',
          totalPairs:0,knownPairs:0,knownCents:0,estimatedPairs:0,estimatedCents:0,unpricedPairs:0,invalidEntries:[],rates:[]});
      }
      return rows.get(id);
    }
    for(const mounting of supplied)if(object(mounting)&&validId(mounting.id))ensure(mounting.id);
    function invalid(row,entry,index,reason,field){
      const issue={entryId:typeof entry?.id==='string'?entry.id:null,entryIndex:index,mountingId:row?.id??null,reason};
      if(field)issue.field=field;
      invalidEntries.push(issue);if(row)row.invalidEntries.push(issue);
    }
    function add(target,field,value,row,entry,index){
      if(target[field]===null)return;
      const total=target[field]+value;
      if(Number.isSafeInteger(total))target[field]=total;
      else{target[field]=null;invalid(row,entry,index,'aggregate_overflow',field)}
    }
    function rateFor(entry,id){
      if(Object.hasOwn(entry,'assemblyRate')){
        if(!object(entry.assemblyRate)||!positive(entry.assemblyRate.rateCents))return {error:'invalid_frozen_rate'};
        return {rateCents:entry.assemblyRate.rateCents,status:'known',source:'frozen'};
      }
      if(Object.hasOwn(entry,'mountingRate')){
        const rateCents=moneyCents(entry.mountingRate,true);
        return rateCents===null?{error:'invalid_legacy_rate'}:{rateCents,status:'known',source:'legacy_entry'};
      }
      if(!validDate(entry.date))return {error:'invalid_production_date'};
      if(settings.mountingRateHistory!==undefined&&!Array.isArray(settings.mountingRateHistory))return {error:'invalid_rate_history'};
      const history=(settings.mountingRateHistory||[]).filter(rate=>object(rate)&&rate.mountingId===id);
      if(history.some(rate=>!validDate(rate.effectiveFrom)))return {error:'invalid_rate_history'};
      const eligible=history.filter(rate=>rate.effectiveFrom<=entry.date).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom));
      if(eligible.length){
        const rate=eligible[0];
        if(!positive(rate.rateCents))return {error:'invalid_history_rate'};
        if(eligible[1]?.effectiveFrom===rate.effectiveFrom)return {error:'ambiguous_rate_history'};
        return {rateCents:rate.rateCents,status:'estimated',source:'rate_history',effectiveFrom:rate.effectiveFrom};
      }
      const snapshot=supplied.find(m=>object(m)&&m.id===id),mounting=current.find(m=>object(m)&&m.id===id);
      const snapshotCents=moneyCents(snapshot?.rate),currentCents=moneyCents(mounting?.rate);
      if(snapshotCents!==null)return {rateCents:snapshotCents,status:'estimated',source:'mounting_snapshot'};
      if(currentCents!==null)return {rateCents:currentCents,status:'estimated',source:'current_mounting'};
      return {error:'missing_rate'};
    }
    if(!Array.isArray(entries)){
      invalid(null,null,null,'invalid_entries');return {mountings:[...rows.values()],invalidEntries};
    }
    entries.forEach((entry,index)=>{
      if(!object(entry)){invalid(null,entry,index,'invalid_entry');return}
      if(entry.kind!=='finished')return;
      const id=validId(entry.mountingId)?entry.mountingId:null,row=ensure(id,entry);
      if(!positive(entry.qty)){invalid(row,entry,index,'invalid_quantity');return}
      add(row,'totalPairs',entry.qty,row,entry,index);
      const rate=id===null?{error:'invalid_mounting_id'}:rateFor(entry,id);
      const cents=rate.error?null:entry.qty*rate.rateCents;
      const validAmount=positive(cents)||(cents===0&&rate.source==='legacy_entry'&&rate.rateCents===0);
      if(rate.error||!validAmount){
        add(row,'unpricedPairs',entry.qty,row,entry,index);
        invalid(row,entry,index,rate.error||'unsafe_entry_amount');return;
      }
      const prefix=rate.status==='known'?'known':'estimated';
      add(row,prefix+'Pairs',entry.qty,row,entry,index);add(row,prefix+'Cents',cents,row,entry,index);
      let breakdown=row.rates.find(item=>item.rateCents===rate.rateCents&&item.source===rate.source&&item.effectiveFrom===rate.effectiveFrom);
      if(!breakdown){breakdown={...rate,pairs:0,cents:0};row.rates.push(breakdown)}
      add(breakdown,'pairs',entry.qty,row,entry,index);add(breakdown,'cents',cents,row,entry,index);
    });
    return {mountings:[...rows.values()],invalidEntries};
  }
  return {unitsText,materialSheetSize,materialUnitsText,modelInfo,displayStateForWeek,mountingCards,remainingPlan,productionValues};
});

