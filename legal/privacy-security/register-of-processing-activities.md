---
title: "Registro dei Trattamenti Fleetum"
owner: "Fleetum"
version: "0.1.0-draft"
status: "draft"
review_required: true
review_type:
  - legal
  - privacy
  - security
last_updated: "2026-05-24"
applicability: "Internal Policy"
---

> Documento in bozza predisposto per revisione professionale. Non costituisce consulenza legale, fiscale, privacy o cybersecurity.
> Prima dell'uso verso clienti, pubblicazione o firma, validare con avvocato, commercialista, privacy consultant/DPO e consulente cybersecurity.

# Registro dei Trattamenti Fleetum

| Trattamento | Titolare/Responsabile | Finalita | Base giuridica | Dati | Interessati | Fornitori | Conservazione | Misure sicurezza | Note |
|---|---|---|---|---|---|---|---|---|---|
| Gestione clienti Fleetum | Titolare | Contratto SaaS e account business | Contratto/interesse legittimo | Anagrafica, contatti, billing | Clienti business | CRM/email/billing | {{retention_customer_accounts}} | RBAC, audit, TLS | TODO_PRIVACY_REVIEW |
| Gestione utenti gestionale | Responsabile/Titolare limitato | Accesso app e sicurezza | Contratto/interesse legittimo | Email, ruolo, log | Utenti tenant | Hosting, DB | {{retention_app_users}} | MFA admin, tenant isolation | TODO_SECURITY_REVIEW |
| Dati inseriti dagli autonoleggi | Responsabile | Erogazione gestionale | Istruzioni titolare | Clienti finali, documenti, contratti | Clienti/conducenti | Hosting, DB, storage | {{retention_rental_data}} | Isolamento tenant, audit | DPA |
| Billing e pagamenti | Titolare/fornitore autonomo | Incasso abbonamenti | Contratto/obbligo fiscale | Dati fatturazione, Stripe IDs | Clienti business | Stripe | {{retention_billing}} | Webhook signing, audit | TODO_TAX_REVIEW |
| Supporto tecnico | Titolare/Responsabile | Assistenza | Contratto/interesse legittimo | Ticket, log, screenshot | Utenti clienti | Helpdesk/email | {{retention_support}} | Accesso minimo | TODO_PRIVACY_REVIEW |
| Marketing/newsletter | Titolare | Comunicazioni commerciali | Consenso/interesse legittimo B2B | Email, preferenze | Prospect/clienti | Email provider | {{retention_marketing}} | Opt-out | TODO_PRIVACY_REVIEW |
| Log sicurezza | Titolare | Prevenzione abusi e audit | Interesse legittimo | IP, user-agent, eventi | Utenti | Monitoring | {{retention_security_logs}} | Pseudonimizzazione ove possibile | TODO_SECURITY_REVIEW |
| Backup | Titolare/Responsabile | Continuita operativa | Contratto/sicurezza | Copie dati | Tutti | Backup provider | {{retention_backup}} | Cifratura, accessi limitati | TODO_SECURITY_REVIEW |
| Data breach | Titolare/Responsabile | Gestione incidenti | Obbligo legale | Dati evento, contatti | Interessati coinvolti | Legal/security | {{retention_breach_records}} | Registro dedicato | TODO_PRIVACY_REVIEW |

TODO_PRIVACY_REVIEW: validare basi giuridiche e retention.
TODO_SECURITY_REVIEW: collegare alle misure tecniche effettive.
