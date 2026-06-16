# Billing SaaS e Stripe

## Obiettivo

Il gestionale usa un modello SaaS con piani:

| Piano | Prezzo mensile |
| --- | ---: |
| STARTER | 149 EUR |
| PRO | 199 EUR |
| ENTERPRISE | 249 EUR |

Ogni nuovo tenant parte in `PENDING`: il gestionale resta bloccato finche l'utente non completa Stripe Checkout su `/activate`. La prova di `BILLING_TRIAL_DAYS` giorni viene attivata solo dal webhook Stripe, con carta raccolta in Checkout.

## Stati licenza

- `TRIAL`: prova attiva.
- `ACTIVE`: abbonamento pagato e valido.
- `PENDING`: account creato ma checkout Stripe non completato.
- `PAST_DUE`: pagamento fallito, da recuperare.
- `SUSPENDED`: licenza sospesa manualmente.
- `EXPIRED`: trial/licenza scaduta.
- `CANCELED`: abbonamento cancellato.

## Test in locale senza Stripe

Se `STRIPE_SECRET_KEY` è vuoto, il backend usa un checkout mock locale.

1. Avvia backend e frontend.
2. Accedi con il tenant appena creato.
3. Apri `/activate`.
4. Clicca un piano.
5. Il backend simula il pagamento e aggiorna la licenza tenant.
6. Torni su `/activate?checkout=success`.

Questo flusso non muove denaro e serve solo per sviluppo locale.

## Test in locale con Stripe Test Mode

Configura in `backend/.env`:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER_MONTHLY=price_...
STRIPE_PRICE_STARTER_YEARLY=price_...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_YEARLY=price_...
STRIPE_PRICE_ENTERPRISE_MONTHLY=price_...
STRIPE_PRICE_ENTERPRISE_YEARLY=price_...
```

Poi usa Stripe CLI:

```bash
stripe listen --forward-to http://127.0.0.1:4000/api/billing/webhook
```

Carta test:

```text
4242 4242 4242 4242
Scadenza futura
CVC qualsiasi
CAP qualsiasi
```

## Endpoint

- `POST /api/billing/checkout-session`
  - autenticato tenant
  - body: `{ "plan": "PRO", "billingCycle": "monthly" }`
  - ritorna: `{ "mode": "stripe" | "local", "checkoutUrl": "..." }`

- `GET /api/billing/local-complete`
  - solo non produzione
  - simula pagamento riuscito in locale

- `POST /api/billing/webhook`
  - pubblico
  - riceve eventi Stripe
  - aggiorna licenza tenant tramite tabella subscription e audit log

## Note produzione

- In produzione `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` devono essere valorizzati.
- Il webhook deve usare HTTPS.
- I `price_...` devono essere creati su Stripe in modalità live.
- La Platform Console resta il pannello founder-only per monitorare MRR, piani e stati licenza.
