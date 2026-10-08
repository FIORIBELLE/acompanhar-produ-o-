'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Receipt=require('../sales-receipt');
const Inventory=require('../inventory-guard');
const Dashboard=require('../dashboard-view');
const {state}=require('./fixtures/dashboard-state');
const {receiptState}=require('./fixtures/receipt-state');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(m=>m[2].trim());
const build=fixture=>Receipt.build(fixture.orders[0],fixture.clients,fixture.payments);
const normalize=text=>text.replace(/\u00a0/g,' ');
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze)}return value}
function canvas(){
  const drawing=[],ctx={measureText:text=>({width:Array.from(text).length*18}),
    fillRect(){},fillText(text,x,y){drawing.push({text,x,y,font:this.font})}};
  return {width:0,height:0,getContext:()=>ctx,drawing,toDataURL:()=> 'data:image/png;base64,aW1hZ2U='};
}
function app(options={}){
  const fixture={...state(),salesControl:receiptState()},nodes=new Map();
  const node=id=>{
    if(!nodes.has(id)){
      const element={hidden:id==='modal'||['sales-receipt-image','sales-receipt-download','sales-receipt-share-image','sales-receipt-share-text'].includes(id),
        textContent:'',value:'',setAttribute(){},querySelectorAll(){return[]},addEventListener(){},
        focus(){this.focused=true},select(){this.selected=true}};
      let markup='';Object.defineProperty(element,'innerHTML',{get:()=>markup,set(value){markup=value;if(id==='modal-sheet')for(const key of nodes.keys())if(key.startsWith('sales-receipt-'))nodes.delete(key)}});
      nodes.set(id,element);
    }
    return nodes.get(id);
  };
  let receiptButtons=[];
  const context=vm.createContext({FioriInventory:Inventory,FioriDashboard:Dashboard,FioriFulfillment:require("../order-fulfillment"),FioriReceipt:Receipt,
    Date,Intl,console,File,atob,Uint8Array,navigator:options.navigator||{},setTimeout(){},clearTimeout(){},
    fetch(){throw new Error('Unexpected network access')},
    localStorage:{getItem:()=>JSON.stringify(fixture),setItem(){throw Error('Unexpected save')}},
    document:{getElementById:node,querySelector:node,createElement:()=>options.createCanvas?options.createCanvas():canvas(),
      querySelectorAll(selector){
        if(selector==='[data-sales-receipt]'){
          receiptButtons=[...node('tab-sales').innerHTML.matchAll(/data-sales-receipt="([^"]+)"/g)].map(m=>({dataset:{salesReceipt:m[1]}}));
          return receiptButtons;
        }
        return [];
      }},window:{scrollTo(){}}
  });
  const main=scripts[0][2].slice(0,scripts[0][2].lastIndexOf('\ndocument.querySelectorAll("nav [role=tab]").forEach'));
  vm.runInContext(main,context);
  for(const script of scripts.slice(1).filter(m=>!m[1].includes('remote-sync-v2')))vm.runInContext(script[2],context);
  vm.runInContext('globalThis.testApi={getData:()=>data,switchTab,closeModal,replaceData:next=>{data=next;render()}}',context);
  const api=context.testApi;api.switchTab('sales');
  return {api,node,click:(id='order-test-a')=>receiptButtons.find(b=>b.dataset.salesReceipt===id).onclick()};
}

