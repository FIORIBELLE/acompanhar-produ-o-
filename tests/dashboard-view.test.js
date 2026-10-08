'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const Inventory=require('../inventory-guard');
const Dashboard=require('../dashboard-view');
const {state}=require('./fixtures/dashboard-state');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(m=>m[2].trim());
function app(fixture=state()){
  const nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',hidden:false,textContent:'',setAttribute(){},querySelectorAll(){return[]}});return nodes.get(id)};
  const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-10-07T21:00:00Z']))}static now(){return new Date('2026-10-07T21:00:00Z').getTime()}};
  const context=vm.createContext({FioriInventory:Inventory,FioriDashboard:Dashboard,Date:FixedDate,Intl,console,
    localStorage:{getItem:()=>JSON.stringify(fixture),setItem(){throw Error('Unexpected save')}},
    document:{getElementById:node,querySelector:node,querySelectorAll(){return[]}},
    window:{scrollTo(){}},setTimeout(){},clearTimeout(){}});
  const main=scripts[0][2].slice(0,scripts[0][2].lastIndexOf('\ndocument.querySelectorAll("nav [role=tab]").forEach'));
  vm.runInContext(main+'\nglobalThis.testApi={renderWeek,readyStockForWeek,mountingsForWeek,weekSummary,ui,getData:()=>data};',context);
  return{api:context.testApi,nodes,node};
}
for(const [qty,expected] of [[0,'0 fichas'],[72,'1 ficha'],[96,'1 ficha + 4 kits'],[168,'2 fichas + 4 kits']]){
  test(`formats ${qty} pairs without decimal sheets`,()=>assert.equal(Dashboard.unitsText(qty,{pairsPerSheet:72,pairsPerKit:6}),expected));
}
test('uses configurable units and keeps leftover pairs',()=>{
  assert.equal(Dashboard.unitsText(98,{pairsPerSheet:72,pairsPerKit:6}),'1 ficha + 4 kits + 2 pares avulsos');
  assert.equal(Dashboard.unitsText(50,{pairsPerSheet:48,pairsPerKit:6}),'1 ficha + 2 pares avulsos');
  assert.equal(Dashboard.unitsText(72,{pairsPerSheet:0,pairsPerKit:null}),'1 ficha');
});
test('resolves descriptions from model or catalog',()=>{
  const fixture=state();
  assert.deepEqual(Dashboard.modelInfo(fixture,'m507'),{id:'m507',ref:'507',description:'Meu Bom (exemplo)'});
  assert.equal(Dashboard.modelInfo(fixture,'512').description,'Sandália teste');
  assert.equal(Dashboard.modelInfo(fixture,'999').ref,'999');
});
test('shows per-mounting cabedal counts independently of production capacity',()=>{
  const fixture=state(),stock=Inventory.mountingBalances(fixture,'2026-10-07').stock;
  const cards=Dashboard.mountingCards(fixture,stock,fixture.settings.mountings.filter(m=>m.active));
  assert.equal(cards.length,3);
  assert.deepEqual(cards[0].models.map(m=>[m.ref,m.qty]),[['507',168],['512',72]]);
  assert.equal(cards[0].total,240);
  assert.equal(cards[0].lines.length,1);
  assert.equal(cards[0].lines[0].solado,96);
  assert.equal(Inventory.possibleForMounting(fixture,cards[0].balance),72);
  // Both models could individually use the same 72 shared pairs. Never sum that capacity.
  assert.equal(fixture.settings.models.slice(0,2).reduce((sum,m)=>sum+Inventory.possibleForModel(fixture,stock.a,m),0),144);
  assert.equal(cards[1].total,216);
  assert.equal(Inventory.possibleForMounting(fixture,cards[1].balance),96); // line 300, no insoles; other colors don't match
  assert.deepEqual(cards[2].models,[]);
});
test('preserves inactive mounting when it still has stock',()=>{
  const fixture=state();fixture.settings.mountings[0].active=false;
  const cards=Dashboard.mountingCards(fixture,Inventory.mountingBalances(fixture,'2026-10-07').stock,[]);
  assert.equal(cards.find(m=>m.id==='a').total,240);
  assert.equal(cards.some(m=>m.id==='legacy'),false);
});
test('plans use only saved model goals and flag inconsistent totals',()=>{
  const fixture=state(),week=fixture.weeks['2026-10-05'];
  assert.deepEqual(Dashboard.remainingPlan(fixture,week),{items:[],total:0,mismatch:false});
  week.modelGoals={m507:144,m512:72};
  const plan=Dashboard.remainingPlan(fixture,week,{m507:72,m512:96});
  assert.equal(plan.total,216);assert.equal(plan.mismatch,true);
  assert.deepEqual(plan.items.map(m=>m.remaining),[72,0]);
  assert.equal(week.goal,864); // never silently replace the saved goal
});
test('saved goals for inactive models still count their completed production',()=>{
  const fixture=state(),week=fixture.weeks['2026-10-05'];
  fixture.settings.models[0].active=false;week.modelGoals={m507:72};
  week.entries.push({id:'finished-inactive',date:'2026-10-07',kind:'finished',mountingId:'a',modelId:'m507',modelName:'507',line:'500',color:'Preto',qty:72});
  const {api,node}=app(fixture);api.renderWeek();
  assert.match(node('tab-week').innerHTML,/As metas salvas por modelo foram atingidas/);
});
test('ready stock comes from ledger and excludes dispatched pairs',()=>{
  const fixture=state();fixture.stockLedger.push({id:'dispatch',date:'2026-10-07',sector:'produto_pronto',direction:'out',ref:'507',qty:72,color:'Preto'});
  const {api}=app(fixture),ready=api.readyStockForWeek();
  assert.equal(ready.total,240);assert.equal(ready.items.find(m=>m.ref==='507').qty,96);
});
test('renders three primary blocks with detailed material and finance disclosure closed',()=>{
  const {api,node}=app(),before=JSON.stringify(api.getData());api.renderWeek();
  const rendered=node('tab-week').innerHTML;
  for(const id of ['week-ready-stock','week-mounting-stock','week-remaining'])assert.match(rendered,new RegExp(`id="${id}"`));
  assert.match(rendered,/Cabedais nas montagens/);assert.match(rendered,/2 fichas \+ 4 kits/);
  assert.match(rendered,/Plano por modelo não definido/);assert.match(rendered,/Meta salva: 864 pares/);
  assert.match(rendered,/<details class="mounting-materials"><summary>Ver cores dos materiais e capacidade/);
  assert.match(rendered,/<details class="block dashboard-details" id="week-details"><summary>/);
  assert.ok(rendered.indexOf('produção bruta')>rendered.indexOf('id="week-details"'));
  assert.equal(JSON.stringify(api.getData()),before,'render must not save or change operational state');
  node('open-ready-stock').onclick();assert.equal(api.ui.tab,'stock');
});
test('keeps archived week read-only and does not imply current ready stock is historical',()=>{
  const {api,node}=app();api.renderWeek('2026-09-28');const rendered=node('tab-week').innerHTML;
  assert.match(rendered,/Semana arquivada/);assert.doesNotMatch(rendered,/id="week-ready-stock"/);
  assert.match(rendered,/Saldo no fim desta semana/);assert.equal(node('edit-goal').hidden,true);
  node('back-current').onclick();assert.equal(api.ui.viewWeek,null);assert.equal(node('edit-goal').hidden,false);
});
test('archived production, saved goals and cabedais retain snapshot names after a rename',()=>{
  const fixture=state(),previous=fixture.weeks['2026-09-28'];
  previous.modelSnapshot=structuredClone(fixture.settings.models);
  previous.modelSnapshot[0].name='507 – Nome arquivado';
  previous.modelGoals={m507:144};
  previous.entries.push({id:'old-cabedal',date:'2026-09-30',kind:'cabedal',mountingId:'a',modelId:'m507',modelName:'507 – Nome arquivado',line:'500',color:'Preto',qty:72});
  fixture.settings.models[0].name='507 – Nome atual';
  fixture.settings.costCatalog['507'].model='Descrição atual do catálogo';
  const {api,node}=app(fixture),before=JSON.stringify(api.getData());api.renderWeek('2026-09-28');
  const rendered=node('tab-week').innerHTML;
  assert.equal((rendered.match(/Nome arquivado/g)||[]).length,3);
  assert.doesNotMatch(rendered,/Nome atual|Descrição atual do catálogo/);
  assert.equal(JSON.stringify(api.getData()),before);
  api.renderWeek();assert.match(node('tab-week').innerHTML,/Nome atual/);
});
test('numeric snapshot names do not acquire current catalog descriptions',()=>{
  const fixture=state(),week=fixture.weeks['2026-09-28'];
  week.modelSnapshot=structuredClone(fixture.settings.models);week.modelSnapshot[0].name='507';
  fixture.settings.costCatalog['507'].model='Descrição recém-alterada';
  const historical=Dashboard.displayStateForWeek(fixture,week,true);
  assert.equal(Dashboard.modelInfo(historical,'m507').description,'');
  assert.equal(Dashboard.displayStateForWeek(fixture,week,false),fixture);
});
test('keeps stock divergence warning outside all collapsed details',()=>{
  const fixture=state();fixture.stockLedger.push({id:'overdrawn',date:'2026-10-07',sector:'produto_pronto',direction:'out',ref:'506',qty:144,color:'Preto'});
  const {api,node}=app(fixture);api.renderWeek();const rendered=node('tab-week').innerHTML;
  assert.match(rendered,/role="alert"/);assert.match(rendered,/não confirmam o estoque físico/);
  assert.ok(rendered.indexOf('Há divergências')<rendered.indexOf('id="week-ready-stock"'));
});
test('escapes displayed names and keeps empty mountings legible',()=>{
  const fixture=state();fixture.settings.mountings[0].name='<img src=x onerror=alert(1)>';
  fixture.settings.costCatalog['507'].model='<b>unsafe</b>';
  const {api,node}=app(fixture);api.renderWeek();const rendered=node('tab-week').innerHTML;
  assert.match(rendered,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.match(rendered,/&lt;b&gt;unsafe&lt;\/b&gt;/);
  assert.match(rendered,/Sem cabedais com saldo nesta montagem/);assert.doesNotMatch(rendered,/<img src=x/);
});
test('keeps sync status in sticky chrome, including pending and conflict messages',()=>{
  assert.match(html,/<div class="app-chrome">[\s\S]*?id="header-status" role="status" aria-live="polite"[\s\S]*?<\/nav>\s*<\/div>/);
  assert.match(html,/\.app-chrome\{position:sticky/);
  assert.match(html,/Conflito protegido · não altere até revisar/);
  assert.match(html,/Erro de sincronização · pendente/);
});
test('all inline scripts parse, including the Sales module',()=>{
  for(const script of scripts)assert.doesNotThrow(()=>new vm.Script(script[2]));
});

for(const [qty,expected] of [[0,'0 fichas'],[1,'1 par'],[6,'6 pares'],[71,'71 pares'],[72,'1 ficha'],[73,'1 ficha + 1 par'],[144,'2 fichas'],[150,'2 fichas + 6 pares'],[168,'2 fichas + 24 pares'],[576,'8 fichas'],[588,'8 fichas + 12 pares'],[1152,'16 fichas']]){
  test(`material summary formats ${qty} pairs as whole sheets and leftover pairs`,()=>{
    assert.equal(Dashboard.materialUnitsText(qty,{pairsPerSheet:72,pairsPerKit:6}),expected);
  });
}
test('material sheet format follows configured size, falls back safely and never hides a negative balance',()=>{
  assert.equal(Dashboard.materialUnitsText(150,{pairsPerSheet:48}),'3 fichas + 6 pares');
  for(const size of [0,-1,2.5,NaN,Infinity,'bad',null]){
    assert.equal(Dashboard.materialUnitsText(150,{pairsPerSheet:size}),'2 fichas + 6 pares');
    assert.equal(Dashboard.materialSheetSize({pairsPerSheet:size}),72);
  }
  assert.equal(Dashboard.materialUnitsText(-6),'-6 pares (saldo negativo)');
  for(const qty of [1.5,NaN,Infinity,'bad'])assert.equal(Dashboard.materialUnitsText(qty),'Quantidade inválida');
});
test('mounting material totals combine colors by line and keep per-color pairs in closed details',()=>{
  const fixture=state(),entries=fixture.weeks['2026-10-05'].entries;
  const solado=entries.find(e=>e.mountingId==='a'&&e.kind==='solado');
  const palmilha=entries.find(e=>e.mountingId==='a'&&e.kind==='palmilha');
  solado.qty=144;palmilha.qty=288;
  for(const [i,color] of ['Rose','Off White','Ouro Light'].entries()){
    entries.push({...solado,id:'sheet-sole-'+i,color},{...palmilha,id:'sheet-insole-'+i,color});
  }
  const {api,node}=app(fixture),before=JSON.stringify(api.getData());api.renderWeek();
  const card=node('tab-week').innerHTML.match(/data-mounting-card="a"[\s\S]*?<\/article>/)[0];
  const summary=card.split('<details class="mounting-materials">')[0];
  assert.match(summary,/Solados<\/span><strong>8 fichas<\/strong>/);
  assert.match(summary,/Palmilhas<\/span><strong>16 fichas<\/strong>/);
  assert.doesNotMatch(summary,/576 pares|1\.152 pares/);
  assert.match(card,/Solado · Preto: 144 pares/);assert.match(card,/Palmilha · Preto: 288 pares/);
  assert.match(card,/Fichas por quantidade · 72 pares cada/);
  assert.match(card,/não confirma uma grade completa de cores e tamanhos/);
  assert.doesNotMatch(card,/<details class="mounting-materials" open/);
  assert.equal(JSON.stringify(api.getData()),before);
});
test('material sheets do not change available production when colors do not match',()=>{
  const {api,node}=app(),before=JSON.stringify(api.getData());api.renderWeek();
  const card=node('tab-week').innerHTML.match(/data-mounting-card="b"[\s\S]*?<\/article>/)[0];
  assert.match(card,/Linha 300/);assert.match(card,/1 ficha \+ 24 pares/);assert.match(card,/Não usa palmilha/);
  assert.match(card,/Linha 500/);assert.match(card,/Palmilhas<\/span><strong>1 ficha/);
  assert.match(card,/pode produzir <strong>96 pares<\/strong>/);
  assert.equal(JSON.stringify(api.getData()),before);
});
test('shows zero material in an existing line and material-only mounting without changing state',()=>{
  const fixture=state(),entries=fixture.weeks['2026-10-05'].entries;
  const e=entries.find(e=>e.mountingId==='a'&&e.kind==='solado');
  entries.push({...e,id:'material-only',mountingId:'empty',qty:150});
  const {api,node}=app(fixture);api.renderWeek();
  const card=node('tab-week').innerHTML.match(/data-mounting-card="empty"[\s\S]*?<\/article>/)[0];
  assert.match(card,/Sem cabedais com saldo nesta montagem/);
  assert.match(card,/Solados<\/span><strong>2 fichas \+ 6 pares/);
  assert.match(card,/Palmilhas<\/span><strong>0 fichas/);
});
test('material summary respects configured size and archived balances',()=>{
  const fixture=state();fixture.settings.pairsPerSheet=48;
  const previous=fixture.weeks['2026-09-28'];
  previous.entries=[{...fixture.weeks['2026-10-05'].entries.find(e=>e.kind==='solado'),id:'old-material',date:'2026-09-30',qty:150}];
  const {api,node}=app(fixture),before=JSON.stringify(api.getData());api.renderWeek('2026-09-28');
  const rendered=node('tab-week').innerHTML;
  assert.match(rendered,/Fichas por quantidade · 48 pares cada/);
  assert.match(rendered,/Solados<\/span><strong>3 fichas \+ 6 pares/);
  assert.equal(JSON.stringify(api.getData()),before);
});
test('material color detail escapes untrusted color names',()=>{
  const fixture=state();fixture.weeks['2026-10-05'].entries.find(e=>e.kind==='solado').color='<img src=x onerror=alert(1)>';
  const {api,node}=app(fixture);api.renderWeek();
  assert.match(node('tab-week').innerHTML,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(node('tab-week').innerHTML,/<img src=x/);
});

test('new dashboard script uses a cache-busted URL also precached by the service worker',()=>{
  const scriptUrl=html.match(/<script src="(dashboard-view\.js\?v=[^"]+)"><\/script>/)?.[1];
  assert.equal(scriptUrl,'dashboard-view.js?v=27');
  const sw=fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8');
  assert.ok(sw.includes('"./'+scriptUrl+'"'));
  assert.match(sw,/shell-v28/);
});
