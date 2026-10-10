# Reminder email — controllo tenant, licenza e concorrenza

## Perimetro e comportamento

Checkout isolato `Fleetum-fix-scheduled-report-cursor`, branch `codex/fix-reminder-email-security`, base `e30e972fa70e2aea06424188e65a9175580cae04`. Sono protetti i produttori email manuale/bulk e automatico e il worker `REMINDER_EMAIL`, compresi `MANUAL_RETRY`/`AUTOMATIC_RETRY` preesistenti. Non ci sono nuovi vincoli commerciali: tutti i piani con licenza `ACTIVE` o `TRIAL` non scaduta restano idonei, tramite la stessa `LicensePolicyService` e il fallback audit legacy. Il catalogo non attribuisce i reminder esistenti alla feature Enterprise `automations_advanced`.

La discovery automatica esclude tenant sospesi/cancellati e restituisce solo identificativi. Prima di comporre il messaggio, il produttore legge il fermo sotto lock, verifica ownership di fermo/sede/veicolo/officina e cancellazione, poi legge i dettagli delle relazioni. Officina inattiva blocca; sede o veicolo inattivi ma non cancellati restano validi su un fermo operativo. La scadenza e il playbook corrente vengono ricontrollati sotto lock. Un fermo chiuso/cancellato non genera un automatico; un manuale esplicito su CLOSED resta possibile secondo il comportamento preesistente, senza riaprire il fermo.

Tutti i nuovi invii email passano da una riga di coda e dal worker immediato con chiave provider `fleetum-email-queue:<id>`. Il risultato manuale conserva `success`/`queued`; una decisione di blocco restituisce un errore senza dati del fermo. Il worker ricontrolla stato tenant, licenza, relazioni, destinatario corrente e scadenza automatica. Una transizione Platform dopo l'accodamento blocca anche un vecchio retry dopo riattivazione. Il blocco di policy e' terminale `FAILED`, usa `REMINDER_DISPATCH_BLOCKED:<codice>`/`dispatchBlockedReason`/`dispatchBlockedAt`, rilascia la lease e non incrementa i tentativi provider o la storia dei reminder.

## Deduplica, lock e ricevute

Producer e dispatcher prendono Tenant → TenantSubscription → Stoppage → Site/Vehicle/Workshop → EmailQueue. Tenant e' SHARE con subscription presente, UPDATE nel fallback legacy per impedire un inserimento concorrente; la subscription e il fermo sono protetti prima della decisione. Producer automatici concorrenti serializzano ricontrollo due, lookup di tutti i PENDING automatici per lo stesso tenant/fermo (anche legacy leased/in backoff) e inserimento. Le vecchie righe non vengono duplicate o anticipate dal producer: restano al worker periodico, che recupera le lease scadute. La finalizzazione prende Tenant KEY SHARE → Stoppage tenant-scoped UPDATE → EmailQueue CAS, evitando l'inversione causata dalla FK di Reminder durante il fallback legacy. Il cron usa anche `noOverlap` nel singolo processo.

Il sender deve iniziare la richiesta in modo sincrono prima di restituire la Promise, contratto protetto dal test Resend esistente. Il worker lo chiama sotto lock e osserva subito le rejection, ma attende la rete fuori dalla transazione. Una sospensione/chiusura committata prima della decisione impedisce il nuovo automatico. Una richiesta gia' iniziata puo' completarsi dopo sospensione/chiusura: non e' revocabile dall'applicazione. MaxWait 5s, timeout transazione 10s, lease 15 minuti; pause/crash oltre queste finestre continuano a dipendere da idempotenza del provider e ricevuta, senza atomicita' distribuita promessa.

Una ricevuta `resend`/`providerMessageId` persistita bypassa solo il controllo di idoneita', per finalizzare un invio gia' accettato senza reinvio. Il successo e il counter vengono registrati una volta sotto CAS; CLOSED/CANCELED e closedAt vengono preservati. Una riga soft-deleted non riceve nuove mutazioni di lifecycle/counter, ma conserva la prova dell'invio realmente accettato. Un fermo mancante/di altro tenant non viene mutato e non riceve un Reminder: la coda finalizza la ricevuta con `localFinalizationSkippedReason`.

