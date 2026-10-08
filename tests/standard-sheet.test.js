'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const S=require('../standard-sheet'),I=require('../inventory-guard'),A=require('../assembly-finance');
const TODAY='2026-10-07',NOW='2026-10-07T20:00:00.000Z',WEEK='2026-10-05';
const clone=value=>JSON.parse(JSON.stringify(value));
const options={today:TODAY,now:NOW,inventory:I,assembly:A};
const code=expected=>error=>{assert.equal(error.code,expected,error.message);return true};
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}
function state(){return {version:4,settings:{models:[{id:'m507',name:'507 Teste',ref:'507',line:'500',active:true},{id:'m319',name:'319 Teste',ref:'319',line:'300',active:true,usesPalmilha:false},{id:'m315',name:'315 Teste',ref:'315',line:'300',active:true},{id:'m601',name:'601 Teste',ref:'601',line:'600',active:true}],mountings:[{id:'a',name:'Montagem A Teste',rate:2.6,active:true}],pairsPerSheet:72},weeks:{[WEEK]:{goal:720,modelGoals:{m507:720},entries:[],retained:true},'2026-09-28':{goal:72,entries:[],retained:'historical'}},stockLedger:[],factoryExpenses:[],financeControl:{version:1,advances:[],settlements:[]},salesControl:{orders:[],receipts:[]},unrelated:{preserve:['unchanged']}}}
function grade(line='500',sheets=1){return S.buildGrid(state(),{line,sheets}).rows}
function stripTotals(rows){return rows.map(({color,sizeBreakdown})=>({color,sizeBreakdown:clone(sizeBreakdown)}))}
function production(input={},s=state()){return S.createProductionBatch(s,{batchId:'batch-prod',date:TODAY,kind:'cabedal',modelId:'m507',mountingId:'a',sheets:1,rows:grade(),...input},options)}
function stock(input={},s=state()){return S.createStockBatch(s,{batchId:'batch-stock',date:TODAY,direction:'in',sector:'cabedal',ref:'507',sheets:1,rows:grade(),...input},options)}
function materials(line='500'){
  let s=state();const modelId=line==='300'?'m319':'m507',rows=grade(line);
  for(const kind of ['cabedal','solado',...(line==='300'?[]:['palmilha'])])s=production({batchId:'material-'+kind,kind,modelId:kind==='cabedal'?modelId:'',line,rows},s);
  return s;
}

