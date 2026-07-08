# Stripe dunning lifecycle Fleetum

Documento operativo tecnico. Non inserire chiavi Stripe, webhook secret, email reali o dati cliente.

## Stati supportati

| Stato Fleetum | Origine tipica Stripe | Accesso gestionale | Azione cliente |
| --- | --- | --- | --- |
| `TRIAL` | `customer.subscription.*` con `status=trialing` | Consentito | Nessuna, carta gia' raccolta da Checkout |
| `ACTIVE` | `status=active`, `invoice.paid`, `invoice.payment_succeeded` | Consentito | Nessuna |
| `PAST_DUE` | `invoice.payment_failed`, `status=past_due` | Bloccato | Sostituire carta o completare pagamento |
| `SUSPENDED` | `customer.subscription.updated` con `status=unpaid` oppure cron Fleetum dopo grace PAST_DUE | Bloccato | Regolarizzare abbonamento |
| `CANCELED` | `customer.subscription.deleted`, `status=canceled` | Bloccato | Riattivare piano |
| `PENDING` | Tenant creato senza webhook Checkout confermato | Bloccato | Completare Stripe Checkout |

## Regola importante sul grace period

`BILLING_PAST_DUE_GRACE_DAYS` indica la finestra usata per comunicazioni e dunning operativo.

Non e' un bypass del license guard: in Fleetum `PAST_DUE`, `SUSPENDED`, `CANCELED`, `EXPIRED` e `PENDING` restano bloccati sulle API operative. Le route self-service `/activate` e `/upgrade` restano raggiungibili per permettere recupero pagamento o riattivazione.

Fleetum esegue anche un cron tecnico di dunning:

```text
BILLING_DUNNING_CRON_ENABLED=true
BILLING_DUNNING_CRON_SCHEDULE="15 * * * *"
BILLING_DUNNING_BATCH_SIZE=100
```

Il cron cerca subscription Stripe in `PAST_DUE` da piu' di `BILLING_PAST_DUE_GRACE_DAYS` e le porta a `SUSPENDED`, scrivendo audit log e accodando email. Questo rende prevedibile la sospensione anche se Stripe resta in `past_due` piu' a lungo o se la configurazione dunning Stripe non manda subito `status=unpaid`.

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
5. Simulare `customer.subscription.updated` con `status=unpaid` oppure forzare un record `PAST_DUE` oltre `BILLING_PAST_DUE_GRACE_DAYS` in staging e lanciare il cron.
6. Verificare `TenantSubscription.status=SUSPENDED` e audit `source=billing_dunning_cron` se la sospensione arriva dal cron.
7. Simulare `invoice.paid`.
8. Verificare `TenantSubscription.status=ACTIVE` ed email di riattivazione.

## Rollback

Se una transizione errata blocca clienti paganti:

1. Non disabilitare il license guard.
2. Controllare evento Stripe e `BillingEvent`.
3. Correggere lo stato via Platform Console solo con audit e motivazione.
4. Se il problema e' codice, rollback immagine backend e poi correggere la logica webhook.
