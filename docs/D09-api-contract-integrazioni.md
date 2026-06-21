# D09 API Contract + Integrazioni

Stato: IMPLEMENTATO E DOCUMENTATO
Aggiornato: 2026-06-21

## Fonte tecnica

- [Catalogo API Fleetum](./technical/api-catalog.md): endpoint tenant, pubblici, billing, Platform Console e storage.
- [Sistema e architettura](./technical/fleetum-system-reference.md): confini applicativi, tenant isolation, autenticazione e integrazioni.
- [Brief sito pubblico](./technical/website-build-brief.md): API consentite al marketing site e confini di sicurezza.

## Convenzioni adottate

- Base API tenant: `/api`.
- Base API Platform: `/platform-api`.
- Risposte errore applicative: `error`, `message`, `requestId` quando disponibile.
- Payload validati con Zod nei validator backend.
- Tenant-owned data filtrati per `tenantId` e protetti da JWT/permessi.
- Stripe webhook protetto da signature; Resend usa API key server-side.
- API Platform protette da IP allowlist, password, OTP e JWT separato.

## Integrazioni

| Integrazione | Uso | Regola |
|---|---|---|
| Stripe | subscription, trial, pagamento, webhook | licenza aggiornata solo da webhook verificato |
| Resend | OTP, inviti, reset password e email transazionali | chiave solo backend, mittente verificato |
| Google OAuth | login/signup e callback | client id/secret solo server, redirect URI registrata |
| Apple OAuth | login opzionale | configurazione server-side |
| S3/R2/B2 | file privati | accesso autenticato o signed URL temporaneo |

## Politica cambi API

1. Aggiungere prima di rimuovere o rinominare campi.
2. Non introdurre breaking change senza aggiornare frontend e test nello stesso rilascio.
3. Aggiornare `docs/technical/api-catalog.md` nel PR.
4. Aggiungere o aggiornare test di permessi e tenant isolation per ogni nuova risorsa tenant-owned.
