'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Orders=require('../sales-order');
const Inventory=require('../inventory-guard');
const Dashboard=require('../dashboard-view');
const Receipt=require('../sales-receipt');
const {state}=require('./fixtures/dashboard-state');
const {receiptState}=require('./fixtures/receipt-state');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(m=>m[2].trim());
const copy=value=>JSON.parse(JSON.stringify(value));

// Synthetic data only: execute the actual form handler, while storage and DOM
// stay in memory. Remote synchronization is never loaded and fetch is forbidden.
function app(){
  const fixture={...state(),salesControl:receiptState()},nodes=new Map(),writes=[];
  const node=id=>{
    if(!nodes.has(id)){
      const element={hidden:false,textContent:'',value:'',setAttribute(){},querySelectorAll(){return[]},addEventListener(){}};
      let markup='';
      Object.defineProperty(element,'innerHTML',{get:()=>markup,set(value){
        markup=value;
        // Like replacement by innerHTML in the browser, each sales render
        // discards the previous form's values and handlers.
        if(id==='tab-sales')for(const key of nodes.keys())if(key.startsWith('order-'))nodes.delete(key);
      }});
      nodes.set(id,element);
    }
    return nodes.get(id);
  };
  const FixedDate=class extends Date{
    constructor(...args){super(...(args.length?args:['2026-10-07T21:00:00Z']))}
    static now(){return new Date('2026-10-07T21:00:00Z').getTime()}
  };
  const context=vm.createContext({FioriSalesOrder:Orders,FioriInventory:Inventory,FioriFulfillment:require("../order-fulfillment"),FioriDashboard:Dashboard,FioriReceipt:Receipt,
    Date:FixedDate,Intl,console,navigator:{},setTimeout(){},clearTimeout(){},
    fetch(){throw new Error('Unexpected network access')},
    localStorage:{getItem:()=>JSON.stringify(fixture),setItem:(key,value)=>writes.push({key,value:JSON.parse(value)})},
    document:{getElementById:node,querySelector:node,querySelectorAll(){return[]}},window:{scrollTo(){}}
  });
  const main=scripts[0][2].slice(0,scripts[0][2].lastIndexOf('\ndocument.querySelectorAll("nav [role=tab]").forEach'));
  vm.runInContext(main,context);
  for(const script of scripts.slice(1).filter(m=>!m[1].includes('remote-sync-v2')))vm.runInContext(script[2],context);
  vm.runInContext('globalThis.testApi={getData:()=>data,switchTab}',context);
  const api=context.testApi;api.switchTab('sales');
  function fill(values={}){
    const fields={client:'client-test-a',date:'2026-10-07',delivery:'pending',note:' Nota sintética ',items:'teste-03; 20; 27,445',...values};
    for(const [field,value] of Object.entries(fields))node('order-'+field).value=value;
  }
  function submit(handler=node('order-form').onsubmit){
    let prevented=false;
    assert.doesNotThrow(()=>handler({preventDefault(){prevented=true}}));
    assert.equal(prevented,true);
  }
  return {api,node,writes,fill,submit};
}

