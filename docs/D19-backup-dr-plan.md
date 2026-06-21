# D19 Backup + DR Plan

Stato: PRESENTE-PARZIALE

## Evidenze repository
- Script backup/restore:
  - `ops/backup-db.sh`
  - `ops/restore-db-test.sh`
- Richiamo in runbook/checklist.

## Gap
- RPO/RTO formalizzati: NON TROVATO
- DR plan completo con scenari e drill periodici: NON TROVATO
- Evidenza restore test periodico automatizzato: NON TROVATO

## Remediation
- Must: DR plan con target RTO/RPO e runbook escalation.
- Should: restore test schedulato e tracciato.
- Owner suggerito: DevOps Engineer
