---
title: "Encryption Policy Fleetum"
owner: "Fleetum"
version: "0.1.0-draft"
status: "draft"
review_required: true
review_type:
  - security
  - privacy
last_updated: "2026-05-24"
applicability: "Internal Policy"
---

> Documento in bozza predisposto per revisione professionale. Non costituisce consulenza legale, fiscale, privacy o cybersecurity.
> Prima dell'uso verso clienti, pubblicazione o firma, validare con avvocato, commercialista, privacy consultant/DPO e consulente cybersecurity.

# Encryption Policy Fleetum

## Ambiti

| Ambito | Misura prevista | Stato | Evidenza |
|---|---|---|---|
| Dati in transito | HTTPS/TLS | {{tls_status}} | {{tls_evidence}} |
| Backup | Cifratura backup | {{backup_encryption_status}} | {{backup_evidence}} |
| Segreti | Secret manager/env protetto | {{secrets_status}} | {{secrets_evidence}} |
| File allegati | Cifratura storage/provider | {{storage_encryption_status}} | {{storage_evidence}} |

TODO_SECURITY_REVIEW: validare cifratura at-rest effettiva, rotazione chiavi e gestione segreti.
TODO_PRIVACY_REVIEW: verificare impatto su dati personali e documenti.
