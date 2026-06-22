# Runbook Operativo

## Avvio servizi
1. `docker compose up -d`
2. `npm ci`
3. `npm run prisma:deploy -w backend`
4. `npm run dev` (sviluppo) oppure `npm run build && npm run start -w backend` + deploy frontend statico

## Verifiche post-avvio
- API health production: `curl -fsS https://api.fleetum.it/api/health`
- API ready production: `curl -fsS https://api.fleetum.it/api/ready`
- Platform health production: `curl -fsS https://platform.fleetum.it/platform-api/health`
- Platform ready production: `curl -fsS https://platform.fleetum.it/platform-api/ready`
- API health locale/dev: `curl -s http://127.0.0.1:4000/api/health`
- API ready locale/dev: `curl -s http://127.0.0.1:4000/api/ready`
- API metrics: `curl -H "Authorization: Bearer $METRICS_TOKEN" http://127.0.0.1:4000/api/metrics`
- Platform metrics: `curl -H "Authorization: Bearer $METRICS_TOKEN" http://127.0.0.1:4100/platform-api/metrics`

## Observability e metriche

Fleetum espone metriche in formato Prometheus text su:

```txt
GET /api/metrics
GET /platform-api/metrics
```

In produzione `METRICS_TOKEN` deve essere configurato nel backend env e le richieste
devono usare:

```bash
Authorization: Bearer <METRICS_TOKEN>
```

Se `METRICS_TOKEN` manca in produzione, l'endpoint metriche risponde `403` per evitare
esposizione pubblica di informazioni operative.

Metriche principali:

```txt
fleetum_http_requests_total
fleetum_http_request_duration_seconds
fleetum_http_errors_total
fleetum_prisma_operation_duration_seconds
fleetum_prisma_slow_operations_total
fleetum_prisma_errors_total
fleetum_db_available
```

I path HTTP sono normalizzati per ridurre cardinalita' e leakage: ID, CUID e numeri sono
sostituiti con `:id`.

### Slow query logging Prisma

Soglie default:

```txt
development: 100ms
production: 500ms
critical: >= 2000ms
```

Override opzionale:

```env
PRISMA_SLOW_QUERY_MS=750
```

I log Prisma includono `model`, `action`, `durationMs`, `requestId`, `tenantId` e `userId`
quando disponibili dal contesto request. Non vengono loggati parametri SQL: possono
contenere PII come nomi, email, documenti, targhe, numeri patente o dati contratto.

Esempio warning:

```json
{
  "level": "warn",
  "requestId": "req_01",
  "tenantId": "tenant_01",
  "model": "RentalBooking",
  "action": "findMany",
  "durationMs": 684.21,
  "thresholdMs": 500,
  "msg": "Slow Prisma operation"
}
```

Esempio errore critico:

```json
{
  "level": "error",
  "requestId": "req_02",
  "tenantId": "tenant_01",
  "model": "AuditLog",
  "action": "findMany",
  "durationMs": 2405.77,
  "thresholdMs": 500,
  "msg": "Critical slow Prisma operation"
}
```

In sviluppo viene loggata anche la struttura SQL delle query oltre soglia, ma mai i
parametri. In produzione vengono loggati errori Prisma e operazioni lente model/action.

### Alert consigliati

Configurare alert nel sistema di monitoraggio scelto, ad esempio Prometheus + Alertmanager,
Grafana Cloud, Better Stack, Datadog o equivalente.

```yaml
groups:
  - name: fleetum-api
    rules:
      - alert: FleetumHighErrorRate
        expr: sum(rate(fleetum_http_errors_total[5m])) / clamp_min(sum(rate(fleetum_http_requests_total[5m])), 1) > 0.05
        for: 10m
        labels:
          severity: critical
        annotations:
          summary: "Fleetum error rate sopra 5%"

      - alert: FleetumHighResponseTime
        expr: histogram_quantile(0.95, sum(rate(fleetum_http_request_duration_seconds_bucket[5m])) by (le)) > 1.5
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Fleetum p95 response time sopra 1.5s"

      - alert: FleetumDatabaseUnavailable
        expr: fleetum_db_available == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Database Fleetum non disponibile"

      - alert: FleetumPrismaSlowOperations
        expr: sum(rate(fleetum_prisma_slow_operations_total[10m])) > 1
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "Aumento operazioni Prisma lente"
```

