'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Fulfillment=require('../order-fulfillment');
const Inventory=require('../inventory-guard');
const {state}=require('./fixtures/dashboard-state');
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze)}return value};
const order=(id,ref='507',qty=200,date='2026-10-07',extra={})=>({id,clientId:'test-client',date,createdAt:date+'T10:00:00Z',items:[{ref,qty,unitPriceMills:12000}],totalCents:qty*1200,deliveryStatus:'pending',...extra});
function fixture(orders){const s=state();s.salesControl.orders=orders;s.salesControl.orderEvents=[{id:'preserve-event'}];return s}
const project=s=>Fulfillment.project(s,Inventory,'2026-10-07');
test('projection does not change frozen source, finances, inventory or order events',()=>{
 const s=freeze(fixture([order('a'),order('b')])),before=JSON.stringify(s),p=project(s);
 assert.equal(JSON.stringify(s),before);assert.equal(p.orders.length,2);assert.equal(p.summary.ready,168);assert.equal(p.summary.producible,72);
});
test('oldest date then createdAt then id determines stable FIFO, regardless of array order',()=>{
 const s=fixture([order('z','507',100,'2026-10-07'),order('b','507',100,'2026-10-06'),order('a','507',100,'2026-10-06')]);
 let p=project(s);assert.deepEqual(p.orders.map(o=>o.id),['a','b','z']);assert.deepEqual(p.orders.map(o=>o.ready),[100,68,0]);
 s.salesControl.orders.reverse();assert.deepEqual(project(s),p);
});
test('ready stock and shared mounting materials cannot be counted twice across models and duplicate item refs',()=>{
 const s=fixture([order('a','507',240),order('b','512',144),order('c','507',20)]);const p=project(s);
 assert.equal(p.summary.ready,240);assert.equal(p.orders[0].producible,72);assert.equal(p.orders[1].producible,0);assert.equal(p.orders[2].producible,0);
 assert.equal(p.orders[1].items[0].segments[0].missingPalmilha,72);assert.equal(p.orders[1].items[0].segments[0].missingSolado,48);
 const t=fixture([order('a','507',100,{})]);t.salesControl.orders=[order('a','507',100)];t.salesControl.orders[0].items.push({ref:'507',qty:100});
 assert.deepEqual(project(t).orders[0].items.map(i=>i.ready),[100,68]);
});
test('complete material sets in another mounting are considered before incomplete ones',()=>{
 const s=fixture([order('a','507',216)]);s.stockLedger=[];
 for(const e of s.weeks['2026-10-05'].entries)if(e.mountingId==='a'&&e.kind==='palmilha')e.qty=1;
 for(const e of s.weeks['2026-10-05'].entries)if(e.mountingId==='b'&&['solado','palmilha'].includes(e.kind)&&e.line==='500')e.color='Preto';
 const p=project(s),item=p.orders[0].items[0];assert.equal(item.producible,73);assert.equal(item.segments.find(s=>s.mountingId==='b').producible,72);
});
test('matching colors are required, and line 300 needs no insole',()=>{
 const s=fixture([order('a','507',300),order('b','319',120)]);s.stockLedger=[];const p=project(s);
 assert.equal(p.orders[0].producible,72);assert.equal(p.orders[1].producible,96);
 assert.equal(p.orders[1].items[0].segments[0].missingPalmilha,0);assert.equal(p.orders[1].items[0].segments[0].missingSolado,24);
});
test('unknown colors never establish complete matching production sets',()=>{
 const s=fixture([order('a','507',30)]);s.stockLedger=[];
 s.weeks['2026-10-05'].entries=s.weeks['2026-10-05'].entries.filter(e=>e.mountingId==='a'&&e.modelId!=='m512').map(e=>({...e,color:''}));
 const p=project(s),i=p.orders[0].items[0];assert.equal(i.producible,0);assert.equal(i.unknownColorCabedal,168);assert.equal(i.missingCabedal,30);
});
test('delivered and cancelled orders do not claim resources or reappear as pending work',()=>{
 const s=fixture([order('a','507',100,'2026-10-01',{deliveryStatus:'delivered'}),order('b','507',100,'2026-10-02',{deliveryStatus:'cancelled'}),order('c','507',200)]);
 assert.deepEqual(project(s).orders.map(o=>o.id),['c']);assert.equal(project(s).orders[0].ready,168);
});
test('partial quantities and ambiguous delivery state block the affected reference, not unrelated models',()=>{
 for(const deliveryStatus of ['partial','unexpected']){
 const s=fixture([order('a','507',100,'2026-10-01',{deliveryStatus}),order('b'),order('c','512',30)]),p=project(s);
 assert.equal(p.orders[0].ready,0);assert.equal(p.orders[1].ready,0);assert.equal(p.orders[2].ready,30);assert.match(p.orders[1].items[0].review.join(' '),/Conferir entrega/);
 }
});
test('unknown references and imported financial/service items never become pairs to produce',()=>{
 const s=fixture([order('a','DESCONTO MONTAGEM',1),order('b','FORMAS',1),order('c','509R',12)]),p=project(s);
 assert.equal(p.summary.pairs,0);assert.equal(p.summary.toProduce,0);assert.equal(p.summary.reviewItems,3);
});
test('invalid quantities and duplicate model references fail closed',()=>{
 for(const qty of [0,-1,2.5,NaN,Infinity,'10']){
 const p=project(fixture([order('a','507',qty),order('b','507',10)]));assert.equal(p.summary.ready,0);assert.equal(p.summary.reviewItems,2);
 }
 const s=fixture([order('a')]);s.settings.models.push({...s.settings.models[0],id:'duplicate'});assert.equal(project(s).summary.ready,0);
});
test('invalid dates and duplicate order ids cannot silently alter stock priority',()=>{
 for(const orders of [[order('a','507',10,'bad'),order('b','507',10)],[order('a','507',10),order('a','507',10)]]){
 const p=project(fixture(orders));assert.equal(p.summary.ready,0);assert.equal(p.summary.reviewItems,2);
 }
});
test('inventory issues suspend the projection rather than inventing safe stock',()=>{
 const s=fixture([order('a')]);s.stockLedger.push({id:'bad',date:'2026-10-06',sector:'produto_pronto',direction:'out',ref:'507',qty:200,color:'Preto'});
 const p=project(s);assert.equal(p.blocked,true);assert.equal(p.summary.ready,0);assert.equal(p.summary.producible,0);assert.ok(p.issues.length);
});
test('future entries do not inflate today stock or capacity',()=>{
 const s=fixture([order('a')]);s.stockLedger.forEach(e=>e.date='2026-10-08');s.weeks['2026-10-05'].entries.forEach(e=>e.date='2026-10-08');
 const p=project(s);assert.equal(p.summary.ready,0);assert.equal(p.summary.producible,0);
});
test('deleting a pending order recomputes distribution without persistent reservations',()=>{
 const s=fixture([order('a','507',100),order('b','507',100)]);assert.equal(project(s).orders[1].ready,68);
 s.salesControl.orders.shift();assert.equal(project(s).orders[0].ready,100);
});
test('empty pending queue is explicit and not inferred from financial balance',()=>{
 const p=project(fixture([]));assert.equal(p.orders.length,0);assert.equal(p.summary.pairs,0);
 const s=fixture([order('paid')]);s.salesControl.payments=[{allocations:[{orderId:'paid',amountCents:240000}]}];assert.equal(project(s).orders.length,1);
});

