# Fleetum - Migrazione PostgreSQL verso Managed Database

## Obiettivo

Migrare Fleetum da PostgreSQL nel `docker-compose.prod.yml` sul VPS a un PostgreSQL managed esterno, riducendo il rischio che un crash del VPS renda indisponibili insieme applicazione, database e backup locali.

Target operativo:

- downtime minimo;
- backup verificato prima del cutover;
- migration Prisma su connessione diretta;
- runtime backend su connection string pooled/session con SSL;
- rollback chiaro verso il vecchio volume `/opt/fleetum/postgres`.

## Raccomandazione provider

Scelta consigliata early-stage economica: **Neon Launch**.

Motivi:

- Postgres-first, non piattaforma generica.
- Piano free utile per staging/test e piano Launch usage-based, con stima tipica early-stage intorno a 15 USD/mese per carichi intermittenti.
- Storage separato da compute, autoscaling e scale-to-zero configurabile.
- Connection pooling integrato via PgBouncer.
- Branching e instant restore utili per staging, test migration e rollback logici.
- GDPR/ISO compliance dichiarata su tutti i piani.

Alternativa consigliata se vuoi costo piu' prevedibile: **Supabase Pro**.

Supabase e' molto valido se vuoi un ecosistema completo e un prezzo base piu' stabile. Per Fleetum, pero', oggi serve soprattutto managed Postgres affidabile: Neon e' piu' mirato e piu' economico per partire.

## Confronto provider

| Provider | Pro | Contro | Costo indicativo | Fit Fleetum |
| --- | --- | --- | --- | --- |
| Neon | Postgres managed/serverless, pooling integrato, branching, autoscaling, instant restore, usage-based | In produzione va disabilitato/controllato lo scale-to-zero se non vuoi cold start | Free per test; Launch usage-based, tipico early-stage circa 15 USD/mese | Scelta consigliata |
| Supabase | Postgres dedicato, Supavisor pooler, dashboard matura, Pro con backup giornalieri 7 giorni | Pro parte da 25 USD/mese; Free si pausa; piu' piattaforma completa che solo DB | Free per test; Pro da 25 USD/mese | Ottimo se vuoi costo prevedibile e dashboard ampia |
| Railway PostgreSQL | Setup molto semplice, comodo se tutta l'app e' su Railway | Meno DB-specific per HA/branching/pooling; se Fleetum resta su VPS non sfrutta networking interno Railway | Usage/Hobby, variabile | Buono per prototipo, meno ideale come DB core SaaS |

## Scelta connessioni

Fleetum usa Prisma. Per evitare problemi con PgBouncer/transaction pooler:

- `DATABASE_URL`: runtime backend, preferibilmente pooled/session con SSL.
- `DIRECT_URL`: migration Prisma, `pg_dump`, `pg_restore`, admin tooling.

Esempio Neon runtime:

```env
DATABASE_URL=postgresql://fleetum_owner:CHANGE_ME@ep-example-pooler.eu-central-1.aws.neon.tech/fleetum?sslmode=require&connection_limit=5
```

Esempio Neon direct:

```env
DIRECT_URL=postgresql://fleetum_owner:CHANGE_ME@ep-example.eu-central-1.aws.neon.tech/fleetum?sslmode=require
```

Nota: il backend Fleetum continua a leggere `DATABASE_URL`. Lo script di deploy usa `DIRECT_URL` solo durante `prisma migrate deploy`, esportandola temporaneamente come `DATABASE_URL` dentro il comando Prisma CLI.

## File aggiornati nel repository

- `docker-compose.prod.yml`: rimosso il servizio locale `postgres` e il `depends_on` del backend.
- `docker-compose.prod.local-postgres.yml`: copia rollback con Postgres locale Docker.
- `deploy/scripts/safe-production-deploy.sh`: migration Prisma usa `DIRECT_URL` se presente.
- `deploy/backup/backup-postgres.sh`: supporta `PG_DUMP_DATABASE_URL`/`DIRECT_URL` per backup managed DB.
- `deploy/env/backend.env.production.example`: esempi `DATABASE_URL` pooled + `DIRECT_URL` direct.
- `deploy/env/backup.env.production.example`: aggiunto `PG_DUMP_DATABASE_URL`.

## Preparazione Neon

1. Creare progetto Neon nella regione piu' vicina al VPS o agli utenti principali.
2. Creare database `fleetum`.
3. Creare role dedicato, ad esempio `fleetum_owner`.
4. Copiare connection string pooled e direct.
5. Verificare che entrambe contengano `sslmode=require`.
6. Per produzione, valutare di disabilitare scale-to-zero o impostare min compute adeguato.
7. Configurare backup/restore window coerente con RPO/RTO Fleetum.

