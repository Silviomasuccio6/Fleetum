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
