---
title: "Logging and Audit Policy Fleetum"
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

# Logging and Audit Policy Fleetum

## Eventi da tracciare

- Login/logout.
- OTP richiesti/falliti.
- Modifica tenant/piano/licenza.
- Generazione e firma contratto.
- Upload/download/cancellazione documenti.
- Pagamenti e webhook Stripe.
- Modifiche legal document/template.
- Accesso supporto ai dati cliente.

## Minimizzazione

Non loggare API key, password, token, dati completi di documenti o contenuti sensibili non necessari.

TODO_SECURITY_REVIEW: validare retention, alerting e protezione log.
TODO_PRIVACY_REVIEW: validare log con dati personali.
TODO_LEGAL_REVIEW: validare valore probatorio e limiti.
