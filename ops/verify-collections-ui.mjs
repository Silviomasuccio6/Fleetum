import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {readUiPreviewHealth} from './ui-preview-health.mjs';
const base=new URL(process.env.FLEETUM_COLLECTIONS_UI_URL??'http://127.0.0.1:5288');await readUiPreviewHealth(base.href);
const output=fileURLToPath(new URL('../output/playwright/collections-block3/',import.meta.url));await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true}),results=[],external=[],errors=[];
async function scenario(value='normal'){await fetch(new URL('/__ui/scenario',base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario:value})});}
async function screen(width=1440,theme='light',language='it',reader=false){
 await scenario();const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce',locale:language==='it'?'it-IT':'en-GB'}),page=await context.newPage();
 await page.addInitScript(({theme,language})=>{localStorage.setItem('fermi_theme_mode',theme);localStorage.setItem('fleetum-language',language)},{theme,language});
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==base.origin){external.push(url.origin);return route.abort();}
  if(reader&&url.pathname==='/api/auth/me'){const r=await route.fetch(),user=await r.json();return route.fulfill({response:r,json:{...user,permissions:['rental-payments:read','vehicles:read'],roles:['VIEWER']}})}return route.continue();
 });
 await page.goto(new URL('/pagamenti-garanzie',base).href);
 await page.locator('.fleetum-cookie-banner').waitFor();await page.locator('.fleetum-cookie-actions button').first().click();
 await page.locator('.collection-workspace .commerce-name:visible').first().waitFor();await page.evaluate(()=>document.fonts.ready);
 return{context,page};
}
async function check(name,fn){await fn();results.push({name,passed:true});console.log('PASS',name);}
async function fitting(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);const dialog=page.getByRole('dialog').last();if(await dialog.count())assert.equal(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);}
try{
 for(const width of [390,768,1440])for(const [theme,language]of [['light','it'],['dark','en']]){
  const{page,context}=await screen(width,theme,language);
  await check(`workspace-and-detail-${width}-${theme}-${language}`,async()=>{
   await fitting(page);await page.screenshot({path:`${output}/workspace-${width}-${theme}-${language}.png`,fullPage:true,animations:'disabled'});
   await page.locator('.collection-workspace .commerce-name:visible').first().click();const dialog=page.getByRole('dialog');await dialog.waitFor();
   await dialog.locator('.collection-ledger').waitFor();await fitting(page);
   assert.equal(await dialog.getByText(language==='it'?'Incasso manuale registrato':'Manual receipt recorded',{exact:true}).count(),1);
   assert.equal(await dialog.locator('.commerce-eyebrow').count(),0);assert.equal(await dialog.locator('.collection-price-source').count(),1);assert.match(await dialog.locator('.collection-price-source').innerText(),language==='it'?/Autore e motivo.*non registrati/:/author and reason.*not recorded/);
   assert.doesNotMatch(await dialog.innerText(),/NaN/);
   await page.screenshot({path:`${output}/detail-${width}-${theme}-${language}.png`,fullPage:false,animations:'disabled'});
   await dialog.getByRole('button',{name:language==='it'?'Chiudi':'Close',exact:true}).click();await dialog.waitFor({state:'detached'});
   await page.locator('#collection-state').selectOption('FREE');await page.locator('.collection-workspace .commerce-name:visible').first().click();await page.getByRole('dialog').locator('.collection-ledger').waitFor();
   assert.equal(await page.getByRole('dialog').locator('.collection-ledger li').count(),0);
   assert.ok((await page.getByRole('dialog').innerText()).includes(language==='it'?'nessun importo dovuto':'nothing due'));
  });await context.close();
 }
 await check('confirmed-manual-receipt-retries-same-key-without-double-submission',async()=>{
  const{page,context}=await screen();await page.locator('.collection-workspace .commerce-name:visible').first().click();await page.getByRole('button',{name:'Registra incasso',exact:true}).click();
  const form=page.locator('#collection-command'),submit=page.getByRole('button',{name:'Conferma registrazione',exact:true});assert.equal(await submit.isDisabled(),true);
  await form.locator('#collection-amount').fill('15,25');await form.locator('#collection-payment-method').selectOption('BANK_TRANSFER');await form.locator('#collection-reference').fill('QA-BANK-001');await form.locator('#collection-reason').fill('Bonifico sintetico già ricevuto');await form.locator('input[type=checkbox]').check();
  await page.locator('.commerce-drawer-content').last().evaluate(node=>node.scrollTop=0);
  await page.screenshot({path:`${output}/receipt-form-desktop.png`,fullPage:false,animations:'disabled'});
  const records=[];let attempts=0,completed=false;
  await page.route('**/api/rental-payments/bookings/*/collections',async route=>{
   if(route.request().method()!=='POST'){
    if(!completed)return route.continue();const response=await route.fetch(),value=await response.json();
    value.booking.receivedCents+=1525;value.booking.outstandingCents-=1525;
    value.entries.push({id:'synthetic-created-receipt',kind:'RECEIPT',method:'BANK_TRANSFER',amountCents:1525,currency:'EUR',occurredAt:records[1].body.occurredAt,reference:'QA-BANK-001',reason:'Bonifico sintetico già ricevuto',sourceId:null,createdAt:records[1].body.occurredAt,createdBy:{id:'demo-user',firstName:'Operatore',lastName:'Demo'}});
    return route.fulfill({response,json:value});
   }
   records.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']});attempts++;
   if(attempts===1)return route.abort('failed');
   await new Promise(resolve=>setTimeout(resolve,100));completed=true;return route.fulfill({status:201,json:{id:'synthetic-created-receipt',replayed:false}});
  });
  await submit.click();await form.locator('[role=alert]').waitFor();assert.match(await form.innerText(),/verificare|completata|connessione/i);assert.equal(records.length,1);assert.equal(await form.locator('#collection-amount').isDisabled(),true);
  await page.locator('.fleetum-notice-close').click();
  await submit.evaluate(button=>{button.click();button.click()});await form.waitFor({state:'detached'});
  await page.getByText('QA-BANK-001 · Bonifico sintetico già ricevuto',{exact:true}).waitFor();assert.match(await page.locator('.collection-detail-summary').innerText(),/65,25/);
  assert.equal(records.length,2);assert.equal(records[0].key,records[1].key);assert.equal(records[0].body.amountCents,1525);assert.equal(records[0].body.method,'BANK_TRANSFER');assert.ok(!('status'in records[0].body));
  await context.close();
 });
 await check('read-only-finance-user-has-no-receipt-refund-or-reversal-command',async()=>{
  const{page,context}=await screen(1440,'light','it',true);await page.locator('.collection-workspace .commerce-name:visible').first().click();await page.locator('.collection-ledger').waitFor();
  for(const name of ['Registra incasso','Registra rimborso','Storna registrazione'])assert.equal(await page.getByRole('button',{name,exact:true}).count(),0);
  await context.close();
 });
 await check('server-error-and-empty-states-remain-readable',async()=>{
  const{page,context}=await screen();await scenario('error');await page.getByRole('button',{name:'Aggiorna',exact:true}).click();await page.locator('.collection-workspace .commerce-empty [role=alert]').waitFor();await fitting(page);
  await scenario('empty');await page.getByRole('button',{name:'Riprova caricamento',exact:true}).click();await page.getByRole('heading',{name:'Nessuna pratica trovata'}).waitFor();await fitting(page);await context.close();
 });
 assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 await writeFile(`${output}/results.json`,JSON.stringify({scope:'Actual UI on synthetic read-only loopback preview. POST tests intercepted in the browser; no real provider or database writes.',results,external,errors},null,2));
 console.log(`Collections UI: ${results.length}/${results.length} passed.`);
}finally{await scenario();await browser.close()}
