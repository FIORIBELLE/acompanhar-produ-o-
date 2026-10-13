'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const UI=require('../tech-sheet-ui'),T=require('../tech-sheet'),M=require('../material-catalog');

// All records, references, prices and quantities below are synthetic. These
// tests work with in-memory state only and never access operational services.
const REF='981',DATE='2026-06-15',FROM='2026-06-01',NEXT='2026-07-01';
const NOW='2026-06-01T12:00:00.000Z',LATER='2026-06-15T13:00:00.000Z';
const clone=value=>JSON.parse(JSON.stringify(value));
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}
function material(extra={}){return {id:'material-fiction',name:'Componente fictício',category:'outro',unit:'un',variantByColor:false,active:true,createdAt:NOW,updatedAt:NOW,prices:[{id:'price-fiction',from:FROM,unitPriceMills:2400,note:'Preço sintético'}],...extra}}
function item(extra={}){return {id:'item-fiction',materialId:'material-fiction',label:'Posição fictícia',qtyPerPair:'0.625',qtyBySizeGroup:null,colorMap:{'Azul fictício':'Etiqueta informativa'},extraItem:{preserve:['item',7]},...extra}}
function version(extra={}){return {id:'version-fiction',validFrom:FROM,sizeGroups:[],items:[item()],salePriceMills:4500,note:'Observação fictícia',createdAt:NOW,extraVersion:{preserve:['version',9]},...extra}}
function state(){return {settings:{models:[{id:'model-fiction',ref:REF,line:'900',name:'Modelo fictício'}],materials:[material()],techSheets:{[REF]:{ref:REF,versions:[version()],extraSheet:{retained:true}},'982':{ref:'982',versions:[version({id:'other-version'})],unrelated:'untouched'}},extraSettings:{retained:[1,2]}},weeks:{'2026-06-01':{entries:[{id:'production-fiction'}],extra:'retained'}},salesOrders:[{id:'order-fiction',extra:true}],salesPayments:[{id:'payment-fiction'}],factoryExpenses:[{id:'expense-fiction'}],stockLedger:[{id:'stock-fiction'}],unknownRoot:{nested:{keep:'safe'}}}}
function current(s){return s.settings.techSheets[REF].versions[0]}
function candidate(extra={}){return version({id:'version-next',validFrom:NEXT,createdAt:LATER,...extra})}
function code(fn,expected){assert.throws(fn,error=>expected.includes(error.code),expected.join(' or '))}
function has(result,expected){assert.ok(result.issues.some(issue=>issue.code===expected),JSON.stringify(result.issues))}
function sorted(values){return values.slice().sort((a,b)=>a.id.localeCompare(b.id))}

