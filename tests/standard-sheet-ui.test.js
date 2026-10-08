'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createDocument} = require('./helpers/synthetic-dom');
const {state} = require('./fixtures/dashboard-state');
const Sheets = require('../standard-sheet');
const Inventory = require('../inventory-guard');
const Assembly = require('../assembly-finance');
const Dashboard = require('../dashboard-view');
const Finance = require('../finance-preview');
const TODAY = '2026-10-07', NOW = '2026-10-08T01:00:00Z', WEEK = '2026-10-05';
const COLORS = ['Preto', 'Caramelo', 'Rose', 'Off White'];
const SIZES = ['35', '36', '37', '38', '39'];
const clone = value => JSON.parse(JSON.stringify(value));
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(match => match[2].trim());

function fixture({materials = true} = {}) {
  const data = state();
  data.settings.models.push({id:'m315', ref:'315', name:'315 teste', line:'300', active:true, usesPalmilha:false}, {id:'m601', ref:'601', name:'601 teste', line:'600', active:true});
  data.settings.mountings[0].rate = 2.6;
  data.financeControl.version = 1;
  for (const week of Object.values(data.weeks)) week.entries = [];
  data.stockLedger = [];
  if (materials) for (const color of COLORS) for (const kind of ['cabedal', 'palmilha', 'solado']) {
    data.weeks[WEEK].entries.push({id:`material-${kind}-${color}`, date:TODAY, kind, mountingId:'a', mountingName:'Montagem A (teste)', modelId:kind === 'cabedal' ? 'm507' : '', modelName:kind === 'cabedal' ? '507' : 'Linha 500', line:'500', color, qty:288});
  }
  return data;
}
function app(input = fixture()) {
  const saved = [], document = createDocument(`
    <div id="header-status"></div><div class="actions"></div><button id="edit-goal"></button>
    <nav>${['week','stock','entry','history','settings'].map(tab => `<button role="tab" data-tab="${tab}"></button>`).join('')}</nav>
    ${['week','stock','entry','history','settings'].map(tab => `<section id="tab-${tab}"></section>`).join('')}
    <div id="modal" hidden><div id="modal-sheet"></div></div><div id="toast" hidden></div>`);
  let writeError = false;
  const online = {onlineMode:true, hasPending:() => false, conflict:() => false, canEditGoal:() => true};
  const FixedDate = class extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return new Date(NOW).getTime(); } };
  const context = vm.createContext({
    document, Date:FixedDate, Intl, console, navigator:{}, setTimeout(){}, clearTimeout(){},
    FioriSheets:Sheets, FioriInventory:Inventory, FioriAssembly:Assembly, FioriDashboard:Dashboard, FioriFinance:Finance,
    localStorage:{getItem:() => JSON.stringify(input), setItem(key, value) { if (writeError) throw Error('Synthetic quota exceeded'); saved.push({key, value}); }},
    window:{fioriOnline:online, scrollTo(){}},
  });
  const main = scripts[0][2].slice(0, scripts[0][2].lastIndexOf('\ndocument.querySelectorAll("nav [role=tab]").forEach'));
  vm.runInContext(main, context);
  vm.runInContext(scripts.find(script => script[2].includes('function stockPanelBootstrap'))[2], context);
  vm.runInContext(`globalThis.api={
    getData:()=>data, open:tab=>switchTab(tab), render:()=>render(), close:closeModal,
    replaceData:next=>{data=next;render()}, notice:()=>unknownColorNotice(data,spDate()),
    pattern:(selection={})=>openSheetPattern(selection), currentSubmission:()=>activeEntrySubmission,
    rejectSave:()=>{save=()=>false}, dropSheets:()=>{delete globalThis.FioriSheets},
    edit:id=>{ui.editingEntry={id,weekKey:'${WEEK}'};switchTab('entry')}, deleteEntry,
  };`, context);
  const node = id => { const result = document.getElementById(id); assert.ok(result, `Missing actual DOM node #${id}`); return result; };
  const change = (id, value, event = 'change') => { const field = node(id); field.value = value; field.fire(event); return field; };
  const submit = prefix => node(prefix+'-form').fire('submit');
  function entry({kind = 'cabedal', target = 'm507', qty = '1', unit = 'sheets'} = {}) {
    context.api.open('entry'); change('entry-kind', kind); change('entry-model', target);
    change('entry-qty', qty, 'input'); change('entry-unit', unit); return result;
  }
  function stock({sector = 'cabedal', ref = '507', qty = '1', unit = 'sheets', direction = 'in'} = {}) {
    context.api.open('stock'); change('stock-sector', sector); change('stock-ref', ref);
    change('stock-direction', direction); change('stock-qty', qty, 'input'); change('stock-unit', unit); return result;
  }
  const result = {api:context.api, document, saved, online, node, change, submit, entry, stock, fail:value => {writeError = value;}};
  return result;
}
function rows(a, prefix) {
  return a.node(prefix+'-grid').querySelectorAll('[data-sheet-color]').map(field => ({
    color:field.value,
    sizes:SIZES.map(size => Number(a.node(`${prefix}-${field.dataset.sheetColor}-${size}`).value)),
  }));
}
const total = grid => grid.reduce((sum, row) => sum + row.sizes.reduce((a, b) => a + b, 0), 0);
const entries = a => Object.values(a.api.getData().weeks).flatMap(week => week.entries);
const sheetEntries = a => entries(a).filter(entry => entry.sheetBatchId);
function unchanged(a, before) { assert.equal(a.saved.length, 0); assert.equal(JSON.stringify(a.api.getData()), before); }
function configureSingle(a, prefix = 'pattern', color = 'Azul') {
  a.change(prefix+'-color-0', color, 'input');
  for (const size of SIZES) a.change(`${prefix}-0-${size}`, size === '37' ? '72' : '0', 'input');
}

