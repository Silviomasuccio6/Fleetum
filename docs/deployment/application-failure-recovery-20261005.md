# Fleetum — recovery applicativo locale dopo un guasto, 5 ottobre 2026

Questo runbook estende le prove di
[restore locale](restore-recovery-20261005.md) e
[compatibilità monetaria e storage](money-storage-compatibility-20261005.md).
L'opzione `--application-recovery` aggiunge quattro guasti controllati a una prova
con PostgreSQL 16 temporaneo, due tenant sintetici e file registrati sintetici.
La nuova estensione è **PASS locale** sul candidato descritto nel registro finale.
Le ricevute iniziali fallite e finali sono conservate separatamente.

La prova ricostruisce e riavvia una coppia precisa di backend e client frontend.
La sorgente di riserva è
`9bd57ff2f935a3a56205f381b41d35bfc982dd9a`: deve conservare lo stesso codice
applicativo, schema, dipendenze e correzioni di sicurezza del candidato. Il runner
verifica questa equivalenza prima della preparazione. Non rappresenta una release
precedente distinta già distribuita in produzione e non diventa un fallback
operativo approvato.

La baseline `db1f231dc8cb699f1a5ce4215a0278c93212d16d` serve al confronto storico
tra 42 e 48 migrazioni. Precede correzioni di sicurezza, non identifica la versione
live e non può essere scelta come sorgente di recovery applicativo.

## Preparazione e comando opt-in

Usare una copia locale isolata del tooling e un object store Git locale verificato.
Registrare SHA completo e tree del tooling, SHA completo del candidato e hash dei
file effettivamente eseguiti. I placeholder del comando devono essere sostituiti
prima dell'esecuzione; la directory di evidenze deve essere nuova o vuota, con un
percorso assoluto canonico e senza symlink.

Sono richiesti Node 22.23.1 nel `PATH`, cache npm disponibile per installazione dal
lock in modalità offline, engine Prisma locali verificabili e un'immagine
`postgres:16-alpine` già presente. Il runner non effettua pull. Usare soltanto un
socket Docker Unix locale; eseguire una prova database alla volta. Le esecuzioni
su CI ospitata vengono rifiutate.

```sh
NODE_ENV=test DOTENV_CONFIG_PATH=/dev/null node ops/verify-restore-recovery.mjs \
  --source-sha b5332ca5d9100c82cc4c6ffb5ba4c2f8e86a650c \
  --baseline-sha db1f231dc8cb699f1a5ce4215a0278c93212d16d \
  --recovery-source-sha 9bd57ff2f935a3a56205f381b41d35bfc982dd9a \
  --application-recovery \
  --git-dir /absolute/git \
  --docker-host unix:///local/socket \
  --evidence-dir /private/tmp/fleetum-application-recovery-evidence-new
```

`--application-recovery` è un flag senza valore. Richiede anche
`--recovery-source-sha`; la sorgente di riserva richiede a sua volta il flag.
Gli SHA devono contenere tutti i 40 caratteri esadecimali minuscoli. Il runner
controlla identità dei commit, ascendenza e assenza di differenze applicative fra
riserva e candidato. Se il candidato modifica le superfici applicative rispetto
alla riserva fissata, interrompere la prova e riesaminare la coppia: non aggirare
il controllo scegliendo la baseline storica.

Le superfici confrontate includono `backend/src`, `backend/prisma`, i file package
e configurazione TypeScript del backend, `frontend`, `packages`, `package.json` e
`package-lock.json`. Tooling e documentazione possono avere un commit successivo;
le loro identità vanno registrate separatamente.

## Ambiente temporaneo e riapertura del traffico

Il runner crea un proprio albero
`/private/tmp/fleetum-restore-recovery-<identificativo>/` con archivi Git separati
`baseline`, `source` e `reserve`, home temporanea, database sintetici, container e
bridge dedicati. PostgreSQL è pubblicato soltanto su loopback. Il bridge non
attesta un blocco egress del container o la policy di rete dello staging reale.

L'archivio di riserva viene installato dal proprio lock e compilato. Il wrapper
carica il vero `backend/dist/app.js`, chiama `createApp` e `createPlatformApp` e
carica il client Prisma compilato. I due listener usano porte casuali su
`127.0.0.1`; il gateway HTTP locale serve il vero `frontend/dist` e inoltra le
richieste API. Non viene importato il punto di avvio dei server con i cron.

