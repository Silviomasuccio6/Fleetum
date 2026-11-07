import test from 'node:test';
import assert from 'node:assert/strict';
import {collectionBalance,collectionEffect,validateCollectionTarget} from '../src/domain/payments/rental-collection-policy.js';
const row=(id:string,kind='RECEIPT',amountCents=5000,sourceId:string|null=null)=>({id,kind,amountCents,sourceId});
test('an agreed 80 euro rental with 50 received has 30 due; guarantees and extras never enter the ledger',()=>{
 assert.deepEqual(collectionBalance(8000,[row('a')]),{agreedCents:8000,receivedCents:5000,outstandingCents:3000,creditCents:0,state:'PARTIAL'});
});
test('zero is free without manufacturing an entry, while an unknown total stays unknown',()=>{
 assert.equal(collectionBalance(0,[]).state,'FREE');assert.equal(collectionBalance(null,[]).state,'UNKNOWN');assert.equal(collectionBalance(null,[]).outstandingCents,null);
});
test('refund and append-only reversal keep the original record and recompute the same balance',()=>{
 const rows=[row('a'),row('b','REFUND',2000,'a')];assert.equal(collectionBalance(8000,rows).receivedCents,3000);
 rows.push(row('c','REVERSAL',2000,'b'));assert.equal(collectionBalance(8000,rows).receivedCents,5000);assert.equal(collectionEffect(rows[2],rows),2000);
});
test('refunds cannot exceed the remaining received amount or target a refund/reversed entry',()=>{
 const rows=[row('a'),row('b','REFUND',4000,'a')];assert.doesNotThrow(()=>validateCollectionTarget('REFUND','a',1000,rows));
 assert.throws(()=>validateCollectionTarget('REFUND','a',1001,rows));assert.throws(()=>validateCollectionTarget('REFUND','b',100,rows));
 assert.throws(()=>validateCollectionTarget('REVERSAL','a',5000,rows));
 rows.push(row('c','REVERSAL',4000,'b'));assert.doesNotThrow(()=>validateCollectionTarget('REVERSAL','a',5000,rows));
});
test('a reversal is exact, single-use and never reverses another reversal',()=>{
 assert.throws(()=>validateCollectionTarget('REVERSAL','a',4000,[row('a')]));
 const rows=[row('a'),row('b','REVERSAL',5000,'a')];assert.throws(()=>validateCollectionTarget('REVERSAL','a',5000,rows));assert.throws(()=>validateCollectionTarget('REVERSAL','b',5000,rows));
});
test('overpayment remains a visible customer credit and cents never silently round',()=>{
 const value=collectionBalance(100,[row('a','RECEIPT',150)]);assert.equal(value.state,'CREDIT');assert.equal(value.creditCents,50);assert.equal(value.outstandingCents,0);
 assert.throws(()=>collectionBalance(1.2,[]));assert.throws(()=>collectionBalance(0,[row('a','RECEIPT',Number.MAX_SAFE_INTEGER+1)]));
});
