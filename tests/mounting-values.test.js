'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Dashboard=require('../dashboard-view');

function state(){return {settings:{mountings:[{id:'a',name:'Montagem A',rate:9,active:true},{id:'b',name:'Montagem B',rate:3,active:false}]}}}
function entry(values={}){return {id:'entry',kind:'finished',date:'2026-10-07',mountingId:'a',qty:72,...values}}
function rate(values={}){return {id:'rate',mountingId:'a',effectiveFrom:'2026-10-05',rateCents:250,...values}}
function values(entries,fixture=state(),mountings=[]){return Dashboard.productionValues(fixture,entries,mountings)}
function first(entries,fixture=state(),mountings=[]){return values(entries,fixture,mountings).mountings[0]}
function freeze(value){
  if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}
  return value;
}

test('sums frozen rates per entry across a midweek change instead of multiplying by current tariff',()=>{
  const fixture=state(),row=first([
    entry({id:'old',date:'2026-10-05',qty:72,assemblyRate:{rateCents:260},mountingRate:2.6}),
    entry({id:'new',date:'2026-10-07',qty:144,assemblyRate:{rateCents:300},mountingRate:3})
  ],fixture);
  assert.equal(row.totalPairs,216);assert.equal(row.knownPairs,216);assert.equal(row.knownCents,61920);
  assert.equal(row.estimatedPairs,0);assert.equal(row.estimatedCents,0);assert.equal(row.unpricedPairs,0);
  assert.deepEqual(row.rates.map(r=>[r.rateCents,r.pairs,r.cents,r.status]),[[260,72,18720,'known'],[300,144,43200,'known']]);
  assert.notEqual(row.knownCents,216*fixture.settings.mountings[0].rate*100);
});

test('history is an explicit estimate and switches inclusively at the effective boundary',()=>{
  const fixture=state();fixture.settings.mountingRateHistory=[
    rate({id:'new',effectiveFrom:'2026-10-07',rateCents:300}),
    rate({id:'old',effectiveFrom:'2026-10-01',rateCents:260}),
    rate({id:'future',effectiveFrom:'2026-10-09',rateCents:9900})
  ];
  const row=first([entry({date:'2026-10-06',qty:1}),entry({date:'2026-10-07',qty:2}),entry({date:'2026-10-08',qty:3})],fixture);
  assert.equal(row.knownPairs,0);assert.equal(row.knownCents,0);assert.equal(row.estimatedPairs,6);assert.equal(row.estimatedCents,1760);
  assert.deepEqual(row.rates.map(r=>[r.rateCents,r.pairs,r.source,r.status,r.effectiveFrom]),[
    [260,1,'rate_history','estimated','2026-10-01'],[300,5,'rate_history','estimated','2026-10-07']
  ]);
});

test('future-only history does not leak into earlier production; supplied snapshot is estimated',()=>{
  const fixture=state();fixture.settings.mountingRateHistory=[rate({effectiveFrom:'2026-10-08',rateCents:9900})];
  const row=first([entry({qty:2})],fixture,[{id:'a',name:'Nome arquivado',rate:2.6}]);
  assert.equal(row.name,'Nome arquivado');assert.equal(row.knownCents,0);assert.equal(row.estimatedCents,520);
  assert.equal(row.rates[0].source,'mounting_snapshot');
});

test('future-only history without a fallback leaves production unpriced',()=>{
  const fixture=state();fixture.settings.mountings[0].rate=0;
  fixture.settings.mountingRateHistory=[rate({effectiveFrom:'2026-10-08',rateCents:9900})];
  const row=first([entry()],fixture);
  assert.equal(row.knownCents,0);assert.equal(row.estimatedCents,0);assert.equal(row.unpricedPairs,72);
  assert.equal(row.invalidEntries[0].reason,'missing_rate');
});

test('without history, supplied snapshot precedes current tariff and stays estimated',()=>{
  const row=first([entry({qty:3})],state(),[{id:'a',rate:2.65}]);
  assert.equal(row.estimatedCents,795);assert.equal(row.knownPairs,0);assert.equal(row.rates[0].source,'mounting_snapshot');
});

test('without history or supplied rate, current tariff is only an estimate',()=>{
  const row=first([entry({qty:3})]);
  assert.equal(row.estimatedCents,2700);assert.equal(row.knownPairs,0);assert.equal(row.rates[0].source,'current_mounting');
});

test('an invalid supplied mounting display rate can fall back to current display rate',()=>{
  for(const bad of [0,null,'2.60',NaN,Infinity,-1,0.001]){
    const row=first([entry({qty:1})],state(),[{id:'a',rate:bad}]);
    assert.equal(row.estimatedCents,900);assert.equal(row.rates[0].source,'current_mounting');
  }
});

