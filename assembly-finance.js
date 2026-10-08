/* Fiori Belle assembly accounting. Pure JSON projections and atomic state clones.
 * No persistence, inventory movement, historical backfill, or money transfer.
 * Call the inventory guard before saving the returned production state via CAS.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.FioriAssembly=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const PAYABLE='assembly_payable', CASH='assembly_cash';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  function fail(code,message){const error=new Error(message);error.code=code;throw error}
  function requireId(value,label='Identificador'){
    if(typeof value!=='string'||!value.trim()||value!==value.trim())fail('invalid_id',label+' inválido.');
    return value;
  }
  function array(value,label){
    if(value===undefined)return [];
    if(!Array.isArray(value))fail('invalid_state',label+' inválido.');
    return value;
  }
  function integer(value,label,allowZero=false){
    if(!Number.isSafeInteger(value)||value<(allowZero?0:1))fail('invalid_amount',label+' deve ser um inteiro '+(allowZero?'não negativo':'positivo')+' dentro do limite de precisão.');
    return value;
  }
  function plus(a,b){return integer(a+b,'Total em centavos',true)}
  function product(a,b){return integer(a*b,'Valor bruto em centavos')}
  function moneyCents(value){
    if(typeof value!=='number'&&typeof value!=='string')return null;
    const raw=String(value);
    if(!/^\d+(?:\.\d{1,2})?$/.test(raw))return null;
    const [whole,fraction='']=raw.split('.'),cents=Number(whole+fraction.padEnd(2,'0'));
    return Number.isSafeInteger(cents)?cents:null;
  }
  function amount(cents){
    integer(cents,'Valor em centavos',true);
    const value=cents/100;
    if(moneyCents(value)!==cents)fail('precision_loss','O valor excede o limite de precisão do registro de gastos.');
    return value;
  }
  function cents(value,label){const result=moneyCents(value);if(result===null)fail('invalid_amount',(label||'Valor')+' inválido; use centavos exatos.');return result}
  function validDate(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number(value.slice(0,4))<1)return false;
    const date=new Date(value+'T12:00:00Z');
    return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
  }
  function date(value){if(!validDate(value))fail('invalid_date','Informe uma data ISO válida (AAAA-MM-DD).');return value}
  function timestamp(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)||!validDate(value.slice(0,10)))fail('invalid_timestamp','Informe uma data e hora UTC válida.');
    const parsed=new Date(value);
    if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,19)!==value.slice(0,19))fail('invalid_timestamp','Informe uma data e hora UTC válida.');
    return value;
  }
  function stable(value){
    if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
    if(object(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
    return JSON.stringify(value);
  }
  const equal=(a,b)=>stable(a)===stable(b);
  function indexed(rows,label){
    const map=new Map();
    for(const row of rows){if(!object(row))fail('invalid_state',label+' inválido.');requireId(row.id,label);if(map.has(row.id))fail('duplicate_id','Identificador repetido em '+label+'.');map.set(row.id,row)}
    return map;
  }
  function base(state){
    if(!object(state)||!object(state.settings)||!Array.isArray(state.settings.mountings))fail('invalid_state','Configuração de montagem inválida.');
    if(state.weeks!==undefined&&!object(state.weeks))fail('invalid_state','Semanas de produção inválidas.');
    return state;
  }
  function entries(state){
    base(state);const rows=[];
    for(const week of Object.values(state.weeks||{})){
      if(!object(week))fail('invalid_state','Semana de produção inválida.');
      rows.push(...array(week.entries,'Lançamentos de produção'));
    }
    indexed(rows,'produção');return rows;
  }
  function expenses(state){const rows=array(base(state).factoryExpenses,'Gastos');indexed(rows,'gastos');return rows}
  function checkLedgerIds(state){
    // The snapshot verifier shares one ID namespace across these three ledgers.
    return indexed([...entries(state),...array(state.stockLedger,'Movimentos de estoque'),...expenses(state)],'produção, estoque e gastos');
  }
  function mounting(state,id){
    requireId(id,'Montagem');const found=base(state).settings.mountings.filter(m=>m&&m.id===id);
    if(found.length!==1)fail('invalid_mounting','Selecione uma montagem válida e sem duplicidade.');
    return found[0];
  }
  function finance(state){
    const value=state.financeControl;
    if(value!==undefined&&!object(value))fail('invalid_state','Controle financeiro inválido.');
    const f=value||{};
    if(f.version!==undefined&&f.version!==1)fail('invalid_finance_version','Versão do controle financeiro incompatível.');
    return {...f,advances:array(f.advances,'Adiantamentos'),settlements:array(f.settlements,'Acertos')};
  }
  function checkControl(state){
    base(state);finance(state);
    const control=state.assemblyControl;
    if(control===undefined)return;
    if(!object(control)||control.version!==1||!Array.isArray(control.legacyFinishedIds))fail('invalid_control','Controle de montagem inválido.');
    if(!Array.isArray(state.settings.mountingRateHistory)||!object(state.financeControl)||state.financeControl.version!==1||!Array.isArray(state.financeControl.advances)||!Array.isArray(state.financeControl.settlements))fail('invalid_control','As estruturas financeiras da montagem estão incompletas.');
    checkLedgerIds(state);
    timestamp(control.enabledAt);const ids=new Set();
    for(const id of control.legacyFinishedIds){requireId(id);if(ids.has(id))fail('invalid_control','Baseline de produção repetida.');ids.add(id)}
  }
  function activate(next,before,now){
    checkControl(before);
    if(before.assemblyControl!==undefined)return;
    checkLedgerIds(before);
    next.settings.mountingRateHistory=copy(history(before).rows);
    next.financeControl={version:1,...copy(finance(before))};
    next.assemblyControl={version:1,enabledAt:timestamp(now),legacyFinishedIds:entries(before).filter(e=>e.kind==='finished').map(e=>e.id)};
  }
  function history(state){
    const rows=array(base(state).settings.mountingRateHistory,'Histórico de tarifas'),ids=indexed(rows,'tarifas'),dates=new Set();
    for(const rate of rows){
      mounting(state,rate.mountingId);date(rate.effectiveFrom);integer(rate.rateCents,'Tarifa');timestamp(rate.createdAt);
      if(rate.id==='legacy_current')fail('invalid_rate','O identificador legacy_current é reservado.');
      const key=JSON.stringify([rate.mountingId,rate.effectiveFrom]);
      if(dates.has(key))fail('duplicate_rate','Há mais de uma tarifa para a mesma montagem e vigência.');dates.add(key);
    }
    return {rows,ids};
  }
  function resolveRate(state,mountingId,productionDate,today){
    const mt=mounting(state,mountingId);date(productionDate);date(today);
    const rates=history(state).rows.filter(r=>r.mountingId===mountingId),eligible=rates.filter(r=>r.effectiveFrom<=productionDate).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom));
    if(eligible.length){const r=eligible[0];return {rateId:r.id,rateCents:r.rateCents,source:'history',effectiveFrom:r.effectiveFrom}}
    const current=moneyCents(mt.rate);
    // A current display rate has no inferred historical or future validity.
    if(productionDate===today&&current!==null&&current>0)return {rateId:'legacy_current',rateCents:current,source:'legacy_current',effectiveFrom:null};
    fail('missing_rate','Cadastre uma tarifa com vigência confirmada para esta data de produção.');
  }
  function addRate(state,input){
    base(state);checkControl(state);if(!object(input))fail('invalid_rate','Informe a tarifa e sua vigência.');
    requireId(input.id,'Tarifa');mounting(state,input.mountingId);date(input.effectiveFrom);integer(input.rateCents,'Tarifa');timestamp(input.createdAt);amount(input.rateCents);
    if(input.id==='legacy_current')fail('invalid_rate','O identificador legacy_current é reservado.');
    const rate={id:input.id,mountingId:input.mountingId,effectiveFrom:input.effectiveFrom,rateCents:input.rateCents,createdAt:input.createdAt,source:input.source||'manual'};
    requireId(rate.source,'Origem da tarifa');
    const existing=history(state),same=existing.ids.get(rate.id);
    if(same){if(!equal(same,rate))fail('rate_conflict','Esta tarifa já existe com outros dados.');return copy(state)}
    if(existing.rows.some(r=>r.mountingId===rate.mountingId&&r.effectiveFrom===rate.effectiveFrom))fail('duplicate_rate','Já existe uma tarifa para esta montagem e data.');
    const next=copy(state);activate(next,state,rate.createdAt);next.settings.mountingRateHistory=[...copy(existing.rows),rate];return next;
  }
  function weekKey(value){
    const d=new Date(date(value)+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));
    const key=d.toISOString().slice(0,10);date(key);return key;
  }
  function checkPair(state,expense,entry){
    if(!entry||entry.kind!=='finished'||entry.assemblyExpenseId!==expense.id||expense.id!==PAYABLE+':'+entry.id)fail('invalid_obligation','Vínculo entre produção e obrigação inválido.');
    const snapshot=entry.assemblyRate;
    if(!object(snapshot))fail('invalid_obligation','A produção não tem tarifa congelada.');
    mounting(state,entry.mountingId);date(entry.date);integer(entry.qty,'Quantidade de pares');integer(snapshot.rateCents,'Tarifa');requireId(snapshot.rateId,'Tarifa');
    if(snapshot.source==='history'){
      date(snapshot.effectiveFrom);
      const rate=history(state).ids.get(snapshot.rateId);
      if(!rate||rate.mountingId!==entry.mountingId||rate.rateCents!==snapshot.rateCents||rate.effectiveFrom!==snapshot.effectiveFrom||rate.effectiveFrom>entry.date)fail('invalid_obligation','Tarifa congelada sem vigência correspondente.');
    }else if(snapshot.source!=='legacy_current'||snapshot.rateId!=='legacy_current'||snapshot.effectiveFrom!==null)fail('invalid_obligation','Origem da tarifa congelada inválida.');
    const gross=product(entry.qty,snapshot.rateCents);
    if(expense.role!==PAYABLE||expense.category!=='Mão de obra'||expense.productionEntryId!==entry.id||expense.mountingId!==entry.mountingId||expense.date!==entry.date||expense.qty!==entry.qty||expense.rateId!==snapshot.rateId||expense.rateCents!==snapshot.rateCents||expense.grossCents!==gross||cents(expense.amount)!==gross||cents(entry.mountingRate)!==snapshot.rateCents||cents(entry.mountingAmount)!==gross)fail('invalid_obligation','Valores da obrigação divergem da produção congelada.');
    if(!['pending','paid'].includes(expense.status))fail('invalid_obligation','Situação da obrigação inválida.');
    if(expense.status==='pending'){
      if(expense.settlementId!=null||expense.settledAt!=null)fail('invalid_obligation','Obrigação pendente já vinculada a acerto.');
    }else{
      const settlement=finance(state).settlements.find(s=>s.id===expense.settlementId);
      if(!settlement||settlement.kind!=='assembly'||settlement.mountingId!==expense.mountingId||!Array.isArray(settlement.obligationIds)||!settlement.obligationIds.includes(expense.id)||settlement.createdAt!==expense.settledAt||settlement.date<entry.date)fail('invalid_obligation','Obrigação paga sem acerto correspondente.');
    }
    return expense;
  }
  function obligations(state,options={}){
    checkControl(state);const byEntry=indexed(entries(state),'produção'),all=expenses(state),seen=new Set(),rows=[];
    for(const expense of all){
      if(expense.role!==PAYABLE)continue;
      if(seen.has(expense.productionEntryId))fail('duplicate_obligation','A produção tem mais de uma obrigação.');seen.add(expense.productionEntryId);
      checkPair(state,expense,byEntry.get(expense.productionEntryId));rows.push(expense);
    }
    for(const entry of byEntry.values())if(entry.assemblyExpenseId&&!rows.some(e=>e.id===entry.assemblyExpenseId))fail('missing_obligation','Produção sem a obrigação correspondente.');
    if(rows.length&&state.assemblyControl===undefined)fail('invalid_control','Obrigações sem controle de montagem.');
    if(options.date!==undefined)date(options.date);
    return copy(rows.filter(e=>(!options.mountingId||e.mountingId===options.mountingId)&&(!options.date||e.date<=options.date)&&(!options.status||e.status===options.status)).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)));
  }
  function protectedEntryIds(state){
    return new Set([...array(state.assemblyControl?.legacyFinishedIds,'Baseline de produção'),...entries(state).filter(e=>e.assemblyExpenseId||e.assemblyRate).map(e=>e.id),...expenses(state).filter(e=>e.role===PAYABLE).map(e=>e.productionEntryId).filter(Boolean)]);
  }
  function createFinished(state,input,{today,now}={}){
    base(state);checkControl(state);date(today);timestamp(now);
    if(!object(input))fail('invalid_entry','Informe a produção.');
    requireId(input.id,'Produção');date(input.date);mounting(state,input.mountingId);integer(input.qty,'Quantidade de pares');
    if(input.kind!=='finished')fail('invalid_entry','A obrigação exige uma nova produção de produto pronto.');
    requireId(input.modelId,'Modelo');
    if(Array.isArray(state.settings.models)&&!state.settings.models.some(m=>m.id===input.modelId))fail('invalid_entry','Modelo de produção não encontrado.');
    const old=entries(state).find(e=>e.id===input.id),existingExpenses=expenses(state);
    if(old){
      if(!old.assemblyExpenseId)fail('legacy_entry','Produção anterior à funcionalidade exige conciliação separada; não foi alterada.');
      for(const key of Object.keys(input))if(!equal(input[key],old[key]))fail('entry_conflict','Esta produção já existe com outros dados.');
      const payable=existingExpenses.find(e=>e.id===old.assemblyExpenseId);if(!payable)fail('missing_obligation','Produção sem a obrigação correspondente.');
      checkPair(state,payable,old);return copy(state);
    }
    // Refuse orphaned records instead of repairing them or silently backfilling.
    obligations(state);
    const expenseId=PAYABLE+':'+input.id;
    if(existingExpenses.some(e=>e.id===expenseId||e.productionEntryId===input.id))fail('duplicate_obligation','Já existe uma obrigação com este identificador de produção.');
    const rate=resolveRate(state,input.mountingId,input.date,today),gross=product(input.qty,rate.rateCents),mt=mounting(state,input.mountingId);
    const derived={assemblyExpenseId:expenseId,assemblyRate:rate,mountingRate:amount(rate.rateCents),mountingAmount:amount(gross)};
    for(const key of Object.keys(derived))if(input[key]!==undefined&&!equal(input[key],derived[key]))fail('entry_conflict','O snapshot informado diverge da tarifa desta produção.');
    const entry={...copy(input),...derived,createdAt:input.createdAt===undefined?now:timestamp(input.createdAt)};
    const expense={id:expenseId,date:entry.date,category:'Mão de obra',description:'Montagem · '+(entry.modelName||entry.modelId)+' · '+entry.qty+' pares',supplier:mt.name||entry.mountingId,amount:amount(gross),method:'',status:'pending',note:'Obrigação gerada pela produção de produto pronto.',createdAt:now,updatedAt:now,role:PAYABLE,productionEntryId:entry.id,mountingId:entry.mountingId,qty:entry.qty,rateCents:rate.rateCents,rateId:rate.rateId,grossCents:gross};
    const next=copy(state);activate(next,state,now);next.weeks=next.weeks||{};
    const key=weekKey(entry.date);
    if(!next.weeks[key]){
      next.weeks[key]={goal:null,modelGoals:{},entries:[],modelSnapshot:copy((next.settings.models||[]).filter(m=>m.active!==false)),mountingSnapshot:copy(next.settings.mountings.filter(m=>m.active!==false)),createdAt:now};
    }
    next.weeks[key].entries=[...array(next.weeks[key].entries,'Lançamentos de produção'),entry];next.factoryExpenses=[...copy(existingExpenses),expense];checkLedgerIds(next);return next;
  }
  function openAdvances(state,mountingId,cutoff){
    if(mountingId!==undefined)mounting(state,mountingId);if(cutoff!==undefined)date(cutoff);
    const f=finance(state),advances=indexed(f.advances,'adiantamentos'),expenseMap=indexed(expenses(state),'gastos'),used=new Map(),sourceIds=new Set();
    indexed(f.settlements,'acertos');
    for(const advance of advances.values()){
      mounting(state,advance.mountingId);requireId(advance.expenseId,'Gasto do adiantamento');
      if(sourceIds.has(advance.expenseId))fail('duplicate_advance','Um gasto não pode financiar dois adiantamentos.');sourceIds.add(advance.expenseId);
      const expense=expenseMap.get(advance.expenseId);
      if(!expense||expense.role===PAYABLE)fail('invalid_advance','Gasto de origem do adiantamento inválido.');
      date(expense.date);integer(cents(expense.amount),'Adiantamento');
    }
    for(const settlement of f.settlements){
      const seen=new Set();
      for(const allocation of array(settlement.allocations,'Abatimentos')){
        if(!object(allocation))fail('invalid_allocation','Abatimento inválido.');
        const advance=advances.get(allocation.advanceId);
        if(!advance||advance.mountingId!==settlement.mountingId||seen.has(advance.id))fail('invalid_allocation','Adiantamento repetido, desconhecido ou de outro montador.');
        seen.add(advance.id);integer(allocation.amountCents,'Abatimento');
        const source=expenseMap.get(advance.expenseId);
        if(source.status!=='paid'||source.category!=='Mão de obra'||!validDate(settlement.date)||source.date>settlement.date)fail('invalid_allocation','Adiantamento não estava pago e disponível na data do acerto.');
        used.set(advance.id,plus(used.get(advance.id)||0,allocation.amountCents));
      }
    }
    const rows=[];
    for(const advance of advances.values()){
      const expense=expenseMap.get(advance.expenseId),balanceCents=cents(expense.amount)-(used.get(advance.id)||0);
      if(balanceCents<0)fail('overallocated_advance','Adiantamento abatido acima do seu valor.');
      if((!mountingId||advance.mountingId===mountingId)&&expense.status==='paid'&&expense.category==='Mão de obra'&&balanceCents>0&&(!cutoff||expense.date<=cutoff))rows.push({...advance,expense,balanceCents});
    }
    return copy(rows.sort((a,b)=>a.expense.date.localeCompare(b.expense.date)||(a.id<b.id?-1:a.id>b.id?1:0)));
  }
  function planSettlement(state,{mountingId,date:settlementDate,obligationIds}={}){
    mounting(state,mountingId);date(settlementDate);
    const all=obligations(state);let selected;
    if(obligationIds!==undefined){
      if(!Array.isArray(obligationIds)||!obligationIds.length)fail('empty_settlement','Selecione pelo menos uma obrigação pendente.');
      const ids=new Set();selected=obligationIds.map(id=>{
        requireId(id,'Obrigação');if(ids.has(id))fail('duplicate_obligation','Obrigação repetida no acerto.');ids.add(id);
        const row=all.find(e=>e.id===id);
        if(!row||row.mountingId!==mountingId||row.status!=='pending'||row.date>settlementDate)fail('invalid_selection','Selecione obrigações pendentes deste montador, produzidas até a data do acerto.');
        return row;
      });
    }else selected=all.filter(e=>e.mountingId===mountingId&&e.status==='pending'&&e.date<=settlementDate);
    if(!selected.length)fail('empty_settlement','Não há obrigações pendentes para este montador e data.');
    selected.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
    const grossCents=selected.reduce((n,e)=>plus(n,e.grossCents),0),available=openAdvances(state,mountingId,settlementDate),availableCents=available.reduce((n,a)=>plus(n,a.balanceCents),0);
    const discountedCents=Math.min(availableCents,grossCents),netCents=grossCents-discountedCents,allocations=[];let remaining=discountedCents;
    amount(netCents);
    for(const advance of available){const use=Math.min(remaining,advance.balanceCents);if(use>0){allocations.push({advanceId:advance.id,amountCents:use});remaining-=use}}
    const production=indexed(entries(state),'produção');
    const fingerprint=stable({obligations:selected.map(expense=>({expense,entry:production.get(expense.productionEntryId)})),advances:available});
    return {mountingId,date:settlementDate,obligationIds:selected.map(e=>e.id),grossCents,discountedCents,netCents,allocations,availableCents,fingerprint};
  }
  function applySettlement(state,plan,{id,now,method='',note=''}={}){
    checkControl(state);
    requireId(id,'Acerto');timestamp(now);
    if(typeof method!=='string'||typeof note!=='string')fail('invalid_settlement','Forma de pagamento e observação inválidas.');
    if(!object(plan))fail('invalid_settlement','Revise o acerto antes de registrar.');
    mounting(state,plan.mountingId);date(plan.date);integer(plan.grossCents,'Bruto');integer(plan.netCents,'Líquido',true);integer(plan.discountedCents,'Abatimento',true);
    if(!Array.isArray(plan.obligationIds)||!plan.obligationIds.length||!Array.isArray(plan.allocations))fail('invalid_settlement','Plano de acerto inválido.');
    if(plus(plan.netCents,plan.discountedCents)!==plan.grossCents||plan.allocations.reduce((n,a)=>plus(n,integer(a.amountCents,'Abatimento')),0)!==plan.discountedCents)fail('invalid_settlement','Totais do plano de acerto não conferem.');
    const f=finance(state);indexed(f.settlements,'acertos');
    const netExpenseId=plan.netCents>0?CASH+':'+id:null;
    const fields={id,kind:'assembly',date:plan.date,mountingId:plan.mountingId,obligationIds:copy(plan.obligationIds),grossCents:plan.grossCents,allocations:copy(plan.allocations),netExpenseId,method,note};
    const existing=f.settlements.find(s=>s.id===id);
    if(existing){
      for(const key of Object.keys(fields))if(!equal(fields[key],existing[key]))fail('settlement_conflict','Este acerto já existe com outros dados.');
      const rows=obligations(state);
      if(plan.obligationIds.some(obligationId=>!rows.some(e=>e.id===obligationId&&e.status==='paid'&&e.settlementId===id)))fail('invalid_settlement','O acerto não liquidou todas as obrigações vinculadas.');
      const cash=expenses(state).find(e=>e.id===netExpenseId);
      if(netExpenseId&&(!cash||cash.role!==CASH||cash.mountingId!==plan.mountingId||cash.settlementId!==id||cash.status!=='paid'||cash.category!=='Mão de obra'||cash.date!==plan.date||cash.method!==method||cents(cash.amount)!==plan.netCents))fail('invalid_settlement','Pagamento líquido do acerto inconsistente.');
      openAdvances(state);return copy(state);
    }
    const refreshed=planSettlement(state,{mountingId:plan.mountingId,date:plan.date,obligationIds:plan.obligationIds});
    if(!equal(plan,refreshed))fail('stale_plan','Os dados mudaram. Revise novamente as obrigações e os adiantamentos antes de confirmar.');
    const currentExpenses=expenses(state);
    if(netExpenseId&&currentExpenses.some(e=>e.id===netExpenseId))fail('settlement_conflict','Já existe um gasto com o identificador deste pagamento.');
    const next=copy(state);activate(next,state,now);
    next.financeControl={version:1,...copy(f),settlements:[...copy(f.settlements),{...fields,createdAt:now}]};
    const ids=new Set(plan.obligationIds);
    next.factoryExpenses=currentExpenses.map(expense=>ids.has(expense.id)?{...copy(expense),status:'paid',settlementId:id,settledAt:now,updatedAt:now}:copy(expense));
    if(netExpenseId){const mt=mounting(state,plan.mountingId);next.factoryExpenses.push({id:netExpenseId,date:plan.date,category:'Mão de obra',description:'Pagamento líquido do acerto · '+(mt.name||mt.id),supplier:mt.name||'',amount:amount(plan.netCents),method,status:'paid',note,createdAt:now,updatedAt:now,role:CASH,mountingId:plan.mountingId,settlementId:id})}
    checkLedgerIds(next);return next;
  }
  function expenseSummary(state,month){
    if(typeof month!=='string'||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)||Number(month.slice(0,4))<1)fail('invalid_month','Informe um mês válido.');
    obligations(state);openAdvances(state);
    const f=finance(state),advanceIds=new Set(f.advances.map(a=>a.expenseId)),netIds=new Set(f.settlements.map(s=>s.netExpenseId).filter(Boolean));
    const rows=expenses(state).filter(e=>String(e.date).slice(0,7)===month).sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));
    const withdrawalRows=rows.filter(e=>e.category==='Pró-labore/Retirada'),ordinary=rows.filter(e=>e.category!=='Pró-labore/Retirada');
    // Legacy settlements without production obligations appear only in cash.
    // Their gross amount is not invented as historical production cost.
    const expenseRows=ordinary.filter(e=>!advanceIds.has(e.id)&&!netIds.has(e.id)&&e.role!==CASH),cashRows=ordinary.filter(e=>e.status==='paid'&&e.role!==PAYABLE);
    const sum=list=>list.reduce((n,e)=>plus(n,cents(e.amount)),0);
    const totalCents=sum(expenseRows),paidCents=sum(expenseRows.filter(e=>e.status==='paid')),pendingCents=totalCents-paidCents,cashPaidCents=sum(cashRows),withdrawalsCents=sum(withdrawalRows),byCategoryCents=Object.create(null);
    for(const expense of expenseRows){const category=expense.category||'Outros';byCategoryCents[category]=plus(byCategoryCents[category]||0,cents(expense.amount))}
    return copy({rows,expenseRows,withdrawalRows,cashRows,totalCents,paidCents,pendingCents,withdrawalsCents,cashPaidCents,byCategoryCents,costCents:totalCents,cashCents:cashPaidCents});
  }
  return {moneyCents,validDate,resolveRate,addRate,createFinished,obligations,protectedEntryIds,openAdvances,planSettlement,applySettlement,expenseSummary};
});