// Public module contract and read-only history.
test('UI model loads in CommonJS and browser UMD without persistence or a clock',()=>{
 const context=vm.createContext({});
 for(const name of ['inventory-guard','material-catalog','standard-sheet','tech-sheet','tech-sheet-ui'])vm.runInContext(fs.readFileSync(require.resolve('../'+name),'utf8'),context);
 assert.deepEqual(Object.keys(context.FioriTechSheetUI).sort(),Object.keys(UI).sort());
 for(const name of ['history','draft','project','appendVersion','formatMoney','formatExact','delta'])assert.equal(typeof UI[name],'function',name);
 assert.deepEqual(clone(context.FioriTechSheetUI.history(freeze(state()),REF)),UI.history(state(),REF));
});
test('missing histories return independent empty results without initializing settings',()=>{
 for(const s of [{},{settings:{}},{settings:{techSheets:{}}}]){
  freeze(s);const before=JSON.stringify(s),a=UI.history(s,REF),b=UI.history(s,REF);
  assert.deepEqual(a,[]);assert.deepEqual(b,[]);assert.notEqual(a,b);assert.equal(JSON.stringify(s),before);
 }
});
test('history preserves all versions and unknown fields while returning deep copies',()=>{
 const s=state();s.settings.techSheets[REF].versions.push(version({id:'historical',validFrom:'2026-01-01'}),version({id:'future',validFrom:'2027-01-01'}));
 freeze(s);const before=JSON.stringify(s),history=UI.history(s,REF);
 assert.deepEqual(sorted(history),sorted(s.settings.techSheets[REF].versions));
 history[0].items[0].colorMap['Azul fictício']='Changed';history[0].extraVersion.preserve.push('Changed');history.push(candidate());
 assert.equal(JSON.stringify(s),before);assert.deepEqual(sorted(UI.history(s,REF)),sorted(s.settings.techSheets[REF].versions));
});
test('history validates existing shape, IDs and calendar dates before returning records',()=>{
 const mutations=[
  s=>{s.settings.techSheets=[]},s=>{s.settings.techSheets[REF]=null},
  s=>{s.settings.techSheets[REF].ref='982'},s=>{s.settings.techSheets[REF].versions={}},
  s=>{s.settings.techSheets[REF].versions=[null]},s=>{current(s).id=' '},
  s=>{current(s).validFrom='2026-02-30'},s=>{current(s).validFrom='2026-6-01'},
  s=>{s.settings.techSheets[REF].versions.push(version({id:'duplicate-date'}))},
  s=>{s.settings.techSheets[REF].versions.push(version({validFrom:'2025-01-01'}))}
 ];
 for(const mutate of mutations){const s=state();mutate(s);freeze(s);const before=JSON.stringify(s);assert.throws(()=>UI.history(s,REF));assert.equal(JSON.stringify(s),before)}
});

// Explicitly dated append-only drafts; nothing is silently seeded.
test('draft copies the version applicable on the query date, preserving unknown fields and colorMap',()=>{
 const s=state();s.settings.techSheets[REF].versions.unshift(version({id:'future',validFrom:'2027-01-01',note:'Futura'}));
 freeze(s);const before=JSON.stringify(s),draft=UI.draft(s,REF,DATE,'new-draft',LATER);
 const expected={...clone(s.settings.techSheets[REF].versions[1]),id:'new-draft',createdAt:LATER,validFrom:''};
 assert.deepEqual(draft,expected);assert.equal(draft.salePriceMills,4500);
 draft.items[0].qtyPerPair='3';draft.items[0].colorMap['Azul fictício']='Changed';draft.extraVersion.preserve.push('Changed');
 assert.equal(JSON.stringify(s),before);
});
test('an absent or future-only version creates a blank draft without invented sale or grade',()=>{
 const empty=state();delete empty.settings.techSheets[REF];
 const future=state();current(future).validFrom='2027-01-01';
 for(const s of [empty,future]){
  freeze(s);const before=JSON.stringify(s),draft=UI.draft(s,REF,DATE,'blank-draft',LATER);
  assert.equal(draft.id,'blank-draft');assert.equal(draft.createdAt,LATER);assert.equal(draft.validFrom,'');
  assert.deepEqual(draft.items,[]);assert.deepEqual(draft.sizeGroups,[]);assert.equal(draft.note,'');
  assert.equal(Object.hasOwn(draft,'salePriceMills'),false);assert.equal(JSON.stringify(s),before);
 }
});
test('repeated draft creation and editing do not share mutable item or metadata objects',()=>{
 const s=freeze(state()),a=UI.draft(s,REF,DATE,'draft-a',LATER),b=UI.draft(s,REF,DATE,'draft-b',LATER);
 a.items[0].extraItem.preserve.push('Changed');a.items[0].colorMap.new='Changed';a.extraVersion.preserve.push('Changed');
 assert.deepEqual(b.items[0],current(s).items[0]);assert.deepEqual(b.extraVersion,current(s).extraVersion);
});

