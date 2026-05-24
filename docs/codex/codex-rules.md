# Codex Rules Fleetum

## Regole sintetiche

- Lavora su branch `codex/<task>`, non direttamente su `main`.
- Non committare secrets, `.env`, chiavi, token o password.
- Prima leggi i file rilevanti, poi modifica il minimo necessario.
- Proteggi sempre tenant isolation: ogni query business deve rispettare `tenantId`.
- Non esporre dati cross-tenant in API, log, export, PDF o Platform Console.
- Non bypassare auth, CSRF, rate limit, license guard o middleware platform.
- Stripe: licenze attivate solo da webhook verificato, mai dal redirect frontend.
- Route pubbliche: solo se necessarie, validate, rate-limited e senza leakage.
- Docker: no `.env` nelle immagini, no `node_modules` locali, preferire `npm ci`.
- Deploy: CI verde, backup, migration, restart, health check, rollback possibile.
- File critici: modificare solo con motivazione, test e rollback.
- Documentare sempre comandi eseguiti, esiti e rischi residui.

## Comandi quality gate preferiti

```bash
npm run lint
npm run build
npm run test -w backend
git diff --check
```

## Stop conditions

Fermati e chiedi conferma se:

- trovi modifiche inattese in file che devi toccare;
- serve cambiare schema DB in modo non richiesto;
- serve disabilitare controlli sicurezza;
- serve modificare segreti/env production;
- il fix richiede deploy manuale fuori GitHub Actions.
