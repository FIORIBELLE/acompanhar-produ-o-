'use strict';
// Entirely synthetic, deliberately unlike the operational database.
function receiptState(){
  return {
    clients:[{id:'client-test-a',name:'Cliente de teste A'},{id:'client-test-b',name:'Cliente de teste B'}],
    orders:[{id:'order-test-a',clientId:'client-test-a',date:'2026-10-01',deliveryStatus:'pending',
      items:[{ref:'TESTE-01',qty:72,unitPriceCents:1275},{ref:'TESTE-02',qty:20,unitPriceMills:27445}],
      totalCents:146690,note:'Fixture sintética'},
      {id:'order-test-b',clientId:'client-test-b',date:'2026-10-02',deliveryStatus:'delivered',
        items:[{ref:'TESTE-03',qty:10,unitPriceMills:12345}],totalCents:12345}],
    payments:[{id:'payment-test-2',clientId:'client-test-a',date:'2026-10-03',amountCents:110000,
      allocations:[{orderId:'order-test-a',amountCents:15000},{orderId:'order-test-b',amountCents:12345},
        {orderId:'order-test-a',amountCents:25000}]},
      {id:'payment-test-1',clientId:'client-test-a',date:'2026-10-02',amountCents:70000,
        allocations:[{orderId:'order-test-a',amountCents:70000}]},
      {id:'payment-test-unallocated',clientId:'client-test-a',date:'2026-10-04',amountCents:20000,allocations:[]}],
    orderEvents:[{id:'do-not-touch',note:'Unrelated state remains unchanged'}]
  };
}
module.exports={receiptState};
