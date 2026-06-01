# Checklist Rilascio

## Pre-deploy: migrazioni e rollback
- [ ] Ho verificato se la release contiene migrazioni Prisma (`backend/prisma/migrations/*`)
- [ ] `npx prisma migrate status --schema backend/prisma/schema.prisma` verificato in staging/ambiente target
- [ ] La migrazione è solo additiva e reversibile (nuove tabelle/colonne nullable/indici) oppure è stata classificata come rischiosa/destructive
- [ ] Per ogni migrazione rischiosa esiste una migration reverse documentata e testata
- [ ] Per ogni migrazione destructive (`DROP COLUMN`, `DROP TABLE`, cancellazioni dati, data rewrite irreversibile) è stato eseguito backup manuale prima del deploy
- [ ] Backup manuale verificato: dump PostgreSQL valido con `gzip -t` e, se applicabile, uploads validati con `tar -tzf`
- [ ] Restore test o restore dry-run completato prima del deploy se la migrazione può impattare dati core
- [ ] Tag Docker corrente e tag precedente annotati nel ticket/release notes
- [ ] Piano rollback scelto prima del deploy: solo codice / codice + reverse migration / restore completo da backup
- [ ] Finestra di manutenzione comunicata se la migrazione richiede lock, downtime o blocco scritture

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
