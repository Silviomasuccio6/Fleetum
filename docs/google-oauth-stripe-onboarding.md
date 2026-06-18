# Google OAuth e onboarding Stripe

## Obiettivo

Configurare login/registrazione Google in modo sicuro e mantenere il flusso commerciale corretto:

- il login email/password continua ad accedere normalmente;
- la registrazione crea un tenant in stato `PENDING`;
- dopo la registrazione l'utente deve passare da `/activate` e scegliere un piano tramite Stripe Checkout;
- la prova di 14 giorni viene attivata solo da Stripe, tramite subscription `trialing` confermata dal webhook;
- anche durante il trial Stripe Checkout deve raccogliere una carta valida (`payment_method_collection=always`);
- Google OAuth non espone segreti nel frontend o nel repository.

## Flusso applicativo

1. Registrazione email/password su `/signup`.
2. Backend crea tenant, admin e subscription interna `PENDING`.
3. Il frontend crea subito la sessione e reindirizza automaticamente a `/activate?welcome=billing`.
4. `/activate` crea una Stripe Checkout Session autenticata in `mode=subscription`, con carta obbligatoria anche se il piano parte in trial.
5. Il webhook Stripe aggiorna la licenza tenant a `TRIAL` o `ACTIVE`.
6. Dashboard, booking, veicoli, contratti e report restano bloccati finché la licenza non è `TRIAL` o `ACTIVE`.

## Flusso Google OAuth

1. Da `/login` il pulsante Google apre `/api/auth/google` con eventuale `returnTo` interno.
2. Da `/signup` il pulsante Google apre `/api/auth/google?intent=signup&returnTo=/activate?welcome=billing`.
3. Il backend scambia il codice OAuth, crea o recupera l'utente, imposta cookie auth httpOnly e reindirizza a `/auth/social-callback`.
4. Il frontend finalizza la sessione, controlla `/api/auth/license-status` e:
   - se la licenza è `TRIAL` o `ACTIVE`, manda alla destinazione richiesta;
   - se la licenza è `PENDING`, `PAST_DUE`, `CANCELED`, `EXPIRED` o non verificabile, manda a `/activate?billing=required`.
5. Se OAuth non è configurato, il backend non mostra più JSON grezzo al browser: reindirizza a `/auth/social-callback#error=...`.

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
# File reale sul VPS: /opt/fleetum/env/backend.env
APP_URL=https://fleetum.it
BACKEND_PUBLIC_URL=https://api.fleetum.it
OAUTH_CALLBACK_URL=https://fleetum.it/auth/social-callback
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://api.fleetum.it/api/auth/google/callback
BILLING_TRIAL_DAYS=14
```

Se il backend restituisce:

```json
{"error":"GOOGLE_OAUTH_NOT_CONFIGURED","message":"OAuth Google non configurato sul backend"}
```

significa che almeno una tra `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` o `GOOGLE_REDIRECT_URI` non è configurata nel file env del backend o non è stata caricata dopo il deploy. Dopo aver aggiornato l'env, riavviare il backend e verificare `/api/ready`.

Comandi operativi sul VPS:

```bash
sudo nano /opt/fleetum/env/backend.env

# aggiungere o aggiornare:
GOOGLE_CLIENT_ID=your_google_oauth_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_REDIRECT_URI=https://api.fleetum.it/api/auth/google/callback
OAUTH_CALLBACK_URL=https://fleetum.it/auth/social-callback

cd /opt/fleetum/app
docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.yml up -d --no-build backend
curl -fsS https://api.fleetum.it/api/ready
curl -I https://api.fleetum.it/api/auth/google
```

Il secondo `curl` deve restituire un redirect `302` verso `accounts.google.com`, non `503`.

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

Per produzione i segreti runtime del backend devono stare in `/opt/fleetum/env/backend.env` sul VPS. I workflow non devono stampare ne' committare `GOOGLE_CLIENT_SECRET`.

Configurazione Stripe minima nello stesso file backend env:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- price id Stripe per Starter, Pro, Enterprise mensili/annuali;
- `BILLING_TRIAL_DAYS=14`.

Ogni modifica deve passare da:

1. commit;
2. push;
3. CI GitHub Actions;
4. Deploy Production GitHub Actions;
5. health check `https://api.fleetum.it/api/health`.
