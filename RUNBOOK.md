# Runbook Operativo

## Avvio servizi
1. `docker compose up -d`
2. `npm ci`
3. `npm run prisma:deploy -w backend`
4. `npm run dev` (sviluppo) oppure `npm run build && npm run start -w backend` + deploy frontend statico

## Verifiche post-avvio
- API health: `curl -s http://127.0.0.1:4000/api/health`
- API ready: `curl -s http://127.0.0.1:4000/api/ready`
- Platform health: `curl -s http://127.0.0.1:4100/platform-api/health`
- Platform ready: `curl -s http://127.0.0.1:4100/platform-api/ready`

## Backup e restore DB
- Backup:
  ```bash
  ./ops/backup-db.sh
  ```
- Restore su DB di test:
  ```bash
  ./ops/restore-db-test.sh backups/<nome-file>.sql
  ```

## Incident response minima
1. Isolare il problema (API non raggiungibile, DB down, errori auth).
2. Raccogliere log backend e reverse proxy.
3. Verificare health/readiness.
4. Se necessario, rollback applicativo alla release precedente.
5. Ripristinare DB da backup solo in caso di corruzione dati confermata.
6. Aprire post-mortem con timeline e azioni correttive.

## Rollback applicativo
- Conservare sempre l'artefatto della release precedente.
- Rollback = redeploy build precedente + verifica health/readiness.
- Se migrazione DB non backward-compatible, prevedere strategia di rollback DB testata prima del rilascio.

## Rollback Procedure

### A) Rollback senza migrazione DB (solo codice)

Usare questa procedura quando il deploy ha aggiornato solo codice/immagini Docker e non ha applicato migrazioni Prisma o modifiche dati.

1. Identificare il tag Docker attualmente in produzione:
   ```bash
   cd /opt/fleetum/app
   docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.yml images
   docker inspect fleetum_backend --format '{{.Config.Image}}'
   ```

2. Identificare il tag Docker precedente da GHCR o dai log Actions:
   ```bash
   docker image ls 'ghcr.io/silviomasuccio6/fleetum-backend'
   grep -R "FLEETUM_BACKEND_IMAGE" /opt/fleetum/logs 2>/dev/null || true
   ```

   I tag production creati da GitHub Actions usano lo short SHA, ad esempio:
   ```txt
   ghcr.io/silviomasuccio6/fleetum-backend:abc123def456
   ```

3. Eseguire rollback del solo backend usando lo script dedicato:
   ```bash
   /opt/fleetum/app/deploy/rollback.sh abc123def456
   ```

   In alternativa manuale:
   ```bash
   cd /opt/fleetum/app
   export FLEETUM_BACKEND_IMAGE=ghcr.io/silviomasuccio6/fleetum-backend:abc123def456
   docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.yml pull backend
   docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.yml stop backend
   docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.yml up -d --no-deps backend
   ```

4. Verifica rollback:
   ```bash
   docker inspect fleetum_backend --format '{{.Config.Image}}'
   curl -f https://api.fleetum.it/api/health
   curl -f https://api.fleetum.it/api/ready
   docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.yml logs --tail=100 backend
   ```

   Il rollback è riuscito solo se:
   - l'immagine backend è il tag atteso;
   - `/api/health` e `/api/ready` rispondono 200;
   - login e flussi critici (booking, contratti, dashboard) funzionano;
   - non ci sono errori ripetuti nei log backend.

### B) Rollback con migrazione DB

Questo è il caso critico. Prisma Migrate non genera automaticamente migrazioni inverse affidabili: il rollback DB deve essere progettato e testato.

1. Identificare migrazioni applicate:
   ```bash
   cd /opt/fleetum/app
   docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.yml run --rm backend \
     npx prisma migrate status --schema prisma/schema.prisma
   docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.yml exec -T postgres \
     psql -U fleetum -d fleetum -c "select migration_name, finished_at from _prisma_migrations order by finished_at desc limit 10;"
   ```

2. Decidere se la migrazione è reversibile:
   - additive safe: nuove colonne nullable, nuove tabelle, nuovi indici;
   - risky: rename, change type, vincoli NOT NULL, unique constraint su dati esistenti;
   - destructive: `DROP COLUMN`, `DROP TABLE`, cancellazioni dati, trasformazioni non recuperabili.

3. Scrivere una migrazione reverse sicura in Prisma:
   ```bash
   cd /opt/fleetum/app/backend
   npx prisma migrate dev --create-only --name rollback_<nome_migrazione>
   ```

   Poi modificare manualmente `backend/prisma/migrations/<timestamp>_rollback_<nome>/migration.sql` con SQL inverso verificabile.

   Esempi:
   ```sql
   -- Esempio reversibile: rimuovere indice creato dalla release
   DROP INDEX IF EXISTS "Vehicle_plate_tenantId_idx";

   -- Esempio reversibile con cautela: rimuovere colonna nullable appena introdotta
   ALTER TABLE "Vehicle" DROP COLUMN IF EXISTS "temporaryField";
   ```

   Non fare reverse distruttivo se i dati servono ancora all'app o se non c'è backup verificato.

4. Ordine corretto:
   ```txt
   1. Mettere app in maintenance / bloccare scritture se necessario.
   2. Rollback codice al tag compatibile precedente.
   3. Verificare che il vecchio codice possa avviarsi senza usare i nuovi campi.
   4. Applicare migrazione reverse testata.
   5. Riavviare backend.
   6. Verificare health/readiness e flussi business.
   ```

   Comandi indicativi:
   ```bash
   /opt/fleetum/app/deploy/rollback.sh <tag_precedente>
   docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.yml run --rm backend \
     npx prisma migrate deploy --schema prisma/schema.prisma
   curl -f https://api.fleetum.it/api/ready
   ```

5. Warning importante:
   - Le migrazioni destructive come `DROP COLUMN` o `DROP TABLE` sono irreversibili senza backup.
   - Se la migrazione ha perso dati, una migrazione reverse può ricreare la struttura ma non i dati.
   - Prima di qualsiasi migrazione destructive serve backup manuale verificato e restore testato.

### C) Rollback completo da backup

Usare solo come worst-case:
   - corruzione dati;
   - migrazione destructive applicata con perdita dati;
   - app incompatibile con stato DB;
   - incidente di sicurezza che richiede ripristino a punto precedente.

Passi:
1. Dichiarare incidente e bloccare deploy/scritture.
2. Identificare backup offsite più recente valido.
3. Scaricare dump PostgreSQL e archivio uploads da S3/R2/B2.
4. Eseguire backup di sicurezza dello stato corrente.
5. Seguire procedura:
   ```bash
   /opt/fleetum/app/deploy/backup/restore.sh
   ```
6. Verificare:
   ```bash
   curl -f https://api.fleetum.it/api/health
   curl -f https://api.fleetum.it/api/ready
   ```
7. Verificare manualmente login, booking, contratti, file uploads e invio email.

Downtime atteso:
   - rollback solo codice: 5-15 minuti;
   - rollback con migrazione reverse: 30-90 minuti, dipende dalla migrazione;
   - restore completo da backup: 1-4 ore per DB piccolo/medio, fino a 8 ore se bisogna ricostruire VPS/storage o scaricare archivi grandi.
