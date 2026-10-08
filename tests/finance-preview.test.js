'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Finance=require('../finance-preview'),Inventory=require('../inventory-guard'),Dashboard=require('../dashboard-view');
const {state}=require('./fixtures/dashboard-state');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(m=>m[2].trim());
function fixture(){
 const data=state();data.settings.mountings[0].rate=2.60;
 data.factoryExpenses=[{id:'advance-expense',date:'2026-10-06',category:'Mão de obra',status:'paid',amount:200,description:'Synthetic advance'}];
 data.financeControl={version:1,advances:[{id:'advance-a',expenseId:'advance-expense',mountingId:'a',dueDate:'2026-10-10',linkedAt:'2026-10-06T12:00:00Z'}],settlements:[]};
 return data;
}
function app(data=fixture()){
 const nodes=new Map(),saved=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',hidden:false,textContent:'',value:'',setAttribute(){},querySelectorAll(){return[]},addEventListener(){}});return nodes.get(id)};
 const FixedDate=class extends Date{constructor(...a){super(...(a.length?a:['2026-10-07T21:00:00Z']))}static now(){return new Date('2026-10-07T21:00:00Z').getTime()}};
 const online={hasPending:()=>false,conflict:()=>false};
 const context=vm.createContext({FioriFinance:Finance,FioriInventory:Inventory,FioriDashboard:Dashboard,Date:FixedDate,Intl,console,setTimeout(){},clearTimeout(){},navigator:{},localStorage:{getItem:()=>JSON.stringify(data),setItem:(key,value)=>saved.push({key,value})},document:{getElementById:node,querySelector:node,querySelectorAll(){return[]}},window:{fioriOnline:online,scrollTo(){}}});
 const main=scripts[0][2].slice(0,scripts[0][2].lastIndexOf('\ndocument.querySelectorAll("nav [role=tab]").forEach'));
 vm.runInContext(main,context);
 vm.runInContext(scripts.find(s=>s[2].includes('function factoryExpensesBootstrap')).at(2),context);
 vm.runInContext('globalThis.api={getData:()=>data,open:()=>switchTab("expenses"),closeModal,replaceData:(next)=>{data=next;render()}}',context);
 context.api.open();
 const fields=(values={})=>{for(const [id,value] of Object.entries({'settlement-mounting':'a','settlement-date':'2026-10-07','settlement-gross':'374,40','settlement-discount':'0,00','settlement-method':'Pix','settlement-note':'',...values}))node(id).value=value};
 const submit=()=>node('settlement-form').onsubmit({preventDefault(){}});
 return {api:context.api,node,saved,fields,submit,online};
}

