# Google OAuth e onboarding Stripe

## Obiettivo

Configurare login/registrazione Google in modo sicuro e mantenere il flusso commerciale corretto:

- il login email/password continua ad accedere normalmente;
- la registrazione crea un tenant in stato `PENDING`;
- dopo la registrazione l'utente deve passare dalla pagina `/activate`, scegliere un piano e completare Stripe Checkout;
- la prova di 14 giorni viene attivata solo da Stripe e richiede carta valida prima dell'accesso al gestionale;
- Google OAuth non espone segreti nel frontend o nel repository.

## Flusso applicativo

1. Registrazione email/password su `/signup`.
2. Backend crea tenant, admin e subscription interna `PENDING`.
3. La schermata finale propone solo il percorso di attivazione: login e redirect a `/activate`.
4. `/activate` crea una Stripe Checkout Session autenticata in `mode=subscription` con carta obbligatoria anche durante il trial.
5. Il webhook Stripe aggiorna la licenza tenant a `TRIAL` o `ACTIVE`.
6. Dashboard, booking, veicoli, contratti e report restano non renderizzati finché la licenza non è `TRIAL` o `ACTIVE`.

## Variabili backend richieste

Local:

```env
APP_URL=http://localhost:5173
BACKEND_PUBLIC_URL=http://127.0.0.1:4000
OAUTH_CALLBACK_URL=http://localhost:5173/auth/social-callback
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://127.0.0.1:4000/api/auth/google/callback
BILLING_TRIAL_DAYS=14
```

Produzione:

```env
APP_URL=https://fleetum.it
BACKEND_PUBLIC_URL=https://api.fleetum.it
OAUTH_CALLBACK_URL=https://fleetum.it/auth/social-callback
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://api.fleetum.it/api/auth/google/callback
BILLING_TRIAL_DAYS=14
```

## Redirect URI da autorizzare in Google Cloud

OAuth client web application:

- local: `http://127.0.0.1:4000/api/auth/google/callback`
- produzione: `https://api.fleetum.it/api/auth/google/callback`

Se viene usata anche la sincronizzazione Google Calendar:

- local: `http://127.0.0.1:4000/api/calendar/google/callback`
- produzione: `https://api.fleetum.it/api/calendar/google/callback`

## Sicurezza

- `GOOGLE_CLIENT_SECRET` deve stare solo in `.env` locale o GitHub/VPS secrets.
- Il frontend apre `/api/auth/google`, non conosce il client secret.
- Il parametro `returnTo` viene accettato solo se e un path interno, ad esempio `/dashboard` o `/activate`.
- Lo stato OAuth e firmato con `JWT_SECRET` e scade dopo 10 minuti.
- Non usare redirect assoluti esterni nel parametro `next`/`returnTo`.

## GitHub Actions

Per produzione aggiornare i secrets usati dal deploy:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- eventuale `GOOGLE_REDIRECT_URI`, se il workflow lo mappa esplicitamente;
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- price id Stripe per Starter, Pro, Enterprise.

Ogni modifica deve passare da:

1. commit;
2. push;
3. CI GitHub Actions;
4. Deploy Production GitHub Actions;
5. health check `https://api.fleetum.it/api/health`.
