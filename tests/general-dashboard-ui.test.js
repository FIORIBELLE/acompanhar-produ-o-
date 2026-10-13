'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createDocument}=require('./helpers/synthetic-dom'),{state}=require('./fixtures/dashboard-state');
const {fixedClock}=require('./helpers/fixed-clock');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(m=>m[2].trim());
function app(input=state(),{now='2026-10-07T18:00:00Z',general=true}={}){
 const document=createDocument('<div id="header-status"></div><div class="actions"></div><button id="edit-goal"></button><div id="modal" hidden><div id="modal-sheet"></div></div><div id="toast"></div><nav>'+['week','stock','sales','expenses','entry','history','settings'].map(t=>'<button role="tab" data-tab="'+t+'"></button>').join('')+'</nav>'+['week','stock','sales','expenses','entry','history','settings'].map(t=>'<section id="tab-'+t+'"></section>').join(''));
 const status={ready:true,loadedAt:'2026-10-07T18:00:00Z',updatedAt:'2026-10-07T17:00:00Z',pending:false,conflict:false},writes=[];
 const clock=fixedClock(now);
 const context=vm.createContext({document,Date:clock.Date,Intl,console,navigator:{},setTimeout(){},clearTimeout(){},
  ...(general?{FioriGeneral:require('../general-dashboard')} : {}),FioriInventory:require('../inventory-guard'),FioriDashboard:require('../dashboard-view'),FioriAssembly:require('../assembly-finance'),FioriFinance:require('../finance-preview'),FioriSheets:require('../standard-sheet'),FioriStockAdjustments:require('../stock-adjustment'),FioriFulfillment:require('../order-fulfillment'),
  localStorage:{getItem:()=>JSON.stringify(input),setItem:(...args)=>writes.push(args)},window:{fioriOnline:{displayStatus:()=>status,onlineMode:true,canEditGoal:()=>true,hasPending:()=>false,conflict:()=>false},scrollTo(){}}});
 const main=scripts[0][2].slice(0,scripts[0][2].lastIndexOf('\ndocument.querySelectorAll("nav [role=tab]").forEach'));vm.runInContext(main,context);
 for(const script of scripts.slice(1).filter(m=>!m[1].includes('remote-sync-v2')))vm.runInContext(script[2],context);
 vm.runInContext('globalThis.api={render:()=>render(),getData:()=>data,go:tab=>switchTab(tab),replace:d=>{data=d;render()},currentWeekKey,goalModal,closeModal,shareText,archived:()=>{ui.viewWeek="2026-09-28";render()}}',context);
 const beforeRender=JSON.stringify(context.api.getData());context.api.render();return {document,status,writes,clock,beforeRender,api:context.api,node:id=>document.getElementById(id)};
}
test('five blocks render with working month/client controls and no writes',()=>{const a=app(),before=JSON.stringify(a.api.getData());assert.equal(a.document.querySelectorAll('.general-block').length,5);a.node('general-month').value='2026-09';a.node('general-month').fire('change');a.node('general-client').fire('change');a.api.render();assert.equal(JSON.stringify(a.api.getData()),before);assert.equal(a.writes.length,0);assert.match(a.node('general-finance').textContent,/setembro/)});
test('missing current week stays absent after repeated dashboard render',()=>{const d=state();delete d.weeks['2026-10-05'];const a=app(d),before=JSON.stringify(a.api.getData());a.api.render();a.api.render();assert.equal(a.api.getData().weeks['2026-10-05'],undefined);assert.equal(JSON.stringify(a.api.getData()),before);assert.equal(a.writes.length,0);assert.match(a.node('general-production').textContent,/Não definida/)});
test('loading state never displays calculated zeros',()=>{const a=app();a.status.ready=false;a.api.render();assert.ok(a.node('general-loading'));assert.equal(a.node('general-production'),null);assert.match(a.node('general-sync').textContent,/Nenhum saldo foi confirmado/)});
test('pending and conflict states are distinct from loaded status',()=>{const a=app();a.status.pending=true;a.api.render();assert.match(a.node('general-sync').textContent,/aguardando confirmação/);a.status.conflict=true;a.api.render();assert.match(a.node('general-sync').textContent,/Conflito protegido/)});
test('stock inconsistencies suppress misleading available-ready details',()=>{const d=state();d.stockLedger.push({id:'bad',date:'2026-10-07',direction:'out',sector:'cabedal',ref:'506',qty:999,color:'Preto'});const a=app(d);assert.equal(a.node('week-ready-stock'),null);assert.match(a.node('general-stock').textContent,/A conferir/);assert.match(a.node('general-stock').textContent,/Detalhamento de disponibilidade suspenso/)});
test('navigation to forms and back preserves dashboard filters and data',()=>{const a=app(),before=JSON.stringify(a.api.getData());a.node('general-month').value='2026-09';a.node('general-month').fire('change');a.node('general-open-sales').click();assert.equal(a.node('tab-sales').hidden,false);a.api.go('week');assert.equal(a.node('general-month').value,'2026-09');assert.equal(JSON.stringify(a.api.getData()),before);assert.equal(a.writes.length,0)});
test('stale filter callbacks after navigation or rerender are ignored',()=>{const a=app(),old=a.node('general-month');a.api.render();old.value='2026-08';old.fire('change');assert.equal(a.node('general-month').value,'2026-10');const newer=a.node('general-month');a.api.go('sales');newer.value='2026-08';newer.fire('change');a.api.go('week');assert.equal(a.node('general-month').value,'2026-10')});
test('future and malformed month choices do not silently change totals',()=>{const a=app();for(const v of ['2027-01','2026-13','']){a.node('general-month').value=v;a.node('general-month').fire('change');assert.equal(a.node('general-month').value,'2026-10')}assert.equal(a.writes.length,0)});
test('unsafe client text is escaped, not executable markup',()=>{const d=state();d.salesControl={clients:[{id:'x',name:'<img src=x onerror=alert(1)>'}],orders:[{id:'o',clientId:'x',date:'2026-10-07',deliveryStatus:'partial',totalCents:100,items:[{ref:'FORMAS',qty:1}]}],payments:[]};const a=app(d);assert.doesNotMatch(a.node('tab-week').innerHTML,/<img src=x/);assert.match(a.node('tab-week').innerHTML,/&lt;img/);assert.match(a.node('general-orders').textContent,/serviço\/outros/);assert.match(a.node('general-orders').textContent,/quantidades a conferir/)});
test('online refresh replaces calculated figures and keeps chosen month',()=>{const a=app();const next=JSON.parse(JSON.stringify(a.api.getData()));next.salesControl.payments.push({id:'p',clientId:'x',date:'2026-10-07',amountCents:10000,allocations:[]});next.salesControl.clients.push({id:'x',name:'Exemplo'});a.api.replace(next);assert.match(a.node('general-finance').textContent,/100,00/);assert.equal(a.node('general-month').value,'2026-10');assert.equal(a.writes.length,0)});
test('archived week retains historical read-only view and returns to general dashboard',()=>{const a=app();a.api.archived();assert.equal(a.node('general-production'),null);assert.match(a.node('tab-week').textContent,/Semana arquivada/);a.node('back-current').click();assert.ok(a.node('general-production'));assert.equal(a.writes.length,0)});
test('new general module is versioned, precached and included before first render',()=>{const sw=fs.readFileSync(require('node:path').join(__dirname,'../sw.js'),'utf8');assert.ok(html.indexOf('general-dashboard.js?v=36')<html.indexOf('let data=loadData()'));assert.match(sw,/general-dashboard\.js\?v=36/);assert.match(sw,/shell-v41/)});
for(const [button,tab] of [['general-open-stock','stock'],['general-open-sales','sales'],['general-open-expenses','expenses']])test('dashboard link to '+tab+' never creates an absent week or snapshots',()=>{const d=state();delete d.weeks['2026-10-05'];const a=app(d),before=JSON.stringify(a.api.getData());a.node(button).click();assert.equal(a.api.getData().weeks['2026-10-05'],undefined);assert.equal(JSON.stringify(a.api.getData()),before);a.api.go('week');assert.equal(JSON.stringify(a.api.getData()),before);assert.equal(a.writes.length,0)});

