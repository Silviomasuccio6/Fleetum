# Chiusura blocker applicativi finali — 25 settembre 2026

## Scopo

Questa tranche chiude i blocker applicativi BE-06, BE-07, FE-03 e FE-04 rilevati dalla verifica pre-produzione. Il lavoro resta isolato nel branch `codex/fix-final-release-blockers` e non include il redesign UI.

## Comportamento introdotto

- La creazione di una prenotazione richiede una chiave di idempotenza per tentativo. Due richieste concorrenti con la stessa chiave producono una sola prenotazione; il riuso con payload diverso viene rifiutato.
- Prenotazione, nota, contratto, evento iniziale e registro di idempotenza vengono salvati nella stessa transazione. Un errore in qualsiasi passaggio annulla l'intera operazione.
- La coda email assegna ogni lavoro con un lease atomico e impedisce a due worker di elaborare lo stesso record contemporaneamente.
- Gli invii di contratto e fattura e la richiesta demo usano una chiave di comando persistente. Delivery, lead, consenso analytics e riga di coda vengono creati nella stessa transazione; retry concorrenti recuperano lo stesso risultato.
- L'accettazione del provider e la finalizzazione locale sono separate in modo recuperabile: se il provider accetta il messaggio ma la transazione locale fallisce, il retry completa solo lo stato locale usando la ricevuta già memorizzata e non invia una seconda email.
- Lo stato finale della coda e quello del dominio vengono aggiornati nella stessa transazione e sempre con vincoli tenant.
- Le pagine CRUD ignorano risposte di ricerca obsolete, impediscono submit concorrenti e ricaricano la query attualmente visibile dopo una mutazione.

## Migrazione

La migrazione `20260921150000_final_release_blocker_atomicity` è additiva e non modifica dati esistenti:

1. aggiunge a `EmailQueue` i campi nullable `processingToken`, `processingStartedAt` e `leaseExpiresAt`, più l'indice usato per selezionare i lavori disponibili;
2. crea `RentalBookingCreateRequest`, con unicità per coppia tenant/chiave e per prenotazione;
3. crea `BookingContractEmailRequest` e `InvoiceEmailRequest`, con collegamento univoco a delivery e riga di coda;
4. aggiunge a `DemoLead` i campi nullable `idempotencyKey` e `requestHash` e rende univoche le nuove chiavi non nulle;
5. collega i registri ai rispettivi tenant e record operativi con cancellazione a cascata.

L'applicazione della migrazione non avvia worker, non invia email e non crea prenotazioni. I record storici della coda mantengono i nuovi campi a `NULL` e risultano immediatamente elaborabili secondo le regole esistenti.

## Ordine di rilascio richiesto

Il backend richiede l'header `x-idempotency-key` nella creazione delle prenotazioni, nell'invio di contratti e fatture e nella richiesta demo pubblica. La release deve quindi coordinare frontend, sito pubblico e backend:

1. applicare la migrazione sul database di staging;
2. distribuire frontend e backend costruiti dallo stesso commit, oppure distribuire prima il frontend e attendere l'invalidazione della cache degli asset;
3. forzare un refresh delle sessioni browser ancora servite da bundle precedenti;
4. eseguire smoke test con due tenant sintetici, inclusi retry della creazione e invio email tramite provider in test mode;
5. controllare risposte 400/409 sulla creazione booking, righe `EmailQueue` in `PENDING`, lease scaduti e ricevute provider accettate ma non ancora finalizzate.

Non è sicuro distribuire il nuovo backend mentre client esterni o bundle precedenti continuano a creare prenotazioni senza la chiave richiesta. Gli eventuali client API devono essere aggiornati nello stesso piano di rilascio.

## Rollback

Prima di rimuovere lo schema, riportare applicazione e worker a una versione che non usa i nuovi campi o la nuova tabella. Interrompere i worker durante il cambio di versione e verificare che non esistano elaborazioni in corso.

Rollback SQL:

```sql
DROP INDEX IF EXISTS "DemoLead_idempotencyKey_key";

ALTER TABLE "DemoLead"
  DROP COLUMN IF EXISTS "requestHash",
  DROP COLUMN IF EXISTS "idempotencyKey";

DROP TABLE IF EXISTS "InvoiceEmailRequest";
DROP TABLE IF EXISTS "BookingContractEmailRequest";
DROP TABLE IF EXISTS "RentalBookingCreateRequest";

DROP INDEX IF EXISTS "EmailQueue_status_nextAttemptAt_leaseExpiresAt_idx";

ALTER TABLE "EmailQueue"
  DROP COLUMN IF EXISTS "leaseExpiresAt",
  DROP COLUMN IF EXISTS "processingStartedAt",
  DROP COLUMN IF EXISTS "processingToken";

```

La rimozione dei registri elimina lo storico di replay per prenotazioni e invii email. Dopo il rollback, una richiesta ripetuta non può più essere riconosciuta tramite quei registri. Eseguire il rollback soltanto dopo aver fermato il traffico di scrittura o aver predisposto un meccanismo equivalente nella versione precedente.

## Gate prima della produzione

- PR, CI ospitata e code review del commit esatto.
- Gate di compatibilità tra release precedente e schema migrato.
- Rehearsal migrazione e rollback su copia redatta production-like.
- Staging con due tenant sintetici, concorrenza booking e worker multipli.
- Provider email in test mode, compresi retry concorrenti di contratto, fattura e demo e retry dopo accettazione con fallimento locale.
- Test browser per ricerca fuori ordine, doppio submit e retry booking; la chiave rimane in memoria e un hard reload crea un nuovo tentativo.
- Completamento dei gate esterni già elencati nel passaggio di consegne: upload, storage provider, log proxy/CDN/WAF, retention privacy e approvazioni applicabili.

Nessuna azione descritta in questo documento è stata eseguita in produzione.