// Projection must use the cost engine rather than a separate money formula.
test('project invokes equivalent engine semantics using only an isolated in-memory candidate',()=>{
 const s=freeze(state()),v=freeze(candidate({items:[item({qtyPerPair:'0.75'})]})),before=JSON.stringify(s),vBefore=JSON.stringify(v);
 const expected=clone(s);expected.settings.techSheets[REF].versions.push(clone(v));
 const projected=UI.project(s,REF,v,NEXT);
 assert.deepEqual(projected,T.calculateTechSheet(expected,{ref:REF,date:NEXT}));
 assert.equal(projected.costPerPairMills,1800);assert.equal(projected.costPerSheetMills,129600);assert.equal(projected.salePerSheetMills,324000);
 projected.items[0].label='Changed';projected.distribution.groups[0].pairs=1;
 assert.equal(JSON.stringify(s),before);assert.equal(JSON.stringify(v),vBefore);
});
test('preview remains deterministic through repeat calls, without saving the proposed version',()=>{
 const s=freeze(state()),v=freeze(candidate()),before=JSON.stringify(s),a=UI.project(s,REF,v,NEXT);
 for(let index=0;index<4;index++)assert.deepEqual(UI.project(s,REF,v,NEXT),a);
 assert.equal(UI.history(s,REF).length,1);assert.equal(JSON.stringify(s),before);
});
test('uniform quantities calculate without grade and retain exact submill item products',()=>{
 const s=state();s.settings.materials[0].prices[0].unitPriceMills=17;
 const v=candidate({items:[item({qtyPerPair:'0.25'})],salePriceMills:50});
 freeze(s);freeze(v);const before=JSON.stringify(s),r=UI.project(s,REF,v,NEXT);
 assert.equal(r.distribution.source,'uniform');assert.equal(r.costPerPairMills,4);assert.equal(r.costPerSheetMills,306);
 assert.deepEqual(r.items[0].costs[0].costMillsExact,{numerator:'4250',denominator:1000});
 assert.equal(Object.hasOwn(s.settings,'sheetPatterns'),false);assert.equal(JSON.stringify(s),before);
});