test('synthetic DOM models browser input strings, selects, scoped selectors and detachment', () => {
  const document = createDocument('<div id="form"><select id="select"><option value="one">One</option><option value="two">Two</option></select><input id="qty" value="3"><button data-quick="sheet"></button></div>');
  const select = document.getElementById('select'); assert.equal(select.value, 'one'); assert.equal(select.options.length, 2);
  select.value = 'missing'; assert.equal(select.value, ''); select.innerHTML = '<option value="new">New</option>'; assert.equal(select.value, 'new');
  document.getElementById('qty').value = 7; assert.equal(document.getElementById('qty').value, '7');
  assert.equal(document.querySelectorAll('[data-quick="sheet"]').length, 1);
  const old = document.getElementById('qty'); document.getElementById('form').innerHTML = ''; assert.equal(old.isConnected, false); assert.equal(document.getElementById('qty'), null);
});

test('Lançar sheets and +1 ficha generate the editable 72-pair grid without saving', () => {
  const a = app().entry(), before = JSON.stringify(a.api.getData());
  assert.equal(a.node('entry-sheet').hidden, false); assert.equal(a.node('entry-color').disabled, true);
  assert.deepEqual(rows(a, 'entry'), COLORS.map(color => ({color, sizes:[3,3,6,3,3]})));
  assert.equal(a.node('entry-grid').querySelectorAll('[data-sheet-size]').length, 20);
  a.document.querySelector('[data-quick="sheet"]').click();
  assert.equal(a.node('entry-qty').value, '2'); assert.equal(total(rows(a, 'entry')), 144);
  a.change('entry-unit', 'pairs'); a.change('entry-qty', '72', 'input'); a.document.querySelector('[data-quick="sheet"]').click();
  assert.equal(a.node('entry-unit').value, 'sheets'); assert.equal(a.node('entry-qty').value, '2'); assert.equal(total(rows(a, 'entry')), 144);
  a.change('entry-unit', 'pairs'); a.change('entry-qty', '99', 'input'); a.document.querySelector('[data-quick="sheet"]').click();
  assert.equal(a.node('entry-unit').value, 'pairs'); assert.equal(a.node('entry-qty').value, '99');
  unchanged(a, before);
});

for (const qty of ['', '0', '-1', '1.5', '1,5', '1e2', '0x10', 'NaN', '9007199254740992']) {
  test(`Lançar refuses nonpositive, fractional or unsafe sheet quantity ${JSON.stringify(qty)}`, () => {
    const a = app().entry({qty}), before = JSON.stringify(a.api.getData()); a.submit('entry'); unchanged(a, before); assert.equal(rows(a, 'entry').length, 0);
  });
}