test('preview is read-only: 144 pairs at 2.60 gives 374.40, leaving 200 advance intact',()=>{
 const data=fixture(),before=JSON.stringify(data);
 assert.deepEqual(Finance.simulation('144','2,60'),{pairs:144,rateCents:260,grossCents:37440});
 assert.equal(Finance.openAdvances(data,'a')[0].balanceCents,20000);
 assert.equal(JSON.stringify(data),before);
});
test('money parser rejects missing, subcent, malformed, negative, exponential and unsafe values',()=>{
 for(const value of ['',null,'1.234','1.2,34','1,234','-1','1e3','Infinity','9007199254740999'])assert.equal(Finance.moneyCents(value),null,String(value));
 assert.equal(Finance.moneyCents('1.234,56'),123456);assert.equal(Finance.moneyCents('2.60'),260);
 for(const pairs of ['0','-1','1.5','Infinity'])assert.equal(Finance.simulation(pairs,'2.60'),null);
});
test('only explicitly requested amount is allocated, excluding future and other mounting advances',()=>{
 const data=fixture();data.factoryExpenses.push({id:'future-expense',date:'2026-10-08',amount:100,status:'paid'},{id:'other-expense',date:'2026-10-06',amount:100,status:'paid'});
 data.financeControl.advances.push({id:'future',expenseId:'future-expense',mountingId:'a'},{id:'other',expenseId:'other-expense',mountingId:'b'});
 const before=JSON.stringify(data),p=Finance.plan(data,{mountingId:'a',date:'2026-10-07',grossCents:37440,discountCents:5000});
 assert.deepEqual(p.allocations,[{advanceId:'advance-a',amountCents:5000}]);assert.equal(p.netCents,32440);assert.equal(p.availableCents,20000);assert.equal(JSON.stringify(data),before);
 assert.ok(Finance.plan(data,{mountingId:'a',date:'2026-10-07',grossCents:37440,discountCents:20001}).error);
 assert.ok(Finance.plan(data,{mountingId:'a',date:'2026-02-30',grossCents:37440,discountCents:100}).error);
});
test('zero discount is a nonmutating plan, not an implied authorization to consume advances',()=>{
 const data=fixture(),p=Finance.plan(data,{mountingId:'a',date:'2026-10-07',grossCents:37440,discountCents:0});
 assert.deepEqual(p.allocations,[]);assert.equal(p.netCents,37440);
});
test('opening, simulating, and reopening finance changes no data and writes nothing',()=>{
 const {api,node,saved}=app(),before=JSON.stringify(api.getData());
 assert.match(node('tab-expenses').innerHTML,/<details[^>]*id="settlement-details">/);
 assert.doesNotMatch(node('tab-expenses').innerHTML,/<details[^>]*id="settlement-details"[^>]*open/);
 node('finance-preview-mounting').value='a';node('finance-preview-mounting').onchange();node('finance-preview-pairs').value='144';node('finance-preview-pairs').oninput();
 assert.match(node('finance-preview-result').textContent,/374,40 bruto simulado/);api.open();
 assert.equal(JSON.stringify(api.getData()),before);assert.equal(saved.length,0);
});
test('missing legacy financeControl is displayed without initializing or saving new state',()=>{
 const data=fixture();delete data.financeControl;
 const {api,node,saved}=app(data);assert.equal(api.getData().financeControl,undefined);assert.match(node('tab-expenses').innerHTML,/Nenhum acerto registrado/);assert.equal(saved.length,0);
});
test('zero discount is blocked by existing guard rules, and future dates do not record payment',()=>{
 const a=app();a.fields();a.submit();assert.equal(a.saved.length,0);assert.match(a.node('toast').textContent,/Sem abatimento/);
 a.fields({'settlement-discount':'200,00','settlement-date':'2026-10-10'});a.submit();assert.equal(a.saved.length,0);assert.match(a.node('toast').textContent,/já realizado/);
});
test('review shows gross, chosen discount and net; cancellation does not save',()=>{
 const a=app(),before=JSON.stringify(a.api.getData());a.fields({'settlement-discount':'50,00'});a.submit();
 const message=a.node('modal-sheet').innerHTML;assert.match(message,/374,40/);assert.match(message,/50,00/);assert.match(message,/324,40/);assert.match(message,/Pix/);assert.match(message,/não transfere dinheiro/);
 assert.equal(a.saved.length,0);a.api.closeModal();assert.equal(JSON.stringify(a.api.getData()),before);
});
test('only confirmation records a schema-compatible settlement and net expense, exactly once',()=>{
 const a=app();a.fields({'settlement-discount':'200,00'});a.submit();const confirm=a.node('modal-confirm').onclick;confirm();confirm();
 assert.equal(a.saved.length,1);const data=a.api.getData();assert.equal(data.factoryExpenses.length,2);assert.equal(data.factoryExpenses[1].amount,174.4);assert.equal(data.factoryExpenses[1].status,'paid');assert.equal(data.financeControl.settlements.length,1);assert.equal(data.financeControl.settlements[0].grossCents,37440);assert.equal(data.financeControl.settlements[0].allocations[0].amountCents,20000);
});
test('full advance offset writes no second expense when net is zero',()=>{
 const a=app();a.fields({'settlement-gross':'100,00','settlement-discount':'100,00'});a.submit();a.node('modal-confirm').onclick();
 const data=a.api.getData();assert.equal(data.factoryExpenses.length,1);assert.equal(data.financeControl.settlements[0].netExpenseId,null);assert.equal(Finance.openAdvances(data,'a')[0].balanceCents,10000);
});
test('changed data, conflict and pending synchronization block stale confirmations',()=>{
 const a=app();a.fields({'settlement-discount':'50,00'});a.submit();a.api.getData().factoryExpenses[0].amount=150;a.node('modal-confirm').onclick();assert.equal(a.saved.length,0);assert.match(a.node('toast').textContent,/dados mudaram/);
 for(const type of ['hasPending','conflict']){const b=app();b.fields({'settlement-discount':'50,00'});b.online[type]=()=>true;b.submit();assert.equal(b.saved.length,0);assert.match(b.node('toast').textContent,/confirmação online|conflito/)}
 const b=app();b.fields({'settlement-discount':'50,00'});b.submit();b.online.hasPending=()=>true;b.node('modal-confirm').onclick();assert.equal(b.saved.length,0);
});
test('changing mounting resets chosen discount, and HTML-like names are escaped in review',()=>{
 const data=fixture();data.settings.mountings[0].name='<img onerror=1>';
 const a=app(data);a.fields({'settlement-discount':'50,00'});a.node('settlement-mounting').onchange();assert.equal(a.node('settlement-discount').value,'0,00');a.fields({'settlement-discount':'50,00'});a.submit();assert.match(a.node('modal-sheet').innerHTML,/&lt;img onerror=1&gt;/);assert.doesNotMatch(a.node('modal-sheet').innerHTML,/<img/);
});
test('weekly production does not claim a known unpaid balance',()=>{assert.match(html,/produção bruta/);assert.doesNotMatch(html,/por par · valor a pagar/)});

