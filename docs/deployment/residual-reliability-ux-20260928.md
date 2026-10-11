# Affidabilita' residua backend e recupero UX — 28 settembre 2026

## Perimetro e stato

Questa tranche affronta i finding residui **BE-08**, **BE-09**, **FE-01**, **FE-02** e **FE-05** nel checkout isolato `/Users/silvio/Documents/Playground/Fleetum-fix-residual-reliability-ux`, branch `codex/fix-residual-reliability-ux`, discendente da `520826a779065eacc7f36c9ac70c5d8741d767b5`. BE-08 resta parziale per le occorrenze perse o duplicate in condizioni di concorrenza e durata elevata.

Il lavoro non integra il redesign UI separato e non modifica provider, configurazioni live o segreti. Non sono stati eseguiti push, pull request, merge, deploy, invii email reali o operazioni su dati personali.

Il documento descrive il codice candidato, i limiti ancora noti e le evidenze finali raccolte sul diff della tranche.

## BE-08 — enumerazione tenant e report programmati

Il cron non usa piu' una finestra globale limitata agli ultimi 300 audit `SETTINGS_REPORTS`. Enumera invece tutti i tenant attivi e non cancellati con paginazione keyset stabile per `id`, carica separatamente l'ultima configurazione di ciascun tenant e mantiene ogni query KPI vincolata al relativo `tenantId`.

Il ciclo:

- ordina e pagina i tenant in blocchi da 100;
- seleziona la configurazione report piu' recente con ordinamento deterministico `createdAt` e `id`;
- isola gli errori per tenant, compreso il lookup delle impostazioni, cosi' un errore non interrompe i tenant successivi;
- verifica orario, frequenza e destinatari prima del lookup della licenza;
- consente l'invio soltanto per licenze `ACTIVE` o `TRIAL` con feature `scheduled_reports`;
- elimina i destinatari duplicati con confronto case-insensitive, preservando il primo indirizzo ripulito da spazi;
- include il tenant anche nella query delle officine usate nel report;
- impedisce la sovrapposizione di due esecuzioni nello stesso processo con l'opzione `noOverlap` del cron.

La prova persistente crea una configurazione del tenant A precedente a 301 aggiornamenti del tenant B e supera la prima pagina di 100 tenant. Verifica inoltre tenant inattivo, licenza sospesa, destinatari duplicati e prosecuzione dopo un errore sintetico di un tenant.

### Impatto runtime e residui BE-08

Il cron esegue ogni minuto una scansione paginata dei tenant attivi e un lookup dell'ultima configurazione per ciascun tenant. Licenza, KPI, PDF/CSV e righe di coda vengono elaborati soltanto quando la configurazione risulta dovuta e contiene almeno un destinatario. Questo elimina la perdita silenziosa dei tenant meno recenti, ma lascia un costo lineare nel numero dei tenant per il lookup delle impostazioni. Con volumi maggiori andra' valutata una tabella di stato corrente oppure una query/set e un indice dedicati alle configurazioni report.

`noOverlap` opera nel singolo processo. Due istanze applicative possono ancora accodare lo stesso report, perche' non esiste un ledger persistente con chiave univoca per tenant, periodo e tipo di report. La consegna resta quindi **at-least-once** in un deployment multi-processo. Prima di scalare orizzontalmente lo scheduler occorre introdurre una deduplica persistente o affidare il cron a un worker singleton esplicitamente controllato.

Una scansione che dura oltre un minuto puo' anche perdere l'occorrenza del minuto successivo: `noOverlap` scarta quel tick e il ciclo in corso valuta i tenant soltanto rispetto all'orario acquisito al suo avvio. Il test copre il superamento della pagina di 100 tenant, ma non simula scansioni oltre 60 secondi. Lo scheduler va mantenuto singleton e la durata dei cicli va monitorata; per chiudere anche questo caso servono recupero persistente delle occorrenze e deduplica atomica delle consegne.

## BE-09 — aggregazione database del registro clienti

La lista clienti e il profilo non caricano piu' nell'applicazione l'intera storia delle prenotazioni dei clienti mostrati. Una query aggregata PostgreSQL restituisce al massimo una riga per cliente richiesto e calcola:

- conteggio storico totale delle prenotazioni;
- conteggio delle prenotazioni non cancellate;
- conteggio dei contratti collegati a prenotazioni non cancellate;
- ultima prenotazione non cancellata con data, codice, stato e stato contratto.

La query applica `tenantId` sia alle prenotazioni sia ai contratti e usa un ordinamento deterministico per l'ultima prenotazione. La lista mantiene la semantica precedente per il caso limite in cui un cliente abbia soltanto prenotazioni soft-deleted; il profilo mantiene il conteggio storico complessivo esposto in precedenza.

