# Fleetum — blocco 1: configurazioni e flussi finanziari

Data: 6 novembre 2026. Base verificata: `ad9a3f35729d087ccafc8e6010e7bf0cde6b5872`.
Chiusura della consegna locale: 7 novembre 2026; identificativi del blocco invariati.
Branch locale: `codex/payments-contracts-ux-20261106`.
Checkout: `/private/tmp/fleetum-payments-contracts-20261106`.

## Perimetro e attendibilità

Analisi del codice, prove con servizi simulati e PostgreSQL temporaneo. Nessun
accesso VPS, dashboard provider, file env reale, dati personali o produzione.
Nessun invio email/CARGOS, addebito o rimborso reale. La presenza di una variabile
o di un SDK non dimostra che un account sia operativo.

Lo stato staging citato sotto proviene dalla consegna
`COLLAUDO_STAGING_COMPLETATO_20261106.md`, osservazione delle 05:56:43 UTC:
release ad9a3f3, provider/email/cron disabilitati e sette casi E2E superati.
È evidenza storica, non una nuova osservazione del server. Non è stato verificato
il runtime produzione. Il browser su porta 5180 è un'anteprima sintetica e non
prova la configurazione dello staging. Le nuove prove UI usano una porta separata.

## Risultato principale

L'avviso Stripe ha una causa riproducibile nel codice: il servizio garanzie usa
`STRIPE_SECRET_KEY`; senza chiave o client rifiuta l'operazione. Nello staging tale
chiave è intenzionalmente vietata dal profilo di isolamento. Prima della correzione,
il riepilogo non esponeva questa distinzione e la UI consentiva di avviare il
collegamento carta per poi ricevere un errore 500 generico.

Non basta copiare una chiave: abbonamenti Fleetum e noleggi sono domini diversi.
Il codice ha customer/tabelle/metadata distinti, ma usa lo stesso account Stripe
del client globale e non modella un account destinatario per ogni autonoleggio.
Questo è un prerequisito aperto per l'attivazione degli incassi online multi-azienda.

## Matrice delle configurazioni

Stati: **disabilitato intenzionalmente**, **configurazione mancante**,
**permesso/capacità mancante**, **errore applicativo**, **non verificato**.
Le prove di codice sono dettagliate nelle sezioni successive; non sono attestazioni
del funzionamento di un provider reale.

