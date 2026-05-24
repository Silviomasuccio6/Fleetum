---
title: "Incident Response Plan Fleetum"
owner: "Fleetum"
version: "0.1.0-draft"
status: "draft"
review_required: true
review_type:
  - privacy
  - security
  - legal
last_updated: "2026-05-24"
applicability: "Internal Policy"
---

> Documento in bozza predisposto per revisione professionale. Non costituisce consulenza legale, fiscale, privacy o cybersecurity.
> Prima dell'uso verso clienti, pubblicazione o firma, validare con avvocato, commercialista, privacy consultant/DPO e consulente cybersecurity.

# Incident Response Plan Fleetum

| Incidente | Trigger | Severita | Owner | Comunicazione interna | Comunicazione cliente | Mitigazione | Ripristino | Post-mortem |
|---|---|---|---|---|---|---|---|---|
| Down servizio | Health check fail | S1/S2 | SRE | Slack/email emergenza | Status/update | Rollback, restart, failover | Restore servizio | RCA entro {{rca_days}} |
| Perdita dati | Alert DB/storage | S1 | Security/SRE | Incident channel | Cliente titolare | Freeze accessi, backup | Restore validato | Report breach |
| Accesso non autorizzato | Audit/anomaly | S1 | Security | Founder + legal | Se impattato | Revoca token, reset credenziali | Hardening | RCA |
| Leak API key | Secret scanning | S1 | Security | Founder | Se impattato | Rotazione segreti | Verifica log | Post-mortem |
| Invio email errate | Bounce/complaint/report | S2 | Ops | Support/legal | Cliente se necessario | Stop queue | Correzione template | RCA |

TODO_SECURITY_REVIEW: testare runbook tecnici e responsabilita.
TODO_PRIVACY_REVIEW: integrare data breach procedure.
TODO_LEGAL_REVIEW: validare comunicazioni contrattuali.
