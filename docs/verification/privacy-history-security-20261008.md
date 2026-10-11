# Fleetum — privacy e condizioni storiche, 8 ottobre 2026

## Esito e identità

Tranche pronta per revisione locale. Candidato `dbe8ada7d9f1a66b14dd0c4bc0ab3a5f46e90600`, tree `2d50f467364c83c7cc8d57e40490760d1a62b159`, parent `10484122c9d056e56b1d8424cb1366e1d5b03a23`, branch `codex/fix-privacy-history-20261008` nel checkout isolato `/Users/silvio/Documents/Playground/Fleetum-fix-scheduled-report-cursor`. Tre commit locali di correzione: `54d28db26e57d00691468807427e79b5c134491f`, `a92b0e2f379c90fe383663f7cef1f0b4503eb3e9`, `dbe8ada7d9f1a66b14dd0c4bc0ab3a5f46e90600`; il controller condiviso raccoglie pricing e lock cliente nel primo commit. HEAD documentale successivo distinto. Main invariato `db1f231dc8cb699f1a5ce4215a0278c93212d16d`. Nessun push, PR, merge, dispatch, SSH, deploy, email o pagamento reale. Nessun env reale o dato personale applicativo. Nuova UI rinviata.

## Correzioni ricontrollate

| Finding | Difetto riprodotto | Correzione | Stato locale |
|---|---|---|---|
| PRIV-01 | Export EmailQueue per indirizzo condiviso include reset, inviti e messaggi di altri soggetti | Tipo BOOKING_CONTRACT e catena booking/contratto/consegna del cliente; allowlist senza body, subject, lastError e meta | Corretto, unit e PostgreSQL |
| PRIV-02 | Upload iniziato prima erasure aggiunge allegato; discovery precedente alla transazione può perdere tombstone | Tenant KEY SHARE → cliente NO KEY UPDATE; revalidation upload, discovery e tombstone nella transazione; compensation storage | Corretto, due ordini concorrenti su PostgreSQL |
| PRIV-02 percorso equivalente | Edit cliente validato prima erasure può riscrivere PII dopo anonimizzazione | Lettura piena, validazione business/indirizzi e update sotto lo stesso lock cliente | Corretto, RED e due ordini PostgreSQL |
| PRIV-03 | Cron si ferma a500 e un errore interrompe gli altri tenant | Pagine id ASC con cursore/upper bound, errori isolati e conteggi, guard contro overlap nello stesso processo | Corretto, 5 test callback con mock |
| BE-03 edit | Note e snapshot tardivi sovrascrivono override o ricaricano listino corrente | Nessun expectedTotal implicito o pricing PATCH operativo; repricing esplicito; richieste obsolete ignorate | Corretto nel flusso corrente; finding complessivo parziale |
| TOOL-01 | npm audit JSON di errore può essere dichiarato PASS; processi senza timeout | Risposta audit v2 completa e coerente, controllo errori/exit/signal e timeout120s | Corretto, 13 test senza rete e gate release |
| BE-03 km/note pricing | Endpoint pricing ricalcola sempre dal listino live | preserveTerms:true validato, snapshot riletto sotto lock booking, quote dai metadata congelati e campi sparsi | Corretto, unit/controller/PostgreSQL |

Export cambia intenzionalmente la forma dei receipt EmailQueue: niente contenuto raw o messaggi credenziali. Le copie della consegna contrattuale già collegate restano nel relativo export; la sola coincidenza di email non attribuisce una comunicazione al soggetto.

Erasure mantiene il comportamento deleteAttachments:false. Il lock NO KEY UPDATE serializza i writer del cliente e lascia compatibili i KEY SHARE delle FK di prenotazioni conservate. Discovery allegati e marcatura dei metadati storage sono nello stesso commit; una cancellazione fisica fallita conserva tombstone per retry, senza rendere scaricabile la relazione eliminata. Tenant, permessi, CSRF, licenze e provider rimangono nei rispettivi confini.

## Contratto pricing

Il PATCH esistente senza preserveTerms (o false) mantiene la riprezzatura esplicita. Il nuovo modo true accetta soltanto estimatedKm, actualKm e notes; rifiuta ID listino/package/policy e campi estranei. Campi omessi invariati; null esplicito svuota km, stringa vuota cancella note. Nessuna lettura accessoria del listino live nel ramo operativo. Rilettura booking/snapshot sotto l'ordine di lock già usato da update/close; guard updatedAt impedisce una mutazione basata su booking cambiata.

