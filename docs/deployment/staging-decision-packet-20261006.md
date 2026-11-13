# Fleetum — scheda di decisione per lo staging

Preparata il **6 ottobre 2026**. **Pronta per revisione; non autorizza operazioni esterne.**

Il candidato sorgente congelato indicato dal coordinatore è `add3438cc17e23a29a45aad71282e296f45072a1`, branch `codex/fix-invite-activation-security-20261006`, parent documentale `e3186ac`. **Freeze finale verificato: PostgreSQL540/540 e release624/624, zero errori/skip; revisione statica indipendente senza blocker.** Il confronto main resta `db1f231dc8cb699f1a5ce4215a0278c93212d16d`, dichiarato invariato dal coordinatore; non è una prova della versione attualmente in produzione. Tree congelato `c213e764e6e52ebe34a9bdd3e3566010916d0905`; ricevuta finale in `evidence/20261006-account-security-review/code-commit.json`.

**Gate esterni: 0/19 PASS.** Non sono presenti autorizzazioni per push/PR, CI ospitata, dispatch staging, SSH, provider, merge o deploy. Il contributo di preparazione del packet è documentale; le prove runtime locali sono svolte e attestate separatamente dal coordinatore. Nessun env reale, credenziale o dato personale applicativo usato. Le regole sono state lette in `docs/codex/codex-rules.md`, `FLEETUM_CODEX_MASTER_PROMPT.md` e `README.md` nella copia di esecuzione.

## Decisione concreta da preparare

Preparare una prova esterna dello **stesso candidato esatto**, con immagini costruite per il contesto staging tramite i Dockerfile production, configurazione isolata e riserva compatibile. Le persone, gli input e le soglie sotto devono essere definiti prima della prova. La presente scheda non trasforma proposte o ruoli in approvazioni.

| Campo | Valore / stato |
|---|---|
| Candidato sorgente congelato | `add3438cc17e23a29a45aad71282e296f45072a1` — PASS locale, da revisionare |
| Tree candidato / ricevuta finale | `c213e764e6e52ebe34a9bdd3e3566010916d0905` / `evidence/20261006-account-security-review/code-commit.json` |
| Reviewer tecnico / data di firma | `NULL` / `NULL` |
| Responsabile rilascio | `NULL` |
| Responsabile target e isolamento | `NULL` |
| Responsabile DB, upload e recovery | `NULL` |
| Responsabile QA e misure | `NULL` |
| Control SHA approvato / osservato | `NULL` / `NULL` |
| Release SHA approvato | `NULL` |
| CI run ID, URL, checkout SHA e source proof | `NULL` |
| Backend/frontend OCI digest e build run | `NULL` / `NULL` / `NULL` |
| Fallback source SHA, due digest e manifest | `NULL` / `NULL` / `NULL` |
| Dataset, workload e volume approvati | `NULL` |
| Approvatore soglie / istante precedente al run | `NULL` / `NULL` |
| Autorizzazione pubblicazione/CI ospitata | `NULL` |
| Autorizzazione dispatch staging | `NULL` |
| Autorizzazione configurazione sandbox | `NULL` |
| Autorizzazione produzione | `NULL` — decisione successiva separata |

Il registro e il record da compilare rimangono nel [pacchetto staging](/Users/silvio/Documents/Playground/Fleetum-fix-scheduled-report-cursor/docs/deployment/staging-validation-package-20261002/README.md). I campi `NULL` significano **non definito o non attestato**, non esito favorevole.

## Identità e valore delle prove

Il nuovo candidato corregge anche l'attivazione invito e il cambio password e aggiorna proxy-addr a2.0.8. La riserva `9bd57ff2f935a3a56205f381b41d35bfc982dd9a` e il precedente candidato `b5332ca5d9100c82cc4c6ffb5ba4c2f8e86a650c` **non contengono queste nuove correzioni**: non sono un fallback corrente approvato. Non usare main storico, un parent o un tag noto come riserva per supposizione.

