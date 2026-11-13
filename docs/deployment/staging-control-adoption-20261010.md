# Adozione separata dei controlli staging — proposta locale

Base: `db1f231dc8cb699f1a5ce4215a0278c93212d16d` (`main` verificato il 10 ottobre 2026).
Sorgente dei controlli già collaudati: `21e6282825f0ef1c6a7b50dc6b711936fe40e137`, PR144 in bozza.
Branch: `codex/controlled-staging-adoption-20261010`.

## Problema e comportamento risultante

La CI del branch principale attualmente può avviare `Deploy Production` e pubblicare immagini GHCR prima del job protetto dall'ambiente production. La proposta elimina `workflow_run`: adozione dei controlli, push, PR e completamento CI non avviano questo rilascio. Il solo ingresso è un avvio manuale su `main`, con SHA completo e conferma `RELEASE_FLEETUM_PRODUCTION`.

Il primo job è protetto dall'ambiente production. Prima di emettere lo SHA utilizzabile dai job successivi verifica conferma, SHA del workflow/checkout/release, due pin protetti, HEAD corrente di main, CI push/main sullo stesso SHA e artefatto effettivo con tutti i sei job obbligatori superati. SAST precede la pubblicazione. Ogni immagine usa tag SHA completo e deploy per digest; SSH richiede host key già verificata, senza `ssh-keyscan` durante il rilascio.

**Questa tranche mantiene intenzionalmente chiuso il rilascio applicativo.** La CI della base ha cinque job e non produce `ci-source-proof`: anche una CI verde della proposta non autorizza il deploy dell'app. L'attestazione completa e la compatibilità delle migrazioni restano prerequisiti della successiva integrazione applicativa. Non aggiungere attestazioni fittizie, rimuovere job richiesti o utilizzare la CI di PR144 per attestare uno SHA diverso.

La proposta iniziale comprendeva soltanto i controlli. La correzione successiva delle dipendenze ereditate dalla base è descritta in `docs/security/control-baseline-dependencies-20261010.md`: aggiorna librerie/lock e l'import supportato di StaticRouter, senza integrare il candidato applicativo PR144 o il redesign UI. Schema/migrazioni, Dockerfile, Compose produttivo base e Caddyfile base restano invariati. Nessun file viene installato sul VPS dall'adozione Git.

## Dipendenze comprese nella proposta

| Responsabilità | File e provenienza |
| --- | --- |
| Rilascio esplicito e immutabile | `deploy-production.yml`, nuovo `ops/production-release-policy.mjs`; workflow derivato da PR144 con gate manuale e pin nuovi |
| CI della proposta | `ci.yml`: aggiunto soltanto il test dei controlli; gli altri gate della base restano presenti |
| Registrazione ingress | `staging-ingress.yml`, copiato esattamente da PR144; nessun trigger automatico |
| Attestazione sorgente ingress/release | `ops/ci-release-identity.mjs`: tutti i sei job, repository, run e checkout effettivo |
| Controller ingress | `ops/staging/{control-policy.mjs,ingress-request.mjs,ingress-control.py}`; import della validazione SSH da `ops/e2e/staging-release-binding.mjs` |
| Persistenza | `safe-production-deploy.sh`, `rollback-production.sh`, `shared-staging-ingress-preflight.sh`, `check-production-health.sh`; lock comune, digest precedente, rollback dello stato applicativo, guard prima delle mutazioni |
| Bundle opzionale | `docker-compose.prod.shared.yml`, `Caddyfile.production-shared`, `Caddyfile.staging-ingress`; solo Caddy è collegato alla rete ingress interna |
| Collaudo | test Node dei gate, deploy/rollback simulati, metadata della rete; controller Python con fault/recovery; runner Docker sintetico disponibile ma non eseguito in questa tranche |

I comandi monetari e backup chiamati dagli script sono già presenti nella base; non viene introdotto codice applicativo nuovo. Il validator `staging-release-binding.mjs` viene importato per la sola funzione SSH: non si eseguono le sue ispezioni runtime.

## Configurazioni richieste, ancora da predisporre