// Saving changes the technical-sheet history, never operational history.
test('append adds one version and preserves all old records, unknown fields and unrelated state',()=>{
 const s=freeze(state()),v=freeze(candidate()),before=JSON.stringify(s),vBefore=JSON.stringify(v),next=UI.appendVersion(s,REF,v);
 assert.notEqual(next,s);assert.deepEqual(next.settings.techSheets[REF].versions,[current(s),v]);
 const expected=clone(s);expected.settings.techSheets[REF].versions.push(clone(v));assert.deepEqual(next,expected);
 assert.equal(JSON.stringify(s),before);assert.equal(JSON.stringify(v),vBefore);
});
test('the appended input is copied so later form edits cannot alter the saved candidate',()=>{
 const s=freeze(state()),v=candidate(),next=UI.appendVersion(s,REF,v),saved=JSON.stringify(next);
 v.note='Changed';v.items[0].colorMap.changed='Changed';v.items[0].extraItem.preserve.push('Changed');v.extraVersion.preserve.push('Changed');
 assert.equal(JSON.stringify(next),saved);
});
test('append can initialize only a missing technical-sheet branch while keeping other settings',()=>{
 const s=state();delete s.settings.techSheets;freeze(s);const before=JSON.stringify(s),v=freeze(candidate()),next=UI.appendVersion(s,REF,v);
 const expected=clone(s);expected.settings.techSheets={[REF]:{ref:REF,versions:[clone(v)]}};
 assert.deepEqual(next,expected);assert.equal(JSON.stringify(s),before);
});
test('an identical retry is idempotent and never appends a duplicate version',()=>{
 const v=freeze(candidate()),once=UI.appendVersion(freeze(state()),REF,v),before=JSON.stringify(freeze(once));
 const twice=UI.appendVersion(once,REF,clone(v));
 assert.deepEqual(twice,once);assert.equal(twice.settings.techSheets[REF].versions.length,2);assert.equal(JSON.stringify(once),before);
});
test('same version ID with changed contents is rejected instead of editing history',()=>{
 const once=freeze(UI.appendVersion(state(),REF,candidate())),before=JSON.stringify(once);
 for(const patch of [{note:'Changed'},{validFrom:'2026-08-01'},{salePriceMills:0},{createdAt:NOW},{extraVersion:{changed:true}}])assert.throws(()=>UI.appendVersion(once,REF,candidate(patch)));
 assert.equal(JSON.stringify(once),before);
});
test('different version IDs cannot share a start date, including exact duplicates by content',()=>{
 const s=freeze(state()),before=JSON.stringify(s);
 code(()=>UI.appendVersion(s,REF,candidate({validFrom:FROM})),['duplicate_version_date']);
 assert.equal(JSON.stringify(s),before);
});
test('retroactive and future additions preserve insertion history and engine date selection',()=>{
 const initial=freeze(state()),past=candidate({id:'retroactive',validFrom:'2026-01-01',salePriceMills:1000}),future=candidate({id:'future',validFrom:'2027-01-01',salePriceMills:9000});
 const next=UI.appendVersion(UI.appendVersion(initial,REF,past),REF,future);
 assert.deepEqual(next.settings.techSheets[REF].versions.map(row=>row.id),['version-fiction','retroactive','future']);
 assert.equal(T.applicableVersion(next,REF,'2026-02-01').id,'retroactive');assert.equal(T.applicableVersion(next,REF,DATE).id,'version-fiction');assert.equal(T.applicableVersion(next,REF,'2027-01-01').id,'future');
});
for(const date of ['',null,undefined,'2026-02-30','2026-2-01','0000-01-01'])test('append rejects invalid explicit start date '+String(date),()=>assert.throws(()=>UI.appendVersion(freeze(state()),REF,candidate({validFrom:date}))));
for(const id of ['',null,undefined,' leading','trailing ','x'.repeat(151)])test('append rejects invalid version ID '+String(id),()=>assert.throws(()=>UI.appendVersion(freeze(state()),REF,candidate({id}))));
for(const quantity of ['',null,0,'0','-1','1e3','0.0001','1.000,001'])test('append rejects invalid or zero consumption '+String(quantity),()=>{
 assert.throws(()=>UI.appendVersion(freeze(state()),REF,candidate({items:[item({qtyPerPair:quantity})]})));
});
test('append rejects duplicate item IDs and repeated material/label positions',()=>{
 for(const second of [item({label:'Outra posição'}),item({id:'another-item',label:'  POSIÇÃO   FICTÍCIA '})]){
  assert.throws(()=>UI.appendVersion(freeze(state()),REF,candidate({items:[item(),second]})));
 }
 const next=UI.appendVersion(freeze(state()),REF,candidate({items:[item(),item({id:'another-item',label:'Outra posição'})]}));
 assert.equal(next.settings.techSheets[REF].versions[1].items.length,2);
});
test('append rejects malformed or incomplete group overrides rather than using base quantity',()=>{
 for(const map of [{},{'35-37':'0.5'},{'35-37':'0.5','38-39':'0'},{'35-37':'0.5','38-39':'1','40-41':'1'},[]])assert.throws(()=>UI.appendVersion(freeze(state()),REF,candidate({sizeGroups:['35-37','38-39'],items:[item({qtyBySizeGroup:map})]})));
});
test('explicit zero material and sale prices are valid, with undefined margin pending',()=>{
 const s=state();s.settings.materials[0].prices[0].unitPriceMills=0;
 const v=candidate({salePriceMills:M.parsePriceMills('0,000')}),next=UI.appendVersion(freeze(s),REF,freeze(v)),r=T.calculateTechSheet(next,{ref:REF,date:NEXT});
 assert.equal(r.costPerPairMills,0);assert.equal(r.costPerSheetMills,0);assert.equal(r.salePerSheetMills,0);assert.equal(r.profitPerSheetMills,0);assert.equal(r.marginPercent,null);has(r,'zero_sale_margin');
});
for(const sale of [null,-1,1.5,'1',NaN,Infinity,Number.MAX_SAFE_INTEGER+1])test('append rejects invalid supplied sale price '+String(sale),()=>{
 assert.throws(()=>UI.appendVersion(freeze(state()),REF,candidate({salePriceMills:sale})));
});
test('missing sale stays pending in preview and blocks append without inventing a default',()=>{
 const s=freeze(state()),v=candidate();delete v.salePriceMills;freeze(v);const before=JSON.stringify(s);
 const r=UI.project(s,REF,v,NEXT);assert.equal(r.costPerSheetMills,108000);
 assert.equal(r.salePerSheetMills,null);assert.equal(r.profitPerSheetMills,null);has(r,'missing_sale_price');
 code(()=>UI.appendVersion(s,REF,v),['missing_sale_price']);assert.equal(Object.hasOwn(v,'salePriceMills'),false);assert.equal(JSON.stringify(s),before);
});
test('active material without a current price may be saved with pending valuation',()=>{
 for(const prices of [[],[{id:'future-price',from:'2027-01-01',unitPriceMills:1800,note:''}]]){
  const s=state();s.settings.materials[0].prices=prices;freeze(s);const before=JSON.stringify(s),v=freeze(candidate());
  const preview=UI.project(s,REF,v,NEXT),next=UI.appendVersion(s,REF,v),saved=T.calculateTechSheet(next,{ref:REF,date:NEXT});
  has(preview,'missing_price');has(saved,'missing_price');assert.equal(saved.costPerSheetMills,null);assert.equal(next.settings.techSheets[REF].versions.length,2);assert.equal(JSON.stringify(s),before);
 }
});
test('inactive linked material is visible as pending in preview but blocks append',()=>{
 const s=state();s.settings.materials[0].active=false;freeze(s);const before=JSON.stringify(s),v=freeze(candidate()),preview=UI.project(s,REF,v,NEXT);
 has(preview,'inactive_material');assert.equal(preview.costPerSheetMills,null);code(()=>UI.appendVersion(s,REF,v),['inactive_material']);assert.equal(JSON.stringify(s),before);
});
test('unknown and ambiguous linked materials block append, but unrelated inactive materials do not',()=>{
 const missing=state();missing.settings.materials=[];assert.throws(()=>UI.appendVersion(freeze(missing),REF,candidate()));
 const duplicate=state();duplicate.settings.materials.push(clone(duplicate.settings.materials[0]));assert.throws(()=>UI.appendVersion(freeze(duplicate),REF,candidate()));
 const unrelated=state();unrelated.settings.materials.push(material({id:'unused-material',active:false,prices:[]}));
 assert.equal(UI.appendVersion(freeze(unrelated),REF,candidate()).settings.techSheets[REF].versions.length,2);
});
test('grouped consumption may be saved without a grade; aggregate weighted totals stay pending',()=>{
 const s=freeze(state()),v=freeze(candidate({sizeGroups:['35-37','38-39'],items:[item({qtyBySizeGroup:{'35-37':'0.5','38-39':'1'}})]}));
 const preview=UI.project(s,REF,v,NEXT),next=UI.appendVersion(s,REF,v),saved=T.calculateTechSheet(next,{ref:REF,date:NEXT});
 assert.equal(preview.complete,true);assert.equal(preview.valuationComplete,false);assert.equal(preview.costPerSheetMills,null);assert.equal(preview.costPerPairMills,null);
 assert.deepEqual(preview.sizeGroups.map(row=>row.costPerPairMills),[1200,2400]);assert.deepEqual(saved,preview);
 assert.equal(Object.hasOwn(next.settings,'sheetPatterns'),false);
});
test('configured 48/24 grade uses weighted costs from the engine when previewing an append',()=>{
 const s=state();s.settings.sheetPatterns={version:1,templates:[{scope:'ref',target:REF,line:'900',total:72,rows:[{color:'Azul fictício',sizeBreakdown:{'35':0,'36':0,'37':48,'38':24,'39':0}}]}]};
 const v=candidate({sizeGroups:['35-37','38-39'],items:[item({qtyBySizeGroup:{'35-37':'0.5','38-39':'1'}})]});
 const r=UI.project(freeze(s),REF,freeze(v),NEXT);
 assert.equal(r.costPerPairMills,1600);assert.equal(r.costPerSheetMills,115200);assert.notEqual(r.costPerPairMills,1800);
});

