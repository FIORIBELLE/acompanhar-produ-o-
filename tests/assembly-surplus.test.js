'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../dashboard-view'),I=require('../inventory-guard');
const {state}=require('./fixtures/dashboard-state');
function fixture({cabedal=216,solado=576,palmilha=1152,line='500',color='Preto'}={}){
  const d=state();d.weeks['2026-10-05'].entries=[];d.stockLedger=[];
  const modelId=line==='300'?'m319':'m507';
  for(const [kind,qty] of Object.entries({cabedal,solado,palmilha}))if(qty)d.weeks['2026-10-05'].entries.push({id:kind,date:'2026-10-07',mountingId:'a',kind,qty,line,modelId:kind==='cabedal'?modelId:'',color});
  return d;
}
function summary(d,id='a',until='2026-10-07'){
  const {stock,issues}=I.mountingBalances(d,until);return D.mountingLineCapacity(d,stock[id],{issues});
}
test('216 heads, 576 soles and 1152 insoles leave 360 and 936 pairs, exactly 5 and 13 sheets',()=>{
 const d=fixture(),before=JSON.stringify(d),p=summary(d)[0];
 assert.equal(p.capacity,216);assert.equal(p.compatible,216);
 assert.deepEqual(p.surplus,{cabedal:0,solado:360,palmilha:936});assert.deepEqual(p.limiting,['cabedal']);
 assert.equal(D.materialUnitsText(p.surplus.solado),'5 fichas');assert.equal(D.materialUnitsText(p.surplus.palmilha),'13 fichas');
 assert.deepEqual(p.errors,[]);assert.equal(JSON.stringify(d),before);
});
for(const [cabedal,solado,palmilha,capacity,surplus] of [
 [0,0,0,0,[0,0,0]],[0,72,144,0,[0,72,144]],[72,0,144,0,[72,0,144]],
 [72,144,0,0,[72,144,0]],[72,72,72,72,[0,0,0]],[100,89,95,89,[11,0,6]],
 [216,144,288,144,[72,0,144]],[216,288,144,144,[72,144,0]]
])test(`line limit and surplus ${cabedal}/${solado}/${palmilha}`,()=>{
 const rows=summary(fixture({cabedal,solado,palmilha}));
 if(!cabedal&&!solado&&!palmilha){assert.deepEqual(rows,[]);return}
 const p=rows[0];assert.equal(p.capacity,capacity);assert.deepEqual(Object.values(p.surplus),surplus);
});
test('line 300 ignores insoles and preserves any existing insole quantity as surplus',()=>{
 for(const palmilha of [0,100]){const p=summary(fixture({cabedal:216,solado:144,palmilha,line:'300'}))[0];assert.equal(p.capacity,144);assert.equal(p.compatible,144);assert.equal(p.usesPalmilha,false);assert.deepEqual(p.surplus,{cabedal:72,solado:0,palmilha})}
});
test('model with an explicit no-insole bill of materials is respected outside line 300',()=>{
 const d=fixture({palmilha:0});d.settings.models.find(m=>m.id==='m507').usesPalmilha=false;
 assert.equal(summary(d)[0].capacity,216);assert.equal(summary(d)[0].compatible,216);
});
test('shared soles and insoles are consumed once per line, never once per model',()=>{
 const d=fixture({cabedal:72,solado:72,palmilha:72});
 d.weeks['2026-10-05'].entries.push({...d.weeks['2026-10-05'].entries[0],id:'other-head',modelId:'m512'});
 const p=summary(d)[0];assert.equal(p.totals.cabedal,144);assert.equal(p.capacity,72);assert.equal(p.compatible,72);assert.equal(p.surplus.cabedal,72);
});
test('different colors retain the quantity limit and clearly flag lower compatible capacity',()=>{
 const d=fixture({cabedal:72,solado:72,palmilha:72});d.weeks['2026-10-05'].entries[1].color='Caramelo';
 const p=summary(d)[0];assert.equal(p.capacity,72);assert.equal(p.compatible,0);assert.match(p.warnings.join(' '),/cores registradas não fecham/);assert.deepEqual(p.surplus,{cabedal:0,solado:0,palmilha:0});
});
test('known color fragments combine by matching color without inflating capacity',()=>{
 const d=fixture({cabedal:18,solado:24,palmilha:12});
 const rows=d.weeks['2026-10-05'].entries;
 rows.push(...rows.map(r=>({...r,id:r.id+'-caramelo',color:'Caramelo',qty:r.kind==='palmilha'?100:6})));
 const p=summary(d)[0];assert.equal(p.capacity,24);assert.equal(p.compatible,18);assert.equal(p.warnings.length,1);
});
for(const color of ['',null,'Fichas','Não informado','Sem cor discriminada'])test(`unknown color ${color} stays in totals but never proves color compatibility`,()=>{
 const p=summary(fixture({color}))[0];assert.equal(p.capacity,216);assert.equal(p.compatible,0);assert.deepEqual(p.unknown,p.totals);assert.equal(p.surplus.solado,360);assert.match(p.warnings.join(' '),/permanece nos totais/);
});
test('unknown stock alongside known colors only contributes to aggregate quantity estimate',()=>{
 const d=fixture({cabedal:72,solado:144,palmilha:144});d.weeks['2026-10-05'].entries.push({...d.weeks['2026-10-05'].entries[0],id:'unknown-head',qty:72,color:''});
 const p=summary(d)[0];assert.equal(p.capacity,144);assert.equal(p.compatible,72);assert.equal(p.unknown.cabedal,72);
});
test('synonyms are normalized by the stock engine',()=>{
 const d=fixture({color:'Rosa'});d.weeks['2026-10-05'].entries[1].color='Rose';assert.equal(summary(d)[0].compatible,216);
});
test('lines and mountings are not pooled',()=>{
 const d=fixture({cabedal:72,solado:0,palmilha:72}),entries=d.weeks['2026-10-05'].entries;
 entries.push({id:'wrong-line',date:'2026-10-07',kind:'solado',mountingId:'a',line:'300',color:'Preto',qty:72},{id:'wrong-mounting',date:'2026-10-07',kind:'solado',mountingId:'b',line:'500',color:'Preto',qty:72});
 assert.equal(summary(d).find(p=>p.line==='500').capacity,0);assert.equal(summary(d,'b')[0].capacity,0);
});
test('future entries are excluded, old stock included and returns deducted exactly once',()=>{
 const d=fixture({cabedal:216,solado:576,palmilha:1152}),entries=d.weeks['2026-10-05'].entries;
 entries.push({id:'done',date:'2026-10-07',kind:'finished',mountingId:'a',line:'500',modelId:'m507',color:'Preto',qty:72},{id:'future',date:'2026-10-08',kind:'cabedal',mountingId:'a',line:'500',modelId:'m507',color:'Preto',qty:100});
 const p=summary(d)[0];assert.equal(p.capacity,144);assert.deepEqual(p.surplus,{cabedal:0,solado:360,palmilha:936});assert.equal(summary(d,'a','2026-10-08')[0].capacity,244);
});
test('negative stock suspends all computed capacity and surplus instead of clipping to zero',()=>{
 const d=fixture({cabedal:72,solado:72,palmilha:72});d.weeks['2026-10-05'].entries.push({id:'overdraw',date:'2026-10-07',kind:'finished',mountingId:'a',line:'500',modelId:'m507',color:'Preto',qty:144});
 const p=summary(d)[0];assert.deepEqual(p.totals,{cabedal:-72,solado:-72,palmilha:-72});assert.equal(p.capacity,null);assert.equal(p.compatible,null);assert.equal(p.surplus,null);assert.match(p.errors.join(' '),/negativo/);
});
test('unrelated inventory issue suspends estimate rather than treating invalid entries as absent',()=>{
 const d=fixture();d.weeks['2026-10-05'].entries.push({id:'bad',date:'bad',qty:72});assert.equal(summary(d)[0].capacity,null);
});
test('invalid, overflowing and mismatched balance summaries cannot produce confirmed results',()=>{
 const d=fixture(),{stock}=I.mountingBalances(d,'2026-10-07');
 for(const value of [NaN,Infinity,'72',-1,Number.MAX_SAFE_INTEGER+1]){const b=structuredClone(stock.a);b.lines['500'].solado=value;const p=D.mountingLineCapacity(d,b)[0];assert.equal(p.capacity,null);assert.equal(p.surplus,null)}
 const b=structuredClone(stock.a);b.models.m507.cabedal=200;assert.equal(D.mountingLineCapacity(d,b)[0].capacity,null);
});
test('duplicate color balances, references or model identities suspend estimation',()=>{
 const d=fixture(),{stock}=I.mountingBalances(d,'2026-10-07');
 stock.a.colorRows.push({...stock.a.colorRows[1]});stock.a.lines['500'].solado*=2;assert.equal(D.mountingLineCapacity(d,stock.a)[0].capacity,null);
 for(const m of [{...d.settings.models[0]},{...d.settings.models[0],id:'duplicate'}]){const x=fixture();x.settings.models.push(m);assert.equal(summary(x)[0].capacity,null)}
});
test('mixed insole requirements retain stock while refusing an arbitrary allocation',()=>{
 const d=fixture(),rows=d.weeks['2026-10-05'].entries;d.settings.models.find(m=>m.id==='m512').usesPalmilha=false;
 rows.push({...rows[0],id:'alternative',modelId:'m512',qty:72});const p=summary(d)[0];assert.equal(p.totals.cabedal,288);assert.equal(p.capacity,null);assert.match(p.errors.join(' '),/materiais diferentes/);
});
test('inactive models still count and historical material changes request review',()=>{
 const d=fixture();d.settings.models.find(m=>m.id==='m507').active=false;assert.equal(summary(d)[0].capacity,216);
 const source=structuredClone(d.settings.models),{stock}=I.mountingBalances(d,'2026-10-07');d.settings.models.find(m=>m.id==='m507').line='600';
 const p=D.mountingLineCapacity(d,stock.a,{sourceModels:source}).find(p=>p.line==='600');assert.equal(p.capacity,null);assert.match(p.errors.join(' '),/histórico/);
});
test('frozen inputs and repeated reads remain unchanged',()=>{
 const d=fixture(),{stock}=I.mountingBalances(d,'2026-10-07'),before=JSON.stringify({d,stock});
 const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x)}};freeze(d);freeze(stock);
 const a=D.mountingLineCapacity(d,stock.a),b=D.mountingLineCapacity(d,stock.a);assert.deepEqual(a,b);assert.equal(JSON.stringify({d,stock}),before);
});