1. Ambiente `production` con approvazione obbligatoria **prima del primo job**; verificare reviewer, restrizioni branch, auto-approvazione e bypass amministrativo. YAML da solo non configura queste protezioni.
2. `FLEETUM_PRODUCTION_TRUSTED_WORKFLOW_SHA` e `FLEETUM_PRODUCTION_APPROVED_RELEASE_SHA`: SHA completi della futura revisione main effettivamente approvata. Vuoti o discordanti bloccano il rilascio. Non approvare il commit della sola adozione come release dell'app.
3. Secret `FLEETUM_VPS_KNOWN_HOSTS` con chiave host verificata indipendentemente; nessuna chiave viene raccolta automaticamente da questa proposta. Le altre impostazioni di produzione restano da verificare prima del rilascio.
4. Per ingress, impostazioni distinte elencate nel [runbook ingress](staging-ingress-control-20261010.md): source/workflow pin, digest Caddy live approvato, impronte dei manifest, trust SSH, percorsi canonici. Il pin `FLEETUM_INGRESS_PRODUCTION_CONTROL_SHA` deve essere il **futuro SHA realmente presente su main** dopo l'adozione revisionata, non lo SHA locale della proposta.
5. Il primo `plan` dovrà selezionare il branch candidato che punta ancora esattamente a `21e6282…`; source e workflow ingress pin completi entrambi `21e6282825f0ef1c6a7b50dc6b711936fe40e137`, con artefatto CI38033530996 ancora disponibile. Il workflow registrato sulla sola proposta/main non possiede un'attestazione completa e si fermerà. Verificare SHA, validità dell'artefatto e autorizzazione prima dell'avvio, senza avanzare automaticamente ad apply.

Non sono state modificate impostazioni GitHub, variabili, secrets, DNS OVH o VPS. I workflow storici di altri branch non acquisiscono questi controlli retroattivamente: i reviewer devono rifiutare i vecchi percorsi di rilascio. Restano indipendenti i workflow preesistenti di backup mensile e seed manuale; non sono attivati da questa adozione.

## Sequenza futura e gate

1. Revisionare e pubblicare soltanto questa proposta separata; CI sul suo esatto SHA. Nessuna autorizzazione al merge è implicita.
2. Verificare la protezione dell'ambiente e il diff finale prima dell'eventuale adozione su main. Attendere CI della revisione adottata; il rilascio applicativo deve restare chiuso.
3. Impostare i pin ingress con le revisioni effettive e autorizzare un solo `plan` osservativo. Verificare host reale e risultato, poi revisionare il digest del piano.
4. Solo dopo autorizzazione distinta, `apply` può ricreare Caddy con una breve interruzione del traffico; backend e database non devono essere ricreati. Predisporre staging, immagini, dataset sintetico, DNS/TLS e collaudo applicativo secondo i runbook del candidato PR144.
5. Prima dell'integrazione applicativa, risolvere i conflitti con PR144 **conservando il trigger manuale, i pin, il gate precedente alla pubblicazione e la persistenza ingress**. Verificare la CI completa e la prova sorgente sull'esatto nuovo SHA. Non sostituire il workflow con la vecchia versione automatica del candidato.

Finché questi passaggi non sono verificati, nessun gate operativo esterno è superato. La proposta locale non dimostra staging attivo, nuove immagini disponibili, restore su stack reale, salute della produzione o assenza di regressioni applicative live.

## Impatto e recupero

Nessuna migrazione aggiunta. L'eventuale adozione Git cambia le modalità di avvio dei rilasci, senza restart o trasferimenti. Deployment e rollback futuri includono l'overlay con `FLEETUM_SHARED_STAGING_INGRESS=true`; flag falso con ingress attivo, bundle mancante o rete estranea sono rifiutati prima di stato, backup e migrazione.

Non usare un revert generale come recupero: reintrodurrebbe il deploy automatico e, con ingress attivo, consentirebbe la rimozione del collegamento. Recuperare il gateway soltanto col controller e diario verificati; poi riconciliare flag e pin dopo verifica reale. Per annullare la sola adozione Git, mantenere un workflow di release esplicitamente chiuso e i guard di persistenza finché la rete è attiva. Rollback applicativo resta per digest precedente verificato e non ripristina il database.

## Verifiche e limiti

`node --test --test-concurrency=1 ops/tests/*.test.mjs` esercita il diff con tutte le chiamate server/Docker/provider simulate. `python3 -B ops/staging/tests/ingress_control_test.py` usa soltanto filesystem temporaneo e subprocess sostituiti. Prove, conteggi, ambiente effettivo e revisione finale sono nel report esterno `Fleetum-audit-20260909/STAGING_CONTROL_ADOPTION_20261010.md`.

Risultati della pubblicazione iniziale e della correzione successiva vanno letti nei rispettivi report ed evidenze sullo SHA effettivamente verificato. La CI iniziale PR145 falliva all'audit della base; non trasferire al nuovo commit il risultato precedente o quello storico della PR144. Anche dopo i gate della correzione, la CI completa con sei job e source proof, i reviewer e il server restano prerequisiti dell'adozione operativa. Il collaudo locale non equivale a un dispatch o a un deploy.

Fonti primarie consultate: [workflow_dispatch e selezione del branch](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch), [protezioni degli ambienti](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments). GitHub richiede la presenza del workflow sul branch predefinito per attivarlo manualmente; le protezioni si applicano ai singoli job che indicano l'ambiente.