test('an undated draft can be previewed on an explicit date but cannot yet be appended',()=>{
 const s=freeze(state()),v=freeze(UI.draft(s,REF,DATE,'draft-undated',LATER)),before=JSON.stringify(s);
 const r=UI.project(s,REF,v,DATE);
 assert.equal(r.costPerPairMills,1500);assert.equal(r.date,DATE);assert.equal(r.versionId,'draft-undated');
 assert.equal(v.validFrom,'');code(()=>UI.appendVersion(s,REF,v),['invalid_date']);assert.equal(JSON.stringify(s),before);
});
test('projection uses the chosen date for material price, independently of draft version start',()=>{
 const s=state();s.settings.materials[0].prices.push({id:'later-price',from:'2026-08-01',unitPriceMills:4000,note:''});
 const v=freeze(candidate()),before=JSON.stringify(freeze(s));
 assert.equal(UI.project(s,REF,v,NEXT).costPerPairMills,1500);
 assert.equal(UI.project(s,REF,v,'2026-08-01').costPerPairMills,2500);
 assert.equal(v.validFrom,NEXT);assert.equal(JSON.stringify(s),before);
});
test('append rejects empty items, invalid group sets and invalid audit timestamps',()=>{
 const patches=[{items:[]},{items:null},{items:[null]},{sizeGroups:null},{sizeGroups:['35-37']},{sizeGroups:['35-37','35-37']},
  {createdAt:''},{createdAt:null},{createdAt:'2026-02-30T12:00:00Z'},{createdAt:'2026-06-15'},{createdAt:'2026-06-15T13:00:00-03:00'},
  {note:1},{note:'x'.repeat(1001)}];
 for(const patch of patches){const s=freeze(state()),before=JSON.stringify(s);assert.throws(()=>UI.appendVersion(s,REF,candidate(patch)),JSON.stringify(patch));assert.equal(JSON.stringify(s),before)}
});

