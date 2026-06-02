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

### Backup locale manuale

Default produzione:

- container: `fleetum_postgres`
- database: `fleetum`
- utente DB: `fleetum`
- directory output: `backups/`

Backup plain SQL:

```bash
./ops/backup-db.sh
```

Backup custom PostgreSQL compresso (`pg_dump -Fc`):

```bash
./ops/backup-db.sh --compress
```

Override esplicito:

```bash
./ops/backup-db.sh fleetum_postgres fleetum fleetum
./ops/backup-db.sh --compress fleetum_postgres fleetum fleetum
```

Lo script verifica:

- esistenza del container Docker;
- creazione del file;
- dimensione maggiore di 1 KB;
- header PostgreSQL valido (`--`, `PostgreSQL` o `PGDMP`);
- rimozione del file parziale in caso di errore.

### Restore su database di test

Non fare restore diretto su produzione salvo procedura di emergenza approvata.

Restore di dump plain `.sql`:

```bash
./ops/restore-db-test.sh backups/<nome-file>.sql
```

Restore di dump custom `.dump` / `.pgdump`:

```bash
./ops/restore-db-test.sh backups/<nome-file>.dump
```

Default restore test:

- container: `fleetum_postgres`
- database target: `fleetum_restore_test`
- utente DB: `fleetum`

Lo script crea un database di test, ripristina il dump e conferma il numero di tabelle ripristinate.

### Verifica periodica backup

Eseguire almeno mensilmente:

```bash
./ops/backup-verify.sh backups/<nome-file>.dump
```

Oppure, per dump plain:

```bash
./ops/backup-verify.sh backups/<nome-file>.sql
```

La verifica:

- controlla dimensione e header;
- crea un database temporaneo;
- prova un restore completo;
- conta le tabelle ripristinate;
- stampa il conteggio righe per tabelle critiche:
  - `RentalBooking`
  - `RentalCustomer`
  - `Vehicle`
- elimina il database temporaneo a fine esecuzione.

### Nota produzione

Il backup locale non basta per produzione. I backup critici devono essere copiati anche offsite e testati con restore periodico.

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