Il subprocesso richiede `NODE_ENV=test`, `DOTENV_CONFIG_PATH=/dev/null`, URL
PostgreSQL su loopback e un database
`fleetum_restore_<32 caratteri esadecimali>_first` o `_second`. `UPLOAD_DIR` resta
dentro il proprio archivio. I percorsi runtime rifiutano symlink e dotenv reali.
L'ambiente viene ricostruito con valori sintetici: segreti e configurazioni dei
provider del chiamante non vengono ereditati. HTTP, HTTPS e `fetch` dei provider
sono bloccati prima degli import applicativi.

Ogni avvio ha un UUID distinto e un file
`reserve/recovery-state/<UUID>.json`, creato con `wx` e permessi `0600`.
Un file già presente non viene sovrascritto né accettato come prova dell'avvio
nuovo. Il marker `FLEETUM_APPLICATION_SERVER` trasporta soltanto fase, porte,
generazione, SHA e, in caso di errore, un nome di errore ammesso. I log grezzi
applicativi e le credenziali non entrano nelle ricevute.

Il gateway rimane in manutenzione con HTTP 503 per pagina, API e Platform API
durante il guasto e il recupero. La riapertura richiede simultaneamente:

1. Backend e frontend provenienti dalla sorgente fissata, con inventari SHA256
   corrispondenti alla coppia compilata e schema a 48 migrazioni.
2. `/api/ready` e `/platform-api/ready` con HTTP 200, `ok=true` e `db=up`, osservati
   dopo l'avvio corrente e appartenenti alla sua generazione.
3. Ricevute di readiness vecchie al massimo **1.000 ms**, ricontrollate anche
   prima della riapertura. Risposte anteriori all'avvio, future, di un'altra
   generazione o scadute vengono rifiutate.
4. Fotografia completa del database e inventario dei bytes upload identici a
   quelli acquisiti dopo le scritture confermate e prima del guasto.

Ogni scenario ha un budget locale fisso di **30.000 ms**, dal momento osservato
del guasto alla riapertura autorizzata dalla policy. È scelto prima della prova;
non è uno SLA esterno, un RTO approvato o una previsione di produzione. Il campo
`recoveryMs` misura questo intervallo. Lo smoke successivo alla riapertura rimane
un controllo ulteriore necessario per dichiarare riuscito lo scenario.

## Quattro guasti effettivi richiesti

Prima di ciascun guasto il runner avvia la coppia fidata, verifica entrambe le
readiness e conferma login, letture, scrittura con CSRF e download. Acquisisce poi
gli snapshot del database e degli upload che dovranno sopravvivere al guasto.

| Scenario nel risultato | Guasto introdotto | Rifiuto e recovery richiesti |
| --- | --- | --- |
| `startup-rejected` | `JWT_SECRET` sintetico troppo corto prima dell'import della vera configurazione | Il processo esce con codice 1 e senza fase `listening`; il gateway resta 503. Si riavvia la coppia fidata e si verificano tutte le condizioni di riapertura. |
| `database-unready` | URL sintetico con porta loopback 1 e `connect_timeout=1` | Entrambe le readiness restituiscono 503 con `db=down` mentre `/api/health` resta 200. Il solo health non permette la riapertura. Il nuovo avvio usa il database sintetico corretto. |
| `pause-before-import` | Processo sospeso dopo il marker `starting`, prima degli import applicativi, poi interrotto con `SIGKILL` | L'esito del processo attesta `SIGKILL` e nessuna API viene pubblicata. Il nuovo UUID impedisce che il file residuo dell'avvio interrotto autorizzi quello successivo. |
| `client-artifact-mismatch` | Alterazione controllata dei bytes di `frontend/dist/index.html` | Anche con entrambe le API pronte, l'hash frontend non corrisponde alla coppia fidata: il traffico rimane 503. Solo il ripristino dei bytes originali e nuove ricevute valide permette la riapertura. |

Dopo ciascun recovery verificare la pagina, un asset JavaScript e un asset CSS
contro gli hash originali, oltre allo smoke HTTP applicativo. Un processo avviato,
una risposta health 200 o la sola pagina HTML non sono sufficienti.

