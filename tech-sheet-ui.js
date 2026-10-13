/* Technical-sheet presentation and append-only candidates. No persistence,
 * implicit clock, operational integration, or cost formulas. All valuations
 * come from tech-sheet.js; deltas compare its already-computed aggregates. */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.FioriTechSheetUI=api;
})(typeof globalThis==='object'?globalThis:this,function(root){
  'use strict';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const engine=()=>root.FioriTechSheets||(typeof require==='function'?require('./tech-sheet'):null);
  const materials=()=>root.FioriMaterials||(typeof require==='function'?require('./material-catalog'):null);
  const fixedCategories=[['solado','Solado'],['palmilha','Palmilha'],['cola','Cola'],['embalagem','Embalagem'],['mao_de_obra','Mão de obra']];
  function fail(code,message){const error=new Error(message);error.code=code;throw error}
  function identifier(value){if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>150)fail('invalid_id','Identificador da versão inválido.')}
  function history(state,ref){
    // The engine checks reference, optional collection shape, IDs and dates.
    engine().applicableVersion(state,ref,'9999-12-31');
    return clone(state.settings?.techSheets?.[ref]?.versions||[]).sort((a,b)=>b.validFrom.localeCompare(a.validFrom));
  }
  function draft(state,ref,date,id,createdAt){
    const current=engine().applicableVersion(state,ref,date);
    identifier(id);
    if(current&&(!Array.isArray(current.items)||current.items.some(item=>!object(item))))fail('invalid_item','A ficha vigente contém itens inválidos. Solicite conferência antes de criar uma versão.');
    return {...(current||{sizeGroups:[],items:[],note:''}),id,validFrom:'',createdAt};
  }
  function project(state,ref,version,date){
    if(!object(version))return engine().calculateTechSheet(state,{ref,date});
    const projected={...state,settings:{...state.settings,techSheets:{[ref]:{ref,versions:[{...clone(version),validFrom:date}]}}}};
    return engine().calculateTechSheet(projected,{ref,date});
  }
  function appendVersion(state,ref,version){
    const versions=history(state,ref);
    if(!object(version))fail('invalid_version','Versão da ficha inválida.');
    identifier(version.id);
    if(!materials().validDate(version.validFrom))fail('invalid_date','Informe a data inicial da versão.');
    if(typeof version.createdAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(version.createdAt)||!Number.isFinite(Date.parse(version.createdAt))||new Date(version.createdAt).toISOString().slice(0,19)!==version.createdAt.slice(0,19))fail('invalid_timestamp','Data de criação da versão inválida.');
    if(version.note!==undefined&&(typeof version.note!=='string'||version.note.length>1000))fail('invalid_note','Use até 1.000 caracteres na observação.');
    const same=versions.find(row=>row.id===version.id);
    if(same){if(JSON.stringify(same)===JSON.stringify(version))return state;fail('duplicate_version_id','Este identificador já pertence a outra versão.')}
    if(versions.some(row=>row.validFrom===version.validFrom))fail('duplicate_version_date','Já existe uma versão com esta data inicial. Escolha uma nova vigência.');
    const catalogIssues=materials().validateCatalog(state);if(catalogIssues.length)fail(catalogIssues[0].code,catalogIssues[0].message);
    const preview=project(state,ref,version,version.validFrom);
    // Missing price is allowed as an explicitly incomplete sheet. Invalid or
    // inactive materials, quantities and duplicated items cannot be saved.
    const blocker=preview.issues.find(row=>row.scope!=='distribution'&&row.code!=='missing_price'&&row.code!=='zero_sale_margin');
    if(blocker)fail(blocker.code,blocker.message);
    const existing=state.settings?.techSheets?.[ref];
    return {...state,settings:{...state.settings,techSheets:{...state.settings?.techSheets,[ref]:{...(existing||{ref}),versions:[...(existing?.versions||[]),clone(version)]}}}};
  }
  function formatMoney(mills){
    if(!Number.isSafeInteger(mills))return 'A conferir';
    const value=BigInt(mills),negative=value<0n,abs=negative?-value:value;
    return (negative?'-':'')+'R$ '+materials().formatPriceMills(Number(abs));
  }
  function formatExact(value){
    if(!object(value)||value.denominator!==1000||typeof value.numerator!=='string'||!/^\d+$/.test(value.numerator))return 'A conferir';
    const raw=value.numerator.padStart(7,'0'),whole=raw.slice(0,-6).replace(/\B(?=(\d{3})+(?!\d))/g,'.');
    const fraction=raw.slice(-6).replace(/0{1,3}$/,'');
    return 'R$ '+whole+','+fraction;
  }
  function delta(before,after){
    const result={};
    for(const key of ['costPerPairMills','costPerSheetMills']){
      if(!Number.isSafeInteger(before?.[key])||!Number.isSafeInteger(after?.[key])){result[key]=null;continue}
      const difference=BigInt(after[key])-BigInt(before[key]);
      result[key]=difference>BigInt(Number.MAX_SAFE_INTEGER)||difference<BigInt(Number.MIN_SAFE_INTEGER)?null:Number(difference);
    }
    return result;
  }
  function material(state,id){const matches=(Array.isArray(state.settings?.materials)?state.settings.materials:[]).filter(row=>row?.id===id);return matches.length===1?matches[0]:null}
  const groupName=group=>group===null?'Consumo único':group;
  function costGroups(rows){return rows.map(row=>groupName(row.sizeGroup)+': '+formatMoney(row.costPerPairMills)).join(' · ')}
  function describe(state,ref,version,result){
    const items=Array.isArray(version?.items)?version.items.map(item=>object(item)?item:{}):[];
    const label=item=>{const found=material(state,item.materialId);return (item.label?item.label+' · ':'')+(found?.name||'Material não encontrado')};
    const fixed=fixedCategories.map(([id,name])=>{const row=result.composition.find(row=>row.category===id);return name+': '+(row?costGroups(row.sizeGroups):'Não cadastrado nesta ficha')});
    const consumption=items.map(item=>{const found=material(state,item.materialId),quantities=item.qtyBySizeGroup;
      return label(item)+' | '+(quantities?['35-37','38-39'].map(key=>key+': '+(quantities[key]??'a conferir')).join(' · '):'Única: '+(item.qtyPerPair??'a conferir'))+' '+(found?.unit||'unidade a conferir')+'/par';
    });
    const costs=result.items.map((row,index)=>label(items[index]||{})+' | '+(row.complete?'Preço/unidade: '+formatMoney(row.unitPriceMills)+' · '+row.costs.map(cost=>groupName(cost.sizeGroup)+': '+formatExact(cost.costMillsExact)).join(' · '):'A conferir: '+row.issues.map(issue=>issue.message).join(' ')));
    const margin=result.marginPercent===null?'A conferir':new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(result.marginPercent)+'%';
    return [
      {title:'1. Custos fixos',lines:fixed},
      {title:'2. Consumo',lines:consumption.length?consumption:['Nenhum item cadastrado.']},
      {title:'3. Custo por item',lines:costs.length?costs:['A conferir: cadastre os materiais e consumos.']},
      {title:'4. Custo por par',lines:[...result.sizeGroups.map(row=>groupName(row.sizeGroup)+': '+formatMoney(row.costPerPairMills)),'Média: '+formatMoney(result.costPerPairMills)]},
      {title:'5. Custo da ficha de 72 pares',lines:[formatMoney(result.costPerSheetMills)]},
      {title:'6. Venda por par',lines:[formatMoney(result.salePriceMills)]},
      {title:'7. Lucro por par',lines:[formatMoney(result.profitPerPairMills)]},
      {title:'8. Lucro da ficha e margem',lines:[formatMoney(result.profitPerSheetMills),'Margem sobre a venda: '+margin]}
    ];
  }
  function shareText(state,ref,version,result,{simulation=false}={}){
    return ['Ficha técnica · Ref. '+ref,simulation?'SIMULAÇÃO TEMPORÁRIA · não salva':'Consulta de versão salva',
      'Data de cálculo: '+result.date,'Vigência da versão: '+(version?.validFrom||'a definir'),'',
      ...describe(state,ref,version,result).flatMap(section=>[section.title,...section.lines,'']),
      ...(result.issues.length?['Pendências:',...result.issues.map(row=>row.message)]:[]),
      'Valores de referência; não registram produção, estoque ou resultado realizado.'].join('\n');
  }
  return {history,draft,project,appendVersion,formatMoney,formatExact,delta,describe,shareText};
});
