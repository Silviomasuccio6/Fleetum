// Local synthetic laboratory only. This is not the product authorization layer.
const assignments=new Map(),revisions=new Map();
export function sitePreviewContext(user,sites,scenario){
 const all=user.roles.some(r=>r==='ADMIN'||r==='MANAGER');
 const id=Object.hasOwn(user,'assignedSiteId')?user.assignedSiteId:assignments.has(user.id)?assignments.get(user.id):all?null:sites[0]?.id;
 const assigned=sites.find(s=>s.id===id),inactive=scenario==='site-inactive';
 return{tenantId:user.tenantId,userId:user.id,revision:`ui-sites-${revisions.get(user.id)??0}-${scenario}`,enforced:scenario!=='site-pending',canViewAllSites:all,canAssignSites:user.roles.includes('ADMIN'),assignedSite:assigned?{id:assigned.id,name:assigned.name,isActive:!inactive}:null,sites:(all?sites:assigned&&!inactive?[assigned]:[]).map(s=>({id:s.id,name:s.name}))};
}
export async function sitePreviewRequest(req,path,user,sites,scenario){
 const context=sitePreviewContext(user,sites,scenario);
 if(path==='/auth/site-access'&&req.method==='GET')return{status:200,body:{data:context}};
 const match=path.match(/^\/users\/(demo-(?:user|member-\d+))\/site$/);
 if(match&&req.method==='PATCH'){
  if(req.headers.origin&&req.headers.origin!=='http://127.0.0.1:5180')return{status:403,body:{message:'Solo anteprima locale.'}};
  if(!context.canAssignSites||(req.headers['x-fleetum-site']&&req.headers['x-fleetum-site']!=='all'))return{status:403,body:{message:'Operazione aziendale non disponibile nella vista corrente.'}};
  let raw='';for await(const part of req){raw+=part;if(raw.length>1024)return{status:413,body:{}};}
  let body;try{body=JSON.parse(raw);}catch{return{status:400,body:{}};}
  if(Object.keys(body).some(k=>k!=='siteId')||!(body.siteId===null||sites.some(s=>s.id===body.siteId)))return{status:422,body:{message:'Sede non valida.'}};
  assignments.set(match[1],body.siteId);revisions.set(match[1],(revisions.get(match[1])??0)+1);return{status:200,body:{data:{userId:match[1],assignedSiteId:body.siteId}}};
 }
 return null;
}
export function sitePreviewScope(req,path,user,sites,scenario,bookings){
 const context=sitePreviewContext(user,sites,scenario),requested=context.enforced?String(req.headers['x-fleetum-site']??'all'):'all';
 const view=context.canViewAllSites?requested:context.sites[0]?.id??'none';
 if(!context.canViewAllSites&&requested!=='all'&&requested!==view)return{path,view:'none',revision:context.revision,denied:true};
 const detail=path.match(/\/(demo-booking-\d+)(?:\/|$)/);
 const booking=detail&&bookings.find(b=>b.id===detail[1]);
 return{path,view,revision:context.revision,actor:{id:user.id,roles:user.roles,siteId:context.assignedSite?.id??null},denied:view!=='all'&&(!sites.some(s=>s.id===view)||(booking&&booking.vehicle.site.id!==view))};
}
export function sitePreviewResponse(scope,status,body,sites){
 if(!scope||status!==200)return{status,body};
 const {view,path}=scope;
 if(path==='/users'&&Array.isArray(body?.data)){
  const members=body.data.map((u,i)=>{const self=scope.actor?.id===u.id;const id=self?scope.actor.siteId:assignments.has(u.id)?assignments.get(u.id):sites[i%sites.length]?.id;const site=sites.find(s=>s.id===id);return{...u,...(self?{roles:scope.actor.roles}:{}),assignedSite:site?{id:site.id,name:site.name,isActive:true}:null};});
  return{status,body:{...body,data:view==='all'?members:members.filter(u=>u.roles.some(r=>r==='ADMIN'||r==='MANAGER')||u.assignedSite?.id===view)}};
 }
 if(path==='/settings/reports'&&view==='all'&&body?.enabled)return{status,body:{...body,siteConfirmationRequired:true}};
 if(view==='all'||path.startsWith('/auth/')||path==='/health')return{status,body};
 if(scope.denied)return{status:404,body:{message:'Risorsa non disponibile nella sede scelta.'}};
 if(path==='/rental-payments/workspace')return{status,body}; // Already scoped before fixture aggregation.
 if(path==='/notifications/inbox')return{status,body:{data:[]}};
 if(path==='/master-data/sites')return{status,body:{data:sites.filter(s=>s.id===view),total:1,page:1,pageSize:200}};
 if(path==='/users/roles'||path==='/settings/sla'||path==='/settings/playbooks'||path==='/master-data/workshops'||path.includes('suggest/customers'))return{status,body};
 if(path==='/master-data/vehicles'||path==='/rental-bookings/suggest/vehicles'){
  const data=body.data.filter(v=>v.site?.id===view||v.siteId===view);return{status,body:{...body,data,total:data.length}};
 }
 if(path==='/rental-bookings/availability/month'){
  const data=body.data.filter(row=>row.vehicle.site.id===view),booked=data.filter(row=>row.hasBookings).length;
  return{status,body:{...body,siteId:view,data,summary:{totalVehicles:data.length,bookedVehicles:booked,availableVehicles:data.length-booked,occupancyRate:data.length?Math.round(booked/data.length*100):0}}};
 }
 if(/\/(demo-booking-\d+)(?:\/|$)/.test(path))return{status,body};
 // Avoid displaying an unfiltered company fixture under a selected branch.
 // Other screens keep their previous full-company preview until integration.
 return{status:409,body:{message:'Questa anteprima multisede copre Prenotazioni, Flotta e Utenti. Per le altre schermate scegli Tutte le sedi.'}};
}
