(function(root,factory){
  if(typeof module==="object"&&module.exports)module.exports=factory();
  else root.FioriReceipt=factory();
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  // Read-only presentation helpers. The saved order total is always authoritative.
  const integer=(value,label)=>{
    if(!["number","string"].includes(typeof value)||String(value).trim()==="")throw new Error(label+" ausente.");
    const number=Number(value);
    if(!Number.isSafeInteger(number)||number<0)throw new Error(label+" inválido.");
    return number;
  };
  const sum=(a,b)=>integer(a+b,"Valor");
  const money=(value,divisor=100)=> (value/divisor).toLocaleString("pt-BR",{
    style:"currency",currency:"BRL",minimumFractionDigits:2,maximumFractionDigits:divisor===1000?3:2
  });
  const date=value=>{
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||""));
    return match?`${match[3]}/${match[2]}/${match[1]}`:String(value||"—");
  };
  function itemPriceMills(item){
    // A saved zero in mills must not fall back to an older cents field.
    return item.unitPriceMills!==null&&item.unitPriceMills!==undefined
      ?integer(item.unitPriceMills,"Preço por par")
      :integer(integer(item.unitPriceCents,"Preço por par")*10,"Preço por par");
  }
  function build(order,clients,payments){
    if(!Array.isArray(order.items))throw new Error("Itens do pedido ausentes.");
    const receipt={title:"JR Calçados",orderId:String(order.id),date:date(order.date),
      clientName:String(clients.find(c=>c.id===order.clientId)?.name||"—"),
      cancelled:order.deliveryStatus==="cancelled",
      items:order.items.map(item=>{
        const qty=integer(item.qty,"Quantidade"),unitPriceMills=itemPriceMills(item);
        return {ref:String(item.ref??"—"),qty,unitPriceMills,totalMills:integer(qty*unitPriceMills,"Total do item")};
      }),
      totalCents:integer(order.totalCents,"Total do pedido"),
      payments:payments.filter(p=>(p.allocations||[]).some(a=>a.orderId===order.id))
        .map(p=>({date:String(p.date||""),amountCents:(p.allocations||[]).filter(a=>a.orderId===order.id)
          .reduce((n,a)=>sum(n,integer(a.amountCents,"Pagamento")),0)}))
        .sort((a,b)=>a.date.localeCompare(b.date))
    };
    receipt.paidCents=receipt.payments.reduce((n,p)=>sum(n,p.amountCents),0);
    receipt.balanceCents=Math.max(0,receipt.totalCents-receipt.paidCents);
    const lines=[receipt.title,`Cliente: ${receipt.clientName}`,`Pedido: ${receipt.date}`];
    if(receipt.cancelled)lines.push("Entrega: cancelado");
    lines.push("",...receipt.items.map(item=>`${item.ref} · ${item.qty} pares × ${money(item.unitPriceMills,1000)} = ${money(item.totalMills,1000)}`),"",`Total do pedido: ${money(receipt.totalCents)}`);
    if(receipt.payments.length){
      lines.push("","Pagamentos:",...receipt.payments.map(p=>`${date(p.date)} · ${money(p.amountCents)}`));
    }else lines.push("","Nenhum pagamento alocado a este pedido.");
    lines.push("",`Total pago: ${money(receipt.paidCents)}`,`Saldo: ${money(receipt.balanceCents)}`);
    receipt.text=lines.join("\n");
    return receipt;
  }
  function wrap(ctx,text,maxWidth){
    const lines=[];
    for(const paragraph of String(text).split(/\r?\n/)){
      let line="";
      for(const word of paragraph.split(/\s+/).filter(Boolean)){
        if(line&&ctx.measureText(line+" "+word).width>maxWidth){lines.push(line);line=""}
        for(const char of Array.from((line?" ":"")+word)){
          if(line&&ctx.measureText(line+char).width>maxWidth){lines.push(line);line=""}
          line+=char;
        }
      }
      lines.push(line);
    }
    return lines;
  }
  function draw(receipt,createCanvas){
    const canvas=createCanvas(),ctx=canvas.getContext("2d");
    if(!ctx)throw new Error("Imagem indisponível neste navegador.");
    canvas.width=1000;
    const blocks=[];
    const add=(text,size=28,weight=400,color="#18212e",gap=12)=>{
      const font=`${weight} ${size}px Arial, sans-serif`;ctx.font=font;
      const lines=wrap(ctx,text,872),lineHeight=Math.ceil(size*1.4);
      blocks.push({lines,font,lineHeight,color,gap});
    };
    add("RECIBO DO PEDIDO",22,700,"#526579",16);
    add(`Cliente: ${receipt.clientName}`,32,700);
    add(`Pedido: ${receipt.date}`,26,400,"#526579",24);
    if(receipt.cancelled)add("Entrega: cancelado",28,700,"#a53b3b",24);
    add("ITENS",22,700,"#526579");
    for(const item of receipt.items){
      add(`Ref. ${item.ref} · ${item.qty} pares`,30,700,"#18212e",4);
      add(`${money(item.unitPriceMills,1000)} por par · ${money(item.totalMills,1000)}`,28,400,"#526579",20);
    }
    add(`Total do pedido: ${money(receipt.totalCents)}`,34,700,"#18212e",28);
    add("PAGAMENTOS",22,700,"#526579");
    if(receipt.payments.length)for(const p of receipt.payments)add(`${date(p.date)} · ${money(p.amountCents)}`);
    else add("Nenhum pagamento alocado a este pedido.",26,400,"#526579");
    add(`Total pago: ${money(receipt.paidCents)}`,30,700,"#18212e",16);
    add(`Saldo: ${money(receipt.balanceCents)}`,38,700,"#18212e",20);
    const height=204+blocks.reduce((n,b)=>n+b.lines.length*b.lineHeight+b.gap,0)+40;
    // Stay within mobile canvas limits. The complete text remains available for very large receipts.
    if(height>12000)throw new Error("Recibo muito longo para uma única imagem. Use o texto completo.");
    canvas.height=height;
    ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle="#18212e";ctx.fillRect(0,0,1000,156);
    ctx.fillStyle="#c98a00";ctx.fillRect(0,156,1000,8);
    ctx.textBaseline="top";ctx.fillStyle="#fff";ctx.font="700 54px Arial, sans-serif";
    ctx.fillText(receipt.title,64,48);
    let y=204;
    for(const block of blocks){
      ctx.font=block.font;ctx.fillStyle=block.color;
      for(const line of block.lines){ctx.fillText(line,64,y);y+=block.lineHeight}
      y+=block.gap;
    }
    return canvas;
  }
  const filename=receipt=>"recibo-"+receipt.orderId.replace(/[^a-zA-Z0-9_-]/g,"-").slice(0,80)+".png";
  return {itemPriceMills,build,draw,filename};
});
