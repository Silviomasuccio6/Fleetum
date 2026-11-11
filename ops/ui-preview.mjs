import {realpathSync} from "node:fs";
import {collectionsFixture} from "./ui-collections-fixtures.mjs";
import {uiContractFixture,uiContractPdf} from "./ui-contract-fixture.mjs";
import { uiSubscriptionInvoiceData, uiSubscriptionInvoiceFixture } from "./ui-subscription-invoice-fixture.mjs";
import {sitePreviewRequest,sitePreviewScope,sitePreviewResponse} from "./ui-site-fixtures.mjs";
import { uiInvoiceFixture } from "./ui-invoice-fixture.mjs";
import { administrationFixtures } from "./ui-administration-fixtures.mjs";
import {supportReportsFixtures} from "./ui-support-reports-fixtures.mjs";
import {operationsFixtures} from "./ui-operations-fixtures.mjs";
import { commerceFixtures,commerceTemplatePreview } from "./ui-commerce-fixtures.mjs";
import { createServer } from "vite";
import { customerFixtures } from "./ui-customers-fixtures.mjs";
import { vehiclesFixture } from "./ui-vehicles-fixtures.mjs";
import { dashboardFixture, analyticsFixture } from "./ui-dashboard-fixtures.mjs";
import { fileURLToPath } from "node:url";
import { getCommercialPlanFeatures } from "../packages/commercial-plan-catalog/index.js";

// Local UI laboratory only. No real env files, database, credentials or provider SDKs.
const port = 5180;
const host = "127.0.0.1";
process.env.VITE_API_BASE_URL = `http://${host}:${port}/api`;
const root = fileURLToPath(new URL("../frontend", import.meta.url));
process.chdir(root);
let scenario = "normal";
const current = new Date();
const stamp = (day, hour = 10) => new Date(current.getFullYear(), current.getMonth(), day, hour).toISOString();
const sites = [{ id: "demo-site-1", name: "Milano Centrale", city: "Milano" }, { id: "demo-site-2", name: "Aeroporto", city: "Milano" }];
const models = [["Fiat", "500"], ["Volkswagen", "Golf"], ["Toyota", "Yaris Cross"], ["Peugeot", "3008"], ["Audi", "A3"], ["Jeep", "Avenger"], ["Ford", "Puma"], ["BMW", "Serie 1"], ["Renault", "Clio"], ["Mercedes-Benz", "Classe A"], ["Opel", "Corsa"], ["Toyota", "Corolla"]];
const vehicles = models.map(([brand, model], i) => ({
  id: `demo-vehicle-${i + 1}`, plate: `QA${String(101 + i)}AA`, brand, model, currentKm: 12000 + i * 1450,
  site: sites[i % 2], isActive: true,
  deadlineStatus: {
    maintenance: { status: i === 3 ? "DUE_SOON" : "OK", label: "Manutenzione", detail: i === 3 ? "Programmata fra 7 giorni" : "Nessuna scadenza imminente" },
    revision: { status: "OK", label: "Revisione", detail: "In regola" }
  }
}));
const names = [["Marco", "Riva"], ["Giulia", "Conti"], ["Andrea", "Bianchi"], ["Elena", "Serra"], ["Luca", "Moretti"], ["Sara", "Costa"], ["Paolo", "Greco"], ["Anna", "Fontana"]];
const customers = names.map(([firstName, lastName], i) => ({ id: `demo-customer-${i + 1}`, customerType: "PERSONA_FISICA", firstName, lastName, email: `cliente${i + 1}@fleetum-demo.invalid`, phone: "", drivingLicenseNumber: `DEMO${String(i + 1).padStart(4, "0")}`, attachments: [] }));
const start = Math.min(22, Math.max(4, current.getDate() - 2));
const states = ["IN_RENT", "CONFIRMED", "QUOTED", "IN_RENT", "READY_FOR_HANDOVER", "HOLD", "CONFIRMED", "DRAFT"];
const bookings = states.map((status, i) => ({
  id: `demo-booking-${i + 1}`, code: `FL-${String(1042 + i)}`, status, contractStatus: "NOT_READY", contractRequired: true, cargosStatus: "NOT_REQUIRED",
  customerName: `${customers[i].firstName} ${customers[i].lastName}`, customerEmail: customers[i].email, customerPhone: "", customer: customers[i],
  pickupAt: stamp(start + (i % 4), i % 2 ? 14 : 10), returnAt: stamp(start + (i % 4) + (i % 3) + 2, 10),
  vehicle: vehicles[i], pickupLocation: sites[i % 2].name, returnLocation: sites[i % 2].name,
  expectedTotal: 150 + i * 45, finalTotal: null, pickupKm: vehicles[i].currentKm, returnKm: null, reason: "Noleggio dimostrativo", internalNotes: "Dati sintetici per la revisione UI.", notes: [], attachments: []
}));
const user = { id: "demo-user", tenantId: "demo-tenant", email: "visita@fleetum-demo.invalid", firstName: "Utente", lastName: "Demo", roles: ["ADMIN"], permissions: ["*", "rental-payments:read", "rental-payments:write", "rental-payments:charge"] };
const license = { plan: "ENTERPRISE", seats: 10, status: "ACTIVE", expiresAt: null, daysRemaining: null, expiringSoon: false, billingCycle: "monthly", provider: "local" };
const page = (data) => ({ data, total: data.length, page: 1, pageSize: 200 });

