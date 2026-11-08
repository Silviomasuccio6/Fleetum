import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {readUiPreviewHealth} from './ui-preview-health.mjs';
const base=new URL(process.env.FLEETUM_CONTRACT_UI_URL??'http://127.0.0.1:5289');await readUiPreviewHealth(base.href);
const output=new URL('../output/playwright/contracts-block4/',import.meta.url);await mkdir(output,{recursive:true});
const source=await fetch(new URL('/api/rental-bookings/demo-booking-2/contract/pdf',base));assert.equal(source.ok,true);
const pdf=Buffer.from(await source.arrayBuffer()),documentSha256=crypto.createHash('sha256').update(pdf).digest('hex');
const browser=await chromium.launch({headless:true}),results=[],errors=[],external=[];
const review={contractId:'demo-contract-demo-booking-2',documentRevision:0,issuedAt:null,legacySigned:false,customer:'Giulia Conti (dati sintetici)',bookingCode:'FL-1043',vehicle:'QA102AA',pickupAt:'2030-11-15T09:00:00Z',returnAt:'2030-11-18T09:00:00Z',pickupLocation:'Roma (sintetica)',returnLocation:'Milano (sintetica)',readinessIssues:[],priceAgreement:null,reviewHash:'a'.repeat(64),balance:{agreedCents:8000,receivedCents:5000,outstandingCents:3000,creditCents:0,state:'PARTIAL'}};
let activePage;
const capture=async(page,element,name)=>{
 for(const button of await page.getByRole('button',{name:/^(Chiudi notifica|Dismiss notification)$/}).all())if(await button.isEnabled())await button.click();
 await page.clock.runFor(250);
 await element.evaluate(el=>{const target=el.getClientRects().length?el:el.firstElementChild;if(!target)throw new Error('Capture target has no rendered child');const previous=target.style.scrollMarginTop;target.style.scrollMarginTop='140px';target.scrollIntoView({block:'start',behavior:'instant'});target.style.scrollMarginTop=previous;});
 await page.clock.runFor(50);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:new URL(name,output).pathname});
};
async function screen(width,theme,mode='normal',language='it'){
 let current=structuredClone(review),request=null,history=[],conversions=0,confirmations=0,unavailable=mode==='failure';
 if(mode==='initial-signed'){current.issuedAt=new Date().toISOString();request={id:'synthetic-signed-request',version:1,method:'IN_PERSON',status:'SIGNED',documentSha256,documentTitle:'Documento sintetico Fleetum',signerName:'Giulia Conti (sintetica)',expiresAt:'2030-11-20T10:00:00Z',signedAt:new Date().toISOString(),maskedEmail:null};history=[request];}
 const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),page=await context.newPage();activePage=page;
 await page.clock.install();await page.addInitScript(({theme,language})=>{localStorage.setItem('fermi_theme_mode',theme);localStorage.setItem('fleetum-language',language)},{theme,language});page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',async route=>{const url=new URL(route.request().url()),path=url.pathname;if(url.origin!==base.origin){external.push(url.origin);return route.abort();}
  const reply=opts=>route.fulfill({...opts,headers:{...opts.headers,'X-Fleetum-Site-Revision':route.request().headers()['x-fleetum-site-revision']??'','X-Fleetum-Site-View':route.request().headers()['x-fleetum-site']??'all'}});
  if(mode==='readonly'&&path==='/api/auth/me'){const response=await route.fetch();return route.fulfill({response,json:{...await response.json(),roles:['VIEWER'],permissions:['vehicles:read']}});}
  if(path.endsWith('/contract/rental-details')){const response=await route.fetch();return reply({json:{...await response.json(),frozen:request?.status==='SIGNED'||request?.status==='PENDING'}});}
  if(/\/rental-bookings\/demo-booking-2\/contract$/.test(path)){const response=await route.fetch();return reply({json:{...await response.json(),documentRevision:current.documentRevision,issuedAt:current.issuedAt,status:request?.status==='SIGNED'?'SIGNED':'DRAFT',signedAt:request?.signedAt??null}});}
  if(path.endsWith('/contract/conversion'))return unavailable?reply({status:503,json:{message:'Riepilogo temporaneamente non disponibile (prova sintetica)'}}):reply({json:current});
  if(path.endsWith('/contract/convert')){conversions++;current={...current,issuedAt:new Date().toISOString()};return reply({status:201,json:current});}
  if(path.endsWith('/contract/agreed-price')){const body=route.request().postDataJSON();current={...current,priceAgreement:{...body,agreedCents:body.listCents-body.discountCents,actorUserId:'demo-user',recordedAt:new Date().toISOString()}};return reply({json:current});}
  if(path.endsWith('/contract/signing'))return reply({json:{configured:true,emailConfigured:true,issuedAt:current.issuedAt,documentRevision:current.documentRevision,recipient:'signer@example.invalid',request,history}});
  if(path.endsWith('/signing/in-person')){request={id:'synthetic-signing-request',version:1,method:'IN_PERSON',status:'PENDING',documentSha256,documentTitle:'Documento sintetico Fleetum',signerName:'Giulia Conti (sintetica)',expiresAt:'2030-11-20T10:00:00Z',signedAt:null,maskedEmail:null};return reply({status:202,json:request});}
  if(path.endsWith('/signing/in-person/document'))return reply({body:pdf,headers:{'Content-Type':'application/pdf'}});
  if(path.endsWith('/signing/in-person/confirm')){confirmations++;const body=route.request().postDataJSON();assert.equal(body.documentHash,documentSha256);assert.equal(body.consent,true);assert.equal(body.consentVersion,'in-person-v1');assert.match(body.signatureDataUrl,/^data:image\/png;base64,/);request={...request,status:'SIGNED',signedAt:new Date().toISOString()};history=[request];return reply({json:request});}
  if(path.endsWith('/contract/revision')){current={...current,documentRevision:1,issuedAt:null};request=null;return reply({json:{duplicate:false}});}
  return route.continue();
 });
 await page.goto(new URL('/booking?bookingId=demo-booking-2',base).href);await page.locator('.fleetum-cookie-banner').waitFor();await page.locator('.fleetum-cookie-actions button').first().click();
 const section=page.locator('details.booking-detail-section').filter({has:page.getByRole('heading',{name:language==='it'?'Contratto':'Contract',exact:true})});await section.locator(':scope > summary').focus();await page.keyboard.press('Enter');
 if(mode==='failure'){await page.getByText('Riepilogo temporaneamente non disponibile (prova sintetica)',{exact:true}).waitFor();unavailable=false;await page.getByRole('button',{name:'Rileggi riepilogo'}).click();}
 const convertName=language==='it'?'Conferma e trasforma in contratto':'Confirm and create contract';
 if(mode==='initial-signed'){
  await page.getByRole('button',{name:'Prepara nuova revisione',exact:true}).waitFor();assert.equal(await page.getByLabel('Conducente principale',{exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Prepara nuova revisione',exact:true}).click();await page.getByRole('button',{name:convertName,exact:true}).waitFor();
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('select')).find(el=>document.querySelector(`label[for="${el.id}"]`)?.textContent==='Conducente principale')?.disabled);
  assert.equal(await page.getByLabel('Conducente principale',{exact:true}).isEnabled(),true);await capture(page,page.locator('[aria-label="Trasformazione in contratto"]'),'revision-initially-signed.png');results.push({width,theme,mode,language,passed:true});console.log('PASS',width,theme,mode,language);await context.close();return;
 }
 await page.getByRole('button',{name:convertName,exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
 if(mode==='readonly'){assert.equal(await page.getByRole('button',{name:'Concorda prezzo e sconto'}).count(),0);assert.equal(await page.getByRole('button',{name:convertName,exact:true}).isDisabled(),true);}
 else if(language==='it'){
  const fuel=page.getByLabel('Carburante e ricarica',{exact:true}),savedFuel=await fuel.inputValue(),title=page.getByLabel('Titolo contratto',{exact:true}),savedTitle=await title.inputValue();await title.fill('Bozza titolo non salvata');await fuel.fill('Condizione sintetica ancora non salvata');
  await page.getByRole('button',{name:'Concorda prezzo e sconto'}).click();await page.getByLabel('Prezzo prima dello sconto (€)').fill('100');await page.getByLabel('Sconto (€)',{exact:true}).fill('20');await page.getByLabel('Motivazione',{exact:true}).fill('Accordo sintetico QA');await page.getByRole('button',{name:'Salva prezzo concordato',exact:true}).click();await page.getByRole('button',{name:convertName,exact:true}).waitFor();await page.clock.fastForward(4500);assert.equal(await fuel.inputValue(),'Condizione sintetica ancora non salvata');assert.equal(await title.inputValue(),'Bozza titolo non salvata');assert.equal(await page.getByRole('button',{name:convertName,exact:true}).isDisabled(),true);await fuel.fill(savedFuel);await title.fill(savedTitle);
 }
 const panel=page.locator('[aria-label="Trasformazione in contratto"]');assert.equal(await panel.getByText('Giulia Conti (dati sintetici) · QA102AA · FL-1043',{exact:true}).isVisible(),true);for(const amount of ['80,00 €','50,00 €','30,00 €'])assert.equal(await panel.locator('dd').filter({hasText:amount}).isVisible(),true);await capture(page,panel,`review-${width}-${theme}-${mode}-${language}.png`);
 if(mode==='normal'&&language==='it'&&theme==='light')await capture(page,panel,width===1440?'desktop.png':width===390?'mobile.png':`tablet.png`);
 if(mode==='normal'&&language==='it'){
  await page.getByRole('button',{name:convertName}).click();await page.getByRole('heading',{name:'Contratto emesso',exact:true}).waitFor();assert.equal(conversions,1);await page.getByRole('heading',{name:'Trasmetti contratto a CARGOS',exact:true}).waitFor();
  if(theme==='light'&&width!==768){
   await page.getByRole('dialog').last().getByRole('button',{name:'Chiudi',exact:true}).last().click();await page.getByRole('button',{name:'Prepara firma in loco',exact:true}).click();
   const canvas=page.locator('#contract-presence-signature');await canvas.waitFor();await page.locator('.signing-pdf-page canvas').first().waitFor();await capture(page,page.locator('.signing-pdf-reader'),`document-${width}.png`);
   await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();assert.ok(box);await page.mouse.move(box.x+20,box.y+box.height*.7);await page.mouse.down();await page.mouse.move(box.x+box.width*.3,box.y+box.height*.2,{steps:8});await page.mouse.move(box.x+box.width*.7,box.y+box.height*.6,{steps:8});await page.mouse.up();
   const confirm=page.getByRole('button',{name:'Conferma firma del cliente',exact:true});assert.equal(await confirm.isDisabled(),true);await page.getByLabel('Ho letto il documento mostrato e confermo di sottoscriverlo con la firma qui acquisita.',{exact:true}).check();await capture(page,page.getByText('Firma del cliente',{exact:true}),`in-person-${width}.png`);await confirm.click();await page.getByRole('button',{name:'Scarica versione 1',exact:true}).waitFor();assert.equal(confirmations,1);
   await page.getByRole('button',{name:'Prepara nuova revisione',exact:true}).click();await page.getByRole('button',{name:convertName,exact:true}).waitFor();await page.getByRole('button',{name:'Scarica versione 1',exact:true}).waitFor();await capture(page,page.locator('[aria-label="Trasformazione in contratto"]'),`revision-${width}.png`);
  }
 }
 results.push({width,theme,mode,language,passed:true});console.log('PASS',width,theme,mode,language);await context.close();
}
try{for(const width of [390,768,1440])for(const theme of ['light','dark'])await screen(width,theme);await screen(390,'dark','readonly');await screen(1440,'light','failure');await screen(1440,'dark','normal','en');await screen(1440,'light','initial-signed');assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await writeFile(new URL('results.json',output),JSON.stringify({results,errors,external},null,2));}
catch(error){if(activePage)await activePage.screenshot({path:new URL('failure.png',output).pathname});console.error('UI errors',errors);throw error;}finally{await browser.close();}