### Incident procedure: error rate alto

1. Verificare `/api/ready` e `/platform-api/ready`.
2. Controllare log backend filtrando per `level=error` e `requestId`.
3. Verificare se gli errori sono concentrati su un path normalizzato o su un tenant.
4. Se correlati a nuova release, eseguire rollback applicativo.
5. Se correlati a DB, seguire procedura `Database unavailable`.
6. Aprire issue/post-mortem con timeline, requestId campione e azione correttiva.

### Incident procedure: response time alto

1. Controllare `fleetum_http_request_duration_seconds` p95/p99.
2. Controllare `fleetum_prisma_slow_operations_total` e log `Slow Prisma operation`.
3. Identificare `model/action` e requestId correlati.
4. Verificare indici DB, paginazione, include Prisma pesanti e query N+1.
5. Se impatta produzione, applicare mitigazione: ridurre paginazione, disabilitare job pesante,
   rollback, oppure aumentare risorse DB temporaneamente.

### Incident procedure: database unavailable

1. Verificare `fleetum_db_available` e `curl -fsS https://api.fleetum.it/api/ready`.
2. Controllare stato container/managed DB e connessione `DATABASE_URL`.
3. Controllare saturazione disco, CPU, memoria e connessioni DB.
4. Non eseguire migration durante incidente DB.
5. Se DB locale e dati corrotti, usare restore da backup secondo procedura backup/restore.
6. Dopo ripristino, verificare `/api/ready`, login tenant e una query booking/veicoli.

## Managed PostgreSQL

La migrazione da PostgreSQL Docker locale a managed PostgreSQL e' documentata in:

```txt
docs/deployment/postgres-managed-migration.md
```

Principi operativi:

- `DATABASE_URL` e' la connection string runtime del backend, con SSL e pooler/session URL.
- `DIRECT_URL` e' la connection string diretta per `prisma migrate deploy`, `pg_dump`,
  `pg_restore` e admin tooling.
- `PG_DUMP_DATABASE_URL` deve essere configurata in `/opt/fleetum/env/backup.env` dopo
  la rimozione del servizio locale `postgres`.
- Il vecchio volume `/opt/fleetum/postgres` non va cancellato subito dopo il cutover:
  conservarlo almeno 7-14 giorni come rollback/fallback controllato.

## Configurazione VPS / reverse proxy

`TRUST_PROXY` deve essere `1` nel `backend.env` di produzione perché il traffico passa
attraverso Caddy. Senza questa impostazione Express legge l'IP del container Caddy invece
del client reale: rate limiting auth e IP allowlist della Platform Console non funzionano
correttamente.

Verifica produzione:

```bash
grep -q "TRUST_PROXY=1" /opt/fleetum/env/backend.env || echo "WARNING: TRUST_PROXY non impostato"
```

## Sessioni tenant e refresh token

`JWT_EXPIRES_IN` deve restare breve, consigliato `15m`, per ridurre la finestra utile di
un access token compromesso. Il refresh token resta valido 30 giorni ed e' ruotato dal
backend: il frontend intercetta i `401` con codice `UNAUTHORIZED`, chiama
`POST /auth/refresh`, aggiorna cookie/CSRF e riprova automaticamente la richiesta
originale.

Se il refresh fallisce con `401`, il client cancella lo stato locale e reindirizza al
login. Non modificare `PLATFORM_JWT_EXPIRES_IN`: la Platform Console usa un JWT separato.

## Password Platform Console

La Platform Console usa email + password + OTP email. La password admin non deve mai
essere salvata in chiaro. Il bootstrap usa `PLATFORM_ADMIN_PASSWORD_HASH`, un hash
bcrypt che inizia con `$2a$` o `$2b$`.

### Recupero password standard

Usare `https://platform.fleetum.it/#/password-recovery` dall'IP autorizzato:

1. Inserire `PLATFORM_ADMIN_EMAIL`.
2. Inserire l'OTP ricevuto via Resend, valido 8 minuti.
3. Impostare e confermare una nuova password di almeno 16 caratteri.
4. Tornare al login Platform.

