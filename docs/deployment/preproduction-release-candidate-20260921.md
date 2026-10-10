# Fleetum pre-production release candidate — 21 settembre 2026

## Verdetto

Il ramo `codex/preproduction-release-candidate`, derivato da `83aec529ec83e9d4a369866d32bce400c3ed9870`, e' **pronto per pull request, CI ospitata e review**. I controlli locali di build, test, dipendenze, database e compatibilita' delle migrazioni sono verdi.

La produzione resta **NO-GO**. Prima servono la correzione dei finding applicativi bloccanti indicati sotto e le prove esterne su staging, dati production-like redatti, upload/backup, provider test e policy privacy. Questo documento non autorizza push, merge, migrazioni reali o deploy.

Il candidato include l'interfaccia corrente. Il redesign premium rimane separato e non e' stato integrato.

## Perimetro della tranche

Questa tranche rende verificabile e ripetibile il passaggio verso staging:

- lo staging risolve una sola volta lo SHA completo e accetta soltanto una CI riuscita per quello SHA;
- le immagini sono pubblicate con tag SHA completo e distribuite tramite digest immutabile;
- checkout, immagini, manifest e riepilogo del deploy condividono la stessa identita' di release;
- i manifest vengono preparati in una directory versionata e promossi sotto lock;
- le immagini applicative mancanti o implicite fanno fallire le configurazioni staging e fallback PostgreSQL locale;
- la CI esegue un nuovo gate che applica prima le migrazioni della release precedente, inserisce dati storici sintetici, applica le migrazioni candidate e avvia il vecchio backend contro lo schema nuovo;
- il rollback manuale usa per default la readiness pubblica coerente con il backend non esposto sull'host;
- il runbook restore distingue PostgreSQL gestito dal fallback locale e non propone piu' un servizio `postgres` inesistente nel compose canonico;
- il preflight compliance usa il database temporaneo isolato e la policy audit del repository.

## Identita' e stato osservato

| Elemento | Valore o stato |
| --- | --- |
| Base della tranche | `83aec529ec83e9d4a369866d32bce400c3ed9870` |
| Branch locale | `codex/preproduction-release-candidate` |
| Base remota osservata | `origin/main` a `db1f231dc8cb699f1a5ce4215a0278c93212d16d` |
| Produzione osservata | vecchia immagine associata a `db1f231dc8cb699f1a5ce4215a0278c93212d16d` |
| CI esatta del candidato | assente: il branch e' solo locale |
| Push, PR, merge o deploy | non eseguiti |

Una CI storicamente verde non prova la versione eseguita sul VPS. L'ultima CI riuscita osservata su `main` e' il run `30809366880` del 3 agosto 2026 sul vecchio SHA. Il run E2E `35497754546` del 20 settembre 2026 e' verde, ma i flussi Playwright critici risultano saltati; non vale come prova funzionale.

## Evidenze locali

Ambiente: macOS arm64, Node `v22.23.1` verificato con checksum ufficiale, npm `10.9.8`, dipendenze dal lockfile gia' installate, PostgreSQL `16-alpine` temporaneo e soli dati sintetici. Nessun file env reale o dato personale e' stato letto.

| Gate | Risultato |
| --- | --- |
| `npm run verify:release` | PASS: lint e build dei tre workspace; backend 205/205, frontend 20/20, website 9/9, operations 31/31; prerender 13 pagine/asset; audit produzione senza high o critical |
| `npm run verify:database` | PASS in 16 s: 45 migrazioni da zero, 35 campi monetari riconciliati, dual-write su 13 tabelle, 20/20 test persistenti |
| `npm run verify:migration-compatibility` | PASS in 244 s: 42 migrazioni precedenti, tre candidate, dati storici sintetici conservati; il vecchio backend ha restituito 200 su readiness, login e lettura tenant autenticata |
| Test operativi mirati | PASS 31/31 |
| Sintassi e configurazioni | Bash PASS; sette workflow YAML validi; compose produzione, staging e fallback locale validi con `config --no-interpolate` |

