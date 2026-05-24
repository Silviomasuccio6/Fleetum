---
title: "Invoice Receipt Template Fleetum"
owner: "Fleetum"
version: "0.1.0-draft"
status: "draft"
review_required: true
review_type:
  - tax
  - legal
last_updated: "2026-05-24"
applicability: "Fleetum SaaS"
---

> Documento in bozza predisposto per revisione professionale. Non costituisce consulenza legale, fiscale, privacy o cybersecurity.
> Prima dell'uso verso clienti, pubblicazione o firma, validare con avvocato, commercialista, privacy consultant/DPO e consulente cybersecurity.

# Invoice Receipt Template Fleetum

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

## Template ricevuta/fattura

| Campo | Placeholder | Note |
|---|---|---|
| Numero | `{{invoice_number}}` | Numerazione da validare |
| Data | `{{invoice_issue_date}}` | Data emissione |
| Cliente | `{{company_legal_name}}` | Dati tenant |
| Piano | `{{subscription_plan}}` | Starter/Pro/Enterprise |
| Periodo | `{{billing_period}}` | Periodo fatturato |
| Imponibile | `{{invoice_subtotal}}` | TODO_TAX_REVIEW |
| IVA | `{{invoice_vat_amount}}` | TODO_TAX_REVIEW |
| Totale | `{{invoice_total}}` | TODO_TAX_REVIEW |

> Se non integrata con SDI, indicare chiaramente `Documento riepilogativo / copia di cortesia`.

TODO_TAX_REVIEW: validare flusso Stripe, fatturazione elettronica, IVA Italia/UE, B2B/B2C e regimi fiscali applicabili.
TODO_LEGAL_REVIEW: validare condizioni commerciali e responsabilita.
TODO_SECURITY_REVIEW: validare webhook, audit e accessi ai dati pagamento.