// Money formatting retains every stored mill. Item costs can need six decimal
// places because the engine's exact numerator also contains quantity's scale.
for(const [mills,expected] of [[0,'R$ 0,000'],[1,'R$ 0,001'],[1234,'R$ 1,234'],[1000001,'R$ 1.000,001'],[-1,'-R$ 0,001'],[-1234,'-R$ 1,234'],[Number.MAX_SAFE_INTEGER,'R$ 9.007.199.254.740,991'],[Number.MIN_SAFE_INTEGER,'-R$ 9.007.199.254.740,991']])test('formatMoney preserves exact mills '+mills,()=>assert.equal(UI.formatMoney(mills),expected));
for(const value of [null,undefined,NaN,Infinity,1.5,'1234',Number.MAX_SAFE_INTEGER+1])test('formatMoney renders invalid or missing input as pending '+String(value),()=>assert.equal(UI.formatMoney(value),'A conferir'));
for(const [numerator,expected] of [['0','R$ 0,000'],['1','R$ 0,000001'],['10','R$ 0,00001'],['100','R$ 0,0001'],['1000','R$ 0,001'],['4250','R$ 0,00425'],['1234567','R$ 1,234567'],['1000001000','R$ 1.000,001'],['9007199254740991000','R$ 9.007.199.254.740,991'],['81129638414606663681390495662081','R$ 81.129.638.414.606.663.681.390.495,662081']])test('formatExact avoids float rounding for numerator '+numerator,()=>assert.equal(UI.formatExact({numerator,denominator:1000}),expected));
test('malformed exact costs remain pending rather than becoming apparent zero',()=>{
 for(const exact of [null,undefined,{},[],{numerator:0,denominator:1000},{numerator:'1',denominator:1},{numerator:'1.5',denominator:1000},{numerator:'-1',denominator:1000},{numerator:'1e6',denominator:1000}])assert.equal(UI.formatExact(exact),'A conferir');
});
test('decimal sale input is parsed by materials at exact mill precision before append',()=>{
 const v=candidate({salePriceMills:M.parsePriceMills('4,501')}),next=UI.appendVersion(freeze(state()),REF,v);
 assert.equal(next.settings.techSheets[REF].versions[1].salePriceMills,4501);
 assert.equal(UI.project(next,REF,v,NEXT).salePerSheetMills,324072);
 for(const value of ['',null,'1e3','4,5011','4.501,000','-1'])assert.throws(()=>M.parsePriceMills(value));
});

