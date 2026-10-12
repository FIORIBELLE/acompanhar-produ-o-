'use strict';
// Offline integration tests: only synthetic state is ever written.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createDocument} = require('./helpers/synthetic-dom');
const {state} = require('./fixtures/dashboard-state');
const Adjustments = require('../stock-adjustment');
const Inventory = require('../inventory-guard');
const Sheets = require('../standard-sheet');
const Assembly = require('../assembly-finance');
const Dashboard = require('../dashboard-view');
const Finance = require('../finance-preview');
const TODAY = '2026-10-07', NOW = '2026-10-08T01:00:00Z', WEEK = '2026-10-05';
const clone = value => JSON.parse(JSON.stringify(value));
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(match => match[2].trim());
const options = {today:TODAY, now:NOW, inventory:Inventory};
function fixture() {
  const d = state(); d.financeControl.version = 1;
  d.stockLedger.push({id:'factory-cabedal', date:'2026-10-06', direction:'in', sector:'cabedal', ref:'507', color:'Preto', qty:23},
    {id:'factory-solado', date:'2026-10-06', direction:'in', sector:'solado', ref:'@line:500', color:'Preto', qty:17});
  d.weeks[WEEK].entries.push({id:'inactive-material', date:TODAY, kind:'cabedal', modelId:'m507', modelName:'507', line:'500', mountingId:'legacy', mountingName:'Não informado', color:'Rose', qty:11});
  return d;
}
function withAdjustment() {
  return Adjustments.createBatch(fixture(), {batchId:'existing-adjustment', date:TODAY, reason:'Conferência física original', rows:[
    {direction:'out', sector:'cabedal', ref:'507', color:'Preto', qty:8, mountingId:'a'},
    {direction:'out', sector:'solado', ref:'@line:500', color:'Preto', qty:5, mountingId:'a'},
  ]}, options);
}
function app(input = fixture()) {
  const saved = [], calls = {create:[], reverse:[], preview:[]};
  let writeError = false, rejectCandidate = false;
  const document = createDocument(`
    <div id="header-status"></div><div class="actions"></div><button id="edit-goal"></button>
    <nav>${['week','stock','entry','history','settings'].map(tab => `<button role="tab" data-tab="${tab}"></button>`).join('')}</nav>
    ${['week','stock','entry','history','settings'].map(tab => `<section id="tab-${tab}"></section>`).join('')}
    <div id="modal" hidden><div id="modal-sheet"></div></div><div id="toast" hidden></div>`);
  const engine = Object.fromEntries([['createBatch','create'], ['reverseBatch','reverse'], ['previewReset','preview']].map(([method, key]) => [method, (source, args, opts) => {
    calls[key].push(clone(args));
    if (rejectCandidate && key !== 'preview') throw Error('Synthetic candidate rejection');
    return Adjustments[method](source, args, opts);
  }]));
  const online = {onlineMode:true, hasPending:() => false, conflict:() => false, canEditGoal:() => true};
  const FixedDate = class extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return new Date(NOW).getTime(); } };
  const context = vm.createContext({
    document, Date:FixedDate, Intl, console, navigator:{}, setTimeout(){}, clearTimeout(){},
    FioriStockAdjustments:engine, FioriSheets:Sheets, FioriInventory:Inventory, FioriAssembly:Assembly, FioriDashboard:Dashboard, FioriFinance:Finance,
    localStorage:{getItem:() => JSON.stringify(input), setItem(key, value) { if (writeError) throw Error('Synthetic quota exceeded'); saved.push({key, value}); }},
    window:{fioriOnline:online, scrollTo(){}},
  });
  const main = scripts[0][2].slice(0, scripts[0][2].lastIndexOf('\ndocument.querySelectorAll("nav [role=tab]").forEach'));
  vm.runInContext(main, context);
  vm.runInContext(scripts[0][2].split('\n').filter(line => line.startsWith('document.getElementById("modal").onclick=') || line.startsWith('document.addEventListener("keydown"')).join('\n'), context);
  vm.runInContext(scripts.find(script => script[2].includes('function stockPanelBootstrap'))[2], context);
  vm.runInContext(`globalThis.api={
    getData:()=>data, open:tab=>switchTab(tab), render:()=>render(), close:closeModal,
    replaceData:next=>{data=next;render()}, rejectSave:()=>{save=()=>false},
    dropEngine:()=>{delete globalThis.FioriStockAdjustments},
    otherModal:()=>showModal('<h2 id="modal-title">Another dialog</h2>'),
  };`, context);
  const node = id => { const result = document.getElementById(id); assert.ok(result, `Missing actual DOM node #${id}`); return result; };
  const change = (field, value, event = 'change') => { const target = node('stock-adjustment-'+field); target.value = value; target.fire(event); return target; };
  const review = () => node('stock-adjustment-form').fire('submit');
  const confirm = () => node('stock-adjustment-confirm').click();
  const cancel = () => node('modal').onclick({target:node('modal-sheet').querySelector('[data-modal-close]')});
  const result = {api:context.api, document, saved, calls, online, node, change, review, confirm, cancel,
    fail:value => {writeError = value;}, rejectCandidate:value => {rejectCandidate = value;}};
  result.open = (kind = 'manual') => {
    context.api.open('stock');
    if (kind === 'reverse') document.querySelector('[data-stock-reverse]').click();
    else node(kind === 'reset' ? 'stock-reset-open' : 'stock-adjustment-open').click();
    return result;
  };
  result.manual = (values = {}) => {
    result.open();
    for (const [field, value] of Object.entries({mounting:'a', direction:'out', sector:'cabedal', ref:'507', color:'Preto', qty:'8', reason:'Conferência física', ...values})) change(field, value);
    return result;
  };
  return result;
}
const additions = a => a.api.getData().stockLedger.filter(row => row.adjustmentVersion === 1);
const unchanged = (a, before) => { assert.equal(a.saved.length, 0); assert.equal(JSON.stringify(a.api.getData()), before); };
const balance = (data, location, sector, target, color = 'preto') => Inventory.ledger(data).rows.find(row => row.scope === 'mounting' && row.location === location && row.sector === sector && row.target === target && row.color === color)?.qty || 0;
function prepare(kind) {
  const a = app(kind === 'reverse' ? withAdjustment() : fixture());
  if (kind === 'manual') a.manual(); else { a.open(kind); a.change('reason', kind === 'reset' ? 'Inventário físico zerado' : 'Correção do lote anterior'); }
  return a;
}