| Funzionalità | Ambiente | Stato | Prova disponibile / test | Cosa manca e prossima azione |
| --- | --- | --- | --- | --- |
| Abbonamento Fleetum | Staging, ultima osservazione | Disabilitato intenzionalmente | Chiavi Stripe vietate da `staging-safety.ts`; runtime documentato senza provider | Conservare isolamento; prova esterna solo nel laboratorio provider separato |
| Abbonamento Fleetum | Locale sintetico | Non verificato sul provider | Test webhook, firma, duplicati, stato abbonamento e concorrenza | Catalogo prezzi, account, portale e recapito webhook reali da verificare separatamente |
| Abbonamento Fleetum | Produzione | Non verificato | Solo codice/runbook; nessuna lettura di configurazioni live | Accertare identità account, sei prezzi, modalità live e portale senza riusare le garanzie |
| Carte e garanzie | Staging, ultima osservazione | Disabilitato intenzionalmente; errore applicativo corretto localmente | Nuovi test di summary e guardia; UI con stato esplicito | Installazione futura del candidato; nessuna attivazione Stripe nello staging corrente |
| Carte e garanzie | Locale, provider assente | Configurazione mancante riconosciuta | Nessun checkout fittizio; errore 503; azioni Stripe bloccate e letture disponibili | Completare modello destinatario prima della configurazione reale |
| Carte e garanzie | Produzione | Non verificato; capacità multi-esercente mancante nel modello | Client globale, nessun account destinatario persistito né richiesta Connect individuata | Definire esercente, beneficiario, responsabilità e conto del singolo autonoleggio |
| Incasso del corrispettivo base | Codice / locale | Permesso/capacità mancante | Modelli prezzi, garanzie ed extra presenti; nessun registro dedicato degli incassi base trovato nei percorsi analizzati | Blocco 3: fonte contabile unica per ricevuto/residuo, metodi manuali e rettifiche |
| Email transazionali | Staging e provider QA | Disabilitato intenzionalmente | `email-sender.ts` rifiuta prima di creare SDK; cron spenti | Non forzare `SENT`; eseguire solo prove simulate |
| Email transazionali | Locale simulato | Non verificato sulla consegna reale | Test sender/outbox/lease/permessi e ricevute simulate | Test esterno separato per dominio mittente, recapito, errori e reputazione |
| Email transazionali | Produzione | Non verificato | Richiesti API key e mittente dal loader; non prova del dominio verificato | Controllare dominio e mittente, DNS email, worker e monitoraggio coda autorizzati |
| Firma OTP email | Staging / locale | Dipende dalla configurazione; consegna reale disabilitata | `configured` controlla soltanto la chiave di firma; test OTP provano integrità e consumo con sender simulato | Distinguere chiave, disponibilità email e worker nel blocco 4; nessuna promessa di email effettivamente inviata |
| Firma OTP email | Produzione | Non verificato | Flusso applicativo presente, nessuna consegna live esercitata | Chiave dedicata, conservazione documenti, email, worker e revisione del processo |
| Firma in presenza | Codice | Permesso/capacità mancante per il nuovo flusso richiesto | Esistono mark-signed e registrazioni firma; non equivalgono alla nuova raccolta grafica del cliente vincolata al PDF | Blocco 4: acquisizione firma, consenso, versione e PDF finale |
| PDF e storage | Locale / PostgreSQL sintetico | Non verificato sullo storage live | Test rendering, storage, download, congelamento, integrità e isolamento | Conservare originali e firmati; verifica visiva del nuovo modello nel blocco 5 |
| PDF e storage | Staging, ultima osservazione | Non verificato da questa tranche; precedente E2E riuscito | Precedente PDF/firma e storage locale documentati | Non dedurre recuperabilità e documenti reali da una sola generazione |
| PDF e storage | Produzione | Non verificato | Provider local/S3 nel codice; nessun bucket, disco o backup live letto | Verificare persistenza, quote, backup e ripristino prima di una futura attivazione |
| Profilo, logo, condizioni | Codice / locale | Dati per tenant non verificati | Servizio completezza, validatori aziendali e controllo dei dati per firma; PDF fattura di noleggio marcato bozza | Completare dati dell'esercente, logo valido, condizioni revisionate e campi obbligatori; blocco 5 |
| Profilo, logo, condizioni | Staging / produzione | Non verificato | Nessuna anagrafica personale o reale letta | Verifica nel tenant autorizzato; non inventare campi o clausole |
| CARGOS | Staging / provider QA | Disabilitato intenzionalmente; guardia mancante corretta localmente | Nuovo test blocca Token/Check/Send prima della rete; preflight comunica il blocco | Nessuna utenza API abilitata disponibile secondo Silvio; non riattivare trasporto |
| CARGOS e ricevute | Locale simulato | Non verificato sul servizio reale | Protocollo, concorrenza, esito incerto, ricevute e isolamento testati con risposte simulate | Utenza esercente abilitata, sedi/codici ufficiali e prova esterna autorizzata |
| CARGOS e ricevute | Produzione | Non verificato | Endpoint ufficiale e configurazione per tenant nel codice | Credenziali tenant cifrate, mappatura sedi, verifica tabelle/processo e attestazioni |
| Ruoli, sedi e licenze | Locale / PostgreSQL sintetico | Capacità dipendente da ruolo e licenza | Guardie API e suite tenant/sedi/permessi | Riutilizzare gli stessi controlli nelle future pagine; non confondere assenza permesso e provider mancante |
| Ruoli, sedi e licenze | Staging / produzione | Non verificato per l'utente che ha segnalato il problema | Nessuna nuova sessione/account reale ispezionato | Confermare ruolo/sedi/licenza tramite API autorizzata quando necessario |

## Sorgenti, endpoint e stati

### A. Abbonamenti Fleetum e flusso Stripe

- `backend/src/application/services/billing-service.ts`: checkout subscription,
  aggiornamento carta, portale e webhook; `TenantSubscription`, `BillingEvent`
  e fatture dell'abbonamento costituiscono un dominio separato dai noleggi.
- `POST /api/billing/checkout-session`, `/payment-method-session`,
  `/customer-portal-session`; `GET /api/billing/invoices` e relativo PDF.
- `POST /api/billing/webhook`: raw body salvato in `app.ts`, verifica della firma
  con `STRIPE_WEBHOOK_SECRET`, registro deduplicato e dispatch al gestore noleggi.
  Il ritorno frontend non attiva la licenza.
- Sei `STRIPE_PRICE_*` (tre piani, due periodicità), chiave e segreto webhook;
  portale configurabile con `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` e ritorno
  controllato. Il mock locale è subordinato a NODE_ENV e non è una prova Stripe.
- Test: billing-webhook, billing-dunning, platform-license-billing-link e suite
  persistente billing-subscription-concurrency-db. Nessuna nuova chiamata Stripe.