test('delta is after minus before for separately rounded engine aggregates',()=>{
 const s=state();s.settings.materials[0].prices[0].unitPriceMills=1;
 const before=UI.project(s,REF,candidate({items:[item({qtyPerPair:'0.4'})]}),NEXT);
 const after=UI.project(s,REF,candidate({items:[item({qtyPerPair:'0.8'})]}),NEXT);
 const beforeJSON=JSON.stringify(freeze(before)),afterJSON=JSON.stringify(freeze(after));
 assert.deepEqual(UI.delta(before,after),{costPerPairMills:1,costPerSheetMills:29});
 assert.notEqual(UI.delta(before,after).costPerSheetMills,UI.delta(before,after).costPerPairMills*72);
 assert.deepEqual(UI.delta(after,before),{costPerPairMills:-1,costPerSheetMills:-29});
 assert.equal(JSON.stringify(before),beforeJSON);assert.equal(JSON.stringify(after),afterJSON);
});
test('identical projections have explicit zero deltas',()=>{
 const r=freeze(UI.project(state(),REF,candidate(),NEXT));assert.deepEqual(UI.delta(r,r),{costPerPairMills:0,costPerSheetMills:0});
});
test('incomplete or unavailable aggregates produce null delta independently per field',()=>{
 for(const invalid of [null,undefined,NaN,Infinity,1.5,'1',Number.MAX_SAFE_INTEGER+1]){
  assert.deepEqual(UI.delta({costPerPairMills:invalid,costPerSheetMills:10},{costPerPairMills:15,costPerSheetMills:20}),{costPerPairMills:null,costPerSheetMills:10});
  assert.deepEqual(UI.delta({costPerPairMills:15,costPerSheetMills:10},{costPerPairMills:invalid,costPerSheetMills:20}),{costPerPairMills:null,costPerSheetMills:10});
 }
 for(const missing of [null,undefined,{}])assert.deepEqual(UI.delta(missing,{}),{costPerPairMills:null,costPerSheetMills:null});
 const s=state();s.settings.materials[0].prices=[];const pending=UI.project(s,REF,candidate(),NEXT),complete=UI.project(state(),REF,candidate(),NEXT);
 assert.deepEqual(UI.delta(complete,pending),{costPerPairMills:null,costPerSheetMills:null});
 assert.deepEqual(UI.delta(pending,complete),{costPerPairMills:null,costPerSheetMills:null});
});
test('delta retains integer precision and rejects differences outside the safe range',()=>{
 assert.deepEqual(UI.delta({costPerPairMills:Number.MAX_SAFE_INTEGER-1,costPerSheetMills:0},{costPerPairMills:Number.MAX_SAFE_INTEGER,costPerSheetMills:Number.MAX_SAFE_INTEGER}),{costPerPairMills:1,costPerSheetMills:Number.MAX_SAFE_INTEGER});
 assert.deepEqual(UI.delta({costPerPairMills:Number.MIN_SAFE_INTEGER,costPerSheetMills:Number.MAX_SAFE_INTEGER},{costPerPairMills:1,costPerSheetMills:-1}),{costPerPairMills:null,costPerSheetMills:null});
});
