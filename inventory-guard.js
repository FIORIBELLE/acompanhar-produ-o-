/* Fiori Belle: deterministic inventory checks. Pure functions; never rewrite source records. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FioriInventory = api;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  const UNKNOWN = 'sem cor discriminada';
  const components = ['cabedal', 'solado', 'palmilha'];
  const fold = v => String(v ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');
  function colorKey(v) {
    const k=fold(v);
    if (['','ficha','fichas','kit','kits','sem cor','sem cor discriminada','nao informado','nao informada','cor nao informada'].includes(k)) return UNKNOWN;
    if (['rose','rosa'].includes(k)) return 'rose';
    if (['off','off white','off-white','branco'].includes(k)) return 'off white';
    if (['ouro','ouro light','ourolight'].includes(k)) return 'ouro light';
    return k;
  }
  function colorLabel(k) {
    return ({[UNKNOWN]:'Sem cor discriminada',preto:'Preto',rose:'Rose','off white':'Off White','ouro light':'Ouro Light',caramelo:'Caramelo'})[k] || k;
  }
  function refOf(m) {return String(m?.ref || String(m?.name || '').match(/\b\d{3}R?\b/i)?.[0] || '').toUpperCase()}
  function lineOf(e,m) {return String(e?.line || m?.line || (String(m?.ref || e?.modelName || m?.name || '').match(/\d/)?.[0] || '')+'00')}
  function usesPalmilha(m,line) {return line !== '300' && m?.usesPalmilha !== false}
  function validDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
    const n=Date.parse(s+'T12:00:00Z');
    return Number.isFinite(n) && new Date(n).toISOString().slice(0,10)===s;
  }
  function flatten(state) {return Object.values(state.weeks || {}).flatMap(w => Array.isArray(w?.entries) ? w.entries : [])}
  function ledger(state, options={}) {
    if (!state || !state.settings || !Array.isArray(state.settings.models) || !Array.isArray(state.settings.mountings) || !state.weeks || typeof state.weeks!=="object" || Array.isArray(state.weeks) || (state.stockLedger!==undefined && !Array.isArray(state.stockLedger)) || Object.values(state.weeks).some(w=>!Array.isArray(w?.entries))) return {rows:[],issues:[{code:'invalid_state',message:'Estrutura de estoque ou produção inválida.'}]};
    const models=state.settings.models, mountings=state.settings.mountings;
    const byId=new Map(models.map(m=>[m.id,m]));
    const knownMounts=new Set(mountings.map(m=>m.id));
    const events=[], issues=[], ids=new Set();
    const add=(scope,location,sector,target,color,date,delta,id)=>events.push({scope,location,sector,target,color,date,delta,id});
    const report=(code,e,message)=>issues.push({code,id:e?.id||'',date:e?.date||'',message});
    function check(e, collection) {
      if (!e || typeof e!=='object' || !e.id || ids.has(collection+':'+e.id)) {report('invalid_id',e,'Identificador ausente ou repetido.');return false}
      ids.add(collection+':'+e.id);
      if (!validDate(e.date) || !Number.isSafeInteger(e.qty) || e.qty<=0) {report('invalid_movement',e,'Data ou quantidade de pares inválida.');return false}
      return true;
    }
    for (const e of flatten(state)) {
      if (!check(e,'production')) continue;
      const m=byId.get(e.modelId), line=lineOf(e,m), c=colorKey(e.color), q=e.qty, ref=refOf(m);
      if (!knownMounts.has(e.mountingId) || ![...components,'finished'].includes(e.kind) || !/^\d00$/.test(line)) {report('invalid_target',e,'Montagem, componente ou linha inválida.');continue}
      if (['cabedal','finished'].includes(e.kind) && (!m || !/^\d{3}R?$/.test(ref) || (m.line && String(m.line)!==line))) {report('invalid_model',e,'Referência ou linha do modelo inválida.');continue}
      const deltas=e.kind==='finished' ? [['cabedal',e.modelId,ref,-q],['solado',line,'@line:'+line,-q],...(usesPalmilha(m,line)?[['palmilha',line,'@line:'+line,-q]]:[]),['produto_pronto',null,ref,q]] : [[e.kind,e.kind==='cabedal'?e.modelId:line,e.kind==='cabedal'?ref:'@line:'+line,q]];
      for (const [sector,target,globalTarget,delta] of deltas) {
        if (target!==null) add('mounting',e.mountingId,sector,target,c,e.date,delta,e.id);
        add('global','all',sector,globalTarget,c,e.date,delta,e.id);
      }
    }
    for (const e of (state.stockLedger || [])) {
      if (!check(e,'stock')) continue;
      if (!['in','out'].includes(e.direction) || ![...components,'produto_pronto'].includes(e.sector) || !String(e.ref||'').trim()) {report('invalid_stock',e,'Tipo ou referência do movimento de estoque inválido.');continue}
      const isLine=['solado','palmilha'].includes(e.sector), ref=String(e.ref).toUpperCase();
      const line=ref.startsWith('@LINE:') ? ref.slice(6) : ((ref.match(/\d/)?.[0] || '')+'00');
      if (isLine && !/^\d00$/.test(line)) {report('invalid_stock',e,'Linha do componente não identificada.');continue}
      add('global','all',e.sector,isLine?'@line:'+line:ref,colorKey(e.color),e.date,e.qty*(e.direction==='out'?-1:1),e.id);
    }
    const daily=new Map();
    for (const e of events) {
      if (options.until && e.date>options.until) continue;
      const key=JSON.stringify([e.scope,e.location,e.sector,e.target,e.color,e.date]);
      if(!daily.has(key)) daily.set(key,{...e,delta:0});
      daily.get(key).delta+=e.delta;
    }
    const balances=new Map();
    for (const e of [...daily.values()].sort((a,b)=>a.date.localeCompare(b.date))) {
      const key=JSON.stringify([e.scope,e.location,e.sector,e.target,e.color]);
      if (!balances.has(key)) balances.set(key,{...e,qty:0});
      const row=balances.get(key);row.qty+=e.delta;
      if(row.qty<0) {
        const place=e.scope==='mounting'?(mountings.find(m=>m.id===e.location)?.name||e.location):'estoque total';
        const label=e.sector==='cabedal'&&e.scope==='mounting'?'Ref. '+refOf(byId.get(e.target)):String(e.target).startsWith('@line:')?'Linha '+String(e.target).slice(6):['solado','palmilha'].includes(e.sector)?'Linha '+e.target:'Ref. '+e.target;
        const dateLabel=e.date.split('-').reverse().join('/');
        issues.push({code:'insufficient_stock',scope:e.scope,location:e.location,sector:e.sector,target:e.target,color:e.color,date:e.date,missing:-row.qty,message:`Saldo insuficiente: faltam ${-row.qty} pares de ${e.sector} · ${label} · ${colorLabel(e.color)} em ${place}, na data ${dateLabel}.`});
      }
    }
    return {rows:[...balances.values()],issues};
  }
  function validate(state) {return ledger(state).issues}
  function withProductionChange(state,excludeId,candidate) {
    const all=flatten(state).filter(e=>e.id!==excludeId);
    if (candidate) {
      const previous=flatten(state).find(e=>e.id===excludeId);
      all.push({...previous,...candidate,id:previous?.id || candidate.id || '__preview__'});
    }
    return {...state,weeks:{preview:{entries:all}}};
  }
  function productionChangeIssues(state,excludeId,candidate) {return validate(withProductionChange(state,excludeId,candidate))}
  function mountingBalances(state,until) {
    const {rows,issues}=ledger(state,{until});const stock={};
    for (const mt of (state.settings?.mountings||[])) stock[mt.id]={models:{},lines:{},colorRows:[]};
    for (const r of rows.filter(x=>x.scope==='mounting')) {
      const mt=stock[r.location]||(stock[r.location]={models:{},lines:{},colorRows:[]});mt.colorRows.push(r);
      if(r.sector==='cabedal') {
        const name=(state.settings.models||[]).find(m=>m.id===r.target)?.name||r.target;
        const m=mt.models[r.target]||(mt.models[r.target]={name,cabedal:0});m.cabedal+=r.qty;
      } else {
        const l=mt.lines[r.target]||(mt.lines[r.target]={palmilha:0,solado:0});l[r.sector]+=r.qty;
      }
    }
    return {stock,issues};
  }
  function possibleForModel(state,mt,model) {
    const line=lineOf(null,model), rows=mt?.colorRows||[];
    return rows.filter(r=>r.sector==='cabedal'&&r.target===model.id&&r.qty>0).reduce((sum,c)=>{
      const get=sector=>Math.max(0,rows.find(r=>r.sector===sector&&r.target===line&&r.color===c.color)?.qty||0);
      return sum+Math.max(0,Math.min(c.qty,get('solado'),usesPalmilha(model,line)?get('palmilha'):Infinity));
    },0);
  }
  function possibleForMounting(state,mt) {
    const rows=mt?.colorRows||[], byId=new Map((state.settings?.models||[]).map(m=>[m.id,m]));
    return rows.filter(r=>r.sector==='solado'&&r.qty>0).reduce((total,s)=>{
      let withPalm=0,noPalm=0;
      for(const r of rows) if(r.sector==='cabedal'&&r.color===s.color&&r.qty>0) {
        const m=byId.get(r.target);if(!m || lineOf(null,m)!==s.target) continue;
        if(usesPalmilha(m,s.target))withPalm+=r.qty;else noPalm+=r.qty;
      }
      const palm=Math.max(0,rows.find(r=>r.sector==='palmilha'&&r.target===s.target&&r.color===s.color)?.qty||0);
      return total+Math.min(s.qty,noPalm+Math.min(withPalm,palm));
    },0);
  }
  return {UNKNOWN,colorKey,colorLabel,refOf,lineOf,usesPalmilha,validDate,flatten,ledger,validate,withProductionChange,productionChangeIssues,mountingBalances,possibleForModel,possibleForMounting};
});