# D16 CI/CD + Quality Gates

Stato: PRESENTE-PARZIALE

## Evidenze repository

- `.github/workflows/ci.yml`: secret scan Gitleaks, SAST Semgrep, lint, build, test applicativi, audit dipendenze, tenant isolation PostgreSQL, Lighthouse e compatibilita versione precedente/schema migrato.
- `.github/workflows/deploy-production.yml`: SHA unico verificato dalla CI, immagini con tag SHA completo e deploy per digest, backup, lock, health check e rollback applicativo.
- `.github/workflows/deploy-staging.yml`: dispatch manuale vincolato a CI sullo SHA esatto, immagini per digest e manifest versionati per SHA.
- `.github/workflows/e2e-nightly.yml`: gate fail-closed per flussi critici su staging con due tenant sintetici.
- `.github/workflows/secret-history-scan.yml`: scansione della history con baseline esplicita.

## Gate ancora esterni

- La branch protection effettiva di GitHub e gli approval dell'environment devono essere verificati nelle impostazioni del repository.
- Il release candidate locale non ha ancora una CI ospitata: push/PR/review restano obbligatori.
- Il gate E2E richiede uno staging HTTPS configurato e due tenant sintetici; un workflow verde che non esegue i test non e' evidenza valida.
- Non e' presente un DAST autenticato continuo. Va introdotto solo con scope e ambiente non produttivo approvati.

## Criterio di uscita

Un commit puo' entrare nel rehearsal di staging soltanto quando la CI ospitata e' verde sullo stesso SHA. La produzione richiede inoltre review umana, staging/E2E, verifica migrazioni/rollback e tutti i gate esterni elencati nel documento del release candidate.
