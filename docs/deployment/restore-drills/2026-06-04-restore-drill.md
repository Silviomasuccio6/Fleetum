# Restore Drill - 2026-06-04

## Summary

Restore drill eseguito su ambiente locale isolato, senza impatto produzione.

Il database sorgente disponibile localmente era il container legacy `<legacy_local_postgres_container>`
con database `<legacy_local_database>`. Il restore e' stato eseguito su un database temporaneo separato:
`fleetum_restore_drill_20260604`.

Gli uploads non erano disponibili in locale o in `/opt/fleetum/uploads`; per verificare
il flusso file e' stata usata una directory canary temporanea in `/tmp/fleetum-uploads-drill`.

## Esito

| Area | Esito | Note |
| --- | --- | --- |
| Backup DB | PASS | Dump SQL creato correttamente |
| Restore DB isolato | PASS | Restore su database temporaneo completato |
| Row count pre/post | PASS | Conteggi invariati per le tabelle presenti |
| Upload backup/restore | PASS | File canary recuperato correttamente |
| StoredFileObject | GAP | Tabella non presente nel DB locale sorgente |
| Produzione | NON TOCCATA | Nessun comando eseguito su VPS production |

## Tempi misurati

| Metrica | Valore |
| --- | ---: |
| Inizio drill | 2026-06-04 14:26:14 Europe/Rome |
| Fine drill | 2026-06-04 14:27:44 Europe/Rome |
| Durata totale drill | ~90 secondi |
| Backup DB | ~2 secondi |
| Restore DB | ~3 secondi |
| Backup uploads canary | <1 secondo |

Target runbook:

| Target | Valore |
| --- | ---: |
| RPO target | 24 ore |
| RTO target | 4 ore |

Risultato drill locale:

| Metrica | Valore |
| --- | ---: |
| RPO osservato | ~0 minuti sul dump appena creato |
| RTO osservato | ~90 secondi end-to-end locale |

## Backup DB

Comando:

```bash
./ops/backup-db.sh <legacy_local_postgres_container> <legacy_local_database> postgres
```

Output:

```txt
Backup creato: /private/tmp/Fleetum-verify/backups/<legacy_local_database>_20260604_142622.sql
```

Verifica file:

```txt
Dimensione: 22347489 bytes
Header: PostgreSQL database dump
```

## Restore DB

Comando:

```bash
./ops/restore-db-test.sh backups/<legacy_local_database>_20260604_142622.sql <legacy_local_postgres_container> fleetum_restore_drill_20260604 postgres
```

Output:

```txt
NOTICE:  database "fleetum_restore_drill_20260604" does not exist, skipping
DROP DATABASE
CREATE DATABASE
Restore completato su database: fleetum_restore_drill_20260604
```

## Conteggi tabelle critiche

| Tabella | Pre-backup | Post-restore | Esito |
| --- | ---: | ---: | --- |
| Tenant | 19 | 19 | PASS |
| User | 19 | 19 | PASS |
| Vehicle | 19 | 19 | PASS |
| RentalBooking | 12 | 12 | PASS |
| RentalCustomer | 13 | 13 | PASS |
| BookingContract | 9 | 9 | PASS |
| StoredFileObject | N/A | N/A | GAP: tabella assente nel DB locale |

Conteggio tabelle pubbliche post-restore: `43`.

## Upload restore

Directory canary:

```txt
/tmp/fleetum-uploads-drill/source/uploads/contracts/canary-contract.txt
```

Comando backup:

```bash
BACKUP_OFFSITE_REQUIRED=false \
UPLOADS_DIR=/tmp/fleetum-uploads-drill/source/uploads \
BACKUP_DIR=/tmp/fleetum-uploads-drill/backups \
./deploy/backup/backup-uploads.sh
```

Output:

```txt
[2026-06-04T12:27:33Z] starting uploads backup: /tmp/fleetum-uploads-drill/backups/fleetum-uploads-20260604T122733Z.tar.gz
[2026-06-04T12:27:33Z] Uploads backup completed: /tmp/fleetum-uploads-drill/backups/fleetum-uploads-20260604T122733Z.tar.gz (560 bytes)
```

Verifica contenuto:

```txt
uploads/
uploads/contracts/
uploads/contracts/canary-contract.txt
```

Verifica file ripristinato:

```txt
Fleetum restore drill upload canary 2026-06-04
```

## Cleanup

Il database temporaneo `fleetum_restore_drill_20260604` e' stato rimosso dopo la verifica.

## Rischi residui

- Il drill non prova un backup reale di produzione o offsite.
- Il DB locale sorgente non contiene la tabella `StoredFileObject`; serve ripetere il drill
  su un database aggiornato con tutte le migration Fleetum.
- Gli uploads reali non erano disponibili; la verifica file e' stata eseguita con canary locale.
- Lo script `ops/backup-db.sh` crea un dump valido, ma non esegue ancora tutte le verifiche robuste
  documentate nei task SRE precedenti: dimensione minima, header e cleanup file parziali.

## Prossima prova consigliata

Eseguire il prossimo restore drill su backup production-grade offsite:

1. scaricare ultimo backup DB da S3/R2/B2;
2. scaricare ultimo backup uploads da S3/R2/B2;
3. ripristinare su container isolato o database staging dedicato;
4. verificare `StoredFileObject`;
5. verificare almeno un file reale tramite metadata DB + oggetto storage;
6. registrare RPO/RTO osservati nel RUNBOOK.