test('stock adjustment is a separate reviewed flow and opening, editing, cancelling never writes', () => {
  const a = app().open(), before = JSON.stringify(a.api.getData());
  assert.equal(a.node('stock-adjustment-date').value, TODAY);
  assert.equal(a.node('stock-adjustment-mounting').value, '');
  assert.ok(a.node('stock-form')); assert.ok(a.node('stock-save'));
  for (const field of ['date','mounting','direction','sector','ref','color','qty','reason']) assert.ok(a.node('modal-sheet').querySelector(`[for="stock-adjustment-${field}"]`));
  assert.equal(a.node('stock-adjustment-form').hasAttribute('novalidate'), true);
  a.change('mounting', 'a'); a.change('qty', '14'); a.cancel();
  assert.equal(a.node('modal').hidden, true); unchanged(a, before);
  a.node('stock-adjustment-open').click(); assert.equal(a.node('stock-adjustment-qty').value, ''); unchanged(a, before);
});

test('mounting choices identify inactive locations and global finished stock is explicit', () => {
  const a = app().manual();
  assert.match(a.node('stock-adjustment-mounting').textContent, /Não informado · inativa/);
  assert.equal(a.node('stock-adjustment-sector').options.some(option => option.value === 'produto_pronto'), false);
  a.change('mounting', '__global__'); a.change('sector', 'produto_pronto');
  assert.equal(a.node('stock-adjustment-sector').value, 'produto_pronto');
  assert.match(a.node('stock-adjustment-scope-hint').textContent, /saldo global/);
  a.change('mounting', 'b'); assert.equal(a.node('stock-adjustment-sector').value, 'cabedal');
  assert.equal(a.saved.length, 0);
});

