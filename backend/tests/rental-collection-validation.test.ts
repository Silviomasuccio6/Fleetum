import assert from 'node:assert/strict';import test from 'node:test';
import {rentalCollectionQuerySchema,rentalCollectionReceiptSchema,rentalCollectionRefundSchema,rentalCollectionReversalSchema} from '../src/interfaces/http/validators/rental-payments-validators.js';
const data={amountCents:1,method:'CASH',occurredAt:'2026-01-01T10:00:00Z',reference:'Receipt',reason:'Synthetic receipt'};
test('collection commands cannot assert online verification, tenant, actor, payment status or a fake zero transaction',()=>{
 assert.ok(rentalCollectionReceiptSchema.safeParse(data).success);
 for(const value of [{...data,amountCents:0},{...data,amountCents:1.5},{...data,method:'STRIPE'},{...data,tenantId:'other'},{...data,userId:'other'},{...data,status:'PAID'}])assert.equal(rentalCollectionReceiptSchema.safeParse(value).success,false);
 assert.equal(rentalCollectionRefundSchema.safeParse(data).success,false);assert.equal(rentalCollectionReversalSchema.safeParse(data).success,false);
});
test('workspace validation rejects impossible or reversed dates and unbounded or fabricated filters',()=>{
 for(const value of [{from:'2026-02-31'},{from:'2026-02-02',to:'2026-01-01'},{pageSize:101},{state:'STRIPE_PAID'},{method:'STRIPE'},{search:'a'.repeat(161)}])assert.equal(rentalCollectionQuerySchema.safeParse(value).success,false);
 assert.ok(rentalCollectionQuerySchema.safeParse({from:'2024-02-29',to:'2024-03-01'}).success);
});
