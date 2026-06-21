# D16 CI/CD + Quality Gates

Stato: PRESENTE-PARZIALE

## Evidenze repository
- Pipeline CI:
  - `.github/workflows/ci.yml`
- Gate presenti: lint, build, backend tests, frontend tests, npm audit high.

## Gap
- Secret scanning automatico in CI: NON TROVATO
- SAST/CodeQL in CI: NON TROVATO
- Policy release branch/tag/versioning: NON TROVATO
- Deployment automatico ambienti: NON TROVATO

## Remediation
- Must: aggiungere secret scan + SAST bloccanti.
- Should: policy branch protection e release tags.
- Owner suggerito: DevOps Engineer
