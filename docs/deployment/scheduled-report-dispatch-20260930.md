# BE-08 — controllo dei report prima dell'invio

## Perimetro e comportamento

Continuazione nel checkout isolato `Fleetum-fix-scheduled-report-cursor`, branch `codex/fix-scheduled-report-cursor`, base `618507fd95b3e1abc7b957e33992d685ba3ee857`. Il controllo riguarda soltanto le righe `SCHEDULED_REPORT`. Reset password, inviti, fatture SaaS, notifiche billing, demo pubbliche e Platform seguono i percorsi precedenti.

Prima di iniziare una nuova richiesta al provider, il worker verifica tenant esistente, attivo e non cancellato; licenza `ACTIVE`/`TRIAL` non scaduta; feature `scheduled_reports`. Usa la stessa policy licenze del prodotto, compreso il fallback audit delle licenze precedenti a `TenantSubscription`. Una scadenza valida all'epoch non viene piu' confusa con una scadenza assente.

Una transizione Platform di stato del tenant registrata dal momento dell'accodamento blocca il report anche se il tenant e' gia' tornato attivo. Timestamp uguali sono trattati in modo prudente perche' il database conserva millisecondi. Un report bloccato diventa terminale `FAILED`, senza incremento dei tentativi provider, con lease rilasciata, `dispatchBlockedReason`/`dispatchBlockedAt` nei metadata e un errore composto soltanto da codici. Non viene rimesso automaticamente in coda dopo la riattivazione. Il suo payload resta soggetto alla retention gia' prevista per la coda.

`FAILED` e' uno stato gia' presente: non e' stata aggiunta una migrazione o una nuova categoria enum. Per distinguere blocchi di policy da errori provider, usare `dispatchBlockedReason` oppure il prefisso `SCHEDULED_REPORT_DISPATCH_BLOCKED:`; il conteggio generico delle email fallite include entrambi.

## Concorrenza e limite della garanzia

L'ordine dei lock e' Tenant → TenantSubscription → EmailQueue. Tenant usa `FOR SHARE` se la subscription era presente e `FOR UPDATE` altrimenti, per impedire un inserimento concorrente della subscription durante il fallback legacy. Una subscription scomparsa tra le letture genera un errore retryable, senza iniziare l'invio. Il CAS della coda verifica token e lease ancora valida e rinnova la lease prima dell'autorizzazione.

Il worker avvia il sender mentre detiene i lock, ma osserva la Promise e attende la risposta **fuori** dalla transazione. Per il sender corrente e Resend 6.14.0, l'avvio di `fetch` e' sincrono rispetto alla chiamata al sender; un test protegge questo contratto. Non introdurre preparazione asincrona prima dell'avvio rete senza rivalutare questa garanzia.

Nel normale ciclo di esecuzione, una sospensione committata prima dell'autorizzazione impedisce l'avvio della richiesta. Se la richiesta e' gia' iniziata, la sospensione puo' completarsi senza aspettare il provider e la risposta dell'invio puo' arrivare successivamente. L'applicazione non revoca un messaggio gia' avviato o accettato. Le transazioni hanno `maxWait=5s`, `timeout=10s`; la lease resta 15 minuti. Pause/crash del processo oltre queste finestre non creano atomicita' distribuita: il recupero continua a dipendere dalla chiave idempotente del provider e dalla ricevuta salvata.

Se il commit della guardia fallisce o ne viene persa la conferma dopo l'avvio, il worker attende comunque la richiesta gia' iniziata, quindi finalizza o conserva la ricevuta secondo il percorso precedente. Non inventa un nuovo tentativo provider. Una ricevuta `resend`/`providerMessageId` gia' persistita bypassa il controllo per completare soltanto la finalizzazione locale, anche con tenant ora sospeso. Il terminale locale non deve dichiarare non inviato un messaggio gia' accettato.

## Aggiornamenti mirati delle dipendenze