test('parses integer, comma/dot decimal and Brazilian grouped text directly into exact mills',()=>{
  for(const [raw,mills] of [['0',0],['0,000',0],['0.001',1],['0,01',10],['1',1000],['1,2',1200],
    ['1.23',1230],['27,445',27445],['27.325',27325],['1.234,567',1234567],
    ['12.345.678,90',12345678900],[' \t0012,750 ',12750]]){
    assert.equal(Orders.parseSalesPriceMills(raw),mills,raw);
  }
});
test('keeps all three decimals instead of introducing floating-point multiplication errors',()=>{
  for(const raw of ['1.001','1.005','1.015','1.255','2.675','27.445','27.325']){
    assert.equal(Orders.parseSalesPriceMills(raw),Number(raw.replace('.','')));
  }
});
test('rejects unsupported precision, negatives, malformed grouping and non-decimal inputs',()=>{
  for(const raw of ['', ' ', '-1', '-0', '+1', '1,', '.5', '1,2345', '1.2340', '27,444999999999999',
    '1,2,3','1.23,45','1.234.567','1,234.56','12 34,50','R$ 1,00','0x10','1e3','Infinity','NaN',
    null,undefined,27.445,[],{},true]){
    assert.equal(Number.isNaN(Orders.parseSalesPriceMills(raw)),true,String(raw));
  }
});
test('accepts the exact safe integer boundary and rejects larger values without rounding',()=>{
  assert.equal(Orders.parseSalesPriceMills('9007199254740,991'),Number.MAX_SAFE_INTEGER);
  for(const raw of ['9007199254740,992','9007199254740.999','9007199254740.9911','9'.repeat(400)]){
    assert.equal(Number.isNaN(Orders.parseSalesPriceMills(raw)),true);
  }
});
test('new items preserve mills and close their combined total in cents',()=>{
  assert.deepEqual(Orders.parseItems('teste-506; 432; 27,445\r\nteste-507; 276; 27,325'),{
    items:[{ref:'TESTE-506',qty:432,unitPriceMills:27445},{ref:'TESTE-507',qty:276,unitPriceMills:27325}],
    totalCents:1939794
  });
  assert.deepEqual(Orders.parseItems(' a ; 1 ; 1,005\n\n \n b ; 1 ; 1.005 '),{
    items:[{ref:'A',qty:1,unitPriceMills:1005},{ref:'B',qty:1,unitPriceMills:1005}],totalCents:201
  });
});
test('zero remains a valid recorded unit price and totals are never rounded into cents',()=>{
  assert.equal(Orders.parseItems('zero; 72; 0,000').totalCents,0);
  for(const raw of ['a; 1; 1,005','a; 3; 0,001','a; 1; 1,001\nb; 1; 1,001']){
    assert.throws(()=>Orders.parseItems(raw),/não fecha em centavos/);
  }
});
test('requires exactly three fields and a strictly positive safe whole quantity',()=>{
  for(const raw of ['a; 2','a; 2; 1,00; ignored'])assert.throws(()=>Orders.parseItems(raw),/Use:/);
  for(const quantity of ['','0','-1','1.5','1,5','1.0','1e2','0x10','Infinity','9007199254740992']){
    assert.throws(()=>Orders.parseItems('a; '+quantity+'; 1,00'),/quantidade inteira/);
  }
  assert.throws(()=>Orders.parseItems('; 2; 1,00'),/referência/);
  for(const raw of ['', ' \n ', null])assert.throws(()=>Orders.parseItems(raw),/Informe os itens/);
});
test('rejects item-product and accumulated-total overflow before producing an order',()=>{
  assert.throws(()=>Orders.parseItems('a; 9007199254740991; 0,010'),/excede o limite/);
  assert.throws(()=>Orders.parseItems('a; 1; 4503599627370,490\nb; 1; 4503599627370,510'),/excede o limite/);
  assert.equal(Orders.parseItems('a; 1; 9007199254740,990').totalCents,900719925474099);
});
test('browser script exports the parser used by the submit handler',()=>{
  const context=vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../sales-order.js'),'utf8'),context);
  assert.equal(context.FioriSalesOrder.parseSalesPriceMills('27,445'),27445);
  assert.equal(context.FioriSalesOrder.parseItems('a;20;27,445').totalCents,54890);
});
test('real order submit saves exactly one synthetic order with its mill price and cent total',()=>{
  const {api,node,writes,fill,submit}=app(),before=copy(api.getData());
  fill();submit();
  assert.equal(writes.length,1);
  const after=copy(api.getData()),order=after.salesControl.orders.pop();
  assert.deepEqual(after,before,'existing orders, payments, inventory, production and finance must remain unchanged');
  assert.match(order.id,/^ped_/);assert.equal(order.clientId,'client-test-a');
  assert.equal(order.date,'2026-10-07');assert.equal(order.deliveryStatus,'pending');assert.equal(order.note,'Nota sintética');
  assert.equal(order.createdAt,'2026-10-07T21:00:00.000Z');assert.equal(order.totalCents,54890);
  assert.deepEqual(order.items,[{ref:'TESTE-03',qty:20,unitPriceMills:27445}]);
  assert.deepEqual(writes[0].value,copy(api.getData()));
  assert.match(node('toast').textContent,/Pedido registrado\. Aguardando confirmação online\./);
});
test('successful submission leaves legacy cents and existing mill prices intact in saved JSON',()=>{
  const {api,writes,fill,submit}=app(),original=copy(api.getData().salesControl.orders);
  fill({items:'new-a; 1; 1,005\nnew-b; 1; 1,005'});submit();
  const saved=writes[0].value.salesControl;
  assert.deepEqual(saved.orders.slice(0,original.length),original);
  assert.equal(saved.orders[0].items[0].unitPriceCents,1275);
  assert.equal(saved.orders[0].items[1].unitPriceMills,27445);
  assert.equal(saved.orders.at(-1).totalCents,201);
  const receipt=Receipt.build(saved.orders.at(-1),saved.clients,saved.payments);
  assert.equal(receipt.totalCents,201);assert.equal(receipt.items[0].unitPriceMills,1005);
});
test('missing form fields never write or change any synthetic state',()=>{
  for(const values of [{client:''},{date:''},{items:''}]){
    const {api,node,writes,fill,submit}=app(),before=JSON.stringify(api.getData());
    fill(values);submit();assert.equal(writes.length,0);assert.equal(JSON.stringify(api.getData()),before);
    assert.match(node('toast').textContent,/Informe cliente, data e itens/);
  }
});
test('invalid item anywhere, excess precision, partial cents and overflow all abort the whole submission',()=>{
  const cases=[['invalid; 0; 2,00',/quantidade/],['invalid; 10; 1,2345',/até 3 casas/],
    ['invalid; 1; 1,005',/não fecha em centavos/],['invalid; 1; -1,00',/Preço por par inválido/],
    ['invalid; 1; 9007199254740,992',/Preço por par inválido/],
    ['invalid; 9007199254740991; 0,010',/excede o limite/],
    ['a; 1; 4503599627370,490\nb; 1; 4503599627370,510',/excede o limite/],
    ['invalid; 2; 1,00; ignored',/Use:/]];
  for(const [invalid,message] of cases){
    const {api,node,writes,fill,submit}=app(),before=JSON.stringify(api.getData());
    fill({items:'valid; 2; 1,00\n'+invalid});submit();
    assert.equal(writes.length,0,invalid);assert.equal(JSON.stringify(api.getData()),before,invalid);
    assert.match(node('toast').textContent,message);assert.match(node('order-items').value,/invalid|4503599627370/);
  }
});
test('a corrected failed submission saves once and repeated stale submits cannot duplicate it',()=>{
  const {api,node,writes,fill,submit}=app(),count=api.getData().salesControl.orders.length;
  fill({items:'a; 1; 1,005'});submit();submit();assert.equal(writes.length,0);
  fill({items:'a; 2; 1,005'});const oldHandler=node('order-form').onsubmit;submit(oldHandler);
  submit(oldHandler);submit();
  assert.equal(writes.length,1);assert.equal(api.getData().salesControl.orders.length,count+1);
  assert.equal(api.getData().salesControl.orders.at(-1).totalCents,201);
});
