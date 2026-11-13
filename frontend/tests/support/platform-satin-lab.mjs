// Loopback-only synthetic transport for manual UI QA. Never imported by the app.
// This is not backend authorization evidence and contains no real account/data.
import http from 'node:http';
import crypto from 'node:crypto';
const stamp = () => new Date().toISOString();
const addDays = (days) => new Date(Date.now() + days * 86400000).toISOString();
const key = 'synthetic-platform-lab-only-not-a-production-secret';
const token = () => {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ sub: 'synthetic-admin', role: 'PLATFORM_ADMIN', exp: Math.floor(Date.now()/1000)+7200 })).toString('base64url');
  return `${head}.${body}.${crypto.createHmac('sha256',key).update(`${head}.${body}`).digest('base64url')}`;
};
const statuses = ['ACTIVE','TRIAL','SUSPENDED','PENDING','EXPIRED','PAST_DUE','CANCELED'];
const plans = ['STARTER','PRO','ENTERPRISE'];
const pricing = { STARTER:149, PRO:199, ENTERPRISE:249 };
let mode = 'complete', operations = [];
const makeTenants = () => statuses.map((status,i)=>({ id:`synthetic-${i+1}`, name:`Azienda QA ${i+1}`, company:{legalName: i===1 ? 'Noleggio QA con denominazione molto lunga e sedi operative coordinate S.r.l.' : `Noleggio QA ${i+1} S.r.l.`, tradeName:`QA ${i+1}`, vatNumber:'00000000000', email:`azienda${i+1}@fleetum.example`, phone:null, profileCompleted:i!==3, onboardingStatus:i===3?'INCOMPLETE':'COMPLETE', hasLogo:false}, owner:i===3?null:{firstName:'Titolare',lastName:`Sintetico ${i+1}`,email:`titolare${i+1}@fleetum.example`},isActive:i!==4, usersCount:i+2,vehiclesCount:20+i*4,license:{plan:plans[i%3],status,seats:i+3,expiresAt:addDays(i===1?4:40),priceMonthly:pricing[plans[i%3]],billingCycle:'monthly'}}));
let tenants = makeTenants();
let invoice = { id:'qa-invoice',tenantId:'synthetic-1',tenantName:'Azienda QA 1',invoiceNumber:'QA-2026-001',plan:'STARTER',subtotal:149,tax:32.78,total:181.78,currency:'EUR',status:'GENERATED',issueDate:stamp(),dueDate:addDays(30),periodStart:stamp(),periodEnd:addDays(30),billingName:'Noleggio QA 1 S.r.l.',billingEmail:'fatture@fleetum.example',taxRate:22,taxAmount:32.78,deliveries:[],items:[],createdAt:stamp() };
let lead = {id:'qa-lead', companyName:'Richiesta sintetica',fullName:'Referente QA',email:'referente@fleetum.example',phone:null,fleetSize:'11-30',message:'Richiesta di prova, nessun contatto reale',source:'QA',status:'NEW',createdAt:stamp(),updatedAt:stamp()};
let device = {id:'qa-device',label:'Browser sintetico',createdAt:stamp(),lastUsedAt:stamp(),expiresAt:addDays(7),revokedAt:null,status:'ACTIVE'};
const events = [{id:'qa-event',tenantName:'Azienda QA 1', action:'LICENSE_RENEW',createdAt:stamp(),details:{actor:'qa-admin',sourceIp:'127.0.0.1',quickAction:'RENEW_30_DAYS'}}];
const analyticsTotals = Object.fromEntries('events pageViews uniqueVisitors ctaClicks demoSubmits signupStarted signupCompleted onboardingCompanyCompleted checkoutStarted checkoutCompleted checkoutFailed trialActivated visitToDemoRate demoToSignupRate visitToSignupRate signupStartToCompletionRate signupToCompanyCompletionRate companyToCheckoutRate checkoutCompletionRate checkoutFailureRate signupToTrialRate visitToTrialRate'.split(' ').map(k=>[k,12]));
const routes = () => ({
  '/tenants':{data:mode==='empty'?[]:mode==='large'?Array.from({length:250},(_,i)=>({...tenants[i%tenants.length],id:`large-${i+1}`,name:`Azienda sintetica ${i+1}`,company:{...tenants[i%tenants.length].company,legalName:`Azienda sintetica ${i+1} S.r.l.`}})):tenants},'/users':{data:mode==='empty'?[]:[{id:'qa-user',firstName:'Operatore',lastName:'Sintetico',email:'operatore@fleetum.example',status:'ACTIVE',tenant:{name:'Azienda QA 1'}}]}, '/invoices':{data:mode==='empty'?[]:[invoice]}, '/events/recent':{data:mode==='empty'?[]:events},
  '/overview':{data:{generatedAt:stamp(),windowDays:30,kpis:{tenantsTotal:tenants.length,activeTenants:6,trialActive:1,trialExpiring:1,suspendedLicenses:1,mrrEstimated:149,demoRequests:1,signups:3,websiteVisits:120,visitToDemoRate:2,invoicesToSend:1,invoiceErrors:0,emailErrors:0},revenueByPlan:{},alerts:mode==='empty'?[]:[{type:'TRIAL',severity:'MEDIUM',label:'Un trial scade tra 4 giorni'}],recentAudit:[]}},
  '/metrics/revenue':{selectedMonth:'2026-11',previousMonth:'2026-10',planPricing:pricing,assumptions:{formula:'canone normalizzato mensile',seatsFactorRule:'prezzo per azienda',billingCycleRule:'annuale / 12'},kpis:{mrrTotal:149,mrrLost:0,deltaFromPrevious:0,tenantsByPlan:{STARTER:1,PRO:0,ENTERPRISE:0},mrrByPlan:{STARTER:149,PRO:0,ENTERPRISE:0}},breakdown:plans.map(plan=>({plan,basePrice:pricing[plan],activeTenants:plan==='STARTER'?1:0,totalTenants:2,seatsTotal:3,estimatedRevenue:plan==='STARTER'?149:0})),trend:[{month:'2026-10',mrrTotal:149,mrrLost:0},{month:'2026-11',mrrTotal:149,mrrLost:0}]},
  '/metrics/dashboard-live':{generatedAt:stamp(),liveWindowMinutes:15,activeUsersLive:mode==='empty'?0:3,previousWindowActiveUsers:2,deltaFromPreviousWindow:1,activeTenantsLive:1,topTenants:mode==='empty'?[]:[{tenantId:'synthetic-1',tenantName:'Azienda QA 1',activeUsers:3}],mrrMonthly:149,mrrLost:0,mrrDeltaFromPrevious:0,month:'2026-11'},
  '/analytics/website':{data:{generatedAt:stamp(),windowDays:30,totals:analyticsTotals,trend:[],funnel:[],topPages:[],topReferrers:[],topSources:[],topCampaigns:[],sourcePerformance:[],deviceBreakdown:[],browserBreakdown:[],eventCounts:{}}}, '/demo-leads':{data:mode==='empty'?[]:[lead]},
  '/security':{data:{generatedAt:stamp(),auth:{otpEmail:'qa@fleetum.example',tokenTtl:'2h',blockedLoginStates:0},controls:{ipAllowlist:'127.0.0.1',corsOrigin:'http://127.0.0.1:5212'},recentEvents:[]}},'/security/trusted-devices':{data:mode==='empty'?[]:[device]},
  '/system-health':{data:{generatedAt:stamp(),api:{status:'UP',responseTimeMs:10},db:{status:'UP'},email:{status:'NOT_CONFIGURED',provider:'NONE',pending:0,failed:0},stripe:{status:'NOT_CONFIGURED'},storage:{status:'LOCAL',provider:'LOCAL',uploadDir:'synthetic',activeFiles:0,activeBytes:0,deletedFilesPendingRetention:0,deletedBytesPendingRetention:0,retentionGraceDays:30,resourceTypes:[],recentEvents:[]},restoreDrill:{status:'MISSING',summaryFile:'synthetic',generatedAt:null,ageSeconds:null,staleAfterDays:35,source:null,postgresBackupFile:null,uploadsBackupFile:null,rpoSeconds:null,rtoSeconds:null,migrationsRestored:0,publicTablesRestored:0,tableCounts:[],tableMismatches:0,uploads:{status:'MISSING',recoveredFileSizeBytes:null,recoveredFileSha256Prefix:null}},invoices:{errors:0}}}
});
const server = http.createServer(async (req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:5213');
  res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5212');res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Access-Control-Allow-Headers','content-type, authorization');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Cache-Control','no-store');
  const send=(status,obj)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(obj));};
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  if(url.pathname==='/qa'){
    if(url.searchParams.has('mode')){mode=url.searchParams.get('mode');if(mode==='reset'){mode='complete';tenants=makeTenants();operations=[];}}
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(`<h1>Fleetum QA locale — dati sintetici</h1><p>Modalità: ${mode}</p>${['complete','empty','large','live-unavailable','read-error','action-error','unauthorized','reset'].map(m=>`<a href="/qa?mode=${m}">${m}</a> `).join('')}<h2>Operazioni simulate</h2><pre>${JSON.stringify(operations,null,2)}</pre>`);return;
  }
  if(!url.pathname.startsWith('/platform-api/'))return send(404,{message:'Only local synthetic Platform API supported'});
  const path=url.pathname.slice('/platform-api'.length);
  let body={}; if(!['GET','HEAD'].includes(req.method)){let raw='';for await(const chunk of req)raw+=chunk;try{body=JSON.parse(raw||'{}');}catch{return send(400,{message:'JSON non valido'});}}
  if(path==='/auth/login'){
    if(body.email!=='qa@fleetum.example'||body.password!=='Fleetum-QA-local-2026!')return send(401,{message:'Credenziali sintetiche non valide'});
    if(!body.otp)return send(200,{requiresOtp:true,message:'Solo laboratorio locale: codice sintetico 123456, nessuna email inviata'});
    return body.otp==='123456'?send(200,{token:token()}):send(401,{message:'OTP sintetico non valido'});
  }
  if(mode==='unauthorized'||!req.headers.authorization?.startsWith('Bearer '))return send(401,{message:'Token platform non valido',code:'UNAUTHORIZED'});
  if(mode==='live-unavailable'&&path==='/metrics/dashboard-live')return send(404,{message:'Metriche live QA non disponibili'});
  if(mode==='read-error')return send(503,{message:'Servizio QA temporaneamente non disponibile'});
  if(req.method!=='GET'){
    if(mode==='action-error')return send(409,{message:'Operazione QA rifiutata: nessuna modifica applicata'});
    operations.push({method:req.method,path,body,at:stamp()});
    await new Promise(resolve=>setTimeout(resolve,650));
    if(path.endsWith('/license')){const tenant=tenants.find(t=>path.includes(`/${t.id}/`));tenant.license={...tenant.license,...body};return send(200,{after:tenant.license});}
    if(path.endsWith('/quick-action')){const tenant=tenants.find(t=>path.includes(`/${t.id}/`));if(body.action==='SUSPEND_LICENSE')tenant.license.status='SUSPENDED';if(body.action==='ACTIVATE_LICENSE')tenant.license.status='ACTIVE';if(body.action==='TRIAL_14_DAYS')tenant.license.status='TRIAL';if(body.action==='DEACTIVATE_TENANT')tenant.isActive=false;if(body.action==='REACTIVATE_TENANT')tenant.isActive=true;return send(200,{data:tenant});}
    if(path.endsWith('/invoices/generate'))return send(200,{data:invoice});
    if(path.includes('/demo-leads/')){lead={...lead,...body};return send(200,{data:lead});}
    if(path.includes('/trusted-devices/')){device={...device,status:'REVOKED',revokedAt:stamp()};return send(200,{revoked:true});}
    if(path.includes('/invoices/')){invoice={...invoice,...body};if(path.endsWith('/send-email'))invoice={...invoice,status:'SENT',sentAt:stamp(),deliveries:[{id:'qa-delivery',channel:'EMAIL',recipient:'fatture@fleetum.example',status:'SENT',createdAt:stamp(),sentAt:stamp()}]};return send(200,{data:invoice});}
    return send(400,{message:'Operazione sintetica non implementata'});
  }
  if(path.endsWith('/pdf')){res.writeHead(200,{'Content-Type':'application/pdf'});res.end('%PDF-1.4\n% Synthetic QA transport response, not a fiscal invoice\n%%EOF');return;}
  if(path.includes('/revenue')&&path.endsWith('.csv')){res.writeHead(200,{'Content-Type':'text/csv'});res.end('period,mrr\n2026-11,149\n');return;}
  const result=routes()[path];return result?send(200,result):send(404,{message:`Endpoint sintetico assente: ${path}`});
});
server.listen(5213,'127.0.0.1',()=>console.log('Synthetic API http://127.0.0.1:5213/qa'));
