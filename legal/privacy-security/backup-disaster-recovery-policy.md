---
title: "Backup and Disaster Recovery Policy Fleetum"
owner: "Fleetum"
version: "0.1.0-draft"
status: "draft"
review_required: true
review_type:
  - security
  - privacy
  - legal
last_updated: "2026-05-24"
applicability: "Internal Policy"
---

> Documento in bozza predisposto per revisione professionale. Non costituisce consulenza legale, fiscale, privacy o cybersecurity.
> Prima dell'uso verso clienti, pubblicazione o firma, validare con avvocato, commercialista, privacy consultant/DPO e consulente cybersecurity.

# Backup and Disaster Recovery Policy Fleetum

| Asset | Frequenza backup | Retention | Cifratura | Dove | Test restore | Responsabile |
|---|---|---|---|---|---|---|
| Database PostgreSQL | {{db_backup_frequency}} | {{db_backup_retention}} | {{db_backup_encryption}} | {{backup_location}} | {{restore_test_frequency}} | {{backup_owner}} |
| File/documenti | {{file_backup_frequency}} | {{file_backup_retention}} | {{file_backup_encryption}} | {{file_backup_location}} | {{restore_test_frequency}} | {{backup_owner}} |
| Configurazioni | {{config_backup_frequency}} | {{config_backup_retention}} | {{config_backup_encryption}} | {{config_backup_location}} | {{restore_test_frequency}} | {{backup_owner}} |

## Obiettivi

- RPO: `{{rpo_target}}`
- RTO: `{{rto_target}}`
- Backup offsite: `{{offsite_backup_status}}`
- Restore testato: `{{restore_test_status}}`

TODO_SECURITY_REVIEW: validare cifratura, accessi, test restore e segregazione backup.
TODO_PRIVACY_REVIEW: validare dati personali nei backup e retention.