### B. Noleggi: carte, garanzie ed extra

- `rental-payment-service.ts`, controller/validator/route `rental-payments-*` e
  `frontend/.../RentalPaymentGuaranteePanel.tsx`.
- `GET /api/rental-payments/bookings/:bookingId/summary` legge i metodi del cliente,
  i depositi e gli extra della pratica. Ora aggiunge `capabilities.stripe` dopo
  la verifica dell'appartenenza/visibilità della prenotazione.
- POST setup-session, deposits, capture, release; extra create/approve/notify/
  charge/cancel. Il registro della carta è in modalità setup, non è un pagamento.
- `RentalCustomerPaymentProfile` è unico per tenant e cliente noleggio;
  `RentalCustomerPaymentMethod`, `RentalDeposit`, `RentalExtraCharge` e
  `RentalPaymentEvent` sono distinti dai customer/subscription SaaS.
- Customer, metodo, importo, valuta e metadata sono vincolati al record; i
  PaymentIntent correnti vengono riletti per non applicare ciecamente eventi
  vecchi. Chiavi idempotenti e claim del deposito limitano duplicazioni.
- Le prove coprono eventi duplicati/fuori ordine, errori incerti, importi,
  concorrenza, rifiuti, autenticazione necessaria e isolamento. Non attestano
  l'account destinatario o la configurazione di consegna webhook reali.
- **Aperto:** manca l'associazione persistente all'account dell'esercente. Nessun
  `stripeAccount`, `transfer_data` o `on_behalf_of` nei comandi individuati.
  Non è stata scelta una modalità Connect: dipende dal modello commerciale.
- **Aperto:** nessun confronto esplicito test/live nel servizio noleggi individuato;
  l'isolamento QA separato ha controlli propri. La futura associazione dei record
  deve includere ambiente e account, senza riusare identificativi incompatibili.
- **Aperto:** `STRIPE_SECRET_KEY` presente non garantisce il segreto webhook,
  gli eventi abilitati, la ricezione o le capacità dell'account. Il nuovo stato
  `configuration_present` dichiara esplicitamente `verification: not_performed`.
- **Aperto:** non viene salvato/esposto `capture_before` della charge. `authorizedAt`
  non è una scadenza. Lo stato `canceled` confluisce in rilascio senza distinguere
  chiaramente scadenza e annullamento. Blocco 3, nessuna durata inventata.
- **Aperto:** le route non offrono un rimborso operativo dedicato; gestire un evento
  `charge.refunded` non equivale a supportare l'intero comando di rimborso.

### C. Fonte degli importi e degli incassi

La base economica è nei campi expected/final della prenotazione e nel
`RentalBookingPricingSnapshot`, con infrastruttura di denaro esatto già presente.
Questi sono importi concordati o calcolati, non attestazioni di incasso.
L'`Invoice` persistita è usata per la fatturazione dell'abbonamento; la fattura
PDF del noleggio è una bozza derivata dalla prenotazione e non registra un pagamento.
Il riepilogo rental-payments comprende garanzie ed extra, non un ledger completo
del corrispettivo base. La ricerca tra schema, servizi, route e report non ha
individuato un registro degli incassi base: il blocco 3 dovrà definirne uno solo,
compatibile con le fonti già esistenti, senza reinterpretare prezzi come incassi.

Regola confermata: contratto creabile a zero, scontato o con residuo aperto;
conversione e incasso indipendenti. Il blocco 1 non cambia questo workflow né
aggiunge un prerequisito di pagamento. La generazione automatica attuale resta
da modificare nel blocco 4, comprese le API equivalenti.

### D. Email e OTP

- `email-sender.ts`: Resend unico; staging/provider-QA rifiutati prima dell'SDK,
  nessun falso invio riuscito. `RESEND_API_KEY`, `RESEND_FROM`, dominio mittente
  e worker della coda sono prerequisiti distinti.
- `EmailQueueService`, cron-bootstrap e dispatcher rivalutano idoneità, tenant,
  ruolo/sede, licenza e versione; pending/blocked/failed non equivalgono a sent.
- `contract-signing-service.ts` e `contract-signing-crypto.ts`: chiave autonoma
  `CONTRACT_SIGNING_KEY`, cifratura dei payload della coda e controllo della
  versione/documento. L'indicatore `configured` corrente verifica solo la chiave:
  non certifica il recapito email e va ampliato nel blocco 4.
- API private `.../:id/contract/signing` e pubbliche POST
  `/api/contracts/signing/{resolve,document,otp,confirm}`: origin, cookie browser,
  rate limit, durata, tentativi, consumo e ricevuta invio sono separati.
