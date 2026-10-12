'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const Materials=require('../material-catalog');
const NOW='2026-10-12T14:00:00.000Z',LATER='2026-10-12T15:00:00.000Z';
const clone=value=>JSON.parse(JSON.stringify(value));
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze)}return value}
function state(){return {settings:{brand:'Fábrica sintética',models:[{id:'synthetic-model',name:'Modelo sintético'}],futureSetting:{keep:[1,2]}},weeks:{'2026-10-12':{goal:72,entries:[]}},salesOrders:[],salesPayments:[],factoryExpenses:[],stockLedger:[],futureState:{keep:true}}}
function input(extra={}){return {id:'material-synthetic',name:'Material sintético',category:'tira',unit:'m',createdAt:NOW,...extra}}
function price(extra={}){return {id:'price-synthetic',from:'2026-10-12',unitPriceMills:1251,note:'Preço sintético confirmado',updatedAt:LATER,...extra}}
function withMaterial(extra={}){return Materials.addMaterial(state(),input(extra))}
function row(s){return s.settings.materials[0]}
function code(expected){return error=>error instanceof Error&&error.code===expected}

test('UMD exports the identical API in a browser without CommonJS, clock or persistence',()=>{
 const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../material-catalog'),'utf8'),context);
 assert.deepEqual(Object.keys(context.FioriMaterials).sort(),Object.keys(Materials).sort());
 assert.equal(context.FioriMaterials.parsePriceMills('12,345'),12345);
 assert.equal(context.FioriMaterials.formatPriceMills(12345),'12,345');
});
test('categories and units expose the bounded schema and cannot be mutated',()=>{
 assert.deepEqual(Materials.categories.map(item=>item.id),['tira','solado','palmilha','enfeite','passador','cola','embalagem','cabedal','mao_de_obra','servico','outro']);
 assert.deepEqual(Materials.units,['m','un','par','placa','kg']);
 assert.ok(Materials.categories.every(item=>typeof item.label==='string'&&Object.isFrozen(item)));
 assert.ok(Object.isFrozen(Materials.categories));assert.ok(Object.isFrozen(Materials.units));
 assert.equal(Materials.editMaterial,undefined);assert.equal(Materials.removeMaterial,undefined);assert.equal(Materials.deactivateMaterial,undefined);assert.equal(Materials.editPrice,undefined);
});
for(const original of [{},state(),{settings:{}},{settings:{materials:[]}}])test('missing or empty catalog is read without adding fields: '+JSON.stringify(original),()=>{
 const before=freeze(original),snapshot=JSON.stringify(before);
 for(let n=0;n<3;n++){assert.deepEqual(Materials.listMaterials(before),[]);assert.deepEqual(Materials.validateCatalog(before),[])}
 assert.equal(JSON.stringify(before),snapshot);
});
test('listing returns an independently sortable array and retains inactive materials',()=>{
 let before=Materials.addMaterial(withMaterial(),input({id:'second',name:'Segundo',active:false}));freeze(before);
 const result=Materials.listMaterials(before);assert.notStrictEqual(result,before.settings.materials);result.reverse();result.pop();
 assert.equal(before.settings.materials.length,2);assert.equal(before.settings.materials[0].id,'material-synthetic');
 assert.equal(Materials.listMaterials(before)[1].active,false);
});
for(const [value,expected] of [['0',0],['0,000',0],['0.001',1],['0,01',10],['1',1000],['1.2',1200],['1,23',1230],['1,234',1234],[' 0012,345 ',12345],['9007199254740,991',Number.MAX_SAFE_INTEGER]]){
 test('parses exact mills '+JSON.stringify(value),()=>assert.equal(Materials.parsePriceMills(value),expected));
}
for(const value of ['', ' ',null,undefined,0,1.234,NaN,Infinity,{},[],true,'-1','-0','+1','1e3','0x10','1,2345','1.2340','.5',',5','1,','1.','1 000','1.000,000','1,000.000','1,2,3','NaN','Infinity','9007199254740.992','9007199254741','9999999999999999999999999999999']){
 test('rejects invalid or missing decimal price '+String(value),()=>assert.throws(()=>Materials.parsePriceMills(value),code('invalid_price')));
}
for(const [value,expected] of [[0,'0,000'],[1,'0,001'],[10,'0,010'],[1000,'1,000'],[1251,'1,251'],[1000000,'1.000,000'],[Number.MAX_SAFE_INTEGER,'9.007.199.254.740,991']]){
 test('formats integer mills without losing precision '+value,()=>assert.equal(Materials.formatPriceMills(value),expected));
}
for(const value of [null,undefined,'0',-1,0.1,Number.MAX_SAFE_INTEGER+1,NaN,Infinity,1n]){
 test('formatter rejects invalid mills '+String(value),()=>assert.throws(()=>Materials.formatPriceMills(value),code('invalid_price')));
}
test('money text round trips through the full safe integer range with exact fractional mills',()=>{
 for(const value of [0,1,9,10,999,1000,1001,123456789,Number.MAX_SAFE_INTEGER-2,Number.MAX_SAFE_INTEGER-1,Number.MAX_SAFE_INTEGER]){
  assert.equal(Materials.parsePriceMills(Materials.formatPriceMills(value).replace(/\./g,'')),value);
 }
});
for(const value of ['2024-02-29','2000-02-29','2026-10-12','0001-01-01','9999-12-31'])test('valid date '+value,()=>assert.equal(Materials.validDate(value),true));
for(const value of [null,undefined,20261012,'','2026-02-29','2026-02-30','1900-02-29','2026-04-31','2026-13-01','2026-00-01','2026-01-00','0000-01-01','2026-1-01','2026-10-12T00:00:00Z',' 2026-10-12 '])test('invalid date '+value,()=>assert.equal(Materials.validDate(value),false));

