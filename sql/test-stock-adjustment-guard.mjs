// Isolated PostgreSQL/WASM tests only. This runner never connects to Supabase.
// npm install --prefix /tmp/fiori-sql-runtime --save-exact @electric-sql/pglite@0.5.8
// FIORI_PGLITE_MODULE=/tmp/fiori-sql-runtime/node_modules/@electric-sql/pglite/dist/index.js node sql/test-stock-adjustment-guard.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const modulePath = process.env.FIORI_PGLITE_MODULE || '@electric-sql/pglite';
const { PGlite } = await import(modulePath);
const db = new PGlite();
const sql = fs.readFileSync(new URL('./stock-adjustment-guard.sql', import.meta.url), 'utf8');
const clone = x => JSON.parse(JSON.stringify(x));
const model = (id,ref,line='500') => ({id,ref,line,name:`Modelo ${ref}`,usesPalmilha:line!=='300'});
const movement = (id,kind,qty=100,more={}) => ({id,kind,qty,date:'2026-10-01',mountingId:'a',modelId:'m506',line:'500',color:'Preto',...more});
const legacy = {id:'legacy-global',qty:50,date:'2026-10-01',direction:'in',sector:'cabedal',ref:'506',color:'Preto',note:''};
const base = {
  settings:{models:[model('m506','506'),model('m507','507'),model('m319','319','300')],mountings:[{id:'a',name:'A'},{id:'b',name:'B'}]},
  weeks:{w:{entries:[movement('cab','cabedal'),movement('sole','solado'),movement('insole','palmilha')]}},
  stockLedger:[legacy],factoryExpenses:[],financialSentinel:{doNotChange:123}
};
const adj = more => ({id:'adjust-a',adjustmentVersion:1,adjustmentBatchId:'batch-a',reason:'Contagem física conferida',date:'2026-10-11',direction:'in',sector:'cabedal',ref:'506',color:'Preto',qty:3,note:'',createdAt:'2026-10-11T18:00:00.000Z',mountingId:'a',...more});
const append = (s,...rows) => ({...clone(s),stockLedger:[...clone(s.stockLedger),...rows]});
const omit = (o,...keys) => Object.fromEntries(Object.entries(o).filter(([k])=>!keys.includes(k)));
const withA=append(base,adj());
const rev=adj({id:'reversal-a',adjustmentBatchId:'batch-r',direction:'out',reversalOf:'adjust-a'});
const withR=append(withA,rev);
const cases=[];
const test=(name,old,next,ok=true,pattern='')=>cases.push({name,old,next,ok,pattern});
test('unchanged legacy state',base,base);
test('local cabedal input',base,withA);
test('local cabedal output',base,append(base,adj({direction:'out'})));
test('global cabedal input',base,append(base,omit(adj(),'mountingId')));
test('global cabedal output only outside amount',base,append(base,omit(adj({direction:'out',qty:50}),'mountingId')));
test('global finished product',base,append(base,omit(adj({sector:'produto_pronto'}),'mountingId')));
test('canonical local solado',base,append(base,adj({sector:'solado',ref:'@line:500'})));
test('canonical local palmilha',base,append(base,adj({sector:'palmilha',ref:'@line:500'})));
test('reversal of saved input',withA,withR);
const out=append(base,adj({direction:'out'}));
test('reversal of saved output',out,append(out,{...rev,direction:'in'}));
test('unchanged protected state',withA,withA);
test('unrelated settings rename allowed',withA,{...withA,settings:{...withA.settings,mountings:[{id:'a',name:'New name'},{id:'b',name:'B'}]}});
test('reject duplicated target even with net zero',base,append(base,adj({id:'first',direction:'out',qty:180}),adj({id:'second',direction:'in',qty:180})),false);
test('accent and alias normalize together',base,append(base,adj({direction:'out',color:'  PRÉTO  '})));
test('reject empty color; use explicit undiscriminated label',base,append(base,adj({color:''})),false);
for(const field of ['color','reason','adjustmentBatchId'])for(const whitespace of ['\t\n','\u00a0\ufeff']) {
 test(`reject Unicode-whitespace-only ${field} ${JSON.stringify(whitespace)}`,base,append(base,adj({[field]:whitespace})),false);
}
test('explicit undiscriminated color accepted',base,append(base,adj({color:'Sem cor discriminada'})));
test('reject future adjustment date',base,append(base,adj({date:'9999-12-31'})),false,'posterior');
for(const [field,value] of [['adjustmentVersion',null],['adjustmentVersion',false],['adjustmentVersion','1'],['adjustmentVersion',2],['adjustmentBatchId',''],['reason',' '],['reason','x'.repeat(501)],['reason',null],['date','2026-02-30'],['date','2026-1-01'],['date','0000-01-01'],['qty',0],['qty',-1],['qty',1.5],['qty','2'],['qty',9007199254740992],['createdAt','today'],['createdAt','2026-02-30T00:00:00Z'],['mountingId',null],['mountingId','unknown'],['direction','debit'],['sector','finished'],['ref','unknown'],['ref',' 506'],['id',''],['id',null],['color',null],['note',null]]) {
 test(`reject ${field}=${JSON.stringify(value).slice(0,35)}`,base,append(base,adj({[field]:value})),false);
}
test('reject unsupported additional properties',base,append(base,adj({inputQty:3})),false);
test('reject missing version with mounting',base,append(base,omit(adj(),'adjustmentVersion')),false);
test('reject mounting added to legacy row',base,{...base,stockLedger:[{...legacy,mountingId:'a'}]},false);
test('reject legacy converted to adjustment',base,{...base,stockLedger:[{...adj(),id:legacy.id}]},false);
test('reject adjustment through INSERT',{},withA,false);
test('reject local finished product',base,append(base,adj({sector:'produto_pronto'})),false);
test('reject noncanonical component reference',base,append(base,adj({sector:'solado',ref:'506'})),false);
test('reject missing line',base,append(base,adj({sector:'solado',ref:'@line:900'})),false);
test('reject duplicate ledger id',base,append(base,adj(),adj()),false);
test('reject production id shadow',base,append(base,adj({id:'cab'})),false);
test('reject duplicate model ref', {...base,settings:{...base.settings,models:[...base.settings.models,model('another','506')]}}, append({...base,settings:{...base.settings,models:[...base.settings.models,model('another','506')]}},adj()),false);
test('reject simultaneous production edit',base,{...withA,weeks:{w:{entries:[]}}},false);
test('reject simultaneous finances edit',base,{...withA,financialSentinel:{doNotChange:999}},false);
test('reject simultaneous legacy edit',base,{...withA,stockLedger:[{...legacy,qty:51},adj()]},false);
test('reject new adjustment plus legacy append',base,append(base,adj(),{...legacy,id:'new-legacy'}),false);
test('reject reused batch id with new entry id',withA,append(withA,adj({id:'second-in-saved-batch',sector:'solado',ref:'@line:500'})),false,'lote novo');
test('reject two new batch ids',base,append(base,adj(),adj({id:'second',adjustmentBatchId:'another',sector:'solado',ref:'@line:500'})),false,'lote novo');
for(const field of ['date','reason','createdAt']) {
 const value={date:'2026-10-10',reason:'Different reason',createdAt:'2026-10-11T19:00:00Z'}[field];
 test(`reject divergent batch ${field}`,base,append(base,adj(),adj({id:'second',sector:'solado',ref:'@line:500',[field]:value})),false,'mesma data');
}
test('reject duplicate color-alias target in batch',base,append(base,adj({color:'Rose'}),adj({id:'second',color:'rosa'})),false,'Item repetido');
for(const color of ['\tPreto\t','\nPreto\r','\u00a0Preto\u00a0','\u1680Preto\u2000','\u202fPreto\u205f','\ufeffPreto\u3000']) {
 test(`reject duplicate Unicode whitespace color ${JSON.stringify(color)}`,base,append(base,adj(),adj({id:'second',color})),false,'Item repetido');
 test(`Unicode whitespace withdrawal uses original color ${JSON.stringify(color)}`,base,append(base,adj({color,direction:'out'})));
}
test('reject aggregate balance above safe integer',base,append(base,adj({qty:9007199254740991})),false,'Saldo');
test('reject adjustment reordered ahead of old ledger',base,{...base,stockLedger:[adj(),legacy]},false);
test('reject deleting protected record',withA,base,false);
test('reject deleting ledger',withA,omit(withA,'stockLedger'),false);
for(const field of Object.keys(adj())) {
 test(`reject removal of saved field ${field}`,withA,{...withA,stockLedger:[legacy,omit(adj(),field)]},false);
}
test('reject adjustment edit',withA,{...withA,stockLedger:[legacy,adj({note:'rewritten'})]},false);
test('reject negative global',base,append(base,omit(adj({direction:'out',qty:10000}),'mountingId')),false,'Saldo');
test('reject negative local even with sufficient global',base,append(base,adj({direction:'out',qty:101})),false,'mounting');
test('reject global smaller than mounting sum',base,append(base,omit(adj({direction:'out',qty:51}),'mountingId')),false,'outside');
test('reject backdated local deficit',base,append(base,adj({direction:'out',date:'2026-09-30'})),false,'Saldo');
test('reject backdated global deficit',base,append(base,omit(adj({direction:'out',date:'2026-09-30'}),'mountingId')),false,'Saldo');
test('reject withdrawal from another mounting',base,append(base,adj({mountingId:'b',direction:'out'})),false,'mounting');
test('reject withdrawal in another color',base,append(base,adj({direction:'out',color:'Rose'})),false,'Saldo');
test('reject canonical line withdrawal too large',base,append(base,adj({direction:'out',sector:'solado',ref:'@line:500',qty:101})),false,'Saldo');
for(const [field,value] of [['direction','in'],['qty',2],['sector','solado'],['ref','507'],['color','preto'],['mountingId','b'],['date','2026-10-10'],['reversalOf','missing']]) {
 test(`reject reversal mismatch ${field}`,withA,append(withA,{...rev,[field]:value}),false);
}
test('reject reversal removes mounting',withA,append(withA,omit(rev,'mountingId')),false);
test('reject same-operation origin and reversal',base,append(base,adj(),rev),false);
test('reject second reversal',withR,append(withR,{...rev,id:'another-reversal'}),false);
test('reject reversal of reversal',withR,append(withR,{...rev,id:'reverse-reversal',direction:'in',reversalOf:rev.id}),false);
test('reject reversal of legacy',base,append(base,{...rev,reversalOf:legacy.id}),false);
test('normal legacy write after reversal',withR,append(withR,{...legacy,id:'normal-after-reversal'}));
test('unrelated settings write after reversal',withR,{...withR,financialSentinel:{doNotChange:124}});
test('reject new stock invalidity after saved adjustment',withA,append(withA,{...legacy,id:'bad-oldstyle',direction:'out',qty:10000}),false);
const beforeConsume=append(base,adj({qty:5,ref:'507'}));
test('reject later production overdraw',beforeConsume,{...beforeConsume,weeks:{w:{entries:[...base.weeks.w.entries,movement('newfinished','finished',6,{modelId:'m507',date:'2026-10-12'})]}}},false,'Saldo');
const noDelivery={...base,weeks:{w:{entries:[]}},stockLedger:[]};
const received=append(noDelivery,adj({qty:5}),adj({id:'as',sector:'solado',ref:'@line:500',qty:5}),adj({id:'ap',sector:'palmilha',ref:'@line:500',qty:5}));
const consumed={...received,weeks:{w:{entries:[movement('produced','finished',5,{date:'2026-10-12'})]}}};
test('new production consumes adjusted materials',received,consumed);
const fullReversal=received.stockLedger.map((e,i)=>({...e,id:`rv-${i}`,adjustmentBatchId:'reverse-all',direction:'out',reversalOf:e.id}));
test('complete batch reversal',received,append(received,...fullReversal));
test('reject partial batch reversal',received,append(received,fullReversal[0]),false,'completo');
test('reject mixed adjustment and reversal',received,append(received,...fullReversal,adj({id:'extra',adjustmentBatchId:'reverse-all',ref:'507'})),false,'misture');
test('reject reversal that invalidates subsequent production',consumed,append(consumed,...fullReversal),false,'Saldo');
const reparent=clone(withA);reparent.settings.models[0].id='model-replaced';for(const e of reparent.weeks.w.entries)e.modelId='model-replaced';
test('reject reinterpretation of saved local model',withA,reparent,false,'outro modelo');

