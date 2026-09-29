# BE-08 — cursore persistente dei report programmati

## Perimetro

Branch isolato `codex/fix-scheduled-report-cursor`, base `6a46149cfd567b264c4e43d6e799506d2efd2ee6`. Nessuna integrazione del redesign UI, configurazione provider o modifica della produzione.

## Comportamento

- Ogni tenant ha un cursore persistente con revisione delle impostazioni, fuso locale del processo e prossima occorrenza. Il salvataggio delle impostazioni report crea o aggiorna il cursore nella stessa transazione dell'audit log.
- Dopo un'interruzione, il cron accoda **al massimo il report dello slot piu' recente**. Registra nel cursore l'intervallo delle occorrenze precedenti come `BACKLOG`, senza raffica di email arretrate. Il report recuperato usa i KPI **al momento della generazione** e conserva `scheduledFor` dello slot recuperato; non pretende di ricostruire dati storici.
- Un tenant senza destinatari, con programma disabilitato o senza licenza/feature attiva non riceve l'email. Se esiste gia' uno slot scaduto nel cursore, viene avanzato e marcato `NO_RECIPIENTS`, `DISABLED` o `INELIGIBLE`, cosi' una successiva riattivazione non lo invia retroattivamente. Una configurazione salvata dopo lo slot viene marcata `CONFIG_AFTER_SLOT`. Il recupero controlla i diritti **correnti**: non dispone di una fotografia storica affidabile della licenza durante un fermo in cui questa e' cambiata.
- Se lo stato del tenant e' cambiato dopo lo slot, il recupero salta quello slot con `TENANT_STATUS_CHANGED`; questa regola prudente copre la sospensione e la successiva riattivazione mentre il cron era fermo. Lo stato corrente del tenant e la licenza sono ricontrollati sotto lock nella transazione che accoda il report. Il writer Platform registra soltanto transizioni reali, con stato precedente letto sotto lock e audit scritto atomicamente con la modifica; l'orario dell'audit viene letto dal database dopo la modifica. Una richiesta di stato identico non genera audit o alert. Se una licenza diventa idonea tra la prima lettura e il lock, il cursore resta fermo e il ciclo seguente prepara il report.
- Avanzamento del cursore e accodamento dei destinatari avvengono nella stessa transazione PostgreSQL, con confronto della revisione e della prossima scadenza. Un errore annulla entrambi; due processi non possono avanzare lo stesso cursore. La chiave univoca della coda resta una seconda difesa contro duplicati per tenant, slot locale e destinatario.
- Il fuso locale e' salvato nel cursore. Un'istanza con fuso diverso rifiuta la lavorazione e segnala l'errore: tutte le istanze devono usare lo stesso `TZ`. L'ora inesistente nel passaggio primaverile viene saltata; l'ora ripetuta in autunno rappresenta un solo slot locale.
- Un cambio di `TZ` richiede un cutover separato: fermare tutti gli scheduler, decidere il fuso unico di tutte le istanze, migrare in modo controllato `timeZone` e `nextRunAt` dei cursori confrontando le impostazioni correnti, poi riavviare e verificare in staging. Cambiare soltanto la variabile `TZ` lascia i cursori in errore per scelta fail-closed. La configurazione effettiva del fuso in produzione non e' stata verificata in questa tranche.
- Il cursore conserva l'**ultimo** intervallo saltato e la relativa ragione anche dopo una modifica delle impostazioni. Non e' un registro storico di tutte le occorrenze saltate; per una contabilita' completa servirebbe un ledger separato.

## Cutover e migrazione

La migrazione `20260929150000_scheduled_report_cursor` aggiunge soltanto la tabella `ScheduledReportCursor` e non modifica i record storici. La prima scansione di configurazioni preesistenti crea il cursore: conserva il recupero di 180 minuti della versione precedente, ma non invia automaticamente mesi di report storici. Le configurazioni salvate dal nuovo codice ricevono immediatamente un cursore, quindi un fermo successivo puo' essere recuperato anche oltre 180 minuti.

Distribuire la migrazione prima del nuovo codice. Evitare la sovrapposizione di scheduler vecchi e nuovi nel cutover: le versioni precedenti non aggiornano il cursore. Dopo il rilascio osservare durata del ciclo, profondita' della coda, slot saltati, revisioni/fusi discordanti e retry. Email gia' accodate prima di una sospensione non vengono annullate da questo cursore: la revoca al momento dell'invio richiede un controllo separato nel worker e resta un gate di prodotto/sicurezza prima della produzione.

Rollback applicativo: fermare il nuovo scheduler e ripristinare il codice precedente; la tabella additiva puo' restare inutilizzata. Non cancellare automaticamente la coda o i cursori gia' scritti. Un rollback dello schema, solo dopo avere escluso il nuovo codice e verificato i dati, consiste nel rimuovere la tabella; perderebbe lo storico operativo dei cursori. Provare upgrade, rollback e compatibilita' con la release precedente su un restore redatto production-like prima della produzione.

## Verifiche e gate

Le prove hanno usato Node 22.23.1, PostgreSQL 16 temporaneo e soli tenant sintetici. Prima dell'implementazione, i sette nuovi casi del cursore fallivano e i 43 test database preesistenti passavano. Un caso aggiuntivo di riattivazione dopo sospensione falliva sul primo codice verde e ha guidato la correzione. Sul codice finale:

- `npm run verify:database`: **PASS in 57s**, 48 migrazioni applicate da zero, **54/54** test persistenti superati. La suite che condivide il database sintetico viene eseguita in serie: i test del cron enumerano tutti i tenant e interferirebbero con orologi sintetici diversi se lanciati in processi paralleli.
- `npm run verify:release`: **PASS** con permesso per il solo loopback locale richiesto dai test HTTP. Backend **217/217**, frontend **31/31**, sito **9/9**, operazioni **31/31**; lint/build, 13 pagine prerenderizzate e audit delle dipendenze di produzione senza finding high o critical. Una prova preliminare nel sandbox ristretto era arrivata ai test backend ma quattro casi HTTP avevano ricevuto `listen EPERM`; la ripetizione autorizzata e' verde.
- Test mirati di calendario e diritti: **7/7 PASS**, inclusi i passaggi DST e il salvataggio nel minuto programmato.

Il gate scripted di compatibilita' con la release precedente e la revisione finale del diff devono essere registrati nel documento di passaggio dopo il commit. Restano obbligatori PR, CI ospitata sullo SHA esatto, review umana, staging con due tenant sintetici, misura su dataset realistico e collaudo provider email in test mode. Nessun invio reale o deploy e' compreso nella tranche.
