# Fleetum

Fleetum is a multi-tenant SaaS platform for car rental companies, fleet operations, rental bookings, digital contracts, customers, vehicles, maintenance, deadlines, billing and platform governance.

## Stack

- Backend: Node.js, TypeScript, Express, Prisma, PostgreSQL.
- Frontend: React, TypeScript, Vite, Zustand, Tailwind, Recharts.
- Production: Docker Compose, Caddy, PostgreSQL, GitHub Actions.
- Payments: Stripe.
- Email: Resend/SMTP depending on environment.

## Repository Structure

```txt
/
├── backend              # Express API, Prisma, services, cron jobs
├── frontend             # React tenant app, public landing, platform console
├── deploy               # Caddy, env examples, backup scripts
├── docs                 # Architecture, deployment, Codex and compliance docs
├── legal                # Legal-ready document drafts and rental templates
├── app                  # Technical module contracts for legal/docs/storage/audit
├── .github/workflows    # CI and production deploy workflows
└── docker-compose*.yml  # Local, production and staging compose files
```

## Local Prerequisites

- Node.js 20+.
- npm 10+.
- Docker and Docker Compose.

## Local Setup

1. Prepare local Docker environment:

```bash
cp .env.local.example .env.local
```

2. Start PostgreSQL:

```bash
docker compose --env-file .env.local up -d
```

This starts the local PostgreSQL container as `fleetum_postgres` and exposes it on port `5433`.

3. Install dependencies:

```bash
npm ci
```

4. Configure environment files:

```txt
backend/.env
frontend/.env
```

Use example files and placeholder values. For local backend development, `DATABASE_URL` should point to:

```txt
postgresql://fleetum:fleetum_dev@localhost:5433/fleetum?schema=public
```

Never commit real secrets.

5. Initialize database:

```bash
npm run prisma:generate -w backend
npm run prisma:deploy -w backend
npm run prisma:seed -w backend
```

6. Start the tenant app:

```bash
npm run dev
```

7. Start the platform console locally:

```bash
npm run dev:platform
```

## Local Test Database

Backend tests that need a PostgreSQL database use the `fleetum_ci` database by default:

```bash
createdb -h localhost -p 5433 -U fleetum fleetum_ci
```

If you previously used the legacy local database from the old project, migrate data manually with a dump/restore into `fleetum` before deleting the old container or volume.

## Local URLs

- Tenant frontend: `http://127.0.0.1:5173`
- Platform frontend: `http://127.0.0.1:5174/platform.html`
- Tenant API: `http://127.0.0.1:4000/api`
- Platform API: `http://127.0.0.1:4100/platform-api`

## Quality Gates

```bash
npm run lint
npm run build
npm run test -w backend
git diff --check
```

GitHub Actions also runs secret scan, SAST, lint, build, backend tests, frontend tests, SEO artifact checks and dependency audit.

## Security Rules

- Do not commit `.env`, credentials, tokens or private keys.
- Keep production env files outside the repository.
- Protect tenant isolation on every business query.
- Platform Console is founder-only and protected by dedicated platform auth, OTP and IP allowlist.
- Stripe license/subscription changes must be driven by verified webhooks, not frontend redirects.
- Public endpoints must be validated, rate-limited and privacy reviewed.

## Deployment Overview

Production deploy is managed through GitHub Actions and Docker Compose on the VPS.

Core production domains:

- `fleetum.it`
- `www.fleetum.it`
- `api.fleetum.it`
- `platform.fleetum.it`

Read:

- `docs/deployment/production-checklist.md`
- `docs/deployment/production-deploy.md`
- `docs/deployment/github-branch-protection.md`
- `docs/codex/FLEETUM_CODEX_MASTER_PROMPT.md`

## Backups

Backup scripts live in `deploy/backup`:

- PostgreSQL logical backups.
- Upload/document archive backups.
- Restore runbook.

Local backup only is not enough for production. Configure offsite storage before serious commercial use.

## Compliance Docs

Legal/privacy/fiscal/security drafts are in `legal/` and `docs/privacy/`. These are legal-ready drafts and must be validated by qualified professionals before use with customers.

## Codex Operating Guide

Before making significant changes, read:

```txt
docs/codex/FLEETUM_CODEX_MASTER_PROMPT.md
```

All important changes should go through branch, PR, CI and review.