await db.exec('CREATE SCHEMA private; CREATE ROLE anon; CREATE ROLE authenticated; CREATE TABLE public.app_state (workspace_id uuid PRIMARY KEY, data jsonb NOT NULL); GRANT SELECT,INSERT,UPDATE,DELETE ON public.app_state TO authenticated;');
await db.exec(sql);
const id='11111111-1111-4111-8111-111111111111';
const results=[];
async function runCase(t) {
 await db.exec('RESET ROLE; ALTER TABLE public.app_state DISABLE TRIGGER trg_stock_adjustments_guard_v1; DELETE FROM public.app_state;');
 await db.query('INSERT INTO public.app_state VALUES ($1,$2)',[id,t.old]);
 await db.exec('ALTER TABLE public.app_state ENABLE TRIGGER trg_stock_adjustments_guard_v1; SET ROLE authenticated;');
 let ok=true,error='';
 try {await db.query('UPDATE public.app_state SET data=$1 WHERE workspace_id=$2',[t.next,id]);}catch(e){ok=false;error=e.message;}
 assert.equal(ok,t.ok,`${t.name}: ${error || 'accepted unexpectedly'}`);
 if(t.pattern)assert.match(error,new RegExp(t.pattern),t.name);
 const after=(await db.query('SELECT data FROM public.app_state WHERE workspace_id=$1',[id])).rows[0].data;
 assert.deepEqual(after,t.ok?t.next:t.old,`${t.name}: atomic state persistence`);
 results.push({name:t.name,passed:true,...(!ok?{rejection:error}:{})});
}
for(const t of cases)await runCase(t);
// DELETE protection and the real INSERT trigger entrypoint.
await runCase({name:'prepare delete case',old:withA,next:withA,ok:true});
await assert.rejects(db.query('DELETE FROM public.app_state WHERE workspace_id=$1',[id]),/não pode ser apagada/);
await assert.rejects(db.query('INSERT INTO public.app_state VALUES ($1,$2)',['00000000-0000-0000-0000-000000000001',withA]),/Salve o ajuste separadamente/);
results.push({name:'actual DELETE and INSERT entrypoints reject protected changes',passed:true});
const acl=(await db.query("SELECT p.prosecdef, has_function_privilege('authenticated',p.oid,'EXECUTE') AS execute, has_schema_privilege('authenticated','private','USAGE') AS usage FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='guard_stock_adjustments_v1'")).rows[0];
assert.deepEqual(acl,{prosecdef:false,execute:false,usage:false});
results.push({name:'SECURITY INVOKER works with no private USAGE or function EXECUTE grant',passed:true});
if(process.env.FIORI_REV56_SNAPSHOT){
 const snapshot=JSON.parse(fs.readFileSync(process.env.FIORI_REV56_SNAPSHOT,'utf8'));
 assert.equal(snapshot.revision,56);
 const real=snapshot.data;
 const realAdj=adj({mountingId:process.env.FIORI_TARGET_MOUNTING,ref:process.env.FIORI_TARGET_REF,qty:1});
 if(!realAdj.mountingId||!realAdj.ref)throw Error('Snapshot tests require FIORI_TARGET_MOUNTING and FIORI_TARGET_REF');
 await runCase({name:'revision 56 local cabedal input',old:real,next:append(real,realAdj),ok:true});
 await runCase({name:'revision 56 local cabedal output',old:real,next:append(real,{...realAdj,direction:'out'}),ok:true});
 await runCase({name:'revision 56 local solado input',old:real,next:append(real,{...realAdj,sector:'solado',ref:'@line:500'}),ok:true});
 await runCase({name:'revision 56 immutable finance and sales payloads',old:real,next:append(real,realAdj),ok:true});
 const Inventory=require('../inventory-guard.js'),Adjust=require('../stock-adjustment.js');
 const options={today:'2026-10-11',now:'2026-10-11T21:00:00Z',inventory:Inventory};
 const preview=Adjust.previewReset(real,{date:options.today},options);
 assert.deepEqual(preview.issues,[]);
 const reset=Adjust.createBatch(real,{batchId:'sql-reset-test',date:options.today,reason:'Teste integral isolado',rows:preview.rows},options);
 const reversed=Adjust.reverseBatch(reset,{batchId:'sql-reverse-test',originalBatchId:'sql-reset-test',date:options.today,reason:'Estorno isolado'},options);
 await runCase({name:`revision 56 full ${preview.rows.length}-item reset from app engine`,old:real,next:reset,ok:true});
 await runCase({name:`revision 56 full ${preview.rows.length}-item reversal from app engine`,old:reset,next:reversed,ok:true});
 if(process.env.FIORI_EXISTING_FUNCTIONS){
   await runCase({name:'prepare existing-trigger integration',old:real,next:real,ok:true});
   await db.exec('RESET ROLE');
   const definitions=JSON.parse(fs.readFileSync(process.env.FIORI_EXISTING_FUNCTIONS,'utf8'));
   for(const name of ['fiori_assembly_check_v1','fiori_finance_check_v1','fiori_sales_check_v1','guard_finance_updates_r5','guard_sales_updates_r7']) {
     await db.exec(definitions.find(f=>f.proname===name).definition);
   }
   await db.exec('CREATE TRIGGER trg_finance_guard_r5 BEFORE INSERT OR UPDATE OF data ON public.app_state FOR EACH ROW EXECUTE FUNCTION private.guard_finance_updates_r5(); CREATE TRIGGER trg_sales_guard_r7 BEFORE INSERT OR UPDATE OF data ON public.app_state FOR EACH ROW EXECUTE FUNCTION private.guard_sales_updates_r7(); SET ROLE authenticated;');
   await db.query('UPDATE public.app_state SET data=$1 WHERE workspace_id=$2',[reset,id]);
   await db.query('UPDATE public.app_state SET data=$1 WHERE workspace_id=$2',[reversed,id]);
   assert.deepEqual((await db.query('SELECT data FROM public.app_state WHERE workspace_id=$1',[id])).rows[0].data,reversed);
   assert.deepEqual(omit(reversed,'stockLedger'),omit(real,'stockLedger'));
   results.push({name:'revision 56 app reset and reversal under original finance/sales triggers and new stock trigger',passed:true,resetRows:preview.rows.length});
 }
}
await db.close();
const report={engine:'@electric-sql/pglite 0.5.8',operationalWrites:0,passed:results.length,results};
const outputFile=process.env.FIORI_SQL_REPORT;
if(outputFile)fs.writeFileSync(outputFile,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:results.length,operationalWrites:0,acl}));
