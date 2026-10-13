'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const UI=require('../tech-sheet-ui'),T=require('../tech-sheet');

// Synthetic records only. Corrections are append-only audit entries and never
// touch the operational store, production, stock, orders or actual finances.
const REF='987',FROM='2026-03-01',QUERY='2026-03-15';
const ORIGINAL='2026-03-01T12:00:00.000Z',DRAFTED='2026-03-10T13:00:00.000Z',CONFIRMED='2026-03-10T13:05:00.000Z',LATER='2026-03-11T14:00:00.000Z';
const clone=value=>JSON.parse(JSON.stringify(value));
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}
function version(extra={}){return {id:'synthetic-original',validFrom:FROM,createdAt:ORIGINAL,sizeGroups:[],salePriceMills:9800,note:'Versão sintética',items:[{id:'synthetic-item',materialId:'synthetic-material',label:'Posição fictícia',qtyPerPair:'0.5',colorMap:{'Cor sintética':'Detalhe informativo'},unknownItem:{keep:['all',2]}}],unknownVersion:{keep:['all',3]},...extra}}
function state(){return {settings:{models:[{id:'synthetic-model',ref:REF,name:'Modelo fictício',line:'900'}],materials:[{id:'synthetic-material',name:'Componente fictício',category:'outro',unit:'un',variantByColor:false,active:true,prices:[{id:'synthetic-price',from:FROM,unitPriceMills:4200,note:''}],createdAt:ORIGINAL,updatedAt:ORIGINAL}],techSheets:{[REF]:{ref:REF,versions:[version()],unknownSheet:{keep:['all',4]}},'988':{ref:'988',versions:[version({id:'synthetic-other-ref'})],unknownSheet:'unchanged'}},unknownSettings:{keep:'settings'}},weeks:{'2026-03-02':{entries:[{id:'synthetic-entry'}],unknownWeek:'keep'}},stockLedger:[{id:'synthetic-stock'}],salesOrders:[{id:'synthetic-order'}],salesPayments:[{id:'synthetic-payment'}],factoryExpenses:[{id:'synthetic-expense'}],unknownRoot:{keep:['root',5]}}}
function versions(s){return s.settings.techSheets[REF].versions}
function correction(extra={}){return version({id:'synthetic-correction',createdAt:DRAFTED,supersedesVersionId:'synthetic-original',correctedAt:CONFIRMED,salePriceMills:9900,items:[{...version().items[0],qtyPerPair:'0.75'}],...extra})}
function calculate(s,date=QUERY){return T.calculateTechSheet(s,{ref:REF,date})}
function throwsWithoutMutation(s,fn){freeze(s);const before=JSON.stringify(s);assert.throws(fn);assert.equal(JSON.stringify(s),before)}