test('creating a material adds only optional settings.materials, never a seeded price or operational record',()=>{
 const before=freeze(state()),snapshot=JSON.stringify(before),args=freeze(input()),next=Materials.addMaterial(before,args);
 assert.notStrictEqual(next,before);assert.notStrictEqual(next.settings,before.settings);
 assert.deepEqual(row(next),{id:args.id,name:args.name,category:'tira',unit:'m',variantByColor:false,active:true,prices:[],createdAt:NOW,updatedAt:NOW});
 assert.equal(JSON.stringify(before),snapshot);assert.equal(before.settings.materials,undefined);
 for(const key of Object.keys(before).filter(key=>key!=='settings'))assert.strictEqual(next[key],before[key]);
 for(const key of Object.keys(before.settings))assert.strictEqual(next.settings[key],before.settings[key]);
 assert.deepEqual(Materials.validateCatalog(freeze(next)),[]);
});
test('explicit creation handles entirely absent settings without migration beyond catalog',()=>{
 const before=freeze({future:{keep:1}}),next=Materials.addMaterial(before,input());
 assert.deepEqual(Object.keys(next.settings),['materials']);assert.strictEqual(next.future,before.future);assert.equal(before.settings,undefined);
});
test('all categories and units are accepted without category-specific inferred costs or inventory',()=>{
 for(const category of Materials.categories)for(const unit of Materials.units){
  const next=Materials.addMaterial(freeze(state()),input({category:category.id,unit}));
  assert.equal(row(next).category,category.id);assert.equal(row(next).unit,unit);assert.deepEqual(row(next).prices,[]);assert.deepEqual(Materials.validateCatalog(next),[]);
 }
});
test('creation normalizes user text, accepts explicit flags and never modifies the input',()=>{
 const args=freeze(input({name:'  Sintético  ',supplier:'  Fornecedor sintético  ',variantByColor:true,active:false,updatedAt:LATER}));
 const next=Materials.addMaterial(freeze(state()),args);
 assert.equal(row(next).name,'Sintético');assert.equal(row(next).supplier,'Fornecedor sintético');assert.equal(row(next).variantByColor,true);assert.equal(row(next).active,false);assert.equal(row(next).updatedAt,LATER);
 assert.equal(args.name,'  Sintético  ');
});
for(const [field,value] of [['id',''],['id',' material '],['id',1],['id','x'.repeat(151)],['name',''],['name','   '],['name',null],['name','x'.repeat(201)],['supplier',null],['supplier',12],['supplier','x'.repeat(201)],['category','invalid'],['category',null],['unit','cm'],['unit',null],['variantByColor','false'],['variantByColor',null],['active',0],['active',null],['createdAt',undefined],['createdAt','2026-02-30T14:00:00Z'],['createdAt','2026-10-12'],['createdAt','2026-10-12T24:00:00Z'],['updatedAt',null],['updatedAt','2026-10-11T23:00:00Z']]){
 test('invalid material field never creates a partial candidate: '+field+' '+String(value).slice(0,30),()=>{
  const before=freeze(state()),snapshot=JSON.stringify(before);assert.throws(()=>Materials.addMaterial(before,freeze(input({[field]:value}))));assert.equal(JSON.stringify(before),snapshot);
 });
}
for(const prices of [null,{},[price()]])test('new material cannot seed prices: '+JSON.stringify(prices),()=>assert.throws(()=>Materials.addMaterial(state(),input({prices})),code('seeded_prices')));
test('stable material ID retries are idempotent and preserve unrelated later changes',()=>{
 const args=freeze(input()),before=withMaterial();before.futureState.extra='later';row(before).futureField={keep:1};freeze(before);
 assert.strictEqual(Materials.addMaterial(before,args),before);
 for(const extra of [{name:'Outro'},{category:'cola'},{unit:'kg'},{supplier:'Outro'},{variantByColor:true},{active:false},{createdAt:LATER},{updatedAt:LATER}]){
  assert.throws(()=>Materials.addMaterial(before,input(extra)),code('duplicate_id'));
 }
});
test('material creation retry cannot clear an existing price history',()=>{
 const before=freeze(Materials.addPrice(withMaterial(),input().id,price()));
 assert.throws(()=>Materials.addMaterial(before,input()),code('duplicate_id'));assert.equal(row(before).prices.length,1);
});