Il fallimento reale del sender produce `Reminder(success:false)` atomico con la release/retry della coda, sempre su fermo del tenant corretto; preserva inbox notifiche e KPI esistenti. Policy denial, errori pre-provider e retry di sola finalizzazione non creano failure fittizie. Il retry riuscito aggiunge una sola success e conserva la failure storica. Payload e retention seguono le regole gia' esistenti.

## Evidenze, rollback e gate

Prima della correzione: nuova suite 35 casi, 32 FAIL e 3 PASS. Una review ha trovato la regressione della failure history e un test dedicato ha riprodotto 2 FAIL su 40, poi la correzione atomica ha portato reminder/coda/report a 75/75 PASS. Un test iniziale della lease tentava il recupero con il solo producer: e' stato corretto usando il worker consumer, conservando le attese su riga unica, chiave e contatori. L'estensione finale copre anche rollback reale del guard, perdita della conferma commit e rejection immediata: **78/78 PASS**, inclusi **43** casi reminder. Tutti i test persistenti usano PostgreSQL 16 temporaneo e dati sintetici; nessun env reale, dato personale, pagamento o provider reale.

Gate conclusi il **1 ottobre 2026**, Node `22.23.1` e npm `10.9.8`, sulla copia stabile `/private/tmp/fleetum-be08-validation`:

- `npm run verify:database`: **126/126 PASS**, 48 migrazioni da zero, 52 secondi; ambiente temporaneo rimosso automaticamente. Anche il container separato dei test mirati e' stato rimosso.
- `npm run verify:release`: **PASS**, backend 217/217, frontend 31/31, website 9/9, operations 31/31, lint/build e verifica di 13 pagine prerenderizzate.
- `npm audit --omit=dev --json`: **zero vulnerabilita'**. Il primo tentativo non raggiungeva il registro; il retry autorizzato ha restituito il JSON completo.
- Revisione finale indipendente di codice e runbook: nessun blocco residuo nel perimetro. `git diff --cached <parent> --check` e confronto mirato tra sorgenti verificati, checkout e blob del commit documentati nelle evidenze.

Log RED/GREEN, comandi riproducibili, diff, SHA e manifest di integrita' sono in `Fleetum-audit-20260909/evidence/20260930-reminder-email-security/`; branch e commit finali nel documento `FLEETUM_RIPRESA_20260909.md`. Il gate database inizialmente non eseguito per limite di utilizzo della revisione automatica e' stato completato al nuovo tentativo, senza aggirare l'approvazione.

Nessuna nuova migrazione/backfill. Rollback applicativo ripristina il produttore precedente, che bypassa questi controlli: sospendere scheduler/worker prima di valutarlo. Le righe gia' accodate conservano il formato `REMINDER_EMAIL` compatibile, ma un vecchio worker puo' riaprire un fermo chiuso e saltare la policy. Non riaprire automaticamente i blocchi FAILED e non sovrapporre vecchi/nuovi producer. Staging deve esercitare account/billing/report e template email oltre a queste prove backend; non e' stata cambiata la UI.

Restano CI ospitata sullo SHA finale, review umana, staging con due tenant sintetici, misura latenza/contesa con coda realistica e provider in test mode. Nessuna verifica della release live VPS, push, PR, merge o deploy.

## Finding distinti ancora aperti

- `RENTAL_EXTRA_CHARGE_NOTICE` con bookingId viene interpretata dalla classificazione generica come contratto incompleto: intervento successivo separato.
- Creazione/aggiornamento e letture generali dei fermi richiedono un audit dell'ownership di siteId/vehicleId/workshopId: lo schema ammette FK per ID senza vincolo tenant composito. Questa guard impedisce l'invio di quei record, non corregge gli altri endpoint.
- Lo storico completo dei cambi licenza durante un fermo non e' ricostruito: viene autorizzata la licenza corrente; lo storico delle transizioni Platform del tenant segue la policy prudente sopra.
