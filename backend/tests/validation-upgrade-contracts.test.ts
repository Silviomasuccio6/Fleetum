import assert from "node:assert/strict";
import test from "node:test";
import { rentalPricingCreateExtraPolicySchema,rentalPricingCreateListSchema,rentalPricingUpdateListSchema,rentalPricingUpdatePackageSchema,rentalPricingUpdateExtraPolicySchema,rentalBookingCreateSchema,rentalBookingUpdateSchema,rentalCustomerUpdateSchema } from "../src/interfaces/http/validators/rental-bookings-validators.js";
import { reportsSettingsSchema,playbooksSettingsSchema,integrationsSettingsSchema } from "../src/interfaces/http/validators/settings-validators.js";
import { rentalPaymentSetupSessionSchema } from "../src/interfaces/http/validators/rental-payments-validators.js";
import { publicAnalyticsEventSchema } from "../src/interfaces/http/validators/public-validators.js";
import { loginSchema } from "../src/interfaces/http/validators/auth-validators.js";
for(const[name,schema]of[["list",rentalPricingUpdateListSchema],["package",rentalPricingUpdatePackageSchema],["policy",rentalPricingUpdateExtraPolicySchema]]as const)
test(`partial ${name} update never introduces defaults for omitted values`,()=>{
 assert.deepEqual(schema.parse({}),{});assert.deepEqual(schema.parse({name:"Synthetic update"}),{name:"Synthetic update"});assert.deepEqual(schema.parse({isActive:false}),{isActive:false});
 const explicit=schema.parse({isActive:undefined});assert.ok(Object.hasOwn(explicit,"isActive"));assert.equal(explicit.isActive,undefined);
});
test("create defaults, coercions and partial booking dates preserve the API contract",()=>{
 const list=rentalPricingCreateListSchema.parse({name:"Synthetic list",baseRateAmount:"19.50"});assert.equal(list.baseRateAmount,19.5);assert.equal(list.vatRate,22);assert.equal(list.scope,"GLOBAL");assert.equal(list.isActive,true);
 const booking=rentalBookingCreateSchema.parse({vehicleId:"synthetic-vehicle",customerId:"synthetic-customer",pickupAt:"2035-01-01T10:00:00Z",returnAt:"2035-01-02T10:00:00Z"});assert.equal(booking.generateContract,true);assert.ok(booking.pickupAt instanceof Date);
 assert.deepEqual(rentalBookingUpdateSchema.parse({internalNotes:"Synthetic note"}),{internalNotes:"Synthetic note"});assert.equal(rentalBookingCreateSchema.safeParse({...booking,returnAt:"2034-01-01T10:00:00Z"}).success,false);
});
test("missing coerced settings booleans keep the previous false default",()=>{
 assert.equal(reportsSettingsSchema.parse({recipients:[],frequency:"weekly",hour:8,minute:0,reportStyle:"EXECUTIVE"}).enabled,false);
 assert.equal(playbooksSettingsSchema.parse({WAITING_PARTS:{reminderEveryDays:3},SOLICITED:{reminderEveryDays:2}}).WAITING_PARTS.enabled,false);
 assert.deepEqual(integrationsSettingsSchema.parse({}),{erpWebhookUrl:"",telematicsWebhookUrl:"",ticketingWebhookUrl:""});
});
test("payment mandate retains explicit consent and its actionable error",()=>{
 const result=rentalPaymentSetupSessionSchema.safeParse({mandateAccepted:false,termsVersion:"synthetic-v1"});assert.equal(result.success,false);
 if(!result.success)assert.deepEqual(result.error.flatten().fieldErrors.mandateAccepted,["Devi accettare il mandato per registrare la carta del cliente."]);
 assert.deepEqual(rentalPaymentSetupSessionSchema.parse({mandateAccepted:true,termsVersion:"synthetic-v1"}),{mandateAccepted:true,termsVersion:"synthetic-v1"});
});
test("login rejects invalid email and strips injected authority",()=>{
 assert.equal(loginSchema.safeParse({email:"not-an-email",password:"Synthetic-123!"}).success,false);
 const parsed=loginSchema.parse({email:"synthetic@example.invalid",password:"Synthetic-123!",roles:["ADMIN"],tenantId:"foreign"});assert.ok(!Object.hasOwn(parsed,"roles"));assert.ok(!Object.hasOwn(parsed,"tenantId"));
});

test("a customer update never silently changes a company into an individual",()=>{
 assert.deepEqual(rentalCustomerUpdateSchema.parse({companyName:"Synthetic company"}),{companyName:"Synthetic company"});
 assert.deepEqual(rentalCustomerUpdateSchema.parse({}),{});
});

test("oversized pricing collections fail once at the container before parsing invalid children",()=>{
 const result=rentalPricingCreateExtraPolicySchema.safeParse({name:"Synthetic",type:"FLAT",flatRatePerKm:0,tiers:Array(1001).fill({})});
 assert.equal(result.success,false);if(!result.success){assert.equal(result.error.issues.length,1);assert.equal(result.error.issues[0].code,"too_big");assert.deepEqual(result.error.issues[0].path,["tiers"]);}
});
test("analytics metadata checks its existing key limit before inspecting attacker-controlled values",()=>{
 let visits=0;const metadata=Object.fromEntries(Array.from({length:21},(_,i)=>["synthetic"+i,null]));
 Object.defineProperty(metadata,"synthetic0",{enumerable:true,get(){visits++;return {};}});
 const result=publicAnalyticsEventSchema.safeParse({eventType:"PAGE_VIEW",path:"/synthetic",metadata});
 assert.equal(result.success,false);assert.equal(visits,0);if(!result.success){assert.equal(result.error.issues.length,1);assert.deepEqual(result.error.issues[0].path,["metadata"]);}
 assert.equal(publicAnalyticsEventSchema.safeParse({eventType:"PAGE_VIEW",path:"/synthetic",metadata:{synthetic:"ok"}}).success,true);
});