test('unlocated global component reductions suspend mounting capacity until reconciled',()=>{
 for(const sector of ['cabedal','solado','palmilha']){
 const s=fixture([order('a','507',72)]);s.stockLedger=[];
 s.weeks['2026-10-05'].entries=s.weeks['2026-10-05'].entries.filter(e=>e.mountingId==='a'&&e.modelId!=='m512').map(e=>({...e,qty:72}));
 s.stockLedger.push({id:'global-reduction',date:'2026-10-07',sector,direction:'out',ref:sector==='cabedal'?'507':'@line:500',qty:72,color:'Preto'});
 assert.equal(Inventory.validate(s).length,0);const p=project(s);assert.equal(p.blocked,true);assert.equal(p.summary.producible,0);
 assert.ok(p.issues.some(i=>i.code==='mounting_global_divergence'));
 }
});
test('global component stock outside the mountings never creates workshop capacity',()=>{
 const s=fixture([order('a','507',72)]);s.stockLedger=[];s.weeks['2026-10-05'].entries=s.weeks['2026-10-05'].entries.filter(e=>e.kind==='cabedal');
 for(const sector of ['solado','palmilha'])s.stockLedger.push({id:sector,date:'2026-10-07',sector,direction:'in',ref:'@line:500',qty:500,color:'Preto'});
 const p=project(s);assert.equal(p.blocked,false);assert.equal(p.summary.producible,0);
});
test('unsafe aggregated inventory and demand never produce rounded availability',()=>{
 const s=fixture([order('a','507',Number.MAX_SAFE_INTEGER),order('b','507',Number.MAX_SAFE_INTEGER)]);
 let p=project(s);assert.equal(p.blocked,true);assert.equal(p.summary.ready,0);assert.ok(p.issues.some(i=>i.code==='unsafe_demand'));
 const t=fixture([order('a')]);t.stockLedger=[{id:'a',date:'2026-10-07',sector:'produto_pronto',direction:'in',ref:'507',qty:Number.MAX_SAFE_INTEGER,color:'Preto'},{id:'b',date:'2026-10-07',sector:'produto_pronto',direction:'in',ref:'507',qty:Number.MAX_SAFE_INTEGER,color:'Preto'}];
 p=project(t);assert.equal(p.blocked,true);assert.equal(p.summary.ready,0);assert.ok(p.issues.some(i=>i.code==='unsafe_balance'));
});

test('uncertain partial demand protects shared line components but leaves unrelated ready stock usable',()=>{
 const s=fixture([order('old','507',72,'2026-10-01',{deliveryStatus:'partial'}),order('new','512',144),order('other','319',120)]);
 const p=project(s),next=p.orders.find(o=>o.id==='new').items[0],other=p.orders.find(o=>o.id==='other').items[0];
 assert.equal(next.ready,72);assert.equal(next.toProduce,72);assert.equal(next.producible,0);assert.equal(next.segments.length,0);
 assert.match(next.capacityReview,/linha 500 a conferir/);assert.equal(next.missingCabedal,null);
 assert.equal(other.producible,96);assert.equal(other.capacityReview,'');
});

test('ambiguous model demand protects shared materials on every candidate line',()=>{
 const s=fixture([order('old','507',72,'2026-10-01'),order('new','512',72)]);s.stockLedger=[];
 s.settings.models.push({...s.settings.models[0],id:'ambiguous-507'});
 const p=project(s),old=p.orders[0].items[0],next=p.orders[1].items[0];
 assert.match(old.review.join(' '),/Referência repetida/);assert.equal(next.producible,0);assert.match(next.capacityReview,/linha 500 a conferir/);
});