- Prove OTP con provider simulato, nessuna password/codice/credenziale reale.
  Firma disegnata, stampa e nuova conversione restano nel blocco 4/5.

### E. PDF, storage e dati dell'emittente

- `booking-contract-service`, `enterprise-contract-pdf-service`,
  `contract-signing-source`, evidence PDF e `storage-provider`.
- API `.../:id/contract/pdf`, evidence PDF, fattura noleggio draft.pdf;
  fatture abbonamento sotto billing. Non usare i due modelli fiscali in modo
  intercambiabile. I download rispettano tenant/sede e versione congelata.
- Storage locale o S3 con chiavi scoped, registro degli oggetti, quote e controlli
  dei percorsi; chiavi S3 vietate nello staging attuale. Provider disponibile non
  significa che il disco sia persistente o il backup recuperabile.
- `TenantProfileService` restituisce percentuale/campi mancanti; `TenantBranding`
  contiene logo e `TenantLegalSettings` le condizioni. La completezza non equivale
  a revisione legale o fiscale. `assertSigningReady` verifica emittente, cliente,
  conducenti, termini e dati economici, consentendo il totale zero.
- Contratti congelati e firmati non devono essere riscritti da pagamenti o nuovi
  render. La nuova versione professionale sarà renderizzata e ispezionata nel
  blocco 5; nessun nuovo modello PDF è stato introdotto qui.

### F. CARGOS e autorizzazioni

- `TenantCargosConnection`, chiave autonoma `CARGOS_DATA_ENCRYPTION_KEY`,
  credenziali cifrate per tenant e agenzie collegate a sedi attive.
- Route `.../cargos/configuration`, preflight, draft, check, transmit, history e
  ricevute PDF. Check valido non è invio accettato; esito UNKNOWN non consente
  ripetizione automatica. La ricevuta verificata rimane distinta dalla bozza.
- Prima del fix il trasporto non verificava l'ambiente. Adesso rifiuta ogni
  richiesta Token/Check/Send fuori produzione e il preflight spiega il blocco.
- La mancanza di utenza API comunicata da Silvio è un prerequisito esterno;
  non è stata creata né ricercata una credenziale. Nessuna comunicazione reale.
- Il codice attuale lega l'invio alla stipula registrata. Nel blocco 4 verificare
  l'evento del nuovo workflow e il congruo anticipo rispetto alla consegna,
  senza derivare un obbligo di attendere il pagamento o OTP dalla sola UI.
- API operative dopo auth, site-access, licenza e CSRF. Permessi distinti
  rental-payments:read/write/charge; billing:read/manage per abbonamenti;
  vehicles:read/write per contratti. Configurazione CARGOS e ricevute richiedono
  autorità amministrativa/visibilità aziendale. Non ampliare ruoli per nascondere
  un errore di configurazione. La permission refund esiste nel seed, ma non crea
  da sola un comando applicativo di rimborso.

## Correzioni del blocco 1 e compatibilità

| Before | After | Why |
| --- | --- | --- |
| UI proponeva setup carta senza conoscere il provider | Stato esplicito e pulsanti Stripe disabilitati se manca disponibilità | Evita azioni destinate a fallire; letture e preparazione extra restano disponibili |
| Provider assente rispondeva 500 | 503 con codice esistente; staging con codice distinto | Indisponibilità riconoscibile senza nascondere errori reali |
| CARGOS non verificava l'ambiente al confine rete | Blocco prima di Token/Check/Send e messaggio preflight | Isolamento anche se esistessero credenziali salvate |
| Mock UI senza informazione provider | Mock dichiara esplicitamente operazioni disabilitate | Nessuna simulazione spacciata per collegamento reale |

Risposta summary estesa in modo additivo. Frontend con un backend precedente
privo di capabilities blocca le sole azioni Stripe e chiede di aggiornare il
riepilogo; non inventa disponibilità. `configuration_present` mantiene il
comportamento già previsto dal servizio, non verifica account/beneficiario/webhook.
Nessuna migrazione, dipendenza, segreto, asset login o workflow GitHub modificato.

Rollback: ripristinare i soli commit applicativi del blocco, con review, senza
restore del database. Il rollback eliminerebbe anche la nuova guardia CARGOS:
valutarne il rischio prima di eseguirlo. Nessun rollback/deploy è stato effettuato.

## Checklist prima di prove esterne

1. Identificare esplicitamente il laboratorio: il profilo staging attuale vieta
   Stripe/Resend; non può ricevere chiavi senza cambiare e revisionare il modello
   di isolamento. Riutilizzare un laboratorio provider separato autorizzato.
