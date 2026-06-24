# Checklist Rilascio

## Gate obbligatori (bloccanti)
- [ ] `npm run lint` verde
- [ ] `npm run build` verde
- [ ] test backend verdi (`npm run test -w backend`)
- [ ] test frontend verdi (`npx tsx --test frontend/tests/**/*.test.ts`)
- [ ] `npm audit --omit=dev --audit-level=high` senza vulnerabilità high/critical
- [ ] variabili ambiente produzione valorizzate e segreti ruotati
- [ ] CORS/IP allowlist/proxy configurati per produzione
- [ ] backup DB eseguito e restore testato
- [ ] health/readiness endpoint verificati in staging
- [ ] piano rollback documentato e provato
- [ ] cutover Stripe Live completato seguendo `docs/deployment/stripe-live-cutover.md`

## Verifiche raccomandate entro 7 giorni dal rilascio
- [ ] logging centralizzato e retention definita
- [ ] monitoraggio uptime/error rate/latency configurato
- [ ] alert su login anomali e errori 5xx
- [ ] scan periodica segreti e dipendenze schedulata

## Verifiche raccomandate entro 30 giorni
- [ ] aumento copertura test flussi core business
- [ ] test carico su endpoint principali
- [ ] hardening CSP e security headers al reverse proxy
- [ ] runbook incident response validato con esercitazione
