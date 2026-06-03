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
essere salvata in chiaro: il backend accetta solo `PLATFORM_ADMIN_PASSWORD_HASH`, un
hash bcrypt che inizia con `$2a$` o `$2b$`.

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
5. Riavviare il backend tramite deploy GitHub Actions o, in emergenza controllata:
   ```bash
   docker compose -f docker-compose.prod.yml up -d backend
   ```
6. Verificare login Platform: email `PLATFORM_ADMIN_EMAIL`, password originale e OTP email.

Se `PLATFORM_ADMIN_PASSWORD_HASH` non inizia con `$2`, il backend fallisce il boot con
un errore esplicito per evitare configurazioni insicure.

## Pulizia history repository pubblico

Prima di considerare il repository completamente pubblico, verificare che la history Git
non contenga riferimenti legacy, email reali o dati cliente. Controllo consigliato:

```bash
git log --all -S "gestionalefermi" --oneline
git log --all -S "gestionalefermi@gmail.com" --oneline
```

Se una stringa appare in commit precedenti, rimuoverla dalla history con `git filter-repo`
o BFG Repo Cleaner su clone mirror, poi eseguire force-push coordinato di branch e tag.
Questa operazione riscrive la history e rompe i clone esistenti: va pianificata prima di
rendere il repository realmente pubblico e comunicata a chiunque abbia clonato la repo.

Stato noto: la stringa legacy `gestionalefermi` e' stata rimossa dal working tree, ma
risulta ancora in commit storici. Serve rewrite history dedicato prima della pubblicazione
definitiva.

## Backup e restore DB
- Backup:
  ```bash
  ./ops/backup-db.sh
  ```
- Restore su DB di test:
  ```bash
  ./ops/restore-db-test.sh backups/<nome-file>.sql
  ```

## Deploy production sicuro
Il deploy production GitHub Actions deve usare la sequenza sicura versionata in
`deploy/scripts/safe-production-deploy.sh`.

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
curl -fsS http://127.0.0.1:4000/api/ready
```

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