Le prove precedenti di recupero restano utili per il metodo: release locale 598, recovery 46 controlli e 153 asserzioni HTTP; 522 PG e sette casi browser erano separatamente ereditati. Non sono nuovi esiti del candidato `add3438c…`, né prove di CI, immagini OCI, staging, provider o produzione. Il recupero locale in 1,3–1,9 secondi e il budget locale di 30 secondi **non determinano** le soglie proposte in questa scheda.

Conservare identità distinte:

1. **Source SHA**: commit esatto checkoutato e testato dalla CI, impiegato nella build e checkout della suite E2E.
2. **Control SHA**: revisione approvata della definizione dei workflow e dei controlli trusted. Il `head_sha` della run Deploy Staging identifica il controllo, non il candidato distribuito.
3. **Coppia immagini**: referenze `ghcr.io/silviomasuccio6/fleetum-backend@sha256:<digest>` e frontend equivalente della specifica build staging; conservare anche i parametri pubblici di build e il manifest di deploy.
4. **Versione osservata**: immagini/container/restart prima e dopo i test, insieme alla prova che gli URL pubblici raggiungano quello stack.
5. **Commit documentale**: distinto dalla ricevuta del codice testato; non sostituire automaticamente il source SHA quando si aggiorna questa scheda.

La relazione richiesta è `ciCheckoutSha = e2eSourceSha = observedReleaseSha = candidateSha`, con i medesimi due digest nei proof di deploy e nelle osservazioni E2E. Control SHA approvato e osservato devono coincidere. Una modifica al codice, ai workflow, alla coppia di immagini o ai parametri invalida i binding interessati e richiede il riesame pertinente.

SHA256 di `dist`/export locali non equivale a digest OCI. Lo stesso tag SHA può essere ricostruito con parametri diversi: il rollback deve usare i digest specifici registrati, non tag mutabili. **Non promuovere bundle compilati sotto NODE_ENV=test o artefatti del drill locale come release.** Costruire le immagini dal source congelato con i Dockerfile production e validare la configurazione staging sotto NODE_ENV=production. Il frontend deve includere sia SPA sia export Next; registrare URL API/Platform/login/marketing e `NEXT_PUBLIC_SITE_INDEXABLE=false` della build.

## Input mancanti prima del primo dispatch

| Input | Evidenza necessaria, senza segreti | Owner / approvazione |
|---|---|---|
| Revisione del candidato e dei controlli | Diff dall'ultima versione approvata, tree e manifest, nuovi test invito/password, rischi residui, SHA completo dei controlli | `NULL` / `NULL` |
| GitHub e trigger | Presenza della CI manuale sul ref autorizzato, protezioni environment/branch, chi può cambiare i pin, scoping e **sola presenza** dei segreti; ricevuta CI con tutti i job richiesti | `NULL` / `NULL` |
| Host staging e trust SSH | Host dedicato/isolato identificato, fingerprint verificata indipendentemente e fissata come trust; presenza HOST/USER/SSH_KEY/KNOWN_HOSTS senza valori; capacità e ownership Docker | `NULL` / `NULL` |
| Percorsi, mount e rete | Percorsi canonici reali senza symlink, nessun contenuto produzione; progetto `fleetum-staging`, backend solo rete privata internal, policy egress e risorse riconosciute; DB/upload/log separati | `NULL` / `NULL` |
| DNS/TLS/proxy | Tre domini canonici e routing effettivo, porte 8080/8443 se applicabili, trust proxy e client IP, certificati e protezioni discovery verificati; niente redirect verso produzione | `NULL` / `NULL` |
| Dataset sintetico | Due tenant ID distinti, identità e provenienza sintetiche attestate; account e credenziali in secret separati, licenze/permessi per i flussi; nessuna PII nel pacchetto | `NULL` / `NULL` |
| Riserva applicativa | Source compatibile che preservi i nuovi fix, coppia immutabile backend/frontend, parametri e manifest, configurazione isolata e prove su schema48. Se non esiste una precedente release distinta accettabile, definire esplicitamente una riserva nuova verificata e il limite della prova | `NULL` / `NULL` |
| Backup e restore | Snapshot/dump sintetico DB con upload registrati della stessa finestra, ID/hash, manifest record→oggetto/checksum e prova restore; limiti spazio, tempo e lock | `NULL` / `NULL` |
| Recovery prima release | Procedura con stesso lock, manutenzione, worker fermi e riapertura condizionata alle prove della coppia; responsabile e finestra concordati | `NULL` / `NULL` |
| Profilo e soglie | Workload e metriche definiti prima, approvatore nominato e timestamp, criteri ACK/RPO, carico e guasti isolati | `NULL` / `NULL` |
| Perimetro esterno | Autorizzazione concreta separata per pubblicazione/CI, poi per staging; sandbox ulteriori solo con progetto e review propri | `NULL` / `NULL` |