test('supports cents, mills, numeric legacy strings and saved zero without mutating fields',()=>{
  for(const [item,expected] of [[{unitPriceCents:1275},12750],[{unitPriceMills:27445},27445],
    [{unitPriceCents:'1275'},12750],[{unitPriceMills:0,unitPriceCents:1275},0]]){
    assert.equal(Receipt.itemPriceMills(freeze(item)),expected);
  }
});
test('missing or malformed prices fail clearly instead of printing NaN or a fabricated zero',()=>{
  for(const item of [{},{unitPriceMills:-1},{unitPriceMills:NaN},{unitPriceMills:Infinity},
    {unitPriceMills:''},{unitPriceMills:' '},{unitPriceMills:[]},{unitPriceMills:12.5},{unitPriceCents:Number.MAX_SAFE_INTEGER}]){
    assert.throws(()=>Receipt.itemPriceMills(item),/Preço/);
  }
});
test('receipt preserves saved totals, exact mills, allocated payments by date, and correct balance',()=>{
  const fixture=freeze(receiptState()),before=JSON.stringify(fixture),receipt=build(fixture),text=normalize(receipt.text);
  assert.equal(receipt.totalCents,146690);assert.equal(receipt.paidCents,110000);assert.equal(receipt.balanceCents,36690);
  assert.deepEqual(receipt.payments,[{date:'2026-10-02',amountCents:70000},{date:'2026-10-03',amountCents:40000}]);
  assert.match(text,/TESTE-01 · 72 pares × R\$ 12,75 = R\$ 918,00/);
  assert.match(text,/TESTE-02 · 20 pares × R\$ 27,445 = R\$ 548,90/);
  assert.match(text,/Total do pedido: R\$ 1\.466,90/);assert.match(text,/Saldo: R\$ 366,90/);
  assert.match(text,/02\/10\/2026 · R\$ 700,00\n03\/10\/2026 · R\$ 400,00/);
  assert.doesNotMatch(text,/04\/10|200,00|Cliente de teste B|TESTE-03/);
  assert.equal(JSON.stringify(fixture),before);
});
test('sub-cent item totals remain exact and do not replace the saved order total',()=>{
  const fixture=receiptState();fixture.orders[0].items=[{ref:'fraction-a',qty:1,unitPriceMills:1005},{ref:'fraction-b',qty:1,unitPriceMills:1005}];
  fixture.orders[0].totalCents=201;fixture.payments=[];
  const text=normalize(build(fixture).text);
  assert.equal((text.match(/= R\$ 1,005/g)||[]).length,2);assert.match(text,/Total do pedido: R\$ 2,01/);
  fixture.orders[0].totalCents=250;assert.equal(build(fixture).totalCents,250);
});
test('unpaid, paid and overpaid orders retain their recorded payment totals and nonnegative balance',()=>{
  const fixture=receiptState();fixture.payments=[];
  assert.equal(build(fixture).balanceCents,146690);assert.match(build(fixture).text,/Nenhum pagamento alocado/);
  for(const paid of [146690,150000]){
    fixture.payments=[{date:'2026-10-07',allocations:[{orderId:'order-test-a',amountCents:paid}]}];
    assert.equal(build(fixture).paidCents,paid);assert.equal(build(fixture).balanceCents,0);
  }
});
test('cancelled status is disclosed and missing client names use a visible placeholder',()=>{
  const fixture=receiptState();fixture.orders[0].deliveryStatus='cancelled';fixture.clients=[];
  assert.match(build(fixture).text,/Cliente: —/);assert.match(build(fixture).text,/Entrega: cancelado/);
});
test('canvas renders every section, wraps long fields and stays within its dimensions',()=>{
  const fixture=receiptState();fixture.clients[0].name='Longo '.repeat(35);fixture.orders[0].items[0].ref='X'.repeat(200);
  const c=Receipt.draw(build(fixture),canvas),drawn=c.drawing.map(x=>x.text).join('\n');
  assert.match(drawn,/JR Calçados/);assert.match(drawn,/TESTE-02/);assert.match(drawn,/PAGAMENTOS/);assert.match(drawn,/Saldo:/);
  assert.equal(c.width,1000);assert.ok(c.height>1000);
  assert.ok(c.drawing.every(x=>x.y<c.height&&x.x===64));
  assert.ok(c.drawing.filter(x=>x.font!=='700 54px Arial, sans-serif').every(x=>x.text.length<=49));
});
test('very long receipts fail PNG safely while retaining their full text',()=>{
  const fixture=receiptState();fixture.orders[0].items=Array.from({length:300},(_,i)=>({ref:'test-'+i,qty:1,unitPriceCents:100}));
  const receipt=build(fixture);assert.match(receipt.text,/test-299/);
  assert.throws(()=>Receipt.draw(receipt,canvas),/muito longo/);
});
test('click opens visible PNG/text preview and download without clipboard, share, writes or requests',()=>{
  const {api,node,click}=app(),before=JSON.stringify(api.getData());click();
  assert.equal(node('modal').hidden,false);assert.equal(node('sales-receipt-image').hidden,false);
  assert.match(node('sales-receipt-text').value,/Cliente de teste A/);
  assert.equal(node('sales-receipt-download').download,'recibo-order-test-a.png');
  assert.match(node('sales-receipt-download').href,/^data:image\/png;base64,/);
  assert.equal(node('sales-receipt-share-image').hidden,true);
  assert.equal(JSON.stringify(api.getData()),before);
});
test('PNG failure still opens the complete readable receipt and a useful visible status',()=>{
  const {node,click}=app({createCanvas:()=>{throw new Error('Canvas bloqueado')}});click();
  assert.equal(node('modal').hidden,false);assert.match(node('sales-receipt-status').textContent,/PNG indisponível/);
  assert.match(node('sales-receipt-text').value,/Saldo:/);assert.equal(node('sales-receipt-download').hidden,true);
});
test('copy succeeds when supported and selects visible text if clipboard is denied or unavailable',async()=>{
  let copied='';const success=app({navigator:{clipboard:{writeText:async text=>{copied=text}}}});success.click();
  await success.node('sales-receipt-copy').onclick();assert.equal(copied,success.node('sales-receipt-text').value);
  assert.equal(success.node('sales-receipt-status').textContent,'Recibo copiado.');
  for(const navigator of [{},{clipboard:{writeText:async()=>{throw Error('Denied')}}}]){
    const {node,click}=app({navigator});click();await node('sales-receipt-copy').onclick();
    assert.equal(node('sales-receipt-text').selected,true);assert.equal(node('sales-receipt-text-details').open,true);
    assert.match(node('sales-receipt-status').textContent,/Selecione e copie/);
  }
});
test('file sharing is prepared before its click, shares PNG bytes and suppresses repeated clicks',async()=>{
  let resolve,calls=[];const {node,click,api}=app({navigator:{canShare:({files})=>files[0].type==='image/png',share:data=>{calls.push(data);return new Promise(r=>{resolve=r})}}});
  const before=JSON.stringify(api.getData());click();const button=node('sales-receipt-share-image');
  assert.equal(button.hidden,false);const pending=button.onclick();button.onclick();
  assert.equal(calls.length,1);assert.equal(calls[0].files[0].name,'recibo-order-test-a.png');
  assert.equal(await calls[0].files[0].text(),'image');resolve();await pending;
  assert.equal(button.disabled,false);assert.equal(JSON.stringify(api.getData()),before);
});
test('cancelled sharing stays quiet and rejected sharing leaves download and text available',async()=>{
  for(const name of ['AbortError','NotAllowedError']){
    const {node,click}=app({navigator:{canShare:()=>true,share:async()=>{const error=Error('Share failed');error.name=name;throw error}}});
    click();await node('sales-receipt-share-image').onclick();
    assert.equal(node('sales-receipt-download').hidden,false);assert.match(node('sales-receipt-text').value,/Saldo:/);
    if(name==='AbortError')assert.match(node('sales-receipt-status').textContent,/Imagem pronta/);else assert.match(node('sales-receipt-status').textContent,/Use Baixar PNG/);
  }
});
test('text sharing keeps original content and handles cancellation and denied permissions',async()=>{
  let shared;const success=app({navigator:{share:async value=>{shared=value}}});success.click();
  await success.node('sales-receipt-share-text').onclick();assert.equal(shared.text,success.node('sales-receipt-text').value);
  for(const name of ['AbortError','NotAllowedError']){
    const {node,click}=app({navigator:{share:async()=>{const error=Error();error.name=name;throw error}}});click();
    await node('sales-receipt-share-text').onclick();
    assert.equal(node('sales-receipt-share-text').disabled,false);
    assert.equal(!!node('sales-receipt-text').selected,name!=='AbortError');
    if(name!=='AbortError')assert.match(node('sales-receipt-status').textContent,/texto está disponível/);
  }
});
test('unsupported or throwing canShare never removes the PNG download',()=>{
  for(const canShare of [()=>false,()=>{throw Error('Unsupported')}]){
    const {node,click}=app({navigator:{share:async()=>{},canShare}});click();
    assert.equal(node('sales-receipt-download').hidden,false);assert.equal(node('sales-receipt-share-image').hidden,true);
  }
});
test('close/reopen, repeated clicks, tab navigation and updated data never retain another receipt',()=>{
  const {api,node,click}=app(),before=JSON.stringify(api.getData());click();click();api.closeModal();
  assert.equal(node('modal').hidden,true);api.switchTab('week');api.switchTab('sales');click('order-test-b');
  assert.match(node('sales-receipt-text').value,/Cliente de teste B/);assert.doesNotMatch(node('sales-receipt-text').value,/TESTE-01/);
  api.closeModal();assert.equal(JSON.stringify(api.getData()),before);
  const next=JSON.parse(before);next.salesControl.clients[0].name='Nome atualizado';api.replaceData(next);click();
  assert.match(node('sales-receipt-text').value,/Nome atualizado/);
});
test('malformed price surfaces an explicit error instead of an unhandled click exception',()=>{
  const {api,node,click}=app();delete api.getData().salesControl.orders[0].items[0].unitPriceCents;
  assert.doesNotThrow(click);assert.match(node('toast').textContent,/Não foi possível gerar o recibo: Preço por par/);
});
test('late copy failure cannot select or overwrite a newer receipt after closing',async()=>{
  let reject;const {api,node,click}=app({navigator:{clipboard:{writeText:()=>new Promise((_,r)=>{reject=r})}}});
  click();const pending=node('sales-receipt-copy').onclick();api.closeModal();click('order-test-b');
  const status=node('sales-receipt-status').textContent;reject(Error('Denied'));await pending;
  assert.equal(node('sales-receipt-status').textContent,status);assert.equal(node('sales-receipt-text').selected,undefined);
  assert.match(node('sales-receipt-text').value,/Cliente de teste B/);
});
test('HTML-like client/reference data is assigned as text, never injected into the modal',()=>{
  const {api,node,click}=app();api.getData().salesControl.clients[0].name='<img src=x onerror=alert(1)>';
  api.getData().salesControl.orders[0].items[0].ref='</textarea><script>alert(1)</script>';click();
  assert.match(node('sales-receipt-text').value,/<img/);assert.doesNotMatch(node('modal-sheet').innerHTML,/onerror|<script>/);
});
test('receipt script is loaded and cached for offline installed apps',()=>{
  const sw=fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8');
  assert.match(html,/<script src="sales-receipt\.js"><\/script>/);assert.match(sw,/"\.\/sales-receipt\.js"/);assert.match(sw,/shell-v\d+/);
});
