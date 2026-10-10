# Controllo del solo ingresso staging

Il workflow `.github/workflows/staging-ingress.yml` prepara un percorso dedicato
per il primo ingresso condiviso. Non rilascia backend, database o frontend nuovi.
Ricrea il Caddy pubblico con **la stessa immagine live immutabile già locale**;
il contenuto del sito resta quello di quell'immagine. La ricreazione comporta
una possibile breve interruzione delle richieste pubbliche. L'implementazione
e le prove locali non autorizzano o attestano un'attivazione sul VPS.

## Operazioni e confini

| Operazione | Comportamento |
| --- | --- |
| `plan` (default) | Controlli in sola lettura su produzione; restituisce snapshot e digest, senza modificare rete, container, file di produzione o certificati. Il trasferimento crea una cartella temporanea di soli sorgenti pubblici, rimossa alla fine. |
| `apply` | Ricontrolla il piano, confronta il contatto ACME dentro il Caddy senza emettere il suo ambiente, crea soltanto la rete ingress se assente, aggiunge due file Caddy e ricrea il solo servizio `caddy`. |
| `recover` | Ripristina il manifest originale del solo Caddy usando il diario dell'operazione; funziona anche se il gateway è fermo o assente. Non cancella la rete condivisa o lo staging. |

I tre modi richiedono sorgenti approvati con SHA completo e CI verde sullo
stesso SHA, con l'artefatto effettivo `ci-source-proof` e sei job obbligatori
verificati. Il checkout è `github.workflow_sha`, senza credenziali Git persistenti.
Un verde storico o un semplice input utente non autorizzano il sorgente.
`plan` usa l'environment protetto `staging`; i due modi che modificano il
gateway usano `production`. Configurare i reviewer e le restrizioni dei branch
di questi environment prima del dispatch. Il workflow deve essere registrato
sul branch predefinito per essere disponibile a `workflow_dispatch`.

La concorrenza Actions è `fleetum-production`, senza cancellazione del job
precedente. Tutti i modi acquisiscono inoltre il lock esistente
`/opt/fleetum/deploy.lock` con `flock` esclusivo non bloccante. Lock mancante,
alias, inode non regolare o occupato fermano il controllo; non si crea un lock
alternativo. Cartella applicativa e lock devono coincidere con i percorsi
canonici dei controlli produzione. SSH è con host key pin e senza password;
il comando privilegiato è Python isolato (`sudo -n python3 -I -B`).

Non vengono letti file env reali, ambienti dei container o output di healthcheck
Docker. Il contatto ACME è un input protetto già approvato, passato su stdin e
nell'ambiente del solo processo Compose, mai su argv, disco o artefatti.
Il diario conserva soltanto il suo hash per verificare il recupero. Non
modificare il contatto o copiare il file env di produzione per far passare il gate.
L'esecuzione Docker usa una directory di configurazione vuota, senza login
registry, download o build. Il Caddy corrente deve contenere lo stesso contatto.

## Pin e prerequisiti protetti

Impostare i valori soltanto dopo la revisione del commit definitivo. Questo
runbook non li crea o modifica e non contiene segreti.

| Variabile o secret | Scopo |
| --- | --- |
| `FLEETUM_INGRESS_TRUSTED_WORKFLOW_SHA` | SHA completo del workflow e helper approvati. |
| `FLEETUM_INGRESS_APPROVED_SOURCE_SHA` | Stesso SHA completo del bundle Caddy approvato. |
| `FLEETUM_INGRESS_CADDY_IMAGE` | Digest GHCR completo dell'immagine frontend/Caddy live, già presente sul server. Nessun tag. |
| `FLEETUM_INGRESS_BASELINE_COMPOSE_SHA256` | Hash approvato del Compose produzione originale, uguale a sorgente e server. |
| `FLEETUM_INGRESS_BASELINE_CADDY_SHA256` | Hash approvato del Caddyfile produzione originale, uguale a sorgente e server. |
| `FLEETUM_INGRESS_PRODUCTION_CONTROL_SHA` | HEAD completo approvato del branch predefinito, con persistenza shared presente in deploy e rollback. |
| `FLEETUM_SHARED_STAGING_INGRESS` | `true` per attivare e conservare l'ingresso nei rilasci successivi; `false` soltanto per il recupero esplicito della baseline. |
| `FLEETUM_INGRESS_HOST`, `FLEETUM_INGRESS_USER` | Secret SSH con host e utente validati. |
| `FLEETUM_INGRESS_SSH_KEY`, `FLEETUM_INGRESS_KNOWN_HOSTS` | Secret separati per chiave e host key approvata. |
| `FLEETUM_INGRESS_CADDY_EMAIL` | Secret del contatto ACME corrente; non serve al modo `plan`. |

