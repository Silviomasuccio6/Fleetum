// Synthetic records for the loopback-only preview. Never imported by product code.
export function customerFixtures({customers,bookings,current,scenario,params,id,contracts=false}) {
 const count=scenario==='empty'?0:scenario==='many'?63:12;
 const all=Array.from({length:count},(_,i)=>{
  const base=customers[i%customers.length],company=i>=customers.length&&i%3===2;
  return {...base,id:i<customers.length?base.id:`qa-customer-${i+1}`,customerType:company?'PERSONA_GIURIDICA':'PERSONA_FISICA',
   firstName:scenario==='many'?'Persona sintetica con nome esteso':base.firstName,lastName:scenario==='many'?'Dimostrativa per verifica del testo lungo':base.lastName,
   companyName:company?'Azienda dimostrativa per mobilità e servizi internazionali Srl':undefined,companyVatNumber:company?'00000000000':undefined,
   email:`cliente${i+1}@fleetum-demo.invalid`,phone: i%2?'':'0000000000',nationalityCountry:'IT',nationality:'Italia',residenceCountry:'IT',
   birthCountry:'IT',placeOfBirth:'Comune di prova',residenceStreetAddress:'Via Fittizia 1',residenceAddress:'Via Fittizia 1 · Località dimostrativa',
   drivingLicenseNumber:company?'':`TEST${String(i+1).padStart(5,'0')}`,drivingLicenseExpiresAt:i%4?'2030-12-31T00:00:00Z':'2025-12-31T00:00:00Z',
   documentType:company?'':'Documento sintetico',documentNumber:company?'':`QA${i+1}`,notes:'Solo dati fittizi per il collaudo dell’interfaccia.',
   updatedAt:current.toISOString(),bookingsTotal:i===0?2:0,contractsTotal:i===0?2:0,attachmentsTotal:i===0?1:0,
   attachments:i===0?[{id:'qa-customer-document-1',fileName:'documento-sintetico-con-nome-lungo-per-verifica.png',mimeType:'image/png',sizeBytes:1024,createdAt:current.toISOString()}]:[],
   lastRentalAt:i===0?current.toISOString():null,lastRentalCode:i===0?'FL-1042':null,lastRentalStatus:i===0?'IN_RENT':null};
 });
 if(id){const c=all.find(x=>x.id===id);if(!c)return null;
  if(!contracts)return {...c,stats:{bookingsTotal:c.bookingsTotal,contractsTotal:c.contractsTotal,attachmentsTotal:c.attachmentsTotal}};
  let data=id===customers[0].id?Array.from({length:scenario==='many'?24:2},(_,i)=>({id:`qa-contract-${i+1}`,bookingId:bookings[0].id,status:i%2?'SIGNED':'READY',title:'Contratto dimostrativo',createdAt:current.toISOString(),updatedAt:current.toISOString(),signedAt:i%2?current.toISOString():null,booking:bookings[0]})):[];
  const status=params.get('status');if(status)data=data.filter(x=>x.status===status);
  const page=Number(params.get('page')||1),pageSize=Number(params.get('pageSize')||10);return {data:data.slice((page-1)*pageSize,page*pageSize),total:data.length,page,pageSize};
 }
 const q=(params.get('search')||'').toLowerCase(),type=params.get('customerType');
 const filtered=all.filter(c=>(!type||c.customerType===type)&&(!q||[c.firstName,c.lastName,c.companyName,c.companyVatNumber,c.email,c.phone,c.documentNumber,c.drivingLicenseNumber,c.taxCode].join(' ').toLowerCase().includes(q)));
 const page=Number(params.get('page')||1),pageSize=Number(params.get('pageSize')||20);return {data:filtered.slice((page-1)*pageSize,page*pageSize),total:filtered.length,page,pageSize};
}
