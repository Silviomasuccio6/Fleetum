import assert from 'node:assert/strict';
import {before,after,describe,it} from 'node:test';
import {randomUUID} from 'node:crypto';
import type http from 'node:http';
import type {AddressInfo} from 'node:net';
import {assertSyntheticDatabase} from '../helpers/synthetic-database.js';
import {prisma} from '../../src/infrastructure/database/prisma/client.js';
import {createApp} from '../../src/app.js';
import {signTenantAccessToken} from '../helpers/http-auth.js';
const grants:Array<{roleId:string;permissionId:string}>=[];
const ids:Record<string,string>={},tokens:Record<string,string>={},tenantIds:string[]=[],prefix='collection-'+Date.now();
let server:http.Server|undefined,base='';
const call=async(who:string,path:string,body?:object,key=randomUUID(),site?:string)=>{
 const response=await fetch(base+'/rental-payments'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+tokens[who],...(body?{'Content-Type':'application/json','Idempotency-Key':key}:{}),...(site?{'X-Fleetum-Site':site}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,data:await response.json() as any,headers:response.headers};
};
const command=(amountCents=5000)=>({amountCents,method:'CASH',occurredAt:'2026-01-01T10:00:00.000Z',reference:'Synthetic receipt',reason:'Incasso sintetico confermato'});
const detail=(name='rome')=>call('collector',`/bookings/${ids[name]}/collections`);
const post=(name='rome',body=command(),key=randomUUID())=>call('collector',`/bookings/${ids[name]}/collections`,body,key);
const auditCount=()=>prisma.auditLog.count({where:{tenantId:ids.a,resource:'rental-collection'}});
describe('rental collections: exact ledger, historical sites and tenant boundaries',()=>{
 before(async()=>{
  assertSyntheticDatabase();
  for(const role of ['OPERATOR','VIEWER','MANAGER']){
   ids[role]=(await prisma.role.upsert({where:{key:role},update:{},create:{key:role,name:role}})).id;
   for(const key of role==='VIEWER'?['rental-payments:read']:['rental-payments:read','rental-payments:charge','rental-payments:refund',...(role==='MANAGER'?['privacy:export']:[])]){
    const p=await prisma.permission.upsert({where:{key},update:{},create:{key,description:'Synthetic'}});
    const grant={roleId:ids[role],permissionId:p.id};if(!await prisma.rolePermission.findUnique({where:{roleId_permissionId:grant}})){await prisma.rolePermission.create({data:grant});grants.push(grant);}
   }
  }
  for(const name of ['a','b']){ids[name]=(await prisma.tenant.create({data:{name:prefix+name}})).id;tenantIds.push(ids[name]);await prisma.tenantSubscription.create({data:{tenantId:ids[name],provider:'local',status:'ACTIVE',plan:'ENTERPRISE',seats:20}});ids[name+'Customer']=(await prisma.rentalCustomer.create({data:{tenantId:ids[name],firstName:'Synthetic',lastName:name}})).id;}
  for(const name of ['rome','milan','foreign']){const tenantId=name==='foreign'?ids.b:ids.a;ids[name+'Site']=(await prisma.site.create({data:{tenantId,name:'Synthetic '+name,address:'Synthetic',city:name}})).id;ids[name+'Vehicle']=(await prisma.vehicle.create({data:{tenantId,siteId:ids[name+'Site'],plate:prefix+name,brand:'QA',model:'Synthetic'}})).id;}
  for(const [who,role,tenant,site]of [['collector','OPERATOR','a',ids.romeSite],['reader','VIEWER','a',ids.romeSite],['manager','MANAGER','a',null],['foreign','OPERATOR','b',ids.foreignSite],['unassigned','OPERATOR','a',null]] as const){
   const user=await prisma.user.create({data:{tenantId:ids[tenant],firstName:'Synthetic',lastName:who,email:prefix+who+'@example.invalid',passwordHash:'synthetic-unused',assignedSiteId:site,roles:{create:{roleId:ids[role]}}}});ids[who+'User']=user.id;
   const session=await prisma.refreshSession.create({data:{tenantId:ids[tenant],userId:user.id,tokenHash:prefix+who,expiresAt:new Date(Date.now()+3600000)}});tokens[who]=signTenantAccessToken({tenantId:ids[tenant],userId:user.id,sessionId:session.id});
  }
  for(const name of ['rome','milan','foreign','cross','free','unknown','pennies','race']){const tenantId=name==='foreign'?ids.b:ids.a,site=name==='foreign'?'foreign':name==='milan'?'milan':'rome';ids[name]=(await prisma.rentalBooking.create({data:{tenantId,vehicleId:ids[site+'Vehicle'],customerId:ids[tenantId===ids.a?'aCustomer':'bCustomer'],siteId:ids[site+'Site'],pickupSiteId:ids[site+'Site'],returnSiteId:name==='cross'?ids.milanSite:ids[site+'Site'],code:prefix+name,customerName:'Synthetic '+name,pickupAt:new Date('2026-01-01T10:00:00Z'),returnAt:new Date('2026-01-04T10:00:00Z'),expectedTotal:name==='free'?0:name==='unknown'?null:name==='pennies'?0.3:80}})).id;}
  await prisma.rentalBookingPricingSnapshot.create({data:{tenantId:ids.a,bookingId:ids.rome,priceListName:'Synthetic saved list',baseRateAmount:100,baseRateUnit:'DAILY',discountPercent:20}});
  const profile=await prisma.rentalCustomerPaymentProfile.create({data:{tenantId:ids.a,rentalCustomerId:ids.aCustomer,stripeCustomerId:prefix+'-customer'}});
  const method=await prisma.rentalCustomerPaymentMethod.create({data:{tenantId:ids.a,rentalCustomerId:ids.aCustomer,paymentProfileId:profile.id,bookingId:ids.rome,stripeCustomerId:prefix+'-customer',stripePaymentMethodId:prefix+'-method',status:'ACTIVE',mandateAccepted:true}});
  ids.deposit=(await prisma.rentalDeposit.create({data:{tenantId:ids.a,bookingId:ids.rome,rentalCustomerId:ids.aCustomer,paymentMethodId:method.id,amountCents:10000,status:'AUTHORIZED',captureBefore:new Date('2050-01-01T00:00:00Z')}})).id;
  await prisma.rentalExtraCharge.create({data:{tenantId:ids.a,bookingId:ids.rome,rentalCustomerId:ids.aCustomer,paymentMethodId:method.id,type:'FUEL',description:'Synthetic paid extra',amountCents:1000,totalAmountCents:1000,status:'PAID'}});

  server=createApp().listen(0,'127.0.0.1');await new Promise<void>(resolve=>server!.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
 });
 after(async()=>{
  await new Promise<void>(resolve=>server?server.close(()=>resolve()):resolve());
  // This suite only runs inside the disposable CI container checked above.
  // TRUNCATE bypasses the append-only row trigger solely for synthetic teardown.
  if(tenantIds.length){assertSyntheticDatabase();await prisma.$executeRawUnsafe('TRUNCATE TABLE "RentalCollectionEntry"');const where={tenantId:{in:tenantIds}};
   for(const model of [prisma.auditLog,prisma.rentalPaymentEvent,prisma.rentalDeposit,prisma.rentalExtraCharge,prisma.rentalCustomerPaymentMethod,prisma.rentalCustomerPaymentProfile,prisma.rentalBookingPricingSnapshot,prisma.rentalBooking,prisma.rentalCustomer,prisma.vehicle,prisma.refreshSession] as any[])await model.deleteMany({where});
   await prisma.userRole.deleteMany({where:{user:{tenantId:{in:tenantIds}}}});await prisma.user.deleteMany({where});await prisma.site.deleteMany({where});await prisma.tenantSubscription.deleteMany({where});await prisma.tenant.deleteMany({where:{id:{in:tenantIds}}});
   if(grants.length)await prisma.rolePermission.deleteMany({where:{OR:grants}});
  }await prisma.$disconnect();
 });
 it('keeps zero free, unknown amounts unknown and empty receipts distinct from a paid rental',async()=>{
  const free=await detail('free'),unknown=await detail('unknown');assert.equal(free.status,200);assert.equal(free.data.booking.state,'FREE');assert.equal(free.data.entries.length,0);assert.equal(unknown.data.booking.state,'UNKNOWN');assert.equal(unknown.data.booking.outstandingCents,null);
 });
 it('registers 50 of 80 with one audit and never changes booking price or contract status',async()=>{
  const before=await prisma.rentalBooking.findUniqueOrThrow({where:{id:ids.rome}}),count=await auditCount();const result=await post();assert.equal(result.status,201,JSON.stringify(result.data));
  const d=await detail();assert.equal(d.data.pricing.unitRateAmount,'100');assert.equal(d.data.pricing.discountPercent,20);assert.equal(d.data.pricing.discountProvenance.actor,null);assert.equal(d.data.pricing.discountProvenance.reason,null);assert.equal(d.data.booking.receivedCents,5000);assert.equal(d.data.booking.outstandingCents,3000);assert.equal(d.data.booking.authorizedGuaranteeCents,10000);assert.equal(d.data.booking.state,'PARTIAL');assert.equal(d.data.entries[0].createdBy.id,ids.collectorUser);assert.equal(await auditCount(),count+1);assert.deepEqual(await prisma.rentalBooking.findUniqueOrThrow({where:{id:ids.rome}}),before);
  const exported=await fetch(base+'/privacy/data-subjects/customers/'+ids.aCustomer+'/export',{headers:{Authorization:'Bearer '+tokens.manager}});assert.equal(exported.status,200);const exportedData=await exported.json() as any;const exportedBooking=exportedData.data.bookings.find((row:any)=>row.id===ids.rome);assert.equal(exportedBooking.collectionEntries[0].id,result.data.id);assert.ok(!JSON.stringify(exportedBooking.collectionEntries).includes('requestHash'));assert.ok(!JSON.stringify(exportedBooking.collectionEntries).includes('requestKey'));
  await prisma.rentalDeposit.update({where:{id:ids.deposit},data:{captureBefore:new Date('2020-01-01T00:00:00Z')}});assert.equal((await detail()).data.booking.authorizedGuaranteeCents,0);assert.equal((await detail()).data.booking.receivedCents,5000);
 });
 it('replays the same key atomically and rejects a changed amount, author or booking',async()=>{
  const key=randomUUID(),body=command(1);const [a,b]=await Promise.all([post('pennies',body,key),post('pennies',body,key)]);assert.deepEqual([a.status,b.status].sort(),[200,201]);assert.equal(a.data.id,b.data.id);
  assert.equal((await post('pennies',command(2),key)).status,409);assert.equal((await post('free',body,key)).status,409);
  assert.equal((await detail('pennies')).data.booking.outstandingCents,29);
 });
 it('does not leak private bookings, shared-customer finances, or aggregates with forged site/customer filters',async()=>{
  for(const who of ['collector','reader','unassigned']){const list=await call(who,'/workspace?pageSize=100');assert.equal(list.status,200);const text=JSON.stringify(list.data);assert.ok(!text.includes(ids.milan));assert.ok(!text.includes(ids.foreign));if(who==='unassigned')assert.equal(list.data.total,0);}
  assert.equal((await call('collector',`/workspace?siteId=${ids.milanSite}`)).data.total,1); // cross-site return is intentionally visible
  assert.equal((await call('collector',`/workspace?customerId=${ids.bCustomer}`)).data.total,0);
  for(const id of [ids.milan,ids.foreign]){assert.equal((await call('collector',`/bookings/${id}/collections`)).status,404);assert.equal((await call('collector',`/bookings/${id}/collections`,command())).status,404);}
  const all=await call('manager','/workspace?pageSize=100');assert.ok(all.data.data.some((x:any)=>x.id===ids.milan));assert.ok(!JSON.stringify(all.data).includes(ids.foreign));
  assert.ok(!(await call('manager','/workspace',undefined,randomUUID(),ids.romeSite)).data.data.some((x:any)=>x.id===ids.milan));
 });
 it('rejects writes for read-only users, spoofed online methods, invalid cents/dates and unconfirmed collections',async()=>{
  assert.equal((await call('reader',`/bookings/${ids.rome}/collections`,command())).status,403);
  for(const body of [{...command(),method:'STRIPE'},{...command(),amountCents:0},{...command(),amountCents:1.5},{...command(),status:'PENDING'}])assert.equal((await post('rome',body as any)).status,422);
  assert.equal((await call('collector','/workspace?from=2026-02-31')).status,422);
  assert.equal((await post('rome',{...command(),occurredAt:'2099-01-01T10:00:00Z'})).status,400);
 });
 it('serializes concurrent refunds so two different keys cannot refund the same received amount twice',async()=>{
  const created=await post('race',command(100));const body={amountCents:80,occurredAt:'2026-01-02T10:00:00Z',reference:'Synthetic refund',reason:'Rimborso già effettuato'};
  const path=`/bookings/${ids.race}/collections/${created.data.id}/refund`;
  const result=await Promise.all([call('collector',path,body),call('collector',path,body)]);assert.deepEqual(result.map(x=>x.status).sort(),[201,409]);assert.equal((await detail('race')).data.booking.receivedCents,20);
 });
 it('keeps corrections append-only, rejects double reversal and records refunds separately',async()=>{
  const data=await detail(),receipt=data.data.entries[0];const body={occurredAt:'2026-01-03T10:00:00Z',reference:'Synthetic correction',reason:'Correzione registrazione errata'};
  const refund=await call('collector',`/bookings/${ids.rome}/collections/${receipt.id}/refund`,{...body,amountCents:2000});assert.equal(refund.status,201);
  assert.equal((await detail()).data.booking.receivedCents,3000);
  assert.equal((await call('collector',`/bookings/${ids.rome}/collections/${receipt.id}/reverse`,body)).status,409);
  const reverse=await call('collector',`/bookings/${ids.rome}/collections/${refund.data.id}/reverse`,body);assert.equal(reverse.status,201);
  assert.equal((await call('collector',`/bookings/${ids.rome}/collections/${refund.data.id}/reverse`,body)).status,409);
  assert.equal((await detail()).data.booking.receivedCents,5000);
  await assert.rejects(prisma.rentalCollectionEntry.update({where:{id:receipt.id},data:{amountCents:1}}));await assert.rejects(prisma.rentalCollectionEntry.delete({where:{id:receipt.id}}));
 });
 it('retains financial history for archived bookings, blocks new entries and scopes counts before pagination',async()=>{
  await prisma.rentalBooking.update({where:{id:ids.pennies},data:{deletedAt:new Date()}});
  assert.equal((await detail('pennies')).data.booking.archived,true);assert.equal((await post('pennies',command(1))).status,404);
  const result=await call('collector','/workspace?state=PARTIAL&method=CASH&pageSize=1');assert.equal(result.status,200);assert.equal(result.data.data.length,1);assert.ok(result.data.total>=2);assert.ok(result.data.summary.receivedCents>=5001);assert.equal(result.headers.get('cache-control'),'private, no-store');
 });
});
