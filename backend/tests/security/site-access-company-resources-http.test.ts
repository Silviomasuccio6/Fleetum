import {assertSyntheticDatabase} from "../helpers/synthetic-database.js";
import assert from "node:assert/strict";
import {after,before,describe,it} from "node:test";
import type http from "node:http";
import type {AddressInfo} from "node:net";
import fs from "node:fs/promises";
import sharp from "sharp";
import {createApp} from "../../src/app.js";
import {prisma} from "../../src/infrastructure/database/prisma/client.js";
import {requireAuth} from "../../src/interfaces/http/middlewares/auth.js";
import {SiteAccessService} from "../../src/application/services/site-access-service.js";
import {runWithSiteAccess} from "../../src/infrastructure/auth/site-access-context.js";
import {PrismaWorkshopRepository} from "../../src/infrastructure/repositories/prisma-workshop-repository.js";
import {PrismaAuditLogRepository} from "../../src/infrastructure/repositories/prisma-audit-log-repository.js";
import {TenantProfileService} from "../../src/application/services/tenant-profile-service.js";
import {BillingService} from "../../src/application/services/billing-service.js";
import {EmailQueueService} from "../../src/infrastructure/email/email-queue-service.js";
import {storageProvider} from "../../src/infrastructure/storage/storage-provider.js";
import {signTenantAccessToken,tenantIsolationPermissions} from "../helpers/http-auth.js";

const ids:Record<string,string>={},tokens:Record<string,string>={},tenants:string[]=[];
let ownsUploadRoot=false;
const run=`company-scope-${Date.now()}`,uploadDir=process.env.UPLOAD_DIR!;
const sent:unknown[]=[],originalEnqueue=EmailQueueService.prototype.enqueue;
let server:http.Server|undefined,base="",png:Buffer;
const call=(who:string,path:string,options:{method?:string;body?:object;site?:string}={})=>fetch(base+path,{method:options.method??"GET",headers:{Authorization:`Bearer ${tokens[who]}`,...(options.body?{"Content-Type":"application/json"}:{}),...(options.site?{"X-Fleetum-Site":options.site}:{})},...(options.body?{body:JSON.stringify(options.body)}:{})});
const json=async(who:string,path:string,options:Parameters<typeof call>[2]={})=>{const r=await call(who,path,options);assert.equal(r.status,200,await r.clone().text());return r.json()as Promise<any>;};
const absent=(data:unknown,...values:string[])=>{const text=typeof data==="string"?data:JSON.stringify(data);for(const value of values)assert.ok(!text.includes(value),`unexpected ${value}`);};
const scoped=async<T>(who:string,fn:()=>Promise<T>,site?:string)=>runWithSiteAccess(await new SiteAccessService().resolveSelectedScope(ids.a,ids[who+"User"],site),fn);
const sla={LOW:15,MEDIUM:10,HIGH:5,CRITICAL:2};
const playbooks={WAITING_PARTS:{enabled:true,reminderEveryDays:3},SOLICITED:{enabled:true,reminderEveryDays:2}};
const invite={email:`${run}-invite@example.invalid`,firstName:"Synthetic",lastName:"Invited",roleKey:"OPERATOR"};
const companyProfile={country:"US",legalName:"QA Mobility Synthetic LLC",vatNumber:"QA-MOBILITY-4826",email:"office@fleetum-qa.invalid",phone:"+12025550154",legalAddress:"42 QA Avenue",city:"QA City",province:"QA State",postalCode:"QA 8426"};

