# Notifiche extra: autorizzazione, comando unico e prova di invio

Tranche locale del 1 ottobre 2026, branch `codex/fix-extra-charge-notice-atomicity`.
Parent `4a2e77693c0f2ca6fa9d66ee82c61c33d6e4a028`. Checkout isolato
`/Users/silvio/Documents/Playground/Fleetum-fix-scheduled-report-cursor`.
Nessuna migrazione, backfill, modifica provider o redesign UI.

## Regole del dominio

- Nuova notifica soltanto per extra APPROVED, appartenente al tenant e non cancellato.
  Prenotazione e cliente devono essere owned, non cancellati, correlati all'extra;
  booking CANCELED non ammette un nuovo preavviso. CLOSED resta ammesso.
- Veicolo e sede storici owned possono essere inattivi o cancellati. Il veicolo
  opzionale dell'extra, se presente, deve coincidere con quello della prenotazione.
- L'attore della nuova richiesta deve essere owned, ACTIVE e non cancellato.
  Gli autori storici sono controllati per ownership senza lock User, evitando
  l'inversione con i lock di autenticazione. Nessun nuovo permesso economico.
- Tenant attivo e non cancellato, licenza ACTIVE/TRIAL corrente: stessa policy
  persistente/legacy già usata dall'applicazione. Nessun nuovo feature flag.
- Preparazione significa EmailQueue + audit `RENTAL_EXTRA_CHARGE_NOTICE_QUEUED`
  nella stessa transazione. Non cambia APPROVED né notifiedAt.
- Una sola richiesta logica per tenant/extra, serializzata sulla riga extra.
  DeduplicationKey v1 già disponibile; l'audit persistente impedisce un secondo
  comando anche dopo il purge privacy di chiave, contenuto e metadata della coda.
- Retry pubblico riusa il comando. Non riapre FAILED/bloccati/purgati e non crea
  nuove generazioni: un eventuale reinvio manuale richiede un flusso distinto.
- Worker rivaluta il contesto e il destinatario prima di iniziare il provider.
  Il fingerprint include identità, veicolo/sede, importi, valuta, causale e testo;
  usa ordine fisso dei campi per PostgreSQL JSONB. Non include updatedAt arbitrari.
  Campi html/replyTo/fromName/attachments non previsti nel preavviso sono bloccati.
- Mutazioni del contesto, pagamento/annullamento precedente all'invio, tenant
  sospeso o cambio stato Platform dalla creazione bloccano il nuovo invio:
  FAILED con codice, zero tentativi provider, lease liberata, nessun reinvio automatico.
- NOTIFIED e notifiedAt derivano da ricevuta provider con identificativo verificabile.
  Coda SENT, stato extra e audit `RENTAL_EXTRA_CHARGE_NOTIFIED` committano insieme.
  Significa accettazione da parte del servizio email, non consegna o lettura del cliente.
- Una ricevuta salvata salta il provider e recupera solo la finalizzazione locale,
  anche dopo sospensione tenant. Conserva PAID/CANCELED e gli altri stati economici.
  Target cancellati/incoerenti e ricevute legacy/incomplete non inventano prova dominio.
- Il tipo dichiarato della coda controlla gli effetti: metadata condivisi non
  aggiornano contratti, fatture o reminder da una notifica extra.

## Concorrenza e limiti

Ordine: Tenant/licenza → Extra → Vehicle → Site → Booking → Customer → Queue.
Vehicle precede Booking come nelle mutazioni della prenotazione. Finalizzazione
di ricevute accettate: Tenant KEY SHARE → Extra → Queue. Anonimizzazione prende
Tenant KEY SHARE prima di Booking/Customer e dell'audit con FK tenant.
La richiesta network viene iniziata sotto le guardie; l'attesa avviene dopo il
rilascio dei lock. Aggiornamenti successivi all'inizio non possono ritirare un'email
già accettata. La scadenza temporale viene ricontrollata prima dell'invio.

Chiave provider stabile `fleetum-email-queue:<id>` e recupero della ricevuta
riducono i duplicati. Un crash fra accettazione esterna e salvataggio della ricevuta
resta un confine distribuito: collaudare la finestra di idempotenza e i timeout
del provider in test mode. Nessuna promessa di exactly-once su sistemi esterni.
Trasferimenti tenant, hard delete e scritture SQL esterne restano fuori protocollo.

La UI espone NONE/PENDING/SENT/FAILED/BLOCKED/LEGACY_UNVERIFIED senza cambiare
lo stato economico. Disabilita richieste duplicate; gli extra legacy NOTIFIED
sono indicati da verificare, senza un backfill automatico. Sono preservati
approvazione, addebito, rimborsi e webhook preesistenti.

## Verifica e gate di rilascio

Evidenze, comandi, conteggi RED/GREEN, diff, hash, SHA finale e revisione:
`Fleetum-audit-20260909/evidence/20261001-extra-charge-notice-atomicity/README.md`
nel workspace. Ambiente Node 22.23.1/npm 10.9.8, PostgreSQL 16 temporaneo, soli
dati sintetici e sender simulato. Nessun env reale o invio provider.

Prima di pubblicare: review umana, CI sullo SHA esatto, staging con due tenant
sintetici, carico/contesa e recovery worker, provider in test mode; verificare
contratti/fatture/reminder/report e flussi account/billing. Inventariare le vecchie
code extra senza contesto v1: verranno bloccate senza nuovi invii. Eventuale
quarantena/ricostruzione è un'operazione autorizzata separata, non un replay.
Le ricevute legacy salvate possono completare la coda senza segnare il dominio.
Restano i gate precedenti storage/upload, proxy/CDN/WAF, privacy/retention e marketing.
La versione live VPS non viene verificata da questa tranche.

## Rollback

Solo applicativo al parent, senza migrazioni o cancellazione/compensazione dati.
Coordinare API e worker: il vecchio producer anticipa NOTIFIED e il vecchio worker
ignora le guardie v1. Un rollback reintroduce i difetti e può elaborare payload
nuovi con regole vecchie; valutare pausa controllata dei job extra prima della
versione precedente. Non riaprire SENT/FAILED, non eliminare audit o deduplica,
non riaccodare email o modificare pagamenti automaticamente.

Consegna locale senza push, PR, merge o deploy.
