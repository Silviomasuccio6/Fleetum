# Setup Staging (Punto 2)

## Obiettivo
Preparare un ambiente staging il piu possibile uguale alla produzione per validare login social, calendario, manutenzioni, scadenziario ed export.

## 1) Infrastruttura minima
- 1 istanza backend (Node 22 LTS)
- 1 frontend statico (build Vite)
- 1 PostgreSQL separato da produzione
- Reverse proxy HTTPS (Nginx/Caddy)

## 2) Configurazione ambiente backend (staging)
Copia `backend/.env.example` in `backend/.env` e imposta almeno:
- `NODE_ENV=production`
- `APP_URL=https://staging.tuo-dominio.it`
- `BACKEND_PUBLIC_URL=https://api-staging.tuo-dominio.it`
- `CORS_ORIGIN=https://staging.tuo-dominio.it`
- `PLATFORM_CORS_ORIGIN=https://platform-staging.tuo-dominio.it`
- `TRUST_PROXY=1` (se dietro un reverse proxy, ad esempio Caddy/Nginx)
- Segreti robusti e univoci (`JWT_SECRET`, `PLATFORM_JWT_SECRET`, password admin)

## 3) Configurazione ambiente frontend (staging)
Copia `frontend/.env.example` in `frontend/.env`:
- `VITE_API_BASE_URL=https://api-staging.tuo-dominio.it/api`
- `VITE_PLATFORM_API_BASE_URL=https://api-staging.tuo-dominio.it/platform-api`
- `VITE_CLIENT_APP_URL=https://staging.tuo-dominio.it/dashboard`
- `VITE_GOOGLE_AUTH_URL=https://api-staging.tuo-dominio.it/api/auth/google`
- `VITE_APPLE_AUTH_URL=https://api-staging.tuo-dominio.it/api/auth/apple`

## 4) OAuth staging (fondamentale)
In Google Cloud Console e Apple Developer aggiungi le redirect URI staging:
- `https://api-staging.tuo-dominio.it/api/auth/google/callback`
- `https://api-staging.tuo-dominio.it/api/calendar/google/callback`
- `https://api-staging.tuo-dominio.it/api/auth/apple/callback`

## 5) Deploy e validazione
1. `npm ci`
2. `npm run build`
3. `npm run prisma:deploy -w backend`
4. avvio backend (`npm run start -w backend`)
5. deploy frontend `frontend/dist`
6. verifica:
   - `GET /api/health`
   - `GET /api/ready`
   - login standard/social
   - CRUD fermi/manutenzioni
   - calendario + export

## 6) Dati test
- Carica dataset realistico ma anonimizzato.
- Mai usare dump produzione con dati personali non mascherati.
