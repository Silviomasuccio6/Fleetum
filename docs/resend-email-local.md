# Resend Email - Test Locale

Questa integrazione permette di inviare email reali in ambiente locale usando Resend, senza usare SMTP/Gmail.

## Configurazione

Nel file `backend/.env` imposta:

```bash
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxx
RESEND_FROM="Fleetum <onboarding@resend.dev>"
```

Se hai gia verificato un dominio su Resend, sostituisci `RESEND_FROM` con il tuo mittente:

```bash
RESEND_FROM="Nome Azienda <noreply@tuodominio.it>"
```

## Nota Resend Free/Test

Con il mittente `onboarding@resend.dev`, Resend normalmente permette test verso l'email dell'account verificato.
Per inviare a clienti reali serve verificare un dominio aziendale.

## Cosa passa da Resend

Il provider email unico viene usato da:

- reset password;
- inviti utenti;
- reminder/solleciti;
- contratti noleggio con PDF allegato;
- report programmati;
- alert Platform Console.

## Test rapido

1. Avvia backend e frontend.
2. Imposta `EMAIL_PROVIDER=resend`.
3. Riavvia il backend.
4. Apri un contratto noleggio.
5. Usa `Invia tramite email`.
6. Verifica su Resend `Logs` o nella casella destinataria.

Se l'invio fallisce, la coda email registra l'errore e riprova secondo la logica esistente.
