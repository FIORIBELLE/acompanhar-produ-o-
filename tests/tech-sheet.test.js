'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const T=require('../tech-sheet'),M=require('../material-catalog');
const DATE='2026-04-15',NOW='2026-04-01T12:00:00.000Z';
const clone=value=>JSON.parse(JSON.stringify(value));
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}
function material(id,category,price){return {id,name:'Componente fictício '+id,category,unit:'un',variantByColor:false,active:true,createdAt:NOW,updatedAt:NOW,prices:[{id:id+'-price',from:'2026-04-01',unitPriceMills:price,note:'Simulação sintética'}]}}
function item(id,materialId,qty='1',extra={}){return {id,materialId,label:'Posição fictícia '+id,qtyPerPair:qty,qtyBySizeGroup:null,colorMap:null,...extra}}
function grid(first=48,second=24){return [{color:'Azul Sintético',sizeBreakdown:{'35':0,'36':0,'37':first,'38':second,'39':0}}]}
function version(extra={}){return {id:'version-synthetic',validFrom:'2026-04-01',sizeGroups:['35-37','38-39'],items:[item('position-a','synthetic-a'),item('position-b','synthetic-b','0.46'),item('position-c','synthetic-c','0.68',{qtyBySizeGroup:{'35-37':'0.68','38-39':'0.74'}}),item('position-d','synthetic-d')],salePriceMills:63900,note:'Ficha fictícia para teste',createdAt:NOW,...extra}}
function state(){return {settings:{models:[{id:'synthetic-model',ref:'901',line:'900',name:'Modelo fictício'}],materials:[material('synthetic-a','outro',31200),material('synthetic-b','tira',22000),material('synthetic-c','tira',12000),material('synthetic-d','enfeite',1200)],techSheets:{'901':{ref:'901',versions:[version()]}},sheetPatterns:{version:1,templates:[{scope:'line',target:'900',line:'900',total:72,rows:grid()}]}},weeks:{'2026-04-13':{goal:144,entries:[],retained:'historical'}},salesOrders:[],salesPayments:[],factoryExpenses:[],stockLedger:[],futureState:{retained:[1,2,3]}}}
function current(s){return s.settings.techSheets['901'].versions[0]}
function calculate(s=state(),extra={}){return T.calculateTechSheet(s,{ref:'901',date:DATE,...extra})}
function uniform(price=1,qty='1',sale=100){const s=state();s.settings.materials=[material('synthetic-a','outro',price)];current(s).sizeGroups=[];current(s).items=[item('single','synthetic-a',qty)];current(s).salePriceMills=sale;delete s.settings.sheetPatterns;return s}
function has(result,code){assert.ok(result.issues.some(issue=>issue.code===code),JSON.stringify(result.issues))}

