# Staging minimo sul VPS della produzione

Questa variante aggiunge un ingresso HTTPS per i tre sottodomini staging al
Caddy pubblico esistente. Le configurazioni sono versionate e revisionabili;
questo documento e il collaudo locale non installano servizi sul VPS e non
approvano modifiche DNS, segreti, controlli GitHub o produzione.

## Percorso delle richieste

```text
Browser -- HTTPS:443 --> Caddy produzione
                            |
                            | HTTP, rete fleetum_staging_ingress
                            v
                       Caddy staging -- HTTP --> backend staging
                                                     |
                                              PostgreSQL staging
```

Solo il Caddy pubblico gestisce TLS, certificati e redirect HTTP→HTTPS. Caddy
staging ascolta HTTP sulla rete Docker; non pubblica 8080, 8443 o altre porte
sull'host. Backend e PostgreSQL appartengono soltanto alla rete privata staging
con `internal: true`. La rete di ingresso è anch'essa interna e comprende solo
i due Caddy, senza collegare backend o database della produzione allo staging.

Contratto della rete proposta, da verificare contro le route e tutte le reti
Docker effettive prima della creazione:

| Proprietà | Valore |
| --- | --- |
| Nome esterno | `fleetum_staging_ingress` |
| Driver / internal | `bridge` / `true` |
| CIDR / gateway | `10.203.91.0/28` / `10.203.91.1` |
| Caddy pubblico | `fleetum_caddy`, `10.203.91.2` |
| Caddy staging | `fleetum_staging_caddy`, `10.203.91.3` |
| Alias staging | `fleetum-staging-ingress` |
| Label richiesta | `com.fleetum.environment=staging` |
| Label richiesta | `com.fleetum.purpose=shared-ingress` |

Gli indirizzi fissi fanno parte del confine di fiducia: se la rete proposta
confligge, vanno modificati insieme overlay, Caddy, provisioning/preflight e
test. Non usare `private_ranges`, un CIDR intero o un numero di hop più alto
come scorciatoia.

## File da utilizzare insieme

- `docker-compose.staging.yml` rimane utilizzabile su un host dedicato e ora
  limita risorse e log; non cambia `deploy/caddy/Caddyfile.staging`.
- Per questo VPS, aggiungere `docker-compose.staging.shared.yml` **dopo** il
  file staging di base. `!reset` rimuove le porte host e `!override` sostituisce
  le reti del solo Caddy, eliminando la rete edge. Serve Compose ≥2.24.4.
- `deploy/caddy/Caddyfile.staging-shared` mantiene le route marketing/Next,
  SPA, API tenant e Platform della baseline, aggiungendo la verifica del peer.
- `docker-compose.prod.shared.yml` è l'overlay opzionale della produzione.
  Modifica solo mount e reti del Caddy, senza cambiare immagine, backend,
  dati o porte pubbliche.
- `deploy/caddy/Caddyfile.production-shared` importa il Caddyfile di produzione
  originale montato come `/etc/caddy/production-baseline` e il nuovo addendum
  montato come `/etc/caddy/staging-ingress`.
- `deploy/caddy/Caddyfile.staging-ingress` aggiunge solo i tre host canonici
  staging e il rifiuto 421 degli Host HTTPS fuori dall'allowlist; le route di
  produzione nominate continuano a prevalere sul catch-all.

La selezione degli overlay deve restare nel workflow di rilascio: un comando
temporaneo o un `docker network connect` manuale verrebbe perso al successivo
deploy. L'aggiunta iniziale di mount/rete richiede ricreare il solo Caddy
pubblico con la **stessa immagine immutabile osservata**; il reload da solo non
aggiunge mount o reti Docker. Valutare il breve impatto sulle connessioni e
verificare subito i domini di produzione. Questo passaggio live resta separato
dalla preparazione locale e deve passare dal workflow controllato.

Il workflow staging seleziona `ingressMode=shared` per questo VPS. Il valore
predefinito `dedicated` resta per host dedicati, ma rifiuta un Caddy staging già
collegato alla rete condivisa. `prepareTarget=true` crea soltanto cartelle;
non crea env, rete di ingresso o utenti e non installa il gateway pubblico.
`bootstrapSynthetic=true` serve soltanto alla prima inizializzazione, con il
JSON protetto `FLEETUM_STAGING_BOOTSTRAP_CREDENTIALS` passato su stdin; dopo
login o modifiche ai dati il bootstrap rifiuta il dataset alterato, quindi va
lasciato disabilitato nei rilasci successivi. Per l'account Ubuntu osservato
selezionare `FLEETUM_STAGING_DOCKER_MODE=sudo`, senza modificare i gruppi globali.

La persistenza nei workflow produzione richiede l'opt-in protetto
`FLEETUM_SHARED_STAGING_INGRESS=true`. Con valore false, un ingresso già attivo
ferma il rilascio prima della promotion; con true, tutti i file del bundle e
la rete esterna vengono verificati prima di backup o migration. Il guard
`deploy/scripts/shared-staging-ingress-preflight.sh` legge soltanto metadati
allowlist e ammette zero, uno o entrambi i Caddy canonici: anche il solo Caddy
staging è ammesso per recuperare una ricreazione fallita del gateway pubblico.
La prima creazione della rete e l'attivazione del solo gateway richiedono
ancora un percorso GitHub Actions dedicato e revisionato; questo codice non
autorizza a utilizzare il deploy applicativo produzione come scorciatoia.

## IP client, schema e Host