test('a price is appended with exact mills and the effective date; every prior field is preserved',()=>{
 let before=Materials.addPrice(withMaterial(),input().id,price({id:'prior',from:'2026-01-01',unitPriceMills:20}));
 before=Materials.addMaterial(before,input({id:'other',name:'Outro sintético'}));
 row(before).futureField={keep:[1,2]};row(before).prices[0].futurePrice={keep:true};freeze(before);
 const snapshot=JSON.stringify(before),args=freeze(price({updatedAt:'2026-10-12T16:00:00Z'})),next=Materials.addPrice(before,input().id,args);
 assert.equal(JSON.stringify(before),snapshot);assert.notStrictEqual(next,before);assert.notStrictEqual(next.settings,before.settings);assert.notStrictEqual(row(next),row(before));
 assert.deepEqual(row(next).prices.at(-1),{id:args.id,from:args.from,unitPriceMills:1251,note:args.note});
 assert.equal(row(next).updatedAt,args.updatedAt);assert.equal(row(next).createdAt,NOW);
 assert.strictEqual(row(next).prices[0],row(before).prices[0]);assert.strictEqual(row(next).futureField,row(before).futureField);assert.strictEqual(next.settings.materials[1],before.settings.materials[1]);
 for(const key of Object.keys(before).filter(key=>key!=='settings'))assert.strictEqual(next[key],before[key]);
 for(const key of Object.keys(before.settings).filter(key=>key!=='materials'))assert.strictEqual(next.settings[key],before.settings[key]);
 assert.deepEqual(Materials.validateCatalog(next),[]);
});
test('retroactive and future prices append out of order while queries select greatest eligible date',()=>{
 let next=withMaterial();
 for(const [id,from,value] of [['future','2027-01-01',5000],['old','2020-01-01',1000],['present','2026-10-12',0],['middle','2025-01-01',2000]])next=Materials.addPrice(next,input().id,price({id,from,unitPriceMills:value}));
 freeze(next);const snapshot=JSON.stringify(next),material=row(next);
 assert.deepEqual(material.prices.map(item=>item.id),['future','old','present','middle']);
 for(const [date,id] of [['2019-12-31',null],['2020-01-01','old'],['2024-12-31','old'],['2025-01-01','middle'],['2026-10-11','middle'],['2026-10-12','present'],['2026-12-31','present'],['2027-01-01','future'],['2099-01-01','future']]){
  assert.equal(Materials.applicablePrice(material,date)?.id||null,id);
 }
 assert.equal(Materials.applicablePrice(material,'2026-10-12').unitPriceMills,0);assert.equal(JSON.stringify(next),snapshot);
});
test('no recorded price and not-yet-effective price are null, distinct from explicit zero',()=>{
 let next=withMaterial();assert.equal(Materials.applicablePrice(freeze(row(next)),'2026-10-12'),null);
 next=Materials.addPrice(next,input().id,price({from:'2027-01-01',unitPriceMills:0,note:undefined}));
 assert.equal(Materials.applicablePrice(row(next),'2026-12-31'),null);
 assert.equal(Materials.applicablePrice(row(next),'2027-01-01').unitPriceMills,0);assert.equal(row(next).prices[0].note,'');
});
test('existing inactive materials and prices remain readable without an edit or deactivate path',()=>{
 const before=Materials.addPrice(withMaterial(),input().id,price());row(before).active=false;freeze(before);
 assert.equal(Materials.listMaterials(before)[0].active,false);assert.equal(Materials.applicablePrice(row(before),'2026-10-12').unitPriceMills,1251);
 assert.throws(()=>Materials.addPrice(before,input().id,price({id:'new',from:'2027-01-01'})),code('inactive_material'));
 assert.strictEqual(Materials.addPrice(before,input().id,price()),before);
});
test('price ID retry is idempotent after later append, including a zero price',()=>{
 const args=freeze(price({unitPriceMills:0}));let before=Materials.addPrice(withMaterial(),input().id,args);
 before=Materials.addPrice(before,input().id,price({id:'later',from:'2027-01-01',updatedAt:'2026-10-13T00:00:00Z'}));freeze(before);
 assert.strictEqual(Materials.addPrice(before,input().id,args),before);assert.equal(row(before).prices.length,2);
 for(const extra of [{from:'2026-10-11'},{unitPriceMills:1},{note:'Different'}])assert.throws(()=>Materials.addPrice(before,input().id,{...args,...extra}),code('duplicate_id'));
});
test('same date is rejected rather than replaced, including equal zero and equal price',()=>{
 const before=freeze(Materials.addPrice(withMaterial(),input().id,price({unitPriceMills:0})));
 for(const value of [0,1000])assert.throws(()=>Materials.addPrice(before,input().id,price({id:'new',unitPriceMills:value})),code('duplicate_date'));
 assert.equal(row(before).prices.length,1);assert.equal(row(before).prices[0].unitPriceMills,0);
});
test('material and price IDs share one collision-checked catalog namespace',()=>{
 let before=Materials.addPrice(withMaterial(),input().id,price());before=Materials.addMaterial(before,input({id:'other'}));freeze(before);
 assert.throws(()=>Materials.addPrice(before,'other',price()),code('duplicate_id'));
 assert.throws(()=>Materials.addPrice(before,'other',price({id:input().id})),code('duplicate_id'));
 assert.throws(()=>Materials.addMaterial(before,input({id:price().id})),code('duplicate_id'));
 assert.throws(()=>Materials.addPrice(before,input().id,price({id:'other'})),code('duplicate_id'));
});
for(const [field,value] of [['id',''],['id',null],['id',' spaced '],['from',undefined],['from','2026-02-30'],['from','2026-13-01'],['unitPriceMills',undefined],['unitPriceMills',null],['unitPriceMills','1000'],['unitPriceMills',-1],['unitPriceMills',1.5],['unitPriceMills',Number.MAX_SAFE_INTEGER+1],['unitPriceMills',Infinity],['unitPriceMills',NaN],['note',null],['note','x'.repeat(501)],['updatedAt',undefined],['updatedAt','2026-10-12'],['updatedAt','2026-02-30T00:00:00Z'],['updatedAt','2026-10-12T13:59:59Z']]){
 test('invalid price field fails without partial writes: '+field+' '+String(value).slice(0,30),()=>{
  const before=freeze(withMaterial()),snapshot=JSON.stringify(before);assert.throws(()=>Materials.addPrice(before,input().id,freeze(price({[field]:value}))));assert.equal(JSON.stringify(before),snapshot);
 });
}
test('price note normalization does not change frozen input and exact maximum is accepted',()=>{
 const args=freeze(price({unitPriceMills:Number.MAX_SAFE_INTEGER,note:'  Sintético  '})),next=Materials.addPrice(freeze(withMaterial()),input().id,args);
 assert.equal(row(next).prices[0].unitPriceMills,Number.MAX_SAFE_INTEGER);assert.equal(row(next).prices[0].note,'Sintético');assert.equal(args.note,'  Sintético  ');
});
test('unknown material IDs and malformed write inputs reject without adding a catalog',()=>{
 const before=freeze(state());assert.throws(()=>Materials.addPrice(before,'missing',price()),code('unknown_material'));
 for(const invalid of [null,undefined,[],false]){assert.throws(()=>Materials.addMaterial(before,invalid));assert.throws(()=>Materials.addPrice(withMaterial(),input().id,invalid))}
 assert.equal(before.settings.materials,undefined);
});