Un primo avvio non privilegiato di `verify:release` ha prodotto quattro `EPERM` quando i test HTTP hanno tentato di aprire una porta loopback. La ripetizione completa con accesso locale alla porta e' terminata con 205/205 test backend; il primo esito era un limite del sandbox, non un difetto applicativo.

## Migrazioni candidate

Rispetto a `origin/main` sono presenti tre migrazioni additive:

1. `20260910120000_oauth_flow_correlation`: crea la tabella di correlazione OAuth e i relativi indici;
2. `20260914143000_rental_deposit_active_claim`: controlla i duplicati e crea l'indice univoco parziale per il deposito attivo;
3. `20260919120000_email_queue_payload_retention`: aggiunge `EmailQueue.payloadPurgedAt` nullable e l'indice di retention.

Il gate locale prova sia una creazione pulita sia l'upgrade dalla release precedente, compresa la compatibilita' del vecchio backend. Non misura pero' durata e lock su volumi realistici. Gli indici non sono creati con `CONCURRENTLY`: prima della produzione occorre usare un restore redatto con distribuzione e dimensioni rappresentative, eseguire la query duplicati del deposito, misurare lock/durata e definire la finestra di scrittura. Il rollback applicativo deve precedere ogni rollback di schema; i comandi specifici restano nei documenti delle rispettive tranche.

## Stato dei 37 finding originali

### Backend

- **Risolti nel codice:** BE-01, BE-02, BE-03, BE-04, BE-05.
- **BE-06 aperto e bloccante per produzione:** la coda seleziona record `PENDING`, invia e solo dopo marca `SENT`; due worker possono inviare la stessa email. Serve claim atomico con lease/stato di lavorazione e test concorrente PostgreSQL.
- **BE-07 parziale e bloccante per produzione:** disponibilita' e creazione booking sono ora atomiche, ma nota, contratto e stato contratto avvengono dopo il commit. Un errore puo' restituire HTTP fallito con booking gia' creato; manca una chiave idempotente sul create.
- **BE-08 aperto:** il cron considera gli ultimi 300 record audit globali prima della deduplica per tenant; un tenant meno recente puo' perdere il report.
- **BE-09 aperto:** la pagina clienti e' paginata, ma carica tutta la storia booking dei clienti visualizzati e aggrega in memoria.

### Sicurezza e privacy

- **Risolti nel codice:** SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06 e SEC-09.
- **SEC-07 risolto nel codice, gate dati aperto:** compensazione, metadata, quota e mount sono corretti, ma i file storici reali devono essere inventariati e backfillati prima di ricreare i container.
- **SEC-08 risolto nell'applicazione, gate infrastruttura aperto:** i token contratto sono redatti dai log applicativi; proxy, CDN, WAF e log storici devono essere controllati separatamente.
- **SEC-10 implementato, approvazione aperta:** retention e dry-run esistono, ma il job globale resta disabilitato fino all'approvazione DPO/Legal dei periodi.

### Frontend e redesign

- **FE-01..FE-05 aperti nell'interfaccia corrente.** FE-03 e FE-04 sono bloccanti per una diffusione ampia: risposte di ricerca fuori ordine possono mostrare dati non piu' coerenti con il filtro e il submit CRUD puo' essere inviato piu' volte. FE-01, FE-02 e FE-05 richiedono correzione o accettazione esplicita del rischio.
- **FE-06..FE-09 non appartengono al candidato:** sono finding del redesign separato. Non sono considerati risolti e devono tornare gate obbligatori prima di una sua futura integrazione.

### Operazioni

- **Risolti nel codice:** OPS-01, OPS-02, OPS-03, OPS-04.
- Restano obbligatorie le prove ospitate e ambientali: la sicurezza del workflow non sostituisce CI, review, staging reale, backup e rollback osservati.

### Marketing

