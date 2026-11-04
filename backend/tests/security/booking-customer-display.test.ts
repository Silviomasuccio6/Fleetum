import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { RentalBookingsController } from "../../src/interfaces/http/controllers/rental-bookings-controller.js";

const controller = new RentalBookingsController();
const tenantIds: string[] = [];
const records: Array<{ id: string; expected: string }> = [];
const run = `booking-display-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const response = () => ({ body: null as any, json(value: unknown) { this.body=value; return this; } });

describe("booking customer identity across quick, day and month views", () => {
  before(async () => {
    assert.equal(process.env.NODE_ENV, "test", "Run only against an isolated test database");
    for (let index=0; index<2; index++) {
      const tenant=await prisma.tenant.create({data:{name:`${run}-${index}`}});tenantIds.push(tenant.id);
      const site=await prisma.site.create({data:{tenantId:tenant.id,name:"Synthetic site",address:"Synthetic address",city:"Synthetic city"}});
      const vehicle=await prisma.vehicle.create({data:{tenantId:tenant.id,siteId:site.id,plate:`B11${index}${Date.now()}`,brand:"Synthetic",model:"Test"}});
      if(index)continue;
      const inputs=[
        {customerType:"PERSONA_GIURIDICA",companyName:"Veicoli",firstName:"Synthetic",lastName:"Representative",expected:"Veicoli"},
        {customerType:"PERSONA_FISICA",firstName:"Synthetic",lastName:"Person",expected:"Synthetic Person"},
        {customerType:"PERSONA_GIURIDICA",companyName:"",firstName:"Synthetic",lastName:"Fallback",expected:"Synthetic Fallback"}
      ];
      for (const [position,input] of inputs.entries()) {
        const {expected,...data}=input;
        const customer=await prisma.rentalCustomer.create({data:{...data,customerType:data.customerType as any,tenantId:tenant.id}});
        const booking=await prisma.rentalBooking.create({data:{tenantId:tenant.id,vehicleId:vehicle.id,customerId:customer.id,code:`${run}-${position}`,customerName:"Stale snapshot",status:"CONFIRMED",pickupAt:new Date("2035-01-01T09:00:00Z"),returnAt:new Date("2035-01-03T09:00:00Z")}});
        records.push({id:booking.id,expected});
      }
      const unlinked=await prisma.rentalBooking.create({data:{tenantId:tenant.id,vehicleId:vehicle.id,code:`${run}-unlinked`,customerName:"Synthetic standalone",status:"CONFIRMED",pickupAt:new Date("2035-01-01T09:00:00Z"),returnAt:new Date("2035-01-03T09:00:00Z")}});records.push({id:unlinked.id,expected:"Synthetic standalone"});
    }
  });
  after(async () => {
    await prisma.rentalBooking.deleteMany({where:{tenantId:{in:tenantIds}}});
    await prisma.rentalCustomer.deleteMany({where:{tenantId:{in:tenantIds}}});
    await prisma.vehicle.deleteMany({where:{tenantId:{in:tenantIds}}});
    await prisma.site.deleteMany({where:{tenantId:{in:tenantIds}}});
    await prisma.tenant.deleteMany({where:{id:{in:tenantIds}}});
    await prisma.$disconnect();
  });
  it("keeps company, person and fallback identities in the quick detail",async()=>{
    for(const record of records){const res=response();await controller.quickDetail({auth:{tenantId:tenantIds[0]},params:{id:record.id}} as any,res as any);assert.equal(res.body.customerName,record.expected)}
  });
  for(const [method,query] of [["dayAvailability",{date:"2035-01-02"}],["monthAvailability",{month:"2035-01"}]] as const){
    it(`keeps identities in ${method} and excludes the other tenant`,async()=>{
      const res=response();await controller[method]({auth:{tenantId:tenantIds[0]},query} as any,res as any);
      const bookings=res.body.data.flatMap((row:any)=>row.bookings);for(const record of records)assert.equal(bookings.find((b:any)=>b.id===record.id)?.customerName,record.expected);
      const foreign=response();await controller[method]({auth:{tenantId:tenantIds[1]},query} as any,foreign as any);assert.ok(!JSON.stringify(foreign.body).includes("Veicoli"));assert.equal(foreign.body.data.flatMap((row:any)=>row.bookings).length,0);
    });
  }
  it("rejects another tenant's quick detail",async()=>{
    await assert.rejects(()=>controller.quickDetail({auth:{tenantId:tenantIds[1]},params:{id:records[0].id}} as any,response() as any),(error:any)=>error.statusCode===404);
  });
});
