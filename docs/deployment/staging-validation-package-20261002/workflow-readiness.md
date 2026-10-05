# Fleetum — revisione workflow del pacchetto staging

Data revisione: 2026-10-02T11:45:20.187811+00:00
Candidato comunicato: `459ceed2f7b9a2ee1d2756d326c94dd23acde2e3`.
Copia analizzata: `/private/tmp/fleetum-be08-validation`, copia di esecuzione senza `.git`.
Autorizzazione: preparazione locale del pacchetto; nessun push, PR, merge, dispatch, deploy, provider o DB reale.

## Esito e limite della prova

Il repository contiene un flusso staging manuale con CI sul SHA risolto e immagini GHCR deployate per digest. Il flusso reale è **CI → dispatch Deploy Staging → risoluzione SHA/CI proof → build e pubblicazione GHCR → deploy/migration/restart → health → E2E separato → eventuale recovery approvata**. Il workflow staging non esegue snapshot, E2E, verifica automatica della precedente applicazione sullo schema migrato o rollback automatico.

Questa analisi prova il contenuto dei file locali elencati sotto; non prova CI hosted, immagini esistenti, digest, configurazione/segreti GitHub, host reale, DB, provider o release attualmente in esecuzione. Il SHA del candidato è l'identità fornita dall'agente principale: senza `.git` o un manifest confrontato con quel commit non posso certificare da questa copia che ogni file appartenga al commit. Nessun test o preflight è stato eseguito da questa revisione: l'incarico è in sola lettura.

## Gap concreto della CI del candidato

La nuova suite `backend/tests/security/rental-payment-lifecycle-db.test.ts:11-20` richiede **RUN_TENANT_ISOLATION_TESTS=1**, **NODE_ENV=test** e **DOTENV_CONFIG_PATH=/dev/null**, oltre a DB loopback chiamato fleetum_ci/fleetum_rehearsal. Il guard viene invocato nel before prima di `prisma.$connect()` (`:153-157`), senza skip condizionale. La semantica del guard è **assertion failure (FAIL), non SKIP**, prima della scrittura. Questa è una proprietà certa del codice; nessun esito di esecuzione CI hosted è stato osservato in questa revisione.