test('shared sectors use line options, preserve back navigation, and exclude Line 300 palmilha', () => {
  const a = app().manual({sector:'solado', ref:'@line:500', qty:'6'});
  assert.equal(a.node('stock-adjustment-ref-label').textContent, 'Linha');
  assert.ok(a.node('stock-adjustment-ref').options.some(option => option.value === '@line:300'));
  a.change('sector', 'palmilha'); assert.equal(a.node('stock-adjustment-ref').options.some(option => option.value === '@line:300'), false);
  a.change('ref', '@line:500'); a.review(); a.node('stock-adjustment-back').click();
  assert.equal(a.node('stock-adjustment-sector').value, 'palmilha'); assert.equal(a.node('stock-adjustment-ref').value, '@line:500');
  assert.equal(a.node('stock-adjustment-qty').value, '6'); assert.equal(a.node('stock-adjustment-reason').value, 'Conferência física');
  assert.equal(a.saved.length, 0);
});

for (const [field, value] of [['date',''], ['date','2026-02-30'], ['date','2026-10-08'], ['mounting',''], ['reason','   '], ['color',''], ['ref',''], ['qty',''], ['qty','0'], ['qty','-1'], ['qty','1.5'], ['qty','1,5'], ['qty','1e2'], ['qty','0x10'], ['qty','9007199254740992']]) {
  test(`invalid ${field} ${JSON.stringify(value)} is rejected before confirmation and without mutation`, () => {
    const a = app().manual(), before = JSON.stringify(a.api.getData()); a.change(field, value); a.review();
    assert.equal(a.node('stock-adjustment-error').hidden, false); assert.equal(a.document.getElementById('stock-adjustment-confirm'), null); unchanged(a, before);
  });
}

test('review is pure and final confirmation changes only the selected mounting with append-only metadata', () => {
  const a = app().manual(), before = clone(a.api.getData()); a.review();
  unchanged(a, JSON.stringify(before));
  assert.match(a.node('modal-sheet').textContent, /Montagem A \(teste\)/); assert.match(a.node('modal-sheet').textContent, /−8 pares/); assert.match(a.node('modal-sheet').textContent, /Conferência física/);
  a.confirm(); assert.equal(a.saved.length, 1, a.node('toast').textContent); assert.equal(a.node('modal').hidden, true);
  const after = a.api.getData(), row = additions(a)[0];
  assert.equal(row.mountingId, 'a'); assert.equal(row.qty, 8); assert.equal(row.reason, 'Conferência física'); assert.equal(row.date, TODAY); assert.equal(row.adjustmentBatchId, a.calls.create[0].batchId);
  assert.equal(balance(after,'a','cabedal','m507'), balance(before,'a','cabedal','m507') - 8);
  assert.equal(balance(after,'b','cabedal','m507'), balance(before,'b','cabedal','m507'));
  assert.deepEqual(clone(after.weeks), before.weeks); assert.deepEqual(clone(after.factoryExpenses), before.factoryExpenses); assert.deepEqual(clone(after.financeControl), before.financeControl); assert.deepEqual(clone(after.salesControl), before.salesControl); assert.deepEqual(clone(after.settings), before.settings);
  assert.deepEqual(clone(after.stockLedger.slice(0,-1)), before.stockLedger); assert.equal(Inventory.validate(after).length, 0);
  assert.match(a.node('toast').textContent, /Aguardando confirmação online/);
});