Il primo gate completo ha superato build/lint/test, ma l'audit finale ha segnalato nuovi advisory per Axios e brace-expansion. Il frontend usa ora Axios `1.20.0` (manifest `^1.20.0`); il lock aggiorna brace-expansion `1.1.18 → 1.1.21` e `2.1.4 → 2.1.7`. Sono aggiornamenti circoscritti: il catalogo pacchetti, gli override e il manifest root non cambiano. Fonti primarie Axios: [advisory SSRF](https://github.com/advisories/GHSA-c29m-xwm3-cm6r), [advisory bypass limiti](https://github.com/advisories/GHSA-qhr7-859c-m2p7), [release 1.20.0](https://github.com/axios/axios/releases/tag/v1.20.0). L'audit production aggiornato restituisce zero vulnerabilita'; le prove browser locali verificano anche il client HTTP reale con API sintetica.

## Verifiche e rollback

Le prove usano Node 22.23.1/npm 10.9.8, PostgreSQL 16 temporaneo, soli dati sintetici e sender/fetch sostituiti dai test. Nessun provider reale, env reale, pagamento o dato personale.

Sul codice e sul lock finali, `npm run verify:database` passa in 53s: 48 migrazioni da zero e **83/83 test persistenti** (29 nella nuova suite). Il container viene rimosso automaticamente. `npm run verify:release` passa: backend **217/217**, frontend **31/31**, website **9/9**, operations **31/31**, lint e build dei tre workspace, 13 pagine prerenderizzate e audit production verde. Il JSON separato `npm audit --omit=dev --json` riporta **zero vulnerabilita'**; `npm ls axios brace-expansion --all` conferma il grafo installato. Nessuna nuova migrazione richiede un upgrade aggiuntivo; il gate di compatibilita' Node 22 della tranche cursore sul parent rimane registrato nel passaggio.

Browser Chrome `154.0.8037.57`, vero `httpClient` frontend e Axios `1.20.0`, API locale interamente simulata: **3/3 scenari PASS**. Due 401 simultanei condividono un solo refresh e due retry HTTP 200; FormData conserva boundary, filename, bytes, CSRF e idempotency header; un 403 `CSRF_INVALID` aggiunge un solo refresh e ripete JSON/header idempotente identici, aggiornando solo il token CSRF. Nessuna API inattesa o rete esterna; global XHR e storage sono ripristinati. Due tentativi iniziali si sono fermati prima delle API su `Outdated Optimize Dep` della cache Vite condivisa: la prova finale usa una cache temporanea dedicata. Script, harness, config, comandi e log sono conservati nelle evidenze audit, senza file di prova nel prodotto.

Prima della correzione, la nuova suite aveva 18 fallimenti su 24 casi. Le evidenze finali, il commit e i risultati dei gate sono registrati nel documento di passaggio `FLEETUM_RIPRESA_20260909.md` e nella cartella audit dedicata. Le prove coprono stati/licenze, scadenza, downgrade, transizioni dopo claim, audit di sospensione/riattivazione, ricevute, esclusioni account/billing, contesa dei lock, rete fuori transazione, lease takeover, rollback, perdita della conferma commit e retry/backoff.

Non ci sono nuove migrazioni o backfill. Il rollback applicativo ripristina il worker precedente; i report gia' bloccati restano terminali e non devono essere riaperti automaticamente. Tale rollback rimuove il controllo per i nuovi report, quindi va valutato insieme alla sospensione del worker. Un reinvio intenzionale richiede un nuovo comando revisionato e una nuova riga, non una modifica massiva da `FAILED` a `PENDING`.

Restano CI sullo SHA finale, review umana, staging con due tenant sintetici, misura della latenza/contesa con una coda realistica e collaudo provider in test mode. L'effettiva versione sul VPS non e' stata verificata. Nessun push, PR, merge o deploy eseguito.

## Finding separati emersi dalla lettura

- Il controllo reminder, inizialmente separato dalla tranche report, e' ora implementato nei producer e nel worker: [reminder-email-security-20260930.md](reminder-email-security-20260930.md) descrive policy, concorrenza, ricevute e limiti.
- `RENTAL_EXTRA_CHARGE_NOTICE` contiene `bookingId`, che la validazione generica della coda interpreta come metadata di contratto incompleti. Richiede una correzione distinta della classificazione e dei test di dominio.
- Lo storico completo delle variazioni di licenza durante un'interruzione non e' ricostruito dal controllo corrente, come gia' documentato per il cursore. La decisione usa la licenza al momento dell'autorizzazione.
