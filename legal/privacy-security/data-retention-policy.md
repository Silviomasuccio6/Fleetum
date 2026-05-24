---
title: "Data Retention Policy Fleetum"
owner: "Fleetum"
version: "0.1.0-draft"
status: "draft"
review_required: true
review_type:
  - legal
  - privacy
  - tax
  - security
last_updated: "2026-05-24"
applicability: "Internal Policy"
---

> Documento in bozza predisposto per revisione professionale. Non costituisce consulenza legale, fiscale, privacy o cybersecurity.
> Prima dell'uso verso clienti, pubblicazione o firma, validare con avvocato, commercialista, privacy consultant/DPO e consulente cybersecurity.

# Data Retention Policy Fleetum

| Categoria dato | Finalita | Conservazione proposta | Base/necessita | Cancellazione | Note review |
|---|---|---|---|---|---|
| Account clienti Fleetum | Contratto SaaS | {{retention_customer_accounts}} | Contratto/fiscale | Cancellazione o anonimizzazione | TODO_LEGAL_REVIEW |
| Utenti app | Accesso e audit | {{retention_app_users}} | Sicurezza/contratto | Disattivazione, anonimizzazione log ove possibile | TODO_PRIVACY_REVIEW |
| Contratti noleggio | Gestione noleggio cliente | {{retention_rental_contracts}} | Istruzioni titolare/obblighi | Tenant export/delete | TODO_LEGAL_REVIEW |
| Documenti identita/patenti | Verifica noleggio | {{retention_identity_documents}} | Minimizzazione | Cancellazione sicura | TODO_PRIVACY_REVIEW |
| Foto veicoli/danni | Prova stato veicolo | {{retention_vehicle_photos}} | Contratto/contenzioso | Cancellazione su policy tenant | TODO_PRIVACY_REVIEW |
| Pagamenti/fatture | Contabilita | {{retention_billing_records}} | Obblighi fiscali | Conservazione fiscale | TODO_TAX_REVIEW |
| Log accessi | Sicurezza | {{retention_access_logs}} | Interesse legittimo | Rotazione | TODO_SECURITY_REVIEW |
| Audit log | Prova operazioni | {{retention_audit_logs}} | Sicurezza/contratto | Retention controllata | TODO_LEGAL_REVIEW |
| Backup | DR | {{retention_backups}} | Continuita | Scadenza automatica | TODO_SECURITY_REVIEW |
| Ticket supporto | Assistenza | {{retention_support_tickets}} | Contratto | Cancellazione/anonimizzazione | TODO_PRIVACY_REVIEW |

TODO_LEGAL_REVIEW: validare i tempi di conservazione in base al tipo di cliente, obblighi fiscali, contrattuali e privacy.
TODO_PRIVACY_REVIEW: verificare minimizzazione, cancellazione e diritti interessati.
TODO_TAX_REVIEW: validare fatture, pagamenti e documenti fiscali.
TODO_SECURITY_REVIEW: validare backup, log e audit.
