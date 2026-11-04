import {assertSyntheticDatabase} from "../helpers/synthetic-database.js";
import assert from "node:assert/strict";
import {after,before,describe,it} from "node:test";
import type http from "node:http";
import type {AddressInfo} from "node:net";
import {createApp} from "../../src/app.js";
import {prisma} from "../../src/infrastructure/database/prisma/client.js";
import {requireAuth} from "../../src/interfaces/http/middlewares/auth.js";
import {SiteAccessService} from "../../src/application/services/site-access-service.js";
import {runWithSiteAccess} from "../../src/infrastructure/auth/site-access-context.js";
import {RentalPaymentService} from "../../src/application/services/rental-payment-service.js";
import {PrismaAuditLogRepository} from "../../src/infrastructure/repositories/prisma-audit-log-repository.js";
import {EmailQueueService} from "../../src/infrastructure/email/email-queue-service.js";
import {emailSender} from "../../src/infrastructure/email/email-sender.js";
import {signTenantAccessToken} from "../helpers/http-auth.js";
import {env} from "../../src/shared/config/env.js";

const ids:Record<string,string>={},tokens:Record<string,string>={},tenants:string[]=[],sent:unknown[]=[];
const run=`payment-scope-${Date.now()}`,originalSend=emailSender.send,originalKey=env.STRIPE_SECRET_KEY;
let server:http.Server|undefined,base="",providerCalls=0;
const fakeStripe=new Proxy({},{get(){return new Proxy({},{get(){return async()=>{providerCalls++;throw new Error("Synthetic provider must not be reached by a denied command");};}});}}) as any;
const service=new RentalPaymentService(new PrismaAuditLogRepository(),fakeStripe);
const call=(who:string,path:string,options:{method?:string;body?:object;site?:string}={})=>fetch(base+path,{method:options.method??"GET",headers:{Authorization:`Bearer ${tokens[who]}`,...(options.body?{"Content-Type":"application/json"}:{}),...(options.site?{"X-Fleetum-Site":options.site}:{})},...(options.body?{body:JSON.stringify(options.body)}:{})});
const json=async(who:string,path:string,site?:string)=>{const r=await call(who,path,{site});assert.equal(r.status,200,await r.clone().text());return r.json() as Promise<any>;};
const scoped=async<T>(who:string,fn:()=>Promise<T>,site?:string)=>runWithSiteAccess(await new SiteAccessService().resolveSelectedScope(ids.a,ids[who+"User"],site),fn);
const noPrivate=(value:unknown)=>{const text=JSON.stringify(value);for(const key of ["privateBooking","privateMethod","privateDeposit","privateExtra","milanList","milanPackage","milanPolicy","foreignList","foreignMethod"])assert.ok(!text.includes(ids[key]),key);};
const quote=(priceListId:string)=>({priceListId,pickupAt:new Date().toISOString(),returnAt:new Date(Date.now()+86400000).toISOString(),estimatedKm:100});

