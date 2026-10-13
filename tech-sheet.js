/* Technical-sheet projections only. No clock, persistence, defaults or migration.
 * Input money is integer mills; quantity x price stays exact in BigInt until
 * each requested aggregate is rounded. No existing costing path calls this API.
 */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.FioriTechSheets=api;
})(typeof globalThis==='object'?globalThis:this,function(root){
  'use strict';
  const PAIRS_PER_SHEET=72, SCALE=1000n, MAX=BigInt(Number.MAX_SAFE_INTEGER);
  const SIZE_GROUPS=Object.freeze(['35-37','38-39']);
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const owns=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  function fail(code,message){const error=new Error(message);error.code=code;throw error}
  function issue(error,scope={}){return {code:error.code||'invalid_data',message:error.message,...scope}}
  function materials(){
    const api=root.FioriMaterials||(typeof require==='function'?require('./material-catalog'):null);
    if(!api||typeof api.applicablePrice!=='function')fail('missing_materials','Carregue o módulo de materiais para conferir os preços.');
    return api;
  }
  function sheets(){
    const api=root.FioriSheets||(typeof require==='function'?require('./standard-sheet'):null);
    if(!api||typeof api.resolvePattern!=='function'||typeof api.validateRows!=='function')fail('missing_sheets','Carregue o módulo de grades para conferir a distribuição.');
    return api;
  }
  function date(value){
    if(!materials().validDate(value))fail('invalid_date','Informe uma data válida no formato AAAA-MM-DD.');
    return value;
  }
  function identifier(value,label){
    if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>150)fail('invalid_id',label+' inválido.');
    return value;
  }
  function refValue(value){
    if(typeof value!=='string'||!/^([1-9]\d{2}R?)$/.test(value))fail('invalid_ref','Informe uma referência válida.');
    return value;
  }
  function groups(value){
    if(!Array.isArray(value)||(value.length!==0&&(value.length!==2||SIZE_GROUPS.some(key=>!value.includes(key))))){
      fail('invalid_size_groups','Use nenhuma faixa ou as faixas 35-37 e 38-39, sem duplicidades.');
    }
    return value.length?SIZE_GROUPS.slice():[null];
  }
  function settings(state){
    if(!object(state)||(state.settings!==undefined&&!object(state.settings)))fail('invalid_state','Ajustes da ficha técnica inválidos.');
    return state.settings||{};
  }
  function parseQuantityThousandths(value){
    if(typeof value!=='string'||!/^\d+(?:[.,]\d{1,3})?$/.test(value.trim()))fail('invalid_quantity','Informe quantidade positiva em texto, com até três casas decimais.');
    const [whole,fraction='']=value.trim().split(/[.,]/),result=BigInt(whole)*SCALE+BigInt(fraction.padEnd(3,'0'));
    if(result<=0n||result>MAX)fail('invalid_quantity','Quantidade fora do limite positivo de precisão.');
    return Number(result);
  }
  function priceMills(value){
    if(!Number.isSafeInteger(value)||value<0)fail('invalid_sale_price','O preço de venda deve ser não negativo em milésimos inteiros.');
    return value;
  }
  // Half away from zero. This is called on aggregate numerators, never on an
  // item before a sum, or on an average before multiplying by the sheet size.
  function roundMills(numerator,denominator){
    const sign=numerator<0n?-1n:1n,abs=numerator*sign;
    const rounded=(abs+denominator/2n)/denominator;
    if(rounded>MAX)fail('money_overflow','O resultado excede o limite seguro em milésimos.');
    return Number(rounded*sign);
  }
  const exact=numerator=>({numerator:String(numerator),denominator:1000});
  function applicableVersion(state,ref,when){
    refValue(ref);date(when);
    const config=settings(state).techSheets;
    if(config===undefined)return null;
    if(!object(config))fail('invalid_tech_sheets','Cadastro de fichas técnicas inválido.');
    if(!owns(config,ref))return null;
    const sheet=config[ref];
    if(!object(sheet)||sheet.ref!==ref||!Array.isArray(sheet.versions))fail('invalid_tech_sheet','Referência ou histórico da ficha técnica inválido.');
    const ids=new Set(),dates=new Set();let selected=null;
    for(const version of sheet.versions){
      if(!object(version))fail('invalid_version','Versão de ficha técnica inválida.');
      identifier(version.id,'Identificador da versão');date(version.validFrom);
      if(ids.has(version.id)||dates.has(version.validFrom))fail('ambiguous_version','Há versões repetidas ou com a mesma data inicial.');
      ids.add(version.id);dates.add(version.validFrom);
      if(version.validFrom<=when&&(!selected||version.validFrom>selected.validFrom))selected=version;
    }
    // Return an independent JSON projection: callers cannot change the source
    // through the selected version, its items, quantities or informative colors.
    return selected===null?null:JSON.parse(JSON.stringify(selected));
  }
  function itemProjection(state,item,when,sizeGroups){
    const issues=[],scope={itemId:object(item)&&typeof item.id==='string'?item.id:null};
    let keys,material=null,price=null,base=null;
    const quantities=new Map();
    const check=(fn,extra={})=>{try{return fn()}catch(error){issues.push(issue(error,{...scope,...extra}));return null}};
    keys=check(()=>groups(sizeGroups));
    check(()=>date(when));
    if(!object(item))issues.push({code:'invalid_item',message:'Item da ficha técnica inválido.',...scope});
    else{
      check(()=>identifier(item.id,'Identificador do item'));
      check(()=>identifier(item.materialId,'Identificador do material'));
      if(item.label!==undefined&&item.label!==null&&typeof item.label!=='string')issues.push({code:'invalid_label',message:'Identificação do item inválida.',...scope});
      // Labels and colorMap do not select price or consumption. A complete
      // per-group override replaces qtyPerPair rather than falling back to it.
      if(keys){
        const map=item.qtyBySizeGroup;
        if(map===null||map===undefined){base=check(()=>parseQuantityThousandths(item.qtyPerPair));for(const key of keys)quantities.set(key,base)}
        else if(!object(map)||keys[0]===null){issues.push({code:'invalid_quantity_map',message:'Quantidades por faixa exigem as duas faixas da ficha.',...scope})}
        else{
          if(Object.keys(map).some(key=>!keys.includes(key)))issues.push({code:'invalid_quantity_map',message:'Há quantidades para faixas não declaradas na ficha.',...scope});
          for(const key of keys){
            if(!owns(map,key)){issues.push({code:'missing_group_quantity',message:'Falta a quantidade da faixa '+key+'.',...scope,sizeGroup:key});quantities.set(key,null)}
            else quantities.set(key,check(()=>parseQuantityThousandths(map[key]),{sizeGroup:key}));
          }
        }
      }
      check(()=>{
        const rows=settings(state).materials;
        if(rows===undefined)fail('missing_material','Material não encontrado no catálogo.');
        if(!Array.isArray(rows))fail('invalid_catalog','Catálogo de materiais inválido.');
        const matches=rows.filter(row=>object(row)&&row.id===item.materialId);
        if(!matches.length)fail('missing_material','Material não encontrado no catálogo.');
        if(matches.length!==1)fail('ambiguous_material','Material repetido no catálogo.');
        material=matches[0];
        if(material.active!==true)fail('inactive_material','O material precisa estar ativo.');
      });
      if(material&&material.active===true)price=check(()=>{
        const selected=materials().applicablePrice(material,when);
        if(selected===null)fail('missing_price','O material não tem preço vigente na data consultada.');
        return selected;
      },{materialId:item.materialId});
    }
    const complete=issues.length===0;
    return {
      itemId:scope.itemId,materialId:object(item)?item.materialId??null:null,label:object(item)?item.label??null:null,
      category:material?.category??null,priceId:price?.id??null,priceFrom:price?.from??null,
      unitPriceMills:price?.unitPriceMills??null,complete,status:complete?'ok':'a_conferir',issues,
      costs:(keys||[]).map(sizeGroup=>({sizeGroup,quantityThousandths:quantities.get(sizeGroup)??null,
        costMillsExact:complete?exact(BigInt(quantities.get(sizeGroup))*BigInt(price.unitPriceMills)):null}))
    };
  }
  function calculateItemCost(state,item,when,sizeGroups=[]){return itemProjection(state,item,when,sizeGroups)}
  function distribution(state,input,keys){
    const S=sheets();let rows,source;
    if(owns(input,'rows')){rows=input.rows;source='actual'}
    else{
      const resolved=S.resolvePattern(state,{ref:input.ref,...(input.line!==undefined?{line:input.line}:{})});
      if(!resolved.ok)fail(resolved.code,resolved.message);
      if(resolved.source!=='custom')fail('missing_pattern','Configure uma grade por referência ou linha antes de calcular a média ponderada.');
      rows=resolved.template.rows;source=resolved.source+':'+resolved.template.scope;
      // The pattern resolver deliberately normalizes rows; validate stored
      // metadata too so a contradictory declared total is not silently ignored.
      const config=settings(state).sheetPatterns;
      if(config!==undefined)for(const template of config.templates){
        if(owns(template,'total')&&template.total!==PAIRS_PER_SHEET)fail('invalid_pattern_total','O total declarado no padrão deve ser de 72 pares.');
      }
    }
    const grid=S.validateRows(rows,{expectedTotal:PAIRS_PER_SHEET});
    const counts=new Map(keys.map(key=>[key,0]));
    for(const row of grid.rows){
      if(keys[0]===null)counts.set(null,counts.get(null)+row.qty);
      else for(const [size,qty] of Object.entries(row.sizeBreakdown)){
        const key=Number(size)<=37?'35-37':'38-39';counts.set(key,counts.get(key)+qty);
      }
    }
    return {source,total:PAIRS_PER_SHEET,groups:keys.map(sizeGroup=>({sizeGroup,pairs:counts.get(sizeGroup)}))};
  }
  function calculateTechSheet(state,input={}){
    const result={ref:object(input)?input.ref??null:null,date:object(input)?input.date??null:null,versionId:null,validFrom:null,
      complete:false,valuationComplete:false,financialComplete:false,status:'a_conferir',items:[],sizeGroups:[],distribution:null,composition:[],
      costPerPairMills:null,costPerSheetMills:null,salePriceMills:null,salePerSheetMills:null,
      profitPerPairMills:null,profitPerSheetMills:null,marginPercent:null,issues:[]};
    const record=(error,scope={})=>result.issues.push(issue(error,scope));
    let version,keys;
    try{
      if(!object(input))fail('invalid_input','Informe a referência e a data da consulta.');
      version=applicableVersion(state,input.ref,input.date);
      if(!version)fail('missing_version','A referência não possui ficha técnica vigente na data consultada.');
      result.versionId=version.id;result.validFrom=version.validFrom;keys=groups(version.sizeGroups);
      if(!Array.isArray(version.items)||!version.items.length)fail('empty_items','A ficha técnica deve conter pelo menos um item.');
    }catch(error){record(error);return result}
    const ids=new Set(),materialLabels=new Set();
    result.items=version.items.map((item,index)=>{
      const row=itemProjection(state,item,input.date,version.sizeGroups);
      row.itemIndex=index;
      if(row.itemId!==null&&ids.has(row.itemId)){
        row.complete=false;row.status='a_conferir';row.costs.forEach(cost=>cost.costMillsExact=null);
        row.issues.push({code:'duplicate_item_id',message:'Identificador de item repetido na ficha.',itemId:row.itemId});
      }
      ids.add(row.itemId);
      const labelKey=JSON.stringify([row.materialId,typeof row.label==='string'?row.label.trim().toLocaleLowerCase('pt-BR').replace(/\s+/g,' '):'']);
      if(materialLabels.has(labelKey)){
        row.complete=false;row.status='a_conferir';row.costs.forEach(cost=>cost.costMillsExact=null);
        row.issues.push({code:'duplicate_material_label',message:'O mesmo material só pode se repetir com uma identificação diferente.',itemId:row.itemId,materialId:row.materialId});
      }
      materialLabels.add(labelKey);
      result.issues.push(...row.issues.map(error=>({...error,itemIndex:index})));
      return row;
    });
    const completeItems=result.items.every(item=>item.complete);
    const categories=[...new Set(result.items.map(item=>item.category).filter(value=>value!==null))];
    const sums=new Map();
    function aggregate(numerator,denominator=SCALE,scope={}){
      try{return roundMills(numerator,denominator)}catch(error){record(error,scope);return null}
    }
    result.sizeGroups=keys.map(sizeGroup=>{
      const numerator=completeItems?result.items.reduce((sum,item)=>sum+BigInt(item.costs.find(cost=>cost.sizeGroup===sizeGroup).costMillsExact.numerator),0n):null;
      sums.set(sizeGroup,numerator);
      const costPerPairMills=numerator===null?null:aggregate(numerator,SCALE,{sizeGroup});
      return {sizeGroup,complete:costPerPairMills!==null,costMillsExact:numerator===null?null:exact(numerator),costPerPairMills};
    });
    try{
      // A single consumption is independent of sizes. A supplied real grid is
      // still checked, but a uniform 72-pair sheet needs no inferred pattern.
      result.distribution=keys[0]===null&&!owns(input,'rows')?{source:'uniform',total:PAIRS_PER_SHEET,groups:[{sizeGroup:null,pairs:PAIRS_PER_SHEET}]}:distribution(state,input,keys);
    }catch(error){record(error,{scope:'distribution'})}
    if(owns(version,'salePriceMills')){
      try{result.salePriceMills=priceMills(version.salePriceMills);result.salePerSheetMills=aggregate(BigInt(result.salePriceMills)*72n,1n,{scope:'sale'})}
      catch(error){record(error,{scope:'sale'})}
    }
    if(!owns(version,'salePriceMills'))record({code:'missing_sale_price',message:'Preço de venda não informado; venda, lucro e margem a conferir.'},{scope:'sale'});
    let sheetNumerator=null;
    if(completeItems&&result.distribution){
      sheetNumerator=result.distribution.groups.reduce((sum,row)=>sum+BigInt(row.pairs)*sums.get(row.sizeGroup),0n);
      result.costPerSheetMills=aggregate(sheetNumerator);
      result.costPerPairMills=aggregate(sheetNumerator,72n*SCALE);
    }
    result.composition=categories.map(category=>{
      const items=result.items.filter(item=>item.category===category),byGroup=new Map();
      const sizeGroups=keys.map(sizeGroup=>{
        const numerator=completeItems?items.reduce((sum,item)=>sum+BigInt(item.costs.find(cost=>cost.sizeGroup===sizeGroup).costMillsExact.numerator),0n):null;
        byGroup.set(sizeGroup,numerator);
        return {sizeGroup,costMillsExact:numerator===null?null:exact(numerator),costPerPairMills:numerator===null?null:aggregate(numerator,SCALE,{category,sizeGroup})};
      });
      const numerator=completeItems&&result.distribution?result.distribution.groups.reduce((sum,row)=>sum+BigInt(row.pairs)*byGroup.get(row.sizeGroup),0n):null;
      const costPerPairMills=numerator===null?null:aggregate(numerator,72n*SCALE,{category});
      const costPerSheetMills=numerator===null?null:aggregate(numerator,SCALE,{category});
      return {category,complete:costPerPairMills!==null&&costPerSheetMills!==null&&sizeGroups.every(row=>row.costPerPairMills!==null),sizeGroups,costPerPairMills,costPerSheetMills,
        sharePercent:numerator!==null&&sheetNumerator>0n?Number(numerator)*100/Number(sheetNumerator):null};
    });
    result.complete=completeItems;
    result.valuationComplete=completeItems&&result.distribution!==null&&result.costPerPairMills!==null&&result.costPerSheetMills!==null&&result.sizeGroups.every(row=>row.costPerPairMills!==null);
    result.status=result.valuationComplete?'ok':'a_conferir';
    if(result.valuationComplete&&result.salePriceMills!==null&&result.salePerSheetMills!==null){
      const saleNumerator=BigInt(result.salePerSheetMills)*SCALE,profit= saleNumerator-sheetNumerator;
      result.profitPerSheetMills=aggregate(profit);
      result.profitPerPairMills=aggregate(profit,72n*SCALE);
      result.marginPercent=saleNumerator===0n?null:Number(profit)*100/Number(saleNumerator);
      if(saleNumerator===0n)record({code:'zero_sale_margin',message:'A margem não é definida quando a venda é zero.'},{scope:'sale'});
      result.financialComplete=result.profitPerPairMills!==null&&result.profitPerSheetMills!==null&&result.marginPercent!==null;
    }
    return result;
  }
  return {PAIRS_PER_SHEET,SIZE_GROUPS,parseQuantityThousandths,applicableVersion,calculateItemCost,calculateTechSheet};
});