ExpectedTotal della booking, inclusi override manuali e zero, resta invariato. Solo note non riscrivono quote/importi. Km modificati ricalcolano i derivati da termini congelati; finalTotal booking cambia soltanto con actualKm esplicito. ActualKm:null azzera finali operativi quando i metadata sono autorevoli. Snapshot legacy non ricostruibile conserva importi e risponde quote:null; snapshot assente produce errore409 esplicito per il modo preserve. Nessuna nuova disciplina di rettifica di contratti firmati/chiusi o prolungamenti inventata.

La UI conserva creazione/preview/idempotenza esistenti. In edit l'azione Modifica condizioni economiche o una selezione economica abilita il flusso live; km/note pricing toccati inviano solo preserveTerms e campi modificati. Gli aggiornamenti solo operativi usano un unico PATCH booking. Gli edit economici/km-note pricing rimangono due chiamate (booking poi pricing): un errore della seconda può lasciare la prima applicata. Non si dichiara atomicità fra endpoint.

## Prove eseguite

- `npm run verify:release`: **766/766**, backend 372, frontend 107, website 9, operations 278; zero fail/skip, lint, build, prerender13 e audit con parser fail-closed e policy high/critical invariata. Compilazioni in NODE_ENV=production, test backend NODE_ENV=test.
- `npm run verify:database`: **564/564**, zero fail/skip, 48 migrazioni esistenti e riconciliazione monetaria. PostgreSQL16 temporaneo da immagine cache verificata, porta casuale solo loopback, upload temporanei e dati sintetici. Nuovi fixture: soggetto7 casi e pricing5 casi; router upload/controller reali, auth sintetica esplicitamente iniettata, nessuna nuova prova del middleware auth/CSRF da questi fixture.
- Chromium locale sul frontend realmente compilato: **4/4** casi. API e persistenza browser sono simulate; body registrati dimostrano omissione del prezzo, preserveTerms e scelta esplicita. Backend persistente verificato separatamente da PostgreSQL. Nessuna prova browser di provider, TLS, CSP live, staging o produzione. Browser eseguito sul candidato applicativo `a92b0e2f379c90fe383663f7cef1f0b4503eb3e9`; il candidato finale aggiunge soltanto due file ops. Equivalenza byte dei sorgenti applicativi e manifest frontend ricompilato verificata separatamente.
- RED originali conservati: privacy2 difetti su3 casi; cron4/4; frontend4/4 più race snapshot:null1/1; pricing11/12 e cliente4/4 più caso erasure1/1 distinto. Audit tooling RED13 casi (4PASS/9FAIL), GREEN13/13. GREEN mirati conservati, senza sommarli nuovamente ai gate completi. Il quinto test cron e alcuni test estesi sono stati aggiunti dopo il primo RED, senza attribuire loro RED precedente.
- Review incrociate statiche con hash finali, compresa correzione P2 snapshot:null tardivo; root controlla manifest di tutti20 file, scope, source freeze invariato e diff senza whitespace error. Le review statiche non costituiscono una prova runtime.

Ambiente: Node22.23.1/npm10.9.8, macOS arm64; npm ci offline con script lifecycle disabilitati, dotenv /dev/null e configurazione npm vuota. Script run-release.py/run-database.py e receipt documentano i comandi/variabili sintetiche. Source freeze finale identico prima/dopo entrambi i gate. Il primo gate release fallito per sette inizializzazioni Prisma è conservato: una libreria cache era stata copiata con basename non canonico; stesso binario/hash ripristinato nel percorso runtime temporaneo, nessun cambiamento applicativo. Successivo gate753/753 storico precede il fix ops; i numeri sopra si riferiscono al nuovo gate finale. Cleanup proprio verificato: database/container, storage scratch, server browser e sessione Chromium di test. Nessun processo altrui rimosso.

## Migrazioni, rollback e limiti

Zero migrazioni, modifiche di schema, dipendenze/lock, workflow, provider o configurazione di produzione. Nessun rollback SQL. Revert del codice ripristina i difetti; richiede revisione. Le policy/durate e l'attivazione reale della retention restano da approvare: flag cron non cambiati, nessuna cancellazione di PlatformSecurityEvent autorevole. Il guard cron è per processo; scheduling multi-replica/distribuito rimane un requisito operativo aperto.

Registro originale37 invariato:26 risolti nel codice,2 parziali (BE-03/SEC-10),4 nel redesign,5 nel marketing. PRIV-01…03 sono residui tecnici aggiuntivi. BE-03 rimane parziale per contratti legacy non ricostruibili e disciplina storica/rettifiche; SEC-10 per decisioni privacy/attivazione. Restano storage bearer Platform/sessionStorage, CSP script/produzione, crescita/costo eventi revoca e SLA/provider/cookie live.