I percorsi canonici sono `/opt/fleetum-staging/app`, `/opt/fleetum-staging/env/compose.env`, `/opt/fleetum-staging/deploy.lock` e le directory dedicate DB/upload/log previste dal Compose. Non richiedere o copiare valori di env, chiavi, password, token o dump grezzi nelle evidenze: attestare identità, presenza, metadati e valori pubblici pertinenti.

Il preflight host verifica metadati dei percorsi e ownership Docker; non certifica purezza del dataset, mount non condivisi, firewall, egress o routing HTTPS. Su un target nuovo documentare la preparazione isolata necessaria e la sua autorizzazione, senza inventare osservazioni di container ancora assenti. Le attestazioni preventive precedono il primo avvio; i riscontri dello stack effettivamente avviato vengono ripetuti dopo il deploy.

## Proposta di accettazione — NON APPROVATA

Questi numeri sono una **proposta da riesaminare**, non benchmark, capacità dimostrata, SLA o autorizzazione. Dataset, richieste, mix e metodo di misura restano da definire. Eventuali adeguamenti devono essere firmati prima del run, senza scegliere le soglie dopo aver letto il risultato.

| Misura | Proposta | Definizione richiesta prima del run |
|---|---:|---|
| p95 richieste ordinarie | ≤ 750 ms | Elenco operazioni e confine end-to-end di misura; separare export pesanti con budget propri da definire. Nessuna esclusione retroattiva |
| Errori inattesi | ≤ 1% | Numeratore di errori tecnici/inattesi sul totale delle operazioni positive previste. Nel record maxErrorRate è una frazione:1% corrisponde a0.01. Escludere solo denial intenzionali predefinite e finestra di guasto; 429 fuori dagli scenari intenzionali restano errori inattesi |
| Attesa lock DB | ≤ 2 s | Massima attesa osservata dei lock del workload concordato, campionamento e transazioni inclusi documentati |
| Queue lag | ≤ 60 s, **solo se worker abilitati in perimetro separato approvato** | Età del comando eleggibile più vecchio, non dei record in quarantena. Nella baseline a zero cron non si può dichiarare questo gate superato |
| RTO | ≤ 300 s | Da introduzione controllata del guasto alla verifica conclusa di API, Platform, frontend, identità, dati/file e route pubblica, prima della riapertura |
| RPO | **0 dati ACK e upload registrati persi** | Invarianti record/valori e associazioni metadata→file/checksum sui dati confermati prima del guasto; perimetro di durabilità e tipo di guasto espliciti |
| Carico | 20 utenti virtuali, 10 minuti | Mix sintetico, distribuzione tenant, quantità dati/fan-out, ramp-up/warm-up, pacing, operazioni di lettura/scrittura e cleanup da definire |

