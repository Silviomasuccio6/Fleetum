# Fleetum API Catalog

Stato: tecnico-operativo
Aggiornato: 2026-06-21
Base URL tenant: `https://api.fleetum.it/api`
Base URL Platform: `https://platform.fleetum.it/platform-api`

Questa e la mappa contrattuale delle API implementate. Le validazioni Zod in `backend/src/interfaces/http/validators/` sono la fonte definitiva dei payload. Tutte le route tenant non dichiarate pubbliche richiedono Bearer JWT, tenant isolation e i permessi indicati dal router.

## Convenzioni

- JSON UTF-8 salvo PDF, CSV, XLSX, stream e multipart.
- Errore applicativo: `{ "error": "CODE", "message": "testo", "requestId": "..." }`.
- Mutazioni tenant richiedono anche CSRF quando l'autenticazione usa cookie.
- `404` e `403` non devono rivelare risorse di altri tenant.
- File upload: `multipart/form-data`; i nomi campo sono indicati nelle route.
- Gli endpoint Stripe webhook sono pubblici ma verificano la firma Stripe; non chiamarli dal frontend.

## 1. Pubbliche e health

| Metodo | Endpoint | Scopo |
|---|---|---|
| GET | `/api/health` | liveness backend |
| GET | `/api/ready` | readiness con query database |
| POST | `/api/public/analytics/event` | evento anonimo landing, rate limited |
| POST | `/api/public/demo-request` | lead demo B2B, rate limited |
| GET | `/api/calendar/apple/feed.ics` | feed calendario pubblico con token/parametri previsti |
| GET | `/api/calendar/google/callback` | callback OAuth Google Calendar |
| GET | `/api/contracts/public/:token` | PDF contratto condiviso tramite token firmato |

Per il sito pubblico usare solo `analytics/event` e `demo-request`. Mai chiamare API tenant o Platform dalla landing.

## 2. Autenticazione tenant: `/api/auth`

| Metodo | Path | Scopo |
|---|---|---|
| POST | `/signup` | crea tenant e owner |
| POST | `/login` | login tenant |
| GET | `/google` | avvio Google OAuth |
| GET | `/google/callback` | callback Google OAuth |
| GET/POST | `/apple/callback` | callback Apple OAuth |
| GET | `/apple` | avvio Apple OAuth |
| POST | `/forgot-password` | invia reset password tenant |
| POST | `/reset-password` | applica reset tenant tramite token |
| POST | `/accept-invite` | accetta invito utente |
| POST | `/refresh` | ruota refresh token, limiter dedicato |
| POST | `/logout` | logout sessione corrente |
| GET | `/me` | profilo sessione |
| GET | `/me/entitlements` | piano, feature e permessi |
| GET/POST | `/privacy/current`, `/privacy/accept` | stato/accettazione privacy |
| GET | `/license-status` | stato licenza SaaS |
| GET | `/sessions` | sessioni attive |
| POST | `/sessions/revoke-all` | revoca tutte le sessioni |
| POST | `/sessions/:id/revoke` | revoca una sessione |
| PATCH | `/profile` | modifica profilo owner/utente |
| POST | `/change-password` | cambio password autenticato |

## 3. Billing SaaS: `/api/billing`

| Metodo | Path | Permesso | Scopo |
|---|---|---|---|
| POST | `/checkout-session` | `billing:manage` | avvia Stripe Checkout per piano/ciclo |
| POST | `/payment-method-session` | `billing:manage` | aggiorna carta tramite Stripe |
| GET | `/local-complete` | `billing:manage` | conferma locale controllata di ritorno Checkout |
| GET | `/invoices` | `billing:read` | elenco fatture SaaS tenant |
| GET | `/invoices/:invoiceId` | `billing:read` | dettaglio fattura |
| GET | `/invoices/:invoiceId/pdf` | `billing:read` | PDF fattura |
| POST | `/webhook` | Stripe signature | eventi Stripe, idempotenti |

