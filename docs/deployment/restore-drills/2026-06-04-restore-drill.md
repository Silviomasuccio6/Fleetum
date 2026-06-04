# Restore Drill - 2026-06-04

## Summary

Restore drill eseguito su ambiente locale isolato, senza impatto produzione.

Questa prova usa un container PostgreSQL temporaneo con schema Fleetum aggiornato tramite tutte le migration disponibili al 2026-06-04, inclusa la migration `StoredFileObject`.

Container sorgente temporaneo:

```txt
fleetum-restore-drill-current
```

Database sorgente temporaneo:

```txt
fleetum_drill
```

Database restore temporaneo:

```txt
fleetum_restore_drill_current_20260604
```

Gli uploads reali di produzione non sono stati usati. Per verificare il flusso file e' stata usata una directory canary temporanea in `/tmp/fleetum-uploads-drill-current`.

## Esito

| Area | Esito | Note |
| --- | --- | --- |
| Migration schema corrente | PASS | 32 migration Prisma applicate correttamente in container Node 20 |
| Fixture dati critici | PASS | Tenant, User, Vehicle, RentalBooking, RentalCustomer, BookingContract, StoredFileObject, AuditLog |
| Backup DB | PASS | Dump SQL creato correttamente |
| Verifica dump | PASS | File non vuoto, header PostgreSQL valido |
| Restore DB isolato | PASS | Restore su database temporaneo completato |
| Row count pre/post | PASS | Conteggi invariati per tutte le tabelle critiche |
| Upload backup/restore | PASS | File canary recuperato correttamente |
| StoredFileObject | PASS | Tabella presente e record verificato pre/post restore |
| Produzione | NON TOCCATA | Nessun comando eseguito su VPS production |

## Tempi misurati

| Metrica | Valore |
| --- | ---: |
| Inizio drill | 2026-06-04 20:12 Europe/Rome circa |
| Fine drill | 2026-06-04 20:15 Europe/Rome circa |
| Durata totale drill | ~3 minuti, escluso download/install dipendenze container Node 20 |
| Backup DB | <1 secondo |
| Restore DB | ~2 secondi |
| Backup uploads canary | <1 secondo |

Target runbook:

| Target | Valore |
| --- | ---: |
| RPO target | 24 ore |
| RTO target | 4 ore |
| Retention target | 30 giorni |

Risultato drill locale:

| Metrica | Valore |
| --- | ---: |
| RPO osservato | ~0 minuti sul dump appena creato |
| RTO osservato | ~3 minuti end-to-end locale |

## Migration schema corrente

Il primo tentativo con Prisma locale ha fallito con `Schema engine error`, problema gia' noto dell'ambiente locale.
Per evitare falsi negativi, le migration sono state applicate da container Node 20:

```bash
docker run --rm \
  -v /tmp/Fleetum-verify:/repo \
  -w /repo \
  -e DATABASE_URL='postgresql://fleetum:fleetum_dev@host.docker.internal:55434/fleetum_drill?schema=public' \
  node:20-bookworm \
  bash -lc 'npm ci >/dev/null && npx prisma migrate deploy --schema backend/prisma/schema.prisma'
```

Risultato:

```txt
32 migrations found in prisma/migrations
All migrations have been successfully applied.
```

## Fixture dati critici

Sono stati creati record demo isolati nelle tabelle critiche:

| Tabella | Pre-backup |
| --- | ---: |
| Tenant | 1 |
| User | 1 |
| Vehicle | 1 |
| RentalBooking | 1 |
| RentalCustomer | 1 |
| BookingContract | 1 |
| StoredFileObject | 1 |
| AuditLog | 1 |

## Backup DB

Comando:

```bash
./ops/backup-db.sh fleetum-restore-drill-current fleetum_drill fleetum
```

Output:

```txt
Backup creato: /private/tmp/Fleetum-verify/backups/fleetum_drill_20260604_201406.sql
```

Verifica file:

```txt
Dimensione: 133833 bytes
Header: PostgreSQL database dump
```

## Restore DB

Comando:

```bash
./ops/restore-db-test.sh backups/fleetum_drill_20260604_201406.sql fleetum-restore-drill-current fleetum_restore_drill_current_20260604 fleetum
```

Output:

```txt
DROP DATABASE
NOTICE:  database "fleetum_restore_drill_current_20260604" does not exist, skipping
CREATE DATABASE
Restore completato su database: fleetum_restore_drill_current_20260604
```

## Conteggi tabelle critiche

| Tabella | Pre-backup | Post-restore | Esito |
| --- | ---: | ---: | --- |
| Tenant | 1 | 1 | PASS |
| User | 1 | 1 | PASS |
| Vehicle | 1 | 1 | PASS |
| RentalBooking | 1 | 1 | PASS |
| RentalCustomer | 1 | 1 | PASS |
| BookingContract | 1 | 1 | PASS |
| StoredFileObject | 1 | 1 | PASS |
| AuditLog | 1 | 1 | PASS |

Conteggio tabelle pubbliche post-restore: `54`.

## Upload restore

Directory canary:

```txt
/tmp/fleetum-uploads-drill-current/source/uploads/contracts/canary-contract.txt
```

Comando backup:

```bash
BACKUP_OFFSITE_REQUIRED=false \
UPLOADS_DIR=/tmp/fleetum-uploads-drill-current/source/uploads \
BACKUP_DIR=/tmp/fleetum-uploads-drill-current/backups \
./deploy/backup/backup-uploads.sh
```

Output:

```txt
[2026-06-04T18:14:43Z] starting uploads backup: /tmp/fleetum-uploads-drill-current/backups/fleetum-uploads-20260604T181443Z.tar.gz
[2026-06-04T18:14:43Z] Uploads backup completed: /tmp/fleetum-uploads-drill-current/backups/fleetum-uploads-20260604T181443Z.tar.gz (554 bytes)
```

Verifica contenuto archivio:

```txt
uploads/
uploads/contracts/
uploads/contracts/canary-contract.txt
```

Verifica file ripristinato:

```txt
Fleetum restore drill upload canary current schema 2026-06-04
```

## Cleanup

Il database temporaneo `fleetum_restore_drill_current_20260604` e' stato rimosso dopo la verifica.
Il container temporaneo `fleetum-restore-drill-current` e' stato fermato e rimosso automaticamente perche' avviato con `--rm`.

## Rischi residui

- Il drill non prova ancora un backup reale di produzione o offsite S3/R2/B2.
- Gli uploads reali non erano disponibili; la verifica file e' stata eseguita con canary locale.
- `ops/backup-db.sh` crea un dump valido, ma resta meno robusto degli script in `deploy/backup`: non controlla dimensione minima, header e cleanup file parziali in modo nativo.
- La prova e' locale: non misura latenza, banda, permessi bucket e credenziali offsite reali.

## Prossima prova consigliata

Eseguire il prossimo restore drill su backup production-grade offsite:

1. scaricare ultimo backup DB da S3/R2/B2;
2. scaricare ultimo backup uploads da S3/R2/B2;
3. ripristinare su container isolato o database staging dedicato;
4. verificare `StoredFileObject`;
5. verificare almeno un file reale tramite metadata DB + oggetto storage;
6. registrare RPO/RTO osservati nel RUNBOOK.