test('changing reference, line, or kind regenerates the correct grade, including Line 300', () => {
  const a = app().entry();
  a.change('entry-color-0', 'Azul', 'input'); a.change('entry-model', 'm319');
  assert.deepEqual(rows(a, 'entry').map(row => row.sizes), [[4,4,8,4,4],[4,4,8,4,4],[2,2,4,2,2],[2,2,4,2,2]]);
  assert.equal(rows(a, 'entry')[0].color, 'Preto');
  a.change('entry-kind', 'solado'); a.change('entry-model', 'line:500'); assert.deepEqual(rows(a, 'entry')[0].sizes, [3,3,6,3,3]);
  a.change('entry-model', 'line:300'); assert.deepEqual(rows(a, 'entry')[0].sizes, [4,4,8,4,4]);
  a.change('entry-kind', 'palmilha'); a.change('entry-model', 'line:300'); assert.equal(rows(a, 'entry').length, 0); assert.match(a.node('entry-sheet-status').textContent, /não usa palmilha/);
});

for (const [target, label] of [['m601', /600/], ['m315', /315/]]) {
  test(`${target} without its confirmed pattern fails safely and configuring it fills this form`, () => {
    const a = app().entry({target}), before = clone(a.api.getData());
    assert.equal(rows(a, 'entry').length, 0); assert.match(a.node('entry-sheet-status').textContent, label);
    a.submit('entry'); unchanged(a, JSON.stringify(before));
    a.node('entry-configure-sheet').click(); assert.equal(a.node('modal').hidden, false);
    configureSingle(a); a.node('pattern-save').click();
    assert.equal(a.saved.length, 1, a.node('toast').textContent); assert.equal(a.node('modal').hidden, true);
    assert.deepEqual(rows(a, 'entry'), [{color:Inventory.colorLabel(Inventory.colorKey('Azul')), sizes:[0,0,72,0,0]}]);
    const next = clone(a.api.getData()); delete next.settings.sheetPatterns; assert.deepEqual(next, before);
    a.submit('entry'); assert.equal(a.saved.length, 2, a.node('toast').textContent); assert.equal(sheetEntries(a).length, 1);
    assert.equal(sheetEntries(a)[0].qty, 72); assert.equal(Inventory.colorKey(sheetEntries(a)[0].color), 'azul');
  });
}

test('edited numeric size strings and colors save the exact revised grid, without changing the pattern', () => {
  const a = app().entry(), settings = clone(a.api.getData().settings);
  a.change('entry-color-0', 'Azul', 'input'); a.change('entry-0-35', '2', 'input'); a.change('entry-0-36', '4', 'input');
  a.submit('entry'); assert.equal(a.saved.length, 1, a.node('toast').textContent);
  const row = sheetEntries(a).find(entry => Inventory.colorKey(entry.color) === 'azul'); assert.equal(row.qty, 18); assert.deepEqual(clone(row.sizeBreakdown), {'35':2,'36':4,'37':6,'38':3,'39':3});
  assert.deepEqual(clone(a.api.getData().settings), settings);
});

for (const value of ['4', '', '-1', '1.5', '1e1', '0x03', 'Infinity', '9007199254740992']) {
  test(`edited size ${JSON.stringify(value)} with wrong total or invalid syntax never saves`, () => {
    const a = app().entry(), before = JSON.stringify(a.api.getData()); a.change('entry-0-35', value, 'input'); a.submit('entry'); unchanged(a, before);
  });
}

test('the grade total must equal 72 times quantity even when pairsPerSheet is changed', () => {
  const data = fixture(); data.settings.pairsPerSheet = 100;
  const a = app(data).entry({qty:'2'}); assert.equal(total(rows(a, 'entry')), 144);
  a.change('entry-0-35', '7', 'input'); a.submit('entry'); assert.equal(a.saved.length, 0); assert.match(a.node('toast').textContent, /145.*144/);
  a.change('entry-0-35', '6', 'input'); a.submit('entry'); assert.equal(a.saved.length, 1); assert.equal(sheetEntries(a).reduce((sum, entry) => sum + entry.qty, 0), 144);
});

