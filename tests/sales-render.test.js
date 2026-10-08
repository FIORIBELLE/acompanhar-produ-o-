'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Inventory=require('../inventory-guard');
const Dashboard=require('../dashboard-view');
const Finance=require('../finance-preview');
const {state}=require('./fixtures/dashboard-state');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(m=>m[2].trim());

// Synthetic orders only. Neither this harness nor these fixtures access the online database.
function salesState(count=12){
  const fixture=state();
  fixture.salesControl={version:1,
    clients:[{id:'client-a',name:'Cliente A (teste)'},{id:'client-b',name:'Cliente B (teste)'}],
    orders:Array.from({length:count},(_,i)=>({id:'order-'+i,clientId:i%2?'client-b':'client-a',
      date:i%2?'2026-10-07':'2026-10-06',createdAt:'2026-10-07T10:00:00Z',
      items:[{ref:'507',qty:72,...(i%2?{unitPriceMills:12750}:{unitPriceCents:1275})}],
      totalCents:91800,deliveryStatus:i===2?'cancelled':'pending',note:'Exemplo sintético'})),
    payments:count?[{id:'payment-a',clientId:'client-a',date:'2026-10-07',amountCents:100000,
      method:'Pix',allocations:[{orderId:'order-0',amountCents:91800}]}]:[],
    orderEvents:[{id:'preserve-unrelated',note:'Unrelated fields must remain untouched'}]
  };
  return fixture;
}

function app(fixture=salesState()){
  const nodes=new Map();
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{innerHTML:'',hidden:false,textContent:'',value:'',
      setAttribute(){},querySelectorAll(){return[]},addEventListener(){}});
    return nodes.get(id);
  };
  const tabs=['week','stock','expenses','sales','entry','history','settings'].map(tab=>({
    dataset:{tab},setAttribute(name,value){this[name]=value}
  }));
  const FixedDate=class extends Date{
    constructor(...args){super(...(args.length?args:['2026-10-07T21:00:00Z']))}
    static now(){return new Date('2026-10-07T21:00:00Z').getTime()}
  };
  const context=vm.createContext({FioriInventory:Inventory,FioriDashboard:Dashboard,FioriFinance:Finance,FioriFulfillment:require("../order-fulfillment"),
    Date:FixedDate,Intl,console,navigator:{},setTimeout(){},clearTimeout(){},
    localStorage:{getItem:()=>JSON.stringify(fixture),setItem(){throw Error('Unexpected save')}},
    document:{getElementById:node,querySelector:node,
      querySelectorAll(selector){return selector==='nav [role=tab]'?tabs:[]}},
    window:{scrollTo(){}}
  });
  const main=scripts[0][2].slice(0,scripts[0][2].lastIndexOf('\ndocument.querySelectorAll("nav [role=tab]").forEach'));
  vm.runInContext(main,context);
  for(const script of scripts.slice(1).filter(m=>!m[1].includes('remote-sync-v2'))){
    vm.runInContext(script[2],context);
  }
  vm.runInContext('globalThis.testApi={getData:()=>data,switchTab:(tab)=>switchTab(tab),render:()=>render(),replaceData:(next)=>{data=next;render()}}',context);
  return{api:context.testApi,node,tabs};
}

test('navigation and main markup contain real line breaks, not visible escape text',()=>{
  const markup=html.slice(0,html.indexOf('<script'));
  assert.doesNotMatch(markup,/\\n/);
});

test('opening Pedidos renders every existing order and payment without saving or changing data',()=>{
  const {api,node,tabs}=app(),before=JSON.stringify(api.getData());
  tabs.find(t=>t.dataset.tab==='sales').onclick();
  const rendered=node('tab-sales').innerHTML;
  assert.equal((rendered.match(/data-sales-receipt=/g)||[]).length,12);
  assert.match(rendered,/Cliente A \(teste\)/);
  assert.match(rendered,/Cliente B \(teste\)/);
  assert.match(rendered,/72 pares · Pago/);
  assert.match(rendered,/entrega cancelado/);
  assert.match(rendered,/Recebimentos/);
  assert.match(rendered,/crédito R\$\s*82,00/);
  assert.equal(node('tab-sales').hidden,false);
  assert.equal(node('tab-week').hidden,true);
  assert.equal(node('.actions').hidden,true);
  assert.equal(JSON.stringify(api.getData()),before);
});

test('repeated clicks and leaving/reopening Pedidos do not duplicate orders or alter state',()=>{
  const {api,node}=app(),before=JSON.stringify(api.getData());
  for(const tab of ['sales','sales','week','sales','expenses','sales'])api.switchTab(tab);
  assert.equal((node('tab-sales').innerHTML.match(/data-sales-receipt=/g)||[]).length,12);
  assert.equal(JSON.stringify(api.getData()),before);
});

test('a newly received state redraws the open Pedidos tab without caching old orders',()=>{
  const {api,node}=app(salesState(1));api.switchTab('sales');
  const next=salesState(12),before=JSON.stringify(next);api.replaceData(next);
  assert.equal((node('tab-sales').innerHTML.match(/data-sales-receipt=/g)||[]).length,12);
  assert.equal(JSON.stringify(api.getData()),before);
});

test('an empty account shows the explicit empty list instead of a blank tab',()=>{
  const {api,node}=app(salesState(0)),before=JSON.stringify(api.getData());api.switchTab('sales');
  assert.match(node('tab-sales').innerHTML,/Nenhum pedido cadastrado/);
  assert.match(node('tab-sales').innerHTML,/Nenhum recebimento cadastrado/);
  assert.equal(JSON.stringify(api.getData()),before);
});