La UI non attiva licenze dal `success_url`: lo stato arriva dal webhook verificato.

## 4. Anagrafiche e flotta: `/api/master-data`

| Risorsa | Operazioni |
|---|---|
| Sedi | `GET/POST /sites`, `PATCH/DELETE /sites/:id` |
| Officine | `GET/POST /workshops`, `PATCH/DELETE /workshops/:id` |
| Veicoli | `GET/POST /vehicles`, `PATCH/DELETE /vehicles/:id`, `POST /vehicles/import` |
| Scadenze | `GET /vehicle-deadlines`, `POST /vehicle-deadlines/calendar-sync` |
| Manutenzioni | `GET/POST /vehicle-maintenances`, `PATCH/DELETE /vehicle-maintenances/:id`, `GET /vehicle-maintenances/export.csv`, `GET /vehicle-maintenances/export.xlsx` |

I permessi sono `sites:*`, `workshops:*` e `vehicles:*`.

## 5. Booking, clienti e contratti

### Prenotazioni: `/api/rental-bookings`

| Gruppo | Endpoint |
|---|---|
| Calendario e disponibilita | `GET /`, `/availability/day`, `/availability/month`, `/suggest/vehicles`, `/suggest/customers`, `/contracts` |
| Clienti rapidi | `GET/POST /customers`, `GET/PATCH /customers/:customerId` |
| CRUD booking | `GET/POST /`, `GET/PATCH/DELETE /:id`, `GET /:id/quick` |
| Stato e note | `POST /:id/transition`, `POST /:id/cargos`, `POST /:id/notes` |
| Prezzo | `GET/PATCH /:id/pricing` |
| Contratto | `POST /:id/contract`, `POST /:id/contract/generate`, `GET/PATCH /:id/contract`, `GET /:id/contract/pdf`, `POST /:id/contract/email`, `POST /:id/contract/whatsapp`, `POST /:id/contract/share/revoke`, `POST /:id/contract/mark-signed` |

### Registro clienti: `/api/rental-customers`

`GET /`, `GET/PATCH /:customerId`, `GET /:customerId/contracts`, `GET /:customerId/bookings`.

### Listini: `/api/rental-pricing`

- `GET/POST /lists`, `PATCH/DELETE /lists/:id`
- `GET/POST /lists/:id/packages`, `PATCH/DELETE /packages/:id`
- `GET/POST /extra-policies`, `PATCH/DELETE /extra-policies/:id`
- `POST /quote/preview`, `POST /quote/finalize`

### Template contratto: `/api/contract-templates`

`GET/PATCH /default`, `POST /default/logo` multipart `file`, `GET /default/logo/file`, `DELETE /default/logo`, `POST /preview-render`.

## 6. Fermi tecnici: `/api/stoppages`

| Area | Endpoint principali |
|---|---|
| Elenco e dettaglio | `GET/POST /`, `GET/PATCH/DELETE /:id` |
| Workflow | `PATCH /:id/status`, `POST /:id/workflow/transition`, `POST /bulk` |
| Calendari | `GET /calendar`, `/calendar/custom`, `POST/PATCH/DELETE /calendar/custom/:eventId`, Apple import/feed, Google sync |
| Costi e SLA | `/costs/summary`, `/costs/variance`, `/sla/overview`, `/sla/escalations`, `/alerts/list`, `/preventive/due` |
| Ricambi e approvazioni | `GET/POST /:id/parts-orders`, `GET /:id/cost-approvals`, `POST /:id/cost-approvals/request`, `POST /:id/cost-approvals/decision` |
| Chiusura e reminder | `GET/POST /:id/closure-checklist`, `POST /:id/final-cost`, `POST /:id/reminders/email`, `GET /:id/reminders/whatsapp-link`, `GET /:id/reminders/template-preview` |

## 7. Report e statistiche: `/api/stats`

