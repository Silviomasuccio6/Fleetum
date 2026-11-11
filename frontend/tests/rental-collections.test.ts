import test from 'node:test';import assert from 'node:assert/strict';
import {parseCollectionCents,receiptRemaining,canReverseEntry,collectionHref} from '../src/presentation/pages/rental-payments/collection-presentation';
import type {CollectionEntry} from '../src/application/usecases/rental-collections-usecases';
const entry=(id:string,kind:CollectionEntry['kind']='RECEIPT',amountCents=5000,sourceId:string|null=null)=>({id,kind,amountCents,sourceId} as CollectionEntry);
test('manual receipts preserve cents, comma decimals and reject subcents, negatives, exponent, zero and non-finite input',()=>{
 for(const [value,cents]of [['0,10',10],['0.20',20],['80',8000],['149.99',14999]] as const)assert.equal(parseCollectionCents(value),cents);
 for(const value of ['0','-1','1.001','Infinity','1e3','1,000.00','1000000.01'])assert.equal(parseCollectionCents(value),null,value);
});
test('manual refund controls derive remaining amount from active receipts and linked reversals',()=>{
 const original=entry('a'),refund=entry('b','REFUND',2000,'a'),reversal=entry('c','REVERSAL',2000,'b');
 assert.equal(receiptRemaining(original,[original,refund]),3000);assert.equal(canReverseEntry(original,[original,refund]),false);
 assert.equal(receiptRemaining(original,[original,refund,reversal]),5000);assert.equal(canReverseEntry(original,[original,refund,reversal]),true);
 assert.equal(canReverseEntry(reversal,[original,refund,reversal]),false);
});
test('the dedicated page preserves a booking context as an encoded query rather than injecting another query',()=>{
 const href=collectionHref('synthetic&id','/booking?bookingId=synthetic&id');const url=new URL(href,'http://localhost');
 assert.equal(url.pathname,'/pagamenti-garanzie');assert.equal(url.searchParams.get('bookingId'),'synthetic&id');assert.equal(url.searchParams.get('returnTo'),'/booking?bookingId=synthetic&id');assert.equal([...url.searchParams].length,2);
});