const send = (res, status, value) => {
  ({status,body:value}=sitePreviewResponse(res.fleetumSiteScope,status,value,sites));
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
};
const apiHandler = async (req, res, next) => {
  const url = new URL(req.url ?? "/", `http://${host}:${port}`);
  if (url.pathname === "/__ui/scenario" && req.method === "POST") {
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}:${port}`) return send(res, 403, { message: "Solo anteprima locale" });
    let raw = "";
    for await (const chunk of req) { raw += chunk; if (raw.length > 256) return send(res, 413, {}); }
    let input;
    try { input = JSON.parse(raw); } catch { return send(res, 400, {}); }
    if (!["normal", "empty", "error", "slow", "partial", "many", "limited", "reader", "billing", "activation", "recovery", "access", "access-error", "access-slow", "site-operator", "site-unassigned", "site-inactive", "site-pending"].includes(input.scenario)) return send(res, 400, {});
    scenario = input.scenario;
    return send(res, 200, { scenario });
  }
  if (!url.pathname.startsWith("/api/")) return next();
  const path = url.pathname.slice(4);
  const activeUser = scenario === "reader" ? { ...user, roles: ["VIEWER"], permissions: ["stats:read", "vehicles:read", "sites:read", "workshops:read", "stoppages:read", "users:read", "billing:read"] } : scenario === "limited" ? { ...user, roles: ["VIEWER"], permissions: ["stats:read", "vehicles:read"] } : {...user};
  if(scenario.startsWith("site-") && scenario!=="site-pending")Object.assign(activeUser,{roles:["OPERATOR"],assignedSiteId:scenario==="site-unassigned"?null:sites[0].id});
  const activeLicense = scenario === "limited" ? { ...license, plan: "BASIC" } : scenario === "activation" ? { ...license, plan: "PRO", status: "PENDING", provider: "stripe" } : scenario === "recovery" ? { ...license, plan: "PRO", status: "PAST_DUE", provider: "stripe" } : scenario === "billing" ? { ...license, plan: "PRO", provider: "stripe" } : license;
  if (scenario === "access-slow" && path === "/auth/me") await new Promise(resolve => setTimeout(resolve,2500));
  if (scenario.startsWith("access") && ["/auth/me", "/auth/refresh"].includes(path)) return send(res, 401, { error: "UNAUTHORIZED", message: "Sessione dimostrativa assente o scaduta." });
  if (scenario.startsWith("access") && path === "/auth/forgot-password" && req.method === "POST") {
    if (scenario === "access-slow") await new Promise(resolve => setTimeout(resolve,2500));
    if (scenario === "access-error") return send(res,503,{error:"QA_UNAVAILABLE",message:"Servizio temporaneamente non disponibile. Riprova."});
    return send(res,200,{accepted:true}); // Presentation only: no email, token or account mutation.
  }
  if (req.method === "POST" && path === "/auth/refresh") return send(res, 200, { user: activeUser, csrfToken: "local-ui-fixture-only" });
  if(path==='/contract-templates/preview-render'&&req.method==='POST'){
    if(req.headers.origin&&req.headers.origin!==`http://${host}:${port}`)return send(res,403,{message:'Solo anteprima locale'});
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>131072)return send(res,413,{message:'Anteprima troppo lunga'})}
    try{return send(res,200,commerceTemplatePreview(JSON.parse(raw),bookings))}catch{return send(res,400,{message:'Anteprima non valida'})}
  }
  if(!path.startsWith("/auth/")&&path!=="/health"){
    res.fleetumSiteScope=sitePreviewScope(req,path,activeUser,sites,scenario,bookings);
    res.setHeader("X-Fleetum-Site-Revision",res.fleetumSiteScope.revision);
    res.setHeader("X-Fleetum-Site-View",res.fleetumSiteScope.view);
    if(req.headers["x-fleetum-site-revision"]&&req.headers["x-fleetum-site-revision"]!==res.fleetumSiteScope.revision)return send(res,409,{error:"SITE_CONTEXT_STALE",message:"La sede è cambiata. Aggiorna la vista."});
    if(res.fleetumSiteScope.denied)return send(res,404,{message:"Risorsa non disponibile nella sede scelta."});
  }
  if(path==="/stoppages/calendar/apple/revoke"&&req.method==="POST")return send(res,204,{}); // Synthetic only: no grants or provider exist.
  const siteReply=await sitePreviewRequest(req,path,activeUser,sites,scenario);
  if(siteReply)return send(res,siteReply.status,siteReply.body);
  if (req.method !== "GET") return send(res, 501, { error: "UI_PREVIEW_READ_ONLY", message: "Anteprima UI: salvataggi, invii e pagamenti sono disattivati. Nessun dato è stato modificato." });
  if (path === "/auth/me") return send(res, 200, activeUser);
  if (path === "/auth/me/entitlements") return send(res, 200, { plan: activeLicense.plan, priceMonthly: activeLicense.plan === "BASIC" ? 149 : 299, features: getCommercialPlanFeatures(activeLicense.plan), license: activeLicense });
  if (path === "/auth/license-status") return send(res, 200, activeLicense);
  if (path === "/auth/privacy/current") return send(res, 200, { accepted: true, acceptedAt: current.toISOString(), notice: { id: "demo-notice", version: "demo", title: "Informativa dimostrativa", summary: "Anteprima con dati fittizi", content: "", publishedAt: current.toISOString() } });
  if (path === "/billing/invoices" || path === "/billing/invoices/demo-invoice-1/pdf") {
    if (res.fleetumSiteScope.view !== "all" || !activeUser.roles.some(role => role === "ADMIN" || role === "MANAGER")) return send(res,403,{message:"Questa operazione aziendale richiede la vista tutte le sedi"});
    if (scenario === "error" || (scenario === "partial" && path === "/billing/invoices")) return send(res,503,{message:"Copia PDF non disponibile. Riprova."});
    if (scenario === "slow") await new Promise(resolve => setTimeout(resolve,1500));
    if (path === "/billing/invoices") return send(res,200,{data:scenario === "empty" ? [] : [uiSubscriptionInvoiceData(current)]});
    const bytes = await uiSubscriptionInvoiceFixture(current);
    res.statusCode=200; res.setHeader("Content-Type","application/pdf"); res.setHeader("Cache-Control","private, no-store");
    res.setHeader("Content-Disposition",'attachment; filename="Fleetum_DEMO-2026-001.pdf"'); res.setHeader("X-Content-Type-Options","nosniff");return res.end(bytes);
  }
  const administration = administrationFixtures({path,scenario,current,user:activeUser});
  if (administration) { if (scenario === 'slow') await new Promise(resolve => setTimeout(resolve,2500)); return send(res,administration.status,administration.body); }
  const support=supportReportsFixtures({path,params:url.searchParams,scenario,sites,vehicles,current});
  if(support){if(scenario==='slow')await new Promise(resolve=>setTimeout(resolve,3000));return send(res,support.status,support.body)}
  if (path === "/stats/dashboard") {
    if (scenario === "slow") await new Promise(resolve => setTimeout(resolve, 3500));
    if (scenario === "error") return send(res, 503, { message: "Dashboard temporaneamente non disponibile nella prova locale." });
    return send(res, 200, dashboardFixture({ scenario, bookings, vehicles, current }));
  }

  if (["/stoppages/assignment/suggestions", "/stoppages/costs/summary", "/stoppages/sla/escalations", "/stoppages/preventive/due", "/stoppages/costs/variance"].includes(path)) {
    if (scenario === "partial" && path === "/stoppages/costs/summary") return send(res, 503, { message: "Costi temporaneamente non disponibili nella prova locale." });
    return send(res, 200, { kpis: { estimatedTotalCost: scenario === "empty" ? 0 : 1250, varianceTotal: 125, level3: 0, dueSoonDays: 2, dueNowDays: 1, dueSoonKm: 3, dueNowKm: 0 }, data: [], suggestions: scenario === "empty" ? [] : [{ userId: "qa-operator", name: "Operatore demo", email: "operatore@example.invalid", assignedCount: 2, weightedLoad: 3 }] });
  }
  if (path === "/health") return send(res, 200, { status: "ok", mode: "ui-preview" });
  if (path === "/notifications/inbox") return send(res, 200, { data: [] });
  const customerRoute=path.match(/^\/rental-customers(?:\/([^/]+)(?:\/(contracts))?)?$/);
  if(customerRoute){
    if(scenario==='slow')await new Promise(resolve=>setTimeout(resolve,3000));
    if(scenario==='error'||(scenario==='partial'&&customerRoute[2]))return send(res,503,{message:'Dati clienti temporaneamente non disponibili nella prova locale.'});
    const result=customerFixtures({customers,bookings,current,scenario,params:url.searchParams,id:customerRoute[1],contracts:Boolean(customerRoute[2])});
    return send(res,result?200:404,result||{message:'Cliente non trovato nella prova locale.'});
  }

  if (path === "/master-data/vehicles") {
    if (scenario === "slow") await new Promise(resolve => setTimeout(resolve, 3500));
    if (scenario === "error") return send(res, 503, { message: "Elenco veicoli temporaneamente non disponibile nella prova locale." });
    return send(res, 200, vehiclesFixture({ scenario, vehicles, sites, params: url.searchParams }));
  }
  const operations=operationsFixtures({path,params:url.searchParams,scenario,vehicles,sites,current});
  if(operations){if(scenario==='slow')await new Promise(resolve=>setTimeout(resolve,2500));return send(res,operations.status,operations.body)}
  const commerce=commerceFixtures({path,params:url.searchParams,scenario,bookings,sites,vehicles,current});
  if(commerce){if(scenario==='slow')await new Promise(resolve=>setTimeout(resolve,3000));return send(res,commerce.status,commerce.body)}
  if (path === "/rental-bookings/customers" || path === "/rental-bookings/suggest/customers") {
    const q = (url.searchParams.get("q") ?? url.searchParams.get("search") ?? "").toLowerCase();
    return send(res, 200, page(customers.filter((customer) => `${customer.firstName} ${customer.lastName} ${customer.email}`.toLowerCase().includes(q))));
  }
  if (path === "/rental-bookings/suggest/vehicles") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    return send(res, 200, { data: vehicles.filter((vehicle) => `${vehicle.plate} ${vehicle.brand} ${vehicle.model}`.toLowerCase().includes(q)) });
  }
  if (path === "/rental-bookings/availability/month") {
    if (scenario === "slow") await new Promise((resolve) => setTimeout(resolve, 2000));
    if (scenario === "error") return send(res, 503, { error: "DEMO_CALENDAR_ERROR", message: "Errore dimostrativo di caricamento. Premi Riprova dopo aver selezionato lo scenario normale." });
    const month = url.searchParams.get("month");
    const siteId = url.searchParams.get("siteId");
    const q = (url.searchParams.get("search") ?? "").toLowerCase();
    const [year, monthNumber] = (month ?? "").split("-").map(Number);
    if (!year || !monthNumber) return send(res, 400, { message: "Mese non valido" });
    const from = new Date(year, monthNumber - 1, 1);
    const to = new Date(year, monthNumber, 1);
    const data = scenario === "empty" ? [] : vehicles.filter((vehicle) => !siteId || vehicle.site.id === siteId).flatMap((vehicle) => {
      const related = bookings.filter((booking) => booking.vehicle.id === vehicle.id && new Date(booking.pickupAt) < to && new Date(booking.returnAt) > from);
      if (!`${vehicle.plate} ${vehicle.brand} ${vehicle.model} ${related.map((booking) => booking.customerName).join(" ")}`.toLowerCase().includes(q)) return [];
      return [{ vehicle, hasBookings: related.length > 0, bookings: related }];
    });
    const booked = data.filter((row) => row.hasBookings).length;
    return send(res, 200, { month, siteId, range: { from: from.toISOString(), to: to.toISOString() }, data, summary: { totalVehicles: data.length, bookedVehicles: booked, availableVehicles: data.length - booked, occupancyRate: data.length ? Math.round(booked / data.length * 100) : 0 } });
  }
  const contractPdf=path.match(/^\/rental-bookings\/(demo-booking-\d+)\/contract\/pdf$/);
  if(contractPdf){const booking=bookings.find(value=>value.id===contractPdf[1]);if(!booking)return send(res,404,{message:"Pratica non trovata"});const bytes=await uiContractPdf(booking,current);res.statusCode=200;res.setHeader("Content-Type","application/pdf");res.setHeader("Content-Disposition",'attachment; filename="Contratto_dimostrativo.pdf"');res.setHeader("Cache-Control","private, no-store");return res.end(bytes);}
  const contractFixture=uiContractFixture({path,bookings,current,params:url.searchParams});
  if(contractFixture){if(scenario==="slow")await new Promise(resolve=>setTimeout(resolve,1500));if(scenario==="error")return send(res,503,{message:"Condizioni temporaneamente non disponibili nella prova locale"});return send(res,contractFixture.status,contractFixture.body);}
  const invoice = path.match(/^\/rental-bookings\/(demo-booking-\d+)\/invoice\/draft\.pdf$/);
  if (invoice) {
    if (!activeUser.permissions.includes("vehicles:read") && !activeUser.permissions.includes("*")) return send(res, 403, { message: "Permessi insufficienti" });
    const booking = bookings.find(entry => entry.id === invoice[1]);
    if (!booking) return send(res, 404, { message: "Prenotazione non trovata" });
    if (scenario === "error") return send(res, 503, { message: "Bozza fattura non disponibile. Riprova." });
    if (scenario === "partial") return send(res, 409, { message: "Completa e verifica le condizioni economiche della prenotazione prima di preparare la bozza fattura." });
    if (scenario === "slow") await new Promise(resolve => setTimeout(resolve, 1500));
    try {
      const bytes = await uiInvoiceFixture(booking);
      res.statusCode = 200; res.setHeader("Content-Type", "application/pdf"); res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Disposition", `attachment; filename="Bozza_fattura_${booking.code}.pdf"`); res.setHeader("X-Content-Type-Options", "nosniff");
      return res.end(bytes);
    } catch { return send(res, 503, { message: "Bozza fattura non disponibile. Riprova." }); }
  }
  if(path==="/rental-bookings/cargos/configuration"){
    if(!activeUser.roles.includes("ADMIN")||res.fleetumSiteScope.view!=="all")return send(res,403,{message:"Configurazione riservata all'amministratore nella vista tutte le sedi"});
    return send(res,200,{encryptionReady:false,enabled:false,credentialsPresent:false,agencies:{}});
  }
  const cargos=path.match(/^\/rental-bookings\/(demo-booking-\d+)\/cargos$/);
  if(cargos){
    const booking=bookings.find(entry=>entry.id===cargos[1]);if(!booking)return send(res,404,{message:"Pratica non trovata"});
    if(scenario==="error")return send(res,503,{message:"Pratica temporaneamente non disponibile. Riprova."});
    if(scenario==="slow")await new Promise(resolve=>setTimeout(resolve,1800));
    return send(res,200,{bookingId:booking.id,contractId:"demo-contract-"+booking.id,code:booking.code,customer:booking.customerName,plate:booking.vehicle.plate,sourceHash:"0".repeat(64),status:"DRAFT",configured:false,canSend:false,sourceChanged:false,message:"Collegamento CARGOS da configurare per la tua azienda.",transactionId:null,acceptedAt:null,fields:[]});
  }
  const detail = path.match(/^\/rental-bookings\/(demo-booking-\d+)(?:\/(quick|contract|pricing))?$/);
  if (detail) {
    const booking = bookings.find((entry) => entry.id === detail[1]);
    if (!booking) return send(res, 404, { message: "Prenotazione non trovata" });
    if (detail[2] === "contract") return send(res, 200, null);
    if (detail[2] === "pricing") return send(res, 200, { snapshot: null });
    return send(res, 200, booking);
  }
  const collectionBookings=res.fleetumSiteScope?.view&&res.fleetumSiteScope.view!=="all"?bookings.filter(b=>[b.siteId,b.pickupSiteId,b.returnSiteId,b.vehicle.site.id].includes(res.fleetumSiteScope.view)):bookings;
  const collections=collectionsFixture({path,params:url.searchParams,scenario,bookings:collectionBookings});
  if(collections){if(scenario==='slow')await new Promise(resolve=>setTimeout(resolve,2000));return send(res,collections.status,collections.body);}
  const payments = path.match(/^\/rental-payments\/bookings\/(demo-booking-\d+)\/summary$/);
  if (payments) {
    if (scenario === "slow") await new Promise((resolve) => setTimeout(resolve, 5000));
    if (scenario === "error") return send(res, 503, { error: "DEMO_PAYMENTS_ERROR", message: "Riepilogo pagamenti temporaneamente non disponibile nella prova locale." });
    const booking = bookings.find((entry) => entry.id === payments[1]);
    return send(res, 200, { booking: { id: booking.id, code: booking.code, customerId: booking.customer.id }, paymentMethods: [], deposits: [], extraCharges: [], capabilities: { stripe: { status: "disabled_for_environment", operationsEnabled: false, verification: "not_performed" } } });
  }
  return send(res, 501, { error: "UI_PREVIEW_UNAVAILABLE", message: "Questa sezione non è ancora inclusa nell'anteprima Prenotazioni." });
};

