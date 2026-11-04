import {assertSyntheticDatabase} from "../helpers/synthetic-database.js";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import {after,before,describe,it} from "node:test";
import type http from "node:http";
import type {AddressInfo} from "node:net";
import {createApp} from "../../src/app.js";
import {prisma} from "../../src/infrastructure/database/prisma/client.js";
import {requireAuth} from "../../src/interfaces/http/middlewares/auth.js";
import {SiteAccessService} from "../../src/application/services/site-access-service.js";
import {runWithSiteAccess} from "../../src/infrastructure/auth/site-access-context.js";
import {StoppagesController} from "../../src/interfaces/http/controllers/stoppages-controller.js";
import {signTenantAccessToken} from "../helpers/http-auth.js";
import {env} from "../../src/shared/config/env.js";
import {bindCalendarSource} from "../../src/infrastructure/repositories/calendar-event-scope.js";
import {createAuditLog} from "../../src/infrastructure/repositories/prisma-audit-log-repository.js";

const ids:Record<string,string>={},tokens:Record<string,string>={},tenants:string[]=[];
const run=`calendar-scope-${Date.now()}`,prototype=StoppagesController.prototype as any;
const originalGoogle=prototype.fetchGoogleJson,originalText=prototype.fetchText;
const oldClient=env.GOOGLE_CLIENT_ID,oldSecret=env.GOOGLE_CLIENT_SECRET;
const googleCalls:Array<{url:string;body?:string}>=[];
let server:http.Server|undefined,base="",suspendOnExchange=false,suspendOnFeed=false,suspendOnGoogleList=false;
let remoteItems:any[]=[];
const from=new Date(Date.now()-86400000),to=new Date(Date.now()+30*86400000);
const eventInput={title:"Synthetic personal appointment",description:"Synthetic personal text",start:new Date().toISOString(),end:new Date(Date.now()+3600000).toISOString(),calendarId:"personal"};
const call=(who:string,path:string,options:{method?:string;body?:object;site?:string;cookie?:string;public?:boolean}={})=>fetch(base+path,{method:options.method??"GET",headers:{...(!options.public?{Authorization:`Bearer ${tokens[who]}`} :{}),...(options.body?{"Content-Type":"application/json"}:{}),...(options.site?{"X-Fleetum-Site":options.site}:{}),...(options.cookie?{Cookie:options.cookie}:{})},...(options.body?{body:JSON.stringify(options.body)}:{})});
const json=async(who:string,path:string,options:Parameters<typeof call>[2]={})=>{const r=await call(who,path,options);assert.equal(r.status,200,await r.clone().text());return r.json() as Promise<any>;};
const personalPath="/stoppages/calendar/custom",infoPath="/stoppages/calendar/apple/feed";
const feedPath=(info:any)=>{const url=new URL(info.data.httpUrl);return url.pathname.replace(/^\/api/,"")+url.search;};
const info=(who="rome",site?:string,privacy="masked")=>json(who,infoPath+`?dateFrom=${from.toISOString()}&dateTo=${to.toISOString()}&privacy=${privacy}`,{site});
const absent=(data:unknown,...values:string[])=>{const text=typeof data==="string"?data:JSON.stringify(data);for(const value of values)assert.ok(!text.includes(value),value);};
const oauth=async()=>{const r=await call("rome","/stoppages/calendar/google/sync",{method:"POST",body:{dateFrom:from.toISOString(),dateTo:to.toISOString(),privacy:"masked"}});assert.equal(r.status,200,await r.clone().text());const body=await r.json() as any;return{url:new URL(body.data.authUrl),cookie:r.headers.get("set-cookie")?.split(";")[0]??""};};
const clearConnection=()=>prisma.auditLog.deleteMany({where:{tenantId:ids.a,resource:"integrations"}});
const syntheticIcs=(uid="synthetic-import",description="Personal meeting")=>`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:Synthetic imported\r\nDESCRIPTION:${description}\r\nDTSTART:${eventInput.start.replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z")}\r\nDTEND:${eventInput.end.replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z")}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
let importedFeed=syntheticIcs();

describe("E02 personal calendars, bound feeds and synchronization",()=>{
  before(async()=>{
    assertSyntheticDatabase({user:"fleetum_e02_calendars",database:"fleetum_e02_calendars_test",port:"61528"});
    assert.equal(process.env.NODE_ENV,"test");assert.equal(process.env.DOTENV_CONFIG_PATH,"/dev/null");const db=new URL(process.env.DATABASE_URL!);
    env.GOOGLE_CLIENT_ID="synthetic-calendar-client";env.GOOGLE_CLIENT_SECRET="synthetic-calendar-secret";
    prototype.fetchGoogleJson=async(url:string,init?:RequestInit)=>{
      googleCalls.push({url,body:typeof init?.body==="string"?init.body:undefined});
      if(url==="https://oauth2.googleapis.com/token"){
        if(suspendOnExchange)await prisma.user.update({where:{id:ids.romeUser},data:{status:"SUSPENDED"}});
        return{access_token:"synthetic-access",refresh_token:"synthetic-refresh",scope:"calendar.events",expires_in:3600};
      }
      if(url.includes("userinfo"))return{email:"synthetic@example.invalid"};
      if(init?.method==="POST"||init?.method==="PATCH")return{id:"synthetic-remote-event"};
      if(url.includes("/calendar/v3/")&&suspendOnGoogleList)await prisma.user.update({where:{id:ids.romeUser},data:{status:"SUSPENDED"}});
      return{items:remoteItems};
    };
    prototype.fetchText=async()=>{if(suspendOnFeed)await prisma.user.update({where:{id:ids.romeUser},data:{status:"SUSPENDED"}});return importedFeed;};
    for(const role of ["ADMIN","MANAGER","OPERATOR"]){ids[role]=(await prisma.role.upsert({where:{key:role},update:{},create:{key:role,name:role}})).id;for(const key of ["stoppages:read","stoppages:write","vehicles:read","vehicles:write"]){const permission=await prisma.permission.upsert({where:{key},update:{},create:{key,description:"Synthetic"}});ids[key]=permission.id;await prisma.rolePermission.upsert({where:{roleId_permissionId:{roleId:ids[role],permissionId:permission.id}},update:{},create:{roleId:ids[role],permissionId:permission.id}});}}
    for(const name of ["a","b"]){ids[name]=(await prisma.tenant.create({data:{name:`${run}-${name}`}})).id;tenants.push(ids[name]);await prisma.tenantSubscription.create({data:{tenantId:ids[name],provider:"local",status:"ACTIVE",plan:"ENTERPRISE",seats:20}});}
    for(const [name,tenant]of[["rome","a"],["milan","a"],["foreign","b"]]){ids[name]=(await prisma.site.create({data:{tenantId:ids[tenant],name:`Synthetic ${name}`,address:"Synthetic",city:"Synthetic"}})).id;ids[name+"Vehicle"]=(await prisma.vehicle.create({data:{tenantId:ids[tenant],siteId:ids[name],plate:`SYN-${name}`,brand:"Synthetic",model:"Synthetic",revisionDueAt:new Date(Date.now()-86400000)}})).id;}
    for(const[name,role,tenant,site]of[["rome","OPERATOR","a",ids.rome],["milan","OPERATOR","a",ids.milan],["unassigned","OPERATOR","a",null],["manager","MANAGER","a",null],["foreign","ADMIN","b",null]]as const){const user=await prisma.user.create({data:{tenantId:ids[tenant],email:`${run}-${name}@example.invalid`,firstName:"Synthetic",lastName:name,passwordHash:"synthetic-unused",assignedSiteId:site,roles:{create:{roleId:ids[role]}}}});ids[name+"User"]=user.id;const session=await prisma.refreshSession.create({data:{tenantId:ids[tenant],userId:user.id,tokenHash:`${run}-${name}`,expiresAt:new Date(Date.now()+3600000)}});ids[name+"Session"]=session.id;tokens[name]=signTenantAccessToken({tenantId:ids[tenant],userId:user.id,sessionId:session.id});}
    for(const name of["rome","milan"]){ids[name+"LegacyEvent"]=(await prisma.calendarEvent.create({data:{tenantId:ids.a,userId:ids.romeUser,title:`PRIVATE_LEGACY_${name}`,description:`[[AUTO_VEICOLO|REVISION|${ids[name+"Vehicle"]}]]`,startAt:new Date(),endAt:new Date(Date.now()+3600000),type:"TASK",calendarId:"work"}})).id;}
    ids.unknownEvent=(await prisma.calendarEvent.create({data:{tenantId:ids.a,userId:ids.romeUser,title:"PRIVATE_UNKNOWN",description:"Unclassified old work task",startAt:new Date(),endAt:new Date(Date.now()+3600000),type:"TASK",calendarId:"work"}})).id;
    const app=createApp();server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server!.once("listening",resolve));base=`http://127.0.0.1:${(server.address()as AddressInfo).port}/api`;
    const personal=await call("rome",personalPath,{method:"POST",body:eventInput});assert.equal(personal.status,201,await personal.clone().text());ids.personal=(await personal.json()as any).data.id;
  });
  after(async()=>{
    await new Promise<void>(resolve=>server?server.close(()=>resolve()):resolve());prototype.fetchGoogleJson=originalGoogle;prototype.fetchText=originalText;env.GOOGLE_CLIENT_ID=oldClient;env.GOOGLE_CLIENT_SECRET=oldSecret;
    const where={tenantId:{in:tenants}};
    for(const model of[prisma.auditLog,prisma.calendarEvent,prisma.vehicle,prisma.refreshSession]as any[])await model.deleteMany({where});await prisma.userRole.deleteMany({where:{user:{tenantId:{in:tenants}}}});await prisma.user.deleteMany({where});await prisma.site.deleteMany({where});await prisma.tenantSubscription.deleteMany({where});await prisma.tenant.deleteMany({where:{id:{in:tenants}}});await prisma.$disconnect();
  });
  it("keeps personal events while excluding unclassified operational copies",async()=>{const data=await json("rome",personalPath);assert.ok(JSON.stringify(data).includes(ids.personal));absent(data,"PRIVATE_LEGACY_milan","PRIVATE_UNKNOWN");});
  it("does not erase another site's generated tasks during deadline synchronization",async()=>{const r=await call("rome","/master-data/vehicle-deadlines/calendar-sync",{method:"POST",body:{includeSoon:false}});assert.equal(r.status,200,await r.text());assert.ok(await prisma.calendarEvent.findUnique({where:{id:ids.milanLegacyEvent}}));const data=await json("rome",personalPath);assert.ok(JSON.stringify(data).includes("SYN-rome"));absent(data,"SYN-milan","PRIVATE_UNKNOWN");});
  it("blocks direct editing/deletion of hidden generated events",async()=>{for(const method of["PATCH","DELETE"]){const r=await call("rome",`${personalPath}/${ids.milanLegacyEvent}`,{method,body:method==="PATCH"?{title:"Synthetic denied"}:undefined});assert.equal(r.status,404);}assert.ok(await prisma.calendarEvent.findUnique({where:{id:ids.milanLegacyEvent}}));});
  it("prevents forging or stripping reserved provenance markers",async()=>{assert.equal((await call("rome",personalPath,{method:"POST",body:{...eventInput,description:`[[AUTO_VEICOLO|REVISION|${ids.milanVehicle}]]`}})).status,400);assert.equal((await call("rome",`${personalPath}/${ids.romeLegacyEvent}`,{method:"PATCH",body:{description:"Turn into personal"}})).status,409);});
  it("does not expose or mutate another user's agenda",async()=>{const other=await json("milan",personalPath);absent(other,ids.personal);assert.equal((await call("milan",`${personalPath}/${ids.personal}`,{method:"DELETE"})).status,404);});
  it("binds feed privacy and range and uses a private no-store cache",async()=>{const link=await info();const r=await call("rome",feedPath(link),{public:true});assert.equal(r.status,200,await r.clone().text());assert.equal(r.headers.get("cache-control"),"private, no-store");absent(await r.text(),"PRIVATE_LEGACY_milan","PRIVATE_UNKNOWN");const url=new URL(link.data.httpUrl);url.searchParams.set("privacy","full");assert.equal((await call("rome",url.pathname.replace(/^\/api/,"")+url.search,{public:true})).status,403);url.searchParams.set("dateFrom","1900-01-01T00:00:00.000Z");assert.equal((await call("rome",url.pathname.replace(/^\/api/,"")+url.search,{public:true})).status,403);});
  it("revokes a feed after logout without requiring a browser cookie on the reader",async()=>{const link=await info();await prisma.refreshSession.update({where:{id:ids.romeSession},data:{revokedAt:new Date()}});try{assert.equal((await call("rome",feedPath(link),{public:true})).status,403);}finally{await prisma.refreshSession.update({where:{id:ids.romeSession},data:{revokedAt:null}});}});
  it("does not revoke a legitimate feed for normal refresh rotation",async()=>{const link=await info();const next=await prisma.refreshSession.create({data:{tenantId:ids.a,userId:ids.romeUser,tokenHash:`${run}-successor`,expiresAt:new Date(Date.now()+3600000)}});await prisma.refreshSession.update({where:{id:ids.romeSession},data:{revokedAt:new Date(),replacedById:next.id}});try{assert.equal((await call("rome",feedPath(link),{public:true})).status,200);}finally{await prisma.refreshSession.update({where:{id:ids.romeSession},data:{revokedAt:null,replacedById:null}});await prisma.refreshSession.delete({where:{id:next.id}});}});
  it("rejects stale feeds after assignment, role or permission changes",async()=>{
    for(const change of["site","role","permission"]){const link=await info(),key={roleId_permissionId:{roleId:ids.OPERATOR,permissionId:ids["stoppages:read"]}};
      try{if(change==="site")await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.milan}});if(change==="role"){await prisma.userRole.deleteMany({where:{userId:ids.romeUser}});await prisma.userRole.create({data:{userId:ids.romeUser,roleId:ids.MANAGER}});}if(change==="permission")await prisma.rolePermission.delete({where:key});assert.equal((await call("rome",feedPath(link),{public:true})).status,403,change);}
      finally{await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.rome}});await prisma.userRole.deleteMany({where:{userId:ids.romeUser}});await prisma.userRole.create({data:{userId:ids.romeUser,roleId:ids.OPERATOR}});await prisma.rolePermission.upsert({where:key,update:{},create:{roleId:ids.OPERATOR,permissionId:ids["stoppages:read"]}});}
    }
  });
  it("checks license state on every public feed request",async()=>{const link=await info();await prisma.tenantSubscription.update({where:{tenantId:ids.a},data:{status:"SUSPENDED"}});try{assert.equal((await call("rome",feedPath(link),{public:true})).status,403);}finally{await prisma.tenantSubscription.update({where:{tenantId:ids.a},data:{status:"ACTIVE"}});}});
  it("allows explicit feed revocation",async()=>{const link=await info();assert.equal((await call("rome","/stoppages/calendar/apple/revoke",{method:"POST",body:{}})).status,204);assert.equal((await call("rome",feedPath(link),{public:true})).status,403);});
  it("requires browser correlation and rejects callback replay before another provider call",async()=>{const flow=await oauth(),path=`/calendar/google/callback?code=synthetic-code&state=${encodeURIComponent(flow.url.searchParams.get("state")!)}`,count=googleCalls.length;await call("rome",path,{public:true});assert.equal(googleCalls.length,count);await call("rome",path,{public:true,cookie:flow.cookie});assert.ok(googleCalls.length>count);const after=googleCalls.length;await call("rome",path,{public:true,cookie:flow.cookie});assert.equal(googleCalls.length,after);assert.ok(flow.cookie);});
  it("rejects an OAuth callback after the requester is suspended without exchanging the code",async()=>{await prisma.auditLog.deleteMany({where:{tenantId:ids.a,resource:"integrations"}});const flow=await oauth(),count=googleCalls.length;await prisma.user.update({where:{id:ids.romeUser},data:{status:"SUSPENDED"}});try{await call("rome",`/calendar/google/callback?code=synthetic-code&state=${encodeURIComponent(flow.url.searchParams.get("state")!)}`,{public:true,cookie:flow.cookie});assert.equal(googleCalls.length,count);}finally{await prisma.user.update({where:{id:ids.romeUser},data:{status:"ACTIVE"}});}});
  it("discards a code response if authority changes before credentials or events are saved",async()=>{await prisma.auditLog.deleteMany({where:{tenantId:ids.a,resource:"integrations"}});const flow=await oauth();suspendOnExchange=true;try{await call("rome",`/calendar/google/callback?code=synthetic-code&state=${encodeURIComponent(flow.url.searchParams.get("state")!)}`,{public:true,cookie:flow.cookie});assert.equal(await prisma.auditLog.count({where:{tenantId:ids.a,resource:"integrations",action:"SETTINGS_GOOGLE_CALENDAR"}}),0);}finally{suspendOnExchange=false;await prisma.user.update({where:{id:ids.romeUser},data:{status:"ACTIVE"}});}});
  it("allows a new link after explicit revocation while old and legacy links stay denied",async()=>{
    const old=await info();await call("rome","/stoppages/calendar/apple/revoke",{method:"POST",body:{}});
    const fresh=await info();assert.equal((await call("rome",feedPath(fresh),{public:true})).status,200);assert.equal((await call("rome",feedPath(old),{public:true})).status,403);
    const legacy=jwt.sign({tokenType:"calendar_feed",tenantId:ids.a,userId:ids.romeUser},env.JWT_SECRET,{expiresIn:"180d"});assert.equal((await call("rome",`/calendar/apple/feed.ics?token=${legacy}`,{public:true})).status,403);
  });
  it("keeps manager aggregation and selected-site feeds separate from other users' personal agendas",async()=>{
    assert.equal((await call("manager","/master-data/vehicle-deadlines/calendar-sync",{method:"POST",body:{includeSoon:false}})).status,200);
    const all=await json("manager",personalPath);assert.match(JSON.stringify(all),/SYN-rome/);assert.match(JSON.stringify(all),/SYN-milan/);absent(all,ids.personal);
    const selected=await json("manager",personalPath,{site:ids.rome});assert.match(JSON.stringify(selected),/SYN-rome/);absent(selected,"SYN-milan",ids.personal);
    const link=await info("manager",ids.rome);const feed=await call("manager",feedPath(link),{public:true});assert.equal(feed.status,200);absent(await feed.text(),"SYN-milan");
  });
  it("preserves personal appointments on reassignment but hides stale vehicle copies until regenerated",async()=>{
    await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.milan}});
    await prisma.vehicle.update({where:{id:ids.romeVehicle},data:{siteId:ids.milan}});
    try{
      const before=await json("rome",personalPath);assert.match(JSON.stringify(before),new RegExp(ids.personal));absent(before,"SYN-rome");
      assert.equal((await call("rome","/master-data/vehicle-deadlines/calendar-sync",{method:"POST",body:{includeSoon:false}})).status,200);
      const after=await json("rome",personalPath);assert.match(JSON.stringify(after),/SYN-rome/);assert.match(JSON.stringify(after),new RegExp(ids.personal));
    }finally{await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.rome}});await prisma.vehicle.update({where:{id:ids.romeVehicle},data:{siteId:ids.rome}});}
  });
  it("does not resurrect a link after its site is deactivated and reactivated between polls",async()=>{
    const link=await info();await prisma.site.update({where:{id:ids.rome},data:{isActive:false,updatedAt:new Date(Date.now()+1000)}});await prisma.site.update({where:{id:ids.rome},data:{isActive:true,updatedAt:new Date(Date.now()+2000)}});
    assert.equal((await call("rome",feedPath(link),{public:true})).status,403);
  });
  it("imports a personal ICS once, updates it idempotently and preserves it after reassignment",async()=>{
    const body={feedUrl:"https://calendar.example.invalid/synthetic.ics",dateFrom:from.toISOString(),dateTo:to.toISOString()};
    importedFeed=syntheticIcs("synthetic-import","Personal meeting [[AUTO_VEICOLO|REVISION|foreign]] [GF_GCAL_ID:forged]");
    const first=await json("rome","/stoppages/calendar/apple/import",{method:"POST",body});assert.equal(first.data.imported,1);
    const second=await json("rome","/stoppages/calendar/apple/import",{method:"POST",body});assert.equal(second.data.imported,0);assert.equal(second.data.updated,1);
    const row=await prisma.calendarEvent.findFirstOrThrow({where:{tenantId:ids.a,userId:ids.romeUser,title:"Synthetic imported"}});absent(row.description,"[[AUTO_","[GF_GCAL_ID:forged]");
    await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.milan}});try{assert.match(JSON.stringify(await json("rome",personalPath)),new RegExp(row.id));}finally{await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.rome}});importedFeed=syntheticIcs();}
  });
  it("rejects imported UID marker injection and discards downloads after authority revocation",async()=>{
    const body={feedUrl:"https://calendar.example.invalid/synthetic.ics",dateFrom:from.toISOString(),dateTo:to.toISOString()};const count=await prisma.calendarEvent.count({where:{tenantId:ids.a,userId:ids.romeUser}});
    importedFeed=syntheticIcs("forged][GF_GCAL_ID:other");assert.equal((await json("rome","/stoppages/calendar/apple/import",{method:"POST",body})).data.imported,0);
    importedFeed=syntheticIcs("revoked-download");suspendOnFeed=true;
    try{assert.equal((await call("rome","/stoppages/calendar/apple/import",{method:"POST",body})).status,403);assert.equal(await prisma.calendarEvent.count({where:{tenantId:ids.a,userId:ids.romeUser}}),count);}finally{suspendOnFeed=false;importedFeed=syntheticIcs();await prisma.user.update({where:{id:ids.romeUser},data:{status:"ACTIVE"}});}
  });
  it("uses S256 PKCE and atomically consumes simultaneous Google callbacks once",async()=>{
    await clearConnection();const flow=await oauth(),state=flow.url.searchParams.get("state")!,count=googleCalls.filter(row=>row.url==="https://oauth2.googleapis.com/token").length;
    const path=`/calendar/google/callback?code=synthetic-race&state=${encodeURIComponent(state)}`;
    const responses=await Promise.all([call("rome",path,{public:true,cookie:flow.cookie}),call("rome",path,{public:true,cookie:flow.cookie})]);
    const exchanges=googleCalls.filter(row=>row.url==="https://oauth2.googleapis.com/token").slice(count);assert.equal(exchanges.length,1);
    const verifier=new URLSearchParams(exchanges[0].body).get("code_verifier")!;assert.match(verifier,/^[A-Za-z0-9_-]{43,128}$/);assert.equal(flow.url.searchParams.get("code_challenge_method"),"S256");assert.equal(flow.url.searchParams.get("code_challenge"),crypto.createHash("sha256").update(verifier).digest("base64url"));
    const grant=await prisma.auditLog.findFirstOrThrow({where:{resource:"CalendarGrant",resourceId:crypto.createHash("sha256").update(state).digest("hex"),action:"CALENDAR_GRANT_CREATED"}});absent(grant.details,verifier,state,flow.cookie.split("=")[1]);
    const bodies=await Promise.all(responses.map(r=>r.text()));assert.equal(bodies.filter(text=>text.includes('"status":"success"')).length,1);
  });
  it("consumes a canceled Google authorization and rejects its later replay without a provider call",async()=>{
    await clearConnection();const flow=await oauth(),state=encodeURIComponent(flow.url.searchParams.get("state")!),count=googleCalls.length;
    await call("rome",`/calendar/google/callback?error=access_denied&state=${state}`,{public:true,cookie:flow.cookie});await call("rome",`/calendar/google/callback?code=synthetic-code&state=${state}`,{public:true,cookie:flow.cookie});assert.equal(googleCalls.length,count);
  });
  it("keeps an unassigned operator's personal agenda usable without exposing operational copies",async()=>{
    const created=await call("unassigned",personalPath,{method:"POST",body:eventInput});assert.equal(created.status,201);const id=(await created.json()as any).data.id;
    const rows=await json("unassigned",personalPath);assert.equal(rows.data.length,1);assert.equal(rows.data[0].id,id);absent(rows,ids.personal,"SYN-rome","SYN-milan");
  });
  it("fails closed for explicitly corrupt provenance even in a manager all-sites view",async()=>{
    const row=await prisma.calendarEvent.create({data:{tenantId:ids.a,userId:ids.managerUser,title:"CORRUPT_SOURCE_PRIVATE",startAt:new Date(),endAt:new Date(Date.now()+3600000)}});
    await createAuditLog(prisma,{tenantId:ids.a,userId:ids.managerUser,resource:"CalendarEvent",resourceId:row.id,action:"CALENDAR_SOURCE_V1",details:{version:1,kind:"personal",source:"forged"}},new Date());absent(await json("manager",personalPath),row.id,"CORRUPT_SOURCE_PRIVATE");
  });
  it("does not convert managed vehicle tasks into personal events through an imported UID",async()=>{
    const row=await prisma.$transaction(async tx=>{const created=await tx.calendarEvent.create({data:{tenantId:ids.a,userId:ids.romeUser,title:"Managed immutable task",description:"[GF_ACAL_UID:managed-import]",startAt:new Date(),endAt:new Date(Date.now()+3600000)}});await bindCalendarSource(tx,created,{version:1,kind:"vehicle_deadline",source:"deadline",vehicleId:ids.romeVehicle,siteId:ids.rome});return created;});
    importedFeed=syntheticIcs("managed-import");try{const result=await json("rome","/stoppages/calendar/apple/import",{method:"POST",body:{feedUrl:"https://calendar.example.invalid/synthetic.ics",dateFrom:from.toISOString(),dateTo:to.toISOString()}});assert.equal(result.data.updated,0);assert.equal((await prisma.calendarEvent.findUniqueOrThrow({where:{id:row.id}})).title,row.title);}finally{importedFeed=syntheticIcs();}
  });
  it("rechecks authority before publishing a feed loaded before a suspension",async()=>{
    const link=await info(),original=prototype.loadAppleCalendarEvents;prototype.loadAppleCalendarEvents=async function(...args:any[]){const rows=await original.apply(this,args);await prisma.user.update({where:{id:ids.romeUser},data:{status:"SUSPENDED"}});return rows;};
    try{const response=await call("rome",feedPath(link),{public:true});assert.equal(response.status,403);absent(await response.text(),"BEGIN:VCALENDAR",ids.personal);}finally{prototype.loadAppleCalendarEvents=original;await prisma.user.update({where:{id:ids.romeUser},data:{status:"ACTIVE"}});}
  });
  it("pushes only scoped, masked events and imports Google events as owner-only personal appointments",async()=>{
    await clearConnection();remoteItems=[{id:"synthetic-google-import",summary:"Synthetic Google imported",description:"Meeting [GF_ACAL_UID:forged]",start:{dateTime:eventInput.start},end:{dateTime:eventInput.end}}];
    const flow=await oauth(),count=googleCalls.length;
    try{
      const response=await call("rome",`/calendar/google/callback?code=synthetic-pull&state=${encodeURIComponent(flow.url.searchParams.get("state")!)}`,{public:true,cookie:flow.cookie});assert.match(await response.text(),/"status":"success"/);
      const pushed=googleCalls.slice(count).filter(row=>row.url.includes("/calendar/v3/")&&row.body).map(row=>JSON.parse(row.body!));assert.ok(pushed.length>0);absent(pushed,"PRIVATE_LEGACY_milan","PRIVATE_UNKNOWN","SYN-milan","Synthetic personal text");
      const imported=await prisma.calendarEvent.findFirstOrThrow({where:{tenantId:ids.a,userId:ids.romeUser,title:"Synthetic Google imported"}});absent(imported.description,"[GF_ACAL_UID:forged]");absent(await json("milan",personalPath),imported.id);
      await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.milan}});assert.match(JSON.stringify(await json("rome",personalPath)),new RegExp(imported.id));
    }finally{remoteItems=[];await prisma.user.update({where:{id:ids.romeUser},data:{assignedSiteId:ids.rome}});}
  });
  it("does not persist Google imports after authority changes during the remote event response",async()=>{
    await clearConnection();remoteItems=[{id:"synthetic-revoked-google",summary:"SHOULD_NOT_IMPORT",start:{dateTime:eventInput.start},end:{dateTime:eventInput.end}}];const flow=await oauth();suspendOnGoogleList=true;
    try{await call("rome",`/calendar/google/callback?code=synthetic-revoked&state=${encodeURIComponent(flow.url.searchParams.get("state")!)}`,{public:true,cookie:flow.cookie});assert.equal(await prisma.calendarEvent.count({where:{tenantId:ids.a,userId:ids.romeUser,title:"SHOULD_NOT_IMPORT"}}),0);}finally{suspendOnGoogleList=false;remoteItems=[];await prisma.user.update({where:{id:ids.romeUser},data:{status:"ACTIVE"}});}
  });
});