for (const sector of ['cabedal','solado','palmilha']) test(`entry adds ${sector} to the selected mounting without production or obligations`, () => {
  const a = app().manual({direction:'in', mounting:'empty', sector, ref:sector === 'cabedal' ? '507' : '@line:500', qty:'19'}), before = clone(a.api.getData());
  a.review(); a.confirm(); assert.equal(a.saved.length, 1, a.node('toast').textContent);
  assert.equal(balance(a.api.getData(),'empty',sector,sector === 'cabedal' ? 'm507' : '500'), 19);
  assert.deepEqual(clone(a.api.getData().weeks), before.weeks); assert.equal(a.api.getData().factoryExpenses.length, 0);
});

test('finished stock adjustment is global and factory material adjustment preserves mounting balances', () => {
  for (const sector of ['produto_pronto','cabedal']) {
    const a = app().manual({mounting:'__global__', sector, qty:'4'}), before = clone(a.api.getData()); a.review(); a.confirm();
    assert.equal(a.saved.length, 1, a.node('toast').textContent); assert.equal(Object.hasOwn(additions(a)[0], 'mountingId'), false);
    assert.deepEqual(Inventory.mountingBalances(a.api.getData(),TODAY), Inventory.mountingBalances(before,TODAY));
  }
});

test('a mounting cannot spend another location’s stock even if global stock is sufficient', () => {
  const a = app().manual({mounting:'empty', qty:'1'}), before = JSON.stringify(a.api.getData()); a.review();
  assert.match(a.node('stock-adjustment-error').textContent, /Saldo insuficiente/); unchanged(a, before);
});

test('a factory material output cannot consume balances assigned to mountings', () => {
  const a = app().manual({mounting:'__global__', qty:'24'}), before = JSON.stringify(a.api.getData()); a.review();
  assert.equal(a.node('stock-adjustment-error').hidden, false); unchanged(a, before);
});