test('client names are escaped while displaying orders',()=>{
  const fixture=salesState(1);fixture.salesControl.clients[0].name='<img src=x onerror=alert(1)>';
  const {api,node}=app(fixture);api.switchTab('sales');
  assert.match(node('tab-sales').innerHTML,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(node('tab-sales').innerHTML,/<img src=x/);
});

test('fulfillment view states its limits and separates pending delivery from paid status',()=>{
 const {api,node}=app();const before=JSON.stringify(api.getData());api.switchTab('sales');
 const rendered=node('tab-sales').innerHTML;
 assert.match(rendered,/id="sales-fulfillment"/);assert.match(rendered,/Projeção por quantidade, sujeita a conferência/);
 assert.match(rendered,/Nada é reservado ou baixado/);assert.match(rendered,/Prazo não informado/);
 assert.match(rendered,/não confirma[m]? a grade/);assert.match(rendered,/não baixa o estoque automaticamente/);
 assert.match(rendered,/data-fulfillment-order="order-0"/); // Paid still needs delivery.
 assert.doesNotMatch(rendered,/data-fulfillment-order="order-2"/); // Cancelled is out of the queue.
 assert.match(rendered,/Prioridade 1/);assert.equal(JSON.stringify(api.getData()),before);
});
test('fulfillment navigation opens inventory and mountings without saving data',()=>{
 const {api,node}=app(),before=JSON.stringify(api.getData());api.switchTab('sales');
 node('fulfillment-view-mountings').onclick();assert.equal(node('tab-week').hidden,false);
 api.switchTab('sales');assert.match(node('tab-sales').innerHTML,/O que falta para atender/);
 assert.equal(JSON.stringify(api.getData()),before);
});
test('fulfillment receives updated orders, uses current accumulated stock and has no cached reservations',()=>{
 const fixture=salesState(1);fixture.salesControl.orders[0].items[0].qty=200;
 const {api,node}=app(fixture);api.switchTab('sales');assert.match(node('tab-sales').innerHTML,/Pronto na projeção: <strong>168/);
 const next=salesState(1);next.salesControl.orders[0].items[0].qty=10;const before=JSON.stringify(next);api.replaceData(next);
 assert.match(node('tab-sales').innerHTML,/Pronto na projeção: <strong>10/);assert.equal(JSON.stringify(api.getData()),before);
});
test('unmatched items require review without fabricating production or delivery deadlines',()=>{
 const fixture=salesState(1);fixture.salesControl.orders[0].items=[{ref:'FORMAS',qty:1,unitPriceMills:10000}];
 const {api,node}=app(fixture);api.switchTab('sales');const rendered=node('tab-sales').innerHTML;
 assert.match(rendered,/Item sem vínculo com um modelo de produção/);assert.match(rendered,/Conferir itens antes de planejar/);
 assert.doesNotMatch(rendered,/Pronto na projeção:/);assert.match(rendered,/Prazo não informado/);
});
test('fulfillment escapes reference, mounting and color labels',()=>{
 const fixture=salesState(1);fixture.salesControl.orders[0].items[0].qty=300;
 fixture.settings.mountings[0].name='<img src=x onerror=alert(1)>';
 for(const entry of fixture.weeks['2026-10-05'].entries)if(entry.mountingId==='a')entry.color='<svg onload=alert(1)>';
 fixture.salesControl.orders[0].items.push({ref:'<script>alert(1)</script>',qty:1,unitPriceMills:1});
 const {api,node}=app(fixture);api.switchTab('sales');const rendered=node('tab-sales').innerHTML;
 assert.doesNotMatch(rendered,/<img src=x|<svg onload=|<script>alert/);
 assert.match(rendered,/&lt;img src=x/);assert.match(rendered,/&lt;svg onload=/);assert.match(rendered,/&lt;SCRIPT&gt;/);
});
test('fulfillment and price parser are loaded before sales bootstrap and included in v33 offline shell',()=>{
 const sw=fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8');
 for(const filename of ['order-fulfillment.js?v=28','sales-order.js?v=28']){
 assert.ok(html.includes('<script src="'+filename+'"></script>'));assert.ok(sw.includes('"./'+filename+'"'));
 assert.ok(html.indexOf(filename)<html.indexOf('function salesControlBootstrap'));
 }assert.match(sw,/shell-v33/);
});

test('projection-only inventory divergence is explained locally instead of pointing to an absent dashboard warning',()=>{
 const fixture=salesState(1);fixture.stockLedger.push({id:'adjust-global',date:'2026-10-07',sector:'solado',direction:'out',ref:'@line:500',qty:96,color:'Preto'});
 const {api,node}=app(fixture);api.switchTab('sales');const rendered=node('tab-sales').innerHTML;
 assert.match(rendered,/A projeção está suspensa/);assert.match(rendered,/saldo nas montagens \(96 pares\) maior que o saldo global \(0 pares\)/);
 assert.match(rendered,/solado · Linha 500 · Preto/);assert.doesNotMatch(rendered,/confira os alertas na visão da semana/);
});

test('shared-line capacity uncertainty is visible even when another reference has usable ready stock',()=>{
 const fixture=salesState(2);fixture.salesControl.orders[0].deliveryStatus='partial';fixture.salesControl.orders[1].items=[{ref:'512',qty:144,unitPriceMills:10000}];
 const {api,node}=app(fixture);api.switchTab('sales');const rendered=node('tab-sales').innerHTML;
 assert.match(rendered,/Capacidade da linha 500 a conferir/);assert.match(rendered,/Os materiais compartilhados não foram distribuídos/);
 assert.match(rendered,/Pronto na projeção: <strong>72/);
});

