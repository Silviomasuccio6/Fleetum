# Fleetum Project Map

## Root

```txt
/
├── backend
├── frontend
├── deploy
├── docs
├── legal
├── app
├── .github/workflows
├── docker-compose.yml
└── docker-compose.prod.yml
```

## Backend

Path: `backend/`

Responsabilita:

- API tenant `/api`.
- API platform `/platform-api`.
- Auth JWT, CSRF, rate limit, CORS.
- Prisma/PostgreSQL.
- Billing Stripe.
- Email queue.
- Cron reminder/report/privacy retention.
- Audit log.
- PDF/contratti/uploads.

File principali:

```txt
backend/src/server.ts
backend/src/app.ts
backend/src/shared/config/env.ts
backend/src/interfaces/http/routes/index.ts
backend/src/interfaces/http/routes/platform-index.ts
backend/src/interfaces/http/middlewares/*
backend/src/application/services/*
backend/prisma/schema.prisma
backend/prisma/migrations/*
```

## Frontend

Path: `frontend/`

Responsabilita:

- Landing pubblica `/`.
- Login/signup tenant.
- App gestionale protetta.
- Booking noleggi, contratti, clienti, veicoli, dashboard.
- Platform Console separata via `platform.html`.

File/aree principali:

```txt
frontend/src/presentation/pages/*
frontend/src/presentation/components/*
frontend/src/application/usecases/*
frontend/src/infrastructure/*
frontend/public/*
frontend/vite.config.ts
```

## Prisma e database

Path:

```txt
backend/prisma/schema.prisma
backend/prisma/migrations/*
```

Aree critiche:

- Tenant.
- Users/roles.
- Vehicles.
- Customers.
- Rental bookings.
- Contracts/invoices.
- Audit logs.
- Website analytics/demo leads.
- Privacy/legal settings.

Regola: ogni dato business tenant-owned deve avere filtro `tenantId` e test isolamento.

## Routes e controller

Tenant API:

```txt
backend/src/interfaces/http/routes/index.ts
backend/src/interfaces/http/controllers/*
```

Platform API:

```txt
backend/src/interfaces/http/routes/platform-index.ts
backend/src/interfaces/http/routes/platform-admin-routes.ts
backend/src/interfaces/http/controllers/platform-admin-controller.ts
```

## Billing

File critici:

```txt
backend/src/application/services/billing-service.ts
backend/src/application/services/license-policy-service.ts
backend/src/interfaces/http/controllers/billing-controller.ts
backend/src/interfaces/http/routes/billing-routes.ts
```

Regole:

- Webhook verificato.
- Raw body per Stripe.
- Idempotenza.
- Persistenza subscription dedicata.
- Audit log.

## Auth e sicurezza

File critici:

```txt
backend/src/interfaces/http/middlewares/auth.ts
backend/src/interfaces/http/middlewares/csrf-protection.ts
backend/src/interfaces/http/middlewares/platform-ip-allowlist.ts
backend/src/app.ts
backend/src/shared/config/env.ts
```

Controlli:

- JWT robusti.
- CSRF.
- Rate limit.
- CORS ristretto.
- Helmet/security headers.
- Platform IP allowlist + OTP.

## Deploy

Path:

```txt
docker-compose.prod.yml
deploy/caddy/Caddyfile
deploy/env/*.example
.github/workflows/ci.yml
.github/workflows/deploy-production.yml
```

Produzione attuale:

- Caddy serve frontend e proxy API.
- Backend espone tenant API e platform API.
- PostgreSQL container con volume persistente.
- Env reali fuori repo in `/opt/fleetum/env/`.

## Docs

Aree principali:

```txt
docs/codex/*
docs/architecture/*
docs/deployment/*
docs/privacy/*
legal/*
```

Usare `docs/codex/FLEETUM_CODEX_MASTER_PROMPT.md` come regola permanente per Codex e collaboratori.