Il job hosted `tenant-isolation` in `ci.yml:162-173` definisce NODE_ENV=test e il DB localhost/fleetum_ci, ma **non definisce RUN_TENANT_ISOLATION_TESTS o DOTENV_CONFIG_PATH**. Il suo comando `npm run test:tenant-isolation -w backend` (`:200-201`) espande lo script `backend/package.json:24`, che assegna soltanto NODE_ENV=test e include tutte le suite tests/security/*.test.ts. Non vi è altra definizione dei due flag nel file workflow. Pertanto la configurazione CI controllata qui non è pronta per il guard della suite nuova: ci si deve attendere un fallimento hosted, salvo ambiente esterno inatteso. Non è stato eseguito un test hosted, quindi questa è una previsione deterministica basata sulla configurazione e sulle assert, non un esito CI osservato.

`ops/verify-database.sh:64-66` imposta RUN_TENANT_ISOLATION_TESTS=1 e NODE_ENV=test, ma **non DOTENV_CONFIG_PATH=/dev/null**. Una prova locale che lo abbia esportato nel processo chiamante può riuscire e non dimostra che il preflight nudo o la CI hosted lo forniscano. Il comando preflight (`ops/preflight-release.sh:8-11`) non assegna questi flag aggiuntivi. Questo gap deve essere risolto con una futura modifica autorizzata minima ai runner/test gate, senza rimuovere i controlli o usare un DB reale. In questa preparazione non viene modificato alcun file applicativo/config/test.

## Ordine implementato e traccia della release

1. **CI hosted.** `ci.yml:7-11` si attiva su push a `main` o PR verso `main`; non ha `workflow_dispatch` e non attiva push su `codex/*`/`develop`. Jobs: secret-scan, SAST, verify, migration-compatibility; tenant-isolation e lighthouse dipendono da verify (`:141-145`, `:203-227`, `:229-233`). La CI comprende operations tests (`:135-139`), DB PostgreSQL isolato, reconcile, dual-write triggers, HTTP tenant isolation (`:147-201`) e compatibilità precedente release/migrated schema.
2. **Deploy Staging manuale.** `deploy-staging.yml:3-12` richiede ref e confirm; solo `confirm == DEPLOY_STAGING` avvia il job (`:21`). Il ref è risolto una sola volta a SHA hex completo di 40 caratteri (`:39-49`). Il controllo CI cerca una qualunque run `ci.yml` completed, success, SHA uguale, evento push/PR e head_repository uguale alla repo (`:51-84`); non richiede E2E, branch specifico, run più recente o prova fresca. La CI di PR usa checkout default (`ci.yml:80-82`): prima di considerarla prova per un candidato, verificare read-only SHA effettivamente testato/merge ref e artefatti della run. Il controllo staging confronta il metadato head_sha della run, non una attestazione del checkout eseguito nei singoli job CI.
3. **Build e pubblicazione immagini.** build-images dipende da resolve-release (`:86-109`), verifica checkout identico (`:120-131`), esegue build/push backend e frontend (`:133-158`), con URL staging e `NEXT_PUBLIC_SITE_INDEXABLE=false`. Le referenze distribuite sono `ghcr.io/silviomasuccio6/fleetum-backend@sha256:<64hex>` e frontend equivalente; digest con regex validata (`:160-176`). Job summary registra SHA, CI run, tag e digest (`:178-196`).
4. **Deploy.** dipende dai due job e usa GitHub environment `staging` (`:198-206`). Solo questo job ha environment staging: eventuali protection rules non sono provate dal file e non proteggono il precedente push di immagini GHCR. Checkout e manifest identici al SHA risolto (`:209-224`), upload in `.deploy-staging/<SHA>` (`:268-283`), login remoto GHCR, lock flock, promozione manifest, pull digest, `prisma migrate deploy`, `up -d --no-build` (`:285-311`). Il comando chiamato “Verify remote deploy target” crea directory (`:265-266`): non è read-only.
5. **Health.** retry 12 volte `/api/ready`, poi homepage contenente Fleetum e health platform (`:313-327`). Prove minime di disponibilità, senza controllo del SHA/digest che risponde. Il lock remoto termina dopo `up`, prima dei probe; concurrency GH staging non include E2E Nightly o comandi di recovery esterni.
6. **E2E.** runbook `staging.md:91` richiede avvio manuale successivo; `e2e-nightly.yml:3-13` è manuale/schedule 02:17 UTC, senza `workflow_run`, `needs` staging o input release SHA. Checkout è default (`:33-34`); job non usa environment staging. Impostare esplicitamente ref di esecuzione candidato quando futuro dispatch sarà autorizzato e correlare SHA test suite + release distribuita + digest + run ID. Senza correlazione, report verde potrebbe esercitare una release diversa dal checkout dei test.
7. **Recovery/rollback.** `staging.md:56-81` richiede snapshot, compatibilità precedente app, piano rollback e restore DB separatamente approvato. I comandi recovery sono una sequenza pull/migrate/up per immagini esplicite, non una procedura automatica di ritorno alla release precedente. Nessun backup né handler rollback è presente nel deploy staging. Registrare preventivamente le immagini/manifests della precedente release, compatibilità e snapshot ID; un down-migration/restore non è autorizzato da questo pacchetto.

## Requisiti già presenti nei file e prove ancora assenti

| Requisito | Stato statico | Evidenza da ottenere successivamente senza mutare |
| --- | --- | --- |
| SHA candidato | Fornito; copia non Git | Confronto manifest dei file con commit/archivio del candidato |
| CI sullo stesso SHA | Gate deploy implementato; runner CI nuovo DB test incompleto | Run ID/URL, evento, head repo, SHA effettivamente testato, tutti job obbligatori verdi |
| Immagini digest | Gate e formato implementati | Due digest reali e summary build, più manifest runtime della precedente release |
| Staging credentials | Nomi previsti | Presenza/scoping/permessi senza stampare valori: HOST, USER, SSH_KEY; env staging e variabili path |
| Separazione DB/upload | Compose dedicato | Conferma redatta DB effettivo, mount, proprietà directory, spazio/backup, assenza dati/segreti production |
| Host/DNS/TLS/reverse proxy | Tre host configurati; porte dedicate | Controllo read-only routing/porte/DNS/TLS/provider e isolamento da production |
| Auth e due tenant | Suite usa login API/UI reale, CSRF | Identità sintetiche di due tenantId distinti, licenze/feature necessarie e credenziali complete fuori pacchetto |
| Provider sandbox | Prescritto in runbook; nessuna garanzia runtime | Account/key Stripe test; webhook test; sandbox Resend/destinatari/egress; isolamento storage, OTP/reset/alert/demo |
| Snapshot/preflight | Documentato | Snapshot/dump ID, risultati preflight redatti, durata/locks migration, rollback compatibilità |
| E2E authenticated | Workflow e gate report presenti | Correlazione esatta candidato/deploy/test run; report, traces, flow/case results |
| Rollback staging | Richiesto/documentazione minima | Runbook concreto per precedente digest/manifests e lock, recovery separatamente autorizzata |

## Rischi di trigger e condizioni prima delle mutazioni

- **Un push/merge main può attivare production.** `deploy-production.yml:10-27` avvia il flusso su completamento riuscito della CI push/main della stessa repo. Il suggerimento `codex → develop → staging → main` di `github-branch-protection.md:87-90` non coincide con i trigger CI reali; un push develop da solo non produce CI accettata dallo staging. Nessun main push/merge va incluso come semplice mezzo per procurare una CI staging. Una futura PR verso main potrebbe produrre CI senza merge, ma richiede nuova autorizzazione esterna e verifica dell'identità testata.
- **Tag SHA condivisi con production.** staging `:130-131` e production `:214-215` usano gli stessi nomi GHCR/tag full-SHA. Il frontend è costruito con build args diversi (`staging:149-157` vs `production:235-244`): lo stesso SHA può avere diversi digest secondo l'ambiente/build. Lo SHA/tag da solo non certifica la variante staging; conservare il digest restituito dalla specifica build e non usare tag per il rollback. I container già distribuiti per digest non vengono ridefiniti dal solo aggiornamento del tag.
- **Variabili immagini compose.** `docker-compose.staging.yml:21,42` richiede stringhe valorizzate ma il compose non valida la sintassi digest; la validazione esiste nel workflow. I test `ops/tests/staging-release.test.mjs:55-59` controllano assenza fallback e presenza variabili, non rifiuto di ogni stringa/tag arbitrario. Recovery deve usare le referenze digest registrate.
- **Host SSH e path.** workflow valida pattern hostname/IPv4, user e path (`:234-237`, `:257-264`, `:299-304`), non verifica che l'host appartenga solo a staging. Acquisisce host key tramite `ssh-keyscan` durante la run (`:246`); fingerprint atteso non è ancorato nel sorgente. Gli absolute path ammettono segmenti `..` e le variabili APP_DIR non spostano i mount fissi `/opt/fleetum-staging/*` di compose. Verificare redattamente i path canonici e l'identità del server prima di una futura esecuzione.
- **Se condivide VPS:** compose pubblica `8080:80` e `8443:443` su interfacce host predefinite (`:49-51`), mentre health pubblica usa HTTPS standard. Serve reverse proxy/port mapping corretto; non è creato né provato dal workflow. PostgreSQL non pubblica porte host e usa rete bridge dedicata, backend solo expose 4000/4100 (`compose:17-18,35-39,59-61`). Docker/Caddy/rsync/flock/SSH, Compose con env_file format raw e permessi sulle directory devono esistere sul target. I probe pubblici potrebbero colpire un altro stack se routing errato.

## Confini auth/hostname e provider

- Validator E2E richiede sei impostazioni complete, HTTPS, nessuna credenziale nel URL, `/api` e due email distinte (`validate-config.mjs:4-11,20-30,49-56`). È una denylist di soli `fleetum.it`, `www.fleetum.it`, `api.fleetum.it` (`:13`), non un'allowlist staging: hostname HTTPS arbitrari e `platform.fleetum.it` non sono bloccati. Non verifica DNS/IP, redirect, backend degli URL, identità synthetic o tenantId diversi. Nel pacchetto usare i due host espliciti e pretendere evidenza server/tenant prima di E2E. HTTPS e email diverse da soli non provano isolamento.
- I test usano `/auth/login`, restituzione CSRF e cookie reali (`helpers/auth.ts:26-45`) e creano dati sintetici attraverso API business; non bypassano auth. Account diversi possono comunque appartenere allo stesso tenant: verificare due tenantId. Il gate richiede sei casi su quattro flussi, no skip, no failure e JSON valido (`verify-report.mjs:6-13,75-102`). La suite contiene anche 05 vehicle pagination; i sei casi obbligatori non la nominano. Non copre automaticamente login platform/OTP, OAuth, Stripe, reminder/report/extra email acceptance o autorizzazioni provider.
- `app.ts:105-125` applica CORS e rate limit, ma CORS non è un firewall: richieste senza Origin vengono ammesse dal livello CORS; l'isolamento continua a dipendere dai middleware auth/tenant esistenti. Login API dei test conserva tale percorso. Platform ha listener separato, CORS separato e allowlist/trusted-device (`app.ts:156-174`, `platform-ip-allowlist.ts:14-20,59-96`). Esempio staging sceglie mode optional; health/login/recovery sono path pubblici di allowlist, mentre auth dei dati è un controllo ulteriore. Nessun indebolimento dei guard è richiesto per pacchetto staging.
- `backend.env.staging.example` è solo template: placeholder JWT/hash non costituiscono configurazione funzionante (`env.ts:63-76`), DB/account devono essere dedicati, secrets fuori Git. `EMAIL_PROVIDER=resend` è obbligatorio (`env.ts:79-80`), il sender crea Resend e invia ai recipient ricevuti senza dry-run o sandbox hostname/allowlist (`email-sender.ts:23,35-55`). L'esempio sender/recipient/alert usa indirizzi del dominio Fleetum, non prova sandbox (`example:21,31,65-68`). Ogni test OTP/reset/demo/extra/reminder/report richiede un sink o destinatari test garantiti prima dell'attivazione.
- Il CMD dell'immagine esegue `server.ts` (`backend/Dockerfile.prod:42`), che avvia reminder, queue, reports, privacy e dunning (`server.ts:30-34`). Queue ogni 5 minuti, reminder default 10 minuti, report ogni minuto, dunning abilitato default al minuto 15 di ogni ora (`email-queue-cron.ts:5-8`, `env.ts:198,216-217`, `reports-cron.ts:443-456`). Privacy è disabilitata nell'example. Non esiste qui un toggle globale staging che spenga i cron email/reminder/reports: un deploy può produrre eventi/provider prima dell'E2E. Queue distingue SCHEDULED_REPORT/REMINDER_EMAIL/RENTAL_EXTRA_CHARGE_NOTICE e preserva receipt/idempotency, ma ciò non sostituisce sandbox (`email-queue-service.ts:197-226`).
- Stripe usa qualsiasi chiave valorizzata per creare il client (`billing-service.ts:225-227`); `sk_test_` nell'example è una prescrizione, non una validazione runtime staging. Verificare account/key/webhook/price test senza esporre valori. Storage example local e upload dedicati; un eventuale S3 richiede bucket/account staging, non garantito dal solo env.ts.
- L'isolamento della precedente rehearsal locale non è prova dello staging: `ops/e2e/local-api.mts:1-44` usa NODE_ENV test, DB loopback dedicato, blocco HTTP esterno e sender simulato, e importa createApp anziché server. Docker staging segue CMD production e provider reali.
- **Indicizzazione staging non garantita.** Workflow imposta NEXT_PUBLIC_SITE_INDEXABLE=false per website, ma Caddy staging serve `/srv/fleetum` e non `/srv/fleetum-website` (`Caddyfile.staging:23-27` vs `frontend/Dockerfile.prod:39-40`). Frontend robots ha `Allow: /` e sitemap production (`frontend/public/robots.txt:1-14`), e frontend prerender separa una spa.html noindex dalle pagine pubbliche indicizzabili (`prerender-public-pages.mjs:11-29,37-38`; `verify-prerendered-pages.mjs:24-44`). Il runbook richiede staging non indicizzabile (`staging.md:97`) ma il file Caddy letto non applica blocco robots/X-Robots-Tag. Verificare questa discrepanza prima di un'eventuale esposizione, senza cambiarla nell'incarico attuale.

## Passi read-only da completare prima di qualunque futura mutazione

1. Registrare il gap runner CI descritto sopra e la futura correzione minima proposta, senza disabilitare i guard; non chiamare questo candidato pronto per CI/staging. Ricevere/confrontare manifest candidato con commit `459ceed2f7b9a2ee1d2756d326c94dd23acde2e3`; usare gli hash sotto per congelare le evidenze del pacchetto. Verificare assenza dati/segreti nel contenuto senza copiare env reali.
2. Quando letture remote saranno autorizzate, acquisire CI run metadata/checkouts e stato branch/ruleset; verificare esplicitamente che nessuna proposta comporti main update/auto production. Ora nessuna richiesta GitHub è stata eseguita.
3. Acquisire un inventario redatto dell'infrastruttura staging: host fingerprint, routing/IP/porte/proxy, versioni Docker/Compose/Caddy, path canonici/permessi/spazio, DB/upload separati, nessun production data/credential. Nessun SSH/curl/provider check è stato eseguito qui.
4. Acquisire evidenze redatte sandbox: destinatari email/sink, policy egress, Stripe test account/webhook/prices, storage locale o bucket dedicato, crons e tenant settings synthetic. Distinguere test con provider simulato da prova provider sandbox.
5. Preparare campi ancora vuoti da compilare nella futura esecuzione: CI run ID, deploy run ID, backend/frontend digest, manifest checksum, previous release digests/manifests, snapshot ID, rollback responsabile/procedura, E2E run ID + checkout SHA + deployed identity.
6. Verificare configurazione test senza invocare endpoint: sei impostazioni complete, host esatti staging, due tenantId distinti e feature/licenze, test suite del candidato. Le credenziali devono rimanere fuori dagli artefatti locali condivisi.
7. Separare l'autorizzazione successiva di push/PR/dispatch/deploy e dell'eventuale snapshot/migration/provider/E2E/recovery. Il presente rapporto non autorizza né esegue quelle azioni.

## Hash SHA-256 dei file citati/analizzati

I file applicativi/config/test non sono stati editati. Hash calcolati sul contenuto corrente; per alcuni file sono state lette solo le porzioni citate o risultati di ricerca. `e2e.yml` non esiste; workflow effettivo `e2e-nightly.yml`. `docs/codexrules/workflow/master` è stato risolto ai tre file `docs/codex/` elencati.

| File relativo alla copia | SHA-256 |
| --- | --- |
| `docs/codex/codex-rules.md` | `eda866686a65e0c766660df16dab5b3ace02a3a04f45a159a3909ce10b2cb9c2` |
| `docs/codex/verification-workflow.md` | `927e916958df5127ee4f7a59b5142bbbcba04fda81bfb9ee6cdddb157cda2c6b` |
| `docs/codex/FLEETUM_CODEX_MASTER_PROMPT.md` | `757ed8bb4b178ac9b0d4dd419c2ef3fef645b278cacb9010608ea45dab35c66a` |
| `.github/workflows/deploy-staging.yml` | `48264f14a331a5838985c2030b9773515b6e93c91d39e557f35790e14e1fb11c` |
| `.github/workflows/ci.yml` | `2c657064dd8c8536f7b63cab35736af1813ef6feeb6c011cd24827849993b8fd` |
| `.github/workflows/e2e-nightly.yml` | `acd9b8d10bac88c5ff1b77081547faaf89e8a48ec9a38bf72e69cdf2a1040b51` |
| `.github/workflows/deploy-production.yml` | `be3bc67d308417e4c95ecb8393f34d44a4b92386f124a00d80a10890dab18e3a` |
| `docker-compose.staging.yml` | `8a16d42bb76e0a92fe67abdd8874edd42cb3ab92175cd0de8d3b1e176f612e62` |
| `docs/deployment/staging.md` | `64ef1fbaeed3a77cdd2b699385f9238bb4211a20b395e72dcb39fffc7fa52891` |
| `ops/preflight-release.sh` | `35a856bd859d80d2f67d8f369ed8853dbad456a291ca63fbcdec8e28cea6b3eb` |
| `ops/tests/staging-release.test.mjs` | `c74143919d830061c448bde67eac356ac567149ee152574eb66880ff709d304a` |
| `deploy/caddy/Caddyfile.staging` | `090520e1df53fbaa21d19e40014d819a9194b3af5ce1bf96505d9aeba59552dd` |
| `deploy/caddy/Caddyfile` | `8e18d01be1f02bbc2294380ae4c163c6de8f659a2488ead5bf88ffff825e1996` |
| `deploy/env/backend.env.staging.example` | `cfdddc11a97d4fa64df29df0eba67e2b236e4813658b68947571b2699d410fed` |
| `package.json` | `ddada20b6ee4ea406780485f5c5d1885fd27272c7416b3c97e74986255c7468c` |
| `backend/Dockerfile.prod` | `d43d58df06ec9f831a8d32c08989bae045a5bdabdbead787e1cbed6ffbc580bb` |
| `frontend/Dockerfile.prod` | `5863b606ff9ec58fc232cb97066585cbc9506cb3e224a6085a92dcc5d11733d5` |
| `playwright.config.ts` | `e47a3c716862e6ecd5ba59a538624ae82d60ab5756875557db0b43b9803419c4` |
| `ops/e2e/validate-config.mjs` | `6d3ffeee28ed40a9b261169befb3a531370f84e2e4927dd200a76113614fa373` |
| `ops/e2e/verify-report.mjs` | `fe18bcde0982ce290d1c879644ae13b522145a15da0fe37e832dd8eae091dd9c` |
| `ops/e2e/local-api.mts` | `1f60656b5aee76e8d79adc89701b2455455bc5e0bc9e2617d7596a6f83288cf9` |
| `ops/tests/e2e-gates.test.mjs` | `bfa192079e360d40a3ddd953004df6ba30fbddf948523fe2223c91c15f90b474` |
| `ops/verify-database.sh` | `cd9ecd6e85f0233c140ba0332c11d2f6b460726e2106ee3ba07f1e758d84e10a` |
| `docs/deployment/github-branch-protection.md` | `34fe9ceedb1f6e169c64c116c27aaab9c81afbaf4753fb9aa25366a800f3e1a9` |
| `.github/workflows/seed-demo-tenant.yml` | `58de741740971d4c2e56f285f557aeb1fe219fb89e16bb575675bbf2b7f51c41` |
| `.github/workflows/backup-restore-test.yml` | `0456565b2225dbb8911fea9c23683b2d4e6addc86dac50b456180eec7a3602e1` |
| `backend/src/shared/config/env.ts` | `8d3e0e85a372278775bc840dac16db6918df18f9a0a85a7e570133e7bd0334f3` |
| `backend/src/server.ts` | `77de5f445e73ea2cb9edfa6480e98f13a66ed0f23c965ce1c2b9201e7fc707aa` |
| `backend/src/app.ts` | `800ea6cce9bbacf4dfec5848082cfed658b5aa22ec717ca72a2137a25422896a` |
| `backend/src/interfaces/http/middlewares/platform-ip-allowlist.ts` | `099bf7874f8aec172ac576ac78530e2c23d18a17065fd93af770bd5e927e431e` |
| `backend/src/infrastructure/cron/email-queue-cron.ts` | `b23f512b9e77c20d59dff742482788b26474a8dd2dd4faf17a403cda9d5d4534` |
| `backend/src/infrastructure/cron/reminder-cron.ts` | `679184bc53c6bbbb44ce1764916409777c4b6a82f26658a8927269077e15c845` |
| `backend/src/infrastructure/cron/reports-cron.ts` | `09d8ae740fb4b9e434b8cb4263e94fe91042b4107ed90f7e24813f4a5e1470c0` |
| `backend/src/infrastructure/cron/billing-dunning-cron.ts` | `405a22a4eb207e5e984645c073a299a858fb53e53825f17a7fd63ce23478d48d` |
| `backend/src/infrastructure/cron/privacy-retention-cron.ts` | `184db8f8bf942e13556b19ca5d515d745bac1341d015fc4fd1118c438c4fccbd` |
| `backend/src/infrastructure/email/email-sender.ts` | `2a7a416cb18006652083e6bc929f43ec4d0aa69dea327b05ef16668761987bd5` |
| `backend/src/infrastructure/email/email-queue-service.ts` | `8c5546f4507050931502219fbb53b84c6a91d4143984ec876653d5247a82b6d8` |
| `backend/src/infrastructure/email/scheduled-report-dispatch.ts` | `f5935ec7022950773d47ff93dea68e6d81156a9d127696e0714be1820149a7f1` |
| `backend/src/infrastructure/email/reminder-email-dispatch.ts` | `bf738badbd561ca0542d0a811253583652fb0924dd2a4b49a9c5a79970bcc5a3` |
| `backend/src/application/services/billing-service.ts` | `e4011ec6fcbaf49e4e269cc7420b43e5bfc471e5235ba7a35dbecabe1a5f5a15` |
| `tests/e2e/helpers/env.ts` | `1ab8ece5087d71bbbff8d1111112f996a52583582191e432d378fd34a68affa2` |
| `tests/e2e/helpers/auth.ts` | `ef9a4b301dd95db1d24aa5af7ce4cac87a437ccf32ddb37ee9fc4b732f4b0518` |
| `tests/e2e/helpers/demo-data.ts` | `2fa716ff347f8a4be19444eb439a4406a728352487e51ca2e78e32f06c81c2e7` |
| `tests/e2e/01-login.spec.ts` | `1c4fb6c2a1239b6bea0fe4cb066b0890b92e17f92e02ea159c288210853a8346` |
| `tests/e2e/02-booking-contract.spec.ts` | `1d889c6ce0dfb901aa47c191029a8dc0c54357052e8c0d5ad9bc841dc347f87c` |
| `tests/e2e/03-vehicle-report.spec.ts` | `84b94b266c321866f030e0dd9811beb5300f8ef0581b76756eea7eb5b06b5166` |
| `tests/e2e/04-tenant-isolation.spec.ts` | `ebd515d433ac16a78ae987ca811f866e08711edd8033c0ba776477978de4e58a` |
| `tests/e2e/05-vehicle-pagination.spec.ts` | `c982e95c29abf66ce2134088ff62f1ee3d417f1b245b3ce49b00910b9d5f4fe4` |
| `frontend/package.json` | `d39ca205610e3948ae203f9e2eb7c8dc24d643dd3cc629b9074ac2f75c9e1997` |
| `frontend/public/robots.txt` | `ce5b673930ea919f798d2ff3a07cc2759b082a1f2b091fff2aec09e1476a83bc` |
| `frontend/scripts/prerender-public-pages.mjs` | `7f6dac8cc849f64920740f78f26a83d7561dce79447dea4309b0a93da7ba167e` |
| `frontend/scripts/verify-prerendered-pages.mjs` | `fa294490c6a87cb1f8d29a624a9b6a6fda1a23d9499547268f540d18f59a7beb` |
| `website/lib/site-data.ts` | `4817e44191fe783267500218cb69d826d256de9fec6a22c7eccb70d6fa56f3d1` |
| `backend/package.json` | `e16cfa7ea6c72e8c704b70a422ddffa7e99e78e4aafabd945de0858d3955d045` |
| `backend/tests/security/rental-payment-lifecycle-db.test.ts` | `b4ac63bd93514cd58b1179d114bcdc62b80f7ed18e269f11104d70501bdb93f1` |
| `backend/tests/security/tenant-isolation-http.test.ts` | `3f7342f0c65965f53190f3e64a99f258013242bc10be71789af22b4010f38f69` |
| `ops/verify-migration-compatibility.sh` | `159e234287a65526be7e5cd36918cfc4983f146fac66e9f25b8bf9bea41044a5` |

Memoria consultata solo per orientare la scelta delle regole; le conclusioni tecniche sopra sono basate sui file attuali. Nessuna conclusione sullo stato reale produzione deriva da ricordi o da un vecchio deploy.


## Aggiornamento locale denaro/storage — 5 ottobre 2026

Candidato `9bd57ff2f935a3a56205f381b41d35bfc982dd9a`; dettagli nel [runbook](../money-storage-compatibility-20261005.md) e currentLocalEvidence. Chiusi i gap della precedente fixture limitata a4campi/root relativa:35campi/13tabelle/206coppie in4fasi,8layout,30recovery/57HTTP,522PG. Provider/PDF/inventario backend modificati, frontend e workflowproduction invariati. Zero gate esterni PASS. Review storiche sopra restano datate; nuova prova non conferma host/CI/provider live né fallback moderno.
