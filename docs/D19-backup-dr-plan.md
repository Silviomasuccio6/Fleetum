# D19 Backup + DR Plan

Stato: PRESENTE-PARZIALE

## Target e automazione presenti

- RPO target: 24 ore.
- RTO target: 4 ore.
- Retention operativa proposta: 30 giorni.
- Backup PostgreSQL managed o container e backup uploads: `deploy/backup/backup-postgres.sh`, `deploy/backup/backup-uploads.sh`.
- Copia offsite obbligatoria in produzione tramite rclone o S3 compatibile.
- Restore isolato con conteggi critici, file uploads recuperato e report RPO/RTO: `deploy/backup/restore-postgres-test.sh`.
- Drill mensile/manuale e issue su fallimento: `.github/workflows/backup-restore-test.yml`.
- Runbook operativo e alert: `RUNBOOK.md`, `deploy/backup/README.md`.
- Procedura distruttiva separata per PostgreSQL managed e fallback locale: `deploy/backup/restore-postgres.md`.

## Evidenze versionate

- `docs/deployment/restore-drills/2026-06-23-offsite-restore-drill.md` documenta un drill offsite riuscito con RPO osservato di 845 secondi e RTO tecnico di 7 secondi.
- Il limite dichiarato del drill e' l'uso di una sentinella sintetica per gli uploads; non prova ancora il recupero coerente di un documento operativo reale e del relativo `StoredFileObject`.

## Gate ancora aperti

- Acquisire il report piu' recente dalla VPS e verificare che il workflow mensile abbia eseguito davvero restore e conteggi, senza step saltati.
- Ripetere il drill dopo la correzione del mount uploads con un oggetto sintetico tracciato in `StoredFileObject`, verificando download autenticato e corrispondenza DB/file.
- Verificare cifratura, lifecycle, access control e alert del target offsite effettivo.
- Misurare un esercizio operativo completo, incluse decisione, comunicazioni, sostituzione della connessione e riapertura del servizio; il tempo tecnico del container non equivale da solo al vero RTO.
- Il restore della produzione richiede approvazione e non e' mai parte del rollback applicativo automatico.