Il reset salva il nuovo hash bcrypt nel database (`PlatformAdminCredential`) e non
richiede la modifica manuale del file env. Le richieste sono limitate per IP/email e
gli OTP sono monouso. Dettagli: `docs/technical/platform-password-recovery.md`.

### Bootstrap o recovery d'emergenza

Per rigenerare l'hash:

```bash
node -e "require('bcryptjs').hash('TUA_PASSWORD',12).then(console.log)"
```

Procedura produzione:

1. Generare una password lunga e unica fuori dal repository.
2. Generare l'hash bcrypt con il comando sopra.
3. Salvare solo l'hash in `/opt/fleetum/env/backend.env`:
   ```env
   PLATFORM_ADMIN_PASSWORD_HASH=$2b$12$...
   ```
4. Non committare mai la password in chiaro, l'hash reale o il file env di produzione.
5. Riavviare il backend tramite deploy GitHub Actions. Non usare mai `docker compose up` senza tag immutabili: il compose production rifiuta volutamente configurazioni senza immagini esplicite.
   In emergenza controllata usare il deploy sicuro con i tag della release:
   ```bash
   FLEETUM_BACKEND_IMAGE=ghcr.io/silviomasuccio6/fleetum-backend:<commit-sha> \
   FLEETUM_FRONTEND_IMAGE=ghcr.io/silviomasuccio6/fleetum-frontend:<commit-sha> \
   ENV_FILE=/opt/fleetum/env/compose.env \
   ./deploy/scripts/safe-production-deploy.sh
   ```
6. Verificare login Platform: email `PLATFORM_ADMIN_EMAIL`, password originale e OTP email.

Se `PLATFORM_ADMIN_PASSWORD_HASH` non inizia con `$2`, il backend fallisce il boot con
un errore esplicito per evitare configurazioni insicure.

## Pulizia history repository pubblico

Prima di considerare il repository completamente pubblico, verificare che la history Git
non contenga riferimenti legacy, email reali o dati cliente. Controllo consigliato:

```bash
git log --all -S "<legacy-brand-or-system-marker>" --oneline
git log --all -S "<legacy-real-email>" --oneline
```

Se una stringa appare in commit precedenti, rimuoverla dalla history con `git filter-repo`
o BFG Repo Cleaner su clone mirror, poi eseguire force-push coordinato di branch e tag.
Questa operazione riscrive la history e rompe i clone esistenti: va pianificata prima di
rendere il repository realmente pubblico e comunicata a chiunque abbia clonato la repo.

Stato noto: alcune stringhe legacy sono state rimosse dal working tree, ma possono
risultare ancora in commit storici. Serve rewrite history dedicato prima della pubblicazione
definitiva.

### Secret scanning CI

Fleetum usa due controlli Gitleaks separati:

1. `.github/workflows/ci.yml`: working tree scan con `--no-git --redact`, bloccante su PR/push.
2. `.github/workflows/secret-history-scan.yml`: full history scan manuale/schedulato con checkout completo.

Il full history scan non fallisce di default per evitare che vecchi falsi positivi blocchino
il lavoro quotidiano, ma produce un artifact SARIF redatto. Per usarlo come gate manuale,
lanciare il workflow con `fail_on_findings=true`.

Policy e comandi locali:

```txt
docs/security/secret-scanning-policy.md
```

Se il full history scan trova un segreto reale, ruotare subito il segreto prima di qualsiasi
rewrite della history. Non incollare mai valori di secret in issue, PR, log o chat.

## Backup e restore production-grade

Fleetum production richiede backup offsite obbligatorio. I backup solo locali non sono
considerati sufficienti per produzione: un guasto VPS o disco puo' rendere inutilizzabili
applicazione, database e backup nello stesso momento.

Target attuali:

```txt
RPO: 24 ore
RTO: 4 ore
Retention: 30 giorni
```

Ultimo restore drill documentato:

```txt
Data: 2026-06-04
Ambiente: locale isolato con schema Fleetum corrente, nessun impatto produzione
Esito: PASS su DB, StoredFileObject e uploads canary; resta da provare backup offsite reale
Report: docs/deployment/restore-drills/2026-06-04-restore-drill.md
```

Configurazione production:

```bash
sudo cp /opt/fleetum/app/deploy/env/backup.env.production.example /opt/fleetum/env/backup.env
sudo chmod 600 /opt/fleetum/env/backup.env
sudo nano /opt/fleetum/env/backup.env
```

