'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Inventory=require('../inventory-guard'),Adjust=require('../stock-adjustment'),Fulfillment=require('../order-fulfillment');
const {state}=require('./fixtures/dashboard-state');
const clone=x=>JSON.parse(JSON.stringify(x));
const options={today:'2026-10-11',now:'2026-10-11T21:00:00Z',inventory:Inventory};
const input=(rows=[{direction:'out',sector:'cabedal',ref:'507',color:'Preto',qty:24,mountingId:'a'}])=>({batchId:'adjust-test',date:options.today,reason:'Conferência física sintética',rows});
const balances=s=>Inventory.ledger(s).rows.filter(r=>r.qty).map(({scope,location,sector,target,color,qty})=>({scope,location,sector,target,color,qty})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
function freeze(x){if(x&&typeof x==='object'){Object.freeze(x);Object.values(x).forEach(freeze)}return x}
function total(s,scope,sector,loc){return Inventory.ledger(s).rows.filter(r=>r.scope===scope&&r.sector===sector&&(!loc||r.location===loc)).reduce((n,r)=>n+r.qty,0)}
test('located correction decreases local and global once; preserves every other field',()=>{
 const before=freeze(state()),next=Adjust.createBatch(before,input(),options);
 assert.equal(total(next,'mounting','cabedal','a'),total(before,'mounting','cabedal','a')-24);
 assert.equal(total(next,'global','cabedal'),total(before,'global','cabedal')-24);
 for(const key of Object.keys(before).filter(k=>k!=='stockLedger'))assert.strictEqual(next[key],before[key]);
 assert.deepEqual(next.stockLedger.slice(0,-1),before.stockLedger);assert.deepEqual(Inventory.validate(next),[]);
 assert.equal(next.stockLedger.at(-1).adjustmentVersion,1);assert.equal(next.stockLedger.at(-1).reason,input().reason);
});
test('reset includes ready plus materials by mounting, never the factory remainder',()=>{
 const before=state();before.stockLedger.push({id:'factory-cab',date:'2026-10-06',direction:'in',sector:'cabedal',ref:'507',color:'Sem cor discriminada',qty:72});
 const p=Adjust.previewReset(freeze(before),{date:options.today},options),next=Adjust.createBatch(before,input(p.rows),options);
 assert.deepEqual(p.issues,[]);assert.deepEqual(p.factoryRows,[{sector:'cabedal',ref:'507',color:'Sem cor discriminada',qty:72}]);
 assert.equal(p.totals.produto_pronto,312);for(const k of ['cabedal','solado','palmilha'])assert.equal(total(next,'mounting',k),0);
 assert.equal(total(next,'global','produto_pronto'),0);assert.equal(total(next,'global','cabedal'),72);
 assert.deepEqual(Fulfillment.project(next,Inventory,options.today).issues,[]);
});
test('all adjustments are append-only and fully reversible by compensating batch',()=>{
 const before=state(),p=Adjust.previewReset(before,{date:options.today},options),next=Adjust.createBatch(before,input(p.rows),options);
 const reversed=Adjust.reverseBatch(next,{batchId:'undo',originalBatchId:'adjust-test',date:options.today,reason:'Estorno sintético'},options);
 assert.deepEqual(balances(reversed),balances(before));assert.deepEqual(reversed.stockLedger.slice(0,next.stockLedger.length),next.stockLedger);
 assert.deepEqual(Inventory.validate(reversed),[]);assert.equal(reversed.stockLedger.length,before.stockLedger.length+p.rows.length*2);
});
test('same batch retry is idempotent even after an unrelated subsequent change',()=>{
 const next=Adjust.createBatch(state(),input(),options);next.lastBackup='later';
 assert.strictEqual(Adjust.createBatch(next,input(),{...options,now:'2026-10-11T22:00:00Z'}),next);
 assert.throws(()=>Adjust.createBatch(next,{...input(),reason:'Outro motivo'},options),/outros dados/);
});
test('reversal retry is idempotent; second reversal and reversal of reversal are blocked',()=>{
 const next=Adjust.createBatch(state(),input(),options),args={batchId:'undo',originalBatchId:'adjust-test',date:options.today,reason:'Correção'};
 const reversed=Adjust.reverseBatch(next,args,options);assert.strictEqual(Adjust.reverseBatch(reversed,args,options),reversed);
 assert.throws(()=>Adjust.reverseBatch(reversed,{...args,batchId:'undo-again'},options),/já foi estornado/);
 assert.throws(()=>Adjust.reverseBatch(reversed,{...args,batchId:'undo-again',originalBatchId:'undo'},options),/já é um estorno/);
});
test('historical views are unaffected before the correction date',()=>{
 const before=state(),next=Adjust.createBatch(before,input(),options);
 assert.deepEqual(Inventory.ledger(next,{until:'2026-10-10'}),Inventory.ledger(before,{until:'2026-10-10'}));
});
test('factory correction cannot remove a material still held by a mounting',()=>{
 assert.throws(()=>Adjust.createBatch(state(),input([{...input().rows[0],mountingId:undefined}]),options),/montagens maior/);
});
test('factory-only stock may be corrected without touching local material',()=>{
 const before=state();before.stockLedger.push({id:'factory',date:'2026-10-06',direction:'in',sector:'cabedal',ref:'507',color:'Preto',qty:72});
 const next=Adjust.createBatch(before,input([{direction:'out',sector:'cabedal',ref:'507',color:'Preto',qty:72}]),options);
 assert.equal(total(next,'mounting','cabedal'),total(before,'mounting','cabedal'));assert.deepEqual(Inventory.validate(next),[]);
});
test('unknown colors remain unknown; no retroactive color or size inferred',()=>{
 const before=state();before.weeks['2026-10-05'].entries[0].color='Sem cor discriminada';
 const next=Adjust.createBatch(before,input([{...input().rows[0],color:'Sem cor discriminada'}]),options);
 assert.equal(next.stockLedger.at(-1).color,'Sem cor discriminada');assert.equal(next.stockLedger.at(-1).sizeBreakdown,undefined);
});
test('shared materials use canonical line and correct mounting only',()=>{
 const before=state(),next=Adjust.createBatch(before,input([{direction:'out',sector:'solado',ref:'@line:500',color:'Preto',qty:36,mountingId:'a'}]),options);
 assert.equal(total(next,'mounting','solado','a'),total(before,'mounting','solado','a')-36);
 assert.equal(total(next,'mounting','solado','b'),total(before,'mounting','solado','b'));
});
test('insufficient local material rejects full batch without partial writes',()=>{
 const before=state(),snapshot=clone(before),rows=[input().rows[0],{direction:'out',sector:'solado',ref:'@line:500',color:'Caramelo',qty:1,mountingId:'a'}];
 assert.throws(()=>Adjust.createBatch(before,input(rows),options),/insuficiente/);assert.deepEqual(before,snapshot);
});
test('backdating a removal before stock arrived is rejected',()=>{
 assert.throws(()=>Adjust.createBatch(state(),{...input(),date:'2026-10-05'},options),/insuficiente/);
});
test('future production must remain feasible after a present correction',()=>{
 const before=state();before.weeks['2026-10-05'].entries.push({id:'future',date:'2026-10-12',kind:'finished',mountingId:'a',modelId:'m507',line:'500',color:'Preto',qty:72});
 assert.throws(()=>Adjust.createBatch(before,input([{direction:'out',sector:'solado',ref:'@line:500',color:'Preto',qty:36,mountingId:'a'}]),options),/insuficiente/);
});
test('reversal cannot precede original and cannot remove already consumed added stock',()=>{
 const before=state(),next=Adjust.createBatch(before,input(),options);
 assert.throws(()=>Adjust.reverseBatch(next,{batchId:'undo',originalBatchId:'adjust-test',date:'2026-10-10',reason:'Correção'},options),/preceder/);
 const added=Adjust.createBatch(before,input([{direction:'in',sector:'produto_pronto',ref:'507',color:'Azul',qty:10}]),options);
 added.stockLedger.push({id:'dispatch',date:options.today,direction:'out',sector:'produto_pronto',ref:'507',color:'Azul',qty:10});
 assert.throws(()=>Adjust.reverseBatch(added,{batchId:'undo',originalBatchId:'adjust-test',date:options.today,reason:'Correção'},options),/insuficiente/);
});
for(const [field,value] of [['qty',0],['qty',-1],['qty',1.2],['qty',Number.MAX_SAFE_INTEGER+1],['qty','1'],['color',''],['mountingId','missing'],['sector','finished'],['direction','reset'],['ref','missing']])test(`rejects malformed ${field}: ${value}`,()=>{
 assert.throws(()=>Adjust.createBatch(state(),input([{...input().rows[0],[field]:value}]),options));
});
for(const date of ['','2026-02-30','2026-10-12','x'])test(`rejects invalid/future date ${date}`,()=>assert.throws(()=>Adjust.createBatch(state(),{...input(),date},options)));
for(const reason of ['', ' ', 'a'.repeat(501),null])test(`rejects invalid reason ${String(reason).slice(0,12)}`,()=>assert.throws(()=>Adjust.createBatch(state(),{...input(),reason},options)));
test('duplicate items and batch ID collisions are rejected',()=>{
 assert.throws(()=>Adjust.createBatch(state(),input([input().rows[0],input().rows[0]]),options),/repetido/);
 const before=state();before.stockLedger[0].id='adjust-test:0';assert.throws(()=>Adjust.createBatch(before,input(),options),/já utilizado/);
});
test('finished goods never acquire a fictitious mounting',()=>assert.throws(()=>Adjust.createBatch(state(),input([{direction:'in',sector:'produto_pronto',ref:'507',color:'Preto',qty:10,mountingId:'a'}]),options),/saldo geral/));
test('ambiguous cabedal model is rejected',()=>{
 const before=state();before.settings.models.push({...before.settings.models[0],id:'duplicate'});assert.throws(()=>Adjust.createBatch(before,input(),options),/ambígua/);
});
test('ledger rejects scope fields on unversioned movements and malformed reversal',()=>{
 let next=state();next.stockLedger[0].mountingId='a';assert.ok(Inventory.validate(next).some(x=>x.code==='invalid_adjustment'));
 next=Adjust.createBatch(state(),input(),options);next.stockLedger.at(-1).reversalOf='no-source';assert.ok(Inventory.validate(next).some(x=>x.code==='invalid_reversal'));
});
test('small corrections repeatedly reverse to the exact same balances',()=>{
 const before=state();let next=before;
 for(let n=1;n<=30;n++){
  const args={...input(),batchId:'cycle-'+n,rows:[{...input().rows[0],qty:n}]};next=Adjust.createBatch(next,args,options);
  next=Adjust.reverseBatch(next,{batchId:'undo-'+n,originalBatchId:args.batchId,date:options.today,reason:'Estorno'},options);
  assert.deepEqual(balances(next),balances(before));
 }
});