test('adding and removing colors updates actual editable DOM and preserves the remaining inputs', () => {
  const a = app().entry(); a.node('entry-add-color').click(); assert.equal(rows(a, 'entry').length, 5);
  a.change('entry-color-4', 'Azul', 'input'); a.change('entry-4-35', '3', 'input'); a.change('entry-0-35', '0', 'input');
  assert.equal(total(rows(a, 'entry')), 72);
  a.node('entry-grid').querySelector('[data-sheet-remove="4"]').click(); assert.equal(rows(a, 'entry').length, 4);
  assert.equal(a.node('entry-0-35').value, '0'); a.submit('entry'); assert.equal(a.saved.length, 0);
});

test('blank or unknown color requires its explicit checkbox in simple entries and is never a sheet default', () => {
  const a = app().entry({unit:'pairs', qty:'6'}), before = JSON.stringify(a.api.getData());
  a.submit('entry'); unchanged(a, before);
  a.change('entry-color', 'Sem cor discriminada', 'input'); a.submit('entry'); unchanged(a, before);
  a.node('entry-allow-unknown').checked = true; a.node('entry-allow-unknown').fire('change'); a.submit('entry'); assert.equal(a.saved.length, 1);
  assert.equal(entries(a).at(-1).color, 'Sem cor discriminada');
  const b = app().entry(); b.change('entry-color-0', 'Sem cor discriminada', 'input'); b.node('entry-allow-unknown').checked = true; b.submit('entry'); assert.equal(b.saved.length, 0);
});

test('finished sheets persist all colors, per-color labor obligations and consumption in one write', () => {
  const a = app().entry({kind:'finished', qty:'2'}), original = clone(a.api.getData());
  assert.match(a.node('entry-assembly-preview').textContent, /144 pares/);
  a.submit('entry'); assert.equal(a.saved.length, 1, a.node('toast').textContent);
  const next = a.api.getData(), finished = sheetEntries(a), obligations = Assembly.obligations(next);
  assert.equal(finished.length, 4); assert.equal(new Set(finished.map(row => row.sheetBatchId)).size, 1);
  assert.equal(finished.reduce((sum, row) => sum + row.qty, 0), 144);
  assert.equal(obligations.length, 4); assert.equal(obligations.reduce((sum, row) => sum + row.grossCents, 0), 37440);
  assert.ok(obligations.every(row => row.status === 'pending')); assert.equal(next.financeControl.settlements.length, 0);
  assert.equal(Inventory.validate(next).length, 0); assert.deepEqual(clone(entries(a).filter(row => !row.sheetBatchId)), original.weeks[WEEK].entries);
  assert.equal(JSON.parse(a.saved[0].value).factoryExpenses.filter(row => row.role === 'assembly_payable').length, 4);
});

test('a late color with insufficient materials rolls back the entire finished batch', () => {
  const data = fixture(); data.weeks[WEEK].entries = data.weeks[WEEK].entries.filter(row => !(row.kind === 'solado' && row.color === 'Off White'));
  const a = app(data).entry({kind:'finished'}), before = JSON.stringify(a.api.getData()); a.submit('entry'); unchanged(a, before); assert.equal(Assembly.obligations(a.api.getData()).length, 0);
});

test('double-clicking one finished form produces one batch, four obligations and one write', () => {
  const a = app().entry({kind:'finished'}), submit = a.node('entry-form').onsubmit;
  submit({preventDefault(){}}); submit({preventDefault(){}});
  assert.equal(a.saved.length, 1); assert.equal(sheetEntries(a).length, 4); assert.equal(Assembly.obligations(a.api.getData()).length, 4);
});

test('local write failure rolls back a finished batch and retry retains the original batch id', () => {
  const a = app().entry({kind:'finished'}), before = JSON.stringify(a.api.getData()), id = a.api.currentSubmission().id;
  a.fail(true); a.submit('entry'); unchanged(a, before); assert.match(a.node('toast').textContent, /não foi salvo/);
  assert.equal(a.api.currentSubmission().id, id); assert.equal(rows(a, 'entry').length, 4);
  a.fail(false); a.submit('entry'); assert.equal(a.saved.length, 1); assert.ok(sheetEntries(a).every(row => row.sheetBatchId === id));
});