for(const broken of [null,undefined,[],1,{settings:null},{settings:[]},{settings:{materials:null}},{settings:{materials:{}}},{settings:{materials:'bad'}},{settings:{materials:[null]}}]){
 test('malformed existing state fails closed: '+JSON.stringify(broken),()=>{
  freeze(broken);assert.ok(Materials.validateCatalog(broken).length);assert.throws(()=>Materials.addMaterial(broken,input()));assert.throws(()=>Materials.addPrice(broken,input().id,price()));
 });
}
test('catalog validation reports independent issues without mutating or throwing',()=>{
 const before=withMaterial(),material=row(before);material.name='';material.category='bad';material.prices=[{id:'broken',from:'2026-02-30',unitPriceMills:null,note:0}];freeze(before);
 const snapshot=JSON.stringify(before),issues=Materials.validateCatalog(before);
 for(const expected of ['invalid_text','invalid_category','invalid_date','invalid_price'])assert.ok(issues.some(issue=>issue.code===expected));
 assert.ok(issues.every(issue=>issue.materialId===material.id));assert.ok(issues.some(issue=>issue.priceId==='broken'));assert.equal(JSON.stringify(before),snapshot);
});
for(const [field,value] of [['id',null],['name',null],['category','unsupported'],['unit','unsupported'],['supplier',false],['variantByColor',undefined],['active',undefined],['createdAt',null],['updatedAt','2020-01-01T00:00:00Z'],['prices',undefined],['prices',{}],['prices',[null]]]){
 test('malformed existing material blocks all writes, including retries: '+field,()=>{
  const before=withMaterial();row(before)[field]=value;freeze(before);assert.ok(Materials.validateCatalog(before).length);
  assert.throws(()=>Materials.addMaterial(before,input()));assert.throws(()=>Materials.addMaterial(before,input({id:'other'})));assert.throws(()=>Materials.addPrice(before,input().id,price()));
 });
}
for(const [field,value] of [['id',null],['from','2026-02-30'],['unitPriceMills',null],['unitPriceMills',-1],['unitPriceMills',Number.MAX_SAFE_INTEGER+1],['note',undefined]]){
 test('malformed historical price blocks new append and read lookup: '+field,()=>{
  const before=Materials.addPrice(withMaterial(),input().id,price());row(before).prices[0][field]=value;freeze(before);const snapshot=JSON.stringify(before);
  assert.ok(Materials.validateCatalog(before).length);assert.throws(()=>Materials.addPrice(before,input().id,price({id:'new',from:'2027-01-01'})));assert.throws(()=>Materials.applicablePrice(row(before),'2026-10-12'));assert.equal(JSON.stringify(before),snapshot);
 });
}
test('duplicate existing material ID, price ID or date blocks all new writes',()=>{
 const variants=[
  s=>s.settings.materials.push(clone(row(s))),
  s=>row(s).prices.push({...row(s).prices[0],from:'2027-01-01'}),
  s=>row(s).prices.push({...row(s).prices[0],id:'other'}),
  s=>row(s).prices[0].id=row(s).id,
  s=>s.settings.materials.push({...clone(row(s)),id:'other'})
 ];
 for(const corrupt of variants){
  const before=Materials.addPrice(withMaterial(),input().id,price());corrupt(before);freeze(before);
  assert.ok(Materials.validateCatalog(before).some(issue=>['duplicate_id','duplicate_date'].includes(issue.code)));
  assert.throws(()=>Materials.addMaterial(before,input({id:'new'})));assert.throws(()=>Materials.addPrice(before,input().id,price({id:'new',from:'2028-01-01'})));
 }
});
test('a malformed unrelated material also blocks writes rather than silently repairing it',()=>{
 const before=Materials.addMaterial(withMaterial(),input({id:'other'}));before.settings.materials[1].prices=null;freeze(before);
 assert.throws(()=>Materials.addPrice(before,input().id,price()),code('invalid_prices'));
});
test('invalid query date never falls back to current price or zero',()=>{
 const material=freeze(row(Materials.addPrice(withMaterial(),input().id,price())));
 for(const when of [null,undefined,'','2026-02-30'])assert.throws(()=>Materials.applicablePrice(material,when),code('invalid_date'));
});
