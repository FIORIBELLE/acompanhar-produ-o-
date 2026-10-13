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
 for(const method of ['editMaterial','setMaterialActive','correctPrice','priceHistory','activePrices'])assert.equal(typeof Materials[method],'function');
 assert.equal(Materials.removeMaterial,undefined);assert.equal(Materials.deactivateMaterial,undefined);assert.equal(Materials.editPrice,undefined);
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
test('existing inactive materials and prices remain readable without changing their history',()=>{
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

const CORRECTED='2026-10-12T16:00:00.000Z',AFTER='2026-10-12T17:00:00.000Z';
function edits(extra={}){return {name:'Material sintético',category:'tira',unit:'m',variantByColor:false,updatedAt:AFTER,...extra}}
function correction(extra={}){return {id:'correction-synthetic',supersedesPriceId:'price-synthetic',from:'2026-10-12',unitPriceMills:0,note:'Correção sintética',correctedAt:CORRECTED,updatedAt:CORRECTED,...extra}}
function withPrice(){return Materials.addPrice(withMaterial(),input().id,price())}
function withCorrection(){return Materials.correctPrice(withPrice(),input().id,correction())}
function assertOtherStateUnchanged(before,next){
 for(const key of Object.keys(before).filter(key=>key!=='settings'))assert.strictEqual(next[key],before[key],key);
 for(const key of Object.keys(before.settings).filter(key=>key!=='materials'))assert.strictEqual(next.settings[key],before.settings[key],key);
 for(let i=1;i<before.settings.materials.length;i++)assert.strictEqual(next.settings.materials[i],before.settings.materials[i]);
}

test('editing only material metadata preserves every history row, extension and unrelated object',()=>{
 let before=withCorrection();before=Materials.addMaterial(before,input({id:'other',supplier:'Outro fornecedor'}));
 row(before).futureMaterial={preserve:['untouched']};row(before).prices[0].futurePrice={preserve:true};
 freeze(before);const snapshot=JSON.stringify(before),oldHistory=JSON.stringify(row(before).prices);
 const command=freeze(edits({name:'  Novo nome sintético  ',supplier:'  Fornecedor editado  ',variantByColor:true}));
 const next=Materials.editMaterial(before,input().id,command);
 assert.equal(row(next).name,'Novo nome sintético');assert.equal(row(next).supplier,'Fornecedor editado');assert.equal(row(next).variantByColor,true);
 assert.equal(row(next).updatedAt,AFTER);assert.equal(row(next).createdAt,NOW);assert.equal(row(next).id,row(before).id);assert.equal(row(next).active,true);
 assert.strictEqual(row(next).prices,row(before).prices);assert.strictEqual(row(next).futureMaterial,row(before).futureMaterial);
 assert.equal(JSON.stringify(row(next).prices),oldHistory);assert.equal(JSON.stringify(before),snapshot);assertOtherStateUnchanged(before,next);
 assert.equal(command.name,'  Novo nome sintético  ');assert.deepEqual(Materials.validateCatalog(next),[]);
});
test('supplier omission preserves the supplier, while an explicit empty value clears only that field',()=>{
 const before=freeze(withMaterial({supplier:'Fornecedor sintético'}));
 const preserved=Materials.editMaterial(before,input().id,edits({name:'Novo nome'}));assert.equal(row(preserved).supplier,'Fornecedor sintético');
 const cleared=Materials.editMaterial(before,input().id,edits({supplier:'  '}));assert.equal(row(cleared).supplier,'');
 const without=Materials.editMaterial(freeze(withMaterial()),input().id,edits({name:'Novo nome'}));assert.equal(Object.hasOwn(row(without),'supplier'),false);
});
test('category and unit can change on an empty history, including an inactive material',()=>{
 const before=freeze(withMaterial({active:false}));
 const next=Materials.editMaterial(before,input().id,edits({category:'cola',unit:'kg'}));
 assert.equal(row(next).category,'cola');assert.equal(row(next).unit,'kg');assert.equal(row(next).active,false);assert.strictEqual(row(next).prices,row(before).prices);
});
for(const history of ['past','future','corrected','future-corrected'])test('category and unit stay locked for any '+history+' history',()=>{
 const from=history.startsWith('future')?'2028-01-01':'2020-01-01';
 let before=Materials.addPrice(withMaterial(),input().id,price({from}));
 if(history.includes('corrected'))before=Materials.correctPrice(before,input().id,correction({from}));
 freeze(before);const snapshot=JSON.stringify(before);
 for(const change of [{category:'cola'},{unit:'kg'},{category:'outro',unit:'un'}])assert.throws(()=>Materials.editMaterial(before,input().id,edits(change)),code('locked_material_fields'));
 const next=Materials.editMaterial(before,input().id,edits({name:'Novo nome',variantByColor:true}));
 assert.equal(row(next).name,'Novo nome');assert.strictEqual(row(next).prices,row(before).prices);assert.equal(JSON.stringify(before),snapshot);
});
test('no-op metadata and active-state retries preserve state identity and never advance updatedAt',()=>{
 const before=freeze(Materials.editMaterial(withCorrection(),input().id,edits({name:'Nome editado'})));
 assert.strictEqual(Materials.editMaterial(before,input().id,edits({name:' Nome editado ',updatedAt:LATER})),before);
 assert.strictEqual(Materials.setMaterialActive(before,input().id,{active:true,updatedAt:NOW}),before);
 assert.equal(row(before).updatedAt,AFTER);
});
for(const [field,value] of [['name',''],['name',null],['name','x'.repeat(201)],['supplier',null],['supplier','x'.repeat(201)],['variantByColor',undefined],['variantByColor','false'],['category',undefined],['category','bad'],['unit',undefined],['unit','cm'],['updatedAt',undefined],['updatedAt','2026-10-12T14:00:00+00:00'],['updatedAt','2026-10-12T13:59:59Z']]){
 test('invalid edit command remains atomic: '+field+' '+String(value).slice(0,30),()=>{
  const before=freeze(withMaterial()),snapshot=JSON.stringify(before);
  assert.throws(()=>Materials.editMaterial(before,input().id,edits({name:'Changed',[field]:value})));
  assert.equal(JSON.stringify(before),snapshot);
 });
}
for(const field of ['id','createdAt','prices','active','supersedesPriceId','correctedAt','futureUnknown'])test('metadata editing rejects undeclared field '+field,()=>{
 const before=freeze(withCorrection());assert.throws(()=>Materials.editMaterial(before,input().id,edits({[field]:null})),code('invalid_input'));
});
test('activation and deactivation retain visible byte-identical history and all other state',()=>{
 let before=Materials.addMaterial(withCorrection(),input({id:'other'}));row(before).futureField={keep:true};freeze(before);
 const snapshot=JSON.stringify(before),deactivated=Materials.setMaterialActive(before,input().id,freeze({active:false,updatedAt:AFTER}));
 assert.equal(row(deactivated).active,false);assert.strictEqual(row(deactivated).prices,row(before).prices);assert.strictEqual(row(deactivated).futureField,row(before).futureField);
 assertOtherStateUnchanged(before,deactivated);assert.equal(JSON.stringify(before),snapshot);
 assert.equal(Materials.listMaterials(deactivated).length,2);assert.equal(Materials.priceHistory(row(deactivated)).length,2);assert.equal(Materials.applicablePrice(row(deactivated),'2026-10-12').unitPriceMills,0);
 assert.throws(()=>Materials.addPrice(deactivated,input().id,price({id:'new',from:'2027-01-01',updatedAt:AFTER})),code('inactive_material'));
 assert.throws(()=>Materials.correctPrice(deactivated,input().id,correction({id:'new',supersedesPriceId:'correction-synthetic',correctedAt:AFTER,updatedAt:AFTER})),code('inactive_material'));
 const renamed=Materials.editMaterial(deactivated,input().id,edits({name:'Nome inativo'}));assert.equal(row(renamed).name,'Nome inativo');assert.equal(row(renamed).active,false);
 const active=Materials.setMaterialActive(freeze(renamed),input().id,{active:true,updatedAt:'2026-10-12T18:00:00Z'});
 assert.equal(row(active).active,true);assert.strictEqual(row(active).prices,row(before).prices);assert.equal(row(active).createdAt,NOW);
 const priced=Materials.addPrice(active,input().id,price({id:'new',from:'2027-01-01',updatedAt:'2026-10-12T18:00:00Z'}));assert.equal(row(priced).prices.length,3);
});
for(const change of [{active:undefined},{active:0},{active:'false'},{updatedAt:undefined},{updatedAt:'2026-10-11T00:00:00Z'},{prices:[]},{name:'hidden edit'}])test('invalid active-state command rejects: '+JSON.stringify(change),()=>{
 const before=freeze(withMaterial());assert.throws(()=>Materials.setMaterialActive(before,input().id,{active:false,updatedAt:AFTER,...change}));assert.equal(row(before).active,true);
});

test('correction is append-only, records provenance and zero exactly, and leaves every old byte unchanged',()=>{
 let before=Materials.addMaterial(withPrice(),input({id:'other'}));row(before).futureMaterial={keep:true};row(before).prices[0].futurePrice={keep:[1,2]};
 freeze(before);const snapshot=JSON.stringify(before),oldBytes=row(before).prices.map(p=>JSON.stringify(p)),command=freeze(correction());
 const next=Materials.correctPrice(before,input().id,command),material=row(next);
 assert.equal(JSON.stringify(before),snapshot);assert.equal(material.prices.length,2);assert.equal(material.updatedAt,CORRECTED);assert.equal(material.createdAt,NOW);
 assert.deepEqual(material.prices[1],{id:'correction-synthetic',from:'2026-10-12',unitPriceMills:0,note:'Correção sintética',supersedesPriceId:'price-synthetic',correctedAt:CORRECTED});
 for(let i=0;i<oldBytes.length;i++){assert.strictEqual(material.prices[i],row(before).prices[i]);assert.equal(JSON.stringify(material.prices[i]),oldBytes[i])}
 assertOtherStateUnchanged(before,next);assert.strictEqual(material.futureMaterial,row(before).futureMaterial);assert.deepEqual(Materials.validateCatalog(next),[]);
 assert.equal(Materials.applicablePrice(material,'2026-10-12').id,'correction-synthetic');assert.equal(Materials.applicablePrice(material,'2026-10-12').unitPriceMills,0);
 assert.deepEqual(Materials.priceHistory(material),[{price:material.prices[0],correctedBy:material.prices[1]},{price:material.prices[1],correctedBy:null}]);
 assert.deepEqual(Materials.activePrices(material),[material.prices[1]]);
 assert.equal(Object.hasOwn(material.prices[0],'correctedAt'),false);assert.equal(Object.hasOwn(material.prices[0],'correctedBy'),false);
});
test('future and retroactive corrections never change their effective date or unrelated date selection',()=>{
 let before=withMaterial();
 for(const [id,from,value] of [['future','2027-01-01',7000],['past','2020-01-01',1000],['middle','2026-01-01',2000]])before=Materials.addPrice(before,input().id,price({id,from,unitPriceMills:value}));
 before=Materials.correctPrice(before,input().id,correction({id:'future-correction',supersedesPriceId:'future',from:'2027-01-01',unitPriceMills:0}));
 before=Materials.correctPrice(before,input().id,correction({id:'past-correction',supersedesPriceId:'past',from:'2020-01-01',unitPriceMills:1111,correctedAt:AFTER,updatedAt:AFTER}));
 freeze(before);const snapshot=JSON.stringify(before),material=row(before);
 for(const [when,expected] of [['2019-12-31',null],['2020-01-01','past-correction'],['2025-12-31','past-correction'],['2026-01-01','middle'],['2026-12-31','middle'],['2027-01-01','future-correction']]){
  assert.equal(Materials.applicablePrice(material,when)?.id||null,expected);
 }
 assert.deepEqual(Materials.activePrices(material).map(p=>p.id),['middle','future-correction','past-correction']);assert.equal(JSON.stringify(before),snapshot);
});
test('a correction can be corrected only through its current leaf; full linear audit chain stays visible',()=>{
 const before=freeze(withCorrection()),next=Materials.correctPrice(before,input().id,correction({id:'second-correction',supersedesPriceId:'correction-synthetic',unitPriceMills:9001,correctedAt:AFTER,updatedAt:AFTER}));
 assert.deepEqual(Materials.activePrices(row(next)).map(p=>p.id),['second-correction']);assert.equal(Materials.applicablePrice(row(next),'2026-10-12').unitPriceMills,9001);
 const history=Materials.priceHistory(row(next));assert.equal(history[0].correctedBy.id,'correction-synthetic');assert.equal(history[1].correctedBy.id,'second-correction');assert.equal(history[2].correctedBy,null);
 for(const supersedesPriceId of ['price-synthetic','correction-synthetic'])assert.throws(()=>Materials.correctPrice(next,input().id,correction({id:'fork',supersedesPriceId,correctedAt:AFTER,updatedAt:AFTER})),code('stale_price'));
 assert.equal(row(next).prices.length,3);assert.strictEqual(row(next).prices[0],row(before).prices[0]);assert.strictEqual(row(next).prices[1],row(before).prices[1]);
});
test('read projections are independently sortable without mutating any history or creating a timestamp',()=>{
 const before=freeze(withCorrection()),snapshot=JSON.stringify(before),material=row(before);
 const history=Materials.priceHistory(material),active=Materials.activePrices(material);history.reverse();history.pop();active.pop();
 assert.equal(Materials.priceHistory(material).length,2);assert.equal(Materials.activePrices(material).length,1);assert.equal(JSON.stringify(before),snapshot);
 assert.deepEqual(Materials.priceHistory(row(withMaterial())),[]);assert.deepEqual(Materials.activePrices(row(withMaterial())),[]);
});
test('correction retries preserve later changes, subsequent corrections and inactive status without duplicate append',()=>{
 const command=freeze(correction());let before=withCorrection();
 before=Materials.correctPrice(before,input().id,correction({id:'second-correction',supersedesPriceId:command.id,unitPriceMills:5000,correctedAt:AFTER,updatedAt:AFTER}));
 before=Materials.setMaterialActive(before,input().id,{active:false,updatedAt:AFTER});freeze(before);
 assert.strictEqual(Materials.correctPrice(before,input().id,command),before);assert.equal(row(before).prices.length,3);
 for(const change of [{from:'2026-10-11'},{unitPriceMills:1},{note:'Alterado'},{supersedesPriceId:'second-correction'},{correctedAt:LATER}]){
  assert.throws(()=>Materials.correctPrice(before,input().id,{...command,...change}),code('duplicate_id'));
 }
 // The material-level revision time is not a second correction audit field.
 assert.strictEqual(Materials.correctPrice(before,input().id,{...command,updatedAt:AFTER}),before);
});
test('ordinary price append cannot impersonate a correction retry or add another root to a corrected date',()=>{
 const before=freeze(withCorrection());
 assert.throws(()=>Materials.addPrice(before,input().id,price({id:'correction-synthetic',unitPriceMills:0,note:'Correção sintética',updatedAt:CORRECTED})),code('duplicate_id'));
 for(const value of [0,1251])assert.throws(()=>Materials.addPrice(before,input().id,price({id:'new-root',unitPriceMills:value,updatedAt:CORRECTED})),code('duplicate_date'));
 assert.strictEqual(Materials.addPrice(before,input().id,price()),before);
});
for(const [field,value] of [['supersedesPriceId','price-synthetic'],['supersedesPriceId',undefined],['correctedAt',CORRECTED],['correctedAt',undefined],['correctedBy','injected'],['prices',[]],['futureUnknown',1]])test('ordinary append rejects unknown or correction field '+field+' '+String(value),()=>{
 const before=freeze(withMaterial());assert.throws(()=>Materials.addPrice(before,input().id,price({[field]:value})),code('invalid_input'));assert.equal(row(before).prices.length,0);
});
test('write commands reject inherited, accessor and symbol metadata before evaluating it',()=>{
 const before=freeze(withMaterial());
 const inherited=Object.assign(Object.create({supersedesPriceId:'injected'}),price());assert.throws(()=>Materials.addPrice(before,input().id,inherited),code('invalid_input'));
 let evaluated=false;const accessor=price();Object.defineProperty(accessor,'correctedAt',{get(){evaluated=true;return CORRECTED}});
 assert.throws(()=>Materials.addPrice(before,input().id,accessor),code('invalid_input'));assert.equal(evaluated,false);
 const knownAccessor=price();Object.defineProperty(knownAccessor,'note',{get(){evaluated=true;return ''}});assert.throws(()=>Materials.addPrice(before,input().id,knownAccessor),code('invalid_input'));assert.equal(evaluated,false);
 assert.throws(()=>Materials.addPrice(before,input().id,{...price(),[Symbol('correction')]:1}),code('invalid_input'));
});
test('strict write commands support JSON-shaped objects from a browser realm and with null prototype',()=>{
 const context={};vm.createContext(context);const crossRealm=vm.runInContext('('+JSON.stringify(price())+')',context);
 const next=Materials.addPrice(freeze(withMaterial()),input().id,crossRealm);assert.equal(row(next).prices.length,1);
 const command=Object.assign(Object.create(null),correction());assert.equal(row(Materials.correctPrice(next,input().id,command)).prices.length,2);
});
test('correction identifiers share the catalog namespace and targets cannot cross material boundaries',()=>{
 let before=Materials.addMaterial(withPrice(),input({id:'other'}));before=Materials.addPrice(before,'other',price({id:'other-price'}));freeze(before);
 for(const id of ['material-synthetic','other','other-price','price-synthetic'])assert.throws(()=>Materials.correctPrice(before,input().id,correction({id})),code('duplicate_id'));
 for(const supersedesPriceId of ['other-price','unknown','material-synthetic'])assert.throws(()=>Materials.correctPrice(before,input().id,correction({supersedesPriceId})),code('invalid_correction_target'));
 assert.throws(()=>Materials.correctPrice(before,input().id,correction({from:'2026-10-13'})),code('invalid_correction_date'));
});
for(const [field,value] of [['id',''],['id',null],['supersedesPriceId',undefined],['supersedesPriceId',null],['supersedesPriceId',' spaced '],['from',undefined],['from','2026-02-30'],['unitPriceMills',null],['unitPriceMills','0'],['unitPriceMills',-1],['unitPriceMills',0.1],['unitPriceMills',Number.MAX_SAFE_INTEGER+1],['note',null],['note','x'.repeat(501)],['correctedAt',undefined],['correctedAt','2026-10-12'],['correctedAt','2026-10-12T16:00:00+00:00'],['correctedAt','2026-10-12T14:59:59.999Z'],['correctedAt',AFTER],['updatedAt',undefined],['updatedAt',LATER],['updatedAt','2026-02-30T16:00:00Z'],['active',false]]){
 test('invalid correction remains atomic: '+field+' '+String(value).slice(0,30),()=>{
  const before=freeze(withPrice()),snapshot=JSON.stringify(before);
  assert.throws(()=>Materials.correctPrice(before,input().id,freeze(correction({[field]:value}))));assert.equal(JSON.stringify(before),snapshot);
 });
}
test('correction normalizes note without mutating input and accepts exact maximum mills',()=>{
 const command=freeze(correction({unitPriceMills:Number.MAX_SAFE_INTEGER,note:'  Revisado  '})),next=Materials.correctPrice(freeze(withPrice()),input().id,command);
 assert.equal(row(next).prices[1].unitPriceMills,Number.MAX_SAFE_INTEGER);assert.equal(row(next).prices[1].note,'Revisado');assert.equal(command.note,'  Revisado  ');
 const absent=Materials.correctPrice(freeze(withPrice()),input().id,correction({note:undefined}));assert.equal(row(absent).prices[1].note,'');
});
test('new correction audit time cannot precede a later metadata edit, even if after its target',()=>{
 const before=freeze(Materials.editMaterial(withPrice(),input().id,edits({name:'Novo nome'})));
 assert.throws(()=>Materials.correctPrice(before,input().id,correction({updatedAt:AFTER})),code('invalid_timestamp'));
 const next=Materials.correctPrice(before,input().id,correction({correctedAt:AFTER,updatedAt:AFTER}));assert.equal(row(next).prices.length,2);
});

const corruptHistories=[
 ['orphan',s=>row(s).prices[1].supersedesPriceId='missing'],
 ['material target',s=>row(s).prices[1].supersedesPriceId=row(s).id],
 ['self cycle',s=>row(s).prices[1].supersedesPriceId=row(s).prices[1].id],
 ['two-row cycle',s=>Object.assign(row(s).prices[0],{supersedesPriceId:row(s).prices[1].id,correctedAt:CORRECTED})],
 ['forward reference',s=>row(s).prices.reverse()],
 ['wrong effective date',s=>row(s).prices[1].from='2027-01-01'],
 ['fork',s=>row(s).prices.push({...row(s).prices[1],id:'fork'})],
 ['second root',s=>row(s).prices.push({...row(s).prices[0],id:'second-root'})],
 ['missing correction time',s=>delete row(s).prices[1].correctedAt],
 ['missing target',s=>delete row(s).prices[1].supersedesPriceId],
 ['undefined correction metadata',s=>row(s).prices[0].supersedesPriceId=undefined],
 ['undefined time metadata',s=>row(s).prices[0].correctedAt=undefined],
 ['invalid audit timestamp',s=>row(s).prices[1].correctedAt='2026-02-30T00:00:00Z'],
 ['audit before creation',s=>row(s).prices[1].correctedAt='2020-01-01T00:00:00Z'],
 ['audit after revision',s=>row(s).prices[1].correctedAt=AFTER],
 ['null target',s=>row(s).prices[1].supersedesPriceId=null],
 ['nonstring target',s=>row(s).prices[1].supersedesPriceId=123],
 ['cross-material target',s=>{s.settings.materials.push({...clone(row(s)),id:'other',prices:[{...row(s).prices[0],id:'other-price'}]});row(s).prices[1].supersedesPriceId='other-price'}],
 ['decreasing chain audit',s=>{row(s).updatedAt=AFTER;row(s).prices.push({...row(s).prices[1],id:'next',supersedesPriceId:'correction-synthetic',correctedAt:LATER})}],
 ['decreasing unrelated audit',s=>{row(s).updatedAt=AFTER;row(s).prices.push({id:'future-root',from:'2027-01-01',unitPriceMills:2,note:''},{...row(s).prices[1],id:'future-correction',from:'2027-01-01',supersedesPriceId:'future-root',correctedAt:LATER})}]
];
for(const [label,corrupt] of corruptHistories)test('invalid history fails closed on all reads and writes: '+label,()=>{
 const before=withCorrection();corrupt(before);freeze(before);const snapshot=JSON.stringify(before);
 assert.ok(Materials.validateCatalog(before).length,label);
 for(const operation of [()=>Materials.applicablePrice(row(before),'2026-10-12'),()=>Materials.priceHistory(row(before)),()=>Materials.activePrices(row(before)),()=>Materials.addMaterial(before,input({id:'new'})),()=>Materials.addPrice(before,input().id,price({id:'new',from:'2028-01-01',updatedAt:AFTER})),()=>Materials.correctPrice(before,input().id,correction()),()=>Materials.editMaterial(before,input().id,edits()),()=>Materials.setMaterialActive(before,input().id,{active:false,updatedAt:AFTER})])assert.throws(operation,label);
 assert.equal(JSON.stringify(before),snapshot);
});
test('unknown materials and malformed commands never create a catalog through the new APIs',()=>{
 const before=freeze(state()),snapshot=JSON.stringify(before);
 for(const [method,command] of [['editMaterial',edits()],['setMaterialActive',{active:false,updatedAt:AFTER}],['correctPrice',correction()]]){
  assert.throws(()=>Materials[method](before,'missing',command),code('unknown_material'));
  for(const invalid of [undefined,null,[],true,'value'])assert.throws(()=>Materials[method](freeze(withMaterial()),input().id,invalid));
 }
 assert.equal(JSON.stringify(before),snapshot);assert.equal(before.settings.materials,undefined);
});