for (const kind of ['pending', 'conflict', 'unhydrated', 'changed', 'rejected']) {
  test(`${kind} prevents saving all production colors and expenses`, () => {
    const a = app().entry({kind:'finished'});
    if (kind === 'pending') a.online.hasPending = () => true;
    if (kind === 'conflict') a.online.conflict = () => true;
    if (kind === 'unhydrated') a.online.canEditGoal = () => false;
    if (kind === 'changed') a.api.getData().settings.mountings[0].name = 'New remote name';
    if (kind === 'rejected') a.api.rejectSave();
    const before = JSON.stringify(a.api.getData()); a.submit('entry'); unchanged(a, before);
  });
}

for (const mode of ['leave', 'rerender', 'remote']) {
  test(`${mode} invalidates a retained production form`, () => {
    const a = app().entry(), old = a.node('entry-form').onsubmit;
    if (mode === 'leave') a.api.open('week'); if (mode === 'rerender') a.api.render(); if (mode === 'remote') a.api.replaceData(fixture());
    const before = JSON.stringify(a.api.getData()); old({preventDefault(){}}); unchanged(a, before);
  });
}

test('pattern configuration is a single settings-only write and cancellation invalidates its callback', () => {
  const a = app().entry(), before = JSON.stringify(a.api.getData()); a.node('entry-configure-sheet').click(); const stale = a.node('pattern-save').onclick;
  a.api.close(); stale(); unchanged(a, before);
  a.node('entry-configure-sheet').click(); const save = a.node('pattern-save').onclick; save(); save(); assert.equal(a.saved.length, 1);
  const next = clone(a.api.getData()); delete next.settings.sheetPatterns; assert.equal(JSON.stringify(next), before);
});

for (const mode of ['pending', 'conflict', 'changed', 'write-failure']) {
  test(`pattern ${mode} leaves settings and history unchanged`, () => {
    const a = app().entry(); a.node('entry-configure-sheet').click();
    if (mode === 'pending') a.online.hasPending = () => true;
    if (mode === 'conflict') a.online.conflict = () => true;
    if (mode === 'changed') a.api.getData().lastBackup = 'changed remotely';
    if (mode === 'write-failure') a.fail(true);
    const before = JSON.stringify(a.api.getData()); a.node('pattern-save').click(); unchanged(a, before);
    if (mode === 'write-failure') { a.fail(false); a.node('pattern-save').click(); assert.equal(a.saved.length, 1); }
  });
}

test('manual stock sheets use the same editable grade and save all movements in one state', () => {
  const a = app().stock({qty:'2'}), before = clone(a.api.getData());
  assert.equal(total(rows(a, 'stock')), 144); a.change('stock-0-35', '5', 'input'); a.change('stock-0-36', '7', 'input');
  a.submit('stock'); assert.equal(a.saved.length, 1, a.node('toast').textContent);
  const movements = a.api.getData().stockLedger; assert.equal(movements.length, 4); assert.equal(movements.reduce((sum, movement) => sum + movement.qty, 0), 144);
  assert.deepEqual(clone(a.api.getData().weeks), before.weeks); assert.deepEqual(clone(a.api.getData().factoryExpenses), before.factoryExpenses);
  assert.equal(Inventory.validate(a.api.getData()).length, 0);
});

test('manual stock shared sectors store the chosen line and regenerate the Line 300 pattern', () => {
  const a = app().stock({sector:'solado', ref:'@line:300'}); assert.deepEqual(rows(a, 'stock')[0].sizes, [4,4,8,4,4]);
  a.submit('stock'); assert.equal(a.saved.length, 1, a.node('toast').textContent); assert.ok(a.api.getData().stockLedger.every(movement => movement.ref === '@line:300'));
});