Le variabili possono essere repository scoped o replicate nei due environment
secondo la protezione concordata. I controlli produzione effettivi e i loro
percorsi devono essere visibili/coerenti nell'environment `production`.
Prima di `apply` e `recover`, l'API GitHub verifica HEAD del branch predefinito
contro il pin e presenza dei controlli shared nei tre file di deploy/rollback.
Non basta che quei controlli esistano sul branch locale: il branch predefinito
deve averli adottati con revisione separata. Se manca questa adozione, il job
si ferma prima del trasferimento SSH. Non usare un deploy applicativo come
scorciatoia per attivare il gateway.

Sorgente, stato e rete sono verificati ancora dal controller sul server:
Caddy **2.11.4**, Compose **2.40.3** (ammesso suffisso packaging `+...`), digest,
comando/utente/restart/porte/mount canonici, TLS nei volumi esterni esistenti
`app_caddy_data` e `app_caddy_config`, tre container nel progetto `app`, rete
privata produzione invariata. Un aggiornamento di versione o hardening live
diverso richiede nuova osservazione/revisione, non un bypass.

La rete `fleetum_staging_ingress` è bridge interna IPv4 `10.203.91.0/28`, gateway
`.1`, Caddy pubblico `.2`, staging `.3`, con label di proprietà e solo membri
canonici. Il controllo riconta reti Docker e route di tutte le tabelle prima
della modifica e del recupero. Rifiuta CIDR sovrapposti, membri estranei, driver,
IPAM, opzioni o indirizzi non canonici. Una rete esistente non viene adottata
per il solo nome. Nessun `prune`, `network connect` improvvisato o migrazione DB.

## Sequenza operativa dopo la revisione

1. Pubblicare/revisionare il delta e ottenere CI sul suo SHA. Adottare
   separatamente i controlli persistenti sul branch predefinito; nessuna
   autorizzazione implicita a merge o deploy deriva da questo documento.
2. Verificare trust SSH, privilegi necessari, lock, digest e baseline correnti;
   predisporre pin/environment protetti. Eseguire `plan` sullo SHA approvato.
3. Revisionare lo snapshot nell'artefatto `staging-ingress-<run-id>`: versioni,
   identità app, route/reti e digest. Lo snapshot non contiene credenziali.
4. Per `apply`, fornire il digest del piano e la conferma esatta
   `ACTIVATE_STAGING_INGRESS`, con policy persistente `true`, dopo autorizzazione
   dell'impatto sul proxy pubblico. Qualsiasi deriva rilevante rifiuta il piano.
5. Conservare diario e manifest root-only in `/opt/fleetum/ingress-control`,
   identificati dal digest del piano. Verificare risultato e tre health HTTPS
   produzione sia sul gateway locale (`curl --resolve`, TLS verificato) sia via
   DNS pubblico; ID, immagine, avvio e restart count backend/PG devono restare uguali.
6. Proseguire con preparazione host/staging, immagini candidate, bootstrap
   sintetico, DNS OVH e collaudo browser secondo il runbook staging. L'ingresso
   da solo non crea account, database, servizi staging o record DNS.

`caddy adapt` nel Caddy corrente controlla la sintassi, sopprimendo output e
senza provisioning dei certificati. Durante l'attivazione il Caddy tenta TLS
per gli host staging: la validazione live richiede DNS corretti e raggiungibilità.
Le sole health produzione non provano readiness, certificati o routing staging.
È possibile osservare errori staging finché i servizi/DNS non sono predisposti.
Non dichiarare lo staging operativo prima dei collaudi sui tre domini.

## Guasti, retry e recupero

