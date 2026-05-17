# Fleetum

Gestionale multi-tenant per fermi veicoli, manutenzioni, scadenziario, calendario operativo e console piattaforma.

## Stack
- Backend: Node.js + TypeScript + Express + Prisma
- Frontend: React + TypeScript + Vite + Zustand
- Database: PostgreSQL 16

## Prerequisiti
- Node.js 20+
- npm 10+
- Docker + Docker Compose

## Setup rapido locale
1. Avvia PostgreSQL:
   ```bash
   docker compose up -d
   ```
2. Installa dipendenze:
   ```bash
   npm ci
   ```
3. Configura ambiente:
   - copia `backend/.env.example` in `backend/.env`
   - copia `frontend/.env.example` in `frontend/.env`
4. Inizializza DB:
   ```bash
   npm run prisma:generate -w backend
   npm run prisma:deploy -w backend
   npm run prisma:seed -w backend
   ```
5. Avvia applicazione:
   ```bash
   npm run dev
   ```

## URL locali
- Frontend gestionale: `http://127.0.0.1:5173`
- Frontend platform console: `http://127.0.0.1:5174/platform.html`
- Backend API: `http://127.0.0.1:4000/api`
- Platform API: `http://127.0.0.1:4100/platform-api`

## Health/Readiness
- `GET /api/health`
- `GET /api/ready`
- `GET /platform-api/health`
- `GET /platform-api/ready`

## Quality gate locale
```bash
npm run lint
npm run build
npm run test -w backend
npx tsx --test frontend/tests/**/*.test.ts
npm audit --omit=dev --audit-level=high
```

## Sicurezza operativa minima
- Non committare file `.env` o credenziali.
- Imposta segreti robusti in produzione (`JWT_SECRET`, `PLATFORM_JWT_SECRET`, `PLATFORM_ADMIN_PASSWORD`, OAuth secrets).
- Configura `CORS_ORIGIN`, `PLATFORM_ALLOWED_IPS`, `TRUST_PROXY` per ambiente reale.
- Usa HTTPS terminato su reverse proxy e `NODE_ENV=production`.

## CI
Pipeline GitHub Actions disponibile in `.github/workflows/ci.yml`.