for (const kind of ['manual','reset','reverse']) {
  test(`${kind} duplicate review and final click commit one batch only`, () => {
    const a = prepare(kind), baseline = additions(a).length, review = a.node('stock-adjustment-form').onsubmit;
    review({preventDefault(){}}); const confirm = a.node('stock-adjustment-confirm').onclick;
    review({preventDefault(){}}); confirm(); confirm();
    assert.equal(a.saved.length, 1, a.node('toast').textContent);
    assert.equal(new Set(additions(a).slice(baseline).map(row => row.adjustmentBatchId)).size, 1);
  });
  for (const action of ['cancel','escape','back','backdrop']) test(`${kind} ${action} invalidates an old confirmation without a write`, () => {
    const a = prepare(kind), before = JSON.stringify(a.api.getData()); a.review(); const old = a.node('stock-adjustment-confirm').onclick;
    if (action === 'cancel') a.cancel();
    if (action === 'escape') a.document.root.fire('keydown', {key:'Escape'});
    if (action === 'back') a.node('stock-adjustment-back').click();
    if (action === 'backdrop') a.node('modal').onclick({target:a.node('modal')});
    old(); unchanged(a, before);
    if (action !== 'back') assert.equal(a.node('modal').hidden, true);
  });
  for (const action of ['render','leave-return','remote','new-dialog']) for (const phase of ['form','confirm']) test(`${kind} ${action} invalidates retained ${phase} callbacks`, () => {
    const a = prepare(kind); if (phase === 'confirm') a.review();
    const old = phase === 'confirm' ? a.node('stock-adjustment-confirm').onclick : a.node('stock-adjustment-form').onsubmit;
    if (action === 'render') a.api.render();
    if (action === 'leave-return') { a.api.open('week'); a.api.open('stock'); }
    if (action === 'remote') a.api.replaceData(clone(a.api.getData()));
    if (action === 'new-dialog') a.api.otherModal();
    const before = JSON.stringify(a.api.getData()); old({preventDefault(){}}); unchanged(a, before);
    if (action !== 'new-dialog') assert.equal(a.node('modal').hidden, true);
  });
  for (const phase of ['form','confirm']) for (const blocker of ['pending','conflict','unhydrated','data-change','missing-engine']) test(`${kind} ${blocker} blocks ${phase}`, () => {
    const a = prepare(kind); if (phase === 'confirm') a.review();
    if (blocker === 'pending') a.online.hasPending = () => true;
    if (blocker === 'conflict') a.online.conflict = () => true;
    if (blocker === 'unhydrated') a.online.canEditGoal = () => false;
    if (blocker === 'data-change') a.api.getData().lastBackup = 'new remote data';
    if (blocker === 'missing-engine') a.api.dropEngine();
    const before = JSON.stringify(a.api.getData()); if (phase === 'confirm') a.confirm(); else a.review(); unchanged(a, before);
    assert.equal(a.node('modal').hidden, true);
  });
  test(`${kind} storage failure rolls back all rows and permits a reviewed retry with the same batch ID`, () => {
    const a = prepare(kind), before = JSON.stringify(a.api.getData()); a.review();
    const key = kind === 'reverse' ? 'reverse' : 'create', batchId = a.calls[key][0].batchId, old = a.node('stock-adjustment-confirm').onclick;
    a.fail(true); old(); unchanged(a, before); assert.match(a.node('stock-adjustment-error').textContent, /não foi salvo/);
    assert.equal(a.node('stock-adjustment-reason').value, kind === 'manual' ? 'Conferência física' : kind === 'reset' ? 'Inventário físico zerado' : 'Correção do lote anterior');
    a.fail(false); old(); unchanged(a, before); a.review(); a.confirm();
    assert.equal(a.saved.length, 1, a.node('toast').textContent); assert.equal(additions(a).at(-1).adjustmentBatchId, batchId);
  });
  test(`${kind} explicit save refusal leaves data intact`, () => {
    const a = prepare(kind), before = JSON.stringify(a.api.getData()); a.api.rejectSave(); a.review(); a.confirm(); unchanged(a, before);
    assert.match(a.node('stock-adjustment-error').textContent, /não foi salvo/);
  });
}

test('reset preview lists global ready stock plus materials at all locations and preserves factory materials', () => {
  const a = app().open('reset'), before = clone(a.api.getData()), preview = Adjustments.previewReset(before,{date:TODAY},{inventory:Inventory});
  const text = a.node('stock-adjustment-reset-preview').textContent;
  for (const expected of ['Produto pronto · estoque global','Montagem A (teste)','Montagem B (teste)','Não informado','Materiais da fábrica preservados · 40 pares']) assert.ok(text.includes(expected), expected);
  assert.equal(preview.totals.produto_pronto, 312); assert.ok(preview.rows.some(row => row.mountingId === 'legacy'));
  unchanged(a, JSON.stringify(before)); a.review(); assert.match(a.node('stock-adjustment-error').textContent, /motivo/); unchanged(a, JSON.stringify(before));
  a.change('reason','Inventário físico zerado'); a.review(); unchanged(a, JSON.stringify(before)); a.confirm();
  assert.equal(a.saved.length, 1, a.node('toast').textContent); assert.equal(additions(a).length, preview.rows.length);
  const remaining = Adjustments.previewReset(a.api.getData(),{date:TODAY},{inventory:Inventory});
  assert.equal(remaining.rows.length, 0); assert.deepEqual(remaining.factoryRows, preview.factoryRows);
  assert.deepEqual(clone(a.api.getData().weeks), before.weeks); assert.deepEqual(clone(a.api.getData().financeControl), before.financeControl); assert.deepEqual(clone(a.api.getData().factoryExpenses), before.factoryExpenses);
  assert.equal(new Set(additions(a).map(row => row.adjustmentBatchId)).size, 1); assert.equal(Inventory.validate(a.api.getData()).length, 0);
});

