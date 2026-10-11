# Fleetum — revisione integrata e collaudo locale, 1 ottobre 2026

Branch `codex/integrated-review-rehearsal`, base `174101e901e08b0ed9293e1913735a9db5904998`.
Il commit finale e i checksum sono registrati nelle evidenze esterne
`Fleetum-audit-20260909/evidence/20261001-integrated-review-rehearsal/`.
Questo documento descrive il candidato locale: non certifica CI ospitata, staging o VPS.

## Scopo e correzioni

Review dei 37 finding originali e delle tranche successive, collaudo browser/API
con due tenant sintetici e diagnosi riproducibili dei rischi residui. Nessun redesign,
provider live, migrazione nuova, backfill, push, merge o deploy.

I test ora conservano il prefisso `/api/`, usano una chiave di creazione booking
stabile per operazione e selezionano gli elementi effettivamente visibili. Il login
gestisce il banner cookie scegliendo Solo necessari: non abilita analytics.
Il boundary degli errori mantiene la pagina sana al cambio query/hash e recupera
una pagina fallita alla navigazione. La selezione booking deve seguire l'URL senza
un ciclo fra stato locale e query; il test di contratto include cambi di selezione
e navigazione, oltre a PDF e firma. Detail e contratto sono visibili soltanto
per l'ID corrente: versioni richiesta e controlli al completamento impediscono
a risposte o mutation obsolete di sostituire i dati della nuova selezione.

## Esecuzione locale isolata

Prerequisiti: Node 22.23.x, dipendenze già installate da lockfile, client Prisma
generato, Docker locale su socket Unix, immagine `postgres:16-alpine`, OpenSSL e
Chromium Playwright già disponibili. Non installa automaticamente servizi/provider.
Eseguire dalla root della copia isolata senza file `.env` reali:

```sh
node ops/verify-local-rehearsal.mjs --run --source-sha "$(git rev-parse HEAD)"
```

Il runner non eredita i segreti della shell e disabilita dotenv. Fissa Docker al
socket locale con configurazione vuota, crea PostgreSQL su una porta loopback
casuale, applica le 48 migrazioni esistenti e crea due aziende/account fittizi.
Le credenziali effimere vengono oscurate nei log. Importa `createApp` senza cron,
simula soltanto il sender email e mantiene autentici auth, CSRF, ruoli, licenze,
rate limit e query. Stripe/OAuth/storage esterni non sono configurati.

Un certificato locale effimero serve l'app e `/api` sulla stessa origine HTTPS.
Il browser usa un proxy che ammette soltanto quel gateway; i service worker sono
bloccati. Il server di prova rifiuta HTTP esterno e redirect fetch. La build usa
l'API loopback e gli artefatti rimangono fuori dai sorgenti da consegnare.
Certificato, chiave, upload, processi e database vengono rimossi alla fine,
anche in caso di fallimento. SIGINT/SIGTERM avviano lo stop del gruppo di processi,
con escalation temporizzata. Un'interruzione non produce un esito positivo.

`summary.json`, log, report JSON e `ops/e2e/verify-report.mjs` distinguono una prova
eseguita da una suite saltata. Il gate richiede tutti i sei casi critici e zero skip,
fallimenti ed errori runner. Nelle prove storiche qui descritte `--source-sha`
identificava la base dichiarata: usare manifest e diff per l'identità dei file testati.
Dal 9 ottobre 2026 il runner richiede invece lo SHA esatto di HEAD e un checkout
pulito, inclusi i file non ignorati non tracciati, prima di allocare risorse.
Registra HEAD, tree e stato iniziale in `summary.sourceProof`; questa verifica
iniziale non attesta l'assenza di modifiche durante l'esecuzione. L'opzione
facoltativa `--evidence-dir` accetta soltanto un percorso assoluto; omettendola
si usa la cartella locale predefinita. Non riprodurre gli script storici di
sincronizzazione/commit sul checkout chiuso.

## Copertura e gate

