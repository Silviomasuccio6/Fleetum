---
title: "Cookie Policy Fleetum"
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

# Cookie Policy Fleetum

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

## 1. Ambito

Questa bozza descrive cookie, localStorage, sessionStorage e tecnologie di tracciamento del sito pubblico Fleetum. Non copre cookie o tecnologie gestite direttamente da fornitori esterni nelle rispettive pagine, quali Stripe Checkout o Google OAuth.

## 2. Tecnologie necessarie

Fleetum conserva localmente la scelta dell'utente con la chiave `fleetum_cookie_consent_v1`. La chiave contiene solo categorie selezionate, versione e timestamp della scelta; non abilita analytics o marketing da sola.

## 3. Analytics interni

Gli eventi analytics interni Fleetum sono disabilitati finche l'utente non abilita esplicitamente la categoria Analytics. Dopo l'opt-in, Fleetum puo registrare pagina, referrer, parametri UTM, identificativo di sessione pseudonimo, tipo browser/dispositivo e hash tecnici dell'IP e user agent. Il consenso attuale e' versionato `2026-06-19`.

## 4. Marketing e strumenti terzi

Alla data di aggiornamento non e' confermato alcun pixel marketing di terze parti attivo sul sito Fleetum. Se ne viene attivato uno, Fleetum deve aggiornare questa policy, incrementare la versione del consenso e bloccare lo script fino all'opt-in.

## 5. Gestione e revoca

Il banner iniziale offre `Solo necessari`, gestione granulare e `Accetta tutto`. L'utente puo riaprire il pannello tramite il comando permanente `Preferenze cookie` nel footer pubblico e modificare la scelta in ogni momento.

## 6. Inventario tecnico rilevato

| Nome | Tipo | Finalita | Durata | Fornitore | Consenso richiesto |
|---|---|---|---|---|---|
| `fleetum_cookie_consent_v1` | localStorage | Memorizzare la scelta privacy | Fino alla cancellazione browser o a nuova versione consenso | Fleetum | No, necessario |
| `fleetum_public_session` | sessionStorage | Correlare eventi analytics interni dopo opt-in | Sessione browser | Fleetum | Si, Analytics |
| Eventi analytics interni | Evento server-side | Misurazione visite e CTA dopo opt-in | Da definire e validare | Fleetum | Si, Analytics |

## 7. Contatti e verifiche

I contatti privacy definitivi devono usare `{{fleetum_privacy_email}}` e `{{fleetum_pec}}`. Prima della pubblicazione e' obbligatoria una scansione reale di produzione per verificare cookie, storage browser, script, SDK, pixel e pagine Stripe/Google effettivamente caricate.

TODO_PRIVACY_REVIEW: collegare la cookie policy al CMP/cookie banner reale usato in produzione.
TODO_LEGAL_REVIEW: validare testo pubblico e meccanismi di consenso/revoca.
TODO_SECURITY_REVIEW: verificare cookie tecnici, sessione e flag secure/httpOnly/sameSite.