**0/19 gate esterni PASS**: owner, hosted CI, approvazioni, soglie/budget, staging e provider reali rimangono aperti. Il recovery7 ottobre è storico: l'applicazione di questa tranche cambia, quindi la riserva dabbb e il recovery precedente non attestano i nuovi fix. Prima di installazione occorre aggiornare coppia applicazione/client e riserva, poi verificare recovery sul nuovo candidato; nessun fallback OCI distinto approvato. Nessun merge main per avviare CI.

## File e integrità

- `backend/src/application/services/privacy-compliance-service.ts` — SHA256 `4af9d634e8329f3252f291c45e38baa729479cdb4e5d363408d32ad90c062bfa`
- `backend/src/application/services/rental-pricing-operations.ts` — SHA256 `b8cde03852c47fb142ce1083f1490f94118dfb43187e2ac08fa940cfc5534ac0`
- `backend/src/infrastructure/cron/privacy-retention-cron.ts` — SHA256 `b4eab3033c0c63ec607c07447d3a453414adf40246431bac1660f29d522ee84a`
- `backend/src/infrastructure/repositories/rental-customer-tenant-scope.ts` — SHA256 `b65f2951caa0feb24f366cb68ad0ca5081dba0ab04e2cd22ec1999b2371832bd`
- `backend/src/interfaces/http/controllers/rental-bookings-controller.ts` — SHA256 `8dc5878af4911b4f38951eb78f259b21bedc87297217913d54432dc6c6953ad5`
- `backend/src/interfaces/http/routes/uploads-routes.ts` — SHA256 `a35c884763188b1a4b4d7fa32830eb6f2a30e4f532ab3f1da68c33ff04331926`
- `backend/src/interfaces/http/validators/rental-bookings-validators.ts` — SHA256 `abdf90b8353589165aa7dfd308299c83413ea9a0167c31c20a9d14c094fad29a`
- `backend/tests/privacy-anonymization.test.ts` — SHA256 `ff10ee254befc5934031043198fa6fd99a51402aa35051f5d082bc7e8cb0cf49`
- `backend/tests/privacy-customer-update.test.ts` — SHA256 `8465ce27e23ad51ec02a82df993de673c52ad883c1b194d9beef53f939b3a4a0`
- `backend/tests/privacy-data-export.test.ts` — SHA256 `59429739e0b8199e0122b1599afef29cf8f24de3804cd0ab78acde6cb1854312`
- `backend/tests/privacy-retention-cron.test.ts` — SHA256 `a2ca1f30ae7fad41995634490b332ebce081b104c19b63f5539faa0bf7302941`
- `backend/tests/rental-booking-pricing-operations.test.ts` — SHA256 `b8dd3a2b5e539a0a8b2b74d395fad2384c01faad2c9ba19d2bf8df5146f250f2`
- `backend/tests/rental-customer-update-fence.test.ts` — SHA256 `7f54451011a1c0d679354283d2e537f6fc17e248e306c2e97c7a1ca43f646f2d`
- `backend/tests/security/privacy-subject-races.postgres.test.ts` — SHA256 `ee196457c2aaf0ff61ff78593baacf9b750243c51ba69d5759547e3dd9d5553a`
- `backend/tests/security/rental-pricing-preserve.postgres.test.ts` — SHA256 `585f2205ffac7412b2118a4ed92eef985121445e2374426beaba469f61d26497`
- `frontend/src/application/usecases/rental-bookings-usecases.ts` — SHA256 `5a660505949e270b2db568b5c0576809db6b025a56583b4508b808529ab6ee7b`
- `frontend/src/presentation/pages/bookings/rental-bookings-page.tsx` — SHA256 `dee98277dd035a589a12d4966fde25ecbae697806ad064a041da968a6bc1bacc`
- `frontend/tests/rental-booking-pricing-edit.test.ts` — SHA256 `26c52373b4450b421d16b21422b30a47f45c029c5ca7d749892ff56988029c76`
- `ops/audit-production-dependencies.mjs` — SHA256 `a2066d585f9b9689652253bbb0bc229e5b940a18ca0ee70a4f6fde3a3df786f2`
- `ops/tests/audit-production-dependencies.test.mjs` — SHA256 `9aad39d141353177ff9c2f58a19b9330cf2c8692d9b5a72ce0e527e913853000`

Bundle `evidence/20261008-privacy-history-security` con log, RED/GREEN, manifest, diff e script. SHA256SUMS verifica integrità dei contenuti, non autenticità indipendente. La consegna conserva prove e manifest dei build, non una coppia OCI o una release installabile. Prossima azione: revisione conclusiva del candidato e aggiornamento della prova di recovery prima dei gate esterni.