## Dati confermati, denaro e file

La fixture attesa contiene **67 tabelle** nello snapshot schema48 e **4 file
registrati**, due legacy e due moderni distribuiti fra i due tenant. Gli snapshot
canonici includono tutte le tabelle, conteggi e hash: non bastano somme aggregate
o la sola proiezione delle entità di business. Ogni scenario deve riportare
`tablesPreserved`, `recordsPreserved`, `beforeSha256`, `afterSha256`,
`registeredUploadsPreserved` e i due hash degli inventari upload coerenti.

Il confronto comprende le scritture HTTP confermate prima del guasto. Login e
audit possono aggiungere righe legittime; le fotografie vengono quindi acquisite
dopo lo smoke iniziale e confrontate prima dello smoke successivo alla riapertura.
Non si dichiara che il database resti immutato per tutta l'esecuzione. La perdita
locale ammessa sui record fotografati è zero (`acknowledgedDataLoss=0`); questo
non definisce l'RPO operativo su scritture concorrenti o sistemi esterni.

Con l'opzione attiva, i **35 campi monetari**, in 13 tabelle e 206 coppie
campo/riga della fixture, vengono verificati in cinque fasi:

| Fase | Ricevuta richiesta |
| --- | --- |
| `schema42` | Aspettative Float/Decimal della fixture e zero mismatch |
| `schema48` | Stesso hash monetario dopo le sei migrazioni additive |
| `first-restore` | Stesso hash nel primo database ripristinato |
| `second-restore` | Stesso hash nel secondo database ripristinato |
| `after-application-recovery` | Stesso hash dopo tutti i quattro recovery applicativi |

In ogni fase il runner usa anche la riconciliazione e il verificatore dual-write
ufficiali dell'archivio. Il verificatore prova INSERT sui 35 campi e UPDATE su
`VehicleCost.amount` soltanto: non estendere quest'ultimo risultato agli altri
34 campi. `RentalDeposit.amountCents` ha un controllo aggiuntivo separato e non
viene contato come trentaseiesimo campo del catalogo.

I quattro file registrati vengono materializzati nella radice assoluta della
riserva mantenendo le chiavi nel database. Digest e dimensioni del manifest,
inventario prima/dopo e bytes serviti devono essere coerenti. Lo smoke effettua
login con cookie per A/B, verifica isolamento delle letture, rifiuto di scrittura
senza CSRF e riuscita della scrittura con CSRF. Per i download legacy e moderni
controlla i bytes del proprietario A, il rifiuto per B e il rifiuto per l'anonimo.
L'inventario copre anche i file di B; questa versione della fixture non dichiara
un download HTTP riuscito dei file propri di B.

Restano invariati e verificati gli stati dell'utente sospeso, della sessione
revocata, dell'email pendente con lease e deduplication key e del cursore dei
report. I worker restano fermi. Queste prove HTTP non eseguono un browser reale,
non verificano il rendering del frontend e non attestano login o flussi della
Platform Console; la Platform API è esercitata qui per readiness.

## Esito, interruzione e cleanup

Leggere `result.json` nella directory di evidenze, non dedurre PASS dall'ultimo
messaggio di un subprocesso. Richiedere `success=true`,
`applicationRecovery.success=true`, quattro scenari riusciti, tutte le ricevute
monetarie nelle cinque fasi, inventari e controlli storage coerenti e cleanup
completo. Una sezione mancante, un errore, un'interruzione o un cleanup fallito
impedisce di dichiarare superata la prova.

In caso di errore o interruzione:

1. Lasciare il gateway in manutenzione e attendere il cleanup del runner. Non
   riaprire manualmente il traffico sulla base del solo health.
2. Arrestare soltanto i gruppi dei subprocessi creati dalla prova. Il wrapper
   gestisce `SIGTERM`, chiude connessioni e listener, avvia la disconnessione di
   Prisma e impone un limite di 2,5 secondi per l'uscita; il controller usa un
   limite di 3 secondi prima del `SIGKILL` sul
   proprio gruppo. Il `SIGKILL` previsto dallo scenario può lasciare il proprio
   file di generazione, che non è una ricevuta riutilizzabile.
