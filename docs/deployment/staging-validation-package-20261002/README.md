# Fleetum — pacchetto staging aggiornato dopo CI/E2E, 2 ottobre 2026

**Pronto per revisione locale; nessuna dispatch staging o produzione autorizzata.**
Candidato sorgente `97b56ca126f14e89846ef0b2fbc836bf27952413`, tree `c56b0252be254999b28cdc3552bdde39f78a477a`, branch
`codex/fix-ci-e2e-release-binding`. Il commit documentale finale è distinto e
registrato nel rapporto esterno; non contiene ulteriori modifiche applicative.

## Stato corrente

CI/E2E implementati localmente: sette checkout espliciti/verificati; guardie
PostgreSQL attivate; prova CI dello stesso checkout e sei job riusciti; staging
verifica artefattoCI e pubblica prova release dopohealth; E2E verifica run/SHA/
digest e container/restart prima e dopo suite, richiede sette casi al primo tentativo.
Il trigger produzione rimane invariato. Nessuna nuova migrazione/dipendenza/app/UI.

Release locale264/44/9/55 e PostgreSQL522/522 PASS sul freeze, senza fail/skip.
Il caller DB non imposta dotenv/optin: li imposta il runner sicuro. Le prove negative
CI/E2E precedono i fix. Il nuovo reportgate accetta il browser storico7/7; non è
un nuovo run browser/SSH/GitHub. RoutingHTTPS effettivo non è provato dagli snapshot
Docker. Nuovo secretKNOWN_HOSTS protetto necessario prima delle future osservazioni.

G01 passa da impedimento di implementazione a **PENDING** review/esecuzione hosted,
non aPASS. G02 resta bloccato: email/cron, allowlist target/tenant e noindex.
Tutti19gate esterni rimangono non eseguiti; owner/autorizzazioni/soglie vuoti.
Seguono restore/migrazioni/carico, proxy/cookie/provider sandbox e decisioni
legacy/privacy. Lo schema resta48migrazioni,sei giàpresenti rispetto main42;
il main storico non prova release/schema live. Nessun downSQL/replay automatico.

## Documenti e verifiche

- [Registro19gate](gate-register.json) e [record pendente](execution-record.template.json).
- [Runbook CI/E2E](../ci-e2e-release-binding-20261002.md).
- [Indice prove](evidence-index.json):154artefatti storici content-verified, più
  prove locali correnti distinte con SHA di freeze/risultati/commit sorgente.
- [Migrazioni](migration-inventory.json), [sorgenti ispezionati](inspected-source.json)
  e [freeze pacchetto](package-hashes.json).
- [Workflow pre-hardening](workflow-readiness.md) e [scenari dominio](domain-scenarios.md)
  sono report storici di preparazione459ceed2: i gapCI già corretti sono superati dal
  runbook corrente; restano validi i limiti non chiusi. I37finding restano26/2/4/5,
  INT01..06 corretti nel codice; marketing/redesign separati.

Il [verificatore](validate-package.py) controlla hash/identità/DAG e record, non
l'autenticità/sufficienza delle attestazioni né concede permesso di rilascio.

```sh
python3 docs/deployment/staging-validation-package-20261002/validate-package.py \
  --source-root . --audit-root /Users/silvio/Documents/Playground/Fleetum-audit-20260909
```

Conservare0gatePASS finché mancano osservazioni: prova CI richiede anche job finale
source-attestation; E2E richiede run e snapshotSHA/digest concordi, sette casi senza
skip/flaky/errori. UTC, owner, decisioni, artefatti redatti e soglie prima delle
prove sono obbligatori. Copiare il record fuori dal freeze per esecuzioni future;
mai condividere env, password, cookie/token, chiavi, URLfirmati o dati personali.

**Prossima tranche locale:** contenimento email/cron, allowlist e noindex. Poi
review e autorizzazione separata per attività esterne. Main/produzione/provider
rimangono intatti. Rollback documenti solo revert; rollback workflow reintroduce
igap e richiede review, senza effettiDB/finanziari automatici.