L'ingresso pubblico sostituisce `X-Forwarded-For` con l'IP del socket, imposta
`X-Forwarded-Proto=https` e conserva il solo Host canonico. Rimuove `Forwarded`,
`X-Real-IP`, `X-Forwarded-Port`, `X-Forwarded-Server` e `X-Forwarded-Prefix`.
Gli header inviati dall'utente non diventano prove di identità o di TLS.

Caddy staging accetta richieste soltanto dall'IP singolo `10.203.91.2`, richiede
schema HTTPS e un IP client inoltrato, e usa `trusted_proxies_strict` per leggere
la catena. Verso Express riscrive `X-Forwarded-For` con **un solo IP verificato**,
Host e schema canonici. Il backend può quindi mantenere `TRUST_PROXY=1` senza
fidarsi di entrambi gli hop o di un'intera subnet. Host sconosciuti sono rifiutati
con 421; altri peer con 403; uno schema diverso con 400.

Questa configurazione presuppone che il Caddy pubblico sia raggiunto direttamente
dal browser, come nell'architettura osservata. Se in futuro viene aggiunto un CDN
o un load balancer, l'IP del socket sarà quello del nuovo proxy: occorre una
nuova configurazione esplicita e una nuova prova, senza fidarsi degli header
per impostazione generale.

## Limiti locali dello staging

| Servizio | CPU | RAM massima | PID | Log Docker |
| --- | ---: | ---: | ---: | --- |
| Backend | 0.75 | 768 MiB | 256 | 10 MiB ×3 |
| PostgreSQL | 0.50 | 512 MiB | 256 | 10 MiB ×3 |
| Caddy staging | 0.25 | 128 MiB | 128 | 10 MiB ×3 |

Totale massimo configurato: 1.50 CPU e 1408 MiB RAM. Questi limiti non sono una
prenotazione o una misura della capacità libera: l'avvio va confrontato con il
consumo della produzione. Il limite dei log riguarda `json-file` Docker, non i
file applicativi montati in `/opt/fleetum-staging/logs`, gli upload o il database.
I limiti PID/RAM possono causare rifiuti o OOM nello staging; non alzarli sulla
produzione per far passare il collaudo. Non avviare test di carico sul VPS condiviso.

## Prova locale ripetibile

```bash
node --test ops/tests/staging-shared-proxy.test.mjs
node ops/verify-staging-shared-proxy.mjs --run-local-synthetic \
  --caddy-image sha256:<id-immagine-caddy-locale> \
  --backend-fixture-image sha256:<id-immagine-locale-con-express>
```

Il runner richiede un opt-in e due immagini già locali pin per ID immutabile;
non scarica immagini. Usa la libreria Express della seconda immagine soltanto
per un server echo sintetico con `trust proxy=1`, senza avviare l'applicazione,
connettere PostgreSQL o chiamare provider. Rende i Compose con variabili
sintetiche, `--env-file` vuoto e `--no-env-resolution`, senza leggere env reali.

Carica le configurazioni Caddy effettive; nella sola fixture sostituisce l'ACME
pubblico con una CA locale temporanea. Il client verifica CA e nome del
certificato, senza `--insecure` o `rejectUnauthorized=false`. La porta TLS è
casuale e pubblicata solo su `127.0.0.1`; le altre reti/container sono temporanei,
con nomi casuali. Certificati e configurazione interna Caddy vivono in tmpfs;
container, reti e directory della fixture vengono rimossi anche dopo un errore.

La prova controlla routing, isolamento del Compose, budget, header contraffatti,
IP/`ips` di Express, schema sicuro, Host, tre domini, separazione tenant/Platform,
robots/sitemap, peer non autorizzati e schema/Host errati del peer fidato.
Non è un collaudo delle credenziali/account/CSRF/licenze né dei certificati ACME,
dei DNS, dei consumi o del traffico reale del VPS. Nessun gate esterno viene promosso.

La prima verifica locale usa Caddy 2.11.3 e Express 4.22.2 da cache, mentre il
Caddy pubblico osservato è 2.11.4: adattamento/validazione sulla stessa immagine
live e prova HTTPS effettiva restano necessari prima dell'avvio.

## Rollback e persistenza

Prima dell'attivazione conservare identità dell'immagine Caddy pubblica,
configurazione/mount/reti di partenza e fingerprint della baseline. Verificare
l'addendum offline con quell'immagine e il piano del workflow. Non cambiare
immagini applicative di produzione per introdurre il solo ingresso staging.

Se lo staging dà problemi, fermare i soli servizi staging dal percorso
controllato; database, upload e credenziali staging restano separati. Il Caddy
pubblico può restituire 502 per gli host staging, senza alterare le route nominate
della produzione. La rimozione dell'ingresso è una transizione esplicita da
revisionare: il normale deploy/rollback rifiuta la disattivazione accidentale
dell'opt-in mentre la rete è ancora collegata. Il percorso approvato deve
ripristinare mount/reti del solo Caddy con baseline e digest osservati e
allineare poi la policy persistente. Un reload può cambiare le route
già montate, ma non sostituisce il ripristino di mount/reti.

Non rimuovere la rete mentre è usata; verificarne nome, label e membri prima di
qualunque pulizia. Non cancellare database o upload e non eseguire restore del
database di produzione come rollback del proxy. La reversibilità del proxy non
sostituisce backup e verifica delle migration del candidato staging.

Fonti primarie: [Caddy trusted proxies e protocollo](https://caddyserver.com/docs/caddyfile/options),
[header del reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy),
[merge e reset Docker Compose](https://docs.docker.com/reference/compose-file/merge/).