Opzioni offsite supportate:

```txt
Cloudflare R2
AWS S3
Backblaze B2
Qualsiasi S3-compatible tramite rclone o aws-cli
```

Variabili minime con rclone:

```env
BACKUP_OFFSITE_REQUIRED=true
RETENTION_DAYS=30
OFFSITE_RCLONE_TARGET=fleetum-r2:fleetum-backups
BACKUP_ALERT_EMAIL=ops@example.com
RESEND_API_KEY=re_...
RESEND_FROM=Fleetum Backups <no-reply@fleetum.it>
```

Backup manuale:

```bash
/opt/fleetum/app/deploy/backup/backup-postgres.sh
/opt/fleetum/app/deploy/backup/backup-uploads.sh
```

Cron giornaliero installato dal deploy:

```bash
/opt/fleetum/app/deploy/backup/install-cron.sh
```

Schedulazione:

```cron
15 2 * * * /opt/fleetum/app/deploy/backup/backup-postgres.sh >> /opt/fleetum/logs/backup-postgres.log 2>&1
30 2 * * * /opt/fleetum/app/deploy/backup/backup-uploads.sh >> /opt/fleetum/logs/backup-uploads.log 2>&1
*/30 * * * * /opt/fleetum/app/deploy/scripts/disk-capacity-alert.sh --check cron >> /opt/fleetum/logs/disk-capacity.log 2>&1
```

Restore test mensile:

```bash
/opt/fleetum/app/deploy/backup/restore-postgres-test.sh
```

Il workflow GitHub Actions `Backup Restore Test` lo esegue automaticamente il primo giorno
del mese e puo' essere lanciato manualmente. In caso di fallimento crea issue GitHub e gli
script inviano alert via Resend/webhook se configurati.

Regole operative:

1. Non eseguire migration destructive se il restore test mensile non e' verde.
2. Prima di migration rischiose, eseguire backup manuale e restore test.
3. Verificare che i bucket offsite siano privati e con lifecycle retention 30 giorni.
4. Non salvare mai credenziali backup nel repository.
5. In caso di restore production, seguire `deploy/backup/restore-postgres.md`.

## Deploy production sicuro
Il deploy production GitHub Actions deve usare la sequenza sicura versionata in
`deploy/scripts/safe-production-deploy.sh`.

### Configurazione GitHub Actions production

Configurare questi valori nel repository GitHub, preferibilmente nell'environment
`production` per applicare approval e audit trail.

Secrets obbligatori:

```txt
FLEETUM_VPS_SSH_KEY
```

`FLEETUM_VPS_SSH_KEY` deve contenere la chiave privata SSH completa usata dal workflow
per collegarsi al VPS. Non inserire la chiave pubblica e non stamparla nei log. Il
workflow accetta anche il nome legacy `VPS_SSH_KEY`, ma il nome canonico e'
`FLEETUM_VPS_SSH_KEY`.

Variables consigliate:

```txt
FLEETUM_VPS_HOST
FLEETUM_VPS_USER
FLEETUM_APP_DIR
FLEETUM_ENV_FILE
FLEETUM_LAST_DEPLOY_FILE
```

Valori production attesi:

```txt
FLEETUM_APP_DIR=/opt/fleetum/app
FLEETUM_ENV_FILE=/opt/fleetum/env/compose.env
FLEETUM_LAST_DEPLOY_FILE=/opt/fleetum/last-deploy.txt
```

Quando si inseriscono le Variables nell'interfaccia GitHub, verificare che il valore non
contenga spazi, virgolette o ritorni a capo finali. Il workflow normalizza questi valori
prima di usarli, ma valori sporchi possono causare errori difficili da leggere negli step
SSH/rsync, ad esempio `bash: line 2: /: Is a directory` o `rsync error code 126`.

`FLEETUM_VPS_HOST` e `FLEETUM_VPS_USER` possono essere GitHub Variables o Secrets. Per
compatibilita' temporanea il workflow supporta anche `VPS_HOST`, `VPS_USER`, `APP_DIR`,
`ENV_FILE` e `LAST_DEPLOY_FILE`, ma i nomi `FLEETUM_*` restano lo standard operativo.

