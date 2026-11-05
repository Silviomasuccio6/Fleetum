// Synthetic, read-only UI fixtures. Never used by the production API.
export function operationsFixtures({path,params,scenario,vehicles,sites,current}){
 const statuses=['OPEN','IN_PROGRESS','WAITING_PARTS','SOLICITED','CLOSED','CANCELED'];
 const workshop={id:'demo-workshop-1',name:'Officina Centro · QA',email:'officina@example.invalid',phone:''};
 const opened=(n,h=9)=>new Date(current.getFullYear(),current.getMonth(),current.getDate()+(n%5)-2,h,0).toISOString();
 const all=Array.from({length:scenario==='empty'?0:scenario==='many'?245:12},(_,i)=>{const vehicle=vehicles[i%vehicles.length],status=statuses[i%6];return{id:`demo-stoppage-${i+1}`,tenantId:'demo-tenant',vehicleId:vehicle.id,vehicle,siteId:vehicle.site?.id??sites[0].id,site:vehicle.site??sites[0],workshopId:workshop.id,workshop,status,priority:['LOW','MEDIUM','HIGH','CRITICAL'][i%4],openedAt:opened(i,9),closedAt:status==='CLOSED'||status==='CANCELED'?opened(i,12):null,reason:['Verifica impianto frenante','Sostituzione pneumatici','Manutenzione programmata','Controllo elettronica'][i%4],notes:'Nota operativa dimostrativa. Nessun dato reale.',assignedToUserId:'qa-operator',assignedToUser:{id:'qa-operator',firstName:'Operatore',lastName:'Demo'},estimatedCostPerDay:i===0?0:45,reminderAfterDays:3,photos:[],reminders:[],daysOpen:i+1}});
 const page=data=>{const number=Math.max(1,Number(params.get('page')||1)),size=Math.max(1,Number(params.get('pageSize')||20));return{data:data.slice((number-1)*size,number*size),total:data.length,page:number,pageSize:size}};
 const ok=body=>({status:200,body});
 const filtered=()=>all.filter(r=>(!params.get('status')||(params.get('status')==='OPEN_ACTIVE'?!['CLOSED','CANCELED'].includes(r.status):r.status===params.get('status')))&&(!params.get('siteId')||r.siteId===params.get('siteId'))&&(!params.get('workshopId')||r.workshopId===params.get('workshopId'))&&(!params.get('search')||`${r.vehicle.plate} ${r.reason} ${r.site.name} ${r.workshop.name}`.toLowerCase().includes(params.get('search').toLowerCase())));
 if(path==='/master-data/workshops')return ok({data:[workshop],total:1});
 if(path==='/users')return ok({data:[{id:'qa-operator',firstName:'Operatore',lastName:'Demo'}]});
 const relevant=path.startsWith('/stoppages')||path.startsWith('/master-data/vehicle-maintenances')||path==='/master-data/vehicle-deadlines';
 if(!relevant)return null;
 if(scenario==='error')return{status:503,body:{message:'Dati operativi temporaneamente non disponibili nella prova locale.'}};
 if(scenario==='partial'&&(path.includes('parts-orders')||path.includes('cost-approvals')))return{status:503,body:{message:'Sezione temporaneamente non disponibile nella prova locale.'}};
 if(path==='/stoppages')return ok(page(filtered()));
 if(path==='/stoppages/alerts/list')return ok({data:all.filter(r=>r.priority==='CRITICAL').map(r=>({id:r.id,plate:r.vehicle.plate,site:r.site.name,workshop:r.workshop.name,daysOpen:r.daysOpen,message:'Intervento prioritario da verificare'}))});
 if(path==='/stoppages/calendar')return ok({data:all.map((r,i)=>({id:r.id,title:r.vehicle.plate+' · '+r.reason,start:opened(i,9),end:opened(i,11),status:r.status,priority:r.priority,site:r.site.name,workshop:r.workshop.name})).filter(r=>(!params.get('dateFrom')||r.start>=params.get('dateFrom'))&&(!params.get('dateTo')||r.start<=params.get('dateTo')))});
 if(path==='/stoppages/calendar/custom')return ok({data:scenario==='empty'?[]:[{id:'qa-calendar-1',title:'Consegna ricambi · QA',description:'Evento sintetico, indipendente dai filtri dei fermi.',start:opened(2,14),end:opened(2,15),allDay:false,calendarId:'work',location:'Officina Centro',color:'#3158c8'}]});
 if(path==='/stoppages/costs/variance')return ok({data:all.map(r=>({stoppageId:r.id,estimated:180,actual:150,variance:-30,varianceRate:-16.67}))});
 if(path==='/stoppages/sla/escalations')return ok({data:[],kpis:{}});
 const detail=path.match(/^\/stoppages\/(demo-stoppage-\d+)(?:\/(.+))?$/);
 if(detail){const item=all.find(r=>r.id===detail[1]);if(!item)return{status:404,body:{message:'Fermo non trovato nella prova locale.'}};if(!detail[2])return ok(item);if(detail[2]==='reminders/whatsapp-link')return{status:501,body:{message:'Anteprima UI: collegamenti e invii WhatsApp disattivati.'}};if(detail[2]==='cost-approvals')return ok({requests:[],decisions:[]});if(detail[2]==='reminders/template-preview')return ok({email:{subject:'Promemoria intervento · QA',body:'Testo sintetico, nessun invio reale.'},whatsapp:{message:'Promemoria di prova.'}});return ok({data:detail[2]==='events'?[{id:'qa-event-1',createdAt:item.openedAt,type:'CREATED',message:'Fermo registrato nel laboratorio sintetico'}]:[]})}
 if(path==='/master-data/vehicle-maintenances'){
  let records=all.map((r,i)=>({id:'demo-maintenance-'+(i+1),vehicleId:r.vehicleId,vehicle:r.vehicle,performedAt:opened(i),maintenanceType:['Tagliando','Pneumatici','Freni'][i%3],description:'Intervento dimostrativo sul veicolo',workshopName:workshop.name,kmAtService:12000+i*1000,cost:i===0?0:180+i*10,attachments:[]}));
  const search=(params.get('search')||'').toLowerCase();records=records.filter(r=>(!params.get('vehicleId')||r.vehicleId===params.get('vehicleId'))&&(!search||`${r.vehicle.plate} ${r.maintenanceType} ${r.workshopName}`.toLowerCase().includes(search)));return ok(page(records));
 }
 if(path==='/master-data/vehicle-deadlines'){
  const data=scenario==='empty'?[]:vehicles.slice(0,6).map((v,i)=>({vehicleId:v.id,plate:v.plate,brand:v.brand,model:v.model,siteName:v.site?.name,currentKm:v.currentKm,maintenanceIntervalKm:15000,remainingKm:i===0?-250:500+i*500,lastRevisionAt:'2024-10-01T10:00:00.000Z',revisionDueAt:opened(i),daysToRevision:i-2,dueByKm:i===0,dueSoonByKm:i===1,dueByRevision:i===0,dueSoonByRevision:i===1,status:i===0?'SCADUTA':i<4?'IN_SCADENZA':'OK',severity:i===0?'CRITICAL':i<3?'HIGH':'LOW',actions:i===0?['Programmare manutenzione','Verificare revisione']:['Controllare il prossimo intervento']}));
  return ok({data,kpis:{total:data.filter(r=>r.status!=='OK').length,dueNowKm:data.length?1:0,dueSoonKm:data.length?1:0,dueNowRevision:data.length?1:0,dueSoonRevision:data.length?1:0,critical:data.length?1:0}});
 }
 return null;
}