- **MKT-01..MKT-05 restano aperti.** Non bloccano la review tecnica o un rehearsal controllato.
- **MKT-01, MKT-02 e MKT-03 bloccano il lancio paid e la vendita Enterprise:** claim non dimostrati, ciclo annuale perso nel funnel demo e matrice piani poco verificabile.
- MKT-04 e MKT-05 limitano prova commerciale e acquisizione organica; casi cliente e risultati non devono essere inventati.

## Evidenza operativa esterna e lacune

La lettura redatta del VPS ha mostrato:

- produzione ancora sulla vecchia release `db1f231dc8cb699f1a5ce4215a0278c93212d16d`;
- storage effettivo locale, con `STORAGE_PROVIDER` non impostato e `UPLOAD_DIR=uploads`;
- vecchio mount `/opt/fleetum/uploads:/app/uploads`, diverso dal nuovo percorso applicativo `/app/backend/uploads`;
- zero oggetti contati nel path host e nel vecchio path interno al momento dell'ispezione, mentre il database riportava un `StoredFileObject`;
- disco al 15% e circa 60,8 GiB liberi;
- backup giornalieri presenti e restore drill del 1 settembre osservato come PASS, con conteggi database coerenti, 42 migrazioni e 62 tabelle;
- l'archivio upload ripristinato conteneva solo il sentinel, quindi il restore di un oggetto applicativo reale non e' ancora provato.

Queste osservazioni non autorizzano modifiche sul VPS. Prima di cambiare mount o storage occorre riconciliare il record `StoredFileObject`, creare e scaricare un oggetto sintetico autenticato, includerlo nel backup e provarne il restore.

## Gate prima di staging

1. Creare la pull request del branch e ottenere CI GitHub verde sull'esatto SHA, inclusi secret scan, SAST e compatibilita' migrazioni.
2. Completare review backend, sicurezza, workflow e migrazioni; nessun override dei check obbligatori.
3. Correggere BE-06, BE-07, FE-03 e FE-04 oppure formalizzare una decisione di scope che mantenga il candidato fuori dalla produzione.
4. Preparare staging separato con database e tenant sintetici, provider test/sandbox, HTTPS e ambiente GitHub protetto.
5. Acquisire snapshot del database staging e procedura di recovery prima delle migrazioni.

## Gate prima della produzione

1. Eseguire su staging l'esatto SHA e i digest del candidato; registrare CI run, digest, migrazioni e manifest.
2. Eseguire i sei E2E critici con due tenant sintetici distinti e zero skip: autenticazione, isolamento cross-tenant, booking/pricing, billing test e logout/sessioni.
3. Ripetere le migrazioni su restore production-like redatto, misurando query preflight, durata e lock; verificare vecchia applicazione su schema nuovo e rollback applicativo.
4. Chiudere inventario/backfill upload, quota tenant, oggetto sintetico backup-download-restore e prova del provider S3 compatibile se scelto.
5. Controllare redattamente log di reverse proxy/CDN/WAF e rotazione dei log storici.
6. Ottenere approvazione DPO/Legal su retention, DPA e testi privacy; rieseguire il dry-run e revisionare i conteggi.
7. Collaudare Google/Apple, Stripe e Resend in test/sandbox senza credenziali o transazioni reali.
8. Acquisire un report backup/restore recente con RPO/RTO e riconciliazione database-oggetti.
9. Correggere o accettare formalmente BE-08, BE-09, FE-01, FE-02 e FE-05 con owner, scadenza, monitoraggio e rollback.
10. Solo dopo tutti i gate, eseguire un go/no-go firmato e una finestra di deploy con osservabilita' e rollback presidiati.

## Decisione finale della tranche

- **GO:** commit locale, pull request, CI ospitata e code review.
- **GO condizionato:** staging tecnico dopo CI esatta e predisposizione dell'ambiente separato.
- **NO-GO:** produzione oggi.
- **NO-GO:** campagne paid e vendita Enterprise finche' MKT-01, MKT-02 e MKT-03 non sono chiusi.