test('eligible history precedes both mounting display rates',()=>{
  const fixture=state();fixture.settings.mountingRateHistory=[rate()];
  const row=first([entry({qty:2})],fixture,[{id:'a',rate:4}]);
  assert.equal(row.estimatedCents,500);assert.equal(row.rates[0].source,'rate_history');
});

test('frozen cents precede disagreeing or malformed legacy and all estimated rates',()=>{
  const fixture=state();fixture.settings.mountingRateHistory=[rate({rateCents:1000})];
  for(const legacy of [7,0,null,'8',Infinity]){
    const row=first([entry({qty:3,assemblyRate:{rateCents:29},mountingRate:legacy})],fixture,[{id:'a',rate:4}]);
    assert.equal(row.knownCents,87);assert.equal(row.estimatedCents,0);assert.equal(row.rates[0].source,'frozen');
    assert.equal(row.invalidEntries.length,0);
  }
});

test('valid numeric legacy entry rate is known when frozen snapshot is absent',()=>{
  for(const [rateValue,cents] of [[0,0],[0.01,1],[0.29,29],[1.1,110],[2.6,260],[12,1200]]){
    const row=first([entry({qty:7,mountingRate:rateValue})]);
    assert.equal(row.knownCents,cents*7);assert.equal(row.knownPairs,7);assert.equal(row.estimatedPairs,0);
    assert.equal(row.rates[0].source,'legacy_entry');
  }
});

test('invalid legacy values are unpriced with an error and never replaced by a current tariff',()=>{
  for(const bad of [null,undefined,'2.60','',false,true,{},[],NaN,Infinity,-1,0.001,1.005,0.1+0.2,Number.MAX_SAFE_INTEGER]){
    const row=first([entry({qty:2,mountingRate:bad})]);
    assert.equal(row.knownPairs,0,String(bad));assert.equal(row.estimatedPairs,0,String(bad));assert.equal(row.unpricedPairs,2,String(bad));
    assert.equal(row.invalidEntries[0].reason,'invalid_legacy_rate');
  }
});

test('explicit numeric legacy zero stays known even when history and current rates are positive',()=>{
  const fixture=state();fixture.settings.mountingRateHistory=[rate()];
  const row=first([entry({qty:7,mountingRate:0})],fixture,[{id:'a',rate:4}]);
  assert.equal(row.knownPairs,7);assert.equal(row.knownCents,0);assert.equal(row.estimatedPairs,0);assert.equal(row.unpricedPairs,0);
  assert.deepEqual(row.rates,[{rateCents:0,status:'known',source:'legacy_entry',pairs:7,cents:0}]);
  assert.equal(row.invalidEntries.length,0);
});

test('malformed frozen snapshots stay unpriced even when legacy rate and history exist',()=>{
  const fixture=state();fixture.settings.mountingRateHistory=[rate()];
  for(const bad of [null,undefined,false,1,[],{}, {rateCents:0},{rateCents:'260'},{rateCents:1.5},{rateCents:-1},{rateCents:NaN},{rateCents:Infinity},{rateCents:Number.MAX_SAFE_INTEGER+1}]){
    const row=first([entry({assemblyRate:bad,mountingRate:2.6})],fixture);
    assert.equal(row.knownPairs,0);assert.equal(row.estimatedPairs,0);assert.equal(row.unpricedPairs,72);
    assert.equal(row.invalidEntries[0].reason,'invalid_frozen_rate');
  }
});

test('missing frozen and legacy rates never confirm values solely from history',()=>{
  const fixture=state();fixture.settings.mountingRateHistory=[rate()];
  const row=first([entry()],fixture);
  assert.equal(row.knownCents,0);assert.equal(row.estimatedCents,18000);assert.equal(row.rates[0].status,'estimated');
});

test('unknown or invalid current rates leave a clear unpriced count',()=>{
  for(const bad of [undefined,null,0,'2.6',-1,NaN,Infinity,0.001]){
    const fixture=state();fixture.settings.mountings[0].rate=bad;
    const row=first([entry()],fixture);
    assert.equal(row.unpricedPairs,72);assert.equal(row.estimatedCents,0);assert.equal(row.knownCents,0);
    assert.equal(row.invalidEntries[0].reason,'missing_rate');
  }
});

