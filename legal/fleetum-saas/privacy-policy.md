---
title: "Privacy Policy Fleetum"
owner: "Fleetum"
version: "0.2.0-draft"
status: "draft"
review_required: true
review_type:
  - legal
  - privacy
  - security
last_updated: "2026-06-19"
applicability: "Fleetum SaaS"
---

> Documento in bozza predisposto per revisione professionale. Non costituisce consulenza legale, fiscale, privacy o cybersecurity.
> Prima dell'uso verso clienti, pubblicazione o firma, validare con avvocato, commercialista, privacy consultant/DPO e consulente cybersecurity.

# Privacy Policy Fleetum

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

## Ruoli privacy

Fleetum puo agire come titolare del trattamento per dati relativi a prospect, clienti business, utenti amministrativi, supporto, billing e sicurezza della piattaforma. Fleetum puo agire come responsabile del trattamento quando tratta dati inseriti dagli autonoleggi nel gestionale per conto del cliente titolare.

## Configurazione operativa verificata al 2026-06-19

- Google OAuth e' attivo per login e signup Fleetum con scope `openid email profile`; Google Calendar resta un'integrazione separata da indicare solo se attivata.
- Apple OAuth non e' offerto nell'interfaccia di signup corrente e non deve essere dichiarato come servizio attivo.
- Stripe e' usato per abbonamenti, checkout e billing; Fleetum non deve memorizzare dati completi di carta.
- Resend e' usato per email transazionali e operative.
- AWS S3 in `eu-north-1` (Stoccolma) e' usato per backup offsite. Lo storage applicativo di documenti resta `local` finche `STORAGE_PROVIDER=s3` non viene effettivamente attivato e verificato.
- Gli analytics interni del sito pubblico restano disabilitati fino al consenso esplicito Analytics, versione `2026-06-19`.

TODO_PRIVACY_REVIEW: validare ruoli, categorie dati e trasferimenti associati a Google OAuth, Stripe, Resend, OVH e AWS prima della pubblicazione finale.

## 1. Fleetum come titolare per dati dei clienti business

Questa sezione definisce fleetum come titolare per dati dei clienti business per il contesto Fleetum, usando dati e configurazioni multi-tenant quando applicabile. Il testo deve essere adattato al piano sottoscritto, alle funzionalita' effettivamente abilitate e agli accordi firmati con il cliente.

- Ambito operativo: descrivere cosa viene incluso e cosa resta escluso.
- Responsabilita': indicare obblighi di Fleetum, del cliente e degli utenti autorizzati.
- Evidenze: collegare ove possibile audit log, versioni documento, timestamp e identificativi tecnici.

## 2. Fleetum come responsabile per dati trattati nel gestionale

Questa sezione definisce fleetum come responsabile per dati trattati nel gestionale per il contesto Fleetum, usando dati e configurazioni multi-tenant quando applicabile. Il testo deve essere adattato al piano sottoscritto, alle funzionalita' effettivamente abilitate e agli accordi firmati con il cliente.

- Ambito operativo: descrivere cosa viene incluso e cosa resta escluso.
- Responsabilita': indicare obblighi di Fleetum, del cliente e degli utenti autorizzati.
- Evidenze: collegare ove possibile audit log, versioni documento, timestamp e identificativi tecnici.

## 3. Dati raccolti dal sito

Questa sezione definisce dati raccolti dal sito per il contesto Fleetum, usando dati e configurazioni multi-tenant quando applicabile. Il testo deve essere adattato al piano sottoscritto, alle funzionalita' effettivamente abilitate e agli accordi firmati con il cliente.

- Ambito operativo: descrivere cosa viene incluso e cosa resta escluso.
- Responsabilita': indicare obblighi di Fleetum, del cliente e degli utenti autorizzati.
- Evidenze: collegare ove possibile audit log, versioni documento, timestamp e identificativi tecnici.

## 4. Dati raccolti in app

