'use strict';
// Independent read-only review. Synthetic fixtures only; no network or persistence.
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../dashboard-view'),I=require('../inventory-guard');
const {state}=require('./fixtures/dashboard-state');

function fixture(){
  const d=state();d.stockLedger=[];
  for(const week of Object.values(d.weeks))week.entries=[];
  return d;
}
function entry(d,kind,qty,{color='Preto',modelId='m507',line='500',mountingId='a',date='2026-10-07'}={}){
  const entries=d.weeks['2026-10-05'].entries;
  entries.push({id:'review-'+entries.length,kind,qty,color,modelId:kind==='cabedal'||kind==='finished'?modelId:'',line,mountingId,date});
}
function project(d){const {stock,issues}=I.mountingBalances(d,'2026-10-07');return D.mountingLineCapacity(d,stock.a,{issues});}

test('review: randomized homogeneous bills preserve quantity/color upper bounds and each material total',()=>{
  let seed=91827;
  const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  for(let iteration=0;iteration<250;iteration++){
    const d=fixture(),withoutPalm=iteration%3===0;
    const line=withoutPalm?'300':'500',models=withoutPalm?['m319']:['m507','m512'];
    const totals={cabedal:0,solado:0,palmilha:0},expectedUnknown={cabedal:0,solado:0,palmilha:0};
    let compatible=0;
    for(const color of ['Preto','Caramelo','Rose','']){
      let heads=0;
      for(const modelId of models){const qty=random(150);heads+=qty;if(qty)entry(d,'cabedal',qty,{modelId,line,color});}
      const soles=random(240),palms=random(240);
      if(soles)entry(d,'solado',soles,{line,color});
      if(palms)entry(d,'palmilha',palms,{line,color});
      totals.cabedal+=heads;totals.solado+=soles;totals.palmilha+=palms;
      if(color)compatible+=Math.min(heads,soles,withoutPalm?Infinity:palms);
      else Object.assign(expectedUnknown,{cabedal:heads,solado:soles,palmilha:palms});
    }
    const before=JSON.stringify(d),p=project(d)[0];
    const capacity=Math.min(totals.cabedal,totals.solado,withoutPalm?Infinity:totals.palmilha);
    assert.deepEqual(p.errors,[]);assert.deepEqual(p.totals,totals);
    assert.equal(p.capacity,capacity);assert.equal(p.compatible,compatible);
    assert.deepEqual(p.unknown,expectedUnknown);
    for(const sector of Object.keys(totals))assert.equal(p.surplus[sector]+(sector==='palmilha'&&withoutPalm?0:capacity),totals[sector]);
    assert.equal(JSON.stringify(d),before);
  }
});

test('review: positive aggregate cannot hide a negative balance in one color',()=>{
  const d=fixture();
  for(const kind of ['cabedal','solado','palmilha'])entry(d,kind,72,{color:'Caramelo'});
  entry(d,'finished',12);
  const p=project(d)[0];
  assert.deepEqual(p.totals,{cabedal:60,solado:60,palmilha:60});
  assert.equal(p.capacity,null);assert.equal(p.compatible,null);assert.equal(p.surplus,null);
  assert.match(p.errors.join(' '),/negativo/);
});

test('review: summed overflow is rejected even when every source movement is a safe integer',()=>{
  const d=fixture();
  for(const kind of ['cabedal','solado','palmilha']){
    entry(d,kind,Number.MAX_SAFE_INTEGER);
    entry(d,kind,1,{color:'Caramelo'});
  }
  const p=project(d)[0];assert.equal(p.capacity,null);assert.equal(p.compatible,null);assert.equal(p.surplus,null);
  assert.match(p.errors.join(' '),/Quantidade inválida|limite/);
});

test('review: completely consumed inactive stock is omitted without phantom leftovers',()=>{
  const d=fixture();
  for(const kind of ['cabedal','solado','palmilha'])entry(d,kind,72);
  entry(d,'finished',72);d.settings.models[0].active=false;d.settings.mountings[0].active=false;
  assert.deepEqual(project(d),[]);
});

test('review: size detail never creates independent capacity or alters balances',()=>{
  const d=fixture();for(const kind of ['cabedal','solado','palmilha'])entry(d,kind,72);
  const expected=project(d);
  for(const e of d.weeks['2026-10-05'].entries)e.sizeBreakdown=e.kind==='cabedal'?{'35':72}:{'39':72};
  assert.deepEqual(project(d),expected);
});

test('review: changing historical insole requirements suspends only a reviewable calculation',()=>{
  const d=fixture();for(const kind of ['cabedal','solado','palmilha'])entry(d,kind,72);
  const sourceModels=structuredClone(d.settings.models),{stock}=I.mountingBalances(d,'2026-10-07');
  d.settings.models[0].usesPalmilha=false;
  const before=JSON.stringify({d,stock,sourceModels});
  const p=D.mountingLineCapacity(d,stock.a,{sourceModels})[0];
  assert.equal(p.capacity,null);assert.equal(p.surplus,null);assert.match(p.errors.join(' '),/histórico/);
  assert.equal(JSON.stringify({d,stock,sourceModels}),before);
});

test('review: inventory validation rejects fractional, missing and string quantities instead of estimating around them',()=>{
  for(const qty of [0,-1,0.5,NaN,Infinity,undefined,null,'72']){
    const d=fixture();for(const kind of ['cabedal','solado','palmilha'])entry(d,kind,72);
    entry(d,'cabedal',qty);
    const p=project(d)[0];assert.equal(p.capacity,null);assert.equal(p.surplus,null);
  }
});