const previewBanner = `<style>
body{margin:0}.ui-preview-bar{position:sticky;top:0;z-index:49;background:#eef7f3;color:#205746;border-bottom:1px solid #b6d9cb;padding:7px 16px;font:11px/1.5 Inter,system-ui;height:34px;display:flex;align-items:center;justify-content:space-between;gap:12px}.ui-preview-bar>span{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ui-preview-bar label{white-space:nowrap;display:flex;align-items:center;gap:4px}.ui-preview-bar a{color:inherit;text-decoration:underline}.ui-preview-bar select{background:#fff;color:#205746;border:1px solid #6b8c80;border-radius:4px;padding:2px 6px;font:inherit;max-width:130px}.ui-preview-bar+ #root{--ws-preview-offset:34px}@media(max-width:600px){.ui-preview-bar{font-size:10px;padding:6px 10px;gap:8px}.ui-preview-bar a{display:none}}
</style><aside class="ui-preview-bar" aria-label="Laboratorio di anteprima"><span>Anteprima UI · dati fittizi · nessun dato reale</span><a href="/ui-preview.html">Componenti</a><label>Scenario <select aria-label="Scenario anteprima" onchange="fetch('/__ui/scenario',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario:this.value})}).then(()=>location.reload())"><option value="normal">Normale</option><option value="empty">Nessun dato</option><option value="error">Errore</option><option value="slow">Caricamento lento</option><option value="partial">Errore di una sezione</option><option value="many">Molti dati</option><option value="limited">Ruolo e piano limitati</option><option value="reader">Sola lettura</option><option value="billing">Abbonamento di prova</option><option value="activation">Attivazione in attesa</option><option value="recovery">Pagamento da regolarizzare</option><option value="site-operator">Operatore di sede</option><option value="site-unassigned">Senza sede</option><option value="site-inactive">Sede non attiva</option><option value="site-pending">Filtri sedi non attivi</option><option value="access">Accesso: sessione assente</option><option value="access-error">Accesso: errore recupero</option><option value="access-slow">Accesso: recupero lento</option></select></label></aside>`;

const server = await createServer({
  root, envDir: false,
  // Prerender creates another Vite server: its optimizer must not replace this lab's modules.
  cacheDir: fileURLToPath(new URL('../node_modules/.vite-fleetum-ui-preview', import.meta.url)),
  server: { host, port, strictPort: true, allowedHosts: [host, "localhost"], fs:{allow:[fileURLToPath(new URL("..",import.meta.url)),realpathSync(fileURLToPath(new URL("../node_modules/@fontsource",import.meta.url))),realpathSync(fileURLToPath(new URL("../node_modules/@fontsource-variable",import.meta.url)))]} },
  plugins: [{ name: "fleetum-local-ui-preview", enforce: "pre", configureServer(instance) { instance.middlewares.use((req, res, next) => { void apiHandler(req, res, next).catch(() => send(res, 500, { message: "Errore del laboratorio locale" })); }); }, transformIndexHtml(html) { return html.replace('<div id="root">', `${previewBanner.replace(`value="${scenario}"`, `value="${scenario}" selected`)}<div id="root">`); } }]
});
await server.listen();
console.log(`Fleetum UI preview: http://${host}:${port}/booking — local synthetic data only.`);
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, async () => { await server.close(); process.exit(0); });