La revisione finale ha rilevato che il profilo includeva gli allegati del cliente senza filtro tenant, mentre ne filtrava il conteggio. La relazione usa una chiave esterna globale sul cliente: una riga incoerente di un altro tenant poteva esporre metadati dell'allegato. L'include e' ora vincolato al `tenantId`; il fixture sintetico crea un allegato del tenant B collegato al cliente A e verifica che non compaia nella risposta A.

La prova persistente costruisce due tenant, inserisce **100.000** prenotazioni sintetiche, contratti, righe soft-deleted e una riga deliberatamente riferita al customer del tenant opposto. Confronta la risposta con la semantica legacy, controlla l'isolamento tenant e registra `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, 12 campioni, p50 e p95.

### Impatto runtime e residui BE-09

Il trasferimento database-applicazione e la memoria Node sono limitati agli aggregati dei customer presenti nella pagina, con un massimo coerente con il limite della richiesta. Il lavoro storico viene spostato su PostgreSQL; CPU, letture e piano dipendono quindi dagli indici e dalla distribuzione reale dei dati.

Il benchmark e' sintetico, locale e misurato dopo `ANALYZE` e query ripetute: rappresenta prevalentemente un caso **warm-cache**. Non costituisce una previsione della latenza di produzione. Il piano e i valori p50/p95 effettivi dell'ultima esecuzione devono essere conservati nelle evidenze finali e confrontati in staging o su un restore redatto con cardinalita' e cache realistiche.

## FE-01 — recupero dagli errori UI

Sono stati introdotti fallback permanenti per tre livelli di errore:

- bootstrap iniziale, anche quando il bundle applicativo non riesce a essere importato;
- albero applicativo principale;
- rendering delle route e dei moduli caricati in modo lazy.

Il fallback mostra un messaggio generico e un'azione manuale `Riprova`; non crea loop di reload automatici. Il logging emette soltanto un codice di recovery per scope e non include eccezione, component stack, route o dati tenant/cliente. Il boundary di route viene reinizializzato quando cambiano pathname, query o hash, consentendo di uscire da una route fallita.

Limite operativo: il retry ricarica la pagina e non conserva stato React o bozze non persistite.

## FE-02 — drawer accessibile di GenericCrud

Il drawer condiviso da `GenericCrudPage` espone una finestra modale con nome e descrizione accessibili, associa label e campi tramite identificatori stabili e gestisce il ciclo del focus:

- focus iniziale nel drawer;
- contenimento di `Tab` e `Shift+Tab`;
- chiusura con `Escape` quando non e' in corso un salvataggio;
- blocco dello scroll della pagina sottostante;
- ripristino del focus sull'elemento che ha aperto il drawer, oppure sul pulsante di creazione se il record modificato e' uscito dall'elenco.

Lo scope e' intenzionalmente limitato al drawer generico di `GenericCrudPage`. Drawer e modali specializzati presenti in altre pagine non sono coperti automaticamente e richiedono un audit separato prima di considerarli conformi. Le prove automatiche verificano la logica di wrapping del focus, Escape e identificatori dei campi. Il collaudo browser verifica sia il focus sul trigger dopo chiusura e salvataggio, sia il fallback quando il trigger viene rimosso.

## FE-05 — ritorno alla route dopo scadenza sessione

Quando una route protetta non dispone piu' di una sessione, oppure il client HTTP riceve una risposta di sessione scaduta, il redirect al login conserva pathname, query e hash in un parametro `next`. Il valore viene normalizzato e accettato soltanto come percorso same-origin. Login e callback OAuth vengono esclusi per evitare redirect ricorsivi o la persistenza di frammenti sensibili. Dopo il login con credenziali viene ripristinata la destinazione validata.

Il ripristino riguarda esclusivamente lo **stato rappresentato nell'URL**. Stato locale React, filtri non serializzati, modali aperte, dati digitati e bozze non salvate non possono essere ricostruiti e restano un limite noto.

## Migrazioni e compatibilita'

La tranche non aggiunge o modifica migrazioni Prisma e non cambia lo schema del database. Non e' previsto un backfill. La compatibilita' riguarda codice e risposte HTTP esistenti:

- BE-08 cambia il metodo di enumerazione e le condizioni operative dello scheduler, senza cambiare la struttura delle righe accodate;
- BE-09 conserva i campi di risposta del registro e del profilo cliente, spostando il calcolo nel database;
- FE-01/02/05 aggiungono recovery, accessibilita' e redirect senza introdurre nuove API pubbliche.