for (const mode of ['fractional', 'wrong-total', 'pending', 'conflict', 'unhydrated', 'changed', 'failure', 'out-insufficient']) {
  test(`manual stock ${mode} never saves a partial batch`, () => {
    const a = app().stock();
    if (mode === 'fractional') a.change('stock-qty', '1.5', 'input');
    if (mode === 'wrong-total') a.change('stock-0-35', '4', 'input');
    if (mode === 'pending') a.online.hasPending = () => true;
    if (mode === 'conflict') a.online.conflict = () => true;
    if (mode === 'unhydrated') a.online.canEditGoal = () => false;
    if (mode === 'changed') a.api.getData().lastBackup = 'new';
    if (mode === 'failure') a.fail(true);
    if (mode === 'out-insufficient') { a.change('stock-direction', 'out'); a.change('stock-ref', '319'); }
    const before = JSON.stringify(a.api.getData()); a.submit('stock'); unchanged(a, before);
    if (mode === 'failure') { a.fail(false); a.submit('stock'); assert.equal(a.saved.length, 1); }
  });
}

test('manual stock repeated submit, navigation and old form callbacks are idempotent', () => {
  const a = app().stock(), old = a.node('stock-form').onsubmit;
  a.api.open('week'); old({preventDefault(){}}); assert.equal(a.saved.length, 0);
  a.stock(); old({preventDefault(){}}); assert.equal(a.saved.length, 0);
  const current = a.node('stock-form').onsubmit; current({preventDefault(){}}); current({preventDefault(){}}); assert.equal(a.saved.length, 1); assert.equal(a.api.getData().stockLedger.length, 4);
});

test('manual stock unknown color requires its checkbox and sheets never infer unknown color', () => {
  const a = app().stock({unit:'pairs', qty:'6'}); a.change('stock-color', 'Sem cor discriminada', 'input'); a.submit('stock'); assert.equal(a.saved.length, 0);
  a.node('stock-allow-unknown').checked = true; a.node('stock-allow-unknown').fire('change'); a.submit('stock'); assert.equal(a.saved.length, 1); assert.equal(a.api.getData().stockLedger[0].color, 'Sem cor discriminada');
});

test('home unknown-color notice sums global balances once, without assigning colors or rewriting history', () => {
  const data = fixture({materials:false});
  data.weeks[WEEK].entries.push({id:'unknown-in-assembly', date:TODAY, kind:'cabedal', mountingId:'a', mountingName:'Montagem A (teste)', modelId:'m507', modelName:'507', line:'500', color:'Sem cor discriminada', qty:12});
  for (const [id, sector, ref, qty, date] of [['external','cabedal','507',5,TODAY],['soles','solado','@line:500',7,TODAY],['ready','produto_pronto','507',9,TODAY],['future','cabedal','507',88,'2026-10-09']]) data.stockLedger.push({id, sector, ref, qty, date, direction:'in', color:'Sem cor discriminada'});
  const a = app(data), before = JSON.stringify(a.api.getData()); a.api.open('week');
  const text = a.node('tab-week').textContent; assert.match(text, /33 pares sem cor discriminada no estoque/); assert.doesNotMatch(text, /45 pares sem cor discriminada no estoque/);
  assert.match(text, /Cabedal: 17/); assert.match(text, /Solado: 7/); assert.match(text, /Produto pronto: 9/);
  assert.equal((text.match(/pares sem cor discriminada no estoque/g) || []).length, 1); unchanged(a, before);
});

test('missing sheet module fails closed while opening a form and attempting a save', () => {
  const a = app(); a.api.dropSheets(); a.entry(); const before = JSON.stringify(a.api.getData());
  assert.equal(rows(a, 'entry').length, 0); assert.match(a.node('entry-sheet-status').textContent, /carregar a ficha/); a.submit('entry'); unchanged(a, before);
});

for (const unit of ['pairs', 'kits', 'sheets']) {
  test(`manual stock Line 300 palmilha is blocked in ${unit} even with configured cost`, () => {
    const data = fixture(); data.settings.lineCosts['300'] = {palmilha:2};
    const a = app(data).stock({sector:'palmilha', ref:'@line:300', unit}); a.change('stock-color', 'Preto', 'input');
    const before = JSON.stringify(a.api.getData()); a.submit('stock'); unchanged(a, before); assert.match(a.node('toast').textContent, /não usa palmilha/);
  });
}