test('correction helper API exists in both CommonJS and the browser UMD',()=>{
 const context=vm.createContext({});
 for(const name of ['inventory-guard','material-catalog','standard-sheet','tech-sheet','tech-sheet-ui'])vm.runInContext(fs.readFileSync(require.resolve('../'+name),'utf8'),context);
 for(const name of ['draftCorrection','correctVersion']){assert.equal(typeof UI[name],'function');assert.equal(typeof context.FioriTechSheetUI[name],'function')}
 const result=context.FioriTechSheetUI.correctVersion(freeze(state()),REF,freeze(correction()));
 assert.deepEqual(clone(result),UI.correctVersion(state(),REF,correction()));
});
test('draftCorrection copies the target leaf, date, unknown fields and colors without a confirmation timestamp',()=>{
 const s=freeze(state()),before=JSON.stringify(s),draft=UI.draftCorrection(s,REF,'synthetic-original','synthetic-draft',DRAFTED);
 assert.deepEqual(draft,{...clone(versions(s)[0]),id:'synthetic-draft',createdAt:DRAFTED,supersedesVersionId:'synthetic-original'});
 assert.equal(draft.validFrom,FROM);assert.equal(Object.hasOwn(draft,'correctedAt'),false);
 draft.items[0].colorMap.changed='Changed';draft.items[0].unknownItem.keep.push('Changed');draft.unknownVersion.keep.push('Changed');
 assert.equal(JSON.stringify(s),before);
});
test('draftCorrection on a correction leaf targets that leaf and removes its previous correctedAt',()=>{
 const s=freeze(UI.correctVersion(state(),REF,correction())),before=JSON.stringify(s),draft=UI.draftCorrection(s,REF,'synthetic-correction','synthetic-second',LATER);
 assert.equal(draft.id,'synthetic-second');assert.equal(draft.createdAt,LATER);assert.equal(draft.validFrom,FROM);
 assert.equal(draft.supersedesVersionId,'synthetic-correction');assert.equal(Object.hasOwn(draft,'correctedAt'),false);
 assert.deepEqual(draft.items,versions(s)[1].items);assert.deepEqual(draft.unknownVersion,versions(s)[1].unknownVersion);assert.equal(JSON.stringify(s),before);
});
test('ordinary new-version draft copied from a corrected leaf has no correction metadata',()=>{
 const s=freeze(UI.correctVersion(state(),REF,correction())),draft=UI.draft(s,REF,QUERY,'synthetic-next-date',LATER);
 assert.equal(draft.validFrom,'');assert.equal(Object.hasOwn(draft,'supersedesVersionId'),false);assert.equal(Object.hasOwn(draft,'correctedAt'),false);
 assert.deepEqual(draft.items,versions(s)[1].items);assert.deepEqual(draft.unknownVersion,versions(s)[1].unknownVersion);
});
test('correction append preserves raw originals, unknown JSON, unrelated references and all operational state',()=>{
 const s=freeze(state()),c=freeze(correction()),before=JSON.stringify(s),inputBefore=JSON.stringify(c),next=UI.correctVersion(s,REF,c);
 const expected=clone(s);versions(expected).push(clone(c));assert.deepEqual(next,expected);
 assert.notEqual(next,s);assert.equal(JSON.stringify(versions(next)[0]),JSON.stringify(versions(s)[0]));
 assert.equal(JSON.stringify(s),before);assert.equal(JSON.stringify(c),inputBefore);
});
test('correctVersion copies the new correction so later input edits cannot change its candidate',()=>{
 const s=freeze(state()),c=correction(),next=UI.correctVersion(s,REF,c),saved=JSON.stringify(next);
 c.items[0].qtyPerPair='9';c.items[0].colorMap.changed='Changed';c.unknownVersion.keep.push('Changed');
 assert.equal(JSON.stringify(next),saved);
});
test('multiple corrections remain in history and only the terminal leaf supplies applicable values',()=>{
 const original=freeze(state()),first=UI.correctVersion(original,REF,correction()),secondInput=correction({id:'synthetic-second',supersedesVersionId:'synthetic-correction',createdAt:LATER,correctedAt:LATER,items:[{...version().items[0],qtyPerPair:'1.25'}],salePriceMills:10000});
 const second=freeze(UI.correctVersion(first,REF,secondInput)),thirdInput=correction({id:'synthetic-third',supersedesVersionId:'synthetic-second',createdAt:'2026-03-12T00:00:00.000Z',correctedAt:'2026-03-12T00:01:00.000Z',items:[{...version().items[0],qtyPerPair:'2'}],salePriceMills:12000}),third=UI.correctVersion(second,REF,thirdInput);
 assert.deepEqual(versions(third).map(row=>row.id),['synthetic-original','synthetic-correction','synthetic-second','synthetic-third']);
 assert.equal(JSON.stringify(versions(third).slice(0,3)),JSON.stringify(versions(second)));
 assert.equal(T.applicableVersion(third,REF,QUERY).id,'synthetic-third');assert.equal(calculate(third).costPerPairMills,8400);
 assert.equal(calculate(third).salePriceMills,12000);assert.equal(calculate(third).profitPerPairMills,3600);
 assert.equal(UI.history(third,REF).length,4);assert.equal(T.applicableVersion(third,REF,'2026-02-28'),null);
});
test('a same-date correction changes retrospective applicable content without creating a new effective date',()=>{
 const next=UI.correctVersion(state(),REF,correction());
 assert.equal(T.applicableVersion(next,REF,FROM).id,'synthetic-correction');assert.equal(T.applicableVersion(next,REF,FROM).validFrom,FROM);
 assert.equal(calculate(next,FROM).costPerPairMills,3150);assert.equal(versions(next).length,2);
});
test('ordinary future and past dates retain their own terminal leaves around a corrected middle date',()=>{
 const s=state();versions(s).unshift(version({id:'synthetic-past',validFrom:'2026-01-01'}));versions(s).push(version({id:'synthetic-future',validFrom:'2027-01-01'}));
 const next=UI.correctVersion(freeze(s),REF,correction());
 assert.equal(T.applicableVersion(next,REF,'2026-02-01').id,'synthetic-past');assert.equal(T.applicableVersion(next,REF,QUERY).id,'synthetic-correction');assert.equal(T.applicableVersion(next,REF,'2027-01-01').id,'synthetic-future');
});
test('an identical correction retry is idempotent even after a later correction has superseded it',()=>{
 const input=freeze(correction()),once=UI.correctVersion(state(),REF,input),twice=UI.correctVersion(freeze(once),REF,clone(input));assert.deepEqual(twice,once);assert.equal(versions(twice).length,2);
 const second=UI.correctVersion(twice,REF,correction({id:'synthetic-second',supersedesVersionId:input.id,createdAt:LATER,correctedAt:LATER}));
 const before=JSON.stringify(freeze(second)),replayed=UI.correctVersion(second,REF,clone(input));assert.equal(JSON.stringify(replayed),before);assert.equal(versions(replayed).length,3);
});
test('same correction ID with changed data cannot rewrite an earlier audit row',()=>{
 const s=UI.correctVersion(state(),REF,correction());
 for(const patch of [{note:'Changed'},{validFrom:'2026-03-02'},{salePriceMills:0},{createdAt:LATER},{correctedAt:LATER},{supersedesVersionId:'synthetic-other-ref'},{unknownVersion:{changed:true}}])throwsWithoutMutation(s,()=>UI.correctVersion(s,REF,correction(patch)));
});
test('a target already corrected cannot be corrected again or drafted as a new branch',()=>{
 const s=UI.correctVersion(state(),REF,correction());
 throwsWithoutMutation(s,()=>UI.correctVersion(s,REF,correction({id:'synthetic-branch'})));
 throwsWithoutMutation(s,()=>UI.draftCorrection(s,REF,'synthetic-original','synthetic-branch-draft',LATER));
});
test('correction keeps target date and rejects missing, self-referential and cross-reference targets',()=>{
 for(const patch of [{validFrom:'2026-03-02'},{supersedesVersionId:'missing'},{supersedesVersionId:'synthetic-correction'},{supersedesVersionId:'synthetic-other-ref'},{supersedesVersionId:''},{supersedesVersionId:null}]){const s=state();throwsWithoutMutation(s,()=>UI.correctVersion(s,REF,correction(patch)))}
 for(const target of ['missing','synthetic-other-ref']){const s=state();throwsWithoutMutation(s,()=>UI.draftCorrection(s,REF,target,'synthetic-draft',DRAFTED))}
});
test('correction cannot invent a history for an unknown or mismatched reference',()=>{
 for(const ref of ['986','988','invalid']){const s=state();throwsWithoutMutation(s,()=>UI.correctVersion(s,ref,correction()))}
});
test('an ordinary same-date append remains forbidden after a correction exists',()=>{
 const s=UI.correctVersion(state(),REF,correction());
 throwsWithoutMutation(s,()=>UI.appendVersion(s,REF,version({id:'synthetic-ordinary-same-date',createdAt:LATER})));
});
test('ordinary append rejects correction metadata rather than smuggling a correction command',()=>{
 for(const metadata of [{supersedesVersionId:'synthetic-original'},{correctedAt:CONFIRMED},{supersedesVersionId:'synthetic-original',correctedAt:CONFIRMED}]){
  const s=state();throwsWithoutMutation(s,()=>UI.appendVersion(s,REF,version({id:'synthetic-ordinary-next',validFrom:'2026-04-01',createdAt:LATER,...metadata})));
 }
});
test('correction requires an explicit valid UTC confirmation timestamp after its target creation',()=>{
 for(const correctedAt of [undefined,null,'','2026-02-30T12:00:00.000Z','2026-03-10','2026-03-10T13:05:00-03:00','2026-02-28T23:59:59.999Z']){
  const s=state(),c=correction({correctedAt});if(correctedAt===undefined)delete c.correctedAt;throwsWithoutMutation(s,()=>UI.correctVersion(s,REF,c));
 }
});
test('a correction timestamp cannot precede the prior correction, even if its draft was created earlier',()=>{
 const s=UI.correctVersion(state(),REF,correction()),input=correction({id:'synthetic-early-confirmation',supersedesVersionId:'synthetic-correction',createdAt:DRAFTED,correctedAt:'2026-03-10T13:04:59.999Z'});
 throwsWithoutMutation(s,()=>UI.correctVersion(s,REF,input));
});
test('exactly equal audit timestamps are allowed without an implicit current-time dependency',()=>{
 const s=state(),next=UI.correctVersion(s,REF,correction({createdAt:ORIGINAL,correctedAt:ORIGINAL}));
 assert.equal(T.applicableVersion(next,REF,QUERY).id,'synthetic-correction');
});