Proposta RPO/ACK: un'operazione è confermata soltanto dopo risposta positiva completa e commit duraturo nel perimetro dichiarato; un upload è confermato dopo persistenza del suo contenuto e metadata registrati con checksum. Una richiesta iniziata o un file temporaneo senza ACK non entra nell'insieme confermato. Conservare prima del guasto un registro sintetico di ACK e un manifest DB/upload; dopo il recupero confrontare record, valori e checksum. Per zero perdita in un restore occorre un punto DB+upload coerente che includa tutti gli ACK, oppure una procedura esplicita e testata di recupero degli ACK successivi. Non promettere RPO0 usando soltanto il timestamp dell'ultimo backup.

RPO0 in questa proposta è un obiettivo di prova: un riavvio applicativo, la perdita di un container e la perdita dell'host sono guasti differenti. Dichiarare quali vengono provati e quali restano aperti; il precedente drill locale non certifica crash storage/power-loss o recovery del VPS. Nessun reinvio email o comando economico viene ricreato per inferenza durante il recupero.

Le invarianti di sicurezza non ammettono tolleranza dell'1%: zero accessi/mutazioni cross-tenant, riattivazioni indebite, doppia attivazione/consumo token o successori refresh multipli; atomicità password/reset/revoca. `logoutAllDevices=false` resta distinto da una revoca volontaria totale. Per il gate HTTPS va misurata la revoca alla richiesta protetta successiva secondo il comportamento del codice, senza equiparare questa aspettativa a uno SLA già approvato.

## Ordine di esecuzione futuro

1. **Review e freeze.** Terminare i test del nuovo candidato, confrontare sorgenti/commit, firmare source/tree e control SHA; distinguere test correnti da ereditati. Chiudere il verbale dei rischi e assegnare i responsabili.
2. **Target e isolamento.** Ottenere attestazioni di host, protezioni, dati sintetici, mount/rete/egress, domini e configurazione. Mantenere email disabilitata, zero cron e nessuna credenziale provider. Nessun bypass di auth, CSRF, ruolo/licenza o Platform.
3. **Riserva e budget.** Preparare la coppia fallback che preservi i nuovi fix, manifest e compatibilità schema48; provarla nel perimetro temporaneo sintetico autorizzato. Firmare workload, soglie e procedura recovery prima dell'esecuzione.
4. **CI ospitata, dopo autorizzazione separata.** Pubblicare solo il branch autorizzato ed eseguire la CI sullo SHA esatto; attestare tutti i job e source proof, conteggi e skip. Verificare disponibilità del trigger/ref. Non usare merge o push main per procurare questa CI.
5. **Backup e punto coerente.** Ottenere prova di backup/restore DB+upload sintetici e identificare il punto ACK che verrà protetto. Concordare manutenzione, lock, worker e finestra di scritture.
6. **Dispatch staging, dopo autorizzazione separata.** Usare lo SHA congelato e i pin approvati; registrare CI/build/deploy run, parametri, digest, manifest, risultati migrazione, osservazioni runtime e health. Non trattare questo workflow come preflight read-only.
7. **Routing e verifiche funzionali.** Provare che i tre URL pubblici arrivino alla coppia attestata, verificare cookie/proxy/noindex e poi sette E2E distinti richiesti, tutti al primo tentativo, senza skip/retry/flaky/errori. Ripetere identità runtime prima/dopo. Estendere con browser reali per invito/reset/cambio password/refresh e con accesso Platform; la sola readiness Platform non certifica il login/OTP. La consegna email resta esclusa dalla baseline.
8. **Superficie Next e SPA.** Verificare pagine pubbliche, `/_next/*`, brand/demo/consenso, login e tenant SPA nella variante realmente servita. Risolvere o delimitare formalmente il gap di routing sotto; non chiamare sette E2E autenticati una prova completa del sito pubblico.
9. **Carico e guasto.** Nel perimetro concordato eseguire workload/misure e recovery con soglie già firmate; confrontare dati/file, identità e route, registrare timeline e cleanup. Nessun restore automatico o comando provider compensativo.
10. **Riesame.** Compilare il record con evidenze redatte e hash; chiudere soltanto i gate effettivamente provati. Provider, legacy/privacy, storage effettivo e limiti finanziari restano decisioni proprie. Produzione e marketing richiedono fasi e autorizzazioni successive.