for (const mode of ['render', 'leave-return', 'remote', 'new-modal']) {
  test(`pattern modal ${mode} invalidates old save callbacks`, () => {
    const a = app(); a.api.open('settings'); a.node('configure-sheet-pattern').click();
    const old = a.node('pattern-save').onclick;
    if (mode === 'render') a.api.render();
    if (mode === 'leave-return') { a.api.open('week'); a.api.open('settings'); }
    if (mode === 'remote') a.api.replaceData(fixture());
    if (mode === 'new-modal') a.api.pattern({ref:'507', line:'500'});
    const before = JSON.stringify(a.api.getData()); old(); unchanged(a, before);
    if (mode !== 'new-modal') assert.equal(a.node('modal').hidden, true);
  });
}

test('catalog-only reference opens and saves its own pattern without switching to another reference', () => {
  const data = fixture(); data.settings.models = data.settings.models.filter(model => model.id !== 'm315');
  data.settings.costCatalog['315'] = {ref:'315', model:'315 catálogo teste', line:'300', cabedal:5, total:20, complete:true};
  const a = app(data).stock({ref:'315'}); assert.equal(rows(a, 'stock').length, 0);
  a.node('stock-configure-sheet').click(); assert.equal(a.node('pattern-scope').value, 'ref'); assert.equal(a.node('pattern-target').value, '315');
  configureSingle(a); a.node('pattern-save').click(); assert.equal(a.saved.length, 1, a.node('toast').textContent);
  assert.equal(a.api.getData().settings.sheetPatterns.templates[0].target, '315'); assert.equal(total(rows(a, 'stock')), 72);
  a.submit('stock'); assert.equal(a.saved.length, 2, a.node('toast').textContent); assert.equal(a.api.getData().stockLedger[0].ref, '315');
});

test('manual stock unconfigured Line 600 can be configured and saved without a stale form', () => {
  const a = app().stock({sector:'solado', ref:'@line:600'}), before = clone(a.api.getData()); assert.equal(rows(a, 'stock').length, 0);
  a.node('stock-configure-sheet').click(); assert.equal(a.node('pattern-scope').value, 'line'); assert.equal(a.node('pattern-target').value, '600');
  configureSingle(a); a.node('pattern-save').click(); assert.equal(a.saved.length, 1);
  a.submit('stock'); assert.equal(a.saved.length, 2, a.node('toast').textContent);
  assert.equal(a.api.getData().stockLedger[0].ref, '@line:600'); assert.deepEqual(clone(a.api.getData().weeks), before.weeks);
});

test('saved production sheet rows keep exact size history and reject individual edits or deletions', () => {
  const a = app().entry(); a.submit('entry'); const row = sheetEntries(a)[0], before = JSON.stringify(a.api.getData()), writes = a.saved.length;
  assert.match(a.node('tab-entry').textContent, /35: 3/); assert.match(a.node('tab-entry').textContent, /Histórico protegido/);
  a.api.deleteEntry(WEEK, row.id); assert.equal(a.node('modal').hidden, true); assert.equal(a.saved.length, writes);
  a.api.edit(row.id); assert.equal(a.node('entry-unit').options.some(option => option.value === 'sheets'), false);
  a.change('entry-qty', '1', 'input'); a.submit('entry'); assert.equal(a.saved.length, writes); assert.equal(JSON.stringify(a.api.getData()), before);
});

test('saved stock sheet rows reject deleting a single color from the batch', () => {
  const a = app().stock(); a.submit('stock'); const row = a.api.getData().stockLedger[0], before = JSON.stringify(a.api.getData());
  const button = a.document.querySelector(`[data-stock-delete="${row.id}"]`); assert.ok(button); button.click();
  assert.equal(a.saved.length, 1); assert.equal(a.node('modal').hidden, true); assert.match(a.node('toast').textContent, /lote completo/); assert.equal(JSON.stringify(a.api.getData()), before);
});

test('programmatically changed reference without its change event cannot save the old grid', () => {
  const a = app().entry(), before = JSON.stringify(a.api.getData()); a.node('entry-model').value = 'm319'; a.submit('entry'); unchanged(a, before); assert.match(a.node('toast').textContent, /linha mudou|modelo/);
});

test('all external scripts and inline application scripts parse without execution or network', () => {
  for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script[2]));
  for (const name of ['standard-sheet.js','inventory-guard.js','assembly-finance.js']) assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(__dirname, '..', name), 'utf8')));
});
