'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const A=require('../assembly-finance');
const TODAY='2026-10-07',NOW='2026-10-07T20:00:00.000Z';
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(){
  return {version:4,settings:{mountings:[{id:'a',name:'Montador A (teste)',rate:2.60,active:true},{id:'b',name:'Montador B (teste)',rate:4,active:true},{id:'unknown',name:'Sem tarifa (teste)',rate:0}],models:[{id:'m507',ref:'507',name:'Modelo teste',line:'500',active:true}],pairsPerSheet:72},weeks:{'2026-09-28':{goal:720,modelGoals:{},entries:[{id:'legacy-finished',date:'2026-10-01',kind:'finished',mountingId:'a',modelId:'m507',qty:72,mountingRate:2.6,mountingAmount:187.2,color:'Preto'}]}},factoryExpenses:[],financeControl:{version:1,advances:[],settlements:[],custom:'preserve'},stockLedger:[{id:'stock-legacy',date:'2026-10-01',sector:'produto_pronto',direction:'in',ref:'507',qty:72}],salesControl:{orders:[{id:'order-legacy',total:500}],receipts:[]},unrelated:{nested:['unchanged']}};
}
function entry(overrides={}){return {id:'production-a',date:TODAY,kind:'finished',mountingId:'a',modelId:'m507',modelName:'Modelo teste',line:'500',qty:144,color:'Preto',...overrides}}
function rate(state,overrides={}){return A.addRate(state,{id:'rate-a-1',mountingId:'a',effectiveFrom:'2026-10-01',rateCents:260,createdAt:NOW,...overrides})}
function ready(state=fixture(),overrides={}){return A.createFinished(state,entry(overrides),{today:TODAY,now:NOW})}
function advance(state,{id='advance-a',mountingId='a',date='2026-10-06',amount=200,status='paid'}={}){
  state.factoryExpenses.push({id:'expense-'+id,date,category:'Mão de obra',status,amount,description:'Adiantamento sintético'});
  state.financeControl.advances.push({id,mountingId,expenseId:'expense-'+id,dueDate:'2026-10-10',linkedAt:NOW});return state;
}
function plan(state,overrides={}){return A.planSettlement(state,{mountingId:'a',date:TODAY,...overrides})}
function apply(state,p=plan(state),overrides={}){return A.applySettlement(state,p,{id:'settlement-a',now:NOW,method:'Pix',note:'Acerto sintético confirmado',...overrides})}
function code(expected){return error=>{assert.equal(error.code,expected,error.message);return true}}
function deepFreeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const item of Object.values(value))deepFreeze(item)}return value}

