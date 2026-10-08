(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.FioriFinance=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  function moneyCents(value){
    const raw=String(value??"").trim().replace(/\s/g,"");
    if(raw.includes(",")&&!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(raw))return null;
    const normalized=raw.includes(",")?raw.replace(/\./g,"").replace(",","."):raw;
    if(!/^\d+(?:\.\d{1,2})?$/.test(normalized))return null;
    const [whole,fraction='']=normalized.split('.');
    const cents=Number(whole+fraction.padEnd(2,'0'));
    return Number.isSafeInteger(cents)?cents:null;
  }
  function simulation(pairs,rate){
    const raw=String(pairs??"").trim(),rateCents=moneyCents(rate);
    if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<=0||rateCents===null||rateCents<=0)return null;
    const grossCents=Number(raw)*rateCents;
    return Number.isSafeInteger(grossCents)?{pairs:Number(raw),rateCents,grossCents}:null;
  }
  function openAdvances(state,mountingId,date){
    const finance=state.financeControl||{},expenses=state.factoryExpenses||[];
    const advances=Array.isArray(finance.advances)?finance.advances:[],settlements=Array.isArray(finance.settlements)?finance.settlements:[];
    return advances.filter(a=>!mountingId||a.mountingId===mountingId).map(a=>{
      const expense=expenses.find(e=>e.id===a.expenseId);
      const used=settlements.reduce((n,s)=>n+(s.allocations||[]).filter(x=>x.advanceId===a.id).reduce((sum,x)=>sum+Number(x.amountCents||0),0),0);
      const balanceCents=Math.max(0,Math.round(Number(expense?.amount||0)*100)-used);
      return {...a,expense,balanceCents};
    }).filter(a=>a.expense?.status==="paid"&&a.balanceCents>0&&(!date||a.expense.date<=date))
      .sort((a,b)=>String(a.expense.date).localeCompare(String(b.expense.date))||String(a.id).localeCompare(String(b.id)));
  }
  function validDate(date){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||""))||Number(String(date).slice(0,4))<1)return false;
    const value=new Date(date+"T12:00:00Z");
    return Number.isFinite(value.getTime())&&value.toISOString().slice(0,10)===date;
  }
  function plan(state,{mountingId,date,grossCents,discountCents}){
    if(!(state.settings?.mountings||[]).some(m=>m.id===mountingId))return {error:"Selecione a montagem."};
    if(!validDate(date))return {error:"Informe uma data válida."};
    if(!Number.isSafeInteger(grossCents)||grossCents<=0)return {error:"Informe um bruto válido, com até dois decimais."};
    if(!Number.isSafeInteger(discountCents)||discountCents<0)return {error:"Informe um abatimento válido, com até dois decimais."};
    if(discountCents>grossCents)return {error:"O abatimento não pode superar o bruto."};
    const netCents=grossCents-discountCents;
    if(moneyCents(String(netCents/100))!==netCents)return {error:"O pagamento líquido excede o limite de precisão do registro de gastos."};
    const available=openAdvances(state,mountingId,date),availableCents=available.reduce((n,a)=>n+a.balanceCents,0);
    if(discountCents>availableCents)return {error:"O abatimento supera os adiantamentos disponíveis nesta data."};
    let remaining=discountCents;const allocations=[];
    for(const a of available){const use=Math.min(remaining,a.balanceCents);if(use>0){allocations.push({advanceId:a.id,amountCents:use});remaining-=use}}
    return {mountingId,date,grossCents,discountedCents:discountCents,netCents,allocations,availableCents};
  }
  return {moneyCents,simulation,openAdvances,plan};
});
