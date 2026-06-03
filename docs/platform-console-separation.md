# Separazione Platform Console / Gestionale Tenant

## Obiettivo

La Platform Console e il gestionale tenant sono due superfici applicative separate.

- Il gestionale tenant è l'applicazione usata dai clienti SaaS.
- La Platform Console è il pannello founder-only usato dal proprietario della piattaforma per monitorare tenant, licenze, piani, MRR, trial, sicurezza e audit.

Le due app restano unite solo tramite API backend sicure e dati centralizzati, non tramite link o route visibili ai tenant.

## Architettura local

| Superficie | URL local | Entry point frontend | API |
| --- | --- | --- | --- |
| Gestionale tenant | `http://127.0.0.1:5173` | `frontend/index.html` -> `frontend/src/main.tsx` | `http://127.0.0.1:4000/api` |
| Platform Console | `http://127.0.0.1:5174/platform.html#/login` | `frontend/platform.html` -> `frontend/src/platform-main.tsx` | `http://127.0.0.1:4100/platform-api` |

## Script local

Backend tenant + platform API:

```bash
npm run dev -w backend
```

Frontend gestionale tenant:

```bash
npm run dev -w frontend
```

Frontend Platform Console:

```bash
npm run dev:platform -w frontend
```

## Separazione frontend

Il gestionale tenant usa:

- `frontend/index.html`
- `frontend/src/main.tsx`
- `frontend/src/presentation/routes/app-routes.tsx`
- `frontend/src/presentation/components/layout/app-layout.tsx`
- auth tenant tramite `frontend/src/infrastructure/auth/token-storage.ts`

La Platform Console usa:

- `frontend/platform.html`
- `frontend/src/platform-main.tsx`
- `frontend/src/presentation/routes/platform-routes.tsx`
- `frontend/src/presentation/components/layout/platform-admin-layout.tsx`
- auth platform tramite `frontend/src/infrastructure/platform/platform-auth-storage.ts`
- `HashRouter`, così refresh e navigazione restano dentro `platform.html` e non ricadono sull'app tenant.

Il build Vite è multi-page e include esplicitamente `index.html` e `platform.html`.

## Separazione API

API tenant:

- prefisso: `/api`
- porta local: `4000`
- auth tenant standard
- CSRF tenant dove previsto
- tenant isolation obbligatoria

API platform:

- prefisso: `/platform-api`
- porta local: `4100`
- middleware `requirePlatformAuth`
- token JWT platform separato
- IP allowlist platform dove configurata
- rate limit login platform
- audit per azioni platform

## Regole sicurezza

1. I tenant non devono vedere link alla Platform Console.
2. I tenant non devono poter usare token tenant su `/platform-api`.
3. La Platform Console usa token separato in `sessionStorage` con chiave `fermi_platform_token`.
4. Il gestionale tenant usa storage e CSRF separati.
5. `JWT_SECRET` e `PLATFORM_JWT_SECRET` devono essere diversi.
6. Il CORS tenant deve consentire solo origin tenant.
7. Il CORS platform deve consentire solo origin platform.
8. La Platform Console deve restare founder-only.

## Variabili ambiente

Backend:

```env
CORS_ORIGIN=http://localhost:5173
PLATFORM_PORT=4100
PLATFORM_BIND_HOST=127.0.0.1
PLATFORM_CORS_ORIGIN=http://localhost:5174
PLATFORM_ADMIN_EMAIL=info@fleetum.it
# Genera con: node -e "require('bcryptjs').hash('TUA_PASSWORD',12).then(console.log)"
PLATFORM_ADMIN_PASSWORD_HASH=$2b$12$replace_with_bcrypt_hash
PLATFORM_JWT_SECRET=replace_with_platform_jwt_secret_min_64_chars
PLATFORM_ALLOWED_IPS=127.0.0.1,::1
```

La password della Platform Console non deve mai essere salvata in chiaro. In produzione
salvare solo `PLATFORM_ADMIN_PASSWORD_HASH` nel file env del backend o nel secret
manager usato dal deploy.

Frontend tenant:

```env
VITE_API_BASE_URL=http://127.0.0.1:4000/api
```

Frontend platform:

```env
VITE_PLATFORM_API_BASE_URL=http://127.0.0.1:4100/platform-api
```

## Produzione consigliata

| Superficie | Dominio consigliato |
| --- | --- |
| Gestionale tenant | `app.dominio.it` |
| Platform Console | `platform.dominio.it` |
| API tenant | `api.dominio.it/api` |
| API platform | `api.dominio.it/platform-api` |

In produzione la Platform Console dovrebbe avere:

- dominio separato;
- IP allowlist restrittiva;
- OTP/MFA obbligatorio;
- logging accessi;
- alert su tentativi falliti;
- nessun link pubblico dal gestionale tenant.

## Checklist smoke test

- `GET /api/health` risponde su `4000`.
- `GET /platform-api/health` risponde su `4100`.
- `GET /platform-api/tenants` senza token fallisce.
- `GET /platform-api/tenants` con token tenant fallisce.
- `GET /api/auth/me` con token platform fallisce o non viene accettato come sessione tenant.
- `http://127.0.0.1:5173` apre il gestionale tenant.
- `http://127.0.0.1:5174/platform.html#/login` apre la Platform Console.
- Nel gestionale tenant non sono presenti link alla Platform Console.
