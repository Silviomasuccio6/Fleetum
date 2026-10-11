# Fleetum — CI ed E2E legati alla release, 2 ottobre 2026

Branch locale `codex/fix-ci-e2e-release-binding`, base
`e7289ee4ab5b3bd15c32ae5ad9457c2bfabc3dda`. Il commit finale e le prove sono
registrati nel rapporto esterno `Fleetum-audit-20260909/CI_E2E_20261002.md`.
Nessun push, PR, merge, deploy, provider o nuova migrazione in questa tranche.

## Correzioni

La CI assegna esplicitamente RUN_TENANT_ISOLATION_TESTS=1 e DOTENV_CONFIG_PATH=/dev/null
al job PostgreSQL; il runner locale disabilita dotenv senza dipendere dal chiamante.
Non viene rimossa alcuna guardia della suite lifecycle. Database sempre temporaneo,
loopback, sintetico e rimosso automaticamente dal runner.

Tutti i sei job CI e il nuovo job finale verificano checkout==CI_SOURCE_SHA prima
di usare il codice. PR usa il commit head esplicito; push/manuale usa github.sha.
Il percorso manuale richiede il precedente SHA completo approvato per la prova
migrations. Per PR il branch deve includere il baseline affinché la verifica di
compatibilità possa dimostrarne l'ascendenza; non si indebolisce tale controllo.

Il job finale, dipendente da tutti i sei job riusciti, pubblica
`ci-source-proof-<runId>/ci-source.json`, con repository, run, evento, source/checkout
SHA e risultati dei job. Lo staging richiede questo artefatto dalla stessa run
riuscita selezionata e ne verifica l'identità. CI storiche senza artefatto devono
essere rieseguite sul candidato aggiornato. Gli artefatti scaduti fanno fallire
il gate; non vengono sostituiti da un semplice metadato head_sha.

Il trigger Deploy Production rimane byte-identico: la CI manuale non soddisfa
il requisito di evento push/main per l'avvio automatico. Nessun merge main è
necessario per la futura prova CI manuale, una volta disponibile il workflow.
La prima disponibilità dei workflow e le protection rules GitHub sono un gate
hosted ancora da verificare; questo lavoro non pubblica workflow o configura account.

Solo dopo health staging riuscita viene pubblicato `staging-release-proof-<runId>`,
contenente release SHA, CI/deploy run ID e immagini backend/frontend complete per
digest. Il metadato head_sha del dispatch può essere diverso dal candidato scelto:
l'identità distribuita deriva da questo artefatto e dagli output immutabili build.

E2E richiede releaseSha e stagingRunId espliciti. Gli scheduled run devono avere
le variabili E2E_RELEASE_SHA/E2E_STAGING_RUN_ID: in assenza falliscono prima checkout.
Convalida run Deploy Staging/repo/esito, artefatto unico non scaduto, checkout SHA
e immagini immutabili. E2E e deploy condividono concurrency fleetum-staging.

Prima e dopo la suite, un comando SSH in sola lettura osserva i due container
staging per immagine, ID, running, StartedAt e RestartCount. Sono richiesti SSH key
e **FLEETUM_STAGING_KNOWN_HOSTS** protetti; niente ssh-keyscan, config SSH ambientale,
env remoto o mutazione remota. File chiave temporanei0600 e cleanup; il processo
SSH riceve solo PATH/LC_ALL. Snapshot salvate prive di credenziali.

Il gate report richiede esattamente i sette casi registrati, incluso contatore/
paginazione, ciascuno una sola volta e al primo tentativo. Rifiuta extra/duplicati,
skip, flaky/retry, errori runner e casi mancanti. Una futura estensione della suite
richiede aggiornare il contratto dei casi obbligatori. Non cambiano le suite né le
asserzioni API/UI. Gli artefatti report includono run_attempt; proof CI/deploy
usano overwrite controllato per permettere rerun della stessa esecuzione.

## Verifiche e limiti

Test RED prima dei fix: ambiente CI/checkout/manual/proof mancanti e report con
seisoli casi o retry accettato. GREEN locale: helper CI, workflow contract, report,
metadata/proof, runtime/restart e SSH simulato. Il test SSH usa un callback locale:
nessun SSH o provider reale viene contattato. YAML e script incorporati verificati
localmente; comandi/conteggi/esiti sono nel rapporto e nelle evidenze congelate.

Il runner PostgreSQL è provato con ambiente pulito e senza DOTENV/RUN_TENANT/
DATABASE_URL del chiamante. Release completa verificata una volta sul freeze.
Nessun nuovo browser hosted o locale dichiarato: la UI/backend restano invariati;
il report precedente7/7 viene ricontrollato dal nuovo gate. Non sostituisce una
nuova esecuzione del workflow completo o dei provider.

Gli artefatti non sono firme indipendenti: il reviewer deve verificare run/repo/
workflow e accessi. Snapshot prima/dopo non rilevano ogni evento transitorio o
deploy fuori workflow. Identità Docker **non prova** che HTTPS pubblico/API raggiunga
quei container. Routing, DNS/proxy e destinatari/dati effettivi restano gate distinti.

Email/cron, allowlist host/tenant, noindex, backup/restore, carico e decisioni
legacy/privacy restano aperti. Nessuna presenza/configurazione di segreti o regole
staging è stata controllata. Il nuovo known_hosts deve essere predisposto e
verificato da un responsabile prima dell'esecuzione esterna, senza condividere valori.

## Rollback e prossima azione

Nessuna migrazione, dependency, modifica app o provider. Revert della tranche
ripristina i workflow/runner precedenti e reintroduce i gap dei gate: richiede
review prima di un successivo uso. Nessun down SQL, replay email o pagamento.

Prossima tranche locale: contenimento staging email/cron, allowlist target e
noindex. Prima di push/dispatch occorrono review umana, disponibilità del workflow,
segreti protetti e gate isolamento/restore del pacchetto aggiornato. Produzione
rimane non autorizzata; nessun modello o nuova UI è integrato.