test('module exposes the same pure UMD API in a browser',()=>{
  const context=vm.createContext({});vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../assembly-finance.js'),'utf8'),context);
  assert.equal(typeof context.FioriAssembly.createFinished,'function');assert.equal(context.FioriAssembly.moneyCents(2.6),260);
});
test('strict ISO dates include leap years and reject normalized, missing and non-string dates',()=>{
  for(const value of ['2024-02-29','2026-10-07','0001-01-01','9999-12-31'])assert.equal(A.validDate(value),true,value);
  for(const value of ['2026-02-29','2026-02-30','2026-13-01','2026-1-01','0000-01-01','2026-10-07T00:00:00Z','',null,new Date(TODAY)])assert.equal(A.validDate(value),false,String(value));
});
test('current legacy rate applies only today, without inventing past or future validity',()=>{
  const state=fixture(),before=JSON.stringify(state);
  assert.deepEqual(A.resolveRate(state,'a',TODAY,TODAY),{rateId:'legacy_current',rateCents:260,source:'legacy_current',effectiveFrom:null});
  for(const date of ['2026-10-06','2026-10-08'])assert.throws(()=>A.resolveRate(state,'a',date,TODAY),code('missing_rate'));
  assert.throws(()=>A.resolveRate(state,'unknown',TODAY,TODAY),code('missing_rate'));
  assert.equal(JSON.stringify(state),before);assert.equal(state.assemblyControl,undefined);
});
test('rate dates have inclusive starts and retain the previous rate until the next start',()=>{
  let state=rate(fixture(),{effectiveFrom:'2026-09-30'});state=rate(state,{id:'rate-a-2',effectiveFrom:'2026-10-08',rateCents:275});
  assert.equal(A.resolveRate(state,'a','2026-10-07',TODAY).rateCents,260);
  assert.equal(A.resolveRate(state,'a','2026-10-08',TODAY).rateCents,275);
  assert.equal(A.resolveRate(state,'a','2026-10-09',TODAY).rateCents,275);
  assert.throws(()=>A.resolveRate(state,'a','2026-09-29',TODAY),code('missing_rate'));
  assert.equal(A.resolveRate(state,'b',TODAY,TODAY).rateCents,400);
});
test('future history keeps today’s known legacy fallback but invents no past or future interval',()=>{
  const state=rate(fixture(),{effectiveFrom:'2026-10-09'});
  assert.equal(A.resolveRate(state,'a',TODAY,TODAY).rateId,'legacy_current');
  assert.equal(A.resolveRate(state,'a',TODAY,TODAY).rateCents,260);
  for(const date of ['2026-10-06','2026-10-08'])assert.throws(()=>A.resolveRate(state,'a',date,TODAY),code('missing_rate'));
});
test('rate insertion is append-only, replayable and never changes current rates or legacy records',()=>{
  const state=deepFreeze(fixture()),before=JSON.stringify(state),first=rate(state),again=rate(first);
  assert.notEqual(first,state);assert.deepEqual(again,first);assert.equal(first.settings.mountings[0].rate,2.6);
  assert.deepEqual(first.weeks,state.weeks);assert.deepEqual(first.stockLedger,state.stockLedger);assert.deepEqual(first.salesControl,state.salesControl);assert.deepEqual(first.factoryExpenses,[]);
  assert.deepEqual(first.assemblyControl,{version:1,enabledAt:NOW,legacyFinishedIds:['legacy-finished']});assert.equal(JSON.stringify(state),before);
  assert.throws(()=>rate(first,{rateCents:270}),code('rate_conflict'));
  assert.throws(()=>rate(first,{id:'other-rate'}),code('duplicate_rate'));
  assert.throws(()=>rate(first,{id:'other-rate',rateCents:270}),code('duplicate_rate'));
});
test('rate validation rejects decimal cents, unsafe numbers, reserved IDs and invalid times',()=>{
  for(const rateCents of [0,-1,2.6,'260',Infinity,NaN,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>rate(fixture(),{rateCents}),code('invalid_amount'));
  assert.throws(()=>rate(fixture(),{rateCents:Number.MAX_SAFE_INTEGER}),code('precision_loss'));
  assert.throws(()=>rate(fixture(),{id:'legacy_current'}),code('invalid_rate'));
  for(const createdAt of ['2026-02-30T12:00:00Z','2026-10-07T25:00:00Z',TODAY])assert.throws(()=>rate(fixture(),{createdAt}),code('invalid_timestamp'));
  assert.throws(()=>rate(fixture(),{effectiveFrom:'2026-02-30'}),code('invalid_date'));
});
test('one finished entry atomically creates one gross pending expense with cent snapshots',()=>{
  const state=deepFreeze(fixture()),before=JSON.stringify(state),result=ready(state),production=result.weeks['2026-10-05'].entries[0],expense=result.factoryExpenses[0];
  assert.equal(production.mountingRate,2.6);assert.equal(production.mountingAmount,374.4);assert.equal(production.assemblyRate.rateCents,260);assert.equal(production.assemblyRate.rateId,'legacy_current');assert.equal(production.assemblyExpenseId,'assembly_payable:production-a');
  assert.equal(expense.id,production.assemblyExpenseId);assert.equal(expense.role,'assembly_payable');assert.equal(expense.category,'Mão de obra');assert.equal(expense.status,'pending');assert.equal(expense.amount,374.4);assert.equal(expense.grossCents,37440);assert.equal(expense.qty,144);assert.equal(expense.productionEntryId,production.id);assert.equal(expense.rateId,'legacy_current');
  assert.equal(result.weeks['2026-10-05'].goal,null);assert.deepEqual(result.assemblyControl.legacyFinishedIds,['legacy-finished']);assert.deepEqual(result.weeks['2026-09-28'],state.weeks['2026-09-28']);assert.deepEqual(result.stockLedger,state.stockLedger);assert.deepEqual(result.financeControl,state.financeControl);assert.equal(JSON.stringify(state),before);
  assert.deepEqual([...A.protectedEntryIds(result)],['legacy-finished','production-a']);assert.equal(A.obligations(result).length,1);
});
test('historical rate is selected from production date, never from settlement date',()=>{
  let state=rate(fixture());state=rate(state,{id:'rate-later',effectiveFrom:'2026-10-08',rateCents:400});state=ready(state,{date:'2026-10-02'});
  assert.equal(plan(state,{date:'2026-10-10'}).grossCents,37440);assert.equal(A.obligations(state)[0].rateCents,260);
});
test('adding a retroactive rate never reprices an existing snapshot or changes baseline',()=>{
  let state=rate(fixture());state=ready(state);const beforeEntry=clone(state.weeks['2026-10-05'].entries[0]),beforeExpense=clone(state.factoryExpenses[0]),beforeControl=clone(state.assemblyControl);
  const next=rate(state,{id:'rate-retro',effectiveFrom:'2026-10-06',rateCents:280,createdAt:'2026-10-09T12:00:00Z'});
  assert.deepEqual(next.weeks['2026-10-05'].entries[0],beforeEntry);assert.deepEqual(next.factoryExpenses[0],beforeExpense);assert.deepEqual(next.assemblyControl,beforeControl);assert.equal(plan(next).grossCents,37440);assert.equal(A.resolveRate(next,'a',TODAY,TODAY).rateCents,280);
});
test('legacy-current snapshots survive current display rate edits and later history',()=>{
  const state=ready();state.settings.mountings[0].rate=9;
  const next=rate(state,{id:'confirmed-later',effectiveFrom:'2026-10-06',rateCents:300});
  assert.equal(plan(next).grossCents,37440);assert.deepEqual(ready(next),next);
});
test('exact finished replay recognizes the stored pair even after rate change, settlement or later day',()=>{
  const state=ready(),before=JSON.stringify(state),replay=ready(state);
  assert.deepEqual(replay,state);assert.notEqual(replay,state);assert.equal(JSON.stringify(state),before);assert.equal(replay.factoryExpenses.length,1);
  const settled=apply(state);assert.deepEqual(A.createFinished(settled,entry(),{today:'2026-10-08',now:'2026-10-08T12:00:00Z'}),settled);
});
test('finished ID replay with changed quantities, color, model, date or snapshots is rejected',()=>{
  const state=ready();
  for(const overrides of [{qty:72},{color:'Caramelo'},{date:'2026-10-06'},{mountingId:'b'},{mountingRate:2.7},{mountingAmount:300},{modelName:'Alterado'}])assert.throws(()=>ready(state,overrides),code('entry_conflict'));
  const corrupted=clone(state);corrupted.factoryExpenses[0].amount=374;
  assert.throws(()=>ready(corrupted),code('invalid_obligation'));
});
test('legacy finished IDs cannot be backfilled by replay and reads never enable or repair history',()=>{
  const state=fixture(),before=JSON.stringify(state);
  assert.deepEqual(A.obligations(state),[]);assert.deepEqual([...A.protectedEntryIds(state)],[]);A.expenseSummary(state,'2026-10');
  assert.throws(()=>ready(state,{id:'legacy-finished',date:'2026-10-01',qty:72}),code('legacy_entry'));assert.equal(JSON.stringify(state),before);
});
test('production validation fails without mutating any part of the source state',()=>{
  const state=fixture(),before=JSON.stringify(state);
  for(const qty of [0,-1,1.5,'72',Infinity,Number.MAX_SAFE_INTEGER])assert.throws(()=>ready(state,{qty}),code('invalid_amount'));
  assert.throws(()=>ready(state,{date:'2026-10-06'}),code('missing_rate'));
  assert.throws(()=>ready(state,{date:'2026-02-30'}),code('invalid_date'));
  assert.throws(()=>ready(state,{kind:'solado'}),code('invalid_entry'));
  assert.throws(()=>ready(state,{modelId:'missing-model'}),code('invalid_entry'));
  assert.throws(()=>ready(state,{mountingId:'unknown'}),code('missing_rate'));
  assert.throws(()=>ready(state,{mountingAmount:1}),code('entry_conflict'));
  assert.equal(JSON.stringify(state),before);assert.equal(state.assemblyControl,undefined);
});
test('separate color quantities generate their own obligation, never the full batch twice',()=>{
  let state=ready(fixture(),{id:'black',qty:72,color:'Preto'});state=ready(state,{id:'caramel',qty:72,color:'Caramelo'});
  const p=plan(state);assert.equal(p.grossCents,37440);assert.equal(p.obligationIds.length,2);assert.deepEqual(A.obligations(state).map(e=>e.qty),[72,72]);assert.deepEqual(state.assemblyControl.legacyFinishedIds,['legacy-finished']);
});
test('obligation listing rejects duplicate or missing production links and frozen amount tampering',()=>{
  const state=ready();
  const duplicate=clone(state);duplicate.factoryExpenses.push({...duplicate.factoryExpenses[0],id:'duplicate'});assert.throws(()=>A.obligations(duplicate),code('duplicate_obligation'));
  const missing=clone(state);missing.factoryExpenses=[];assert.throws(()=>A.obligations(missing),code('missing_obligation'));
  const altered=clone(state);altered.weeks['2026-10-05'].entries[0].mountingAmount=1;assert.throws(()=>A.obligations(altered),code('invalid_obligation'));
  const noControl=clone(state);delete noControl.assemblyControl;assert.throws(()=>A.obligations(noControl),code('invalid_control'));
});
test('144 pairs at 260 cents subtract a paid 20000-cent advance automatically',()=>{
  const state=deepFreeze(advance(ready())),before=JSON.stringify(state),p=plan(state);
  assert.equal(p.grossCents,37440);assert.equal(p.discountedCents,20000);assert.equal(p.netCents,17440);assert.equal(p.availableCents,20000);assert.deepEqual(p.allocations,[{advanceId:'advance-a',amountCents:20000}]);assert.equal(JSON.stringify(state),before);
});
test('without advances the new obligation settlement permits empty allocations',()=>{
  const state=ready(),p=plan(state),next=apply(state,p);
  assert.deepEqual(p.allocations,[]);assert.equal(p.netCents,37440);assert.equal(next.factoryExpenses.length,2);assert.equal(next.factoryExpenses[1].amount,374.4);assert.equal(next.financeControl.settlements[0].kind,'assembly');
});
test('FIFO chooses expense date then advance ID, excluding future, other mounting and unpaid advances',()=>{
  const state=ready();advance(state,{id:'z-tied',amount:100});advance(state,{id:'a-tied',amount:100});advance(state,{id:'oldest',date:'2026-10-01',amount:200});advance(state,{id:'future',date:'2026-10-08',amount:300});advance(state,{id:'other',mountingId:'b',amount:300});advance(state,{id:'unpaid',status:'pending',amount:300});
  const p=plan(state);assert.equal(p.availableCents,40000);assert.deepEqual(p.allocations,[{advanceId:'oldest',amountCents:20000},{advanceId:'a-tied',amountCents:10000},{advanceId:'z-tied',amountCents:7440}]);assert.equal(p.netCents,0);
});
test('an advance greater than gross results in no zero-valued cash expense and leaves its remainder open',()=>{
  const state=advance(ready(),{amount:500}),before=JSON.stringify(state),next=apply(state),settlement=next.financeControl.settlements[0];
  assert.equal(settlement.netExpenseId,null);assert.equal(next.factoryExpenses.length,2);assert.equal(A.openAdvances(next,'a',TODAY)[0].balanceCents,12560);assert.equal(next.factoryExpenses[0].amount,374.4);assert.equal(next.factoryExpenses[0].status,'paid');assert.equal(JSON.stringify(state),before);
});
test('apply creates exactly one immutable settlement and keeps gross payable separate from cash',()=>{
  const state=deepFreeze(advance(ready())),p=plan(state),next=apply(state,p),settlement=next.financeControl.settlements[0],cash=next.factoryExpenses.find(e=>e.role==='assembly_cash'),payable=next.factoryExpenses.find(e=>e.role==='assembly_payable');
  assert.equal(next.financeControl.custom,'preserve');assert.equal(settlement.id,'settlement-a');assert.deepEqual(settlement.obligationIds,p.obligationIds);assert.equal(settlement.grossCents,37440);assert.equal(settlement.netExpenseId,'assembly_cash:settlement-a');assert.equal(cash.amount,174.4);assert.equal(cash.mountingId,'a');assert.equal(cash.settlementId,settlement.id);assert.equal(cash.status,'paid');assert.equal(cash.category,'Mão de obra');assert.equal(payable.amount,374.4);assert.equal(payable.grossCents,37440);assert.equal(payable.settledAt,settlement.createdAt);assert.equal(payable.updatedAt,NOW);assert.equal(payable.settlementId,settlement.id);assert.deepEqual(next.factoryExpenses.find(e=>e.id==='expense-advance-a'),state.factoryExpenses.find(e=>e.id==='expense-advance-a'));assert.deepEqual(next.stockLedger,state.stockLedger);
});
test('same settlement ID and payload replay exactly once, including later retries',()=>{
  const state=advance(ready()),p=plan(state),next=apply(state,p),again=apply(next,p,{now:'2026-10-08T13:00:00Z'});
  assert.deepEqual(again,next);assert.notEqual(again,next);assert.equal(again.financeControl.settlements.length,1);assert.equal(again.factoryExpenses.length,3);
  assert.throws(()=>apply(next,p,{method:'Dinheiro'}),code('settlement_conflict'));assert.throws(()=>apply(next,p,{note:'Alterado'}),code('settlement_conflict'));
});
test('settlement selections reject already-paid, future, other-mounting, missing and repeated obligations',()=>{
  let state=ready();state=ready(state,{id:'production-b',mountingId:'b'});state=rate(state,{id:'future-rate',effectiveFrom:'2026-10-08'});state=ready(state,{id:'future-production',date:'2026-10-08'});
  for(const obligationIds of [['assembly_payable:production-b'],['missing'],['assembly_payable:future-production'],['assembly_payable:production-a','assembly_payable:production-a']])assert.throws(()=>plan(state,{obligationIds}));
  assert.throws(()=>plan(state,{obligationIds:[]}),code('empty_settlement'));
  const next=apply(state);assert.throws(()=>plan(next,{obligationIds:['assembly_payable:production-a']}),code('invalid_selection'));
  assert.equal(plan(state).grossCents,37440);
});
test('explicit selection settles just those obligations and uses deterministic ordering',()=>{
  let state=ready(fixture(),{id:'z',qty:10});state=ready(state,{id:'a',qty:20});
  const chosen=plan(state,{obligationIds:['assembly_payable:z']}),next=apply(state,chosen);
  assert.equal(chosen.grossCents,2600);assert.equal(A.obligations(next,{status:'pending'})[0].id,'assembly_payable:a');
  assert.deepEqual(plan(state,{obligationIds:['assembly_payable:z','assembly_payable:a']}).obligationIds,['assembly_payable:a','assembly_payable:z']);
});
test('stale plan rejects changed advance balances, newly available advances and changed obligation details',()=>{
  const original=advance(ready()),p=plan(original);
  const changedBalance=clone(original);changedBalance.factoryExpenses.find(e=>e.id==='expense-advance-a').amount=150;assert.throws(()=>apply(changedBalance,p),code('stale_plan'));
  const newAdvance=advance(clone(original),{id:'new',amount:1});assert.throws(()=>apply(newAdvance,p),code('stale_plan'));
  const changedEntry=clone(original);changedEntry.weeks['2026-10-05'].entries[0].color='Caramelo';assert.throws(()=>apply(changedEntry,p),code('stale_plan'));
  const changedExpense=clone(original);changedExpense.factoryExpenses[0].description='Alterado';assert.throws(()=>apply(changedExpense,p),code('stale_plan'));
  const tampered=clone(p);tampered.allocations[0].amountCents=100;assert.throws(()=>apply(original,tampered),code('invalid_settlement'));
});
test('a competing successful settlement blocks both repeated obligation payment and stale advance reuse',()=>{
  let state=advance(ready());state=ready(state,{id:'second',qty:144});
  const firstPlan=plan(state,{obligationIds:['assembly_payable:production-a']}),secondPlan=plan(state,{obligationIds:['assembly_payable:second']}),settled=apply(state,firstPlan);
  assert.throws(()=>apply(settled,firstPlan,{id:'different'}),code('invalid_selection'));
  assert.throws(()=>apply(settled,secondPlan,{id:'different'}),code('stale_plan'));
  const refreshed=plan(settled,{obligationIds:['assembly_payable:second']});assert.deepEqual(refreshed.allocations,[]);assert.equal(refreshed.netCents,37440);
});
test('existing legacy allocations reduce availability and remain byte-for-byte unchanged',()=>{
  const state=advance(ready(),{amount:300});state.factoryExpenses.push({id:'legacy-net',date:'2026-10-06',category:'Mão de obra',status:'paid',amount:100});
  state.financeControl.settlements.push({id:'legacy-settlement',date:'2026-10-06',mountingId:'a',grossCents:20000,allocations:[{advanceId:'advance-a',amountCents:10000}],netExpenseId:'legacy-net',createdAt:'2026-10-06T20:00:00Z'});
  const before=clone(state.financeControl.settlements[0]),p=plan(state),next=apply(state,p);
  assert.equal(p.availableCents,20000);assert.equal(p.netCents,17440);assert.deepEqual(next.financeControl.settlements[0],before);
});
test('advance integrity rejects over-allocation, duplicate allocations and duplicate source expenses',()=>{
  const state=advance(ready());
  const badAllocation={id:'legacy',date:TODAY,mountingId:'a',allocations:[{advanceId:'advance-a',amountCents:20001}]};state.financeControl.settlements.push(badAllocation);assert.throws(()=>plan(state),code('overallocated_advance'));
  badAllocation.allocations=[{advanceId:'advance-a',amountCents:1},{advanceId:'advance-a',amountCents:1}];assert.throws(()=>plan(state),code('invalid_allocation'));
  badAllocation.allocations=[{advanceId:'missing',amountCents:1}];assert.throws(()=>plan(state),code('invalid_allocation'));
  state.financeControl.settlements=[];state.financeControl.advances.push({...state.financeControl.advances[0],id:'duplicate-source'});assert.throws(()=>plan(state),code('duplicate_advance'));
});
test('settlements cannot consume an advance before its payment date or another mounting advance',()=>{
  for(const override of [{date:'2026-10-05'},{mountingId:'b'}]){
    const state=advance(ready());state.financeControl.settlements.push({id:'bad',date:TODAY,mountingId:'a',allocations:[{advanceId:'advance-a',amountCents:1}],...override});assert.throws(()=>plan(state),code('invalid_allocation'));
  }
});
test('cash totals do not add a gross payable to the advance and net payment',()=>{
  const state=advance(ready()),before=A.expenseSummary(state,'2026-10'),next=apply(state),after=A.expenseSummary(next,'2026-10');
  assert.equal(before.costCents,37440);assert.equal(before.pendingCents,37440);assert.equal(before.cashCents,20000);
  assert.equal(after.costCents,37440);assert.equal(after.paidCents,37440);assert.equal(after.pendingCents,0);assert.equal(after.cashCents,37440);assert.equal(after.cashPaidCents,37440);assert.equal(after.totalCents,37440);assert.equal(after.byCategoryCents['Mão de obra'],37440);assert.equal(after.rows.length,3);assert.equal(after.expenseRows.length,1);assert.equal(after.cashRows.length,2);
});
test('cost follows production month while paid cash follows the payment month',()=>{
  let state=rate(fixture(),{effectiveFrom:'2026-09-01'});state=ready(state,{date:'2026-09-30'});advance(state,{date:'2026-09-29'});
  const next=apply(state),sep=A.expenseSummary(next,'2026-09'),oct=A.expenseSummary(next,'2026-10');
  assert.equal(sep.costCents,37440);assert.equal(sep.paidCents,37440);assert.equal(sep.cashCents,20000);assert.equal(oct.costCents,0);assert.equal(oct.cashCents,17440);assert.equal(oct.pendingCents,0);
});
test('ordinary costs and withdrawals remain separate; legacy settlements appear in cash without invented production',()=>{
  const state=fixture();advance(state);state.factoryExpenses.push({id:'legacy-net',date:TODAY,category:'Mão de obra',status:'paid',amount:174.4},{id:'material',date:TODAY,category:'Matéria-prima',status:'pending',amount:50},{id:'energy',date:TODAY,category:'Energia/água',status:'paid',amount:10},{id:'withdrawal',date:TODAY,category:'Pró-labore/Retirada',status:'paid',amount:30});
  state.financeControl.settlements.push({id:'legacy',date:TODAY,mountingId:'a',grossCents:37440,allocations:[{advanceId:'advance-a',amountCents:20000}],netExpenseId:'legacy-net'});
  const before=JSON.stringify(state),summary=A.expenseSummary(state,'2026-10');assert.equal(summary.costCents,6000);assert.equal(summary.paidCents,1000);assert.equal(summary.pendingCents,5000);assert.equal(summary.cashCents,38440);assert.equal(summary.withdrawalsCents,3000);assert.deepEqual(summary.byCategoryCents,{'Matéria-prima':5000,'Energia/água':1000});assert.equal(JSON.stringify(state),before);
});
test('integer-cent arithmetic refuses aggregate overflow and floating-point expense precision loss',()=>{
  assert.equal(A.moneyCents('90071992547409.91'),Number.MAX_SAFE_INTEGER);assert.equal(A.moneyCents('70368744177664.01'),7036874417766401);
  for(const value of [null,NaN,Infinity,-1,'1e3','1.234','1,23',' 1.00'])assert.equal(A.moneyCents(value),null,String(value));
  const state=rate(fixture(),{rateCents:1});assert.throws(()=>ready(state,{qty:Number.MAX_SAFE_INTEGER}),code('precision_loss'));
  let huge=ready(state,{id:'large-1',qty:4503599627370496});huge=ready(huge,{id:'large-2',qty:4503599627370496});assert.throws(()=>plan(huge),code('invalid_amount'));
  const bad=fixture();bad.factoryExpenses.push({id:'malformed',date:TODAY,amount:0.001,status:'paid',category:'Outros'});assert.throws(()=>A.expenseSummary(bad,'2026-10'),code('invalid_amount'));
});
test('missing legacy financial arrays initialize only in the first successful mutator',()=>{
  const state=fixture();delete state.financeControl;const before=JSON.stringify(state);A.obligations(state);A.expenseSummary(state,'2026-10');assert.equal(JSON.stringify(state),before);
  const next=ready(state);assert.deepEqual(next.financeControl,{version:1,advances:[],settlements:[]});assert.deepEqual(next.settings.mountingRateHistory,[]);
  const p=plan(next),settled=apply(next,p);assert.deepEqual(settled.financeControl.advances,[]);assert.equal(settled.financeControl.version,1);assert.equal(settled.financeControl.settlements.length,1);assert.equal(state.financeControl,undefined);
  const withRate=rate(state);assert.deepEqual(withRate.financeControl,{version:1,advances:[],settlements:[]});assert.equal(state.settings.mountingRateHistory,undefined);
});
test('malformed containers and duplicate IDs fail closed without replacing legacy data',()=>{
  const state=fixture();state.financeControl.advances={};const before=JSON.stringify(state);assert.throws(()=>plan(ready(state)),code('invalid_state'));assert.equal(JSON.stringify(state),before);
  const dup=fixture();dup.weeks['2026-09-28'].entries.push(clone(dup.weeks['2026-09-28'].entries[0]));assert.throws(()=>ready(dup),code('duplicate_id'));
  const malformed=fixture();malformed.settings.mountingRateHistory={};assert.throws(()=>ready(malformed),code('invalid_state'));
});
test('baseline stays immutable through rates, new productions and multiple settlements',()=>{
  let state=ready(),baseline=clone(state.assemblyControl);state=rate(state);state=ready(state,{id:'second',qty:10});state=apply(state);assert.deepEqual(state.assemblyControl,baseline);assert.equal(state.weeks['2026-09-28'].entries[0].assemblyExpenseId,undefined);
  state=ready(state,{id:'third',qty:10});state=apply(state,plan(state),{id:'settlement-b'});assert.deepEqual(state.assemblyControl,baseline);
});
test('read-only summaries and plans work on frozen data and return independent projections',()=>{
  const state=deepFreeze(advance(ready())),before=JSON.stringify(state),rows=A.obligations(state),advances=A.openAdvances(state,'a',TODAY),summary=A.expenseSummary(state,'2026-10');
  rows[0].amount=1;advances[0].expense.amount=1;summary.rows[0].amount=1;plan(state);assert.equal(JSON.stringify(state),before);
});


test('summary fails closed on managed obligation corruption and incompatible finance versions',()=>{
  const corrupted=ready();corrupted.factoryExpenses[0].amount=1;assert.throws(()=>A.expenseSummary(corrupted,'2026-10'),code('invalid_obligation'));
  for(const version of [0,2,'1',null]){
    const state=ready();state.financeControl.version=version;const before=JSON.stringify(state);
    assert.throws(()=>A.expenseSummary(state,'2026-10'),code('invalid_finance_version'));assert.throws(()=>plan(state),code('invalid_finance_version'));assert.throws(()=>ready(state,{id:'new-attempt'}),code('invalid_finance_version'));assert.throws(()=>rate(state),code('invalid_finance_version'));assert.equal(JSON.stringify(state),before);
  }
});

test('active financial control cannot silently repair missing required arrays during reads or writes',()=>{
  for(const field of ['history','advances','settlements']){
    const state=ready();if(field==='history')delete state.settings.mountingRateHistory;else delete state.financeControl[field];const before=JSON.stringify(state);
    assert.throws(()=>A.expenseSummary(state,'2026-10'),code('invalid_control'));assert.throws(()=>ready(state,{id:'second'}),code('invalid_control'));assert.equal(JSON.stringify(state),before);
  }
});

test('same-date advance FIFO uses binary ID order matching the SQL C collation',()=>{
  const state=ready();for(const id of ['z','a','_dash','Z','A'])advance(state,{id,amount:5});
  assert.deepEqual(A.openAdvances(state,'a',TODAY).map(a=>a.id),['A','Z','_dash','a','z']);
  assert.deepEqual(plan(state).allocations.map(a=>a.advanceId),['A','Z','_dash','a','z']);
});

test('activation protects every baseline finished entry without adding financial records to it',()=>{
  const state=fixture();assert.equal(A.protectedEntryIds(state).has('legacy-finished'),false);
  const next=rate(state);assert.equal(A.protectedEntryIds(next).has('legacy-finished'),true);assert.deepEqual(next.factoryExpenses,[]);
  assert.deepEqual(next.weeks,state.weeks);assert.deepEqual([...A.protectedEntryIds(ready(next))],['legacy-finished','production-a']);
});


test('inactive legacy reads preserve cross-ledger collisions but activation refuses them atomically',()=>{
  const state=fixture();state.stockLedger[0].id='legacy-finished';const before=JSON.stringify(state);
  assert.deepEqual(A.obligations(state),[]);assert.equal(A.expenseSummary(state,'2026-10').costCents,0);assert.equal(A.protectedEntryIds(state).size,0);
  assert.throws(()=>rate(state),code('duplicate_id'));assert.throws(()=>ready(state),code('duplicate_id'));assert.equal(JSON.stringify(state),before);assert.equal(state.assemblyControl,undefined);
});
test('active entry-stock, entry-expense and stock-expense ID collisions fail reads and writes closed',()=>{
  for(const collision of ['entry-stock','entry-expense','stock-expense']){
    const state=ready(),p=plan(state);
    if(collision==='entry-stock')state.stockLedger[0].id='production-a';
    else state.factoryExpenses.push({id:collision==='entry-expense'?'production-a':'stock-legacy',date:TODAY,amount:1,status:'pending',category:'Outros'});
    const before=JSON.stringify(state);
    assert.throws(()=>A.expenseSummary(state,'2026-10'),code('duplicate_id'));assert.throws(()=>ready(state),code('duplicate_id'));
    assert.throws(()=>apply(state,p),code('duplicate_id'));assert.throws(()=>rate(state),code('duplicate_id'));assert.equal(JSON.stringify(state),before);
  }
});
test('new production and its deterministic payable cannot reuse an ID in another ledger',()=>{
  for(const collision of ['new-entry-stock','new-entry-expense','payable-stock','payable-entry']){
    const state=fixture();let newId='production-a';
    if(collision==='new-entry-stock')newId='stock-legacy';
    if(collision==='new-entry-expense')state.factoryExpenses.push({id:newId,date:TODAY,amount:1,status:'pending',category:'Outros'});
    if(collision==='payable-stock')state.stockLedger[0].id='assembly_payable:'+newId;
    if(collision==='payable-entry')state.weeks['2026-09-28'].entries[0].id='assembly_payable:'+newId;
    const before=JSON.stringify(state);assert.throws(()=>ready(state,{id:newId}),code('duplicate_id'));assert.equal(JSON.stringify(state),before);
  }
});
test('new cash expense cannot collide with stock or a production entry',()=>{
  for(const ledger of ['stock','production']){
    const source=fixture();if(ledger==='stock')source.stockLedger[0].id='assembly_cash:settlement-a';else source.weeks['2026-09-28'].entries[0].id='assembly_cash:settlement-a';
    const state=ready(source),p=plan(state),before=JSON.stringify(state);assert.throws(()=>apply(state,p),code('duplicate_id'));assert.equal(JSON.stringify(state),before);
  }
});
