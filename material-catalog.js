/* Fiori Belle material catalog. Pure JSON reads and state candidates.
 * Prices are integer mills, not stock movements or historical cost snapshots.
 * No persistence, implicit clock, migration, price seeding, or technical sheets.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.FioriMaterials=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const categories=Object.freeze([
    {id:'tira',label:'Tira'}, {id:'solado',label:'Solado'},
    {id:'palmilha',label:'Palmilha'}, {id:'enfeite',label:'Enfeite'},
    {id:'passador',label:'Passador'}, {id:'cola',label:'Cola'},
    {id:'embalagem',label:'Embalagem'}, {id:'cabedal',label:'Cabedal'},
    {id:'mao_de_obra',label:'Mão de obra'}, {id:'servico',label:'Serviço'},
    {id:'outro',label:'Outro'}
  ].map(Object.freeze));
  const units=Object.freeze(['m','un','par','placa','kg']);
  const categoryIds=new Set(categories.map(row=>row.id));
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const owns=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  function fail(code,message){const error=new Error(message);error.code=code;throw error}
  function strictInput(input,allowed,code,message){
    if(!object(input))fail(code,message);
    // Write commands accept only their declared own data fields. In particular,
    // addPrice cannot smuggle correction metadata through ignored properties.
    const prototype=Object.getPrototypeOf(input);
    // Accept plain objects from another browser realm as well as null-prototype
    // records, but not inherited command fields or a custom prototype.
    const constructor=prototype&&Object.getOwnPropertyDescriptor(prototype,'constructor');
    if(prototype!==null&&(!constructor||typeof constructor.value!=='function'||constructor.value.prototype!==prototype||Function.prototype.toString.call(constructor.value)!==Function.prototype.toString.call(Object))){
      fail('invalid_input','Use somente campos próprios nos dados informados.');
    }
    for(const key of Reflect.ownKeys(input)){
      const descriptor=Object.getOwnPropertyDescriptor(input,key);
      if(!allowed.includes(key)||!owns(descriptor,'value'))fail('invalid_input','Campo não permitido nesta operação do catálogo.');
    }
  }
  function requireId(value){
    if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>150){
      fail('invalid_id','Identificador do material ou da vigência inválido.');
    }
    return value;
  }
  function text(value,label,limit,required=false){
    if(typeof value!=='string'||value.length>limit||(required&&!value.trim())){
      fail('invalid_text',label+' inválido. Use '+(required?'de 1 a ':'até ')+limit+' caracteres.');
    }
    return value;
  }
  function validDate(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number(value.slice(0,4))<1)return false;
    const parsed=new Date(value+'T12:00:00Z');
    return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
  }
  function date(value){
    if(!validDate(value))fail('invalid_date','Informe uma data válida no formato AAAA-MM-DD.');
    return value;
  }
  function timestamp(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)||!validDate(value.slice(0,10))){
      fail('invalid_timestamp','Informe uma data e hora UTC válida.');
    }
    const parsed=new Date(value);
    if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,19)!==value.slice(0,19)){
      fail('invalid_timestamp','Informe uma data e hora UTC válida.');
    }
    return value;
  }
  function mills(value){
    if(!Number.isSafeInteger(value)||value<0)fail('invalid_price','Informe um preço não negativo em milésimos inteiros, dentro do limite de precisão.');
    return value;
  }

  // A comma or a dot is a decimal separator. Grouping, scientific notation and
  // a fourth decimal are deliberately rejected rather than rounded or guessed.
  function parsePriceMills(value){
    if(typeof value!=='string'||!/^\d+(?:[.,]\d{1,3})?$/.test(value.trim())){
      fail('invalid_price','Informe um preço não negativo, sem separador de milhar, com até 3 casas decimais.');
    }
    const [whole,fraction='']=value.trim().split(/[.,]/);
    const result=BigInt(whole)*1000n+BigInt(fraction.padEnd(3,'0'));
    if(result>BigInt(Number.MAX_SAFE_INTEGER))fail('invalid_price','O preço excede o limite de precisão.');
    return Number(result);
  }
  function formatPriceMills(value){
    // Integer/string operations preserve every mill even at MAX_SAFE_INTEGER.
    const digits=String(mills(value)).padStart(4,'0');
    return digits.slice(0,-3).replace(/\B(?=(\d{3})+(?!\d))/g,'.')+','+digits.slice(-3);
  }

  function catalogRows(state){
    if(!object(state))fail('invalid_state','Estado do cadastro de materiais inválido.');
    if(state.settings===undefined)return [];
    if(!object(state.settings))fail('invalid_state','Ajustes do cadastro de materiais inválidos.');
    if(state.settings.materials===undefined)return [];
    if(!Array.isArray(state.settings.materials))fail('invalid_catalog','Catálogo de materiais inválido; confira os dados antes de salvar.');
    return state.settings.materials;
  }
  function listMaterials(state){return catalogRows(state).slice()}

  function validateCatalog(state){
    const issues=[];
    const check=(fn,scope={})=>{
      try{fn();return true}catch(error){issues.push({code:error.code||'invalid_catalog',message:error.message,...scope});return false}
    };
    let rows;
    if(!check(()=>{rows=catalogRows(state)}))return issues;
    const ids=new Set();
    function registerId(id){
      requireId(id);
      if(ids.has(id))fail('duplicate_id','Identificador repetido no catálogo de materiais.');
      ids.add(id);
    }
    for(const material of rows){
      if(!check(()=>{if(!object(material))fail('invalid_material','Material inválido no catálogo.')}))continue;
      const scope=typeof material.id==='string'?{materialId:material.id}:{};
      check(()=>registerId(material.id),scope);
      check(()=>text(material.name,'Nome do material',200,true),scope);
      check(()=>{if(!categoryIds.has(material.category))fail('invalid_category','Selecione uma categoria de material válida.')},scope);
      check(()=>{if(!units.includes(material.unit))fail('invalid_unit','Selecione uma unidade de material válida.')},scope);
      if(material.supplier!==undefined)check(()=>text(material.supplier,'Fornecedor',200),scope);
      check(()=>{if(typeof material.variantByColor!=='boolean')fail('invalid_variant','Informe se o material varia por cor.')},scope);
      check(()=>{if(typeof material.active!=='boolean')fail('invalid_active','Situação ativa do material inválida.')},scope);
      const createdValid=check(()=>timestamp(material.createdAt),scope);
      const updatedValid=check(()=>timestamp(material.updatedAt),scope);
      if(createdValid&&updatedValid)check(()=>{
        if(Date.parse(material.updatedAt)<Date.parse(material.createdAt))fail('invalid_timestamp','A atualização do material não pode preceder o cadastro.');
      },scope);
      if(!check(()=>{if(!Array.isArray(material.prices))fail('invalid_prices','Histórico de preços do material inválido.')},scope))continue;
      const dates=new Set(),byId=new Map(),successors=new Map();
      let lastCorrectionTime=null;
      for(let index=0;index<material.prices.length;index++){
        const price=material.prices[index];
        if(object(price)&&typeof price.id==='string')byId.set(price.id,{price,index});
      }
      for(let index=0;index<material.prices.length;index++){
        const price=material.prices[index];
        if(!check(()=>{if(!object(price))fail('invalid_price_row','Vigência de preço inválida.')},scope))continue;
        const priceScope={...scope,...(typeof price.id==='string'?{priceId:price.id}:{})};
        check(()=>registerId(price.id),priceScope);
        check(()=>date(price.from),priceScope);
        check(()=>mills(price.unitPriceMills),priceScope);
        check(()=>text(price.note,'Observação',500),priceScope);
        const correction=owns(price,'supersedesPriceId')||owns(price,'correctedAt');
        if(!correction){
          check(()=>{
            if(dates.has(price.from))fail('duplicate_date','Já existe um preço com essa data de início para o material.');
            dates.add(price.from);
          },priceScope);
          continue;
        }
        const targetValid=check(()=>requireId(price.supersedesPriceId),priceScope);
        const correctedValid=check(()=>timestamp(price.correctedAt),priceScope);
        if(correctedValid){
          const time=Date.parse(price.correctedAt);
          check(()=>{
            if((createdValid&&time<Date.parse(material.createdAt))||(updatedValid&&time>Date.parse(material.updatedAt))||(lastCorrectionTime!==null&&time<lastCorrectionTime)){
              fail('invalid_timestamp','A data da correção deve respeitar a ordem do histórico e a atualização do material.');
            }
          },priceScope);
          lastCorrectionTime=time;
        }
        if(targetValid)check(()=>{
          const target=byId.get(price.supersedesPriceId);
          if(!target)fail('invalid_correction_target','A vigência corrigida não pertence ao histórico deste material.');
          // Requiring an earlier row makes cycles and forward references invalid
          // while preserving the original append order of every historical row.
          if(target.index>=index)fail('invalid_correction_order','A correção deve suceder a vigência original no histórico.');
          if(target.price.from!==price.from)fail('invalid_correction_date','A correção deve manter a data inicial da vigência original.');
          if(successors.has(price.supersedesPriceId))fail('stale_price','Esta vigência já foi corrigida. Selecione a versão vigente.');
          successors.set(price.supersedesPriceId,price);
          if(correctedValid&&owns(target.price,'correctedAt')&&Date.parse(price.correctedAt)<Date.parse(target.price.correctedAt)){
            fail('invalid_timestamp','A data da correção não pode preceder a correção anterior.');
          }
        },priceScope);
      }
    }
    return issues;
  }
  function requireCatalog(state){
    const issues=validateCatalog(state);
    if(issues.length)fail(issues[0].code,issues[0].message);
    return catalogRows(state);
  }
  function priceHistory(material){
    requireCatalog({settings:{materials:[material]}});
    const successors=new Map(material.prices.filter(price=>owns(price,'supersedesPriceId')).map(price=>[price.supersedesPriceId,price]));
    return material.prices.map(price=>({price,correctedBy:successors.get(price.id)||null}));
  }
  function activePrices(material){return priceHistory(material).filter(row=>!row.correctedBy).map(row=>row.price)}
  function applicablePrice(material,when){
    date(when);
    let selected=null;
    for(const price of activePrices(material)){
      if(price.from<=when&&(!selected||price.from>selected.from))selected=price;
    }
    return selected;
  }
  function allIds(rows){
    return new Set(rows.flatMap(material=>[material.id,...material.prices.map(price=>price.id)]));
  }
  function sameFields(left,right,fields){return fields.every(key=>left[key]===right[key])}
  function findMaterial(rows,materialId){
    requireId(materialId);
    const material=rows.find(row=>row.id===materialId);
    if(!material)fail('unknown_material','Material não encontrado no catálogo.');
    return material;
  }
  function updatedTimestamp(material,value){
    timestamp(value);
    if(Date.parse(value)<Date.parse(material.updatedAt))fail('invalid_timestamp','A atualização não pode preceder o último registro do material.');
    return value;
  }
  function replaceMaterial(state,rows,material,changed){
    const next={...state,settings:{...state.settings,materials:rows.map(row=>row===material?changed:row)}};
    requireCatalog(next);
    return next;
  }

  function addMaterial(state,input){
    const rows=requireCatalog(state);
    if(!object(input))fail('invalid_material','Informe os dados do material.');
    requireId(input.id);
    // Register a name first; a price always needs its own explicit dated action.
    if(input.prices!==undefined&&(!Array.isArray(input.prices)||input.prices.length)){
      fail('seeded_prices','Cadastre o material sem preços; defina a vigência em uma ação separada.');
    }
    const createdAt=timestamp(input.createdAt);
    const material={
      id:input.id,name:text(input.name,'Nome do material',200,true).trim(),
      category:input.category,unit:input.unit,
      ...(input.supplier!==undefined?{supplier:text(input.supplier,'Fornecedor',200).trim()}:{}),
      variantByColor:input.variantByColor===undefined?false:input.variantByColor,
      active:input.active===undefined?true:input.active,prices:[],
      createdAt,updatedAt:input.updatedAt===undefined?createdAt:input.updatedAt
    };
    requireCatalog({settings:{materials:[material]}});
    const existing=rows.find(row=>row.id===material.id);
    if(existing){
      // Only exact creation retries qualify. Later histories are never rewritten.
      if(!existing.prices.length&&sameFields(existing,material,['id','name','category','unit','supplier','variantByColor','active','createdAt','updatedAt']))return state;
      fail('duplicate_id','Este identificador de material já existe com outros dados. Reabra e confira.');
    }
    if(allIds(rows).has(material.id))fail('duplicate_id','Este identificador já foi utilizado no catálogo de materiais.');
    const next={...state,settings:{...state.settings,materials:[...rows,material]}};
    requireCatalog(next);
    return next;
  }
  function addPrice(state,materialId,input){
    const rows=requireCatalog(state);
    const material=findMaterial(rows,materialId);
    strictInput(input,['id','from','unitPriceMills','note','updatedAt'],'invalid_price_row','Informe os dados da vigência de preço.');
    const price={id:requireId(input.id),from:date(input.from),unitPriceMills:mills(input.unitPriceMills),note:input.note===undefined?'':text(input.note,'Observação',500).trim()};
    const updatedAt=timestamp(input.updatedAt);
    const existing=material.prices.find(row=>row.id===price.id);
    if(existing){
      if(!owns(existing,'supersedesPriceId')&&sameFields(existing,price,['id','from','unitPriceMills','note']))return state;
      fail('duplicate_id','Este identificador de vigência já existe com outros dados. Reabra e confira.');
    }
    if(!material.active)fail('inactive_material','Material inativo: o histórico está disponível somente para consulta.');
    if(allIds(rows).has(price.id))fail('duplicate_id','Este identificador já foi utilizado no catálogo de materiais.');
    if(material.prices.some(row=>row.from===price.from))fail('duplicate_date','Já existe um preço com essa data de início para o material.');
    updatedTimestamp(material,updatedAt);
    const changed={...material,prices:[...material.prices,price],updatedAt};
    return replaceMaterial(state,rows,material,changed);
  }
  function editMaterial(state,materialId,input){
    const rows=requireCatalog(state),material=findMaterial(rows,materialId);
    strictInput(input,['name','supplier','variantByColor','category','unit','updatedAt'],'invalid_material','Informe os dados do material.');
    const changed={...material,
      name:text(input.name,'Nome do material',200,true).trim(),
      ...(input.supplier!==undefined?{supplier:text(input.supplier,'Fornecedor',200).trim()}:{}),
      variantByColor:input.variantByColor,category:input.category,unit:input.unit,
      updatedAt:timestamp(input.updatedAt)
    };
    // Validate the proposed fields without replacing any preserved history.
    requireCatalog({settings:{materials:[{...changed,updatedAt:material.updatedAt}]}});
    if(material.prices.length&&(changed.category!==material.category||changed.unit!==material.unit)){
      fail('locked_material_fields','Categoria e unidade não podem mudar após qualquer preço registrado, inclusive futuro ou corrigido.');
    }
    if(sameFields(material,changed,['name','supplier','variantByColor','category','unit']))return state;
    updatedTimestamp(material,changed.updatedAt);
    return replaceMaterial(state,rows,material,changed);
  }
  function setMaterialActive(state,materialId,input){
    const rows=requireCatalog(state),material=findMaterial(rows,materialId);
    strictInput(input,['active','updatedAt'],'invalid_material','Informe a situação do material.');
    if(typeof input.active!=='boolean')fail('invalid_active','Situação ativa do material inválida.');
    timestamp(input.updatedAt);
    if(input.active===material.active)return state;
    const changed={...material,active:input.active,updatedAt:updatedTimestamp(material,input.updatedAt)};
    return replaceMaterial(state,rows,material,changed);
  }
  function correctPrice(state,materialId,input){
    const rows=requireCatalog(state),material=findMaterial(rows,materialId);
    strictInput(input,['id','supersedesPriceId','from','unitPriceMills','note','correctedAt','updatedAt'],'invalid_price_row','Informe os dados da correção de preço.');
    const price={id:requireId(input.id),from:date(input.from),unitPriceMills:mills(input.unitPriceMills),
      note:input.note===undefined?'':text(input.note,'Observação',500).trim(),
      supersedesPriceId:requireId(input.supersedesPriceId),correctedAt:timestamp(input.correctedAt)};
    const updatedAt=timestamp(input.updatedAt);
    if(Date.parse(updatedAt)<Date.parse(price.correctedAt))fail('invalid_timestamp','A atualização não pode preceder a data da correção.');
    const existing=material.prices.find(row=>row.id===price.id);
    if(existing){
      // updatedAt belongs to the material revision; correctedAt is the stable
      // audit timestamp and is part of the correction's complete retry identity.
      if(sameFields(existing,price,['id','from','unitPriceMills','note','supersedesPriceId','correctedAt']))return state;
      fail('duplicate_id','Este identificador de vigência já existe com outros dados. Reabra e confira.');
    }
    if(!material.active)fail('inactive_material','Material inativo: reative-o antes de registrar preços ou correções.');
    if(allIds(rows).has(price.id))fail('duplicate_id','Este identificador já foi utilizado no catálogo de materiais.');
    const target=material.prices.find(row=>row.id===price.supersedesPriceId);
    if(!target)fail('invalid_correction_target','A vigência corrigida não pertence ao histórico deste material.');
    if(price.from!==target.from)fail('invalid_correction_date','A correção deve manter a data inicial da vigência original.');
    if(material.prices.some(row=>row.supersedesPriceId===target.id))fail('stale_price','Esta vigência já foi corrigida. Selecione a versão vigente.');
    updatedTimestamp(material,price.correctedAt);
    updatedTimestamp(material,updatedAt);
    return replaceMaterial(state,rows,material,{...material,prices:[...material.prices,price],updatedAt});
  }
  return {categories,units,validDate,listMaterials,validateCatalog,parsePriceMills,formatPriceMills,priceHistory,activePrices,applicablePrice,addMaterial,addPrice,editMaterial,setMaterialActive,correctPrice};
});
