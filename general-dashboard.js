/* Read-only dashboard projections. No writes, inferred payments, reservations or reconciliation. */
(function(root,factory){
  const node=typeof module==='object'&&module.exports;
  const api=factory(node?require('./inventory-guard'):root.FioriInventory,node?require('./assembly-finance'):root.FioriAssembly);
  if(node)module.exports=api;else root.FioriGeneral=api;
})(typeof globalThis==='object'?globalThis:this,function(Inventory,Assembly){
  'use strict';
  const list=x=>Array.isArray(x)?x:[];
  const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const integer=x=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
  const date=x=>typeof x==='string'&&Inventory.validDate(x)&&x.slice(0,4)!=='0000';
  const sum=values=>{let n=0;for(const x of values){if(!integer(x)||!Number.isSafeInteger(n+x))return null;n+=x}return n};
  const add=(a,b)=>a===null||b===null||!Number.isSafeInteger(a+b)?null:a+b;
  const centsFromMills=x=>integer(x)?Number((BigInt(x)+5n)/10n):null;
  function decimal(value,places=3){
    if(typeof value!=='number'&&typeof value!=='string')return null;
    const raw=String(value).trim();if(!new RegExp('^\\d+(?:\\.\\d{1,'+places+'})?$').test(raw))return null;
    const [whole,fraction='']=raw.split('.'),n=Number(whole+fraction.padEnd(places,'0'));
    return integer(n)?n:null;
  }
  function unique(rows,label,issues){
    const seen=new Set();for(const row of rows){if(!row||typeof row.id!=='string'||!row.id||seen.has(row.id)){issues.push(label+': identificador ausente ou repetido.');return false}seen.add(row.id)}return true;
  }
  function product(item,state){
    const ref=String(item?.ref||'').trim().toUpperCase(),source=item?.sourceItem;
    if(/^(?:FORMAS|CORTE)(?:\s|$)|DESCONTO|ABATIMENTO/.test(ref))return false;
    if(source&&Object.hasOwn(source,'quantity_pairs')){
      if(!integer(item.qty)||!item.qty||source.quantity_pairs!==item.qty)return false;
      if(source.reference==null&&String(source.model||'').trim().toUpperCase()===ref&&ref)return true;
      if(String(source.reference||'').trim().toUpperCase()===ref&&ref)return true;
      return false;
    }
    if(!/^\d{3}R?$/.test(ref))return false;
    return list(state.settings?.models).filter(m=>Inventory.refOf(m)===ref).length===1||!!state.settings?.costCatalog?.[ref]||(item.costSnapshot?.reference===String(item.costReference||ref));
  }
  function itemCounts(order,state){
    let pairs=0,services=0,discounts=0,review=0;
    for(const item of list(order.items)){
      if(!object(item)){review++;continue}
      if(/desconto|abatimento/i.test(String(item?.ref||''))){discounts++;continue}
      if(product(item,state)){if(integer(item.qty)&&item.qty>0)pairs=add(pairs,item.qty);else review++}
      else if(/^(?:FORMAS|CORTE)(?:\s|$)/i.test(String(item.ref||'').trim())&&!Object.hasOwn(item.sourceItem||{},'quantity_pairs'))services++;
      else review++;
    }
    return {pairs,services,discounts,review};
  }
  function stock(state,today){
    const ledger=Inventory.ledger(state,{until:today}),issues=ledger.issues.map(x=>x.message),refs=new Map();
    const scopes=new Map();
    for(const row of ledger.rows.filter(r=>['cabedal','solado','palmilha'].includes(r.sector))){
      const model=list(state.settings?.models).find(m=>m.id===row.target);
      const target=row.scope==='global'?row.target:row.sector==='cabedal'?Inventory.refOf(model):'@line:'+row.target;
      const key=JSON.stringify([row.sector,target,Inventory.colorKey(row.color)]),balance=scopes.get(key)||{global:0,mounted:0};
      const field=row.scope==='global'?'global':'mounted';balance[field]=add(balance[field],row.qty);scopes.set(key,balance);
    }
    if([...scopes.values()].some(r=>r.global===null||r.mounted===null||r.mounted>r.global))issues.push('Saldo nas montagens maior que o saldo geral da mesma referência, material e cor.');
    const group=ref=>{if(!refs.has(ref))refs.set(ref,{ref,ready:0,globalCabedal:0,mounted:0,factory:0});return refs.get(ref)};
    for(const row of ledger.rows){
      if(!integer(row.qty)){issues.push('Saldo inválido.');continue}
      if(row.scope==='global'&&row.sector==='produto_pronto'){const r=group(row.target);r.ready=add(r.ready,row.qty)}
      if(row.scope==='global'&&row.sector==='cabedal'){const r=group(row.target);r.globalCabedal=add(r.globalCabedal,row.qty)}
      if(row.scope==='mounting'&&row.sector==='cabedal'){
        const models=list(state.settings?.models).filter(m=>m.id===row.target);
        if(models.length!==1){issues.push('Cabedal sem referência única.');continue}
        const r=group(Inventory.refOf(models[0]));r.mounted=add(r.mounted,row.qty);
      }
    }
    for(const r of refs.values()){
      if(r.globalCabedal===null||r.mounted===null||r.mounted>r.globalCabedal){r.factory=null;issues.push('Saldo geral e montagens não conferem.')}
      else r.factory=r.globalCabedal-r.mounted;
    }
    const rows=[...refs.values()].sort((a,b)=>a.ref.localeCompare(b.ref,'pt-BR',{numeric:true}));
    const totals=Object.fromEntries(['ready','mounted','factory'].map(k=>[k,issues.length?null:sum(rows.map(r=>r[k]))]));
    return {...totals,rows,issues:[...new Set(issues)],ledger};
  }
  function production(state,key,today){
    const week=state.weeks?.[key]||{},issues=[],raw=list(week.entries),entries=raw.filter(object);
    if(raw.length!==entries.length||(week.entries!==undefined&&!Array.isArray(week.entries)))issues.push('Registros de produção a conferir.');
    unique(entries,'Produção',issues);
    const end=new Date(key+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+6);const until=[end.toISOString().slice(0,10),today].sort()[0];
    const ready=entries.filter(e=>e.kind==='finished'&&date(e.date)&&e.date>=key&&e.date<=until);
    if(entries.some(e=>e.kind==='finished'&&(!date(e.date)||!integer(e.qty)||!e.qty)))issues.push('Produção com data ou quantidade a conferir.');
    const done=issues.length?null:sum(ready.map(e=>e.qty)),goal=integer(week.goal)&&week.goal>0?week.goal:null;
    if(week.goal!=null&&week.goal!==0&&!goal)issues.push('Meta inválida.');
    return {done,goal,remaining:goal!==null&&done!==null?Math.max(0,goal-done):null,issues,until};
  }
  function sales(state,month,today,clientId=''){
    const source=state.salesControl,issues=[];
    if(!source||!Array.isArray(source.orders)||!Array.isArray(source.payments)||!Array.isArray(source.clients))return {available:false,issues:['Pedidos e recebimentos ainda não disponíveis.'],orders:[],monthOrders:[],clients:[]};
    const orders=source.orders.filter(object),payments=source.payments.filter(object),clients=source.clients.filter(object);
    if(orders.length!==source.orders.length||payments.length!==source.payments.length||clients.length!==source.clients.length)issues.push('Registros de pedidos, clientes ou recebimentos a conferir.');
    unique(orders,'Pedidos',issues);unique(payments,'Recebimentos',issues);unique(clients,'Clientes',issues);
    const byId=new Map(orders.map(o=>[o.id,o])),paid=new Map(),credits=new Map();
    for(const o of orders)if(!date(o.date)||!integer(o.totalCents)||!clients.some(c=>c.id===o.clientId))issues.push('Pedido com data, cliente ou total a conferir.');
    for(const p of payments){
      if(!date(p.date)||!integer(p.amountCents)||!Array.isArray(p.allocations)||!clients.some(c=>c.id===p.clientId)){issues.push('Recebimento com data, cliente, alocações ou valor a conferir.');continue}
      let allocated=0;const seen=new Set();
      for(const a of p.allocations){
        if(!object(a)){issues.push('Alocação de recebimento inválida.');continue}
        const order=byId.get(a.orderId);
        if(!integer(a.amountCents)||!order||order.clientId!==p.clientId||order.date>p.date||seen.has(a.orderId)){issues.push('Alocação de recebimento a conferir.');continue}
        seen.add(a.orderId);allocated=add(allocated,a.amountCents);
        if(p.date<=today)paid.set(a.orderId,add(paid.has(a.orderId)?paid.get(a.orderId):0,a.amountCents));
      }
      if(allocated===null||allocated>p.amountCents)issues.push('Alocações maiores que o recebimento ou fora do limite.');
      else if(p.date<=today)credits.set(p.clientId,add(credits.has(p.clientId)?credits.get(p.clientId):0,p.amountCents-allocated));
    }
    if([...paid].some(([id,n])=>n===null||n>byId.get(id)?.totalCents))issues.push('Pedido com alocações acima do total.');
    const active=orders.filter(o=>date(o.date)&&o.date<=today&&o.deliveryStatus!=='cancelled'&&(!clientId||o.clientId===clientId));
    const rows=active.map(o=>({...o,paidCents:paid.has(o.id)?paid.get(o.id):0,balanceCents:integer(o.totalCents)&&(!paid.has(o.id)||paid.get(o.id)!==null)?Math.max(0,o.totalCents-(paid.has(o.id)?paid.get(o.id):0)):null,counts:itemCounts(o,state)}));
    const monthOrders=rows.filter(o=>o.date.slice(0,7)===month),valid=!issues.length;
    const result={available:true,issues:[...new Set(issues)],clients:[...clients].sort((a,b)=>String(a.name).localeCompare(String(b.name),'pt-BR')),orders:rows,monthOrders,
      orderCents:valid?sum(monthOrders.map(o=>o.totalCents)):null,receivableCents:valid?sum(rows.map(o=>o.balanceCents)):null,
      creditCents:valid?sum([...credits].filter(([id])=>!clientId||id===clientId).map(([,n])=>n)):null,
      receivedCents:valid?sum(payments.filter(p=>date(p.date)&&p.date<=today&&p.date.slice(0,7)===month).map(p=>p.amountCents)):null,
      pendingDelivery:rows.filter(o=>['pending','partial'].includes(o.deliveryStatus)).length,
      reviewDelivery:rows.filter(o=>!['pending','partial','delivered'].includes(o.deliveryStatus)).length};
    return result;
  }
  function finances(state,month,today){
    const issues=[],raw=state.factoryExpenses;
    if(!Array.isArray(raw))return {available:false,issues:['Gastos ainda não disponíveis.']};
    const expenses=raw.filter(object);if(expenses.length!==raw.length)issues.push('Registro de gasto a conferir.');
    unique(expenses,'Gastos',issues);
    for(const e of expenses)if(!date(e.date)||decimal(e.amount,2)===null||!['paid','pending'].includes(e.status))issues.push('Gasto com data, valor ou situação a conferir.');
    try{Assembly.expenseSummary(state,month)}catch(error){issues.push(error.message)}
    const asof=expenses.filter(e=>date(e.date)&&e.date<=today),inMonth=asof.filter(e=>e.date.slice(0,7)===month);
    const cash=inMonth.filter(e=>e.status==='paid'&&e.role!=='assembly_payable'),pending=asof.filter(e=>e.status==='pending'&&e.role!=='assembly_cash');
    const amount=rows=>issues.length?null:sum(rows.map(e=>decimal(e.amount,2)));
    const legacy=list(state.financeControl?.settlements).filter(s=>object(s)&&date(s.date)&&s.date<=today&&!Array.isArray(s.obligationIds));
    return {available:true,issues:[...new Set(issues)],cashCents:amount(cash.filter(e=>e.category!=='Pró-labore/Retirada')),
      withdrawalsCents:amount(cash.filter(e=>e.category==='Pró-labore/Retirada')),pendingCents:amount(pending),
      assemblyPendingCents:amount(pending.filter(e=>e.role==='assembly_payable')),
      legacySettlements:legacy.length,undatedPaymentBasis:true};
  }
  function itemCost(item,state){
    if(!object(item)||!integer(item.qty)||!item.qty||!product(item,state))return null;
    const mul=(unit)=>integer(unit)&&Number.isSafeInteger(unit*item.qty)?unit*item.qty:null;
    const snapshot=item.costSnapshot;
    const hasSaved=Object.hasOwn(item,'unitCostCents')||Object.hasOwn(item,'unitCostMills')||snapshot!=null;
    if(hasSaved){
      const values=[];
      if(Object.hasOwn(item,'unitCostCents'))values.push(integer(item.unitCostCents)?mul(item.unitCostCents*10):null);
      if(Object.hasOwn(item,'unitCostMills'))values.push(mul(item.unitCostMills));
      if(snapshot!=null){
        if(typeof snapshot!=='object'||Array.isArray(snapshot)||(snapshot.version!==undefined&&snapshot.version!==1))return null;
        if(snapshot.reference&&String(snapshot.reference).toUpperCase()!==String(item.costReference||item.ref).toUpperCase())return null;
        if(Object.hasOwn(snapshot,'unitCostCents'))values.push(integer(snapshot.unitCostCents)?mul(snapshot.unitCostCents*10):null);
        if(Object.hasOwn(snapshot,'lineCostCents'))values.push(integer(snapshot.lineCostCents)&&Number.isSafeInteger(snapshot.lineCostCents*10)?snapshot.lineCostCents*10:null);
      }
      if(!values.length||values.some(v=>v===null)||new Set(values).size!==1)return null;
      return {mills:values[0],source:'saved'};
    }
    const source=item.sourceItem;
    if(source&&Object.hasOwn(source,'unit_cost_brl')){
      const ref=String(item.ref).trim().toUpperCase(),sameReference=source.reference==null?String(source.model||'').trim().toUpperCase()===ref:String(source.reference).trim().toUpperCase()===ref;
      if(!sameReference||source.quantity_pairs!==item.qty)return null;
      const unit=decimal(source.unit_cost_brl);if(unit===null)return null;
      const mills=mul(unit);return mills===null?null:{mills,source:'saved'};
    }
    // Never guess a packaging-specific reference from an unrelated catalog entry.
    const ref=String(item.costReference||item.ref).toUpperCase(),catalog=state.settings?.costCatalog?.[ref];
    if(catalog?.complete!==true)return null;
    const unit=decimal(catalog.total),mills=unit===null?null:mul(unit);
    return mills===null?null:{mills,source:'catalog'};
  }
  function profit(state,orders,valid=true){
    let revenue=0,costMills=0,covered=0,catalogOrders=0,savedOrders=0,excludedCents=0;const excluded=[];
    for(const order of orders){
      const costs=list(order.items).map(item=>itemCost(item,state)),mills=sum(costs.map(c=>c?.mills));
      if(!valid||!costs.length||mills===null||!integer(order.totalCents)||(order.costSnapshotVersion!==undefined&&order.costSnapshotVersion!==1)||(Object.hasOwn(order,'costTotalCents')&&(!integer(order.costTotalCents)||centsFromMills(mills)!==order.costTotalCents))){
        excluded.push({id:order.id,date:order.date,clientId:order.clientId,reason:'Há itens sem custo correspondente, serviços, descontos ou dados a conferir.'});
        excludedCents=add(excludedCents,integer(order.totalCents)?order.totalCents:null);continue;
      }
      revenue=add(revenue,order.totalCents);costMills=add(costMills,mills);covered++;
      if(costs.some(c=>c.source==='catalog'))catalogOrders++;else savedOrders++;
    }
    const costCents=centsFromMills(costMills),grossCents=covered&&revenue!==null&&costCents!==null&&Number.isSafeInteger(revenue-costCents)?revenue-costCents:null;
    return {grossCents,revenueCents:revenue,costCents,covered,total:orders.length,catalogOrders,savedOrders,excluded,excludedCents};
  }
  function build(state,{today,week,month,clientId=''}){
    if(!date(today)||!date(week)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||month>today.slice(0,7))throw Error('Período inválido.');
    const s=sales(state,month,today,clientId),f=finances(state,month,today),p=profit(state,s.monthOrders||[],s.available&&!s.issues.length);
    const movement=[s.receivedCents,f.cashCents,f.withdrawalsCents].every(integer)?s.receivedCents-f.cashCents-f.withdrawalsCents:null;
    return {today,week,month,clientId,production:production(state,week,today),stock:stock(state,today),sales:s,finance:f,profit:p,movementCents:Number.isSafeInteger(movement)?movement:null};
  }
  return {build,stock,production,sales,finances,profit,itemCost,itemCounts,decimal};
});