for(const [label,mutate] of [
 ['orphan',s=>versions(s).push(correction({supersedesVersionId:'missing'}))],
 ['branch',s=>versions(s).push(correction(),correction({id:'synthetic-branch'}))],
 ['cycle',s=>{versions(s)[0].supersedesVersionId='synthetic-correction';versions(s)[0].correctedAt=CONFIRMED;versions(s).push(correction())}],
 ['self-cycle',s=>versions(s).push(correction({supersedesVersionId:'synthetic-correction'}))],
 ['cross-reference',s=>versions(s).push(correction({supersedesVersionId:'synthetic-other-ref'}))],
 ['changed start',s=>versions(s).push(correction({validFrom:'2026-03-02'}))],
 ['missing correctedAt',s=>{const c=correction();delete c.correctedAt;versions(s).push(c)}],
 ['orphan correctedAt',s=>versions(s).push(version({id:'synthetic-orphan-time',validFrom:'2026-04-01',correctedAt:CONFIRMED}))],
 ['duplicate ID',s=>versions(s).push(correction({id:'synthetic-original'}))],
 ['same-date roots',s=>versions(s).push(version({id:'synthetic-second-root'}))]
])test('malformed correction history fails closed: '+label,()=>{
 const s=state();mutate(s);freeze(s);const before=JSON.stringify(s);
 assert.throws(()=>T.applicableVersion(s,REF,QUERY));assert.throws(()=>UI.history(s,REF));
 const result=calculate(s);assert.equal(result.costPerPairMills,null);assert.equal(result.costPerSheetMills,null);assert.equal(result.status,'a_conferir');assert.ok(result.issues.length>0);
 assert.throws(()=>UI.correctVersion(s,REF,correction({id:'synthetic-next'})));assert.equal(JSON.stringify(s),before);
});
test('correction validates quantities, sales, identities and active materials just like a new version',()=>{
 for(const patch of [{items:[]},{items:[{...version().items[0],qtyPerPair:'0'}]},{items:[{...version().items[0],qtyPerPair:'1e2'}]},{salePriceMills:null},{salePriceMills:-1},{salePriceMills:'1'},{id:' '},{createdAt:'invalid'}]){
  const s=state();throwsWithoutMutation(s,()=>UI.correctVersion(s,REF,correction(patch)));
 }
 const inactive=state();inactive.settings.materials[0].active=false;throwsWithoutMutation(inactive,()=>UI.correctVersion(inactive,REF,correction()));
});
test('correction accepts explicit zero sale and missing price, keeping incomplete valuation visible',()=>{
 const s=state();s.settings.materials[0].prices=[];const next=UI.correctVersion(freeze(s),REF,correction({salePriceMills:0})),result=calculate(next);
 assert.equal(versions(next).length,2);assert.equal(result.salePriceMills,0);assert.equal(result.costPerSheetMills,null);assert.ok(result.issues.some(row=>row.code==='missing_price'));
});
test('correction permits grouped consumption with no grade and does not fabricate weighted totals',()=>{
 const s=freeze(state()),c=correction({sizeGroups:['35-37','38-39'],items:[{...version().items[0],qtyBySizeGroup:{'35-37':'0.5','38-39':'1'}}]}),next=UI.correctVersion(s,REF,c),result=calculate(next);
 assert.equal(versions(next).length,2);assert.deepEqual(result.sizeGroups.map(row=>row.costPerPairMills),[2100,4200]);assert.equal(result.costPerSheetMills,null);
 assert.equal(Object.hasOwn(next.settings,'sheetPatterns'),false);
});

