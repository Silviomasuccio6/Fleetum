# Tranche BE-08 — consegna affidabile dei report programmati

## Identita' e perimetro

Checkout isolato: `/Users/silvio/Documents/Playground/Fleetum-fix-scheduled-report-delivery`.
Branch: `codex/fix-scheduled-report-delivery`.
Base: `2c43fc1e97b87a563fbb35ce81e86b8c02c249ad`.
Lo SHA finale del commit locale e' registrato nel documento di passaggio esterno alla repository.

Questa tranche completa la correzione applicativa BE-08 gia' avviata: i tenant restano enumerati senza limite globale e ciascuna query del report resta vincolata al proprio `tenantId`. Non integra il redesign UI e non modifica produzione, provider, segreti o dati reali.

## Comportamento del candidato

- Il cron controlla ogni minuto la configurazione report piu' recente di ogni tenant attivo. Una scadenza daily, weekly (lunedi') o monthly (primo del mese) resta recuperabile per **180 minuti trascorsi** dall'orario previsto. Questo copre un tick scartato da `noOverlap`, una scansione oltre 60 secondi o un riavvio breve.
- Il fuso resta quello locale del processo Node, come nel comportamento precedente. Tutte le istanze che eseguono il cron devono quindi avere lo stesso `TZ`; una configurazione di fuso per tenant non e' compresa nella tranche. Il minuto locale ripetuto in autunno usa un'unica chiave logica; un minuto locale inesistente al cambio primaverile non viene inviato.
- Una configurazione salvata durante il minuto programmato resta valida come prima. Una configurazione salvata dopo quel minuto non genera un report retroattivo. Disabilitazione, licenza non `ACTIVE`/`TRIAL`, feature assente, tenant inattivo e lista destinatari vuota continuano a impedire l'accodamento.
- Per ogni tenant, slot locale e destinatario normalizzato si calcola una chiave SHA-256 senza indirizzo email in chiaro. Il database impone l'unicita' della chiave. Un solo `createMany` con `skipDuplicates` accoda l'intero fan-out: due processi concorrenti non creano due righe per lo stesso destinatario e un errore SQL non lascia un fan-out parziale.
- Le righe `EmailQueue` sono il ledger persistente. L'email worker continua a gestire lease, retry e chiave idempotente verso il provider per ogni riga. La retention dei payload terminali azzera anche la chiave di deduplica, evitando di conservare indefinitamente un identificatore derivato dall'email; questo avviene molto dopo la finestra di recupero.

## Migrazione e compatibilita'

La migrazione `20260929120000_email_queue_deduplication_key` aggiunge `EmailQueue.deduplicationKey VARCHAR(255) NULL` e un indice univoco. Le righe storiche restano `NULL`, quindi non richiedono backfill e i vecchi reader non cambiano. L'aggiunta della colonna richiede un lock breve; la creazione dell'indice puo' bloccare scritture sulla coda per la durata del build. Misurare questa durata su un restore redatto con volume realistico e valutare un indice concorrente prima della distribuzione reale.

Il rollback applicativo e' la versione precedente, mantenendo la colonna additiva inutilizzata. Non cancellare automaticamente righe email o indice in un rollback di emergenza. Un eventuale rollback dello schema va eseguito solo dopo avere escluso produttori della nuova versione e revisionato le righe gia' accodate. Durante il cambio versione sospendere il cron e impedire sovrapposizione tra istanze vecchie (senza chiave) e nuove: il database non puo' deduplicare retroattivamente righe legacy con chiave `NULL`.

## Verifiche e limiti

- Node 22.23.1; `npm ci --offline`: 791 pacchetti, audit npm senza vulnerabilita'.
- `npm run verify:database`: PostgreSQL 16 temporaneo, 47 migrazioni da zero, soli dati sintetici, 43/43 test superati. Inclusi due cicli concorrenti, recupero a +5 minuti, retry idempotente, configurazione posteriore allo slot e fan-out atomico.
- Upgrade isolato da 46 a 47 migrazioni su PostgreSQL 16: PASS; una riga legacy `EmailQueue` sintetica resta invariata con chiave `NULL` e il nuovo indice univoco e' presente.
- `npm run verify:release`: PASS dopo avere consentito il loopback locale necessario ai test HTTP e ripristinato nella copia temporanea il solo `.env.example` tracciato. Backend 213/213, frontend 31/31, website 9/9, operations 31/31; build, lint, prerender 13 pagine e audit dipendenze senza finding high/critical.
- Test mirati successivi: retention e calendario locale/DST 9/9 PASS. `git diff --cached --check`: PASS sui 10 file candidati; scansione dei soli file modificati per pattern di segreti ad alta confidenza: nessun match. La copia temporanea di verifica risulta pulita dopo il riallineamento dei soli file di esempio e generati.
- `npm run verify:migration-compatibility` e' stato avviato sul commit esatto ma fermato prima del setup database: `git archive` del commit base non avanzava per l'offload iCloud/FileProvider degli oggetti Git. Il gate scripted resta aperto; il test isolato di upgrade 46→47 sopra e' passato.

Il recupero e' intenzionalmente limitato a 180 minuti: un fermo piu' lungo non accoda report storici in massa. Non esiste ancora un cursore persistente delle scadenze oltre tale finestra; per uno SLA di recupero superiore serve un job ledger dedicato con policy di backlog. Il costo della scansione resta lineare nel numero di tenant e va misurato in staging con un dataset realistico. Le istanze devono usare lo stesso fuso. Questi sono gate operativi aperti, insieme a PR, CI ospitata sullo SHA esatto, review umana, smoke test in staging e collaudo provider in test mode. Nessun invio email reale, push, PR, merge o deploy e' stato eseguito.