## Preparazione VPS

Non cancellare il vecchio volume PostgreSQL.

```bash
cd /opt/fleetum/app
cp docker-compose.prod.yml docker-compose.prod.local-postgres.before-managed-db.yml
```

Aggiornare `/opt/fleetum/env/backend.env`:

```env
DATABASE_URL=postgresql://fleetum_owner:CHANGE_ME@ep-example-pooler.eu-central-1.aws.neon.tech/fleetum?sslmode=require&connection_limit=5
DIRECT_URL=postgresql://fleetum_owner:CHANGE_ME@ep-example.eu-central-1.aws.neon.tech/fleetum?sslmode=require
```

Aggiornare `/opt/fleetum/env/backup.env`:

```env
PG_DUMP_DATABASE_URL=postgresql://fleetum_owner:CHANGE_ME@ep-example.eu-central-1.aws.neon.tech/fleetum?sslmode=require
```

Non committare mai questi valori reali.

## Migrazione dati con downtime breve

Questa procedura usa write-freeze breve. E' piu' semplice e sicura per Fleetum early-stage.

### 1. Backup sorgente Docker

Sul VPS, prima del cutover:

```bash
cd /opt/fleetum/app
mkdir -p /opt/fleetum/backups/postgres

BACKUP_FILE="/opt/fleetum/backups/postgres/fleetum-pre-managed-$(date -u +%Y%m%dT%H%M%SZ).dump"

docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.local-postgres.yml exec -T postgres \
  pg_dump -U fleetum -d fleetum --format=custom --no-owner --no-acl \
  > "$BACKUP_FILE"

pg_restore --list "$BACKUP_FILE" | head
```

Se il vecchio compose ancora si chiama `docker-compose.prod.yml`, usare quello per il primo dump.

### 2. Restore iniziale su Neon

Da VPS o macchina sicura con `pg_restore`:

```bash
export DIRECT_URL='postgresql://fleetum_owner:CHANGE_ME@ep-example.eu-central-1.aws.neon.tech/fleetum?sslmode=require'
export BACKUP_FILE='/opt/fleetum/backups/postgres/fleetum-pre-managed-YYYYMMDDTHHMMSSZ.dump'

pg_restore \
  --dbname "$DIRECT_URL" \
  --no-owner \
  --no-acl \
  --clean \
  --if-exists \
  "$BACKUP_FILE"
```

### 3. Verifica row count pre-cutover

Genera query conteggi dal vecchio DB:

```bash
docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.local-postgres.yml exec -T postgres \
  psql -U fleetum -d fleetum -Atc "
select 'select ''' || tablename || ''' as table_name, count(*) from public.' || quote_ident(tablename) || ';'
from pg_tables
where schemaname='public'
order by tablename;
" > /tmp/fleetum-count-queries.sql
```

Esegui conteggi vecchio/nuovo:

```bash
docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.local-postgres.yml exec -T postgres \
  psql -U fleetum -d fleetum -Atf /tmp/fleetum-count-queries.sql > /tmp/fleetum-old-counts.txt

psql "$DIRECT_URL" -Atf /tmp/fleetum-count-queries.sql > /tmp/fleetum-new-counts.txt

diff -u /tmp/fleetum-old-counts.txt /tmp/fleetum-new-counts.txt
```

Tabelle critiche da controllare esplicitamente:

```sql
select count(*) from "Tenant";
select count(*) from "User";
select count(*) from "Vehicle";
select count(*) from "RentalBooking";
select count(*) from "RentalCustomer";
select count(*) from "BookingContract";
select count(*) from "StoredFileObject";
```

## Cutover con downtime minimo

Eseguire in fascia di traffico minimo.

1. Annunciare finestra tecnica interna.
2. Bloccare temporaneamente nuove scritture, se disponibile maintenance mode/write-freeze.
3. Fermare job/cron che scrivono sul DB, se necessario.
4. Fare dump finale dopo freeze.
5. Ripristinare dump finale su Neon.
6. Verificare row count critici.
7. Aggiornare `/opt/fleetum/env/backend.env` con `DATABASE_URL` e `DIRECT_URL` Neon.
8. Aggiornare `/opt/fleetum/env/backup.env` con `PG_DUMP_DATABASE_URL` Neon direct.
9. Deployare compose senza servizio `postgres`.
10. Eseguire migration status/deploy con direct URL.
11. Riavviare backend e Caddy.
12. Health check e smoke test.
13. Rimuovere write-freeze.

Comandi cutover:

```bash
cd /opt/fleetum/app

docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.yml pull

docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.yml run --rm backend \
  sh -lc 'if [ -n "${DIRECT_URL:-}" ]; then export DATABASE_URL="$DIRECT_URL"; fi; npx prisma migrate deploy --schema prisma/schema.prisma'

docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.yml up -d --no-build
```