Il gate di compatibilita' delle migrazioni non ha una nuova migrazione candidata da validare in questa tranche; i gate database da zero restano comunque obbligatori per rilevare regressioni applicative.

## Rollback

Il rollback non richiede operazioni sul database. Dopo avere sospeso eventuali esecuzioni del cron durante il cambio versione, e' sufficiente distribuire il precedente artefatto coordinato di backend e frontend.

Effetti gia' prodotti non vengono annullati automaticamente:

- righe email gia' accodate dal cron restano nella coda e vanno gestite secondo il runbook della coda;
- email gia' accettate dal provider non sono revocabili;
- il rollback BE-09 ripristina il maggiore consumo di memoria e trasferimento della query legacy;
- il rollback frontend rimuove i fallback, il comportamento accessibile del drawer e il ritorno alla route profonda.

Non eseguire cancellazioni manuali di righe email come parte di un rollback automatico. Se la tranche viene ritirata per un problema del cron, fermare prima lo scheduler, identificare le righe sintetiche o duplicate tramite evidenze redatte e applicare una procedura operativa revisionata.

## Evidenze finali

I gate finali sono stati eseguiti con Node `22.23.1` su una copia di verifica stabile del checkout, mantenendo identico il contenuto candidato. `npm ci` ha installato 791 pacchetti.

- `npm run verify:release`: **PASS**. Lint e build di backend, frontend e website completati; backend **211/211**, frontend **31/31**, website **9/9**, operations **31/31**; 13 pagine pubbliche prerenderizzate verificate; audit delle dipendenze di produzione senza finding high o critical. La durata complessiva non e' stata conservata separatamente nel log di questo run.
- `npm run verify:database`: **PASS in 36s** su PostgreSQL 16 temporaneo, 46 migrazioni da zero e soli dati sintetici; **39/39** test superati. Sono inclusi il caso BE-08 sulla licenza `SUSPENDED`, il superamento di 100 tenant e l'allegato cross-tenant escluso dal profilo cliente.
- BE-09: dataset di **100.000** prenotazioni, 2 righe aggregate, 12 campioni, p50 **58,69 ms**, p95 **69,07 ms**. `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` ha registrato 2 righe effettive, execution time **37,27 ms**, 4.853 shared hit e nessuna shared read. La misura e' sintetica e warm-cache e non predice la produzione.
- Test frontend mirati su `accessible-dialog.test.ts`, `ui-recovery.test.ts` e `oauth-safe-return-to.test.ts`: **9/9 PASS**. Suite frontend completa: **31/31 PASS**.
- Collaudo Playwright headless Chromium a viewport **360x800**: PASS. Verificati nome e modalita' accessibile del drawer, label, focus iniziale, wrapping `Tab`/`Shift+Tab`, blocco scroll, assenza di overflow orizzontale, `Escape`, annuncio dell'errore, ripristino focus dopo chiusura e salvataggio, un solo salvataggio riuscito e nessun `pageerror` inatteso nello scenario ordinario.
- Recovery UI in browser: PASS per fallimento del bootstrap, rifiuto di un import lazy e crash sintetico di rendering; fallback visibile, nessun reload automatico, log statico di recovery e recupero dopo una sola azione manuale.
- Recupero sessione in browser: PASS. Il redirect al login conserva `/anagrafiche/sedi?tab=inactive#archive` e il login sintetico ripristina pathname, query e hash.
- Focus di fallback in Chromium dopo l'ultima modifica FE-02: PASS a **360x800**. Il salvataggio elimina la riga e il suo pulsante `Modifica`; il focus torna a `Nuova sede`, con un solo aggiornamento e zero errori pagina.

Le prove browser usano API sintetiche e il server Vite locale: verificano il comportamento applicativo e la semantica del DOM, non CDN, cookie/CSRF reali, tastiera virtuale, safe area iOS o screen reader VoiceOver/NVDA.

Le verifiche Git finali, la scansione dei soli file modificati e l'identita' del commit sono registrate nel documento di passaggio dopo la creazione del commit locale.

## Gate esterni invariati

Questa tranche non autorizza produzione. Restano necessari PR, CI ospitata sullo SHA esatto, review umana, deploy coordinato e smoke test in staging con tenant sintetici. Restano inoltre separati i gate gia' documentati per storage/upload, provider email, log proxy/CDN/WAF, privacy/retention e marketing. FE-06..FE-09 appartengono al redesign UI separato e non sono inclusi qui.

La tranche e' candidata a revisione del codice, con **BE-08 parzialmente risolto**. Prima di considerare attivo in produzione lo scheduler servono una decisione operativa sul worker singleton, monitoraggio della durata dei cicli e una soluzione persistente per recupero delle occorrenze e idempotenza delle consegne.
