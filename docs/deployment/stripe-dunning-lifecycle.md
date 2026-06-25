# Stripe dunning lifecycle Fleetum

Documento operativo tecnico. Non inserire chiavi Stripe, webhook secret, email reali o dati cliente.

## Stati supportati

| Stato Fleetum | Origine tipica Stripe | Accesso gestionale | Azione cliente |
| --- | --- | --- | --- |
| `TRIAL` | `customer.subscription.*` con `status=trialing` | Consentito | Nessuna, carta gia' raccolta da Checkout |
| `ACTIVE` | `status=active`, `invoice.paid`, `invoice.payment_succeeded` | Consentito | Nessuna |
| `PAST_DUE` | `invoice.payment_failed`, `status=past_due` | Bloccato | Sostituire carta o completare pagamento |
| `SUSPENDED` | `customer.subscription.updated` con `status=unpaid` | Bloccato | Regolarizzare abbonamento |
| `CANCELED` | `customer.subscription.deleted`, `status=canceled` | Bloccato | Riattivare piano |
| `PENDING` | Tenant creato senza webhook Checkout confermato | Bloccato | Completare Stripe Checkout |

## Regola importante sul grace period

`BILLING_PAST_DUE_GRACE_DAYS` indica la finestra usata per comunicazioni e dunning operativo.

Non e' un bypass del license guard: in Fleetum `PAST_DUE`, `SUSPENDED`, `CANCELED`, `EXPIRED` e `PENDING` restano bloccati sulle API operative. Le route self-service `/activate` e `/upgrade` restano raggiungibili per permettere recupero pagamento o riattivazione.

## Email automatiche

Fleetum accoda email nella tabella `EmailQueue` e l'invio passa dal provider configurato (`EMAIL_PROVIDER=resend` in produzione).

Email previste:

- `BILLING_PAYMENT_FAILED`: pagamento fallito, carta/metodo da aggiornare.
- `BILLING_CARD_EXPIRING`: carta in scadenza ricevuta da webhook Stripe.
- `BILLING_SUBSCRIPTION_SUSPENDED`: subscription passata a stato sospeso/unpaid.
- `BILLING_SUBSCRIPTION_REACTIVATED`: pagamento recuperato e piano tornato attivo.
- `BILLING_SUBSCRIPTION_CANCELED`: subscription cancellata.

Le email non devono bloccare l'aggiornamento licenza: se la notifica fallisce, Fleetum registra `BILLING_NOTIFICATION_FAILED` in audit log e continua a mantenere coerente lo stato Stripe/Fleetum.

## Webhook da mantenere attivi

Endpoint:

```text
https://api.fleetum.it/api/billing/webhook
```

Eventi minimi:

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_succeeded
invoice.payment_failed
customer.source.expiring
```

## Audit log

Ogni cambio licenza persiste su `TenantSubscription` e scrive audit `PLATFORM_LICENSE_UPDATED` con:

- `before`: stato precedente, piano, ciclo, Stripe customer/subscription;
- `after`: stato nuovo e snapshot persistito;
- `source=billing`.

Le azioni manuali dalla Platform Console devono continuare a essere tracciate con audit dedicato e non devono bypassare Stripe per clienti reali, salvo correzione amministrativa esplicita e documentata.

## Verifiche operative

1. Simulare `invoice.payment_failed` in Stripe test.
2. Verificare `TenantSubscription.status=PAST_DUE`.
3. Verificare blocco accesso dashboard e accesso a `/upgrade`.
4. Verificare email `BILLING_PAYMENT_FAILED` in `EmailQueue`.
5. Simulare `customer.subscription.updated` con `status=unpaid`.
6. Verificare `TenantSubscription.status=SUSPENDED`.
7. Simulare `invoice.paid`.
8. Verificare `TenantSubscription.status=ACTIVE` ed email di riattivazione.

## Rollback

Se una transizione errata blocca clienti paganti:

1. Non disabilitare il license guard.
2. Controllare evento Stripe e `BillingEvent`.
3. Correggere lo stato via Platform Console solo con audit e motivazione.
4. Se il problema e' codice, rollback immagine backend e poi correggere la logica webhook.