test('UMD exposes the same API in a browser with existing inventory and assembly engines',()=>{
  const context=vm.createContext({});
  for(const file of ['inventory-guard.js','assembly-finance.js','standard-sheet.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  assert.equal(context.FioriSheets.PAIRS_PER_SHEET,72);assert.equal(typeof context.FioriSheets.createProductionBatch,'function');
  assert.equal(context.FioriSheets.buildGrid(state(),{line:'500',sheets:1}).total,72);
});
test('confirmed 500 default is four exact 18-pair colors with 3,3,6,3,3 and reads never configure state',()=>{
  const s=freeze(state()),before=JSON.stringify(s),resolved=S.resolvePattern(s,{modelId:'m507'}),g=S.buildGrid(s,{line:'500',sheets:1});
  assert.equal(resolved.ok,true);assert.equal(resolved.source,'default');assert.equal(g.total,72);
  assert.deepEqual(g.rows.map(row=>[row.color,row.qty,Object.values(row.sizeBreakdown)]),['Preto','Caramelo','Rose','Off White'].map(color=>[color,18,[3,3,6,3,3]]));
  assert.equal(s.settings.sheetPatterns,undefined);assert.equal(JSON.stringify(s),before);
});
test('confirmed 300 default is 24,24,12,12 with distinct confirmed size distributions',()=>{
  const g=S.buildGrid(state(),{modelId:'m319',sheets:1});
  assert.deepEqual(g.rows.map(row=>row.qty),[24,24,12,12]);
  assert.deepEqual(Object.values(g.rows[0].sizeBreakdown),[4,4,8,4,4]);assert.deepEqual(Object.values(g.rows[2].sizeBreakdown),[2,2,4,2,2]);
});
test('315 never inherits a line default or line override; 600 has no invented default',()=>{
  const s=S.savePattern(state(),{scope:'line',target:'300',rows:grade('500')});
  assert.equal(S.resolvePattern(s,{ref:'315'}).ok,false);assert.match(S.resolvePattern(s,{ref:'315'}).message,/cinco variações/);
  assert.equal(S.resolvePattern(s,{line:'600'}).code,'unconfirmed_pattern');
  assert.throws(()=>S.buildGrid(s,{line:'600',sheets:1}),code('unconfirmed_pattern'));
  assert.throws(()=>production({modelId:'m315',rows:grade('300')},s),code('unconfirmed_pattern'));
  assert.throws(()=>stock({ref:'601'},s),code('unconfirmed_pattern'));
});
test('a confirmed reference override enables 315 and takes priority over configured line templates',()=>{
  let s=S.savePattern(state(),{scope:'line',target:'300',rows:grade('300')});
  s=S.savePattern(s,{scope:'ref',target:'315',rows:[{color:'Ouro Light',sizeBreakdown:{'35':12,'36':12,'37':24,'38':12,'39':12}}]});
  const p=S.resolvePattern(s,{modelId:'m315'});assert.equal(p.source,'custom');assert.equal(p.template.scope,'ref');assert.equal(p.template.line,'300');assert.equal(p.template.rows.length,1);
  assert.equal(production({modelId:'m315',rows:p.template.rows},s).weeks[WEEK].entries.length,1);
});
test('a user-configured 600 template enables the line without changing any default',()=>{
  const s=S.savePattern(state(),{scope:'line',target:'600',rows:grade()});
  assert.equal(S.buildGrid(s,{line:'600',sheets:2}).total,144);assert.equal(S.resolvePattern(state(),{line:'600'}).ok,false);
});
test('scaling multiplies every cell exactly and returns an independent editable grade',()=>{
  const p=S.resolvePattern(state(),{line:'500'}).template,g=S.scalePattern(p,3);
  assert.equal(g.reduce((sum,row)=>sum+row.qty,0),216);assert.deepEqual(Object.values(g[0].sizeBreakdown),[9,9,18,9,9]);g[0].sizeBreakdown['35']=0;assert.equal(p.rows[0].sizeBreakdown['35'],3);
});
test('fractional, zero, negative, string and unsafe sheet counts are refused',()=>{
  for(const sheets of [0,-1,1.5,'1',NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>S.buildGrid(state(),{line:'500',sheets}),code('invalid_sheets'));
  assert.throws(()=>S.buildGrid(state(),{line:'500',sheets:Number.MAX_SAFE_INTEGER}),code('invalid_quantity'));
});
test('rows accept zero cells and omitted sizes, but zero colors are omitted from a launch',()=>{
  const rows=[{color:'Preto',sizeBreakdown:{'37':72}},{color:'Rose',sizeBreakdown:{'35':0}}],r=S.validateRows(rows,{expectedTotal:72});
  assert.equal(r.rows.length,1);assert.deepEqual(r.rows[0].sizeBreakdown,{'35':0,'36':0,'37':72,'38':0,'39':0});assert.equal(production({rows}).weeks[WEEK].entries.length,1);
  assert.throws(()=>S.savePattern(state(),{scope:'line',target:'500',rows}),code('empty_color'));
});
test('duplicate color aliases and generic unknown placeholders cannot be templates or graded launches',()=>{
  for(const color of ['', 'ficha','Sem cor discriminada','sem cor','não informado','diversas','N/A','123','---']){
    const rows=[{color,sizeBreakdown:{'37':72}}];assert.throws(()=>S.validateRows(rows,{allowUnknown:true}),code('unknown_color'));assert.throws(()=>production({rows,allowUnknown:true}),code('unknown_color'));
  }
  for(const pair of [['Rose','Rosa'],['off-white','Branco'],[' PRETO ','preto'],['Ouro','Ouro Light']])assert.throws(()=>S.validateRows(pair.map(color=>({color,sizeBreakdown:{'37':36}}))),code('duplicate_color'));
});
test('unknown sizes, decimals, unsafe integers, stale totals and empty grades fail before mutation',()=>{
  for(const sizeBreakdown of [{'34':72},{'40':72},{'35':-1},{'35':1.5},{'35':'72'},{'35':Infinity},{'35':Number.MAX_SAFE_INTEGER,'36':1},[{'size':'35',qty:72}]])assert.throws(()=>S.validateRows([{color:'Preto',sizeBreakdown}]));
  assert.throws(()=>S.validateRows([{color:'Preto',sizeBreakdown:{'35':72},qty:71}]),code('row_total_mismatch'));
  assert.throws(()=>S.validateRows([{color:'Preto',sizeBreakdown:{}}]),code('empty_grid'));
  assert.throws(()=>S.validateRows([]),code('empty_grid'));
});
test('an edited launch may change every cell and color but its total must still equal sheets times 72',()=>{
  const rows=[{color:'Azul Marinho',sizeBreakdown:{'35':7,'36':11,'37':20,'38':17,'39':17}}],s=production({rows});
  assert.equal(s.weeks[WEEK].entries[0].qty,72);assert.equal(s.weeks[WEEK].entries[0].sizeBreakdown['35'],7);
  rows[0].sizeBreakdown['35']=8;assert.throws(()=>production({rows}),code('total_mismatch'));
  assert.throws(()=>production({sheets:2}),code('total_mismatch'));
});
test('savePattern stores only the selected versioned template and preserves all historical data',()=>{
  const original=freeze(state()),before=JSON.stringify(original);let s=S.savePattern(original,{scope:'line',target:'500',rows:grade()});
  s.settings.sheetPatterns.custom='preserve';s=S.savePattern(s,{scope:'ref',target:'507',rows:grade('300')});
  const oldRef=clone(s.settings.sheetPatterns.templates[1]);s=S.savePattern(s,{scope:'line',target:'500',rows:grade('300')});
  assert.equal(s.settings.sheetPatterns.version,1);assert.equal(s.settings.sheetPatterns.templates.length,2);assert.deepEqual(s.settings.sheetPatterns.templates[1],oldRef);assert.equal(s.settings.sheetPatterns.custom,'preserve');
  for(const key of ['weeks','factoryExpenses','stockLedger','financeControl','salesControl','unrelated'])assert.deepEqual(s[key],original[key]);assert.equal(JSON.stringify(original),before);
});
test('template totals, target formats, conflicting model lines, corrupt versions and duplicates are blocked',()=>{
  assert.throws(()=>S.savePattern(state(),{scope:'line',target:'500',rows:[{color:'Preto',sizeBreakdown:{'35':71}}]}),code('total_mismatch'));
  assert.throws(()=>S.savePattern(state(),{scope:'ref',target:'507',line:'300',rows:grade()}),code('target_mismatch'));
  for(const target of ['__proto__','constructor','500x',''])assert.throws(()=>S.savePattern(state(),{scope:'line',target,rows:grade()}),code('invalid_line'));
  let s=state();s.settings.sheetPatterns={version:2,templates:[]};assert.equal(S.resolvePattern(s,{line:'500'}).code,'invalid_patterns');
  s=S.savePattern(state(),{scope:'line',target:'500',rows:grade()});s.settings.sheetPatterns.templates.push(clone(s.settings.sheetPatterns.templates[0]));assert.equal(S.resolvePattern(s,{line:'500'}).code,'duplicate_pattern');
  s=state();s.settings.models[0].line='300';assert.equal(S.resolvePattern(s,{modelId:'m507'}).code,'target_mismatch');
  assert.equal(S.resolvePattern(state(),{modelId:'m507',ref:'319'}).code,'target_mismatch');
});
test('production is one atomic color batch, shares snapshot metadata, and is idempotent after reload',()=>{
  const original=freeze(state()),before=JSON.stringify(original),next=production({},original),entries=next.weeks[WEEK].entries;
  assert.equal(entries.length,4);assert.equal(new Set(entries.map(row=>row.id)).size,4);assert.equal(entries.reduce((n,row)=>n+row.qty,0),72);
  for(const row of entries){assert.equal(row.sheetBatchId,'batch-prod');assert.equal(row.sheetBatchType,'production');assert.equal(row.sheetCount,1);assert.equal(row.sheetBatchRows,4);assert.equal(row.sheetBatchTotal,72);assert.equal(row.inputUnit,'pairs');assert.equal(row.inputQty,18);assert.deepEqual(Object.values(row.sizeBreakdown),[3,3,6,3,3])}
  assert.deepEqual(production({},clone(next)),next);assert.equal(JSON.stringify(original),before);assert.deepEqual(next.weeks['2026-09-28'],original.weeks['2026-09-28']);assert.deepEqual(next.factoryExpenses,[]);
});
test('replay does not rewrite display names or timestamps after settings change',()=>{
  const next=production();next.settings.models[0].name='New display';next.settings.mountings[0].name='New name';const before=clone(next);
  const replay=S.createProductionBatch(next,{batchId:'batch-prod',date:TODAY,kind:'cabedal',modelId:'m507',mountingId:'a',sheets:1,rows:grade()},{...options,now:'2026-10-08T12:00:00Z'});
  assert.deepEqual(replay,before);
});
test('changed contents, cross-ledger reuse, missing batch rows and orphaned IDs never repair or duplicate batches',()=>{
  const saved=production(),before=JSON.stringify(saved);
  for(const overrides of [{note:'changed'},{date:'2026-10-06'},{rows:grade('300')},{kind:'solado',modelId:'',line:'500'}])assert.throws(()=>production(overrides,saved),code('batch_conflict'));
  const missing=clone(saved);missing.weeks[WEEK].entries.pop();assert.throws(()=>production({},missing),code('batch_conflict'));
  assert.throws(()=>stock({batchId:'batch-prod'},saved),code('batch_conflict'));
  const occupied=state();occupied.stockLedger.push({id:saved.weeks[WEEK].entries[0].id,date:TODAY,sector:'cabedal',ref:'507',direction:'in',qty:1,color:'Preto'});assert.throws(()=>production({},occupied),code('batch_conflict'));
  assert.equal(JSON.stringify(saved),before);
});
test('all batches refuse invalid targets, dates, time values, duplicate IDs and malformed input state',()=>{
  assert.throws(()=>production({mountingId:'missing'}),code('invalid_mounting'));
  assert.throws(()=>production({kind:'unknown'}),code('invalid_kind'));
  assert.throws(()=>production({modelId:'missing'}),code('invalid_model'));
  for(const date of ['2026-02-30','0000-01-01','2026-1-01',''])assert.throws(()=>production({date}),code('invalid_date'));
  assert.throws(()=>S.createProductionBatch(state(),{batchId:'x',date:TODAY,rows:grade(),sheets:1},{...options,now:'2026-10-07T25:00:00Z'}),code('invalid_timestamp'));
  const s=state();s.weeks[WEEK].entries=null;assert.throws(()=>production({},s),code('invalid_state'));
  const dup=production();dup.weeks[WEEK].entries.push(clone(dup.weeks[WEEK].entries[0]));assert.throws(()=>production({batchId:'new'},dup),code('duplicate_id'));
});
test('production uses Monday week keys and creates only a new week snapshot when needed',()=>{
  const s=production({date:'2026-10-12'});assert.equal(s.weeks['2026-10-12'].entries.length,4);assert.equal(s.weeks['2026-10-12'].goal,null);assert.equal(s.weeks[WEEK].entries.length,0);assert.deepEqual(s.weeks['2026-10-12'].modelSnapshot,s.settings.models);
});
test('palmilha 300 is blocked in production, stock, resolution, and custom-template flows',()=>{
  const rows=grade('300');
  assert.throws(()=>production({kind:'palmilha',modelId:'',line:'300',rows}),code('palmilha_300'));
  assert.throws(()=>stock({sector:'palmilha',ref:'@line:300',rows}),code('palmilha_300'));
  assert.throws(()=>stock({sector:'palmilha',ref:'319',rows}),code('palmilha_300'));
  assert.equal(S.resolvePattern(state(),{line:'300',kind:'palmilha'}).code,'palmilha_300');
  const custom=S.savePattern(state(),{scope:'line',target:'300',rows});assert.throws(()=>production({kind:'palmilha',modelId:'',line:'300',rows},custom),code('palmilha_300'));
});
test('a finished 500 batch delegates each color to FioriAssembly and atomically consumes matching materials',()=>{
  const source=freeze(materials()),before=JSON.stringify(source);let calls=0;
  const next=S.createProductionBatch(source,{batchId:'finished-batch',date:TODAY,kind:'finished',modelId:'m507',mountingId:'a',sheets:1,rows:grade()},{...options,assembly:{...A,createFinished(...args){calls++;return A.createFinished(...args)}}});
  const finished=next.weeks[WEEK].entries.filter(row=>row.kind==='finished');assert.equal(calls,4);assert.equal(finished.length,4);assert.equal(A.obligations(next).length,4);assert.equal(next.factoryExpenses.reduce((sum,e)=>sum+e.grossCents,0),18720);
  for(const row of finished){assert.equal(row.assemblyExpenseId,'assembly_payable:'+row.id);assert.equal(row.assemblyRate.rateCents,260);assert.equal(next.factoryExpenses.find(e=>e.productionEntryId===row.id).qty,18)}
  assert.equal(I.validate(next).length,0);const balances=I.ledger(next).rows.filter(r=>r.scope==='global');assert.equal(balances.filter(r=>r.sector==='produto_pronto').reduce((sum,r)=>sum+r.qty,0),72);assert.equal(balances.filter(r=>r.sector!=='produto_pronto').reduce((sum,r)=>sum+r.qty,0),0);
  assert.equal(JSON.stringify(source),before);
});
test('a finished 300 batch consumes cabedal and solado without requiring or inventing palmilha',()=>{
  const source=materials('300'),next=production({batchId:'finished300',kind:'finished',modelId:'m319',rows:grade('300')},source);
  assert.equal(A.obligations(next).length,4);assert.equal(I.ledger(next).rows.some(row=>row.sector==='palmilha'),false);assert.equal(I.validate(next).length,0);
});
test('finished replay survives tariff changes, settlements and later dates without repricing or recreating obligations',()=>{
  const input={batchId:'finished',date:TODAY,kind:'finished',modelId:'m507',mountingId:'a',sheets:1,rows:grade()};
  let s=S.createProductionBatch(materials(),input,options);s.settings.mountings[0].rate=9;
  const plan=A.planSettlement(s,{mountingId:'a',date:TODAY});s=A.applySettlement(s,plan,{id:'settled',now:NOW,method:'Pix',note:'Synthetic'});
  assert.deepEqual(S.createProductionBatch(s,input,{...options,today:'2026-10-08',now:'2026-10-08T20:00:00Z'}),s);assert.equal(A.obligations(s).length,4);
});
test('finished missing rates and insufficient material colors fail the whole candidate without source mutations',()=>{
  const s=freeze(materials()),before=JSON.stringify(s);
  assert.throws(()=>production({batchId:'bad-finished',kind:'finished',date:'2026-10-06'},s),code('missing_rate'));
  assert.throws(()=>production({batchId:'bad-finished',kind:'finished',rows:[{color:'Azul',sizeBreakdown:{'37':72}}]},s),code('insufficient_stock'));
  assert.equal(JSON.stringify(s),before);assert.equal(s.factoryExpenses.length,0);
  assert.throws(()=>production({kind:'finished'}),code('insufficient_stock'));
});
test('a corrupted finished batch cannot be replayed as complete when snapshots and payables are missing',()=>{
  const s=production({batchId:'finished',kind:'finished'},materials());
  for(const row of s.weeks[WEEK].entries.filter(e=>e.kind==='finished')){delete row.assemblyExpenseId;delete row.assemblyRate}
  s.factoryExpenses=[];const before=JSON.stringify(s);
  assert.throws(()=>production({batchId:'finished',kind:'finished'},s),code('missing_obligation'));assert.equal(JSON.stringify(s),before);
});
test('stock batches create one movement per color, preserve history and use actual global balances only once',()=>{
  const original=freeze(state()),next=stock({},original);assert.equal(next.stockLedger.length,4);assert.equal(I.ledger(next).rows.filter(r=>r.scope==='global').reduce((n,r)=>n+r.qty,0),72);assert.deepEqual(next.weeks,original.weeks);
  assert.deepEqual(stock({},next),next);const out=stock({batchId:'out',direction:'out'},next);assert.equal(out.stockLedger.length,8);assert.equal(I.ledger(out).rows.reduce((n,r)=>n+r.qty,0),0);assert.deepEqual(stock({batchId:'out',direction:'out'},out),out);
});
test('shared stock targets normalize to @line and overdraw rolls back the whole batch',()=>{
  const s=stock({sector:'solado',ref:'507'});assert.equal(s.stockLedger.every(row=>row.ref==='@line:500'),true);
  const before=JSON.stringify(s);assert.throws(()=>stock({sector:'solado',ref:'@line:500',direction:'out',batchId:'too-many',sheets:2,rows:grade('500',2)},s),code('insufficient_stock'));assert.equal(JSON.stringify(s),before);
  assert.throws(()=>stock({sector:'invalid'}),code('invalid_stock'));assert.throws(()=>stock({direction:'invalid'}),code('invalid_stock'));
  assert.throws(()=>stock({sector:'solado',ref:'@line:500',line:'300'}),code('target_mismatch'));
});
test('new batches do not accept unsafe aggregate inventory even when each movement is independently valid',()=>{
  const s=state();s.stockLedger.push({id:'huge',date:TODAY,sector:'cabedal',ref:'507',direction:'in',color:'Preto',qty:Number.MAX_SAFE_INTEGER});
  assert.throws(()=>stock({},s),code('invalid_quantity'));
});
test('unknown-color summary uses positive current global balances, never mounting totals or movement sums',()=>{
  const s=state();s.weeks[WEEK].entries.push({id:'unknown-upper',date:TODAY,kind:'cabedal',mountingId:'a',modelId:'m507',line:'500',qty:72,color:'Sem cor discriminada'},{id:'unknown-sole',date:TODAY,kind:'solado',mountingId:'a',line:'500',qty:72,color:'ficha'},{id:'unknown-insole',date:TODAY,kind:'palmilha',mountingId:'a',line:'500',qty:72,color:''},{id:'legacy-finished',date:TODAY,kind:'finished',mountingId:'a',modelId:'m507',line:'500',qty:18,color:'sem cor'});
  s.stockLedger.push({id:'unknown-extra',date:TODAY,sector:'produto_pronto',ref:'507',direction:'in',qty:10,color:'kit'},{id:'sold',date:TODAY,sector:'produto_pronto',ref:'507',direction:'out',qty:5,color:'sem cor'},{id:'known',date:TODAY,sector:'cabedal',ref:'507',direction:'in',qty:200,color:'Preto'});
  const before=JSON.stringify(s),r=S.unknownColorSummary(freeze(s),{until:TODAY,inventory:I});assert.equal(r.valid,true);assert.deepEqual(r.bySector,{cabedal:54,solado:54,palmilha:54,produto_pronto:23});assert.equal(r.total,185);assert.equal(r.rows.length,4);assert.equal(r.rows.every(row=>row.scope==='global'),true);assert.equal(JSON.stringify(s),before);
});
test('unknown-color summary ignores zero/negative balances and future records but exposes guard issues',()=>{
  const s=state();s.stockLedger.push({id:'old-in',date:'2026-10-01',sector:'cabedal',ref:'507',direction:'in',qty:72,color:''},{id:'old-out',date:'2026-10-02',sector:'cabedal',ref:'507',direction:'out',qty:72,color:''},{id:'future',date:'2026-10-09',sector:'solado',ref:'@line:500',direction:'in',qty:72,color:''});
  assert.equal(S.unknownColorSummary(s,TODAY).total,0);assert.equal(S.unknownColorSummary(s,'2026-10-10').total,72);
  s.stockLedger.push({id:'negative',date:TODAY,sector:'palmilha',ref:'@line:500',direction:'out',qty:4,color:''});const r=S.unknownColorSummary(s,TODAY);assert.equal(r.total,0);assert.equal(r.valid,false);assert.equal(r.issues[0].code,'insufficient_stock');
});
test('unknown-color summary uses the real existing dashboard fixture without changing any old data',()=>{
  const s=require('./fixtures/dashboard-state').state();s.weeks[WEEK].entries[0].color='fichas';const before=JSON.stringify(s),result=S.unknownColorSummary(s,TODAY);assert.equal(result.total,168);assert.equal(result.bySector.cabedal,168);assert.equal(JSON.stringify(s),before);
});