test('corrupt applicable history and duplicate effective dates are not silently estimated from older/current rates',()=>{
  for(const [history,reason] of [
    [null,'invalid_rate_history'],[{},'invalid_rate_history'],
    [[rate({effectiveFrom:'2026-02-30'})],'invalid_rate_history'],
    [[rate({effectiveFrom:'2026-1-01'})],'invalid_rate_history'],
    [[rate({rateCents:0})],'invalid_history_rate'],
    [[rate({rateCents:'250'})],'invalid_history_rate'],
    [[rate({rateCents:Number.MAX_SAFE_INTEGER+1})],'invalid_history_rate'],
    [[rate(),rate({id:'duplicate',rateCents:300})],'ambiguous_rate_history']
  ]){
    const fixture=state();fixture.settings.mountingRateHistory=history;
    const row=first([entry()],fixture);
    assert.equal(row.estimatedCents,0);assert.equal(row.unpricedPairs,72);assert.equal(row.invalidEntries[0].reason,reason);
  }
});

test('irrelevant mountings and future invalid rates do not poison an applicable rate',()=>{
  const fixture=state();fixture.settings.mountingRateHistory=[rate(),rate({id:'future',effectiveFrom:'2026-10-08',rateCents:0}),rate({mountingId:'b',effectiveFrom:'invalid',rateCents:0})];
  const row=first([entry({qty:1})],fixture);
  assert.equal(row.estimatedCents,250);assert.equal(row.invalidEntries.length,0);
});

test('missing or invalid entry dates cannot select an estimated tariff',()=>{
  for(const date of [undefined,null,'','2026-02-30','2026-10-7','0000-01-01','2026-10-07T00:00:00Z']){
    const row=first([entry({date})]);
    assert.equal(row.unpricedPairs,72);assert.equal(row.invalidEntries[0].reason,'invalid_production_date');
  }
});