Questa sezione definisce dati raccolti in app per il contesto Fleetum, usando dati e configurazioni multi-tenant quando applicabile. Il testo deve essere adattato al piano sottoscritto, alle funzionalita' effettivamente abilitate e agli accordi firmati con il cliente.

- Ambito operativo: descrivere cosa viene incluso e cosa resta escluso.
- Responsabilita': indicare obblighi di Fleetum, del cliente e degli utenti autorizzati.
- Evidenze: collegare ove possibile audit log, versioni documento, timestamp e identificativi tecnici.

## 5. Dati pagamento

Questa sezione definisce dati pagamento per il contesto Fleetum, usando dati e configurazioni multi-tenant quando applicabile. Il testo deve essere adattato al piano sottoscritto, alle funzionalita' effettivamente abilitate e agli accordi firmati con il cliente.

- Ambito operativo: descrivere cosa viene incluso e cosa resta escluso.
- Responsabilita': indicare obblighi di Fleetum, del cliente e degli utenti autorizzati.
- Evidenze: collegare ove possibile audit log, versioni documento, timestamp e identificativi tecnici.

## 6. Dati supporto tecnico

Questa sezione definisce dati supporto tecnico per il contesto Fleetum, usando dati e configurazioni multi-tenant quando applicabile. Il testo deve essere adattato al piano sottoscritto, alle funzionalita' effettivamente abilitate e agli accordi firmati con il cliente.

- Ambito operativo: descrivere cosa viene incluso e cosa resta escluso.
- Responsabilita': indicare obblighi di Fleetum, del cliente e degli utenti autorizzati.
- Evidenze: collegare ove possibile audit log, versioni documento, timestamp e identificativi tecnici.

## 7. Log e dati sicurezza

Questa sezione definisce log e dati sicurezza per il contesto Fleetum, usando dati e configurazioni multi-tenant quando applicabile. Il testo deve essere adattato al piano sottoscritto, alle funzionalita' effettivamente abilitate e agli accordi firmati con il cliente.

- Ambito operativo: descrivere cosa viene incluso e cosa resta escluso.
- Responsabilita': indicare obblighi di Fleetum, del cliente e degli utenti autorizzati.
- Evidenze: collegare ove possibile audit log, versioni documento, timestamp e identificativi tecnici.

## 8. Dati marketing

Questa sezione definisce dati marketing per il contesto Fleetum, usando dati e configurazioni multi-tenant quando applicabile. Il testo deve essere adattato al piano sottoscritto, alle funzionalita' effettivamente abilitate e agli accordi firmati con il cliente.

- Ambito operativo: descrivere cosa viene incluso e cosa resta escluso.
- Responsabilita': indicare obblighi di Fleetum, del cliente e degli utenti autorizzati.
- Evidenze: collegare ove possibile audit log, versioni documento, timestamp e identificativi tecnici.

## 9. Basi giuridiche

Questa sezione definisce basi giuridiche per il contesto Fleetum, usando dati e configurazioni multi-tenant quando applicabile. Il testo deve essere adattato al piano sottoscritto, alle funzionalita' effettivamente abilitate e agli accordi firmati con il cliente.

- Ambito operativo: descrivere cosa viene incluso e cosa resta escluso.
- Responsabilita': indicare obblighi di Fleetum, del cliente e degli utenti autorizzati.
- Evidenze: collegare ove possibile audit log, versioni documento, timestamp e identificativi tecnici.

## 10. Conservazione

Questa sezione definisce conservazione per il contesto Fleetum, usando dati e configurazioni multi-tenant quando applicabile. Il testo deve essere adattato al piano sottoscritto, alle funzionalita' effettivamente abilitate e agli accordi firmati con il cliente.

- Ambito operativo: descrivere cosa viene incluso e cosa resta escluso.
- Responsabilita': indicare obblighi di Fleetum, del cliente e degli utenti autorizzati.
- Evidenze: collegare ove possibile audit log, versioni documento, timestamp e identificativi tecnici.