| Endpoint | Feature/permessi | Scopo |
|---|---|---|
| `/dashboard` | `reports_basic`, `stats:read` | KPI operativi |
| `/analytics`, export CSV/XLSX | `reports_advanced` / `export_csv` | analytics ed export |
| `/vehicles/profitability` | `reports_advanced`, economics | ROI multi-veicolo |
| `/vehicles/:vehicleId/profitability` | economics | ROI singolo veicolo |
| `/vehicles/profitability/export.:format` | `reports:export` | PDF, XLSX, CSV |
| `/workshops/health`, `/workshops/capacity` | report | performance officine |
| `/team/performance` | report avanzati | performance team |
| `/ai/suggestions` | `security_insights` | suggerimenti operativi |

## 8. Tenant, utenti, impostazioni e audit

| Prefisso | Endpoint/concetto |
|---|---|
| `/api/users` | elenco, ruoli, invito, create, update, ruolo, delete |
| `/api/tenant` | profilo azienda, completeness, branding logo multipart |
| `/api/settings` | SLA, playbook, report, integrazioni: GET/PUT |
| `/api/notifications` | inbox e stream |
| `/api/audit` | log e CSV export |
| `/api/privacy` | export/anonymize customer, preview/run retention |
| `/api/gdpr` | erasure request e data export portabile |

## 9. Document storage: `/api/uploads`

Tutte le route richiedono ownership tenant, permessi e audit. Principali risorse:

- foto fermi: upload/download/delete;
- foto veicoli: upload/download/delete;
- libretti veicolo: upload/download/delete, estrazione data immatricolazione;
- allegati manutenzione: upload/download/delete e analisi PDF fattura in background;
- allegati cliente: upload/download/delete, opzionalmente collegati a booking.

I nomi specifici di risorsa sono `stoppages/:id/photos`, `vehicles/:id/photos`, `vehicles/:id/booklet`, `vehicle-maintenances/:id/attachments` e `rental-customers/:customerId/attachments`, con rispettivi endpoint download/delete sotto `stoppage-photos`, `vehicle-photos`, `vehicle-booklets`, `vehicle-maintenance-attachments`, `rental-customer-attachments`.

## 10. Platform Console: `/platform-api`

Prima di ogni endpoint: IP allowlist. Dopo login: Bearer Platform JWT.

| Metodo | Endpoint | Scopo |
|---|---|---|
| GET | `/health`, `/ready`, `/metrics` | disponibilita e metriche Platform |
| POST | `/auth/login` | password + OTP login Platform |
| POST | `/auth/password-reset/request` | invio OTP reset Platform |
| POST | `/auth/password-reset/confirm` | conferma OTP e nuova password |
| GET | `/overview`, `/system-health`, `/security` | controllo prodotto e sicurezza |
| GET | `/analytics/website`, `/demo-leads` | acquisizione e sito |
| PATCH | `/demo-leads/:id` | aggiorna lead |
| GET | `/tenants`, `/users`, `/events/recent` | tenant, utenti, audit |
| GET | `/tenants/:id/profile`, `/tenants/:id/onboarding-status` | dettaglio azienda |
| PATCH | `/tenants/:id/license`, `/tenants/:id/status` | piano e stato tenant |
| POST | `/tenants/:id/quick-action` | azioni licenza rapide |
| GET | `/metrics/revenue`, `/metrics/revenue/export.csv`, `/metrics/dashboard-live` | ricavi e telemetria |
| GET/POST/PATCH | `/invoices*`, `/tenants/:tenantId/invoices*` | fatturazione SaaS e PDF/email |

## 11. Versioning e cambiamenti

Non esiste un prefisso `/v1` separato. Per evitare breaking change:

1. aggiungere campi invece di rinominare/rimuovere;
2. mantenere compatibilita del payload frontend per una release;
3. documentare richiesta, risposta, permesso e feature gate nello stesso PR;
4. aggiornare test tenant isolation quando una nuova risorsa contiene `tenantId`.