Health check:

```bash
curl -f https://api.fleetum.it/api/ready
curl -f https://api.fleetum.it/api/health
curl -f https://platform.fleetum.it/platform-api/ready
curl -f https://fleetum.it/
```

## Backup dopo cutover

Il backup DB non usa piu' il container `postgres`. Usa `PG_DUMP_DATABASE_URL`:

```bash
BACKUP_ENV_FILE=/opt/fleetum/env/backup.env /opt/fleetum/app/deploy/backup/backup-postgres.sh
```

Verifica restore mensile:

```bash
BACKUP_FILE=/opt/fleetum/backups/postgres/fleetum-postgres-YYYYMMDDTHHMMSSZ.sql.gz \
  /opt/fleetum/app/deploy/backup/restore-postgres-test.sh
```

## Rollback

### Caso A: cutover fallisce prima di nuove scritture su Neon

1. Ripristinare vecchia `DATABASE_URL` verso Postgres Docker in `/opt/fleetum/env/backend.env`.
2. Usare compose rollback:

```bash
cd /opt/fleetum/app
cp docker-compose.prod.local-postgres.yml docker-compose.prod.yml

docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.yml up -d --no-build
curl -f https://api.fleetum.it/api/ready
```

3. Lasciare Neon invariato per analisi.

### Caso B: ci sono state scritture su Neon

Non tornare al vecchio DB senza riconciliazione: perderesti dati creati dopo il cutover.

1. Attivare maintenance mode.
2. Esportare delta da Neon o decidere di restare su Neon e correggere il problema.
3. Se si torna al vecchio DB, importare manualmente i delta o accettare formalmente la perdita dati.
4. Documentare incidente e timeline.

### Caso C: restore da backup

Usare solo se vecchio e nuovo DB sono entrambi inutilizzabili.

1. Fermare backend.
2. Ripristinare ultimo backup valido su DB target.
3. Verificare row count critici.
4. Riavviare backend.
5. Eseguire smoke test.

## Checklist cutover

Prima:

- [ ] Provider scelto: Neon Launch.
- [ ] Regione scelta e documentata.
- [ ] `DATABASE_URL` pooled/session con `sslmode=require`.
- [ ] `DIRECT_URL` direct con `sslmode=require`.
- [ ] `PG_DUMP_DATABASE_URL` configurato in `/opt/fleetum/env/backup.env`.
- [ ] Backup vecchio DB completato.
- [ ] Restore su Neon completato.
- [ ] Row count vecchio/nuovo OK.
- [ ] `StoredFileObject` verificata, se migration applicata.
- [ ] Vecchio volume `/opt/fleetum/postgres` conservato.
- [ ] Rollback compose disponibile.
- [ ] Nessun deploy applicativo concorrente.

Durante:

- [ ] Write-freeze attivo.
- [ ] Dump finale creato.
- [ ] Restore finale su Neon completato.
- [ ] Diff row count OK.
- [ ] Backend env aggiornato.
- [ ] Backup env aggiornato.
- [ ] `prisma migrate deploy` eseguito usando `DIRECT_URL`.
- [ ] `docker compose up -d --no-build` completato.

Dopo:

- [ ] `/api/ready` OK.
- [ ] `/platform-api/ready` OK.
- [ ] `fleetum.it` OK.
- [ ] `platform.fleetum.it` OK.
- [ ] Login tenant OK.
- [ ] Booking OK.
- [ ] Contratti OK.
- [ ] Platform Console OK.
- [ ] Stripe webhook non mostra errori.
- [ ] Prisma logs senza errori di pooler/migration.
- [ ] Backup managed DB eseguito e caricato offsite.
- [ ] Restore test pianificato entro 7 giorni dal cutover.

## Rischi residui

- `pg_dump` + `pg_restore` richiedono write-freeze per evitare perdita di scritture finali.
- Rollback dopo scritture su Neon richiede riconciliazione dati.
- Pooler transaction mode puo' rompere migration/admin tooling: usare sempre `DIRECT_URL`.
- La latenza DB cambia: monitorare p95 API e slow query dopo cutover.
- Il vecchio volume Postgres va mantenuto almeno 7-14 giorni, poi archiviato/cancellato solo dopo restore drill riuscito.

## Fonti

- Neon pricing: https://neon.com/pricing
- Neon connection pooling: https://neon.com/docs/connect/connection-pooling
- Supabase pricing: https://supabase.com/pricing
- Supabase connection strings/pooler: https://supabase.com/docs/reference/postgres/connection-strings
- Railway PostgreSQL: https://docs.railway.com/databases/postgresql
- Prisma PgBouncer/migrate: https://docs.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer
