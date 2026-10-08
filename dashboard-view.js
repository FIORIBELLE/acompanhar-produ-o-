/* Read-only presentation helpers. Inventory balances remain owned by FioriInventory. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./inventory-guard'):root.FioriInventory);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.FioriDashboard=api;
})(typeof globalThis==='object'?globalThis:this,function(Inventory){
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
  // Read-only limits and leftovers by mounting/line. Never allocate shared
  // components per reference, and never count unknown colors as a confirmed match.
  function mountingLineCapacity(state,balance,options={}){
    const models=state.settings?.models||[],sourceModels=options.sourceModels||models;
    const rows=Array.isArray(balance?.colorRows)?balance.colorRows:[],groups=new Map();
    const knownLine=value=>/^\d00$/.test(String(value||''));
    const group=line=>{
      const key=knownLine(line)?String(line):'?';
      if(!groups.has(key))groups.set(key,{line:key,models:[],errors:[],warnings:[]});
      return groups.get(key);
    };
    const error=(g,message)=>{if(!g.errors.includes(message))g.errors.push(message)};
    for(const [line,values] of Object.entries(balance?.lines||{}))group(line).materials=values;
    for(const [id,values] of Object.entries(balance?.models||{})){
      const matches=models.filter(m=>m.id===id),model=matches[0];
      const line=model&&Inventory.lineOf(null,model),g=group(line);
      g.models.push({id,model,qty:values.cabedal});
      if(matches.length!==1||!knownLine(line)||!Inventory.refOf(model)||models.filter(m=>Inventory.refOf(m)===Inventory.refOf(model)).length!==1)error(g,'Referência ou linha sem identificação única.');
      const originals=sourceModels.filter(m=>m.id===id);
      if(originals.length!==1||Inventory.lineOf(null,originals[0])!==line||Inventory.usesPalmilha(originals[0],line)!==Inventory.usesPalmilha(model,line))error(g,'Cadastro de materiais alterado; confira o saldo histórico.');
    }
    // Keep malformed/orphan rows visible rather than silently dropping inventory.
    for(const row of rows){
      if(row.sector==='cabedal'&&!Object.hasOwn(balance?.models||{},row.target))error(group('?'),'Cabedal sem modelo no resumo de estoque.');
      else if(['solado','palmilha'].includes(row.sector)&&!Object.hasOwn(balance?.lines||{},row.target))error(group(row.target),'Componente sem linha no resumo de estoque.');
    }
    return [...groups.values()].map(g=>{
      const sum=values=>{let total=0;for(const value of values){if(!Number.isSafeInteger(value)||!Number.isSafeInteger(total+value)){error(g,'Quantidade inválida ou acima do limite; confira os saldos.');return null}total+=value;if(value<0)error(g,'Saldo negativo; confira os lançamentos.')}return total};
      const ids=new Set(g.models.map(m=>m.id));
      const relevant=rows.filter(r=>r.sector==='cabedal'?ids.has(r.target):['solado','palmilha'].includes(r.sector)&&r.target===g.line);
      const totals={cabedal:sum(g.models.map(m=>m.qty)),solado:sum([g.materials?.solado??0]),palmilha:sum([g.materials?.palmilha??0])};
      const unknown={cabedal:0,solado:0,palmilha:0},seen=new Set();
      for(const sector of ['cabedal','solado','palmilha']){
        const sectorRows=relevant.filter(r=>r.sector===sector);
        if(sum(sectorRows.map(r=>r.qty))!==totals[sector])error(g,'Resumo e cores não coincidem; confira os saldos.');
        unknown[sector]=sum(sectorRows.filter(r=>Inventory.colorKey(r.color)===Inventory.UNKNOWN).map(r=>r.qty));
      }
      for(const row of relevant){
        const key=JSON.stringify([row.sector,row.target,Inventory.colorKey(row.color)]);
        if(seen.has(key))error(g,'Saldo por cor repetido; confira os lançamentos.');seen.add(key);
      }
      if((options.issues||[]).length)error(g,'Há divergências de estoque; estimativa suspensa.');
      if(g.line==='?')error(g,'Linha a conferir antes de calcular.');
      const requirements=new Set(g.models.filter(m=>m.qty>0&&m.model).map(m=>Inventory.usesPalmilha(m.model,g.line)));
      // An arbitrary allocation between differing bills of materials would make
      // insole leftovers misleading. Preserve balances and request review instead.
      if(requirements.size>1)error(g,'Modelos desta linha usam materiais diferentes; confira a composição.');
      const usesPalmilha=g.line!=='300'&&(requirements.size?requirements.has(true):true);
      const capacity=g.errors.length?null:Math.min(totals.cabedal,totals.solado,usesPalmilha?totals.palmilha:Infinity);
      const knownRows=relevant.filter(r=>Inventory.colorKey(r.color)!==Inventory.UNKNOWN).map(r=>({...r,color:Inventory.colorKey(r.color)}));
      const compatible=g.errors.length?null:Inventory.possibleForMounting(state,{colorRows:knownRows});
      if(compatible!==null&&(!Number.isSafeInteger(compatible)||compatible<0||compatible>capacity))error(g,'Capacidade por cor inconsistente; confira os saldos.');
      const hasUnknown=Object.values(unknown).some(q=>q>0);
      if(hasUnknown)g.warnings.push('Há saldo sem cor discriminada. Ele permanece nos totais, mas não confirma combinação de cores.');
      if(capacity!==null&&compatible!==null&&compatible<capacity)g.warnings.push('As cores registradas não fecham o limite por quantidade. Confira antes de produzir.');
      const valid=!g.errors.length;
      const surplus=valid?{cabedal:totals.cabedal-capacity,solado:totals.solado-capacity,palmilha:totals.palmilha-(usesPalmilha?capacity:0)}:null;
      const limiting=valid?['cabedal','solado',...(usesPalmilha?['palmilha']:[])].filter(sector=>totals[sector]===capacity):[];
      return {line:g.line,totals,usesPalmilha,capacity:valid?capacity:null,compatible:valid?compatible:null,
        surplus,unknown,limiting,errors:g.errors,warnings:g.warnings};
    }).filter(g=>Object.values(g.totals).some(q=>q!==0)||g.errors.length)
      .sort((a,b)=>a.line.localeCompare(b.line,'pt-BR',{numeric:true}));
  }
  function remainingPlan(state,week,byModel={}){
    const items=Object.entries(week.modelGoals||{}).filter(([,qty])=>Number(qty)>0)
      .map(([id,qty])=>({...modelInfo(state,id),goal:Number(qty),done:Number(byModel[id])||0,
        remaining:Math.max(0,Number(qty)-(Number(byModel[id])||0))}))
      .sort((a,b)=>a.ref.localeCompare(b.ref,'pt-BR',{numeric:true}));
    const total=items.reduce((sum,item)=>sum+item.goal,0),goal=Number(week.goal)||0;
    return {items,total,mismatch:items.length>0&&goal>0&&total!==goal};
  }
  // Goals remain stored in pairs in the existing weekly modelGoals map.
  const GOAL_SHEET_SIZE=72;
  function goalModels(state,week){
    const current=state.settings?.models||[],snapshot=week.modelSnapshot||[];
    const ids=[...new Set([...current.filter(m=>m.active!==false).map(m=>m.id),...Object.keys(week.modelGoals||{})])];
    return ids.map(id=>current.find(m=>m.id===id)||snapshot.find(m=>m.id===id)||{id,name:id,active:false});
  }
  function parseGoalInput(totalInput,inputs){
    const integer=(raw,label)=>{const text=String(raw??'').trim();if(!text)return 0;if(!/^\d+$/.test(text)||!Number.isSafeInteger(Number(text)))throw Error(`${label}: use um número inteiro válido.`);return Number(text)};
    try{
      const goal=integer(totalInput,'Meta total'),modelGoals={};let total=0;
      if(goal<=0)throw Error('Digite uma meta total maior que zero.');
      for(const input of inputs){
        if(typeof input.id!=='string'||!input.id||['__proto__','constructor','prototype'].includes(input.id)||Object.hasOwn(modelGoals,input.id))throw Error('Modelo repetido ou não identificado.');
        const sheets=integer(input.sheets,'Fichas'),pairs=integer(input.pairs,'Pares avulsos');
        if(pairs>=GOAL_SHEET_SIZE)throw Error('Use de 0 a 71 pares avulsos; cada ficha contém 72 pares.');
        const quantity=sheets*GOAL_SHEET_SIZE+pairs;
        if(!Number.isSafeInteger(quantity)||!Number.isSafeInteger(total+quantity))throw Error('Quantidade acima do limite permitido.');
        modelGoals[input.id]=quantity||null;total+=quantity;
      }
      if(total>0&&total!==goal)throw Error(`As metas por modelo somam ${number(total)} pares. Ajuste a meta total ou o plano por modelo.`);
      return {ok:true,goal,modelGoals,total};
    }catch(error){return{ok:false,message:error.message}}
  }
  function referencePlan(state,week,key,until,ledger,options={}){
    const positive=value=>Number.isSafeInteger(value)&&value>0;
    const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
    const issues=Array.isArray(ledger?.issues)?ledger.issues:[],rows=Array.isArray(ledger?.rows)?ledger.rows:[];
    const items=Object.entries(week.modelGoals||{}).filter(([,goal])=>goal!==null&&goal!==undefined&&goal!==0).map(([id,goal])=>{
      const info=modelInfo(state,id),models=state.settings?.models||[];
      const errors=[];if(!positive(goal))errors.push('Meta inválida.');
      const sourceModel=(options.sourceModels||models).find(m=>m.id===id);
      const sameReference=!sourceModel||modelInfo({settings:{models:[sourceModel]}},id).ref===info.ref;
      if(!sameReference)errors.push('Referência alterada após esta semana; confira o saldo histórico.');
      if(models.filter(m=>m.id===id).length!==1||models.filter(m=>modelInfo({settings:{models:[m]}},m.id).ref===info.ref).length!==1)errors.push('Referência sem identificação única.');
      const relevant=(week.entries||[]).filter(e=>e.kind==='finished'&&e.modelId===id);
      const completed=relevant.filter(e=>validDate(e.date)&&e.date>=key&&e.date<=until);
      if(relevant.some(e=>!validDate(e.date))||completed.some(e=>!positive(e.qty)))errors.push('Produção a conferir.');
      const sum=list=>{const value=list.reduce((n,row)=>n+row.qty,0);if(!Number.isSafeInteger(value)||value<0){errors.push('Saldo inválido.');return null}return value};
      const done=sum(completed),inAssembly=sum(rows.filter(r=>r.scope==='mounting'&&r.sector==='cabedal'&&r.target===id));
      // Global cabedal already includes mounting balances. Never add those balances again.
      const cutAvailable=sameReference?sum(rows.filter(r=>r.scope==='global'&&r.sector==='cabedal'&&r.target===info.ref)):null;
      const outsideAssembly=cutAvailable!==null&&inAssembly!==null?cutAvailable-inAssembly:null;
      if(outsideAssembly!==null&&outsideAssembly<0)errors.push('Saldo geral menor que o saldo nas montagens.');
      if(!ledger||issues.length)errors.push('Há divergências de estoque a revisar.');
      return {...info,goal,done,inAssembly,cutAvailable,outsideAssembly,errors,
        remaining:positive(goal)&&done!==null?Math.max(0,goal-done):null,
        toCut:errors.length||done===null||cutAvailable===null?null:Math.max(0,goal-done-cutAvailable)};
    }).sort((a,b)=>a.ref.localeCompare(b.ref,'pt-BR',{numeric:true}));
    const total=items.reduce((sum,item)=>sum+(positive(item.goal)?item.goal:0),0);
    return{items,total,mismatch:items.length>0&&total!==week.goal};
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
  return {unitsText,materialSheetSize,materialUnitsText,modelInfo,displayStateForWeek,mountingCards,mountingLineCapacity,remainingPlan,goalModels,parseGoalInput,referencePlan,GOAL_SHEET_SIZE,productionValues};
});