test('versionHistory exposes independent copies of every row and its direct correction successor',()=>{
 const first=UI.correctVersion(state(),REF,correction()),second=UI.correctVersion(first,REF,correction({id:'synthetic-second',supersedesVersionId:'synthetic-correction',createdAt:LATER,correctedAt:LATER}));
 freeze(second);const before=JSON.stringify(second),history=T.versionHistory(second,REF);
 assert.deepEqual(history.map(row=>[row.version.id,row.correctedBy?.id||null]),[['synthetic-original','synthetic-correction'],['synthetic-correction','synthetic-second'],['synthetic-second',null]]);
 history[0].version.items[0].colorMap.changed='Changed';history[0].correctedBy.items[0].qtyPerPair='9';history[1].correctedBy.unknownVersion.keep.push('Changed');
 assert.equal(JSON.stringify(second),before);assert.equal(history[1].version.items[0].qtyPerPair,'0.75');
 assert.deepEqual(T.versionHistory({},REF),[]);assert.deepEqual(T.versionHistory({settings:{techSheets:{}}},REF),[]);
});
test('pure correction candidates can target a past or future leaf without reading a clock',()=>{
 const s=state();versions(s).push(version({id:'synthetic-future',validFrom:'2027-01-01'}));freeze(s);
 const past=UI.correctVersion(s,REF,correction());
 const future=UI.correctVersion(past,REF,correction({id:'synthetic-future-correction',validFrom:'2027-01-01',supersedesVersionId:'synthetic-future',createdAt:LATER,correctedAt:LATER}));
 assert.equal(T.applicableVersion(future,REF,QUERY).id,'synthetic-correction');assert.equal(T.applicableVersion(future,REF,'2027-01-01').id,'synthetic-future-correction');
});
test('legacy original version with no createdAt can be corrected without rewriting the legacy row',()=>{
 const s=state();delete versions(s)[0].createdAt;freeze(s);const before=JSON.stringify(versions(s)[0]),next=UI.correctVersion(s,REF,correction());
 assert.equal(JSON.stringify(versions(next)[0]),before);assert.equal(Object.hasOwn(versions(next)[0],'createdAt'),false);assert.equal(T.applicableVersion(next,REF,QUERY).id,'synthetic-correction');
});
test('correctedAt cannot precede the new correction draft creation timestamp',()=>{
 const s=state();throwsWithoutMutation(s,()=>UI.correctVersion(s,REF,correction({createdAt:LATER,correctedAt:CONFIRMED})));
});
test('timestamps must respect append order even when corrections belong to separate date chains',()=>{
 const s=state();versions(s).push(version({id:'synthetic-future',validFrom:'2027-01-01'}));
 const first=UI.correctVersion(s,REF,correction({createdAt:LATER,correctedAt:LATER}));
 const second=correction({id:'synthetic-future-correction',validFrom:'2027-01-01',supersedesVersionId:'synthetic-future',createdAt:DRAFTED,correctedAt:CONFIRMED});
 throwsWithoutMutation(first,()=>UI.correctVersion(first,REF,second));
});
test('forward correction links are rejected even if their target appears later in the same reference',()=>{
 const s=state();versions(s).unshift(correction());freeze(s);
 assert.throws(()=>T.versionHistory(s,REF));assert.throws(()=>T.applicableVersion(s,REF,QUERY));
});
test('projection of a saved correction drops chain-only metadata in memory without changing the version',()=>{
 const s=freeze(UI.correctVersion(state(),REF,correction())),selected=freeze(T.applicableVersion(s,REF,QUERY)),before=JSON.stringify(s),selectedBefore=JSON.stringify(selected);
 const result=UI.project(s,REF,selected,QUERY);assert.equal(result.costPerPairMills,3150);assert.equal(result.versionId,selected.id);assert.deepEqual(result.issues,[]);
 assert.equal(JSON.stringify(s),before);assert.equal(JSON.stringify(selected),selectedBefore);assert.equal(selected.supersedesVersionId,'synthetic-original');
});