test('reset date refresh is read-only, excludes later balances and requires an actual positive stock', () => {
  const a = app().open('reset'), before = JSON.stringify(a.api.getData());
  a.change('date','2026-10-06');
  assert.doesNotMatch(a.node('stock-adjustment-reset-preview').textContent, /Montagem A \(teste\)/);
  assert.match(a.node('stock-adjustment-reset-preview').textContent, /Produto pronto · estoque global/);
  a.change('date','2026-10-01'); assert.equal(a.node('stock-adjustment-review').disabled, true);
  a.change('reason','Inventário vazio'); a.review(); assert.match(a.node('stock-adjustment-error').textContent, /Não há saldo positivo/); unchanged(a,before);
  a.change('date','2026-10-08'); assert.match(a.node('stock-adjustment-reset-preview').textContent, /data válida/); unchanged(a,before);
});

test('inconsistent inventory blocks reset preview and no hidden partial batch is saved', () => {
  const d = fixture(); d.stockLedger.push({id:'bad-stock',date:TODAY,direction:'out',sector:'produto_pronto',ref:'507',color:'Preto',qty:999});
  const a = app(d).open('reset'), before = JSON.stringify(a.api.getData());
  assert.equal(a.node('stock-adjustment-review').disabled,true); assert.match(a.node('stock-adjustment-reset-preview').textContent,/Saldo insuficiente/);
  a.change('reason','Conferência'); a.review(); unchanged(a,before);
});

test('compensating reversal preserves original rows, restores balances and cannot be repeated or deleted', () => {
  const a = app(withAdjustment()).open('reverse'), original = clone(a.api.getData()), originalRows = clone(additions(a));
  assert.match(a.node('stock-adjustment-original').textContent, /\+8 pares/); assert.match(a.node('stock-adjustment-original').textContent, /\+5 pares/);
  a.change('reason','Correção do lote anterior'); a.review(); unchanged(a,JSON.stringify(original)); a.confirm();
  assert.equal(a.saved.length,1,a.node('toast').textContent); assert.equal(additions(a).length,4);
  assert.deepEqual(clone(additions(a).slice(0,2)),originalRows); assert.deepEqual(clone(additions(a).slice(2).map(row=>row.reversalOf)),originalRows.map(row=>row.id));
  assert.equal(balance(a.api.getData(),'a','cabedal','m507'),168); assert.equal(balance(a.api.getData(),'a','solado','500'),96);
  assert.equal(a.document.querySelectorAll('[data-stock-reverse]').length,0);
  assert.match(a.node('tab-stock').textContent,/Lote estornado/); assert.match(a.node('tab-stock').textContent,/Estorno compensatório/);
  for (const row of a.document.querySelectorAll('[data-stock-adjustment]')) assert.equal(row.querySelector('[data-stock-delete]'),null);
  assert.deepEqual(clone(a.api.getData().weeks),original.weeks); assert.deepEqual(clone(a.api.getData().financeControl),original.financeControl);
});

test('history has one reversal action per batch, montage and reason, and legacy records retain their controls', () => {
  const a = app(withAdjustment()); a.api.open('stock');
  assert.equal(a.document.querySelectorAll('[data-stock-reverse]').length,1);
  assert.equal(a.document.querySelectorAll('[data-stock-adjustment]').length,2);
  for (const row of a.document.querySelectorAll('[data-stock-adjustment]')) { assert.match(row.textContent,/Montagem A \(teste\)/); assert.match(row.textContent,/Motivo: Conferência física original/); assert.equal(row.querySelector('[data-stock-delete]'),null); }
  assert.ok(a.document.querySelector('[data-stock-delete="factory-cabedal"]'));
});

