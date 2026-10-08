/* Read-only, quantity-only FIFO projection. Never changes the operational ledger. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.FioriFulfillment=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const key=value=>String(value??'').trim().toUpperCase();
  const positive=value=>Number.isSafeInteger(value)&&value>0;
  const compare=(a,b)=>String(a??'').localeCompare(String(b??''),'pt-BR',{numeric:true});
  function project(state,inventory,until){
    const models=state.settings?.models||[],mountings=state.settings?.mountings||[];
    const modelGroups=new Map();
    for(const model of models){const ref=key(inventory.refOf(model));if(!modelGroups.has(ref))modelGroups.set(ref,[]);modelGroups.get(ref).push(model)}
    const all=state.salesControl?.orders||[];
    const active=all.filter(o=>!['delivered','cancelled'].includes(o.deliveryStatus));
    const counts=new Map();for(const o of all)counts.set(o.id,(counts.get(o.id)||0)+1);
    const sorted=active.slice().sort((a,b)=>compare(a.date,b.date)||compare(a.createdAt,b.createdAt)||compare(a.id,b.id));
    const blockedRefs=new Set();
    // A partial delivery has no remaining quantity in the current schema. Do not assign its stock elsewhere.
    for(const o of active){
      const uncertain=o.deliveryStatus!=='pending'||!inventory.validDate(o.date)||!o.id||counts.get(o.id)>1;
      for(const item of o.items||[])if(uncertain||!positive(item.qty)||(modelGroups.get(key(item.ref))||[]).length>1)blockedRefs.add(key(item.ref));
    }
    const blockedLines=new Set([...blockedRefs].flatMap(ref=>(modelGroups.get(ref)||[]).map(model=>inventory.lineOf(null,model))));
    const ledger=inventory.ledger(state,until?{until}:{});
    const issues=ledger.issues.map(issue=>({...issue}));
    const componentKey=(sector,target,color)=>JSON.stringify([sector,key(target),color]);
    const globalComponents=new Map(),mountedComponents=new Map();
    for(const row of ledger.rows){
      if(!Number.isSafeInteger(row.qty))issues.push({code:'unsafe_balance',message:'Saldo fora do limite de precisão.'});
      if(!['cabedal','solado','palmilha'].includes(row.sector))continue;
      const target=row.scope==='global'?row.target:row.sector==='cabedal'?inventory.refOf(models.find(m=>m.id===row.target)):'@line:'+row.target;
      const map=row.scope==='global'?globalComponents:mountedComponents,k=componentKey(row.sector,target,row.color);
      map.set(k,(map.get(k)||0)+row.qty);
    }
    // Global adjustments have no mounting location. If they remove material still shown
    // in mountings, we cannot choose which workshop owns the remaining pieces safely.
    for(const [k,qty] of mountedComponents){
      const globalQty=globalComponents.get(k)||0;
      if(!Number.isSafeInteger(qty)||qty>globalQty){
        const [sector,target,color]=JSON.parse(k),label=target.startsWith('@LINE:')?'Linha '+target.slice(6):'Ref. '+target;
        issues.push({code:'mounting_global_divergence',sector,target,color,
          message:`${sector} · ${label} · ${inventory.colorLabel(color)}: saldo nas montagens (${qty} pares) maior que o saldo global (${globalQty} pares). Confira saídas e ajustes antes de planejar.`});
      }
    }
    const pendingQty=active.flatMap(o=>o.items||[]).filter(i=>positive(i.qty)).reduce((sum,item)=>sum+item.qty,0);
    if(!Number.isSafeInteger(pendingQty))issues.push({code:'unsafe_demand',message:'Quantidade dos pedidos fora do limite de precisão.'});
    const blocked=issues.length>0;
    const ready=new Map();
    const rows=ledger.rows.map(row=>({...row}));
    if(!blocked)for(const row of rows.filter(r=>r.scope==='global'&&r.sector==='produto_pronto'&&r.qty>0)){
      const ref=key(row.target);ready.set(ref,(ready.get(ref)||0)+row.qty);
    }
    const orderMounts=mountings.slice().sort((a,b)=>compare(a.name,b.name)||compare(a.id,b.id));
    const pool=rows.filter(r=>r.scope==='mounting');
    const material=(location,sector,line,color)=>pool.find(r=>r.location===location&&r.sector===sector&&r.target===line&&r.color===color);
    const available=row=>Math.max(0,row?.qty||0);
    const consume=(row,qty)=>{if(row)row.qty-=qty};
    const result={orders:[],issues,blocked,until:until||null,
      summary:{pairs:0,ready:0,producible:0,toProduce:0,uncovered:0,reviewItems:0}};
    for(const [position,order] of sorted.entries()){
      const view={id:order.id,clientId:order.clientId,date:order.date,priority:position+1,deliveryStatus:order.deliveryStatus,
        items:[],review:[],pairs:0,ready:0,producible:0,toProduce:0,uncovered:0};
      if(order.deliveryStatus==='partial')view.review.push('Entrega parcial: quantidade restante por item não informada.');
      else if(order.deliveryStatus!=='pending')view.review.push('Situação de entrega não reconhecida.');
      if(!inventory.validDate(order.date))view.review.push('Data do pedido inválida: confira a prioridade.');
      if(!order.id||counts.get(order.id)>1)view.review.push('Identificador do pedido ausente ou repetido.');
      if(!Array.isArray(order.items)||!order.items.length)view.review.push('Pedido sem itens identificados.');
      for(const item of order.items||[]){
        const ref=key(item.ref),matches=modelGroups.get(ref)||[];
        const lineView={ref,qty:item.qty,ready:0,producible:0,toProduce:null,uncovered:null,segments:[],missingCabedal:0,unknownColorCabedal:0,review:[],capacityReview:''};
        if(matches.length!==1)lineView.review.push(matches.length?'Referência repetida no cadastro de modelos.':'Item sem vínculo com um modelo de produção.');
        if(!positive(item.qty))lineView.review.push('Quantidade inválida.');
        if(blockedRefs.has(ref))lineView.review.push('Conferir entrega, quantidade ou prioridade dos pedidos desta referência antes de distribuir o saldo.');
        if(blocked)lineView.review.push('Estoque com pendências: projeção suspensa até a conferência.');
        if(!lineView.review.length){
          const model=matches[0],line=inventory.lineOf(null,model),needsPalm=inventory.usesPalmilha(model,line);
          lineView.ready=Math.min(item.qty,ready.get(ref)||0);ready.set(ref,(ready.get(ref)||0)-lineView.ready);
          lineView.toProduce=item.qty-lineView.ready;
          const capacityUncertain=blockedLines.has(line)&&lineView.toProduce>0;
          if(capacityUncertain){
            lineView.capacityReview=`Capacidade da linha ${line} a conferir: outro pedido desta linha tem entrega, quantidade ou prioridade incerta. Os materiais compartilhados não foram distribuídos.`;
            result.summary.reviewItems++;
          }
          let remaining=capacityUncertain?0:lineView.toProduce;
          const cabedais=orderMounts.flatMap(mt=>pool.filter(r=>r.location===mt.id&&r.sector==='cabedal'&&r.target===model.id&&r.color!==inventory.UNKNOWN&&r.qty>0)
            .sort((a,b)=>compare(a.color,b.color)).map(r=>({row:r,mt})));
          const segmentFor=(entry)=>{
            let segment=lineView.segments.find(s=>s.mountingId===entry.mt.id&&s.color===entry.row.color);
            if(!segment){segment={mountingId:entry.mt.id,mountingName:entry.mt.name,color:entry.row.color,cabedal:0,producible:0,missingSolado:0,missingPalmilha:0};lineView.segments.push(segment)}
            return segment;
          };
          // First use complete sets wherever available, then earmark the remaining uppers and partial materials.
          // All consumption is on private copies, shared by every order in this projection.
          for(const entry of cabedais){
            if(!remaining)break;
            const cab=entry.row,sole=material(cab.location,'solado',line,cab.color),palm=material(cab.location,'palmilha',line,cab.color);
            const qty=Math.min(remaining,available(cab),available(sole),needsPalm?available(palm):Infinity);
            if(!qty)continue;
            consume(cab,qty);consume(sole,qty);if(needsPalm)consume(palm,qty);
            const segment=segmentFor(entry);segment.cabedal+=qty;segment.producible+=qty;
            lineView.producible+=qty;remaining-=qty;
          }
          for(const entry of cabedais){
            if(!remaining)break;
            const cab=entry.row,qty=Math.min(remaining,available(cab));if(!qty)continue;
            const sole=material(cab.location,'solado',line,cab.color),palm=material(cab.location,'palmilha',line,cab.color);
            const soleQty=Math.min(qty,available(sole)),palmQty=needsPalm?Math.min(qty,available(palm)):qty;
            consume(cab,qty);consume(sole,soleQty);if(needsPalm)consume(palm,palmQty);
            const segment=segmentFor(entry);segment.cabedal+=qty;segment.missingSolado+=qty-soleQty;segment.missingPalmilha+=qty-palmQty;
            remaining-=qty;
          }
          lineView.unknownColorCabedal=pool.filter(r=>r.sector==='cabedal'&&r.target===model.id&&r.color===inventory.UNKNOWN).reduce((n,r)=>n+available(r),0);
          lineView.missingCabedal=capacityUncertain?null:remaining;
          lineView.uncovered=lineView.toProduce-lineView.producible;
          for(const field of ['ready','producible','toProduce','uncovered'])view[field]+=lineView[field];
          view.pairs+=item.qty;
        }else result.summary.reviewItems++;
        view.items.push(lineView);
      }
      for(const field of ['pairs','ready','producible','toProduce','uncovered'])result.summary[field]+=view[field];
      result.orders.push(view);
    }
    return result;
  }
  return {project};
});
