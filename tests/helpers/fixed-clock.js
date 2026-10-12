'use strict';

// Inject into the app's VM without changing the host clock or Date globally.
function fixedClock(iso){
  let now;
  function set(value){
    const next=Date.parse(value);
    if(!Number.isFinite(next))throw new Error('Invalid synthetic clock date');
    now=next;
  }
  set(iso);
  return {set,Date:class extends Date{
    constructor(...args){super(...(args.length?args:[now]))}
    static now(){return now}
  }};
}
module.exports={fixedClock};
