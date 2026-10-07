'use strict';
// Synthetic data only. No connection to the operational database.
function state(){
  const models=[
    {id:'m507',ref:'507',name:'507',line:'500',active:true},
    {id:'m512',ref:'512',name:'512 – Sandália teste',line:'500',active:true},
    {id:'m319',ref:'319',name:'319',line:'300',active:true,usesPalmilha:false},
    {id:'m506',ref:'506',name:'506',line:'500',active:true}
  ];
  const mountings=[{id:'a',name:'Montagem A (teste)',rate:2,active:true},{id:'b',name:'Montagem B (teste)',rate:2,active:true},{id:'empty',name:'Sem saldo (teste)',rate:0,active:true},{id:'legacy',name:'Não informado',rate:0,active:false}];
  let n=0;
  const entry=(mountingId,kind,modelId,qty,line='500',color='Preto')=>({id:'fixture-'+(++n),date:'2026-10-07',mountingId,mountingName:mountings.find(m=>m.id===mountingId).name,kind,modelId,modelName:models.find(m=>m.id===modelId)?.name||'Linha '+line,qty,line,color});
  return {
    version:4,onboardingDone:true,lastBackup:null,
    settings:{models,mountings,pairsPerSheet:72,pairsPerKit:6,workDays:[1,2,3,4,5],lineCosts:{},costCatalog:{'507':{ref:'507',model:'Meu Bom (exemplo)'},'319':{ref:'319',model:'Infantil (exemplo)'},'506':{ref:'506',model:'Santa Lolla (exemplo)'}}},
    weeks:{'2026-10-05':{goal:864,modelGoals:{},modelSnapshot:models,mountingSnapshot:mountings,entries:[
      entry('a','cabedal','m507',168),entry('a','cabedal','m512',72),entry('a','solado','',96),entry('a','palmilha','',72),
      entry('b','cabedal','m319',144,'300'),entry('b','solado','',96,'300'),
      entry('b','cabedal','m507',72),entry('b','solado','',72,'500','Caramelo'),entry('b','palmilha','',72,'500','Caramelo')
    ]},'2026-09-28':{goal:72,modelGoals:{},modelSnapshot:models,mountingSnapshot:mountings,entries:[]}},
    stockLedger:[{id:'ready-1',date:'2026-10-06',sector:'produto_pronto',direction:'in',ref:'506',qty:72,color:'Preto'},{id:'ready-2',date:'2026-10-06',sector:'produto_pronto',direction:'in',ref:'507',qty:168,color:'Preto'},{id:'ready-3',date:'2026-10-06',sector:'produto_pronto',direction:'in',ref:'512',qty:72,color:'Preto'}],
    factoryExpenses:[],financeControl:{advances:[],settlements:[]},salesControl:{clients:[],orders:[],receipts:[]}
  };
}
module.exports={state};
