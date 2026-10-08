'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../dashboard-view'),I=require('../inventory-guard');
const {state}=require('./fixtures/dashboard-state');
const WEEK='2026-10-05',TODAY='2026-10-07';
function fixture(){const d=state(),w=d.weeks[WEEK];w.goal=1008;w.modelGoals={m506:144,m507:360,m512:360,m319:144};return d}
function plan(d,until=TODAY){return D.referencePlan(d,d.weeks[WEEK],WEEK,until,I.ledger(d,{until}))}
const input=(id,sheets,pairs='')=>({id,sheets,pairs});
test('14 sheets convert exactly to 1008 pairs using existing per-model pair fields',()=>{
 const p=D.parseGoalInput('1008',[input('m506','2'),input('m507','5'),input('m512','5'),input('m319','2')]);
 assert.deepEqual(p,{ok:true,goal:1008,modelGoals:{m506:144,m507:360,m512:360,m319:144},total:1008});assert.equal(D.GOAL_SHEET_SIZE,72);
});
test('legacy partial sheet goals retain all pairs rather than round',()=>{
 assert.deepEqual(D.parseGoalInput('75',[input('m507','1','3')]).modelGoals,{m507:75});
 assert.equal(D.parseGoalInput('72',[input('m507','','72')]).ok,false);
});
test('empty model plan is optional but any assigned plan must match total',()=>{
 assert.equal(D.parseGoalInput('1008',[input('m507','','')]).ok,true);
 assert.equal(D.parseGoalInput('1008',[input('m507','13')]).ok,false);
 for(const v of ['',0,-1,'2.5','1e3','Infinity','9007199254740992'])assert.equal(D.parseGoalInput(v,[]).ok,false);
});
test('invalid quantities, signs, decimals and overflows never produce a partial candidate',()=>{
 for(const v of ['-1','1.5','1,5','2e1','NaN','0x10','9007199254740992']){const p=D.parseGoalInput('144',[input('first','1'),input('bad',v)]);assert.equal(p.ok,false);assert.equal(p.modelGoals,undefined)}
 assert.equal(D.parseGoalInput('144',[input('same','1'),input('same','1')]).ok,false);
 assert.equal(D.parseGoalInput('9007199254740991',[input('large','9007199254740991')]).ok,false);
});
test('editor includes saved inactive and orphaned models without losing their goals',()=>{
 const d=fixture();d.settings.models[0].active=false;d.weeks[WEEK].modelGoals.retired=5;
 const models=D.goalModels(d,d.weeks[WEEK]);assert.equal(models.some(m=>m.id==='m507'),true);assert.equal(models.some(m=>m.id==='retired'),true);assert.equal(new Set(models.map(m=>m.id)).size,models.length);
});
test('reference plan never subtracts old ready stock or adds shared material capacity',()=>{
 const d=fixture(),before=JSON.stringify(d),p=plan(d);const m=p.items.find(i=>i.ref==='507');
 assert.equal(m.goal,360);assert.equal(m.done,0);assert.equal(m.inAssembly,240);assert.equal(m.cutAvailable,240);assert.equal(m.toCut,120);assert.equal(m.outsideAssembly,0);
 assert.equal(p.items.find(i=>i.ref==='506').toCut,144);assert.equal(JSON.stringify(d),before);
});
test('global cabedal includes assembly once and external cabedal is shown separately',()=>{
 const d=fixture();d.stockLedger.push({id:'extra',date:TODAY,sector:'cabedal',ref:'507',direction:'in',qty:72,color:'Preto'});
 const m=plan(d).items.find(i=>i.ref==='507');assert.equal(m.inAssembly,240);assert.equal(m.cutAvailable,312);assert.equal(m.outsideAssembly,72);assert.equal(m.toCut,48);
});
test('finished return shifts cabedal to done without double subtraction',()=>{
 const d=fixture();d.weeks[WEEK].entries.push({id:'return',date:TODAY,kind:'finished',modelId:'m507',mountingId:'a',line:'500',color:'Preto',qty:72});
 const m=plan(d).items.find(i=>i.ref==='507');assert.equal(m.done,72);assert.equal(m.inAssembly,168);assert.equal(m.cutAvailable,168);assert.equal(m.toCut,120);
});
test('current week ignores historical and future finished but includes old available cabedal',()=>{
 const d=fixture(),old=d.weeks['2026-09-28'];old.entries.push({id:'old-head',date:'2026-09-30',kind:'cabedal',modelId:'m506',mountingId:'a',line:'500',color:'Preto',qty:72});
 const w=d.weeks[WEEK];w.entries.push({id:'future-head',date:'2026-10-09',kind:'cabedal',modelId:'m506',mountingId:'a',line:'500',color:'Preto',qty:72});
 let m=plan(d).items.find(i=>i.ref==='506');assert.equal(m.done,0);assert.equal(m.inAssembly,72);assert.equal(m.toCut,72);
 m=plan(d,'2026-10-11').items.find(i=>i.ref==='506');assert.equal(m.inAssembly,144);assert.equal(m.toCut,0);
});
test('cabedal above goal is capped at zero cutting and does not fabricate finished pairs',()=>{
 const d=fixture(),m=plan(d).items.find(i=>i.ref==='319');assert.equal(m.toCut,0);assert.equal(m.done,0);assert.equal(m.inAssembly,144);
});
test('unknown colors remain a quantity estimate and do not fabricate grade',()=>{
 const d=fixture();d.weeks[WEEK].entries[0].color='Sem cor discriminada';const m=plan(d).items.find(i=>i.ref==='507');assert.equal(m.inAssembly,240);assert.equal(m.toCut,120);assert.equal(m.grade,undefined);
});
test('inventory issues and reference ambiguity suspend the cutting projection',()=>{
 const d=fixture();d.stockLedger.push({id:'out-too-many',date:TODAY,sector:'cabedal',ref:'507',direction:'out',qty:999,color:'Preto'});assert.equal(plan(d).items.find(i=>i.ref==='507').toCut,null);
 const x=fixture();x.settings.models.push({id:'duplicate',ref:'507',name:'507 Copy',line:'500'});assert.equal(plan(x).items.find(i=>i.id==='m507').toCut,null);
});
test('invalid goal, malformed done and unsafe sums never become confident zero shortages',()=>{
 const d=fixture();d.weeks[WEEK].modelGoals.m507='wrong';assert.equal(plan(d).items.find(i=>i.id==='m507').toCut,null);
 const x=fixture();x.weeks[WEEK].entries.push({id:'bad-finish',date:TODAY,kind:'finished',qty:NaN,modelId:'m507'});assert.equal(plan(x).items.find(i=>i.id==='m507').toCut,null);
});
test('frozen states and archived snapshots remain untouched',()=>{
 const d=fixture(),before=JSON.stringify(d);const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x)}};freeze(d);plan(d);D.goalModels(d,d.weeks[WEEK]);assert.equal(JSON.stringify(d),before);
});
test('an archived reference rename suspends cutting instead of mixing old reference with current ledger',()=>{
 const d=fixture(),w=d.weeks[WEEK],historical=structuredClone(d);historical.settings.models[0].ref='508';historical.settings.models[0].name='508 Old';
 const p=D.referencePlan(historical,w,WEEK,TODAY,I.ledger(d,{until:TODAY}),{sourceModels:d.settings.models});
 const m=p.items.find(i=>i.id==='m507');assert.equal(m.ref,'508');assert.equal(m.toCut,null);assert.equal(m.cutAvailable,null);assert.equal(m.outsideAssembly,null);assert.match(m.errors.join(' '),/Referência alterada/);
});
test('reserved object-property identifiers cannot bypass duplicate validation or lose assigned goals',()=>{
 for(const id of ['__proto__','constructor','prototype']){const p=D.parseGoalInput('144',[input(id,'1'),input(id,'1')]);assert.equal(p.ok,false);assert.equal(p.modelGoals,undefined)}
});
