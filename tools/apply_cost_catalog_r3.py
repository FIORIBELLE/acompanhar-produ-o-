"""Small verified code-only patch; no production values, credentials or data writes."""
from pathlib import Path
import hashlib, re, subprocess, tempfile
p=Path('index.html'); raw=p.read_bytes()
sha=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
if sha!='b450d60fdfc8e7b43c40b43a03030fd99ee64f17':
    raise SystemExit('Source changed: inspect before reapplying')
s=raw.decode()
def replace(old,new):
    global s
    if s.count(old)!=1: raise AssertionError(f'Non-unique patch target: {old[:80]}')
    s=s.replace(old,new)
replace('  const refs=Object.values(CATALOG).sort(', '  const catalogSheet=ref=>{const key=String(ref).toUpperCase();return data.settings.costCatalog?.[key]||CATALOG[key]||null};\n  const refs=Object.values(CATALOG).sort(')
replace('    const catalog=CATALOG[key]||{};', '    const catalog=catalogSheet(key)||{};')
replace('(CATALOG[String(ref)]||local||null)', '(catalogSheet(ref)||local||null)')
replace('const map=new Map(refs.map(x=>[String(x.ref),x]));', 'const map=new Map([...refs,...Object.values(data.settings.costCatalog||{})].map(x=>[String(x.ref),x]));')
replace('  data.stockCatalogUpdatedAt=catalogUpdatedAt;', '  // Read-only catalog timestamp; never overwrite the online revision during rendering.')
replace('format(new Date(catalogUpdatedAt));', 'format(new Date(data.settings.costCatalogUpdatedAt||data.stockCatalogUpdatedAt||catalogUpdatedAt));')
replace('Soma dos valores calculáveis dos 4 setores.', 'Soma dos valores calculáveis dos 4 setores, pelos custos padrão vigentes. Não representa pagamentos históricos.')
replace('v2026.10.06-r2','v2026.10.06-r3')
a=s.index('  const CATALOG='); b=s.index('  if(!Array.isArray(data.stockLedger))',a)
resolver=s[a:b]
tests=r'''
const assert=require('node:assert/strict');
let data={settings:{models:[],costCatalog:{}}};
const catalog=[{ref:'501',model:'Fixture',line:'500',cabedal:1,solado:2,palmilha:3,total:9,complete:true,usesPalmilha:true}, {ref:'601',model:'Other line',line:'600',cabedal:4,solado:5,palmilha:6,total:19,complete:true,usesPalmilha:true}];
const modelLine=()=> '500';
__RESOLVER__
assert.equal(sheetForRef('501').total,9);
data.settings.costCatalog={'501':{...catalog[0],solado:20,palmilha:30,total:59}};
assert.equal(sheetForRef('501').total,59);
assert.equal(sheetForRef('501').solado,20);
assert.equal(allRefSheets().find(x=>x.ref==='501').palmilha,30);
data.settings.models=[{id:'a',ref:'501',name:'501 Fixture',line:'500',cabedalCost:7,totalCost:65}];
assert.equal(sheetForRef('501').cabedal,7);
assert.equal(sheetForRef('501').palmilha,30);
assert.equal(sheetForRef('601').total,19);
data.settings.costCatalog['513']={ref:'513',model:'Incomplete',line:'500',cabedal:null,total:60,solado:20,palmilha:30,complete:false,usesPalmilha:true};
assert.equal(sheetForRef('513').complete,false);
assert.equal(sheetForRef('513').cabedal,null);
assert.equal(sheetForRef('999'),null);
assert.equal(allRefSheets().filter(x=>x.ref==='501').length,1);
const copy=JSON.stringify(data);allRefSheets();sheetForRef('501');assert.equal(JSON.stringify(data),copy);
console.log('12 isolated cost-resolution checks passed');
'''.replace('__RESOLVER__',resolver)
with tempfile.TemporaryDirectory() as td:
    test=Path(td)/'cost-test.cjs';test.write_text(tests)
    subprocess.run(['node',str(test)],check=True)
    for i,body in enumerate(re.findall(r'<script\b[^>]*>(.*?)</script>',s,re.S)):
        js=Path(td)/f'inline-{i}.js';js.write_text(body)
        subprocess.run(['node','--check',str(js)],check=True)
p.write_text(s)
sw=Path('sw.js');c=sw.read_text()
assert c.count('acompanhar-producao-shell-v16')==1
sw.write_text(c.replace('acompanhar-producao-shell-v16','acompanhar-producao-shell-v17'))
print('Code-only r3 patch validated; no app data changed')