test('an old legacy delete handler cannot delete a record subsequently marked as an adjustment', () => {
  const a = app(); a.api.open('stock'); const old = a.document.querySelector('[data-stock-delete="factory-cabedal"]').onclick;
  Object.assign(a.api.getData().stockLedger.find(row=>row.id==='factory-cabedal'),{adjustmentVersion:1,adjustmentBatchId:'protected',reason:'Audit'});
  const before=JSON.stringify(a.api.getData());old();unchanged(a,before);assert.match(a.node('toast').textContent,/protegido/);
});

test('an already open legacy delete confirmation rechecks protection before removal', () => {
  const a = app(); a.api.open('stock'); a.document.querySelector('[data-stock-delete="factory-cabedal"]').click();
  const confirm = a.node('modal-confirm').onclick;
  Object.assign(a.api.getData().stockLedger.find(row=>row.id==='factory-cabedal'),{adjustmentVersion:1,adjustmentBatchId:'protected',reason:'Audit'});
  const before=JSON.stringify(a.api.getData());confirm();unchanged(a,before);assert.match(a.node('toast').textContent,/protegido/);
});

test('keyboard focus stays inside both adjustment and confirmation dialogs', () => {
  const a=app().manual(),first=a.node('stock-adjustment-date'),last=a.node('stock-adjustment-review');
  first.focus();a.document.root.fire('keydown',{key:'Tab',shiftKey:true});assert.equal(a.document.activeElement,last);
  last.focus();a.document.root.fire('keydown',{key:'Tab'});assert.equal(a.document.activeElement,first);
  a.review();const cancel=a.node('modal-sheet').querySelector('[data-modal-close]'),confirm=a.node('stock-adjustment-confirm');
  confirm.focus();a.document.root.fire('keydown',{key:'Tab'});assert.equal(a.document.activeElement,cancel);
  cancel.focus();a.document.root.fire('keydown',{key:'Tab',shiftKey:true});assert.equal(a.document.activeElement,confirm);
  assert.equal(a.saved.length,0);
});

test('stale open buttons and detached confirmation inputs cannot redirect the reviewed adjustment', () => {
  const a=app().manual(),oldOpen=a.node('stock-adjustment-open').onclick,qty=a.node('stock-adjustment-qty');a.review();qty.value='99';a.confirm();
  assert.equal(additions(a)[0].qty,8);const writes=a.saved.length;oldOpen();assert.equal(a.saved.length,writes);assert.equal(a.node('modal').hidden,true);
});

for(const blocker of ['pending','conflict','unhydrated','missing-engine']) test(`stock buttons fail closed with ${blocker} and opening never writes`,()=>{
  const a=app();a.api.open('stock');const old=a.node('stock-adjustment-open').onclick;
  if(blocker==='pending')a.online.hasPending=()=>true;
  if(blocker==='conflict')a.online.conflict=()=>true;
  if(blocker==='unhydrated')a.online.canEditGoal=()=>false;
  if(blocker==='missing-engine')a.api.dropEngine();
  const before=JSON.stringify(a.api.getData());old();assert.equal(a.node('modal').hidden,true);a.api.render();
  assert.equal(a.node('stock-adjustment-open').disabled,true);assert.equal(a.node('stock-reset-open').disabled,true);unchanged(a,before);
});

test('a candidate rejected at final confirmation returns a reviewable form with no mutation',()=>{
  const a=app().manual(),before=JSON.stringify(a.api.getData());a.review();a.rejectCandidate(true);a.confirm();unchanged(a,before);
  assert.match(a.node('stock-adjustment-error').textContent,/Synthetic candidate rejection/);a.rejectCandidate(false);a.review();a.confirm();assert.equal(a.saved.length,1);
});