// All monetary terms use a common synthetic scale; quantities are also
// reparameterized so no factory price or consumption is embedded here.
// The 48/24 weights and 72-pair denominator preserve the arithmetic topology.
test('synthetic scaled audit: different band costs, 48/24 weighted 72-pair sheet, sales, profit and margin',()=>{
 const s=freeze(state()),before=JSON.stringify(s),r=calculate(s);
 assert.equal(r.complete,true);assert.equal(r.valuationComplete,true);assert.equal(r.financialComplete,true);assert.equal(r.status,'ok');assert.deepEqual(r.issues,[]);
 assert.deepEqual(r.distribution.groups,[{sizeGroup:'35-37',pairs:48},{sizeGroup:'38-39',pairs:24}]);
 assert.deepEqual(r.sizeGroups.map(row=>row.costPerPairMills),[50680,51400]);
 assert.equal(r.costPerPairMills,50920);assert.notEqual(r.costPerPairMills,(50680+51400)/2);
 assert.equal(r.costPerSheetMills,3666240);assert.equal(r.salePerSheetMills,4600800);
 assert.equal(r.profitPerPairMills,12980);assert.equal(r.profitPerSheetMills,934560);
 assert.equal(r.marginPercent,12980/63900*100);assert.equal(Number(r.marginPercent.toFixed(1)),20.3);
 assert.equal(r.items[2].costs[0].costMillsExact.numerator,'8160000');
 assert.equal(r.items[2].costs[1].costMillsExact.numerator,'8880000');
 const byCategory=Object.fromEntries(r.composition.map(row=>[row.category,row]));
 assert.equal(byCategory.tira.costPerPairMills,18520);assert.equal(byCategory.tira.costPerSheetMills,1333440);
 assert.equal(r.composition.reduce((sum,row)=>sum+row.costPerSheetMills,0),r.costPerSheetMills);
 assert.ok(Math.abs(r.composition.reduce((sum,row)=>sum+row.sharePercent,0)-100)<1e-10);
 assert.equal(JSON.stringify(s),before);
});
test('UMD is inert and exposes the same pure API with existing read-only dependencies',()=>{
 const context=vm.createContext({});
 for(const name of ['inventory-guard','material-catalog','standard-sheet','tech-sheet'])vm.runInContext(fs.readFileSync(require.resolve('../'+name),'utf8'),context);
 assert.deepEqual(Object.keys(context.FioriTechSheets),Object.keys(T));
 assert.equal(context.FioriTechSheets.calculateTechSheet(freeze(state()),{ref:'901',date:DATE}).costPerSheetMills,3666240);
 const empty=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../tech-sheet'),'utf8'),empty);
 assert.equal(empty.FioriTechSheets.calculateTechSheet({},{}).status,'a_conferir');
});
test('the new module is not loaded by the application or used by legacy costing modules',()=>{
 for(const name of ['index.html','general-dashboard.js','inventory-guard.js','assembly-finance.js'])assert.doesNotMatch(fs.readFileSync(require.resolve('../'+name),'utf8'),/FioriTechSheets|tech-sheet\.js/);
});
for(const [quantity,expected] of [['1',1000],['0.001',1],['1,234',1234],[' 002.010 ',2010],['9007199254740.991',Number.MAX_SAFE_INTEGER]])test('exact positive quantity '+quantity,()=>assert.equal(T.parseQuantityThousandths(quantity),expected));
for(const quantity of [null,undefined,0,1,true,{},[],'',' ','0','0.000','-0','-1','+1','1e3','1.2345','.5','1.','1,000.000','1 000','9007199254740.992','Infinity'])test('invalid quantity '+String(quantity),()=>{
 assert.throws(()=>T.parseQuantityThousandths(quantity));const s=state();current(s).items[0].qtyPerPair=quantity;const r=calculate(s);
 assert.equal(r.complete,false);assert.equal(r.costPerPairMills,null);assert.equal(r.costPerSheetMills,null);has(r,'invalid_quantity');
});
test('version selection uses latest reached validFrom independently of insertion order and creation time',()=>{
 const s=state(),v=current(s);s.settings.techSheets['901'].versions=[version({id:'future',validFrom:'2027-01-01'}),v,version({id:'old',validFrom:'2025-01-01'})];
 assert.equal(T.applicableVersion(s,'901',DATE).id,v.id);
 assert.equal(T.applicableVersion(s,'901','2027-01-01').id,'future');
 assert.equal(T.applicableVersion(s,'901','2024-12-31'),null);
 const selected=T.applicableVersion(s,'901',DATE);selected.items[0].label='Changed';assert.notEqual(v.items[0].label,'Changed');
});
test('future-only and legacy references stay missing without seeding, fallback costs or state mutation',()=>{
 for(const s of [{},{settings:{}},{settings:{techSheets:{}}},state()]){
  if(s.settings?.techSheets?.['901'])current(s).validFrom='2027-01-01';freeze(s);const before=JSON.stringify(s),r=calculate(s);
  has(r,'missing_version');assert.equal(r.costPerPairMills,null);assert.equal(JSON.stringify(s),before);
 }
});
test('duplicate version ID or start date is ambiguous, never tie-broken',()=>{
 for(const extra of [{id:'another'},{validFrom:'2025-01-01'}]){const s=state();s.settings.techSheets['901'].versions.push(version(extra));has(calculate(s),'ambiguous_version')}
});
for(const date of ['2026-02-30','0000-01-01','2026-4-01',null,undefined])test('invalid query date '+date,()=>{const r=calculate(state(),{date});has(r,'invalid_date');assert.equal(r.costPerSheetMills,null)});
test('prices are selected as-of date, including retroactive and future price boundaries',()=>{
 const s=state(),m=s.settings.materials[0];m.prices=[{id:'later',from:'2026-05-01',unitPriceMills:44000,note:''},...m.prices,{id:'earlier',from:'2026-01-01',unitPriceMills:21000,note:''}];
 assert.equal(calculate(s).items[0].unitPriceMills,31200);
 assert.equal(calculate(s,{date:'2026-05-01'}).items[0].unitPriceMills,44000);
 assert.equal(T.calculateItemCost(s,current(s).items[0],'2026-02-01').unitPriceMills,21000);
});
test('price corrections use the existing terminal correction chain, without rewriting history',()=>{
 let s=state();s=M.correctPrice(s,'synthetic-a',{id:'correction-a',supersedesPriceId:'synthetic-a-price',from:'2026-04-01',unitPriceMills:33000,note:'Synthetic correction',correctedAt:'2026-04-02T12:00:00Z',updatedAt:'2026-04-02T12:00:00Z'});
 s=M.correctPrice(s,'synthetic-a',{id:'correction-b',supersedesPriceId:'correction-a',from:'2026-04-01',unitPriceMills:0,note:'Synthetic correction',correctedAt:'2026-04-03T12:00:00Z',updatedAt:'2026-04-03T12:00:00Z'});
 const before=JSON.stringify(freeze(s)),r=calculate(s,{date:'2026-04-01'});
 assert.equal(r.items[0].priceId,'correction-b');assert.equal(r.items[0].unitPriceMills,0);assert.equal(r.items[0].complete,true);assert.equal(JSON.stringify(s),before);
});
test('broken and branching correction histories cannot produce a usable price',()=>{
 for(const supersedesPriceId of ['absent','synthetic-a-price']){
  const s=state(),m=s.settings.materials[0];m.updatedAt='2026-04-03T12:00:00Z';
  m.prices.push({id:'correction',from:'2026-04-01',unitPriceMills:99,note:'',supersedesPriceId,correctedAt:'2026-04-02T12:00:00Z'});
  if(supersedesPriceId!=='absent')m.prices.push({...m.prices[1],id:'branch',correctedAt:'2026-04-03T12:00:00Z'});
  const r=calculate(s);assert.equal(r.items[0].complete,false);assert.equal(r.costPerSheetMills,null);
 }
});
test('all missing item details are returned and no incomplete item or category is valued as zero',()=>{
 const s=state();s.settings.materials[0].active=false;s.settings.materials[1].prices=[];current(s).items[2].qtyBySizeGroup={'35-37':'0.68'};current(s).items[3].materialId='missing';
 const r=calculate(s);for(const code of ['inactive_material','missing_price','missing_group_quantity','missing_material'])has(r,code);
 assert.deepEqual([...new Set(r.issues.filter(issue=>issue.itemIndex!==undefined).map(issue=>issue.itemIndex))],[0,1,2,3]);
 assert.equal(r.costPerPairMills,null);assert.equal(r.costPerSheetMills,null);assert.equal(r.profitPerSheetMills,null);
 assert.ok(r.items.every(item=>item.costs.every(cost=>cost.costMillsExact===null)));
 assert.ok(r.composition.every(row=>row.sizeGroups.every(group=>group.costPerPairMills===null)));
 assert.equal(r.salePerSheetMills,4600800);
});
test('duplicate material IDs are rejected, inactive unrelated materials do not invalidate a linked sheet',()=>{
 const s=state();s.settings.materials.push({...material('unused','outro',5),active:false});assert.equal(calculate(s).complete,true);
 s.settings.materials.push(clone(s.settings.materials[0]));const r=calculate(s);has(r,'ambiguous_material');assert.equal(r.costPerPairMills,null);
});
test('repeating a material requires both distinct item IDs and distinct labels',()=>{
 const s=state(),a=current(s).items[0];current(s).items.push({...a,id:'other',label:'Another position'});assert.equal(calculate(s).complete,true);
 current(s).items[4].label='  '+a.label.toUpperCase()+'  ';has(calculate(s),'duplicate_material_label');
 current(s).items[4].label='Another position';current(s).items[4].id=a.id;has(calculate(s),'duplicate_item_id');
});
test('uniform quantities apply to both groups; informative color maps do not change quantities or prices',()=>{
 const s=state(),before=calculate(s);for(const item of current(s).items)item.colorMap={'Azul Sintético':'Etiqueta auxiliar','Verde Sintético':'Outra etiqueta'};
 assert.deepEqual(calculate(s),before);
});
test('a partial or extra quantity map never falls back to qtyPerPair',()=>{
 for(const map of [{},{'35-37':'0.5'},{'35-37':'0.5','38-39':'0.6','40-41':'1'},{'35-37':'0','38-39':'0.6'},[]]){
  const s=state();current(s).items[0].qtyBySizeGroup=map;const r=calculate(s);assert.equal(r.complete,false);assert.equal(r.items[0].costs[0].costMillsExact,null);assert.equal(r.costPerSheetMills,null);
 }
});
test('declared size groups must be empty or exactly the two supported bands',()=>{
 for(const sizeGroups of [null,{},['35-37'],['35-37','35-37'],['34-37','38-39'],['35-37','38-39','other']]){const s=state();current(s).sizeGroups=sizeGroups;has(calculate(s),'invalid_size_groups')}
 const s=state();current(s).sizeGroups.reverse();assert.equal(calculate(s).costPerSheetMills,3666240);
});
test('unconfigured grouped sheets retain band costs but do not invent a mean or implicit line default',()=>{
 for(const ref of ['301','501','601','901']){
  const s=state();delete s.settings.sheetPatterns;s.settings.models=[];s.settings.techSheets={[ref]:{ref,versions:[version()]}};
  const r=calculate(s,{ref});assert.equal(r.complete,true);assert.equal(r.valuationComplete,false);assert.equal(r.status,'a_conferir');assert.equal(r.costPerPairMills,null);assert.equal(r.costPerSheetMills,null);assert.deepEqual(r.sizeGroups.map(row=>row.costPerPairMills),[50680,51400]);
 }
});
test('reference pattern takes priority over a line pattern and actual grid takes priority over both',()=>{
 const s=state();s.settings.sheetPatterns.templates.push({scope:'ref',target:'901',line:'900',rows:grid(24,48),total:72});
 const ref=calculate(s);assert.equal(ref.distribution.source,'custom:ref');assert.equal(ref.costPerPairMills,51160);
 const actual=calculate(s,{rows:grid(60,12)});assert.equal(actual.distribution.source,'actual');assert.equal(actual.costPerPairMills,50800);
});
test('weights come from every size cell in every color, including valid zero-weight groups',()=>{
 const s=state();const rows=[{color:'Azul Sintético',sizeBreakdown:{'35':4,'36':8,'37':12,'38':6,'39':6}},{color:'Verde Sintético',sizeBreakdown:{'35':12,'36':6,'37':6,'38':3,'39':9}}];
 assert.equal(calculate(s,{rows}).costPerPairMills,50920);
 assert.equal(calculate(s,{rows:grid(72,0)}).costPerPairMills,50680);
 assert.equal(calculate(s,{rows:grid(0,72)}).costPerPairMills,51400);
});
test('missing, ambiguous and invalid configured grades cannot be normalized into valid financial totals',()=>{
 for(const change of [s=>s.settings.sheetPatterns=null,s=>s.settings.sheetPatterns.templates.push(clone(s.settings.sheetPatterns.templates[0])),s=>s.settings.sheetPatterns.templates[0].total=71,s=>s.settings.sheetPatterns.templates[0].rows=grid(48,23)]){
  const s=state();change(s);const r=calculate(s);assert.equal(r.complete,true);assert.equal(r.valuationComplete,false);assert.equal(r.costPerSheetMills,null);assert.ok(r.issues.some(row=>row.scope==='distribution'));
 }
});
for(const rows of [null,[],grid(48,23),grid(48,25),grid(48.5,23.5),grid(-1,73),[{color:'Azul Sintético',sizeBreakdown:{'34':72}}],[{color:'Azul Sintético',qty:71,sizeBreakdown:{'37':72}}]])test('invalid actual grade '+JSON.stringify(rows),()=>{
 const r=calculate(state(),{rows});assert.equal(r.distribution,null);assert.equal(r.costPerSheetMills,null);assert.equal(r.profitPerSheetMills,null);
});
test('a constant consumption needs no pattern and does not add a pattern to settings',()=>{
 const s=freeze(uniform(17,'0.25',50)),before=JSON.stringify(s),r=calculate(s);
 assert.equal(r.distribution.source,'uniform');assert.equal(r.costPerPairMills,4);assert.equal(r.costPerSheetMills,306);assert.equal(r.profitPerSheetMills,3294);assert.equal(JSON.stringify(s),before);
});
test('quantity maps require declared bands even when empty',()=>{const s=uniform();current(s).items[0].qtyBySizeGroup={};has(calculate(s),'invalid_quantity_map')});
test('round only each aggregate: fractional item costs survive summing, weighting and sheet multiplication',()=>{
 const s=uniform(1,'0.4',2);current(s).items.push(item('second','synthetic-a','0.4',{label:'Second use'}));const r=calculate(s);
 assert.equal(r.items[0].costs[0].costMillsExact.numerator,'400');assert.equal(r.costPerPairMills,1);assert.equal(r.costPerSheetMills,58);assert.notEqual(r.costPerSheetMills,r.costPerPairMills*72);
 assert.equal(r.profitPerPairMills,1);assert.equal(r.profitPerSheetMills,86);assert.equal(r.marginPercent,60);
 const grouped=uniform(1,'0.1',1);current(grouped).sizeGroups=['35-37','38-39'];current(grouped).items[0].qtyBySizeGroup={'35-37':'0.1','38-39':'0.7'};
 const weighted=calculate(grouped,{rows:grid()});assert.deepEqual(weighted.sizeGroups.map(row=>row.costPerPairMills),[0,1]);assert.equal(weighted.costPerPairMills,0);assert.equal(weighted.costPerSheetMills,22);assert.equal(weighted.profitPerSheetMills,50);
});
test('negative profit is allowed, with half-away-from-zero rounding and no premature rounding of costs',()=>{
 const r=calculate(uniform(3,'0.5',1));assert.equal(r.costPerPairMills,2);assert.equal(r.profitPerPairMills,-1);assert.equal(r.profitPerSheetMills,-36);assert.equal(r.marginPercent,-50);
});
test('explicit zero input prices and zero sales remain valid, while margin with zero revenue stays null',()=>{
 const r=calculate(uniform(0,'1',0));assert.equal(r.complete,true);assert.equal(r.valuationComplete,true);assert.equal(r.costPerSheetMills,0);assert.equal(r.salePerSheetMills,0);assert.equal(r.profitPerSheetMills,0);assert.equal(r.marginPercent,null);assert.equal(r.composition[0].sharePercent,null);assert.equal(r.financialComplete,false);has(r,'zero_sale_margin');
});
test('missing and invalid sale prices preserve complete costs but never fabricate revenue or profit',()=>{
 for(const sale of [undefined,null,-1,1.2,'1',NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
  const s=uniform();if(sale===undefined)delete current(s).salePriceMills;else current(s).salePriceMills=sale;
  const r=calculate(s);assert.equal(r.complete,true);assert.equal(r.valuationComplete,true);assert.equal(r.financialComplete,false);assert.equal(r.salePerSheetMills,null);assert.equal(r.profitPerSheetMills,null);assert.equal(r.marginPercent,null);
 }
});
test('BigInt intermediates retain exact products beyond safe Number multiplication',()=>{
 const s=uniform(Number.MAX_SAFE_INTEGER,'0.001',0),r=calculate(s);
 assert.equal(r.items[0].costs[0].costMillsExact.numerator,String(Number.MAX_SAFE_INTEGER));
 const exact=BigInt(Number.MAX_SAFE_INTEGER)*72n;assert.equal(r.costPerSheetMills,Number((exact+500n)/1000n));assert.equal(r.costPerPairMills,9007199254741);
});
test('aggregate cost or revenue overflow returns null, never a rounded unsafe Number',()=>{
 const r=calculate(uniform(Number.MAX_SAFE_INTEGER,'1',1));assert.equal(r.costPerSheetMills,null);assert.equal(r.valuationComplete,false);assert.equal(r.profitPerSheetMills,null);assert.equal(r.composition[0].complete,false);assert.equal(r.composition[0].costPerSheetMills,null);has(r,'money_overflow');
 const sale=calculate(uniform(1,'1',Number.MAX_SAFE_INTEGER));assert.equal(sale.salePerSheetMills,null);assert.equal(sale.profitPerSheetMills,null);assert.equal(sale.financialComplete,false);has(sale,'money_overflow');
});
test('repeated reads and mutable output projections do not mutate unrelated or legacy state',()=>{
 const s=freeze(state()),before=JSON.stringify(s);for(let n=0;n<5;n++){
  const r=calculate(s);r.items[0].label='Changed';r.distribution.groups[0].pairs=1;r.composition[0].category='Changed';
 }
 assert.equal(JSON.stringify(s),before);assert.equal(calculate(s).costPerSheetMills,3666240);
});
test('malformed JSON shapes produce structured pending results, not exceptions or zero',()=>{
 for(const s of [null,[],{settings:null},{settings:{techSheets:[]}},{settings:{techSheets:{'901':null}}},{settings:{techSheets:{'901':{ref:'902',versions:[]}}}}]){const r=calculate(s);assert.equal(r.status,'a_conferir');assert.equal(r.costPerSheetMills,null);assert.ok(r.issues.length)}
 for(const patch of [{items:[]},{items:null},{items:[null]}]){const s=state();Object.assign(current(s),patch);const r=calculate(s);assert.equal(r.complete,false);assert.equal(r.costPerSheetMills,null)}
 assert.equal(T.calculateTechSheet(state(),null).costPerSheetMills,null);
});


test('optional labels, maps and audit metadata are not required to calculate',()=>{
 const s=state();for(const row of current(s).items){delete row.label;delete row.colorMap;if(row.qtyBySizeGroup===null)delete row.qtyBySizeGroup}
 delete current(s).note;delete current(s).createdAt;
 const r=calculate(s);assert.equal(r.complete,true);assert.equal(r.costPerSheetMills,3666240);assert.equal(r.items[0].label,null);
});
test('a complete band override replaces a missing or invalid base quantity',()=>{
 for(const base of [undefined,null,'0','not used']){const s=state();current(s).items[2].qtyPerPair=base;assert.equal(calculate(s).costPerSheetMills,3666240)}
});
test('unlabelled repeat material uses are ambiguous even with different item IDs',()=>{
 const s=state();delete current(s).items[0].label;current(s).items.push(item('another','synthetic-a'));delete current(s).items[4].label;
 has(calculate(s),'duplicate_material_label');current(s).items[4].label='Different position';assert.equal(calculate(s).complete,true);
});