test('quantities must be positive safe integers and invalid quantities contribute no pairs or money',()=>{
  for(const qty of [undefined,null,0,-1,0.5,'72',NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
    const row=first([entry({qty,assemblyRate:{rateCents:1}})]);
    assert.equal(row.totalPairs,0);assert.equal(row.knownPairs,0);assert.equal(row.knownCents,0);assert.equal(row.unpricedPairs,0);
    assert.equal(row.invalidEntries[0].reason,'invalid_quantity');
  }
});

test('safe integer edge is preserved exactly; unsafe per-entry products become unpriced',()=>{
  const max=Number.MAX_SAFE_INTEGER;
  const safe=first([entry({qty:1,assemblyRate:{rateCents:max}})]);
  assert.equal(safe.knownCents,max);assert.equal(safe.invalidEntries.length,0);
  const unsafe=first([entry({qty:2,assemblyRate:{rateCents:max}})]);
  assert.equal(unsafe.knownCents,0);assert.equal(unsafe.unpricedPairs,2);assert.equal(unsafe.invalidEntries[0].reason,'unsafe_entry_amount');
});

test('known aggregate overflow is explicit null instead of imprecise money',()=>{
  const row=first([entry({id:'one',qty:1,assemblyRate:{rateCents:Number.MAX_SAFE_INTEGER}}),entry({id:'two',qty:1,assemblyRate:{rateCents:1}})]);
  assert.equal(row.totalPairs,2);assert.equal(row.knownPairs,2);assert.equal(row.knownCents,null);
  assert.ok(row.invalidEntries.some(e=>e.reason==='aggregate_overflow'&&e.field==='knownCents'));
  assert.equal(row.rates[0].cents,Number.MAX_SAFE_INTEGER);assert.equal(row.rates[1].cents,1);
});

test('estimated aggregate and per-rate overflow also stay explicit',()=>{
  const fixture=state();fixture.settings.mountingRateHistory=[rate({rateCents:Number.MAX_SAFE_INTEGER})];
  const row=first([entry({id:'one',qty:1}),entry({id:'two',qty:1})],fixture);
  assert.equal(row.estimatedCents,null);assert.equal(row.rates[0].cents,null);assert.equal(row.estimatedPairs,2);
  assert.ok(row.invalidEntries.some(e=>e.field==='estimatedCents'));
  assert.ok(row.invalidEntries.some(e=>e.field==='cents'));
});

test('pair aggregates never expose unsafe integers and overflow remains sticky',()=>{
  const row=first([entry({qty:Number.MAX_SAFE_INTEGER,assemblyRate:{rateCents:1}}),entry({qty:1,assemblyRate:{rateCents:1}}),entry({qty:1,assemblyRate:{rateCents:1}})]);
  assert.equal(row.totalPairs,null);assert.equal(row.knownPairs,null);assert.equal(row.knownCents,null);
  assert.equal(row.rates[0].pairs,null);assert.equal(row.rates[0].cents,null);
  assert.equal(row.invalidEntries.filter(e=>e.field==='totalPairs').length,1);
});

test('unpriced pair overflow is visible without inventing a zero or rounded total',()=>{
  const fixture=state();fixture.settings.mountings[0].rate=0;
  const row=first([entry({qty:Number.MAX_SAFE_INTEGER}),entry({qty:1})],fixture);
  assert.equal(row.totalPairs,null);assert.equal(row.unpricedPairs,null);
  assert.ok(row.invalidEntries.some(e=>e.field==='unpricedPairs'));
});

test('inactive, orphaned, and prototype-like mounting IDs retain separate rows',()=>{
  const result=values([
    entry({mountingId:'b',qty:2,mountingRate:2}),
    entry({mountingId:'orphan',mountingName:'Montagem removida',qty:3,mountingRate:3}),
    entry({mountingId:'__proto__',qty:1,mountingRate:1}),
    entry({mountingId:'constructor',qty:1,mountingRate:2})
  ],state(),[{id:'a',name:'A',rate:7}]);
  assert.deepEqual(result.mountings.map(m=>m.id),['a','b','orphan','__proto__','constructor']);
  assert.equal(result.mountings[0].knownCents,0);assert.equal(result.mountings[1].knownCents,400);
  assert.equal(result.mountings[2].name,'Montagem removida');assert.equal(result.mountings[2].knownCents,900);
  assert.equal(result.mountings[3].knownCents,100);assert.equal(result.mountings[4].knownCents,200);
});

test('missing mounting IDs remain visible and unpriced instead of disappearing',()=>{
  const row=first([entry({mountingId:null,qty:4,mountingRate:2})]);
  assert.equal(row.id,null);assert.equal(row.name,'Montagem não identificada');assert.equal(row.totalPairs,4);
  assert.equal(row.unpricedPairs,4);assert.equal(row.knownCents,0);assert.equal(row.invalidEntries[0].reason,'invalid_mounting_id');
});

test('component, stock, and other non-finished entries cannot enter production values',()=>{
  const result=values(['cabedal','solado','palmilha','produto_pronto','',undefined].map(kind=>entry({kind,qty:100,mountingRate:99})).concat(entry({qty:2,mountingRate:2.6})));
  assert.equal(result.mountings.length,1);assert.equal(result.mountings[0].totalPairs,2);assert.equal(result.mountings[0].knownCents,520);
  assert.equal(result.invalidEntries.length,0);
});

test('known, estimated and unpriced pairs remain separate in one mounting',()=>{
  const row=first([entry({qty:2,mountingRate:2}),entry({qty:3}),entry({qty:4,mountingRate:null})]);
  assert.equal(row.totalPairs,9);assert.equal(row.knownPairs,2);assert.equal(row.knownCents,400);
  assert.equal(row.estimatedPairs,3);assert.equal(row.estimatedCents,2700);assert.equal(row.unpricedPairs,4);
  assert.equal(row.invalidEntries.length,1);
});

test('malformed entry collections and rows yield inspectable errors without throwing',()=>{
  assert.equal(values(null).invalidEntries[0].reason,'invalid_entries');
  const result=values([null,1,'bad',[],entry({qty:1,mountingRate:1})]);
  assert.equal(result.invalidEntries.length,4);assert.equal(result.mountings[0].knownCents,100);
  assert.doesNotThrow(()=>Dashboard.productionValues(null));
});

test('projection does not mutate, backfill, add obligations, or alter historical input',()=>{
  const fixture=state();fixture.settings.mountingRateHistory=[rate({effectiveFrom:'2026-10-07',rateCents:300}),rate()];
  fixture.factoryExpenses=[];fixture.financeControl={advances:[],settlements:[]};
  const entries=[entry({date:'2026-10-06'}),entry({assemblyRate:{rateCents:260}})],mountings=[{id:'a',name:'Snapshot',rate:1}];
  const before=JSON.stringify([fixture,entries,mountings]);freeze(fixture);freeze(entries);freeze(mountings);
  const result=Dashboard.productionValues(fixture,entries,mountings);
  assert.equal(JSON.stringify([fixture,entries,mountings]),before);
  result.mountings[0].name='Changed output';result.mountings[0].rates[0].rateCents=1;
  assert.equal(JSON.stringify([fixture,entries,mountings]),before);
});

test('browser export works without the assembly module or any persistence API',()=>{
  const context=vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../dashboard-view.js'),'utf8'),context);
  assert.equal(typeof context.FioriDashboard.productionValues,'function');
  const result=context.FioriDashboard.productionValues({},[entry({qty:1,mountingRate:2})]);
  assert.equal(result.mountings[0].knownCents,200);assert.equal(context.FioriAssembly,undefined);
});
