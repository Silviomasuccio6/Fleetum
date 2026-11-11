// Read-only synthetic data for B09. No providers, credentials or personal records.
export function administrationFixtures({path,scenario,current,user}) {
 const known = path === '/tenant/profile' || path === '/tenant/profile/completeness' || path === '/users' || path === '/users/roles' || path === '/auth/sessions' || path === '/billing/invoices' || path === '/notifications/inbox' || path.startsWith('/settings/');
 if (!known) return null;
 if (scenario === 'error' || (scenario === 'partial' && (path === '/settings/reports' || path === '/billing/invoices' || path === '/notifications/inbox'))) return {status:503,body:{message:'Sezione temporaneamente non disponibile nella prova locale.'}};
 const stamp = days => new Date(current.getTime() + days * 86400000).toISOString();
 const profile = {legalName:'Nordrive Mobilità SRL',tradeName:'Nordrive',legalForm:'SRL',vatNumber:'12345678903',taxCode:'12345678903',pec:'amministrazione@pec.fleetum-qa.invalid',sdiCode:'J5K8N2Q',rea:'MI-0000000',legalAddress:'Via della Mobilità 24',city:'Milano',province:'MI',postalCode:'20124',country:'IT',region:'Lombardia',phone:'+39 0200000000',email:'company@fleetum-qa.invalid',website:'https://example.invalid',adminFirstName:'Elena',adminLastName:'Demo',adminEmail:'amministrazione@example.invalid',adminPhone:'+39 0200000001',adminRole:'Amministrazione'};
 const company = {profile:scenario === 'empty' ? null : profile,branding:{logoFileName:null,primaryColor:'#21375d',accentColor:'#5d82c2',fontFamily:'helvetica'},legalSettings:{contractFooterText:'Nordrive Mobilità SRL — dati dimostrativi',defaultContractTerms:'Condizioni dimostrative per la revisione dell’interfaccia.',termsVersion:'demo',dpaVersion:'demo'},completeness:{percentage:scenario === 'empty' ? 0 : 94,completed:false,missing:scenario === 'empty' ? ['legalName','vatNumber','legalAddress','city','province','postalCode','email','phone','adminFirstName','adminLastName','adminEmail','logo'] : ['logo']}};
 let body;
 if (path === '/tenant/profile') body = company;
 if (path === '/tenant/profile/completeness') body = company.completeness;
 if (path === '/users/roles') body = {data:['ADMIN','MANAGER','OPERATOR','VIEWER']};
 if (path === '/users') body = {data:scenario === 'empty' ? [] : Array.from({length:scenario === 'many' ? 36 : 5},(_,i)=>({id:i === 0 ? user.id : 'demo-member-'+i,firstName:['Elena','Marco','Giulia','Paolo','Anna'][i%5],lastName:i === 0 ? 'Demo' : 'QA '+i,email:i === 0 ? user.email : `persona${i}@example.invalid`,roles:[['ADMIN','MANAGER','OPERATOR','VIEWER','OPERATOR'][i%5]],status:['ACTIVE','ACTIVE','ACTIVE','INVITED','SUSPENDED'][i%5]}))};
 if (path === '/auth/sessions') body = {data:scenario === 'empty' ? [] : [{id:'demo-session-1',userAgent:'Safari · macOS (dati demo)',ipAddress:'192.0.2.1',createdAt:stamp(-1),expiresAt:stamp(13),revokedAt:null},{id:'demo-session-2',userAgent:'Safari · iOS (dati demo)',ipAddress:'192.0.2.2',createdAt:stamp(-3),expiresAt:stamp(11),revokedAt:null}]};
 if (path === '/settings/sla') body = {LOW:15,MEDIUM:10,HIGH:5,CRITICAL:2};
 if (path === '/settings/playbooks') body = {WAITING_PARTS:{enabled:true,reminderEveryDays:3},SOLICITED:{enabled:true,reminderEveryDays:2}};
 if (path === '/settings/reports') body = {enabled:true,recipients:['report@example.invalid'],frequency:'weekly',hour:8,minute:0,reportStyle:'EXECUTIVE'};
 if (path === '/settings/integrations') body = {erpWebhookUrl:'',telematicsWebhookUrl:'',ticketingWebhookUrl:''};
 if (path === '/billing/invoices') body = {data:scenario === 'empty' ? [] : [{id:'demo-invoice-1',invoiceNumber:'DEMO-2026-001',issueDate:stamp(-30),dueDate:stamp(-30),periodStart:stamp(-30),periodEnd:stamp(0),status:'PAID',total:149,currency:'EUR'}]};
 if (path === '/notifications/inbox') body = {data:scenario === 'empty' ? [] : [{id:'demo-team-notification',type:'USER_INVITED',title:'Invito al team in attesa',description:'Un utente dimostrativo deve completare l’attivazione.',createdAt:stamp(-1)}]};
 return body ? {status:200,body} : null;
}
