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

## Deploy automatizzato

Fleetum usa GitHub Actions per portare in produzione solo codice gia validato dalla CI.

### Workflow

- Workflow CI: `.github/workflows/ci.yml`
- Workflow deploy: `.github/workflows/deploy.yml`
- Trigger deploy: `workflow_run` del workflow `CI`, solo quando il branch e `main` e la conclusione e `success`.
- Registry immagini: GitHub Container Registry (`ghcr.io/silviomasuccio6/fleetum-*`).
- Deploy target VPS: `/opt/fleetum/`.

### Secrets GitHub richiesti

Configurare in `Settings -> Secrets and variables -> Actions`:

- `VPS_HOST`: hostname o IP pubblico del VPS.
- `VPS_USER`: utente SSH usato per il deploy.
- `VPS_SSH_KEY`: chiave privata SSH senza passphrase, autorizzata sul VPS solo per l'utente deploy.
- `GHCR_TOKEN`: token GitHub con permesso minimo di lettura pacchetti, usato dal VPS per `docker login ghcr.io`.

Il workflow usa `GITHUB_TOKEN` per build e push delle immagini da GitHub Actions.
Il secret `GHCR_TOKEN` serve al VPS per eseguire `docker pull` da GHCR.

### Prerequisiti sul VPS

Sul VPS devono esistere:

```bash
/opt/fleetum/docker-compose.prod.yml
/opt/fleetum/env/backend.env
/opt/fleetum/env/compose.env
/opt/fleetum/logs/
/opt/fleetum/scripts/
```

`/opt/fleetum/env/backend.env` contiene le variabili runtime del backend e non deve mai essere committato.

`/opt/fleetum/env/compose.env` deve contenere almeno:

```bash
POSTGRES_PASSWORD=...
CADDY_EMAIL=...
FLEETUM_BACKEND_IMAGE=ghcr.io/silviomasuccio6/fleetum-backend:latest
FLEETUM_FRONTEND_IMAGE=ghcr.io/silviomasuccio6/fleetum-frontend:latest
```

### Sequenza deploy

Il workflow esegue:

1. attende CI verde su `main`;
2. builda e pusha immagini Docker:
   - `ghcr.io/silviomasuccio6/fleetum-backend:sha-<sha>`
   - `ghcr.io/silviomasuccio6/fleetum-backend:latest`
   - `ghcr.io/silviomasuccio6/fleetum-frontend:sha-<sha>`
   - `ghcr.io/silviomasuccio6/fleetum-frontend:latest`
3. salva le immagini correnti in `/opt/fleetum/last-deploy.txt`;
4. esegue `docker pull` delle nuove immagini;
5. esegue Prisma migration prima del restart:

```bash
docker run --rm \
  --env-file /opt/fleetum/env/backend.env \
  ghcr.io/silviomasuccio6/fleetum-backend:sha-<sha> \
  npx prisma migrate deploy --schema prisma/schema.prisma
```

6. se la migration fallisce, il deploy si ferma e non esegue `docker compose up`;
7. aggiorna `FLEETUM_BACKEND_IMAGE` e `FLEETUM_FRONTEND_IMAGE` in `/opt/fleetum/env/compose.env`;
8. riavvia i servizi:

```bash
docker compose --env-file /opt/fleetum/env/compose.env -f /opt/fleetum/docker-compose.prod.yml up -d --no-build backend caddy
```

9. attende 15 secondi;
10. verifica health locale:

```bash
curl -sf http://127.0.0.1:4000/api/health
```

### Rollback automatico

Prima di ogni deploy viene creato/aggiornato:

```bash
/opt/fleetum/last-deploy.txt
```

Il file contiene le immagini backend/frontend precedenti.

Se il deploy supera la migration ma fallisce l'health check, il workflow esegue:

```bash
/opt/fleetum/scripts/rollback.sh <backend-image-precedente> <frontend-image-precedente>
```

Lo script:

1. ripristina le immagini precedenti in `/opt/fleetum/env/compose.env`;
2. esegue `docker compose pull backend caddy`;
3. esegue `docker compose up -d --no-build backend caddy`;
4. attende 15 secondi;
5. verifica `http://127.0.0.1:4000/api/health`;
6. scrive log in `/opt/fleetum/logs/rollback.log`.

### Rollback manuale

In caso di emergenza:

```bash
cd /opt/fleetum
cat /opt/fleetum/last-deploy.txt
/opt/fleetum/scripts/rollback.sh \
  ghcr.io/silviomasuccio6/fleetum-backend:sha-<previous> \
  ghcr.io/silviomasuccio6/fleetum-frontend:sha-<previous>
```

### Notifiche

- Successo deploy: commento sul commit deployato con immagini e link produzione.
- Fallimento deploy: apertura GitHub Issue `Deploy failed: <sha>` con link al workflow run.

### Avvertenze

- Il rollback automatico copre solo rollback applicativo senza reverse migration.
- Una migration distruttiva richiede backup e piano reverse approvati prima del merge.
- Non modificare manualmente produzione bypassando GitHub Actions salvo emergenza esplicita documentata.
