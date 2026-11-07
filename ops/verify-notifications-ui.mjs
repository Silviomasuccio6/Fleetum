import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {readUiPreviewHealth} from './ui-preview-health.mjs';
const base=new URL(process.env.FLEETUM_NOTIFICATIONS_UI_URL??'http://127.0.0.1:5180');
await readUiPreviewHealth(base.href);
const output=fileURLToPath(new URL('../output/playwright/notifications-block2/',import.meta.url));await mkdir(output,{recursive:true});
const fixture=fileURLToPath(new URL('./fixtures/notifications-ui.jsx',import.meta.url));
const browser=await chromium.launch({headless:true}),results=[],external=[],pageErrors=[];
async function screen(width=1440,theme='light',language='it',fallback=process.env.FLEETUM_NOTIFICATION_FORCE_FALLBACK==='1'){
 const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width<500,reducedMotion:'reduce',locale:language==='it'?'it-IT':'en-GB'}),page=await context.newPage();
 await page.clock.install();
 page.on('pageerror',error=>{pageErrors.push(error.message);console.log('PAGEERROR',error.message)});
 await page.addInitScript(({theme,language,fallback})=>{
  localStorage.setItem('fermi_theme_mode',theme);localStorage.setItem('fleetum-language',language);
  if(fallback)Object.defineProperty(HTMLElement.prototype,'showPopover',{configurable:true,value:undefined});
 },{theme,language,fallback});
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!==base.origin){external.push(url.origin);return route.abort();}
  if(url.pathname==='/__notification_qa.html')return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${language}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;await import(${JSON.stringify('/@fs'+fixture)});</script></body></html>`});
  if(url.pathname==='/api/__notification_qa/fail')return route.fulfill({status:503,json:{error:'SYNTHETIC_OUTCOME_UNCERTAIN',message:'Esito non confermato. Verifica lo stato della pratica.'}});
  if(url.pathname.startsWith('/api/'))throw Error(`Unexpected fixture API request: ${url.pathname}`);
  return route.continue();
 });
 await page.goto(new URL('/__notification_qa.html',base).href);
 await page.waitForFunction(()=>window.fleetumNoticeQa?.ready&&window.fleetumNoticeQa.state().context!=='initial');
 await page.clock.runFor(100);
 return {context,page};
}
async function check(name,run){await run();results.push({name,passed:true});console.log('PASS',name)}
async function push(page,tone,message='Prenotazione aggiornata.'){
 await page.evaluate(({tone,message})=>window.fleetumNoticeQa.push(tone,message),{tone,message});
 await page.clock.runFor(32);
 await page.locator('.fleetum-notice').waitFor({state:'visible'});
}
async function position(page){
 const card=await page.locator('.fleetum-notice').first().boundingBox();assert.ok(card);
 const width=page.viewportSize().width;assert.ok(card.x>=0&&width-card.x-card.width>=8&&width-card.x-card.width<=28,JSON.stringify(card));
 assert.ok(card.y>=64&&card.y<180,JSON.stringify(card));
 assert.equal(await page.locator('.fleetum-notice').first().evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);
 const reachable=await page.locator('.fleetum-notice-close').first().evaluate(node=>{const r=node.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('.fleetum-notice-close')===node});
 assert.equal(reachable,true,'The close control is painted and reachable, including over a transformed dialog');
}
try{
 for(const width of [320,390,768,1440])for(const [theme,language]of [['light','it'],['dark','en']]){
  const {page,context}=await screen(width,theme,language);
  await check(`all-five-tones-${width}-${theme}-${language}`,async()=>{
   for(const [tone,lifetime]of [['success',3000],['info',4000],['warning',6000],['error',8000],['loading',10000]]){
    await push(page,tone);assert.equal(await page.locator('.fleetum-notice--compact').count(),1);await position(page);
    assert.equal(await page.locator('.fleetum-notice').getAttribute('role'),tone==='error'?'alert':'status');
    if(tone==='error')await page.locator('.fleetum-notice').screenshot({path:`${output}/error-${width}-${theme}-${language}.png`,animations:'disabled'});
    await page.clock.runFor(lifetime+150);assert.equal(await page.locator('.fleetum-notice').count(),0);
   }
  });
  await check(`long-copy-and-action-${width}-${theme}-${language}`,async()=>{
   await page.evaluate(()=>window.fleetumNoticeQa.push('warning','Verifica richiesta. '+ 'Dettaglio sintetico completo. '.repeat(8),{description:'Il popup si chiude; lo stato della pratica resta consultabile.',action:{label:'Apri dettaglio',run:()=>{document.body.dataset.qaAction='done'}}}));
   await page.locator('.fleetum-notice').waitFor({state:'visible'});await position(page);
   assert.equal(await page.locator('.fleetum-notice--expanded').count(),1);
   await page.locator('.fleetum-notice-action').click();assert.equal(await page.locator('body').getAttribute('data-qa-action'),'done');
   await page.locator('#outside-focus').focus();await page.mouse.move(0,0);
   await page.clock.runFor(6150);assert.equal(await page.locator('.fleetum-notice').count(),0);
  });
  await context.close();
 }
 for(const fallback of [false,true]){
  const {page,context}=await screen(1440,'light','it',fallback);
  await check(`transformed-dialog-focus-and-return-${fallback?'fallback':'native'}`,async()=>{
   await push(page,'info');const id=await page.evaluate(()=>window.fleetumNoticeQa.state().items[0].id);
   await page.clock.runFor(1000);await page.evaluate(()=>window.fleetumNoticeQa.open());
   const dialog=page.getByRole('dialog',{name:'Verifica notifiche'});await dialog.waitFor();await page.clock.runFor(50);await position(page);
   assert.equal(await dialog.locator('.fleetum-notices').count(),1);assert.equal(await page.evaluate(()=>window.fleetumNoticeQa.state().items[0].id),id);
   await page.locator('#qa-name').focus();await page.evaluate(()=>window.fleetumNoticeQa.push('error','Errore sintetico in finestra'));
   assert.equal(await page.locator('#qa-name').evaluate(node=>node===document.activeElement),true);
   let reached=false;for(let i=0;i<8;i++){await page.keyboard.press('Tab');const active=await page.evaluate(()=>({inDialog:!!document.activeElement?.closest('[role="dialog"]'),notice:!!document.activeElement?.closest('.fleetum-notices')}));assert.equal(active.inDialog,true);reached||=active.notice;}
   assert.equal(reached,true,'Notification controls participate in the real dialog focus trap');
   await page.locator('.fleetum-notices').screenshot({path:`${output}/dialog-${fallback?'fallback':'native'}.png`,animations:'disabled'});
   await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});await position(page);
   await page.locator('#outside-focus').focus();await page.mouse.move(0,0);await page.clock.runFor(9000);assert.equal(await page.locator('.fleetum-notice').count(),0);
  });await context.close();
 }
 const {page,context}=await screen();
 await check('hover-focus-and-hidden-tab-preserve-remaining-time',async()=>{
  await push(page,'success');await page.clock.runFor(1000);await page.locator('.fleetum-notice').hover();await page.clock.runFor(5000);assert.equal(await page.locator('.fleetum-notice').count(),1);
  await page.locator('.fleetum-notice-close').focus();await page.mouse.move(0,0);await page.clock.runFor(5000);assert.equal(await page.locator('.fleetum-notice').count(),1);
  await page.locator('#outside-focus').focus();await page.clock.runFor(1800);assert.equal(await page.locator('.fleetum-notice').count(),1);await page.clock.runFor(350);assert.equal(await page.locator('.fleetum-notice').count(),0);
  await push(page,'info');await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))});
  await page.clock.runFor(60000);assert.equal(await page.locator('.fleetum-notice').count(),1);
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))});await page.clock.runFor(4150);assert.equal(await page.locator('.fleetum-notice').count(),0);
 });
 await check('loading-popup-ends-without-ending-the-underlying-operation',async()=>{
  await page.evaluate(()=>window.fleetumNoticeQa.start());await page.locator('[data-qa-busy]').waitFor();await page.clock.runFor(10150);
  assert.equal(await page.locator('.fleetum-notice').count(),0);assert.equal(await page.locator('[data-qa-busy]').count(),1);
  await page.evaluate(()=>window.fleetumNoticeQa.finish());await page.locator('.fleetum-notice--success').waitFor();assert.equal(await page.locator('[data-qa-busy]').count(),0);await page.clock.runFor(3150);
 });
 await check('HTTP-error-remains-inline-after-one-compact-popup-expires',async()=>{
  await page.getByRole('button',{name:'Simula esito incerto',exact:true}).click();await page.locator('[data-qa-issue]').waitFor();await page.locator('.fleetum-notice').waitFor();
  assert.equal(await page.locator('.fleetum-notice').count(),1);assert.equal(await page.locator('.fleetum-notice').getAttribute('aria-live'),'off');
  await page.clock.runFor(8150);assert.equal(await page.locator('.fleetum-notice').count(),0);assert.match(await page.locator('[data-qa-issue]').innerText(),/Verifica lo stato/);
 });
 await check('saved-confirmation-survives-query-detail-navigation-with-its-remaining-time',async()=>{
  await page.evaluate(()=>window.fleetumNoticeQa.confirm('Cliente creato correttamente.'));
  await page.locator('.fleetum-notice--success').waitFor();await page.clock.runFor(32);
  const id=await page.evaluate(()=>window.fleetumNoticeQa.state().items[0].id);
  await page.clock.runFor(1000);await page.evaluate(()=>window.fleetumNoticeQa.navigate('/__notification_qa.html?customerId=synthetic-1'));
  await page.waitForURL('**?customerId=synthetic-1');
  assert.equal(await page.evaluate(()=>window.fleetumNoticeQa.state().items[0].id),id);
  assert.equal(await page.locator('.fleetum-notice').count(),1);assert.equal(await page.locator('.fleetum-notice').getAttribute('aria-live'),'off');
  await page.clock.runFor(2150);assert.equal(await page.locator('.fleetum-notice').count(),0);
  assert.equal(await page.locator('[data-qa-feedback]').innerText(),'Cliente creato correttamente.');
 });
 await check('queued-confirmation-is-info-and-does-not-claim-delivery',async()=>{
  await page.evaluate(()=>window.fleetumNoticeQa.confirm('Invio email contratto accodato.','info'));
  await page.locator('.fleetum-notice--info').waitFor();await page.clock.runFor(32);
  assert.equal(await page.locator('.fleetum-notice').count(),1);assert.match(await page.locator('.fleetum-notice').innerText(),/accodato/);
  await page.clock.runFor(4150);assert.equal(await page.locator('.fleetum-notice').count(),0);
  assert.equal(await page.locator('[data-qa-feedback]').innerText(),'Invio email contratto accodato.');
 });
 await check('route-return-site-tenant-and-platform-contexts-reject-old-outcomes',async()=>{
  let scope=await page.evaluate(()=>window.fleetumNoticeQa.capture());
  await page.evaluate(()=>window.fleetumNoticeQa.navigate('/qa/other'));await page.waitForFunction(()=>window.fleetumNoticeQa.state().contextKey.includes('/qa/other'));
  await page.evaluate(()=>window.fleetumNoticeQa.navigate('/__notification_qa.html'));await page.waitForFunction(()=>window.fleetumNoticeQa.state().contextKey.includes('/__notification_qa.html'));
  assert.equal(await page.evaluate(scope=>window.fleetumNoticeQa.late(scope),scope),'');
  for(const action of ['site','tenant']){scope=await page.evaluate(()=>window.fleetumNoticeQa.capture());await page.evaluate(action=>window.fleetumNoticeQa[action](),action);assert.equal(await page.evaluate(scope=>window.fleetumNoticeQa.late(scope),scope),'');}
  await page.evaluate(()=>window.fleetumNoticeQa.navigate('/platform/qa'));await page.waitForFunction(()=>window.fleetumNoticeQa.state().contextKey.startsWith('platform:'));
  scope=await page.evaluate(()=>window.fleetumNoticeQa.capture());await page.evaluate(()=>window.fleetumNoticeQa.platform());assert.equal(await page.evaluate(scope=>window.fleetumNoticeQa.late(scope),scope),'');
  assert.equal(await page.locator('.fleetum-notice').count(),0);assert.equal(await page.locator('[data-qa-issue]').count(),0);
 });
 await check('bounded-flood-queue-never-shows-more-than-three',async()=>{
  await page.evaluate(()=>{for(let i=0;i<1000;i++)window.fleetumNoticeQa.push('error','Esito sintetico '+i)});
  assert.ok(await page.evaluate(()=>window.fleetumNoticeQa.state().items.length)<=20);assert.equal(await page.locator('.fleetum-notice').count(),3);
  assert.equal(await page.locator('.fleetum-notice-overflow').count(),1);await page.evaluate(()=>window.fleetumNoticeQa.clear());assert.equal(await page.locator('.fleetum-notice').count(),0);
 });
 await context.close();
 await check('actual-booking-page-keeps-the-error-after-its-popup-expires',async()=>{
  const appContext=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',locale:'it-IT'}),app=await appContext.newPage();
  app.on('pageerror',error=>pageErrors.push(error.message));await app.clock.install();
  await appContext.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==base.origin){external.push(url.origin);return route.abort();}return route.continue()});
  await app.goto(new URL('/booking?bookingId=demo-booking-1',base).href);
  const cookies=app.getByRole('button',{name:'Solo necessari',exact:true});await cookies.waitFor();await cookies.click();await cookies.waitFor({state:'hidden'});
  const section=app.locator('details.booking-detail-section').filter({has:app.getByRole('heading',{name:'Pagamenti e garanzie',exact:true})});await section.locator('summary').click();
  await section.getByRole('button',{name:'Aggiorna',exact:true}).waitFor();
  await app.evaluate(async()=>{const{useSnackbarStore}=await import('/src/application/stores/snackbar-store.ts');useSnackbarStore.getState().clear()});
  await app.route('**/api/rental-payments/bookings/*/summary',async route=>{const response=await route.fetch();return route.fulfill({response,status:503,json:{error:'SYNTHETIC_SUMMARY_UNAVAILABLE',message:'Verifica sintetica del riepilogo non completata. Controlla la pratica.'}})});
  await section.getByRole('button',{name:'Aggiorna',exact:true}).click();await section.locator('.booking-detail-error').waitFor();await app.clock.runFor(160);
  assert.equal(await app.locator('.fleetum-notice--error.fleetum-notice--compact').count(),1);await position(app);
  await app.locator('.fleetum-notices').screenshot({path:`${output}/actual-booking-error.png`,animations:'disabled'});
  await app.clock.runFor(8150);assert.equal(await app.locator('.fleetum-notice').count(),0);assert.match(await section.locator('.booking-detail-error').innerText(),/Controlla la pratica/);
  await appContext.close();
 });
 assert.deepEqual(external,[]);assert.deepEqual(pageErrors,[]);
 await writeFile(`${output}/results.json`,JSON.stringify({scope:'actual components in synthetic loopback fixture; virtual clock; no live providers',results,external,pageErrors},null,2));
 console.log(`Notifications UI: ${results.length}/${results.length} passed.`);
}finally{await browser.close()}