describe("E02 company resources and shared operational catalogs",()=>{
  before(async()=>{
    ownsUploadRoot=!assertSyntheticDatabase({user:"fleetum_e02_company",database:"fleetum_e02_company_test",port:"61529",uploadPrefix:"/private/tmp/fleetum-e02-company-uploads-20261028"}).ci;
    assert.equal(process.env.NODE_ENV,"test");assert.equal(process.env.DOTENV_CONFIG_PATH,"/dev/null");assert.equal(process.env.UPLOAD_DIR,uploadDir);assert.equal(storageProvider.name,"local");
    const db=new URL(process.env.DATABASE_URL!);assert.ok(!process.env.STRIPE_SECRET_KEY);
    EmailQueueService.prototype.enqueue=async function(input:any){sent.push(input);return{id:"synthetic-not-sent"}as any;};
    for(const key of["ADMIN","MANAGER","OPERATOR","VIEWER"]){ids[key]=(await prisma.role.upsert({where:{key:key as any},update:{},create:{key:key as any,name:key}})).id;
      if(key==="VIEWER")continue;
      for(const permissionKey of tenantIsolationPermissions){const p=await prisma.permission.upsert({where:{key:permissionKey},update:{},create:{key:permissionKey,description:"Synthetic"}});await prisma.rolePermission.upsert({where:{roleId_permissionId:{roleId:ids[key],permissionId:p.id}},update:{},create:{roleId:ids[key],permissionId:p.id}});}}
    for(const name of["a","b"]){ids[name]=(await prisma.tenant.create({data:{name:`${run}-${name}`}})).id;tenants.push(ids[name]);await prisma.tenantSubscription.create({data:{tenantId:ids[name],provider:"local",plan:"ENTERPRISE",status:"ACTIVE",seats:30}});await prisma.tenantProfile.create({data:{tenantId:ids[name],legalName:`Synthetic company ${name}`,adminEmail:`private-${name}@example.invalid`}});await prisma.tenantBranding.create({data:{tenantId:ids[name]}});
      ids[name+"Workshop"]=(await prisma.workshop.create({data:{tenantId:ids[name],name:`Synthetic workshop ${name}`,city:"Synthetic"}})).id;
      ids[name+"Invoice"]=(await prisma.invoice.create({data:{tenantId:ids[name],invoiceNumber:`${run}-${name}`,issueDate:new Date(),dueDate:new Date(),periodStart:new Date(),periodEnd:new Date(),subtotal:100,taxRate:22,taxAmount:22,total:122,billingName:`PRIVATE_INVOICE_${name}`}})).id;
    }
    for(const[name,tenant]of[["rome","a"],["milan","a"],["foreign","b"]])ids[name]=(await prisma.site.create({data:{tenantId:ids[tenant],name:`SYN-${name}`,address:"Synthetic",city:"Synthetic"}})).id;
    for(const[name,role,tenant,site]of[["rome","OPERATOR","a",ids.rome],["milan","OPERATOR","a",ids.milan],["unassigned","OPERATOR","a",null],["manager","MANAGER","a",null],["admin","ADMIN","a",null],["nopermission","VIEWER","a",ids.rome],["foreign","ADMIN","b",null]]as const){const user=await prisma.user.create({data:{tenantId:ids[tenant],email:`${run}-${name}@example.invalid`,firstName:"Synthetic",lastName:name,passwordHash:"synthetic-unused",assignedSiteId:site,roles:{create:{roleId:ids[role]}}}});ids[name+"User"]=user.id;const session=await prisma.refreshSession.create({data:{tenantId:ids[tenant],userId:user.id,tokenHash:`${run}-${name}`,expiresAt:new Date(Date.now()+3600000)}});tokens[name]=signTenantAccessToken({tenantId:ids[tenant],userId:user.id,sessionId:session.id});}
    await prisma.auditLog.create({data:{tenantId:ids.a,resource:"integrations",action:"SETTINGS_INTEGRATIONS",details:{erpWebhookUrl:"https://synthetic.example.invalid/PRIVATE_INTEGRATION"}}});
    ids.template=(await prisma.contractTemplate.create({data:{tenantId:ids.a,name:"Synthetic default",content:"Synthetic terms {{customerName}}",isDefault:true,createdByUserId:ids.adminUser}})).id;
    png=await sharp({create:{width:2,height:2,channels:4,background:{r:10,g:20,b:30,alpha:1}}}).png().toBuffer();
    const app=createApp();server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server!.once("listening",resolve));base=`http://127.0.0.1:${(server.address()as AddressInfo).port}/api`;
  });
  after(async()=>{
    if(server?.listening)await new Promise<void>(resolve=>server!.close(()=>resolve()));EmailQueueService.prototype.enqueue=originalEnqueue;
    if(tenants.length){const where={tenantId:{in:tenants}};await prisma.invitationToken.deleteMany({where:{user:where}});await prisma.userRole.deleteMany({where:{user:where}});
      for(const model of[prisma.auditLog,prisma.invoice,prisma.contractTemplate,prisma.storedFileObject,prisma.refreshSession]as any[])await model.deleteMany({where});
      await prisma.user.deleteMany({where});await prisma.site.deleteMany({where});await prisma.workshop.deleteMany({where});await prisma.tenantLegalSettings.deleteMany({where});await prisma.tenantBranding.deleteMany({where});await prisma.tenantProfile.deleteMany({where});await prisma.tenantSubscription.deleteMany({where});await prisma.tenant.deleteMany({where:{id:{in:tenants}}});}
    await prisma.$disconnect();if(ownsUploadRoot&&process.env.UPLOAD_DIR===uploadDir)await fs.rm(uploadDir,{recursive:true,force:true});
  });
  it("filters site rows and totals before pagination or forged searches",async()=>{const rows=await json("rome","/master-data/sites?pageSize=100&siteId="+ids.milan);assert.equal(rows.total,1);assert.equal(rows.data[0].id,ids.rome);absent(rows,ids.milan,ids.foreign);assert.equal((await json("rome","/master-data/sites?search=SYN-milan")).total,0);});
  it("keeps manager aggregate and selected-site site lists consistent",async()=>{assert.equal((await json("manager","/master-data/sites")).total,2);assert.equal((await json("manager","/master-data/sites",{site:ids.milan})).total,1);assert.equal((await call("rome","/master-data/sites",{site:ids.milan})).status,404);});
  it("gives an unassigned operator empty sites and shared catalogs",async()=>{assert.equal((await json("unassigned","/master-data/sites")).total,0);assert.equal((await json("unassigned","/master-data/workshops")).total,0);});
  it("shares the workshop directory between authorized sites without cross-tenant rows",async()=>{for(const who of["rome","milan","manager"]){const rows=await json(who,"/master-data/workshops");assert.equal(rows.total,1);assert.equal(rows.data[0].id,ids.aWorkshop);absent(rows,ids.bWorkshop);}});
  it("limits the staff directory to the branch and company-wide managers",async()=>{const rows=await json("rome","/users");assert.ok(rows.data.some((u:any)=>u.id===ids.romeUser));assert.ok(rows.data.some((u:any)=>u.id===ids.managerUser));absent(rows,ids.milanUser,ids.foreignUser,ids.unassignedUser);});
  it("keeps manager staff aggregate/selection and empty operator scopes distinct",async()=>{assert.equal((await json("unassigned","/users")).data.length,0);const rows=await json("manager","/users",{site:ids.rome});absent(rows,ids.milanUser);assert.ok((await json("manager","/users")).data.some((u:any)=>u.id===ids.milanUser));});
  it("blocks structural site changes from operators despite existing write permission",async()=>{for(const[method,path,body]of[["POST","/master-data/sites",{name:"Synthetic denied",address:"Synthetic",city:"Synthetic"}],["PATCH",`/master-data/sites/${ids.rome}`,{name:"Synthetic denied"}],["DELETE",`/master-data/sites/${ids.milan}`,undefined]]as const)assert.equal((await call("rome",path,{method,body})).status,403,method);});
  it("blocks changes to the shared workshop directory from a branch view",async()=>{assert.equal((await call("rome",`/master-data/workshops/${ids.aWorkshop}`,{method:"PATCH",body:{name:"Synthetic denied"}})).status,403);assert.equal((await call("manager","/master-data/workshops",{method:"POST",site:ids.rome,body:{name:"Synthetic denied"}})).status,403);});
  it("blocks user profile/status/role/deletion commands from an operator",async()=>{for(const[method,suffix,body]of[["PATCH","",{firstName:"Changed"}],["PATCH","/role",{roleKey:"ADMIN"}],["DELETE","",undefined]]as const)assert.equal((await call("rome",`/users/${ids.milanUser}${suffix}`,{method,body})).status,403,suffix||method);});
  it("blocks user creation in a branch before creating an account",async()=>{const count=await prisma.user.count({where:{tenantId:ids.a}});assert.equal((await call("rome","/users",{method:"POST",body:{...invite,email:`${run}-create@example.invalid`,password:"Synthetic-Only-123!"}})).status,403);assert.equal(await prisma.user.count({where:{tenantId:ids.a}}),count);});
  it("blocks invitations before creating tokens or enqueuing a message",async()=>{const count=await prisma.invitationToken.count();assert.equal((await call("rome","/users/invite",{method:"POST",body:invite})).status,403);assert.equal(await prisma.invitationToken.count(),count);assert.equal(sent.length,0);});
  it("allows operational SLA reads but reserves company-wide edits",async()=>{assert.deepEqual(await json("rome","/settings/sla"),sla);assert.equal((await call("rome","/settings/sla",{method:"PUT",body:sla})).status,403);assert.equal((await call("manager","/settings/sla",{method:"PUT",body:sla,site:ids.rome})).status,403);assert.equal((await call("manager","/settings/sla",{method:"PUT",body:sla})).status,200);});
  it("allows operational playbook reads but denies writes and unassigned reads",async()=>{assert.equal((await call("rome","/settings/playbooks")).status,200);assert.equal((await call("rome","/settings/playbooks",{method:"PUT",body:playbooks})).status,403);assert.equal((await call("unassigned","/settings/playbooks")).status,403);});
  it("reserves integration endpoints and URLs to company-wide views",async()=>{for(const who of["rome","unassigned"])assert.equal((await call(who,"/settings/integrations")).status,403);assert.equal((await call("manager","/settings/integrations",{site:ids.rome})).status,403);assert.match(JSON.stringify(await json("manager","/settings/integrations")),/PRIVATE_INTEGRATION/);});
  it("preserves the existing company-only report configuration rule",async()=>{assert.equal((await call("rome","/settings/reports")).status,403);assert.equal((await call("manager","/settings/reports",{site:ids.rome})).status,403);assert.equal((await call("manager","/settings/reports")).status,200);});
  it("does not expose company administrator details from branch profile endpoints",async()=>{const r=await call("rome","/tenant/profile");assert.equal(r.status,403);absent(await r.text(),"private-a@example.invalid");assert.equal((await call("manager","/tenant/profile",{site:ids.rome})).status,403);assert.equal((await call("manager","/tenant/profile")).status,200);});
  it("keeps profile completeness available without exposing full contact details",async()=>{const data=await json("rome","/tenant/profile/completeness");assert.equal(typeof data.percentage,"number");absent(data,"private-a@example.invalid");assert.equal((await call("unassigned","/tenant/profile/completeness")).status,403);});
  it("guards profile service changes and logo removal from a branch",async()=>{await assert.rejects(scoped("rome",()=>new TenantProfileService().updateProfile(ids.a,ids.romeUser,companyProfile as any)),(e:any)=>e.statusCode===403);assert.equal((await call("rome","/tenant/branding/logo",{method:"DELETE"})).status,403);});
  it("shares contract terms for authorized operations but restricts company-wide changes",async()=>{assert.equal((await call("rome","/contract-templates/default")).status,200);assert.equal((await call("rome","/contract-templates/default",{method:"PATCH",body:{content:"Synthetic denied"}})).status,403);assert.equal((await call("unassigned","/contract-templates/default")).status,403);});
  it("protects template logo deletion even for a manager viewing one site",async()=>{assert.equal((await call("rome","/contract-templates/default/logo",{method:"DELETE"})).status,403);assert.equal((await call("manager","/contract-templates/default/logo",{method:"DELETE",site:ids.rome})).status,403);});
  it("denies company uploads before saving any staged or stored file",async()=>{const count=await prisma.storedFileObject.count({where:{tenantId:ids.a}});for(const path of["/tenant/branding/logo","/contract-templates/default/logo","/tenant/onboarding/company-verification-document"]){const form=new FormData();form.set("file",new Blob([new Uint8Array(png)],{type:"image/png"}),"synthetic.png");const response=await fetch(base+path,{method:"POST",headers:{Authorization:`Bearer ${tokens.rome}`},body:form});assert.equal(response.status,403,path);}assert.equal(await prisma.storedFileObject.count({where:{tenantId:ids.a}}),count);});
  it("hides subscription invoices from branch views for list, detail and PDF",async()=>{for(const suffix of["",`/${ids.aInvoice}`,`/${ids.aInvoice}/pdf`]){const r=await call("rome","/billing/invoices"+suffix);assert.equal(r.status,403);absent(await r.text(),"PRIVATE_INVOICE_a");}});
  it("keeps company subscription invoices tenant-scoped for managers",async()=>{const rows=await json("manager","/billing/invoices");assert.ok(JSON.stringify(rows).includes(ids.aInvoice));absent(rows,ids.bInvoice,"PRIVATE_INVOICE_b");assert.equal((await call("manager",`/billing/invoices/${ids.bInvoice}`)).status,404);assert.equal((await call("manager","/billing/invoices",{site:ids.rome})).status,403);});
  it("rejects subscription commands from a branch before provider/configuration work",async()=>{for(const[path,body]of[["/billing/checkout-session",{plan:"PRO"}],["/billing/payment-method-session",{}],["/billing/customer-portal-session",{}]]as const)assert.equal((await call("rome",path,{method:"POST",body})).status,403,path);assert.equal((await call("rome","/billing/local-complete?plan=PRO")).status,403);});
  it("guards direct billing entry points while preserving internal provider reconciliation",async()=>{const service=new BillingService(new PrismaAuditLogRepository());await assert.rejects(scoped("rome",()=>service.completeLocalCheckout({tenantId:ids.a,userId:ids.romeUser,plan:"PRO"})),(e:any)=>e.statusCode===403);});
  it("requires existing permissions even in an assigned site",async()=>{for(const path of["/master-data/sites","/master-data/workshops","/users","/settings/sla","/contract-templates/default","/billing/invoices"])assert.equal((await call("nopermission",path)).status,403,path);});
  it("uses private no-store cache headers on company and shared catalog responses",async()=>{for(const path of["/users","/master-data/sites","/master-data/workshops","/settings/sla","/tenant/profile","/billing/invoices","/contract-templates/default"]){const r=await call("manager",path);assert.equal(r.status,200,path);assert.equal(r.headers.get("cache-control"),"private, no-store",path);}});
  it("allows authorized manager edits but refuses foreign IDs without mutation",async()=>{assert.equal((await call("manager",`/master-data/sites/${ids.rome}`,{method:"PATCH",body:{name:"SYN-rome-updated"}})).status,200);assert.equal((await call("manager",`/master-data/workshops/${ids.aWorkshop}`,{method:"PATCH",body:{name:"Synthetic shared updated"}})).status,200);assert.equal((await call("manager",`/users/${ids.romeUser}`,{method:"PATCH",body:{firstName:"Synthetic updated"}})).status,200);assert.equal((await call("manager",`/master-data/sites/${ids.foreign}`,{method:"PATCH",body:{name:"Synthetic denied"}})).status,200);assert.equal((await prisma.site.findUniqueOrThrow({where:{id:ids.foreign}})).name,"SYN-foreign");});
  it("keeps direct workshop writes scalar and prevents tenant/system-field reassignment",async()=>{const repository=new PrismaWorkshopRepository();await assert.rejects(scoped("manager",()=>repository.update(ids.a,ids.aWorkshop,{tenantId:ids.b})),(e:any)=>e.statusCode===400);assert.equal((await prisma.workshop.findUniqueOrThrow({where:{id:ids.aWorkshop}})).tenantId,ids.a);});
  it("uses the next request's current assignment, role and site status",async()=>{
    try{await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.milan}});assert.equal((await json("rome","/master-data/sites")).data[0].id,ids.milan);await prisma.site.update({where:{id:ids.milan},data:{isActive:false}});assert.equal((await json("rome","/master-data/sites")).total,0);await prisma.site.update({where:{id:ids.milan},data:{isActive:true}});await prisma.userRole.deleteMany({where:{userId:ids.managerUser}});await prisma.userRole.create({data:{userId:ids.managerUser,roleId:ids.OPERATOR}});assert.equal((await call("manager","/settings/integrations")).status,403);}
    finally{await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.rome}});await prisma.site.update({where:{id:ids.milan},data:{isActive:true}});await prisma.userRole.deleteMany({where:{userId:ids.managerUser}});await prisma.userRole.create({data:{userId:ids.managerUser,roleId:ids.MANAGER}});}
  });
  it("preserves authorized company profile and contract template editing",async()=>{
    const profile=await json("manager","/tenant/profile",{method:"PATCH",body:companyProfile});assert.equal(profile.profile.legalName,companyProfile.legalName);assert.equal(profile.profile.country,"US");
    const template=await json("manager","/contract-templates/default",{method:"PATCH",body:{content:"Synthetic updated terms {{customerName}}"}});assert.match(template.content,/Synthetic updated terms/);
  });
  it("preserves authorized company uploads and shared logo downloads",async()=>{
    for(const path of["/tenant/branding/logo","/contract-templates/default/logo","/tenant/onboarding/company-verification-document"]){const form=new FormData();form.set("file",new Blob([new Uint8Array(png)],{type:"image/png"}),"synthetic.png");const response=await fetch(base+path,{method:"POST",headers:{Authorization:`Bearer ${tokens.manager}`},body:form});assert.equal(response.status,201,await response.text());}
    const logo=await call("rome","/contract-templates/default/logo/file");assert.equal(logo.status,200);assert.equal(logo.headers.get("cache-control"),"private, no-store");assert.match(logo.headers.get("content-type")!,/^image\/png/);
    const downloaded=Buffer.from(await logo.arrayBuffer());assert.equal((await sharp(downloaded).metadata()).width,2);assert.deepEqual(await sharp(downloaded).ensureAlpha().raw().toBuffer(),await sharp(png).ensureAlpha().raw().toBuffer());
  });
  it("requires the company verification upload permission before parsing multipart data",async()=>{
    const form=new FormData();form.set("file",new Blob([new Uint8Array(png)],{type:"image/png"}),"synthetic.png");assert.equal((await fetch(base+"/tenant/onboarding/company-verification-document",{method:"POST",headers:{Authorization:`Bearer ${tokens.nopermission}`},body:form})).status,403);
  });
  it("keeps failed cross-tenant user and workshop commands free of mutations",async()=>{
    const before=await prisma.user.findUniqueOrThrow({where:{id:ids.foreignUser}});assert.equal((await call("manager",`/users/${ids.foreignUser}`,{method:"PATCH",body:{firstName:"Denied"}})).status,404);
    const workshop=await prisma.workshop.findUniqueOrThrow({where:{id:ids.bWorkshop}});const response=await call("manager",`/master-data/workshops/${ids.bWorkshop}`,{method:"PATCH",body:{name:"Denied"}});assert.equal(response.status,200);assert.equal(await response.text(),"null");assert.equal((await prisma.workshop.findUniqueOrThrow({where:{id:ids.bWorkshop}})).updatedAt.toISOString(),workshop.updatedAt.toISOString());assert.equal((await prisma.user.findUniqueOrThrow({where:{id:ids.foreignUser}})).firstName,before.firstName);
  });
  it("preserves authorized account creation and invitations without delivering real email",async()=>{
    const create=await call("manager","/users",{method:"POST",body:{...invite,email:`${run}-allowed-create@example.invalid`,password:"Synthetic-Only-123!"}});assert.equal(create.status,201,await create.clone().text());assert.equal((await create.json()as any).tenantId,ids.a);
    const response=await call("manager","/users/invite",{method:"POST",body:{...invite,email:`${run}-allowed-invite@example.invalid`}});assert.equal(response.status,201,await response.text());assert.equal(sent.length,1);
    const user=await prisma.user.findFirstOrThrow({where:{tenantId:ids.a,email:`${run}-allowed-invite@example.invalid`}});assert.equal(user.status,"INVITED");assert.equal(await prisma.invitationToken.count({where:{userId:user.id}}),1);
  });
});
