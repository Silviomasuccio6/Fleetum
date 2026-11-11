import assert from 'node:assert/strict';import test from 'node:test';
import {captureBeforeFromIntent} from '../src/domain/payments/rental-deposit-deadline.js';
test('only the expanded charge bound to the verified intent supplies the real authorization deadline',()=>{
 const value={id:'pi_synthetic',latest_charge:{id:'ch_synthetic',payment_intent:'pi_synthetic',payment_method_details:{card:{capture_before:1800000000}}}};
 assert.equal(captureBeforeFromIntent(value)?.toISOString(),new Date(1800000000000).toISOString());
 assert.equal(captureBeforeFromIntent({...value,latest_charge:{...value.latest_charge,payment_intent:'pi_other'}}),null);
 for(const latest_charge of ['ch_synthetic',null,{}, {payment_intent:'pi_synthetic',payment_method_details:{card:{capture_before:0}}}])assert.equal(captureBeforeFromIntent({...value,latest_charge}),null);
});