3. Controllare `applicationRecovery.cleanup.childrenStopped` e `gatewayClosed`,
   quando presenti. Per il runner principale richiedere container e network
   `removed-and-verified` e scratch `removed`.
4. Se resta una risorsa, verificarne l'identità tramite i nomi esatti registrati
   in `isolation.container` e `isolation.network` e il socket locale registrato.
   Un eventuale cleanup manuale deve riguardare solo quelle risorse possedute.
   Non usare rimozioni per prefisso, `prune`, container applicativi reali o kill
   di processi non identificati come figli della prova.
5. Conservare le evidenze esterne allo scratch. Riesaminare la causa e ripetere
   dalla preparazione con una nuova directory di evidenze; non riutilizzare un
   database parziale, un vecchio file ready o una coppia di hash diversa.

Il runner rimuove soltanto il proprio container, bridge e scratch. Durante il
recovery applicativo riavvia la coppia fidata sul database già ripristinato:
non esegue un restore database automatico per correggere un guasto dell'app.

## Registro della nuova esecuzione

Il registro proviene dalle ricevute del run finale del5ottobre2026. La prima prova
si è fermata al verificatore money, che non ammetteva la nuova etichetta di fase;
i quattro guasti erano già superati. Dopo test RED/GREEN e la correzione del solo
verificatore, la prova completa è stata ripetuta sul candidato finale.

| Evidenza | Esito locale |
| --- | --- |
| Tooling e candidato | PASS `b5332ca5d9100c82cc4c6ffb5ba4c2f8e86a650c`, tree `2fa16975b0b50800d16a6aff0926293cf4d9656b` |
| Equivalenza applicativa/sicurezza riserva | PASS; riserva9bd57ff2; nessuna differenza applicativa |
| Coppia compilata | PASS; 188 file backend, 148 frontend; hash/inventari in result.json |
| startup-rejected | PASS; riapertura 1648.118 ms; 67 tabelle/4 upload invariati; perdita record0 |
| database-unready | PASS; riapertura 1917.255 ms; 67 tabelle/4 upload invariati; perdita record0 |
| pause-before-import | PASS; riapertura 1325.763 ms; 67 tabelle/4 upload invariati; perdita record0 |
| client-artifact-mismatch | PASS; riapertura 1287.628 ms; 67 tabelle/4 upload invariati; perdita record0 |
| Denaro | PASS;35campi/13tabelle/206coppie in5fasi; stesso hash |
| HTTP | PASS;153asserzioni, incluse96 prima/dopo i quattro guasti |
| Stati auth/worker/report | PASS; sospeso, revocato, email pendente e cursore conservati |
| Cleanup | PASS; processi/gateway chiusi, container/network assenti, scratch rimosso |
| Esito locale | PASS;46controlli, durata complessiva 180926 ms |

Il tempo di recupero misura dal guasto alla riapertura dopo readiness API/Platform,
integrità del bundle e dei dati/file. Le verifiche HTTP e bytes frontend successive
sono parte del successo complessivo, non del valore `recoveryMs`. Budget locale30s,
readiness massima1s: non sono SLA approvati per lo staging o la produzione.

Il build usa `NODE_ENV=test`. I due build indipendenti hanno hash frontend diversi;
questa prova verifica la coppia compilata congelata dentro ogni run e la sua
invarianza durante il recupero. Non dimostra build riproducibili byte per byte
tra run né identifica digest di immagini OCI. L'hash frontend del run finale è
`032efbd79e09266895181342e23bbdb0104b2141e5a1c0de215e86db5595dacf`; backend
`73a6304a7255141d51b4d6f59cd5483e3c6ae14c34ba0769d5801ccca4fbbf9c`.

## Limiti e gate esterni

La prova non esegue down migration, eliminazione di vincoli, restore automatico
del database, replay di email o pagamenti, cron, modifiche a `main`, push, merge
o deploy. Compila artefatti locali; non verifica immagini OCI, digest distribuiti,
servizi live, storage remoto, provider, routing TLS o un browser reale.

Budget di lock, RTO/RPO e release di fallback restano soggetti a verifiche e
approvazioni sullo stack effettivo. I gate esterni, inclusi G04/G12/G14, rimangono
PENDING. Un PASS locale dimostra esclusivamente gli scenari sintetici eseguiti e
non autorizza produzione né il riavvio di worker storici.