G00/G01/G02/G04/G05 sono prerequisiti del primo dispatch nel registro. G14 è la prova integrata successiva e non sostituisce il recovery prerelease di G04. La prova di fallback non può essere rinviata a dopo un primo deploy che non sia recuperabile.

## Recupero applicativo da rendere operativo

La seguente procedura è una specifica da approvare e provare; **non è un invito a eseguire comandi sul server**.

1. Dichiarare il guasto e registrare l'istante di partenza. Mantenere il traffico in manutenzione prima di cambiare manifest o processi; bloccare nuove scritture business e fermare i worker interessati, lasciando intatti i controlli di sicurezza.
2. Acquisire **lo stesso `flock` su `/opt/fleetum-staging/deploy.lock`** usato dal deploy, con un titolare identificato. Tenere il lock per cambio coppia, avvio, verifiche e riapertura. Nessun recovery concorrente con deploy/E2E o un altro operatore; anche operazioni fuori GitHub devono rispettare il lock.
3. Verificare source, due digest, parametri/manifest e configurazione della riserva, compatibility schema48, fix invito/password e punto DB+upload coerente. Se la riserva non soddisfa i controlli o i prerequisiti non sono attestati, restare in manutenzione e rendere visibile il fallimento.
4. Arrestare la generazione applicativa guasta senza cancellare DB o upload. Applicare come unità la coppia backend/frontend e i manifest approvati; evitare frontend vecchio con API nuova o viceversa. Non eseguire downmigration e non scegliere immagini per tag.
5. Avviare sotto NODE_ENV=production e policy staging; verificare readiness API **e Platform**, origine/digest reali, container/restart/network, frontend/assets e superficie Next prevista. Confrontare gli ACK protetti, metadata/upload/checksum e schema; confermare zero cron/email/provider nella baseline.
6. Verificare la route pubblica verso quella coppia, cookie/CSRF e flussi sintetici concordati. Solo dopo i criteri rispettati riaprire il traffico e chiudere RTO; non abilitare worker nella baseline. Salvare timeline, risultato e identità del responsabile, quindi rilasciare il lock.
7. Se il recupero applicativo fallisce, restare in manutenzione. **Restore DB+upload è una decisione separata**, con owner, autorizzazione, piano e prova di riconciliazione propri; non è una risposta automatica a un health check fallito. Non ricreare pagamenti/email o riaprire code legacy in base a timer o supposizioni.

Il workflow staging corrente acquisisce il lock per promozione manifest/pull/migrazione/up e lo rilascia prima delle osservazioni/probe. La concurrency GitHub coordina staging ed E2E, ma non i comandi di operatori esterni. L'esempio recovery del runbook non contiene `flock`: non va considerato una procedura completa di recupero coordinato.

## Riscontri statici e limiti attendibili

Le linee seguenti sono state lette nella copia `/private/tmp/fleetum-restore-validation-20261005`. Sono prove del contenuto sorgente osservato, non esiti runtime o conferma del suo stato hosted. Devono essere riallineate al freeze finale se il codice cambia.