test('all stock adjustment text is escaped, and module and inventory cache versions match the new release',()=>{
  const d=fixture();d.settings.mountings[0].name='<img src=x onerror=alert(1)>';
  const a=app(d).manual({reason:'<script>alert(1)</script>',direction:'in',color:'<img src=x>'});a.review();
  assert.doesNotMatch(a.node('modal-sheet').innerHTML,/<script>|<img src=x/);assert.match(a.node('modal-sheet').innerHTML,/&lt;script&gt;/);
  assert.match(html,/stock-adjustment\.js\?v=35/);assert.match(html,/inventory-guard\.js\?v=35/);assert.match(html,/v2026\.10\.12-r8\.7\.2/);
});

for(const kind of ['manual','reset','reverse'])test(`${kind} saves only the raw confirmed base when a legacy local view has an unsaved current week`,()=>{
  const confirmed=kind==='reverse'?withAdjustment():fixture();
  confirmed.weeks['2026-09-28'].entries=confirmed.weeks[WEEK].entries.map(row=>({...row,date:'2026-10-02'}));
  delete confirmed.weeks[WEEK];
  const rawBefore=JSON.stringify(confirmed),a=app(confirmed);
  a.online.getAdjustmentBase=()=>clone(confirmed);
  // Simulate a week produced by an older client without committing it online.
  a.api.getData().weeks[WEEK]={goal:null,modelGoals:{},entries:[],modelSnapshot:clone(confirmed.settings.models),mountingSnapshot:clone(confirmed.settings.mountings)};
  if(kind==='manual')a.manual();else{a.open(kind);a.change('reason','Conferência na nova semana')}
  assert.ok(a.api.getData().weeks[WEEK],'legacy local draft is present before the correction');
  assert.equal(Object.hasOwn(confirmed.weeks,WEEK),false);
  a.review();assert.equal(a.saved.length,0);assert.equal(JSON.stringify(confirmed),rawBefore);
  a.confirm();assert.equal(a.saved.length,1,a.node('toast').textContent);
  const persisted=JSON.parse(a.saved[0].value);
  assert.equal(Object.hasOwn(persisted.weeks,WEEK),false,'the saved correction must not write a derived week');
  assert.deepEqual({...persisted,stockLedger:confirmed.stockLedger},confirmed,'all non-ledger confirmed fields remain byte-for-byte equivalent');
  assert.ok(persisted.stockLedger.length>confirmed.stockLedger.length);
  assert.deepEqual(persisted.stockLedger.slice(0,confirmed.stockLedger.length),confirmed.stockLedger);
  assert.equal(a.api.getData().weeks[WEEK],undefined,'read-only stock rendering does not recreate the local week');
  assert.equal(JSON.stringify(confirmed),rawBefore);
});

for(const kind of ['manual','reset','reverse'])for(const phase of ['open','form','confirm'])for(const change of phase==='open'?['unavailable']:['unavailable','changed'])test(`${kind} confirmed base ${change} blocks ${phase} without falling back to local data`,()=>{
  const original=kind==='reverse'?withAdjustment():fixture(),a=app(original);
  let confirmed=clone(original);a.online.getAdjustmentBase=()=>confirmed?clone(confirmed):null;
  if(phase==='open'){
    a.api.open('stock');confirmed=null;
    if(kind==='reverse')a.document.querySelector('[data-stock-reverse]').click();else a.node(kind==='reset'?'stock-reset-open':'stock-adjustment-open').click();
  }else{
    if(kind==='manual')a.manual();else{a.open(kind);a.change('reason','Conferência')}
    if(phase==='confirm')a.review();
    if(change==='unavailable')confirmed=null;else confirmed.lastBackup='different confirmed revision';
    if(phase==='confirm')a.confirm();else a.review();
  }
  assert.equal(a.saved.length,0);assert.equal(a.node('modal').hidden,true);assert.match(a.node('toast').textContent,/base online/);
});

test('the online base accessor is read-only, cloned and unavailable until writes are safe',()=>{
  assert.match(html,/getAdjustmentBase:\(\)=>canWrite\(\)&&!hasPending\(\)&&!syncConflict&&confirmedData\?clone\(confirmedData\):null/);
});