describe("E02 payment commands, shared customers and scoped pricing",()=>{
  before(async()=>{
    assertSyntheticDatabase({user:"fleetum_e02_payments",database:"fleetum_e02_payments_test",port:"61526"});
    assert.equal(process.env.NODE_ENV,"test");assert.equal(process.env.DOTENV_CONFIG_PATH,"/dev/null");
    const target=new URL(process.env.DATABASE_URL!);
    env.STRIPE_SECRET_KEY="synthetic-provider-presence-only";emailSender.send=async input=>{sent.push(input);return{provider:"resend",id:"synthetic-extra-notice"};};
    for(const role of ["ADMIN","MANAGER","OPERATOR"]){ids[role]=(await prisma.role.upsert({where:{key:role},update:{},create:{key:role,name:role}})).id;for(const key of ["vehicles:read","vehicles:write","rental-payments:read","rental-payments:write","rental-payments:charge","privacy:export","privacy:manage"]){const p=await prisma.permission.upsert({where:{key},update:{},create:{key,description:"Synthetic"}});ids[key]=p.id;await prisma.rolePermission.upsert({where:{roleId_permissionId:{roleId:ids[role],permissionId:p.id}},update:{},create:{roleId:ids[role],permissionId:p.id}});}}
    for(const name of ["a","b"]){ids[name]=(await prisma.tenant.create({data:{name:`${run}-${name}`}})).id;tenants.push(ids[name]);await prisma.tenantSubscription.create({data:{tenantId:ids[name],provider:"local",status:"ACTIVE",plan:"ENTERPRISE",seats:20}});ids[name+"Customer"]=(await prisma.rentalCustomer.create({data:{tenantId:ids[name],firstName:"Synthetic",lastName:name,email:`${name}@example.invalid`}})).id;ids[name+"Profile"]=(await prisma.rentalCustomerPaymentProfile.create({data:{tenantId:ids[name],rentalCustomerId:ids[name+"Customer"],stripeCustomerId:`cus_${run}_${name}`}})).id;}
    for(const [name,tenant] of [["rome","a"],["milan","a"],["naples","a"],["foreign","b"]]){ids[name]=(await prisma.site.create({data:{tenantId:ids[tenant],name:`Synthetic ${name}`,address:"Synthetic",city:"Synthetic"}})).id;ids[name+"Vehicle"]=(await prisma.vehicle.create({data:{tenantId:ids[tenant],siteId:ids[name],plate:`SYN-${name}`,brand:"Synthetic",model:"Synthetic"}})).id;}
    for(const [name,role,tenant,site] of [["rome","OPERATOR","a",ids.rome],["milan","OPERATOR","a",ids.milan],["unassigned","OPERATOR","a",null],["manager","MANAGER","a",null],["foreign","ADMIN","b",null]] as const){const user=await prisma.user.create({data:{tenantId:ids[tenant],email:`${run}-${name}@example.invalid`,firstName:"Synthetic",lastName:name,passwordHash:"synthetic-unused",assignedSiteId:site,roles:{create:{roleId:ids[role]}}}});ids[name+"User"]=user.id;const session=await prisma.refreshSession.create({data:{tenantId:ids[tenant],userId:user.id,tokenHash:`${run}-${name}`,expiresAt:new Date(Date.now()+3600000)}});tokens[name]=signTenantAccessToken({tenantId:ids[tenant],userId:user.id,sessionId:session.id});}
    for(const [name,tenant,vehicle,site,destination] of [["local","a",ids.milanVehicle,ids.rome,ids.rome],["cross","a",ids.naplesVehicle,ids.rome,ids.milan],["private","a",ids.romeVehicle,ids.milan,ids.milan],["legacy","a",ids.romeVehicle,null,null],["foreign","b",ids.foreignVehicle,ids.foreign,ids.foreign]] as const){
      ids[name+"Booking"]=(await prisma.rentalBooking.create({data:{tenantId:ids[tenant],vehicleId:vehicle,customerId:ids[tenant+"Customer"],siteId:site,pickupSiteId:site,returnSiteId:destination,code:`${run}-${name}`,customerName:"Synthetic",customerEmail:`${tenant}@example.invalid`,pickupAt:new Date(),returnAt:new Date(Date.now()+86400000)}})).id;
      ids[name+"Method"]=(await prisma.rentalCustomerPaymentMethod.create({data:{tenantId:ids[tenant],rentalCustomerId:ids[tenant+"Customer"],paymentProfileId:ids[tenant+"Profile"],bookingId:ids[name+"Booking"],stripeCustomerId:`cus_${run}_${tenant}`,stripePaymentMethodId:`pm_${run}_${name}`,status:"ACTIVE",mandateAccepted:true,cardBrand:"visa",cardLast4:"4242"}})).id;
      ids[name+"Deposit"]=(await prisma.rentalDeposit.create({data:{tenantId:ids[tenant],bookingId:ids[name+"Booking"],rentalCustomerId:ids[tenant+"Customer"],vehicleId:vehicle,paymentMethodId:ids[name+"Method"],stripePaymentIntentId:`pi_${run}_${name}`,status:"AUTHORIZED",amountCents:10000}})).id;
      ids[name+"Extra"]=(await prisma.rentalExtraCharge.create({data:{tenantId:ids[tenant],bookingId:ids[name+"Booking"],rentalCustomerId:ids[tenant+"Customer"],vehicleId:vehicle,paymentMethodId:ids[name+"Method"],type:"FUEL",description:`Synthetic ${name}`,status:"APPROVED",amountCents:1000,totalAmountCents:1000,createdByUserId:ids[tenant==="a"?"romeUser":"foreignUser"]}})).id;
    }
    ids.unclassifiedMethod=(await prisma.rentalCustomerPaymentMethod.create({data:{tenantId:ids.a,rentalCustomerId:ids.aCustomer,paymentProfileId:ids.aProfile,stripeCustomerId:`cus_${run}_a`,stripePaymentMethodId:`pm_${run}_unclassified`,status:"ACTIVE",mandateAccepted:true}})).id;
    for(const [name,tenant,scope,siteId,vehicleId] of [["global","a","GLOBAL",null,null],["category","a","VEHICLE_CATEGORY",null,null],["rome","a","SITE",ids.rome,null],["milan","a","SITE",ids.milan,null],["vehicle","a","VEHICLE",null,ids.romeVehicle],["foreign","b","SITE",ids.foreign,null]] as const){
      ids[name+"List"]=(await prisma.rentalPriceList.create({data:{tenantId:ids[tenant],name:`Synthetic ${name}`,scope,siteId,vehicleId,vehicleCategory:scope==="VEHICLE_CATEGORY"?"Synthetic":null,baseRateUnit:"DAILY",baseRateAmount:100}})).id;
      ids[name+"Package"]=(await prisma.rentalPricePackage.create({data:{tenantId:ids[tenant],priceListId:ids[name+"List"],name:`Synthetic ${name}`,code:name,type:"LIMITED",kmIncluded:100,kmScope:"PER_DAY",isDefault:true}})).id;
      ids[name+"Policy"]=(await prisma.rentalExtraKmPolicy.create({data:{tenantId:ids[tenant],priceListId:ids[name+"List"],packageId:ids[name+"Package"],name:`Synthetic ${name}`,type:"FLAT",flatRatePerKm:1,isDefault:true}})).id;
    }
    const app=createApp();server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server!.once("listening",resolve));base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  after(async()=>{
    await new Promise<void>(resolve=>server?server.close(()=>resolve()):resolve());emailSender.send=originalSend;env.STRIPE_SECRET_KEY=originalKey;
    const where={tenantId:{in:tenants}};
    for(const model of [prisma.auditLog,prisma.emailQueue,prisma.rentalPaymentEvent,prisma.rentalDeposit,prisma.rentalExtraCharge,prisma.rentalCustomerPaymentMethod,prisma.rentalCustomerPaymentProfile,prisma.rentalBookingPricingSnapshot,prisma.rentalExtraKmTier,prisma.rentalExtraKmPolicy,prisma.rentalPricePackage,prisma.rentalPriceList,prisma.rentalBooking,prisma.rentalCustomer,prisma.vehicle,prisma.refreshSession] as any[])await model.deleteMany({where});
    await prisma.userRole.deleteMany({where:{user:{tenantId:{in:tenants}}}});await prisma.user.deleteMany({where});await prisma.site.deleteMany({where});await prisma.tenantSubscription.deleteMany({where});await prisma.tenant.deleteMany({where:{id:{in:tenants}}});await prisma.$disconnect();
  });
  it("keeps payment summaries on historical authorized booking sites",async()=>{
    for(const booking of ["local","cross"]){const data=await json("rome",`/rental-payments/bookings/${ids[booking+"Booking"]}/summary`);assert.equal(data.booking.id,ids[booking+"Booking"]);noPrivate(data);}
    for(const booking of ["private","legacy","foreign"])assert.equal((await call("rome",`/rental-payments/bookings/${ids[booking+"Booking"]}/summary`)).status,404);
  });
  it("shares customers without disclosing cards or booking IDs from another site",async()=>{
    const cards=await json("rome",`/rental-payments/customers/${ids.aCustomer}/payment-methods`);noPrivate(cards);assert.ok(JSON.stringify(cards).includes(ids.localMethod));assert.ok(!JSON.stringify(cards).includes(ids.unclassifiedMethod));
    assert.deepEqual(await json("unassigned",`/rental-payments/customers/${ids.aCustomer}/payment-methods`),[]);
    assert.equal((await call("rome",`/rental-payments/customers/${ids.bCustomer}/payment-methods`)).status,404);
  });
  it("rejects direct foreign-site financial commands before any provider call or mutation",async()=>{
    const input={tenantId:ids.a,userId:ids.romeUser},before=await prisma.rentalExtraCharge.findUniqueOrThrow({where:{id:ids.privateExtra}}),count=providerCalls;
    const commands=[()=>service.createSetupSession({...input,bookingId:ids.privateBooking,mandateAccepted:true,termsVersion:"synthetic"}),()=>service.createDeposit({...input,bookingId:ids.privateBooking,paymentMethodId:ids.privateMethod,amountCents:1000}),()=>service.captureDeposit({...input,depositId:ids.privateDeposit}),()=>service.releaseDeposit({...input,depositId:ids.privateDeposit}),()=>service.createExtraCharge({...input,bookingId:ids.privateBooking,type:"FUEL",description:"Synthetic",amountCents:100}),()=>service.approveExtraCharge({...input,extraChargeId:ids.privateExtra}),()=>service.notifyExtraCharge({...input,extraChargeId:ids.privateExtra}),()=>service.chargeExtraCharge({...input,extraChargeId:ids.privateExtra}),()=>service.cancelExtraCharge({...input,extraChargeId:ids.privateExtra})];
    for(const command of commands)await assert.rejects(scoped("rome",command),error=>(error as any).statusCode===404 || (error as any).status===404);
    assert.equal(providerCalls,count);assert.deepEqual(await prisma.rentalExtraCharge.findUniqueOrThrow({where:{id:ids.privateExtra}}),before);
  });
  it("rejects use of another branch's card on a visible booking",async()=>{
    await assert.rejects(scoped("rome",()=>service.createExtraCharge({tenantId:ids.a,userId:ids.romeUser,bookingId:ids.localBooking,paymentMethodId:ids.privateMethod,type:"FUEL",description:"Synthetic",amountCents:100})));
  });
  it("supports manager all/selected and unassigned financial views",async()=>{
    assert.equal((await json("manager",`/rental-payments/bookings/${ids.privateBooking}/summary`)).booking.id,ids.privateBooking);
    assert.equal((await call("manager",`/rental-payments/bookings/${ids.privateBooking}/summary`,{site:ids.rome})).status,404);
    assert.equal((await call("unassigned",`/rental-payments/bookings/${ids.localBooking}/summary`)).status,404);
  });
  it("filters lists, count, nested counts, packages and extra policies before returning them",async()=>{
    const data=await json("rome","/rental-pricing/lists?pageSize=50");noPrivate(data);assert.equal(data.total,4);
    noPrivate(await json("rome","/rental-pricing/extra-policies"));
    assert.equal((await call("rome",`/rental-pricing/lists/${ids.milanList}/packages`)).status,404);
    assert.equal((await json("unassigned","/rental-pricing/lists")).total,0);
  });
  it("cannot expand list visibility with a manipulated site filter",async()=>{
    assert.equal((await json("rome",`/rental-pricing/lists?siteId=${ids.milan}`)).total,0);
    assert.equal((await json("manager",`/rental-pricing/lists`,ids.milan)).total,3);
  });
  it("rejects private lists in both quote endpoints",async()=>{
    for(const route of ["preview","finalize"]){assert.equal((await call("rome",`/rental-pricing/quote/${route}`,{method:"POST",body:quote(ids.milanList)})).status,404);assert.equal((await call("rome",`/rental-pricing/quote/${route}`,{method:"POST",body:quote(ids.romeList)})).status,200);}
  });
  it("does not allow operators or a narrowed manager to mutate company-wide pricing",async()=>{
    for(const [who,site] of [["rome",undefined],["manager",ids.rome]] as const){assert.equal((await call(who,`/rental-pricing/lists/${ids.globalList}`,{method:"PATCH",body:{name:"Synthetic denied"},site})).status,403);assert.equal((await call(who,`/rental-pricing/packages/${ids.globalPackage}`,{method:"PATCH",body:{name:"Synthetic denied"},site})).status,403);}
  });
  it("blocks private list, package and policy writes without changing defaults",async()=>{
    for(const [resource,id] of [["lists",ids.milanList],["packages",ids.milanPackage],["extra-policies",ids.milanPolicy]])for(const method of ["PATCH","DELETE"])assert.equal((await call("rome",`/rental-pricing/${resource}/${id}`,{method,body:method==="PATCH"?{name:"Synthetic denied",isDefault:true}:undefined})).status,404);
    assert.equal((await prisma.rentalPricePackage.findUniqueOrThrow({where:{id:ids.milanPackage}})).isDefault,true);
  });
  it("allows local edits and company-wide edits with existing manager permission",async()=>{
    assert.equal((await call("rome",`/rental-pricing/packages/${ids.romePackage}`,{method:"PATCH",body:{name:"Synthetic updated"}})).status,200);
    assert.equal((await call("manager",`/rental-pricing/lists/${ids.globalList}`,{method:"PATCH",body:{name:"Synthetic global updated"}})).status,200);
  });
  it("rechecks scope on the next request after reassignment",async()=>{
    await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.milan}});
    try{assert.equal((await call("rome",`/rental-payments/bookings/${ids.localBooking}/summary`)).status,404);assert.equal((await json("rome",`/rental-payments/bookings/${ids.privateBooking}/summary`)).booking.id,ids.privateBooking);}
    finally{await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.rome}});}
  });
  it("uses private no-store caches and preserves permission barriers",async()=>{
    for(const route of ["/rental-pricing/lists",`/rental-payments/bookings/${ids.localBooking}/summary`]){const r=await call("rome",route);assert.equal(r.status,200);assert.equal(r.headers.get("cache-control"),"private, no-store");await r.text();}
    const key={roleId_permissionId:{roleId:ids.OPERATOR,permissionId:ids["rental-payments:read"]}};await prisma.rolePermission.delete({where:key});
    try{assert.equal((await call("rome",`/rental-payments/bookings/${ids.localBooking}/summary`)).status,403);}finally{await prisma.rolePermission.create({data:{roleId:ids.OPERATOR,permissionId:ids["rental-payments:read"]}});}
  });
  it("blocks cross-site repricing through the booking endpoint without changing saved terms",async()=>{
    const before=await prisma.rentalBooking.findUniqueOrThrow({where:{id:ids.localBooking}});
    const r=await call("rome",`/rental-bookings/${ids.localBooking}/pricing`,{method:"PATCH",body:{priceListId:ids.milanList,pricePackageId:ids.milanPackage}});
    assert.equal(r.status,404,await r.clone().text());assert.deepEqual(await prisma.rentalBooking.findUniqueOrThrow({where:{id:ids.localBooking}}),before);
  });
  it("rejects private package IDs and policies while quoting an otherwise visible list",async()=>{
    for(const body of [{...quote(ids.romeList),pricePackageId:ids.milanPackage},{...quote(ids.romeList),extraKmPolicyId:ids.milanPolicy}])assert.equal((await call("rome","/rental-pricing/quote/preview",{method:"POST",body})).status,404);
  });
  it("checks source and destination scope for list creation and scope changes",async()=>{
    const count=await prisma.rentalPriceList.count({where:{tenantId:ids.a}});
    for(const body of [{name:"Synthetic denied",scope:"GLOBAL",baseRateAmount:10},{name:"Synthetic denied",scope:"SITE",siteId:ids.milan,baseRateAmount:10},{name:"Synthetic denied",scope:"VEHICLE",vehicleId:ids.milanVehicle,baseRateAmount:10}]){
      const r=await call("rome","/rental-pricing/lists",{method:"POST",body});assert.ok([403,404].includes(r.status),await r.text());
    }
    assert.equal(await prisma.rentalPriceList.count({where:{tenantId:ids.a}}),count);
    assert.equal((await call("rome",`/rental-pricing/lists/${ids.romeList}`,{method:"PATCH",body:{scope:"GLOBAL"}})).status,403);
    assert.equal((await call("rome",`/rental-pricing/lists/${ids.romeList}`,{method:"PATCH",body:{scope:"SITE",siteId:ids.milan}})).status,404);
  });
  it("does not leak private booking counts through a global list",async()=>{
    for(const name of ["local","private"])await prisma.rentalBookingPricingSnapshot.create({data:{tenantId:ids.a,bookingId:ids[name+"Booking"],priceListId:ids.globalList}});
    try{
      const list=(await json("rome","/rental-pricing/lists")).data.find((r:any)=>r.id===ids.globalList);assert.equal(list._count.bookingSnapshots,1);
      const all=(await json("manager","/rental-pricing/lists")).data.find((r:any)=>r.id===ids.globalList);assert.equal(all._count.bookingSnapshots,2);
    }finally{await prisma.rentalBookingPricingSnapshot.deleteMany({where:{tenantId:ids.a,bookingId:{in:[ids.localBooking,ids.privateBooking]}}});}
  });
  it("omits policies with corrupt cross-list package references from lists, counts and writes",async()=>{
    const bad=await prisma.rentalExtraKmPolicy.create({data:{tenantId:ids.a,priceListId:ids.romeList,packageId:ids.milanPackage,name:"Synthetic corrupt",type:"FLAT",flatRatePerKm:999}});
    try{
      assert.ok(!JSON.stringify(await json("rome","/rental-pricing/extra-policies")).includes(bad.id));
      const list=(await json("rome","/rental-pricing/lists")).data.find((r:any)=>r.id===ids.romeList);assert.equal(list._count.extraKmPolicies,1);
      assert.equal((await call("rome",`/rental-pricing/extra-policies/${bad.id}`,{method:"PATCH",body:{name:"Synthetic denied"}})).status,404);
    }finally{await prisma.rentalExtraKmPolicy.delete({where:{id:bad.id}});}
  });
  it("keeps foreign profiles and copied financial references out of summaries",async()=>{
    const bad=await prisma.rentalCustomerPaymentMethod.create({data:{tenantId:ids.a,rentalCustomerId:ids.aCustomer,paymentProfileId:ids.bProfile,bookingId:ids.localBooking,stripeCustomerId:`cus_${run}_b`,stripePaymentMethodId:`pm_${run}_corrupt`,status:"ACTIVE",mandateAccepted:true}});
    const extra=await prisma.rentalExtraCharge.create({data:{tenantId:ids.a,bookingId:ids.localBooking,rentalCustomerId:ids.bCustomer,vehicleId:ids.foreignVehicle,type:"FUEL",description:"Synthetic corrupt",amountCents:1,totalAmountCents:1}});
    try{const data=await json("rome",`/rental-payments/bookings/${ids.localBooking}/summary`);assert.ok(!JSON.stringify(data).includes(bad.id));assert.ok(!JSON.stringify(data).includes(extra.id));await assert.rejects(scoped("rome",()=>service.approveExtraCharge({tenantId:ids.a,userId:ids.romeUser,extraChargeId:extra.id})));}
    finally{await prisma.rentalExtraCharge.delete({where:{id:extra.id}});await prisma.rentalCustomerPaymentMethod.delete({where:{id:bad.id}});}
  });
  it("keeps complete privacy exports and erasure/retention actions company-wide",async()=>{
    for(const [who,site] of [["rome",undefined],["manager",ids.rome]] as const){
      for(const [path,method,body] of [[`/privacy/data-subjects/customers/${ids.aCustomer}/export`,"GET",undefined],[`/privacy/data-subjects/customers/${ids.aCustomer}/anonymize`,"POST",{confirmation:"ANONYMIZE_CUSTOMER",legalBasis:"Synthetic"}],["/privacy/retention/preview","GET",undefined],["/privacy/retention/run","POST",{confirmation:"RUN_RETENTION"}]] as const)assert.equal((await call(who,path,{method,body,site})).status,403);
    }
    const all=await json("manager",`/privacy/data-subjects/customers/${ids.aCustomer}/export`);assert.ok(JSON.stringify(all).includes(ids.privateBooking));
  });
  it("preserves authorized local extra creation, approval and cancellation",async()=>{
    const r=await call("rome",`/rental-payments/bookings/${ids.localBooking}/extra-charges`,{method:"POST",body:{type:"FUEL",description:"Synthetic local",amountCents:100}});assert.equal(r.status,201,await r.clone().text());const row=await r.json() as any;
    assert.equal((await call("rome",`/rental-payments/extra-charges/${row.id}/approve`,{method:"POST",body:{}})).status,200);
    assert.equal((await call("rome",`/rental-payments/extra-charges/${row.id}/cancel`,{method:"POST",body:{}})).status,200);
  });
  it("rechecks new queued notice authority after site reassignment",async()=>{
    const notice=await prisma.rentalExtraCharge.create({data:{tenantId:ids.a,bookingId:ids.localBooking,rentalCustomerId:ids.aCustomer,vehicleId:ids.milanVehicle,type:"FUEL",description:"Synthetic queued",status:"APPROVED",amountCents:100,totalAmountCents:100,createdByUserId:ids.romeUser}});
    await scoped("rome",()=>service.notifyExtraCharge({tenantId:ids.a,userId:ids.romeUser,extraChargeId:notice.id}));
    const row=await prisma.emailQueue.findFirstOrThrow({where:{tenantId:ids.a,deduplicationKey:`extra-notice:v1:${ids.a}:${notice.id}`}});
    assert.equal((row.meta as any).siteAuthorization.userId,ids.romeUser);const count=sent.length;
    await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.milan}});
    try{await new EmailQueueService().processPending(new Date(),{ids:[row.id],take:1});assert.equal(sent.length,count);assert.equal((await prisma.emailQueue.findUniqueOrThrow({where:{id:row.id}})).status,"FAILED");assert.equal((await prisma.rentalExtraCharge.findUniqueOrThrow({where:{id:notice.id}})).notifiedAt,null);}
    finally{await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.rome}});}
  });
  it("sends a legitimate cross-site notice once, using only the fake sender",async()=>{
    await scoped("rome",()=>service.notifyExtraCharge({tenantId:ids.a,userId:ids.romeUser,extraChargeId:ids.crossExtra}));
    const row=await prisma.emailQueue.findFirstOrThrow({where:{tenantId:ids.a,deduplicationKey:`extra-notice:v1:${ids.a}:${ids.crossExtra}`}}),count=sent.length;
    await Promise.all([new EmailQueueService().processPending(new Date(),{ids:[row.id],take:1}),new EmailQueueService().processPending(new Date(),{ids:[row.id],take:1})]);assert.equal(sent.length,count+1);
    assert.equal((await prisma.emailQueue.findUniqueOrThrow({where:{id:row.id}})).status,"SENT");assert.ok((await prisma.rentalExtraCharge.findUniqueOrThrow({where:{id:ids.crossExtra}})).notifiedAt);
  });
  it("keeps authoritative provider event reconciliation independent of an ambient branch view",async()=>{
    const record=await prisma.rentalExtraCharge.findUniqueOrThrow({where:{id:ids.privateExtra}}),method=await prisma.rentalCustomerPaymentMethod.findUniqueOrThrow({where:{id:ids.privateMethod}});
    const intent={id:`pi_${run}_webhook`,object:"payment_intent",status:"succeeded",amount:1000,amount_received:1000,currency:"eur",customer:method.stripeCustomerId,payment_method:method.stripePaymentMethodId,metadata:{domain:"rental_payments",purpose:"rental_extra_charge",tenantId:ids.a,bookingId:ids.privateBooking,rentalCustomerId:ids.aCustomer,rentalExtraChargeId:ids.privateExtra,paymentMethodId:ids.privateMethod}};
    const isolated=new RentalPaymentService(new PrismaAuditLogRepository(),{paymentIntents:{retrieve:async()=>intent}} as any);
    await prisma.rentalExtraCharge.update({where:{id:record.id},data:{stripePaymentIntentId:intent.id,status:"PAYMENT_PROCESSING"}});
    try{
      const event={id:`evt_${run}_paid`,type:"payment_intent.succeeded",data:{object:intent}} as any;
      await scoped("rome",()=>isolated.handleStripeEvent(event));assert.equal((await prisma.rentalExtraCharge.findUniqueOrThrow({where:{id:record.id}})).status,"PAID");
      assert.equal((await scoped("rome",()=>isolated.handleStripeEvent(event))).duplicate,true);
      assert.equal((await call("rome",`/rental-payments/bookings/${ids.privateBooking}/summary`)).status,404);
    }finally{await prisma.rentalExtraCharge.update({where:{id:record.id},data:{status:record.status,stripePaymentIntentId:record.stripePaymentIntentId}});}
  });
  it("persists a provider-accepted capture even if the booking moves out of view during the call",async()=>{
    const record=await prisma.rentalDeposit.findUniqueOrThrow({where:{id:ids.localDeposit}}),method=await prisma.rentalCustomerPaymentMethod.findUniqueOrThrow({where:{id:ids.localMethod}});
    const intent={id:record.stripePaymentIntentId!,object:"payment_intent",status:"requires_capture",amount:record.amountCents,amount_received:0,currency:"eur",customer:method.stripeCustomerId,payment_method:method.stripePaymentMethodId,metadata:{domain:"rental_payments",purpose:"rental_deposit",tenantId:ids.a,bookingId:ids.localBooking,rentalCustomerId:ids.aCustomer,rentalDepositId:ids.localDeposit,paymentMethodId:ids.localMethod}};
    const isolated=new RentalPaymentService(new PrismaAuditLogRepository(),{paymentIntents:{retrieve:async()=>intent,capture:async()=>{await prisma.rentalBooking.update({where:{id:ids.localBooking},data:{siteId:ids.milan,pickupSiteId:ids.milan,returnSiteId:ids.milan}});intent.status="succeeded";intent.amount_received=record.amountCents;return intent;}}} as any);
    // Removing the saved card must not strand funds already authorized for an
    // owned booking. A new charge still requires a currently selectable card.
    await prisma.rentalCustomerPaymentMethod.update({where:{id:method.id},data:{deletedAt:new Date(),status:"REMOVED"}});
    try{const result=await scoped("rome",()=>isolated.captureDeposit({tenantId:ids.a,userId:ids.romeUser,depositId:ids.localDeposit}));assert.equal(result.status,"CAPTURED");assert.equal((await prisma.rentalDeposit.findUniqueOrThrow({where:{id:record.id}})).status,"CAPTURED");}
    finally{await prisma.rentalBooking.update({where:{id:ids.localBooking},data:{siteId:ids.rome,pickupSiteId:ids.rome,returnSiteId:ids.rome}});await prisma.rentalDeposit.update({where:{id:record.id},data:{status:record.status,capturedAmountCents:record.capturedAmountCents}});await prisma.rentalCustomerPaymentMethod.update({where:{id:method.id},data:{deletedAt:null,status:"ACTIVE"}});}
  });
  it("blocks new queued notices after suspension, permission loss or malformed attribution",async()=>{
    for(const change of ["suspension","permission","metadata"]){
      const extra=await prisma.rentalExtraCharge.create({data:{tenantId:ids.a,bookingId:ids.localBooking,rentalCustomerId:ids.aCustomer,vehicleId:ids.milanVehicle,type:"FUEL",description:`Synthetic ${change}`,status:"APPROVED",amountCents:100,totalAmountCents:100,createdByUserId:ids.romeUser}});
      await scoped("rome",()=>service.notifyExtraCharge({tenantId:ids.a,userId:ids.romeUser,extraChargeId:extra.id}));
      const row=await prisma.emailQueue.findFirstOrThrow({where:{tenantId:ids.a,deduplicationKey:`extra-notice:v1:${ids.a}:${extra.id}`}}),count=sent.length,key={roleId_permissionId:{roleId:ids.OPERATOR,permissionId:ids["rental-payments:write"]}};
      try{
        if(change==="suspension")await prisma.user.update({where:{id:ids.romeUser},data:{status:"SUSPENDED"}});
        if(change==="permission")await prisma.rolePermission.delete({where:key});
        if(change==="metadata")await prisma.emailQueue.update({where:{id:row.id},data:{meta:{...(row.meta as any),siteAuthorization:{version:0,allSites:true}}}});
        await new EmailQueueService().processPending(new Date(),{ids:[row.id],take:1});assert.equal(sent.length,count);assert.equal((await prisma.emailQueue.findUniqueOrThrow({where:{id:row.id}})).status,"FAILED");
      }finally{await prisma.user.update({where:{id:ids.romeUser},data:{status:"ACTIVE"}});await prisma.rolePermission.upsert({where:key,update:{},create:{roleId:ids.OPERATOR,permissionId:ids["rental-payments:write"]}});}
    }
  });
  it("rechecks notice authority after queue acquisition before starting the sender",async()=>{
    const extra=await prisma.rentalExtraCharge.create({data:{tenantId:ids.a,bookingId:ids.localBooking,rentalCustomerId:ids.aCustomer,vehicleId:ids.milanVehicle,type:"FUEL",description:"Synthetic last check",status:"APPROVED",amountCents:100,totalAmountCents:100,createdByUserId:ids.romeUser}});
    await scoped("rome",()=>service.notifyExtraCharge({tenantId:ids.a,userId:ids.romeUser,extraChargeId:extra.id}));
    const row=await prisma.emailQueue.findFirstOrThrow({where:{tenantId:ids.a,deduplicationKey:`extra-notice:v1:${ids.a}:${extra.id}`}}),count=sent.length,transaction=prisma.$transaction;let changed=false;
    (prisma as any).$transaction=async(...args:any[])=>{
      if(typeof args[0]!=="function")return(transaction as any).apply(prisma,args);
      return(transaction as any).call(prisma,async(tx:any)=>args[0](new Proxy(tx,{get(target,key){
        if(key!=="emailQueue")return Reflect.get(target,key);
        return new Proxy(target.emailQueue,{get(model,method){if(method!=="updateMany")return Reflect.get(model,method);return async(parameters:any)=>{
          if(!changed&&parameters.where?.processingToken&&parameters.data?.leaseExpiresAt){changed=true;await prisma.userRole.deleteMany({where:{userId:ids.romeUser}});}
          return model.updateMany(parameters);
        };}});
      }})),...args.slice(1));
    };
    try{await new EmailQueueService().processPending(new Date(),{ids:[row.id],take:1});assert.equal(changed,true);assert.equal(sent.length,count);assert.equal((await prisma.emailQueue.findUniqueOrThrow({where:{id:row.id}})).status,"FAILED");}
    finally{prisma.$transaction=transaction;await prisma.userRole.upsert({where:{userId_roleId:{userId:ids.romeUser,roleId:ids.OPERATOR}},update:{},create:{userId:ids.romeUser,roleId:ids.OPERATOR}});}
  });
  it("isolates concurrent list and payment views",async()=>{
    await Promise.all(Array.from({length:12},(_,i)=>{const who=["rome","milan","manager","unassigned"][i%4];return json(who,"/rental-pricing/lists").then(data=>assert.equal(data.total,[4,3,5,0][i%4]));}));
  });
  it("rejects a price list moved out of scope after selection without committing a snapshot",async()=>{
    const transaction=prisma.$transaction;let moved=false;
    (prisma as any).$transaction=async(...args:any[])=>{
      if(typeof args[0]==="function"&&!moved){moved=true;await prisma.rentalPriceList.update({where:{id:ids.romeList},data:{siteId:ids.milan}});}
      return(transaction as any).apply(prisma,args);
    };
    const before=await prisma.rentalBooking.findUniqueOrThrow({where:{id:ids.localBooking}});
    try{const r=await call("rome",`/rental-bookings/${ids.localBooking}/pricing`,{method:"PATCH",body:{priceListId:ids.romeList,actualKm:120}});assert.equal(moved,true);assert.equal(r.status,404,await r.text());assert.equal(await prisma.rentalBookingPricingSnapshot.count({where:{tenantId:ids.a,bookingId:ids.localBooking}}),0);assert.deepEqual(await prisma.rentalBooking.findUniqueOrThrow({where:{id:ids.localBooking}}),before);}
    finally{prisma.$transaction=transaction;await prisma.rentalPriceList.update({where:{id:ids.romeList},data:{siteId:ids.rome}});}
  });
});