test('financial helper is loaded and added to the offline shell',()=>{
 assert.match(html,/<script src="finance-preview\.js\?v=28"><\/script>/);
 assert.match(fs.readFileSync(require('node:path').join(__dirname,'../sw.js'),'utf8'),/"\.\/finance-preview\.js\?v=28"/);
});

test('financial parser preserves exact decimal cents at safe integer boundaries',()=>{
 assert.equal(Finance.moneyCents('90071992547409,90'),9007199254740990);
 assert.equal(Finance.moneyCents('90071992547409,91'),9007199254740991);
 assert.equal(Finance.moneyCents('70368744177664,01'),7036874417766401);
 assert.equal(Finance.moneyCents('90071992547409,92'),null);
});
test('a settlement cannot encode a net expense that silently loses cents',()=>{
 assert.match(Finance.plan(fixture(),{mountingId:'a',date:'2026-10-07',grossCents:9007199254740991,discountCents:0}).error,/limite de precisão/);
});

test('partial legacy finance state has read-only per-field defaults and never breaks expenses',()=>{
 for(const financeControl of [{},{advances:[]},{settlements:[]},{advances:{},settlements:null}]){
 const data=fixture();data.financeControl=financeControl;const before=JSON.stringify(financeControl);
 const a=app(data);assert.match(a.node('tab-expenses').innerHTML,/Nenhum acerto registrado/);
 assert.equal(a.saved.length,0);assert.equal(JSON.stringify(a.api.getData().financeControl),before);
 }
});
test('a legacy missing settlements array is initialized only after an explicit confirmed record',()=>{
 const data=fixture();delete data.financeControl.settlements;const a=app(data);
 assert.equal(a.api.getData().financeControl.settlements,undefined);a.fields({'settlement-discount':'50,00'});a.submit();
 assert.equal(a.api.getData().financeControl.settlements,undefined);assert.equal(a.saved.length,0);
 a.node('modal-confirm').onclick();assert.equal(a.saved.length,1);assert.equal(a.api.getData().financeControl.settlements.length,1);
 assert.equal(a.api.getData().financeControl.advances[0].id,'advance-a');
});