// Stage 0: all views must preserve the loaded JSON when the new week is absent.
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}
for(const general of [true,false]){
 for(const tab of ['week','entry','history','settings','stock','sales','expenses'])test(`read-only ${tab} leaves the new week absent with general dashboard ${general}`,()=>{
  const a=app(state(),{now:'2026-10-12T15:00:00Z',general});
  assert.equal(JSON.stringify(a.api.getData()),a.beforeRender,'first render must also be pure');
  freeze(a.api.getData());
  for(let i=0;i<2;i++){a.api.go(tab);a.api.render();a.api.go('week')}
  assert.equal(JSON.stringify(a.api.getData()),a.beforeRender);
  assert.equal(a.api.getData().weeks['2026-10-12'],undefined);
  assert.equal(a.writes.length,0);
 });
 test(`Sunday to Monday in Sao Paulo does not create a week with general dashboard ${general}`,()=>{
  const a=app(state(),{now:'2026-10-12T02:59:59Z',general}),before=JSON.stringify(a.api.getData());
  assert.equal(a.api.currentWeekKey(),'2026-10-05');
  freeze(a.api.getData());a.clock.set('2026-10-12T03:00:00Z');
  assert.equal(a.api.currentWeekKey(),'2026-10-12');
  a.api.render();a.api.go('history');a.document.querySelector('[data-week-open="2026-09-28"]').click();
  assert.match(a.node('tab-week').textContent,/Semana arquivada/);a.node('back-current').click();
  assert.match(a.api.shareText(),/12\/10/);
  assert.equal(JSON.stringify(a.api.getData()),before);assert.equal(a.writes.length,0);
 });
}
test('sparse current and archived weeks are not repaired by viewing, opening or cancelling a goal',()=>{
 const input=state();input.weeks['2026-10-12']={goal:null};
 delete input.weeks['2026-09-28'].modelSnapshot;delete input.weeks['2026-09-28'].mountingSnapshot;
 const a=app(input,{now:'2026-10-12T15:00:00Z'}),before=JSON.stringify(a.api.getData());
 freeze(a.api.getData());a.api.goalModal();a.api.closeModal();a.api.go('settings');a.api.go('history');a.document.querySelector('[data-week-open="2026-09-28"]').click();a.node('back-current').click();
 assert.equal(JSON.stringify(a.api.getData()),before);assert.equal(a.writes.length,0);
});
test('opening and cancelling an absent-week goal preserves the complete state',()=>{
 const a=app(state(),{now:'2026-10-12T15:00:00Z'}),before=JSON.stringify(a.api.getData());
 freeze(a.api.getData());a.api.goalModal();assert.equal(a.node('modal').hidden,false);
 a.node('mg-sheet-0').value='1';a.node('mg-sheet-0').fire('input');a.node('use-goal-sum').click();a.api.closeModal();
 assert.equal(JSON.stringify(a.api.getData()),before);assert.equal(a.writes.length,0);
});
test('an explicit component submission creates its week only when saved',()=>{
 const a=app(state(),{now:'2026-10-12T15:00:00Z'}),before=JSON.parse(JSON.stringify(a.api.getData()));
 a.api.go('entry');assert.equal(a.api.getData().weeks['2026-10-12'],undefined);
 a.node('entry-mounting').value='a';a.node('entry-kind').value='cabedal';a.node('entry-kind').fire('change');
 a.node('entry-model').value='m507';a.node('entry-color').value='Preto';a.node('entry-qty').value='1';
 a.node('entry-form').fire('submit');
 const next=a.api.getData();assert.equal(next.weeks['2026-10-12'].entries.length,1);assert.equal(next.weeks['2026-10-12'].createdAt,'2026-10-12T15:00:00.000Z');
 assert.equal(a.writes.length,1);assert.equal(JSON.stringify(next.weeks['2026-10-05']),JSON.stringify(before.weeks['2026-10-05']));
});
