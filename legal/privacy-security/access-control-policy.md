---
title: "Access Control Policy Fleetum"
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

# Access Control Policy Fleetum

## Principi

- Minimo privilegio.
- Separazione ruoli Fleetum/tenant.
- Tenant isolation obbligatoria.
- MFA obbligatoria per admin platform e accessi privilegiati.
- Revisione periodica accessi.
- Revoca immediata per collaboratori cessati.
- Audit degli accessi privilegiati.

## Ruoli

| Ruolo | Ambito | Permessi | MFA | Review |
|---|---|---|---|---|
| fleetum_admin | Platform | Gestione tenant, billing, sicurezza | Obbligatoria | {{access_review_frequency}} |
| support | Supporto controllato | Accesso limitato e tracciato | Obbligatoria | {{access_review_frequency}} |
| tenant_admin | Tenant | Gestione azienda e utenti | Raccomandata/obbligatoria | {{access_review_frequency}} |
| operator | Tenant | Operativita noleggio | Secondo policy tenant | {{access_review_frequency}} |

TODO_SECURITY_REVIEW: collegare a RBAC reale e audit log.
TODO_PRIVACY_REVIEW: definire accesso supporto ai dati cliente.