## 11. Fornitori e sub-responsabili

Questa sezione definisce fornitori e sub-responsabili per il contesto Fleetum, usando dati e configurazioni multi-tenant quando applicabile. Il testo deve essere adattato al piano sottoscritto, alle funzionalita' effettivamente abilitate e agli accordi firmati con il cliente.

- Ambito operativo: descrivere cosa viene incluso e cosa resta escluso.
- Responsabilita': indicare obblighi di Fleetum, del cliente e degli utenti autorizzati.
- Evidenze: collegare ove possibile audit log, versioni documento, timestamp e identificativi tecnici.

## 12. Trasferimenti extra UE

Questa sezione definisce trasferimenti extra ue per il contesto Fleetum, usando dati e configurazioni multi-tenant quando applicabile. Il testo deve essere adattato al piano sottoscritto, alle funzionalita' effettivamente abilitate e agli accordi firmati con il cliente.

- Ambito operativo: descrivere cosa viene incluso e cosa resta escluso.
- Responsabilita': indicare obblighi di Fleetum, del cliente e degli utenti autorizzati.
- Evidenze: collegare ove possibile audit log, versioni documento, timestamp e identificativi tecnici.

## 13. Diritti interessato

Questa sezione definisce diritti interessato per il contesto Fleetum, usando dati e configurazioni multi-tenant quando applicabile. Il testo deve essere adattato al piano sottoscritto, alle funzionalita' effettivamente abilitate e agli accordi firmati con il cliente.

- Ambito operativo: descrivere cosa viene incluso e cosa resta escluso.
- Responsabilita': indicare obblighi di Fleetum, del cliente e degli utenti autorizzati.
- Evidenze: collegare ove possibile audit log, versioni documento, timestamp e identificativi tecnici.

## 14. Reclamo al Garante

Questa sezione definisce reclamo al garante per il contesto Fleetum, usando dati e configurazioni multi-tenant quando applicabile. Il testo deve essere adattato al piano sottoscritto, alle funzionalita' effettivamente abilitate e agli accordi firmati con il cliente.

- Ambito operativo: descrivere cosa viene incluso e cosa resta escluso.
- Responsabilita': indicare obblighi di Fleetum, del cliente e degli utenti autorizzati.
- Evidenze: collegare ove possibile audit log, versioni documento, timestamp e identificativi tecnici.

## 15. Contatti privacy

Questa sezione definisce contatti privacy per il contesto Fleetum, usando dati e configurazioni multi-tenant quando applicabile. Il testo deve essere adattato al piano sottoscritto, alle funzionalita' effettivamente abilitate e agli accordi firmati con il cliente.

- Ambito operativo: descrivere cosa viene incluso e cosa resta escluso.
- Responsabilita': indicare obblighi di Fleetum, del cliente e degli utenti autorizzati.
- Evidenze: collegare ove possibile audit log, versioni documento, timestamp e identificativi tecnici.

## 16. Aggiornamenti policy

Questa sezione definisce aggiornamenti policy per il contesto Fleetum, usando dati e configurazioni multi-tenant quando applicabile. Il testo deve essere adattato al piano sottoscritto, alle funzionalita' effettivamente abilitate e agli accordi firmati con il cliente.

- Ambito operativo: descrivere cosa viene incluso e cosa resta escluso.
- Responsabilita': indicare obblighi di Fleetum, del cliente e degli utenti autorizzati.
- Evidenze: collegare ove possibile audit log, versioni documento, timestamp e identificativi tecnici.


TODO_PRIVACY_REVIEW: verificare ruoli privacy Fleetum/cliente, basi giuridiche, conservazione, sub-responsabili e trasferimenti extra UE.
TODO_LEGAL_REVIEW: validare informative e responsabilita contrattuali collegate.
TODO_SECURITY_REVIEW: validare riferimenti a log, sicurezza e misure tecniche.