Il diario ha permessi `0600` dentro una cartella root `0700`; gli aggiornamenti
sono atomici con fsync. I manifest contengono soltanto Caddy e il placeholder
ACME, senza backend, PG, env_file, build o depends_on. Il comando Compose limita
esplicitamente il servizio a `caddy`, con `--no-deps --no-build --pull never` e
`--env-file /dev/null`. Il Caddyfile originale non viene sovrascritto.

Dopo l'avvio, health retry limitati danno tempo al Caddy di diventare operativo.
Un errore dopo il tentativo di ricreazione avvia il recupero automatico della
baseline e ricontrolla le applicazioni. Se il recupero fallisce, risultato
`recovery-failed`: non rilanciare un deploy produzione o un reset del database.
Un guasto prima della ricreazione lascia il gateway originale e può lasciare
rete/file controllati; non cancella automaticamente risorse condivise.

Se si perde la risposta dopo un `apply` riuscito, ripetere con il **digest
originale**: stesso diario, gateway attivo e identità app producono
`already-active` senza altra ricreazione. Con diario incompleto è richiesto
recupero, non una nuova attivazione alla cieca. Diario senza manifest baseline
o alterato viene rifiutato e richiede riconciliazione manuale revisionata.

Per `recover` usare stesso SHA/baseline/immagine/contatto e digest originale,
con conferma `RECOVER_STAGING_INGRESS` e policy persistente `false`. Il controller
verifica app, proprietà del gateway se presente, rete privata, route e manifest
prima del tentativo. Un gateway appartenente ad altri, dati app cambiati o un
diario diverso vengono rifiutati. Il recupero stacca il solo gateway dall'ingresso
con la ricreazione della baseline; rete, staging e volumi restano intatti.
Questa transizione richiede revisione del rapporto tra policy produzione e
staging; non è il rollback applicativo ordinario, che conserva l'ingresso.

Le directory temporanee SSH e le chiavi sul runner vengono rimosse nel cleanup;
in caso di indisponibilità SSH il cleanup remoto può fallire e lasciare soli
sorgenti pubblici sotto `/tmp/fleetum-ingress.<sha>.<random>`, senza contatto ACME.
Non rimuovere il diario root quando si puliscono questi trasferimenti.

## Prove locali e fonti

`node --test ops/tests/staging-ingress-control.test.mjs` integra la suite Python
stdlib con subprocess sostituiti e filesystem sintetico temporaneo: rifiuti,
piano senza mutazioni, lock, retry, guasti, recupero da gateway fermo/assente,
assenza di segreti in manifest/diario e controlli di workflow/source/policy.

Il runner opt-in `ops/verify-staging-ingress-lifecycle.mjs` usa **solo** immagini
locali pin. Richiede Compose 2.40.3 su PATH (`docker-compose` standalone per il
Mac, senza credenziali Docker) e Caddy 2.11.4. Genera i manifest dallo stesso
controller, poi sostituisce esclusivamente nomi fixture, digest dell'immagine
ufficiale, asset sintetici, porta TLS loopback casuale e CA locale. Ricrea solo il gateway,
verifica app/certificati invariati e recupero da gateway fermo, infine verifica
cleanup di container/reti/volumi creati. Backend HTTP e contenitore PG sono
fixture sintetiche: questa prova non accede a un database né sostituisce il
collaudo Linux/Ubuntu, dell'immagine GHCR live, di Actions/SSH o dello staging.

```sh
node ops/verify-staging-ingress-lifecycle.mjs --run-local-synthetic --caddy-image sha256:<ID_LOCALE_COMPLETO>
node ops/verify-staging-shared-proxy.mjs --run-local-synthetic --caddy-image sha256:<ID_LOCALE_COMPLETO> --backend-fixture-image sha256:<ID_FIXTURE_LOCALE_COMPLETO>
```

Fonti primarie: [Compose up](https://docs.docker.com/reference/cli/docker/compose/up/),
[interpolazione ed env_file](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/),
[Caddy adapt e validate](https://caddyserver.com/docs/command-line),
[Compose v2.40.3](https://github.com/docker/compose/releases/tag/v2.40.3).
Le prove locali non promuovono nessuno dei 19 gate operativi esterni.
