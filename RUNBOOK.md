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

## Backup & Restore

### Obiettivi operativi
- RPO target: massimo 24 ore di perdita dati tollerata con backup giornaliero; ridurre a 1 ora quando il volume di contratti/documenti in produzione cresce.
- RTO target: ripristino servizio entro 4 ore per incidente applicativo/DB ordinario; entro 8 ore se serve ricostruire VPS e storage da offsite.
- Retention offsite target: ultimi 30 backup giornalieri per PostgreSQL e uploads.

### Backup offsite
Lo script production-ready è:

```bash
/opt/fleetum/app/deploy/backup/offsite-backup.sh
```

Configurazione minima fuori dal repo:

```bash
BACKUP_REMOTE_TOOL=rclone
RCLONE_TARGET=remote:fleetum-backups
RESEND_API_KEY=<secret>
BACKUP_ALERT_EMAIL_FROM=Fleetum <no-reply@fleetum.it>
BACKUP_ALERT_EMAIL_TO=info@fleetum.it
```

Alternativa S3-compatible con AWS CLI:

```bash
BACKUP_REMOTE_TOOL=aws
S3_URI=s3://fleetum-backups
AWS_ENDPOINT_URL=https://<account>.r2.cloudflarestorage.com
AWS_ACCESS_KEY_ID=<secret>
AWS_SECRET_ACCESS_KEY=<secret>
AWS_DEFAULT_REGION=auto
```

Esempio cron giornaliero:

```cron
45 2 * * * /opt/fleetum/app/deploy/backup/offsite-backup.sh >> /opt/fleetum/logs/offsite-backup.cron.log 2>&1
```

### Restore production
La procedura guidata e conservativa è:

```bash
/opt/fleetum/app/deploy/backup/restore.sh
```

Per un restore reale:
1. dichiarare incidente e bloccare deploy/scritture;
2. scaricare da offsite il dump PostgreSQL e archivio uploads;
3. eseguire un backup di sicurezza dello stato corrente;
4. validare `gzip -t` e `tar -tzf`;
5. seguire i comandi stampati da `restore.sh` step-by-step;
6. riavviare servizi e verificare `/api/ready`, login, booking, contratti e download documenti;
7. documentare post-mortem e tempi effettivi RPO/RTO.

### Test restore mensile
Eseguire almeno una volta al mese in staging o database isolato:

```bash
/opt/fleetum/app/deploy/backup/restore-postgres-test.sh
```

Checklist test:
- ultimo dump PostgreSQL scaricabile da offsite;
- restore su container/database temporaneo completato;
- migrazioni Prisma coerenti;
- tabelle pubbliche presenti;
- archivio uploads validato con `tar -tzf`;
- risultato registrato nel registro operativo interno.

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