| Flusso | Evidenza locale | Verifica ancora necessaria |
|---|---|---|
| Login UI/sessione API | Sei E2E includono entrambi | Cookie Secure/SameSite e origine del proxy con configurazione produzione |
| Veicolo, booking, contratto | Creazione, selezione, PDF e firma nei sei E2E | Errori upload/foto/storage reale e parity mobile/tastiera |
| Report | PDF/XLSX/CSV nei sei E2E | Cron, backlog/code legacy, provider e carico realistico |
| Isolamento A/B | Accesso anonimo e lettura/mutazione del tenant B negati | Matrix completa, ruoli ridotti, Platform e dataset realistico redatto |
| Reset, inviti, logout, refresh/OAuth | Test delle tranche backend precedenti; non flussi browser nuovi | HTTPS staging, retry reali, callback Google/Apple e SLA revoca |
| Extra/depositi | Diagnostico in memoria dei difetti aperti | Correzioni finanziarie, concorrenza PostgreSQL, firma webhook e provider sandbox |
| Migration/rollback | 48 migrazioni applicate da zero in rehearsal | Restore redatto, app precedente su schema migrato e restart/health falliti |
| Deploy/CI | Workflow revisionati e gate locali | CI sullo SHA finale, digest immutabile e stato VPS verificato separatamente |

La modalità `NODE_ENV=test` e l'accettazione del certificato locale non verificano
i flag cookie di produzione. Il rehearsal non misura carico, consegna email,
isolamento storage, capacità del provider o correttezza di pagamenti reali.

## Blocchi finanziari aperti e diagnostico

```sh
NODE_ENV=test DOTENV_CONFIG_PATH=/dev/null node --import tsx ops/e2e/rental-financial-diagnostic.ts
```

Il diagnostico sostituisce tutte le dipendenze repository/provider con memoria,
nega rete e usa un endpoint database loopback inutilizzabile. Un exit 0 indica
che la diagnosi è stata eseguita, non che il comportamento finanziario sia corretto.

- **INT-01 (P1)**: eventi PaymentIntent distinti e consegnati fuori ordine possono
  retrocedere extra PAID a FAILED/CANCELED e depositi CAPTURED a FAILED/RELEASED.
  La deduplicazione dell'esatto stesso event ID non protegge dall'ordine dei distinti.
- **INT-02 (P1)**: annullamento di un extra durante PAYMENT_PROCESSING può essere
  confermato come CANCELED e poi sovrascritto da PAID quando termina la risposta
  provider. Le transizioni devono avere precondizioni coerenti, con gestione di
  outcome incerto, retry e riconciliazione: non basta impedire una scrittura PAID.

Le prove entrano direttamente nel servizio: non dimostrano firma HTTP, validità
di ogni sequenza presso Stripe, timing PostgreSQL o incidenza su dati live.
Prima della release, verificare il legame immutabile tenant/risorsa/PaymentIntent,
la fonte autorevole provider e le transizioni concorrenti. Nessuna riparazione
monetaria o modifica del provider viene eseguita da questo diagnostico.

## Stato complessivo, rollback e prossima azione

Il registro integrato esterno distingue 26 finding originali corretti nel codice,
2 parziali (BE-03 storico e SEC-10 retention), 4 esclusi del redesign e 5 marketing
aperti. Questo conteggio non è un punteggio sicurezza né un'autorizzazione release.
Il contatore veicoli zero con una riga visibile è un'osservazione separata da
confermare sul payload; non attribuirlo a un errore di metadati senza prova.

Rollback applicativo al parent, coordinando API e frontend; nessuna migrazione
o modifica economica da annullare in questa tranche. Il rollback reintroduce i
difetti E2E e il ciclo di remount del frontend. I database del rehearsal sono usa e
getta e non devono essere riutilizzati o restaurati su ambienti condivisi.

Pronta per review quando log e manifest finali sono verificati; **produzione
bloccata** dai due rischi finanziari e dai gate esterni. Prossima tranche:
transizioni e riconciliazione rental payment con test RED/GREEN, poi rehearsal
completo e CI sul candidato esatto. Redesign e claim commerciali restano filoni
separati; paid/Enterprise richiedono chiusura dei rispettivi finding marketing.
