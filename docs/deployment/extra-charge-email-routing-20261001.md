# Routing delle notifiche extra nella coda email

## Difetto e perimetro

Base `970f1c37f4d1c9eb06e943753e622160c0e12b9d`, checkout isolato `Fleetum-fix-scheduled-report-cursor`, branch `codex/fix-extra-charge-email-routing`. Il producer `RentalPaymentService.notifyExtraCharge` accoda `RENTAL_EXTRA_CHARGE_NOTICE` con `bookingId`, `extraChargeId` e `type`. Il worker deduceva il target contratto dalla sola presenza di una fra `bookingId`, `contractId`, `contractDeliveryId`, su qualunque tipo di email. La notifica extra veniva quindi respinta come contratto incompleto prima del provider, consumando retry fino a FAILED.

La correzione sceglie la finalizzazione del dominio dal tipo esplicito della coda: `BOOKING_CONTRACT` per contratto/consegna/eventi; `SAAS_INVOICE_EMAIL` per fattura/consegna; `REMINDER_EMAIL` per fermo/storico reminder. Le chiavi presenti nei metadata di un altro tipo non abilitano queste mutazioni, neppure sul percorso di errore. Non si introducono alias ipotetici dei tipi esistenti.

Per questi tre tipi sensibili, tenant coerente e tutte le chiavi richieste sono obbligatori anche se nessuna e' presente. Non si puo' inviare una coda contratto/fattura senza metadata saltando la finalizzazione. I predicati tenant sulle mutazioni, le transazioni, claim/lease/CAS, backoff, ricevute e chiave `fleetum-email-queue:<id>` restano invariati. Il producer extra e i suoi metadata legacy rimangono compatibili, senza migrazione o backfill.

Le code sensibili con metadata strutturalmente invalidi falliscono prima del provider e usano i retry limitati gia' presenti. Per `REMINDER_EMAIL` con tutte le chiavi assenti questo anticipa la validazione del guard: si applica il retry generico fino al limite invece del precedente blocco immediato del guard; nessuna richiesta provider e nessun effetto dominio. Le code reminder legittime conservano le decisioni terminali di tenant/licenza e il dispatch protetto della tranche precedente.

## Stato del dominio extra e limiti

`NOTIFIED`/`notifiedAt` sono scritti dal producer dopo l'accodamento e prima dell'accettazione provider. La correzione non ne cambia il significato: **NOTIFIED non e' una prova di consegna email**. Lo stato e' anche usato per l'addebitabilita' dell'extra; spostarlo sul successo provider richiede una modifica distinta del dominio. Il worker aggiorna solamente la coda della notifica, senza mutare l'importo, l'addebito o il pagamento.

Il producer legge extra e prenotazione con tenant e cancellazione. Questa tranche non aggiunge un controllo dello stato tenant/licenza o della proprieta' corrente dell'extra al dispatch. Restano da valutare separatamente quelle policy e l'atomicita' fra coda, aggiornamento NOTIFIED e audit del producer; non dichiarare che tutte le email extra sono protette dopo sospensione/cancellazione.

Gli invii gia' accettati con receipt persistita vengono finalizzati senza reinvio e senza mutazioni di dominio appartenenti ad altri tipi. La garanzia distribuita resta limitata dall'idempotenza provider e dalla persistenza della ricevuta; nessuna promessa di atomicita' con il provider.

Una riga di tipo sensibile con receipt persistita ma metadata del comando assenti/incoerenti rimane soggetta alla validazione obbligatoria: retry limitati e poi FAILED, senza reinviare o cancellare la ricevuta. Le righe legittime con receipt e metadata completi mantengono la finalizzazione precedente.

## Verifiche e rollout

Test di regressione scritti prima della correzione e prova RED su PostgreSQL 16 temporaneo con soli dati sintetici e sender sostituito. Il passaggio e le evidenze finali registrano comandi, risultati, runtime, SHA, confronto dei file committati e revisione indipendente. Non si leggono env reali o dati personali e non si effettuano invii reali, pagamenti, push, merge o deploy.

- RED originale: **35 casi, 14 FAIL/21 PASS**. Suite estesa finale: **38** casi, inclusi tre tipi sensibili con receipt persistita e comando privo di metadata.
- Mirati reminder/report/coda/outbox/routing: **119/119 PASS**. La fixture di regressione report ora crea una fattura/consegna sintetica completa, preservando l'attesa che l'autorizzazione report non interferisca con invoice/account/billing/demo; i nuovi test verificano separatamente il rifiuto di invoice prive di metadata.
- `npm run verify:database`: **164/164 PASS**, **48 migrazioni** da zero, **54s**; PostgreSQL 16-alpine temporaneo rimosso al termine. Anche il container separato dei test mirati e' stato rimosso.
- Node **22.23.1**, npm **10.9.8**, copia stabile `/private/tmp/fleetum-be08-validation`. `npm run lint -w backend` PASS e `npm audit --omit=dev --json` con **zero vulnerabilita'** nel grafo production invariato.
- `npm run verify:release`: **PASS**, backend **217/217**, frontend **31/31**, website **9/9**, operations **31/31**, lint/build dei tre workspace e verifica di **13** pagine prerenderizzate. Nessuna nuova migrazione da aggiungere al gate di compatibilita' precedente.
- Revisione indipendente dei quattro file: nessun blocco nel perimetro; limiti del dominio extra, receipt malformate e rollback dichiarati. Sorgente di produzione modificato solamente nel worker email.

Evidenze durevoli, diff e verifica post-commit: `Fleetum-audit-20260909/evidence/20261001-extra-charge-email-routing/`. Il documento `FLEETUM_RIPRESA_20260909.md` registra SHA finale, branch, file, risultati e prossima azione. Prima della consegna vengono verificati originali/indice/HEAD, scansione mirata segreti, diff-check e uguaglianza dei quattro file fra copia testata, checkout e blob committati. Non si dichiara pulizia globale del worktree tramite scansione di path iCloud/FileProvider estranei.

Nessuna migrazione/backfill. Le righe PENDING legacy mantengono il formato e il retry/backoff: non azzerare tentativi e non anticipare nextAttemptAt. Le righe gia' FAILED per errore di classificazione **non vengono riaperte automaticamente**. Prima di un eventuale replay, verificare tenant, destinatario, stato extra/prenotazione e ricevute, con approvazione distinta e tracciabilita': questa tranche non riesegue vecchi addebiti o notifiche.

Rollback applicativo ripristina l'errata classificazione delle notifiche extra e l'inferenza di effetti dominio dai metadata. Sospendere il worker e valutare lo stato delle code prima del rollback; evitare consumer vecchi/nuovi sovrapposti. Non cambiare lo stato monetario per compensare un'email fallita.

Prima della produzione restano review umana, CI ospitata sullo SHA finale, staging con due tenant sintetici e provider in test mode. Verificare contratto/fattura/reminder/report/account/billing/demo oltre alla notifica extra. La UI/redesign e la release live VPS non vengono modificate o certificate in questa tranche.