2. Abbonamenti: account Fleetum, catalogo coerente, modalità test/live corretta,
   portale, webhook firmato, eventi necessari, deduplica e recupero consegne.
3. Noleggi: decidere chi è esercente/beneficiario e come il singolo autonoleggio
   riceve denaro; poi account/capacità, dati scoped e separazione dal SaaS.
   Non usare automaticamente la chiave dell'abbonamento per incassare per terzi.
4. Garanzie: scadenza effettiva restituita dal provider, SCA/azione richiesta,
   cattura/rilascio, esito incerto, rimborsi e riconciliazione.
5. Email: dominio e mittente verificati, chiave dedicata all'ambiente, coda,
   ricevute e osservabilità. Una riga in coda non attesta ricezione dal cliente.
6. Firma: chiave dedicata custodita, email e worker operativi, originali/versioni,
   conservazione delle evidenze e revisione del processo. Nessuna qualifica
   automatica di firma qualificata per un OTP o un disegno.
7. Emittente/documenti: dati aziendali corretti, logo valido, condizioni revisionate,
   prezzi/sconti, sedi, conducenti, storage persistente e ripristino documentato.
8. CARGOS: utenza esercente abilitata, credenziali tenant, agenzie e codici ufficiali,
   esiti/ricevute e prova autorizzata; pagamento non è un prerequisito presunto.
9. Ruoli/licenze/sedi: verificare azioni con operatore, manager e lettore nei due
   tenant sintetici prima di estendere le nuove pagine.

Questa è una checklist senza valori segreti, non un'autorizzazione ad attivare
provider o modificare ambienti esterni.

## Fonti primarie consultate il 6 novembre 2026

- [Stripe Connect: flussi e destinatari](https://docs.stripe.com/connect/charges):
  la scelta della tipologia determina distribuzione dei fondi e responsabilità;
  l'architettura deve seguire il modello commerciale, non la sola presenza di una chiave.
- [Stripe: autorizzazione e cattura](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method):
  usare il termine effettivo `capture_before`; non assumere una durata fissa.
- [Stripe: webhook](https://docs.stripe.com/webhooks): verificare firma e raw body,
  gestione duplicati, ordine non garantito e recupero dei fallimenti.
- [CARGOS: API ufficiali](https://cargos.poliziadistato.it/CARGOS_API/Help) e
  [manuale API rev. 01, 6 febbraio 2024](https://cargos.poliziadistato.it/Cargos_Portale/Download/Manuali/p2.pdf):
  Token, Check, Send, codifica e attestazioni. Il manuale riporta la comunicazione
  contestuale alla stipula e con congruo anticipo sulla consegna; non sostituisce
  la verifica del processo e dei requisiti applicabili prima dell'uso reale.

## Prove e prossima azione

Risultati locali: 594 test backend, 391 frontend, 896 database e 2 controlli
di protezione dell'anteprima superati, zero fallimenti o skip nelle esecuzioni
finali. Type-check backend/frontend, build e prerender frontend riusciti.
Quattordici prove mirate: prima 9 riuscite / 5 fallite, dopo 14/14 riuscite.
Browser Chromium: 16 varianti, 96 stati dei pulsanti, IT/EN, chiaro/scuro,
320/1440 px; nessuna scrittura provider, richiesta esterna o eccezione JavaScript.
Controllati visivamente i render desktop chiaro e mobile scuro.

Le prime esecuzioni dei test HTTP nel perimetro limitato hanno incontrato il
divieto di aprire porte loopback; i controlli finali sono stati eseguiti nel
contesto che consente i soli server locali autorizzati. Nel test browser sono
stati corretti la conservazione degli header sede e l'attesa del banner cookie,
senza cambiare le protezioni o i tempi applicativi per far passare le prove.

`verify:release` non eseguito in questo blocco: è previsto una volta sul candidato
finale dopo i cinque blocchi. Nessuna prova Stripe/email/CARGOS reale o nuovo E2E
staging. Le nuove capacità API non certificano configurazioni esterne.

Risultati finali, comandi, limiti, revisione del diff e riferimento del commit sono
registrati nella consegna `BLOCCO1_CONFIGURAZIONI_20261106.md` esterna al checkout.
Le suite locali non verificano provider, account o runtime reali.

Prossimo blocco: **2, notifiche compatte e tempi finiti**, nello stesso branch
isolato dopo questa consegna. Pagina pagamenti, registro incassi, conversione,
firma in presenza e nuovo PDF restano i blocchi 3–5 già concordati.
