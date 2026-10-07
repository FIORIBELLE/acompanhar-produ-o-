'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Inventory=require('../inventory-guard');
const Dashboard=require('../dashboard-view');
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
  const context=vm.createContext({FioriInventory:Inventory,FioriDashboard:Dashboard,
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
