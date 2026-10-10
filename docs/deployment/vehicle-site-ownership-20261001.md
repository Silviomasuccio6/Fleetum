# Fleetum — isolamento veicoli e sedi

Tranche del 1 ottobre 2026, branch `codex/fix-vehicle-site-ownership`, parent
`cf74391211b15b2e8a153c044e25fd798a11dad2`. Checkout isolato
`/Users/silvio/Documents/Playground/Fleetum-fix-scheduled-report-cursor`.

## Regole del dominio e correzioni

Un veicolo deve appartenere alla stessa azienda della propria sede. I nuovi
collegamenti e le importazioni richiedono una sede esistente, owned e non
cancellata. Una sede inattiva rimane selezionabile, come nel prodotto attuale.
Una sede owned cancellata resta leggibile nello storico e permette modifiche
agli altri campi del veicolo e la cancellazione del veicolo. La sede operativa
di un fermo può essere diversa dalla sede del veicolo, purché entrambe siano owned.

Un target estraneo, mancante o legacy incoerente viene rifiutato prima della
mutazione, anche se il PATCH tenterebbe di ripararlo. Nessuna bonifica automatica.
Tenant, identità, timestamp, soft deletion e relazioni annidate non sono campi
scrivibili dei repository veicoli e sedi. Gli operatori Prisma non sono input di dominio.

Le letture autorizzano anche la sede prima di count, paginazione e aggregazioni.
Copertura: repository veicoli, booking e disponibilità, contratti e monitoraggio,
statistiche clienti SQL, manutenzioni/scadenze/calendario, pricing riferito a un
veicolo, allegati/foto/libretti, dashboard, notifiche, report di redditività,
report programmati ORM/SQL, export privacy e percorsi fermi/reminder.
Le viste amministrative Platform cross tenant rimangono distinte.

Create/update/delete veicoli e importazioni ricontrollano i collegamenti nella
transazione. Tenant KEY SHARE, parent Vehicle UPDATE, Site SHARE stabilizzano
autorizzazione e scrittura. Il batch CSV autorizza tutte le sedi, ordinate per ID,
prima di inserire: una sede non più valida annulla l'intero batch.
Manutenzioni e allegati ricontrollano il parent prima del commit; l'analisi
fatture svolge il parsing fuori dai lock e autorizza nuovamente la persistenza.
Il reminder mantiene il lookup utenti storico senza SHARE, per preservare la
correzione del deadlock Auth→Tenant della tranche precedente.

Chiusura e ricalcolo pricing usano lo stesso serializzatore booking/schedule e
ordine di lock Vehicle → Booking → PricingSnapshot. Una versione cambiata fra
calcolo e lock produce `409 BOOKING_CHANGED`, da ricaricare e riprovare. Stato,
snapshot, chilometraggio e nota della transizione sono atomici: un errore tardivo
non lascia una prenotazione chiusa o un prezzo aggiornato parzialmente.

Le targhe dei veicoli legacy incoerenti restano riservate mediante un controllo
interno che non espone ID o sedi. Non esiste una nuova unique tenant/targa:
la concorrenza dei duplicati rimane un finding distinto.

## Impatto e limiti

Nessuna migrazione, nuovo vincolo, backfill, dipendenza o integrazione UI.
Le righe legacy incoerenti diventano invisibili ai consumer protetti; una
eventuale riparazione richiede una procedura separata con provenienza verificata.
Non leggere o bonificare dati reali attraverso questi script di test.

I body, PDF e allegati già precomposti nelle code non vengono ricostruiti.
La tranche protegge le nuove letture/preparazioni e il contesto corrente dei
reminder, non certifica tutti i vecchi payload. Prima del rollout serve una
revisione ed eventuale quarantena autorizzata, senza replay automatico.
L'atomicità dei comandi email/contratti e delle notifiche extra segue i relativi
gate separati; non dichiarare questi flow integralmente risolti da questo scope.

Gli ownership check sono applicativi. Trasferimenti tenant e hard delete via
SQL esterno richiedono un protocollo coordinato o vincoli compositi, fuori da
questa tranche. Le letture multi-query non promettono uno snapshot unico sotto
SQL esterno concorrente. Non vengono corretti riferimenti customer/pricing-site
estranei al legame Vehicle→Site.

## Verifica e rollout

Evidenze finali con comandi, risultati, diff e checksum:
`/Users/silvio/Documents/Playground/Fleetum-audit-20260909/evidence/20261001-vehicle-site-ownership/README.md`.
Ambiente: Node 22.23.1, npm 10.9.8, PostgreSQL 16-alpine temporaneo,
48 migrazioni da zero, soli dati sintetici e sender simulato;
DOTENV_CONFIG_PATH=/dev/null. Nessun provider o env reale.

Prima di produzione: review umana, CI ospitata sullo SHA finale, staging con due
tenant sintetici, prove foto/libretto/allegati e cleanup storage, contratti e
calendario, misura contesa/timeout e query count/search/report, verifica code
legacy e regressioni account/billing/Platform. Restano i gate esterni proxy,
privacy/retention e marketing. Nessuna verifica della versione live VPS.

Non effettuati push, PR, merge, deploy, pagamento o invio reale. La tranche
può essere pronta per review locale solo dopo i gate attestati nelle evidenze.

## Rollback

Rollback solo applicativo al parent; nessun rollback DB richiesto. Il parent
reintroduce i controlli mancanti: coordinare API e worker ed evitare versioni
con comportamenti diversi nello stesso rollout. Non riaprire FAILED o
compensare errori email cambiando pagamenti. Nessun replay o bonifica automatica.

Prossima tranche: guard al dispatch, atomicità e significato di `NOTIFIED`
per le notifiche extra, con prove RED e compatibilità dei retry/receipt.