| Riscontro | Fonte e linee | Implicazione |
|---|---|---|
| Invito monouso solo INVITED e transizione atomica | `backend/src/application/usecases/auth/accept-invite-usecase.ts:11–62` | Il nuovo fallback deve includere queste guardie, lock, consumo e invalidazioni |
| Cambio password con hash fuori lock, CAS e revoca opzionale atomica | `backend/src/application/usecases/auth/manage-profile-usecase.ts:28–80` | Le vecchie riserve prive di questa correzione non preservano lo stato sicurezza corrente |
| CI sul source e guard DB | `.github/workflows/ci.yml:18–20,200–204,346–375`; `ops/ci-release-identity.mjs:10–23` | Vecchi gap CI del 2 ottobre sono storici; oggi i controlli esistono localmente. Manca la ricevuta hosted |
| Pin e controlli separati | `.github/workflows/deploy-staging.yml:40–64`; `ops/staging/control-policy.mjs:4–8` | Control/release approvati devono corrispondere; protezioni reali non attestate |
| Build production e parametri staging | `backend/Dockerfile.prod:16–23,37–42`; `frontend/Dockerfile.prod:6–22,35–41`; `deploy-staging.yml:165–189` | Build/source/config concreti, NODE_ENV=production; nessuna promozione di artefatti test |
| Baseline senza provider e rete privata | `backend/src/shared/config/staging-safety.ts:57–73,101–138`; `docker-compose.staging.yml:31–48,69–76` | Anche le chiavi provider test vengono rifiutate. Contenimento sorgente non equivale a prova infrastrutturale |
| Preflight metadata e mutazioni successive | `ops/staging/target-preflight.sh:14–38`; `deploy-staging.yml:311–313,358–362` | Dopo preflight iniziano creazione directory, login GHCR, migrazione e restart. Snapshot e rollback assenti |
| Health pubblico senza binding della route | `deploy-staging.yml:375–389`; `e2e-nightly.yml:162–165` | Health200 e container digest corretti separatamente non provano quale stack risponde al dominio |
| E2E con binding e continuità | `e2e-nightly.yml:50–119,127–160`; `ops/e2e/staging-release-binding.mjs:46–68,92–128` | Source/proof/run/digest e runtime invariato, ma routing pubblico indipendente |
| Sette casi, zero retry/skip | `ops/e2e/verify-report.mjs:6–14,76–111` | Niente report verdi con casi mancanti, extra/duplicati, flaky o retry; non copre automaticamente tutte le superfici |
| Gap superficie Next | `frontend/Dockerfile.prod:35–41`; `deploy/caddy/Caddyfile.staging:39–50`; confronto `deploy/caddy/Caddyfile:52–78` | L'immagine contiene `/srv/fleetum-website`, ma la route frontend staging osservata serve `/srv/fleetum`. Non certifica le route Next marketing della produzione: serve decisione e prova dedicate senza toccare produzione |
| Recovery manuale e lock | `docs/deployment/staging.md:75–86`; `deploy-staging.yml:361–362` | Esempio manuale privo di lock e verifiche coordinate: la procedura sopra deve essere concretizzata prima dell'uso |
| Trigger produzione | `.github/workflows/deploy-production.yml:10–27` | Push/main seguito da CI verde può avviare produzione: non usarlo per procurare CI/staging |
| Record e budget pendenti | `execution-record.template.json:6–27,235–249`; `validate-package.py:99–139` nel pacchetto staging | Owner, control/release, isolamento, digest e soglie devono essere attestati. Il validator non assegna approvazioni né autentica prove |

Le descrizioni del workflow del 2 ottobre rimangono una fotografia datata: il file corrente ha guard DB, CI source proof, pin trusted, SSH con known_hosts protetto, target canonici, E2E con runtime before/after e target allowlist. Non riaprire quei difetti soltanto perché il documento storico li elenca. Restano assenti le verifiche hosted/live richieste sopra.

**G09/G10/G11:** OAuth, pagamenti sandbox e invii/worker richiedono una configurazione separata revisionata. La baseline attuale rifiuta le credenziali provider e non avvia cron: non allentare tali guardie per rendere verde un test. Reset/inviti con email realmente consegnata, login Platform/OTP, S3 remoto, carico e clone redatto non sono provati dai test locali o dai sette E2E critici. BE-03/SEC-10 e decisioni finanziarie/legacy/privacy mantengono il proprio perimetro.

## Consegna della preparazione

Documento concreto pronto per review. **Nessuna decisione GO, nessun gate esterno chiuso, nessuna richiesta generica di approvazione.** La verifica del nuovo SHA e il verbale integrato sono completati localmente. La prossima azione è compilare responsabili, fallback, target, workload e approvazioni puntuali. Eventuali operazioni esterne saranno oggetto di un perimetro successivo esplicito.
