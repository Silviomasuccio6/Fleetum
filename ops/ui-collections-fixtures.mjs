// Read-only, synthetic preview data. Financial writes remain disabled by ui-preview.
export function collectionPreviewRows(bookings){return bookings.map((b,i)=>({id:b.id,code:b.code,customerId:b.customer?.id??null,customerName:b.customerName,pickupAt:b.pickupAt,returnAt:b.returnAt,siteId:b.siteId??b.pickupSiteId??null,siteName:b.site?.name??b.pickupSite?.name??'Milano Centrale',plate:b.vehicle.plate,brand:b.vehicle.brand,model:b.vehicle.model,archived:false,agreedCents:i===1?0:8000,receivedCents:i===0?5000:0,outstandingCents:i===1?0:i===0?3000:8000,creditCents:0,authorizedGuaranteeCents:0,state:i===1?'FREE':i===0?'PARTIAL':'DUE'}));}
export function collectionPreviewDetail(row){return{booking:row,entries:row.receivedCents?[{id:'demo-collection-1',kind:'RECEIPT',method:'CASH',amountCents:5000,currency:'EUR',occurredAt:row.pickupAt,reference:'Ricevuta sintetica QA-001',reason:'Acconto fittizio per prova interfaccia',sourceId:null,createdAt:row.pickupAt,createdBy:{id:'demo-user',firstName:'Operatore',lastName:'Demo'}}]:[],pricing:{id:'demo-pricing-1',priceListName:'Listino dimostrativo',pricePackageName:null,unitRateAmount:'100.00',unit:'DAILY',discountPercent:20,recordedAt:row.pickupAt,discountProvenance:{status:'NOT_RECORDED',actor:null,reason:null}},onlineCollection:{enabled:false,reason:'MERCHANT_CONFIGURATION_REQUIRED'}};}
export function collectionsFixture({path,params,scenario,bookings}){
 if(path!=='/rental-payments/workspace'&&!/^\/rental-payments\/bookings\/[^/]+\/collections$/.test(path))return null;
 if(scenario==='error')return{status:503,body:{message:'Registro pagamenti temporaneamente non disponibile nella prova locale.'}};
 let rows=scenario==='empty'?[]:collectionPreviewRows(bookings);
 const detail=path.match(/^\/rental-payments\/bookings\/([^/]+)\/collections$/);
 if(detail){const row=rows.find(b=>b.id===detail[1]);return row?{status:200,body:collectionPreviewDetail(row)}:{status:404,body:{message:'Pratica non disponibile'}};}
 if(params.get('bookingId'))rows=rows.filter(b=>b.id===params.get('bookingId'));
 if(params.get('customerId'))rows=rows.filter(b=>b.customerId===params.get('customerId'));
 if(params.get('state'))rows=rows.filter(b=>b.state===params.get('state'));
 if(params.get('method'))rows=rows.filter(b=>b.receivedCents>0&&params.get('method')==='CASH');
 if(params.get('siteId'))rows=rows.filter(b=>b.siteId===params.get('siteId'));
 if(params.get('search'))rows=rows.filter(b=>[b.code,b.customerName,b.plate].join(' ').toLowerCase().includes(params.get('search').toLowerCase()));
 const page=Number(params.get('page')||1),pageSize=Number(params.get('pageSize')||20),summary={agreedCents:0,receivedCents:0,outstandingCents:0,creditCents:0,authorizedGuaranteeCents:0,unknownTotalCount:0};
 for(const row of rows)for(const key of Object.keys(summary))summary[key]+=row[key]??0;
 return{status:200,body:{data:rows.slice((page-1)*pageSize,page*pageSize),total:rows.length,page,pageSize,summary}};
}
