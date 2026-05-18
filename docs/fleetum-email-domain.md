# Fleetum Email Domain Setup

Questa configurazione separa la posta reale del dominio dagli invii automatici del gestionale.

## Caselle consigliate

- `info@fleetum.it`: ricezione richieste commerciali e form demo.
- `support@fleetum.it`: supporto clienti.
- `no-reply@fleetum.it`: mittente tecnico per email automatiche Fleetum.

## Ricezione email con OVH/Zimbra

Mantieni gli MX OVH nella zona DNS:

```txt
@  MX  1    mx1.mail.ovh.net.
@  MX  5    mx2.mail.ovh.net.
@  MX  100  mx3.mail.ovh.net.
```

Le caselle reali si creano dal pannello OVH/Zimbra. Fleetum non legge direttamente la mailbox: riceve i form via backend e li invia a `info@fleetum.it`.

## Invio automatico con Resend

Variabili backend:

```bash
EMAIL_PROVIDER=resend
RESEND_FROM="Fleetum <no-reply@fleetum.it>"
DEMO_LEAD_RECIPIENT_EMAIL=info@fleetum.it
```

`RESEND_API_KEY` deve stare solo in secret/env di produzione, mai nel repository.

## DNS Resend

Nel pannello Resend aggiungi/verifica `fleetum.it`. Resend mostrerà i record DKIM/TXT richiesti. Copiali nella zona DNS OVH.

SPF deve essere unico. Se OVH ha già un SPF, uniscilo con Resend:

```txt
@ TXT "v=spf1 include:mx.ovh.com include:amazonses.com -all"
```

DMARC iniziale consigliato:

```txt
_dmarc TXT "v=DMARC1; p=none; rua=mailto:info@fleetum.it"
```

Dopo verifica e qualche giorno di log puliti puoi valutare `p=quarantine` e poi `p=reject`.

## Form demo Fleetum

Flusso:

1. Utente compila `/demo`.
2. Frontend chiama `POST /api/public/demo-request`.
3. Backend valida input, rate limita e usa honeypot anti-spam.
4. Backend invia subito tramite Resend a `DEMO_LEAD_RECIPIENT_EMAIL`.
5. `reply-to` è l'email del richiedente, così puoi rispondere direttamente dal client email.

## Smoke test produzione

```bash
curl -s -X POST https://api.fleetum.it/api/public/demo-request \
  -H "content-type: application/json" \
  -d '{
    "companyName":"Autonoleggio Test",
    "fullName":"Mario Rossi",
    "email":"mario.rossi@example.com",
    "phone":"+39 333 0000000",
    "fleetSize":"11-30",
    "message":"Vorrei una demo Fleetum.",
    "source":"manual-smoke-test"
  }'
```

Esito atteso: `202` e email ricevuta su `info@fleetum.it`.
