---
title: "Subprocessor List Fleetum"
owner: "Fleetum"
version: "0.1.0-draft"
status: "draft"
review_required: true
review_type:
  - legal
  - privacy
  - security
last_updated: "2026-05-24"
applicability: "Fleetum SaaS"
---

> Documento in bozza predisposto per revisione professionale. Non costituisce consulenza legale, fiscale, privacy o cybersecurity.
> Prima dell'uso verso clienti, pubblicazione o firma, validare con avvocato, commercialista, privacy consultant/DPO e consulente cybersecurity.

# Subprocessor List Fleetum

## Placeholder globali

- `{{fleetum_company_name}}`
- `{{fleetum_legal_name}}`
- `{{fleetum_vat_number}}`
- `{{fleetum_tax_code}}`
- `{{fleetum_address}}`
- `{{fleetum_pec}}`
- `{{fleetum_email}}`
- `{{fleetum_support_email}}`
- `{{fleetum_privacy_email}}`
- `{{fleetum_security_email}}`
- `{{fleetum_website}}`
- `{{fleetum_dpo_contact}}`
- `{{fleetum_jurisdiction}}`
- `{{fleetum_governing_law}}`
- `{{fleetum_court}}`

| Fornitore | Servizio | Dati trattati | Paese | Ruolo | Link privacy/DPA | Note |
|---|---|---|---|---|---|---|
| {hosting_provider} | Hosting applicativo | Dati applicativi, log tecnici | {country} | Sub-responsabile | {provider_dpa_url} | TODO_PRIVACY_REVIEW |
| {database_provider} | Database | Dati tenant e operativi | {country} | Sub-responsabile | {provider_dpa_url} | TODO_SECURITY_REVIEW |
| {storage_provider} | Storage documenti | PDF, allegati, foto | {country} | Sub-responsabile | {provider_dpa_url} | Cifratura e retention da validare |
| Stripe | Pagamenti | Dati pagamento e billing | {country} | Titolare/Responsabile secondo flusso | {stripe_dpa_url} | TODO_TAX_REVIEW |
| {email_provider} | Email transazionali | Email, template, metadati invio | {country} | Sub-responsabile | {provider_dpa_url} | Verificare data residency |
| {analytics_provider} | Analytics | Eventi anonimi/pseudonimi | {country} | Sub-responsabile | {provider_dpa_url} | Privacy-first |
| {monitoring_provider} | Monitoring/error tracking | Log tecnici | {country} | Sub-responsabile | {provider_dpa_url} | Mascherare PII |
| {backup_provider} | Backup | Copie dati applicativi | {country} | Sub-responsabile | {provider_dpa_url} | Retention da validare |

TODO_PRIVACY_REVIEW: completare con fornitori reali prima della pubblicazione.
TODO_SECURITY_REVIEW: validare misure, cifratura, localizzazione e accessi.
