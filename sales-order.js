(function(root,factory){
  if(typeof module==="object"&&module.exports)module.exports=factory();
  else root.FioriSalesOrder=factory();
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  // Parse decimal text directly into integer mills. Never multiply a floating-point
  // currency value or round away a fourth decimal place. A lone dot is decimal;
  // Brazilian thousands separators are accepted only before a decimal comma.
  function parseSalesPriceMills(value){
    if(typeof value!=="string")return NaN;
    const raw=value.trim();
    let whole,fraction;
    if(raw.includes(",")){
      if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,3}$/.test(raw))return NaN;
      [whole,fraction]=raw.split(",");whole=whole.replace(/\./g,"");
    }else{
      if(!/^\d+(?:\.\d{1,3})?$/.test(raw))return NaN;
      [whole,fraction=""]=raw.split(".");
    }
    const mills=Number(whole+fraction.padEnd(3,"0"));
    return Number.isSafeInteger(mills)?mills:NaN;
  }

  // Build only new order items. Existing unitPriceCents / unitPriceMills records
  // are neither converted nor rewritten by this module.
  function parseItems(value){
    if(typeof value!=="string"||!value.trim())throw new Error("Informe os itens do pedido.");
    const items=[];let totalMills=0;
    for(const line of value.trim().split(/\r?\n/).filter(line=>line.trim())){
      const parts=line.split(";").map(part=>part.trim());
      if(parts.length!==3)throw new Error("Use: referência ; pares ; preço por par.");
      const [ref,quantity,price]=parts,qty=Number(quantity),unitPriceMills=parseSalesPriceMills(price);
      if(!ref||!/^\d+$/.test(quantity)||!Number.isSafeInteger(qty)||qty<=0){
        throw new Error("Informe uma referência e uma quantidade inteira de pares maior que zero.");
      }
      if(!Number.isSafeInteger(unitPriceMills)){
        throw new Error("Preço por par inválido. Use um valor não negativo com até 3 casas decimais, dentro do limite permitido.");
      }
      const itemMills=qty*unitPriceMills,nextTotal=totalMills+itemMills;
      if(!Number.isSafeInteger(itemMills)||!Number.isSafeInteger(nextTotal)){
        throw new Error("O valor do pedido excede o limite permitido. Confira quantidades e preços.");
      }
      items.push({ref:ref.toUpperCase(),qty,unitPriceMills});totalMills=nextTotal;
    }
    if(totalMills%10!==0){
      throw new Error("O total do pedido não fecha em centavos. Confira quantidades e preços.");
    }
    return {items,totalCents:totalMills/10};
  }
  return {parseSalesPriceMills,parseItems};
});
