/* Append-only physical stock corrections. No production or financial mutations. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FioriStockAdjustments=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const sectors=['produto_pronto','cabedal','solado','palmilha'];
  const stable=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(stable(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(stable(value[k]))])):value);
  const fail=message=>{throw Error(message)};
  function context(state,input,options){
    const inv=options?.inventory;
    if(!inv?.ledger)fail('Motor de estoque indisponível. Atualize o aplicativo.');
    if(!inv.validDate(input.date)||!inv.validDate(options.today)||input.date>options.today)fail('Informe uma data válida, até hoje.');
    if(typeof options.now!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(options.now)||!Number.isFinite(Date.parse(options.now)))fail('Horário do ajuste inválido.');
    if(typeof input.batchId!=='string'||!input.batchId.trim()||input.batchId.length>150)fail('Identificador do lote inválido.');
    if(typeof input.reason!=='string'||!input.reason.trim()||input.reason.trim().length>500)fail('Informe o motivo do ajuste, até 500 caracteres.');
    const issues=inv.validate(state);if(issues.length)fail(issues[0].message);
    return inv;
  }
  function normalizeRow(state,row,inv){
    if(!row||!sectors.includes(row.sector)||!['in','out'].includes(row.direction)||!Number.isSafeInteger(row.qty)||row.qty<=0)fail('Setor, movimento ou quantidade inválida. Use pares inteiros positivos.');
    if(typeof row.color!=='string'||!row.color.trim())fail('Informe a cor ou escolha Sem cor discriminada.');
    let ref=String(row.ref||'').trim().toUpperCase();
    const shared=['solado','palmilha'].includes(row.sector);
    if(shared){if(!/^@LINE:\d00$/.test(ref))fail('Escolha a linha do material.');ref='@line:'+ref.slice(6);if(!state.settings.models.some(m=>inv.lineOf(null,m)===ref.slice(6)))fail('Linha do ajuste ausente no cadastro.')}
    else if(!/^\d{3}R?$/.test(ref)||state.settings.models.filter(m=>inv.refOf(m)===ref).length!==1)fail('Referência ausente, inválida ou ambígua.');
    const result={direction:row.direction,sector:row.sector,ref,color:inv.colorLabel(inv.colorKey(row.color)),qty:row.qty};
    if(row.mountingId!==undefined){
      if(!state.settings.mountings.some(m=>m.id===row.mountingId)||row.sector==='produto_pronto')fail('Escolha uma montagem válida para os materiais. Produto pronto usa o saldo geral.');
      if(row.sector==='cabedal'&&state.settings.models.filter(m=>inv.refOf(m)===ref).length!==1)fail('Referência do cabedal ausente ou ambígua.');
      result.mountingId=row.mountingId;
    }
    if(row.reversalOf!==undefined)result.reversalOf=row.reversalOf;
    return result;
  }
  function append(state,input,options,allowReversal){
    const inv=context(state,input,options);
    if(!Array.isArray(input.rows)||!input.rows.length)fail('Nenhum saldo para ajustar.');
    const seen=new Set(), reason=input.reason.trim();
    const movements=input.rows.map((raw,index)=>{
      if(raw.reversalOf!==undefined&&!allowReversal)fail('Use Estornar lote para reverter um ajuste.');
      const row=normalizeRow(state,raw,inv), key=stable([row.mountingId||'',row.sector,row.ref,row.color]);
      if(seen.has(key))fail('Item repetido no mesmo lote de ajuste.');seen.add(key);
      return {id:input.batchId+':'+index,adjustmentVersion:1,adjustmentBatchId:input.batchId,date:input.date,...row,reason,note:reason,createdAt:options.now};
    });
    const previous=(state.stockLedger||[]).filter(e=>e.adjustmentBatchId===input.batchId);
    const intent=e=>{const {createdAt,...rest}=e;return rest};
    if(previous.length){if(stable(previous.map(intent))===stable(movements.map(intent)))return state;fail('Este lote já existe com outros dados. Reabra e confira.');}
    const existing=new Set([...(state.stockLedger||[]),...inv.flatten(state)].map(e=>e.id));
    if(movements.some(e=>existing.has(e.id)))fail('Identificador do ajuste já utilizado.');
    const next={...state,stockLedger:[...(state.stockLedger||[]),...movements]};
    const issues=inv.validate(next);if(issues.length)fail(issues[0].message);
    return next;
  }
  function createBatch(state,input,options){return append(state,input,options,false)}
  function reverseBatch(state,input,options){
    if(typeof input.originalBatchId!=='string'||input.originalBatchId===input.batchId)fail('Lote original inválido.');
    const original=(state.stockLedger||[]).filter(e=>e.adjustmentBatchId===input.originalBatchId&&e.adjustmentVersion===1);
    if(!original.length||original.some(e=>e.reversalOf))fail('Lote não encontrado ou já é um estorno.');
    const rows=original.map(e=>({direction:e.direction==='out'?'in':'out',sector:e.sector,ref:e.ref,color:e.color,qty:e.qty,...(e.mountingId!==undefined?{mountingId:e.mountingId}:{}),reversalOf:e.id}));
    const existing=(state.stockLedger||[]).filter(e=>rows.some(r=>r.reversalOf===e.reversalOf));
    if(existing.some(e=>e.adjustmentBatchId!==input.batchId))fail('Este lote já foi estornado.');
    if(original.some(e=>e.date>input.date))fail('O estorno não pode preceder o ajuste original.');
    return append(state,{...input,rows},options,true);
  }
  function previewReset(state,input,options){
    const inv=options?.inventory;if(!inv?.ledger)fail('Motor de estoque indisponível.');
    if(!inv.validDate(input.date))fail('Data inválida.');
    const result=inv.ledger(state,{until:input.date}),issues=[...result.issues];
    const rows=result.rows.filter(r=>r.qty>0&&(r.scope==='mounting'||r.sector==='produto_pronto'&&r.scope==='global')).map(r=>({direction:'out',sector:r.sector,ref:r.scope==='global'?r.target:r.sector==='cabedal'?inv.refOf(state.settings.models.find(m=>m.id===r.target)):'@line:'+r.target,color:inv.colorLabel(r.color),qty:r.qty,...(r.scope==='mounting'?{mountingId:r.location}:{})})).sort((a,b)=>stable([a.mountingId||'',a.sector,a.ref,a.color]).localeCompare(stable([b.mountingId||'',b.sector,b.ref,b.color])));
    const factoryRows=result.rows.filter(r=>r.scope==='global'&&r.sector!=='produto_pronto').map(r=>{
      const mounted=result.rows.filter(m=>m.scope==='mounting'&&m.sector===r.sector&&m.color===r.color&&(m.sector==='cabedal'?inv.refOf(state.settings.models.find(x=>x.id===m.target)):'@line:'+m.target)===r.target).reduce((n,m)=>n+m.qty,0);
      const qty=r.qty-mounted;if(qty<0)issues.push({code:'factory_negative',message:'Saldo de fábrica incoerente com as montagens.'});return {sector:r.sector,ref:r.target,color:inv.colorLabel(r.color),qty};
    }).filter(r=>r.qty!==0);
    const totals=Object.fromEntries(sectors.map(s=>[s,rows.filter(r=>r.sector===s).reduce((n,r)=>n+r.qty,0)]));
    if(Object.values(totals).some(q=>!Number.isSafeInteger(q)))issues.push({code:'unsafe_total',message:'Total fora do limite de precisão.'});
    return {rows,totals,factoryRows,issues};
  }
  return {createBatch,reverseBatch,previewReset};
});