Se il deploy fallisce nella fase iniziale, controllare lo step `Validate production
deploy configuration`: deve indicare esattamente quale secret o variable manca. Se fallisce
lo step `Configure SSH key`, la chiave privata e' assente, non valida, salvata come chiave
pubblica oppure il VPS non e' raggiungibile via SSH sulla porta configurata.

Prima di ogni `prisma migrate deploy` sono obbligatori:

```bash
/opt/fleetum/app/deploy/backup/backup-postgres.sh
/opt/fleetum/app/deploy/backup/backup-uploads.sh
```

Se uno dei backup fallisce, la migration non deve partire e il workflow deve fallire.

Prima del deploy, lo script salva le immagini correnti in:

```txt
/opt/fleetum/last-deploy.txt
```

Il file contiene almeno:

```txt
PREVIOUS_BACKEND_IMAGE=...
PREVIOUS_FRONTEND_IMAGE=...
NEW_BACKEND_IMAGE=...
NEW_FRONTEND_IMAGE=...
DEPLOY_STARTED_AT=...
```

La migration viene eseguita solo dopo backup riuscito. Se `prisma migrate deploy` fallisce,
il deploy si ferma prima di `docker compose up -d`, quindi non viene avviata la nuova release.

Il post-deploy health check obbligatorio e':

```bash
curl -fsS https://api.fleetum.it/api/ready
```

Il backend production non deve necessariamente pubblicare la porta `4000` sull'host:
Caddy raggiunge il container tramite rete Docker. Per questo il safe deploy usa l'URL
pubblico `https://api.fleetum.it/api/ready` invece di `http://127.0.0.1:4000/api/ready`.

### Capacita' disco e prevenzione deploy falliti

Il deploy non elimina mai volumi PostgreSQL, upload, backup validi o immagini necessarie al
rollback. Prima del pull, dopo il pull e prima di `prisma migrate deploy` controlla:

```txt
FLEETUM_MIN_FREE_DISK_GB=10
FLEETUM_MAX_DISK_USAGE_PERCENT=90
```

Il workflow legge questi valori come GitHub Variables dell'environment `production`; lasciare
i default salvo capacity planning esplicito. Il deploy si ferma prima della migration quando
lo spazio libero e' insufficiente o l'uso filesystem raggiunge il limite configurato.

Gli alert email usano il canale Resend gia' configurato in `/opt/fleetum/env/backup.env`:

```txt
DISK_ALERT_EMAIL=ops@example.com
```

Se `DISK_ALERT_EMAIL` e' vuoto viene usato `BACKUP_ALERT_EMAIL`. Le soglie non-secret sono:

```txt
FLEETUM_DISK_ALERT_WARNING_PERCENT=80
FLEETUM_DISK_ALERT_CRITICAL_PERCENT=90
FLEETUM_DISK_ALERT_COOLDOWN_HOURS=24
```

Il report post-deploy mostra soltanto metriche aggregate tramite `df -h` e `docker system df`.
Per testare senza inviare email:

```bash
cd /opt/fleetum/app
DRY_RUN=true DISK_USAGE_PERCENT_OVERRIDE=80 \
  ./deploy/scripts/disk-capacity-alert.sh --check manual-test
```

Se il disco supera l'80%, controllare prima cache e immagini Fleetum obsolete:

```bash
df -h /
docker system df
```

Non eseguire `docker system prune --volumes` in produzione. Se il consumo cresce in modo
strutturale, pianificare l'espansione VPS a **120-160 GB**: la pulizia immagini non sostituisce
capacita' per database, documenti, backup locali e release rollback.

Se il health check fallisce dopo `up -d`, lo script esegue rollback applicativo automatico
alle immagini salvate in `/opt/fleetum/last-deploy.txt`.

Nota: il rollback automatico e' applicativo, non annulla migration Prisma gia' applicate.
Migration destructive richiedono reverse migration testata o restore da backup.

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

Rollback manuale applicativo, se serve:

```bash
cd /opt/fleetum/app
APP_DIR=/opt/fleetum/app \
ENV_FILE=/opt/fleetum/env/compose.env \
LAST_DEPLOY_FILE=/opt/fleetum/last-deploy.txt \
./deploy/scripts/rollback-production.sh
```

Ogni fallimento del workflow production crea una GitHub issue con link al run e risultati dei job.
