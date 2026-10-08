/* Fiori Belle standard sheets. Pure JSON candidates only: no persistence or backfill.
 * A sheet is exactly 72 pairs; each saved row is one meaningful color, with its
 * confirmed size breakdown. Inventory and assembly remain the authoritative engines.
 */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.FioriSheets=api;
})(typeof globalThis==='object'?globalThis:this,function(root){
  'use strict';
  const PAIRS_PER_SHEET=72,SIZES=Object.freeze(['35','36','37','38','39']);
  const SECTORS=Object.freeze(['cabedal','solado','palmilha','produto_pronto']);
  const copy=value=>JSON.parse(JSON.stringify(value));
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const fold=value=>String(value??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');
  function fail(code,message){const error=new Error(message);error.code=code;throw error}
  function inventory(options={}){
    const api=options.inventory||root.FioriInventory||(typeof require==='function'?require('./inventory-guard'):null);
    if(!api||typeof api.ledger!=='function'||typeof api.colorKey!=='function')fail('missing_inventory','Atualize o app para carregar a conferência de estoque.');
    return api;
  }
  function assembly(options={}){
    const api=options.assembly||root.FioriAssembly||(typeof require==='function'?require('./assembly-finance'):null);
    if(!api||typeof api.createFinished!=='function'||typeof api.obligations!=='function')fail('missing_assembly','Atualize o app para carregar a montagem a pagar.');
    return api;
  }
  function integer(value,label,zero=false){
    if(!Number.isSafeInteger(value)||value<(zero?0:1))fail('invalid_quantity',label+' deve ser um número inteiro '+(zero?'não negativo':'positivo')+' dentro do limite de precisão.');
    return value;
  }
  function add(a,b){return integer(a+b,'Total de pares',true)}
  function multiply(a,b){return integer(a*b,'Total de pares',true)}
  function sheetTotal(sheets){
    if(!Number.isSafeInteger(sheets)||sheets<=0)fail('invalid_sheets','Use uma quantidade inteira de fichas maior que zero. Para frações, informe os pares com a grade confirmada.');
    return multiply(sheets,PAIRS_PER_SHEET);
  }
  function identifier(value,label){
    if(typeof value!=='string'||!value.trim()||value!==value.trim())fail('invalid_id',label+' inválido.');
    return value;
  }
  function configState(state){
    if(!object(state)||!object(state.settings))fail('invalid_state','Configuração da ficha inválida.');
    if(state.settings.models!==undefined&&!Array.isArray(state.settings.models))fail('invalid_state','Modelos inválidos.');
    return state;
  }
  function lineValue(value){
    const line=String(value??'').replace(/^@?line:/i,'').trim();
    if(!/^[1-9]00$/.test(line))fail('invalid_line','Selecione uma linha válida.');
    return line;
  }
  function refValue(value){
    const ref=String(value??'').trim().toUpperCase();
    if(!/^[1-9]\d{2}R?$/.test(ref))fail('invalid_ref','Selecione uma referência válida.');
    return ref;
  }
  function selection(state,input={},options={}){
    configState(state);if(!object(input))fail('invalid_target','Selecione a linha ou referência.');
    const I=inventory(options),models=state.settings.models||[];
    let model,ref=input.ref?refValue(input.ref):'',line=input.line?lineValue(input.line):'';
    if(input.modelId){
      const matches=models.filter(m=>m&&m.id===input.modelId);
      if(matches.length!==1)fail('invalid_model','Selecione um modelo válido e sem duplicidade.');
      model=matches[0];const modelRef=refValue(I.refOf(model));
      if(ref&&ref!==modelRef)fail('target_mismatch','A referência não corresponde ao modelo selecionado.');
      ref=modelRef;
    }else if(ref){
      const matches=models.filter(m=>m&&I.refOf(m)===ref);
      if(matches.length>1)fail('invalid_model','A referência tem mais de um modelo; confira o cadastro.');
      model=matches[0];
    }
    if(ref){
      const fromRef=ref[0]+'00',fromModel=model?.line?lineValue(model.line):fromRef;
      if(fromModel!==fromRef||(line&&line!==fromModel))fail('target_mismatch','A linha não corresponde à referência selecionada.');
      line=fromModel;
    }
    if(!line)fail('invalid_line','Selecione uma linha ou referência para a ficha.');
    return {line,ref,model};
  }
  function meaningfulColor(value,I){
    if(typeof value!=='string')fail('invalid_color','Informe uma cor identificada para cada linha da grade.');
    const label=value.trim().replace(/\s+/g,' '),key=I.colorKey(label);
    const generic=['n/a','na','nenhuma','nenhum','desconhecida','desconhecido','indefinida','indefinido','diversas','diversos','variadas','variados','mista','misto','mix','multicor','a definir','nao definida','nao definido','sem informacao','sem identificacao','outros','outras'];
    if(!label||key===I.UNKNOWN||generic.includes(fold(label))||!/[\p{L}]/u.test(label)||label.length>80)fail('unknown_color','A ficha precisa de cores identificadas. “Sem cor discriminada” só pode ser escolhido no lançamento simples em pares ou kits.');
    return {key,color:I.colorLabel(key)};
  }
  function validateRows(rows,{expectedTotal,inventory:givenInventory}={}){
    const I=inventory({inventory:givenInventory});
    if(!Array.isArray(rows)||!rows.length)fail('empty_grid','Preencha pelo menos uma cor com sua grade de tamanhos.');
    const seen=new Set();let total=0;
    const normalized=rows.map(row=>{
      if(!object(row))fail('invalid_grid','Linha de grade inválida.');
      const c=meaningfulColor(row.color,I);
      if(seen.has(c.key))fail('duplicate_color','Há uma cor repetida na grade: '+c.color+'.');seen.add(c.key);
      const sizes=row.sizeBreakdown;
      if(!object(sizes))fail('invalid_sizes','Informe os tamanhos de 35 a 39 para cada cor.');
      if(Object.keys(sizes).some(size=>!SIZES.includes(size)))fail('invalid_sizes','Use somente os tamanhos 35, 36, 37, 38 e 39, sem repetição.');
      const sizeBreakdown={};let qty=0;
      for(const size of SIZES){const value=Object.hasOwn(sizes,size)?sizes[size]:0;sizeBreakdown[size]=integer(value,'Pares do tamanho '+size,true);qty=add(qty,value)}
      if(row.qty!==undefined&&row.qty!==qty)fail('row_total_mismatch','O total da cor '+c.color+' não corresponde à soma dos tamanhos.');
      total=add(total,qty);return {color:c.color,sizeBreakdown,qty};
    }).filter(row=>row.qty>0);
    if(total===0)fail('empty_grid','A grade precisa conter pelo menos um par.');
    if(expectedTotal!==undefined){integer(expectedTotal,'Total esperado');if(total!==expectedTotal)fail('total_mismatch','A grade soma '+total+' pares; deve somar '+expectedTotal+' pares. Ajuste os tamanhos ou a quantidade de fichas.')}
    return {rows:normalized,total};
  }
  function normalizedTemplate(state,input,options={}){
    if(!object(input)||!['line','ref'].includes(input.scope))fail('invalid_pattern','Escolha um padrão por linha ou por referência.');
    const target=input.scope==='line'?lineValue(input.target):refValue(input.target);
    const context=selection(state,input.scope==='line'?{line:target}:{ref:target,line:input.line},options);
    if(input.scope==='line'&&input.line!==undefined&&lineValue(input.line)!==target)fail('target_mismatch','A linha do padrão diverge do destino escolhido.');
    const validated=validateRows(input.rows,{expectedTotal:PAIRS_PER_SHEET,inventory:options.inventory});
    if(validated.rows.length!==input.rows.length)fail('empty_color','Cada cor do padrão precisa ter pelo menos um par. Remova as cores sem pares.');
    return {scope:input.scope,target,line:context.line,rows:validated.rows,total:PAIRS_PER_SHEET};
  }
  function configuredTemplates(state,options={}){
    configState(state);const config=state.settings.sheetPatterns;
    if(config===undefined)return [];
    if(!object(config)||config.version!==1||!Array.isArray(config.templates))fail('invalid_patterns','Configuração de fichas incompatível. Confira os padrões antes de lançar.');
    const seen=new Set();return config.templates.map(template=>{
      const normalized=normalizedTemplate(state,template,options),key=normalized.scope+':'+normalized.target;
      if(seen.has(key))fail('duplicate_pattern','Há mais de um padrão para a mesma linha ou referência.');seen.add(key);return normalized;
    });
  }
  function defaultTemplate(line){
    if(!['300','500'].includes(line))return null;
    const colors=['Preto','Caramelo','Rose','Off White'];
    const rows=colors.map((color,index)=>{
      const values=line==='500'?[3,3,6,3,3]:index<2?[4,4,8,4,4]:[2,2,4,2,2];
      return {color,sizeBreakdown:Object.fromEntries(SIZES.map((size,i)=>[size,values[i]])),qty:values.reduce((a,b)=>a+b,0)};
    });
    return {scope:'line',target:line,line,rows,total:PAIRS_PER_SHEET};
  }
  function resolvePattern(state,input={},options={}){
    try{
      const context=selection(state,input,options);
      if((input.kind==='palmilha'||input.sector==='palmilha')&&context.line==='300')fail('palmilha_300','A Linha 300 não usa palmilha. Selecione solado, cabedal ou produto pronto.');
      const templates=configuredTemplates(state,options),specific=context.ref&&templates.find(p=>p.scope==='ref'&&p.target===context.ref);
      if(specific)return {ok:true,source:'custom',template:copy(specific),message:''};
      if(context.ref==='315')fail('unconfirmed_pattern','A Ref. 315 possui cinco variações distintas. Configure um padrão confirmado para esta referência; a grade genérica da Linha 300 não será aplicada.');
      const custom=templates.find(p=>p.scope==='line'&&p.target===context.line);
      if(custom)return {ok:true,source:'custom',template:copy(custom),message:''};
      const fallback=defaultTemplate(context.line);
      if(!fallback)fail('unconfirmed_pattern','A Linha '+context.line+' ainda não tem um padrão confirmado. Configure a grade antes de preencher a ficha.');
      return {ok:true,source:'default',template:fallback,message:''};
    }catch(error){return {ok:false,source:null,template:null,code:error.code||'invalid_pattern',message:error.message}}
  }
  function scalePattern(pattern,sheets,options={}){
    const expectedTotal=sheetTotal(sheets),normalized=validateRows(pattern?.rows,{expectedTotal:PAIRS_PER_SHEET,inventory:options.inventory});
    const rows=normalized.rows.map(row=>({color:row.color,sizeBreakdown:Object.fromEntries(SIZES.map(size=>[size,multiply(row.sizeBreakdown[size],sheets)]))}));
    return validateRows(rows,{expectedTotal,inventory:options.inventory}).rows;
  }
  function buildGrid(state,input={},options={}){
    sheetTotal(input.sheets);const result=resolvePattern(state,input,options);
    if(!result.ok)fail(result.code,result.message);
    const rows=scalePattern(result.template,input.sheets,options);
    return {rows,total:sheetTotal(input.sheets),sheets:input.sheets,source:result.source,template:copy(result.template)};
  }
  function savePattern(state,template,options={}){
    const existing=configuredTemplates(state,options),nextPattern=normalizedTemplate(state,template,options);
    const next=copy(state),config=next.settings.sheetPatterns||{version:1,templates:[]};
    const index=existing.findIndex(p=>p.scope===nextPattern.scope&&p.target===nextPattern.target);
    if(index<0)config.templates.push(nextPattern);else config.templates[index]=nextPattern;
    next.settings.sheetPatterns=config;return next;
  }
  function validDate(value,I){if(typeof value!=='string'||value.slice(0,4)==='0000'||!I.validDate(value))fail('invalid_date','Informe uma data válida (AAAA-MM-DD).');return value}
  function validNow(value,I){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))fail('invalid_timestamp','Informe uma data e hora UTC válida.');
    validDate(value.slice(0,10),I);const time=new Date(value);
    if(!Number.isFinite(time.getTime())||time.toISOString().slice(0,19)!==value.slice(0,19))fail('invalid_timestamp','Informe uma data e hora UTC válida.');return value;
  }
  function weekKey(value){const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10)}
  function records(state){
    configState(state);
    if(!Array.isArray(state.settings.models)||!Array.isArray(state.settings.mountings)||!object(state.weeks)||Object.values(state.weeks).some(w=>!object(w)||!Array.isArray(w.entries))||(state.stockLedger!==undefined&&!Array.isArray(state.stockLedger))||(state.factoryExpenses!==undefined&&!Array.isArray(state.factoryExpenses)))fail('invalid_state','Estrutura de produção ou estoque inválida.');
    const production=Object.values(state.weeks).flatMap(w=>w.entries),stock=state.stockLedger||[],expenses=state.factoryExpenses||[],all=[...production,...stock,...expenses],ids=new Set();
    for(const row of all){if(!object(row))fail('invalid_state','Registro de produção, estoque ou gasto inválido.');identifier(row.id,'Identificador do registro');if(ids.has(row.id))fail('duplicate_id','Há um identificador repetido na produção, estoque ou gastos.');ids.add(row.id)}
    return {production,stock,all,ids};
  }
  function stable(value){if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(object(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';return JSON.stringify(value)}
  function same(a,b){return stable(a)===stable(b)}
  function checkInventory(state,I){
    const result=I.ledger(state),issues=result.issues;
    if(issues.length){const error=new Error(issues[0].message);error.code=issues[0].code||'inventory_error';error.issues=copy(issues);throw error}
    for(const row of result.rows)integer(row.qty,'Saldo de estoque',true);
  }
  function confirmedPattern(state,context,kind,options){const result=resolvePattern(state,{line:context.line,ref:context.ref,kind},options);if(!result.ok)fail(result.code,result.message)}
  function batchRows(state,input,options,type){
    if(!object(input))fail('invalid_batch','Informe o lote da ficha.');
    identifier(input.batchId,'Identificador do lote');const I=inventory(options),old=records(state);
    validDate(input.date,I);validNow(options.now,I);
    const total=sheetTotal(input.sheets),grid=validateRows(input.rows,{expectedTotal:total,inventory:I});
    const metadata={sheetBatchId:input.batchId,sheetBatchType:type,sheetCount:input.sheets,sheetBatchTotal:total,sheetBatchRows:grid.rows.length};
    const rows=grid.rows.map(row=>({id:'sheet:'+encodeURIComponent(input.batchId)+':'+encodeURIComponent(I.colorKey(row.color)),color:row.color,qty:row.qty,sizeBreakdown:row.sizeBreakdown,...metadata}));
    return {I,old,rows};
  }
  function replay(state,old,candidates,type,options){
    const batchId=candidates[0].sheetBatchId,existing=[...old.production,...old.stock].filter(row=>row.sheetBatchId===batchId);
    if(existing.length){
      if(existing.length!==candidates.length)fail('batch_conflict','Este lote já existe com uma quantidade diferente de cores. Nenhum registro foi alterado.');
      for(const candidate of candidates){
        const found=existing.find(row=>row.id===candidate.id);
        if(!found||found.sheetBatchType!==type)fail('batch_conflict','Este identificador de lote já foi usado com outros dados.');
        for(const key of Object.keys(candidate))if(!['createdAt','modelName','mountingName'].includes(key)&&!same(found[key],candidate[key]))fail('batch_conflict','Este lote já existe com outros dados. Use a grade original para repetir o salvamento.');
      }
      if(type==='production'&&candidates[0].kind==='finished'){
        for(const candidate of candidates){
          const found=existing.find(row=>row.id===candidate.id);
          if(found.assemblyExpenseId!=='assembly_payable:'+found.id||!object(found.assemblyRate)||!old.all.some(row=>row.id===found.assemblyExpenseId&&row.productionEntryId===found.id))fail('missing_obligation','Este lote de produto pronto está sem a obrigação vinculada. Confira o registro original; nenhum histórico foi completado.');
        }
        assembly(options).obligations(state);
      }
      checkInventory(state,inventory(options));return copy(state);
    }
    for(const candidate of candidates)if(old.ids.has(candidate.id)||old.ids.has('assembly_payable:'+candidate.id))fail('batch_conflict','Um identificador deste lote já está em uso. Nenhum registro foi alterado.');
    return null;
  }
  function createProductionBatch(state,input,options={}){
    const {I,old,rows}=batchRows(state,input,options,'production');
    if(!['cabedal','solado','palmilha','finished'].includes(input.kind))fail('invalid_kind','Selecione um componente ou produto pronto.');
    const mounts=state.settings.mountings.filter(m=>m&&m.id===input.mountingId);
    if(mounts.length!==1)fail('invalid_mounting','Selecione uma montagem válida e sem duplicidade.');
    const shared=['solado','palmilha'].includes(input.kind),context=selection(state,input,{inventory:I});
    if(input.kind==='palmilha'&&(context.line==='300'||context.model?.usesPalmilha===false))fail('palmilha_300','A linha ou referência selecionada não usa palmilha.');
    if(!shared&&!context.model)fail('invalid_model','Selecione um modelo válido para cabedal ou produto pronto.');
    const candidates=rows.map(row=>({...row,date:input.date,kind:input.kind,mountingId:input.mountingId,mountingName:mounts[0].name||input.mountingId,modelId:shared?'':context.model.id,modelName:shared?'Linha '+context.line:context.model.name||context.ref,line:context.line,note:String(input.note??''),inputUnit:'pairs',inputQty:row.qty,createdAt:options.now}));
    const previous=replay(state,old,candidates,'production',options);if(previous)return previous;
    confirmedPattern(state,context,input.kind,{inventory:I});
    let next=copy(state);
    if(input.kind==='finished'){
      validDate(options.today,I);const A=assembly(options);
      for(const candidate of candidates)next=A.createFinished(next,candidate,{today:options.today,now:options.now});
    }else{
      const key=weekKey(input.date);validDate(key,I);
      if(!next.weeks[key])next.weeks[key]={goal:null,modelGoals:{},entries:[],modelSnapshot:copy(next.settings.models.filter(m=>m.active!==false)),mountingSnapshot:copy(next.settings.mountings.filter(m=>m.active!==false)),createdAt:options.now};
      next.weeks[key].entries.push(...copy(candidates));
    }
    records(next);checkInventory(next,I);return next;
  }
  function createStockBatch(state,input,options={}){
    const {I,old,rows}=batchRows(state,input,options,'stock');
    if(!SECTORS.includes(input.sector)||!['in','out'].includes(input.direction))fail('invalid_stock','Selecione um setor e uma entrada ou saída válidos.');
    const shared=['solado','palmilha'].includes(input.sector),pooled=/^@?line:/i.test(String(input.ref||''));
    if(pooled&&input.line!==undefined&&lineValue(input.ref)!==lineValue(input.line))fail('target_mismatch','A linha não corresponde ao componente selecionado.');
    const context=selection(state,{line:pooled?lineValue(input.ref):input.line,ref:pooled?'':input.ref,modelId:input.modelId},{inventory:I});
    if(!shared&&!context.ref)fail('invalid_ref','Selecione a referência do cabedal ou produto pronto.');
    if(input.sector==='palmilha'&&(context.line==='300'||context.model?.usesPalmilha===false))fail('palmilha_300','A linha ou referência selecionada não usa palmilha.');
    const ref=shared?'@line:'+context.line:context.ref;
    const candidates=rows.map(row=>({...row,date:input.date,direction:input.direction,sector:input.sector,ref,note:String(input.note??''),createdAt:options.now}));
    const previous=replay(state,old,candidates,'stock',options);if(previous)return previous;
    confirmedPattern(state,context,input.sector,{inventory:I});
    const next=copy(state);next.stockLedger=[...(next.stockLedger||[]),...copy(candidates)];records(next);checkInventory(next,I);return next;
  }
  function unknownColorSummary(state,options={}){
    if(typeof options==='string')options={until:options};
    const I=inventory(options),bySector=Object.fromEntries(SECTORS.map(sector=>[sector,0]));
    if(options.until!==undefined)validDate(options.until,I);
    const result=I.ledger(state,{until:options.until}),rows=result.rows.filter(row=>row.scope==='global'&&SECTORS.includes(row.sector)&&I.colorKey(row.color)===I.UNKNOWN&&row.qty>0);
    let total=0;const issues=copy(result.issues);
    try{for(const row of rows){integer(row.qty,'Saldo sem cor');bySector[row.sector]=add(bySector[row.sector],row.qty);total=add(total,row.qty)}}catch(error){issues.push({code:error.code,message:error.message});return {total:null,bySector,rows:copy(rows),issues,valid:false}}
    return {total,bySector,rows:copy(rows),issues,valid:issues.length===0};
  }
  return {PAIRS_PER_SHEET,SIZES,resolvePattern,scalePattern,buildGrid,validateRows,savePattern,createProductionBatch,createStockBatch,unknownColorSummary};
});
