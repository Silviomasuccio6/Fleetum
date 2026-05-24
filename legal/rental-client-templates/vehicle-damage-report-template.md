---
title: "Scheda Danni Veicolo Template"
owner: "Fleetum"
version: "0.1.0-draft"
status: "draft"
review_required: true
review_type:
  - legal
  - privacy
  - tax
last_updated: "2026-05-24"
applicability: "Rental Client Template"
---

> Documento in bozza predisposto per revisione professionale. Non costituisce consulenza legale, fiscale, privacy o cybersecurity.
> Prima dell'uso verso clienti, pubblicazione o firma, validare con avvocato, commercialista, privacy consultant/DPO e consulente cybersecurity.

# Scheda Danni Veicolo Template

## Placeholder azienda autonoleggio

- `{{company_logo}}`
- `{{company_name}}`
- `{{company_legal_name}}`
- `{{company_address}}`
- `{{company_vat_number}}`
- `{{company_tax_code}}`
- `{{company_rea}}`
- `{{company_pec}}`
- `{{company_email}}`
- `{{company_phone}}`
- `{{company_website}}`
- `{{company_privacy_email}}`
- `{{company_dpo_contact}}`
- `{{company_brand_primary_color}}`
- `{{company_terms_url}}`
- `{{company_privacy_url}}`

## Placeholder contratto noleggio

- `{{contract_number}}`, `{{contract_date}}`, `{{contract_status}}`
- `{{rental_location}}`, `{{return_location}}`, `{{operator_name}}`, `{{operator_id}}`
- `{{customer_name}}`, `{{customer_type}}`, `{{customer_tax_code}}`, `{{customer_vat_number}}`, `{{customer_address}}`, `{{customer_email}}`, `{{customer_phone}}`
- `{{customer_document_type}}`, `{{customer_document_number}}`, `{{customer_document_expiry}}`
- `{{driver_license_number}}`, `{{driver_license_expiry}}`, `{{additional_driver_name}}`
- `{{vehicle_brand}}`, `{{vehicle_model}}`, `{{vehicle_plate}}`, `{{vehicle_vin}}`, `{{vehicle_category}}`, `{{vehicle_fuel_type}}`, `{{vehicle_transmission}}`
- `{{rental_start_datetime}}`, `{{rental_end_datetime}}`, `{{pickup_mileage}}`, `{{return_mileage}}`, `{{pickup_fuel_level}}`, `{{return_fuel_level}}`
- `{{daily_rate}}`, `{{rental_days}}`, `{{included_km}}`, `{{extra_km_rate}}`, `{{deposit_amount}}`, `{{insurance_type}}`, `{{deductible_amount}}`
- `{{extra_services}}`, `{{discount_amount}}`, `{{vat_amount}}`, `{{total_amount}}`, `{{paid_amount}}`, `{{remaining_amount}}`
- `{{payment_method}}`, `{{payment_status}}`, `{{payment_transaction_id}}`, `{{stripe_payment_intent_id}}`
- `{{signature_customer}}`, `{{signature_operator}}`, `{{signature_timestamp}}`, `{{document_hash}}`

> Regola brand: il logo principale e `{{company_logo}}`. Fleetum appare solo nel footer come `Powered by Fleetum`.

## Struttura dati

| Campo | Placeholder | Note | Review |
|---|---|---|---|
| Azienda | `{{company_legal_name}}` | Dati locatore | TODO_LEGAL_REVIEW |
| Cliente | `{{customer_name}}` | Dati cliente/conducente | TODO_PRIVACY_REVIEW |
| Veicolo | `{{vehicle_plate}}` | Targa e caratteristiche | TODO_LEGAL_REVIEW |
| Importi | `{{total_amount}}` | Totali, IVA, cauzione | TODO_TAX_REVIEW |
| Firma | `{{signature_customer}}` | Evidenza firma | TODO_LEGAL_REVIEW |

## Registro danni/foto

| ID danno | Area veicolo | Descrizione | Gravita | Foto | Preventivo | Importo addebitabile | Franchigia | Contestazione | Firma |
|---|---|---|---|---|---:|---:|---:|---|---|
| {{damage_id}} | {{damage_area}} | {{damage_description}} | {{damage_severity}} | {{photo_url}} | {{estimate_amount}} | {{chargeable_amount}} | {{deductible_amount}} | {{dispute_status}} | {{signature_customer}} |

TODO_LEGAL_REVIEW: validare clausole, firme, prova documentale e foro competente.
TODO_PRIVACY_REVIEW: validare trattamento dati clienti, documenti, foto e conducenti.
TODO_TAX_REVIEW: validare importi, IVA, cauzioni, addebiti e fatturazione.
TODO_SECURITY_REVIEW: validare storage allegati, hash documento e audit log.
