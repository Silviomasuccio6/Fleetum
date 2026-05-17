# D11 Security Plan + Threat Model

Stato: PRESENTE-PARZIALE

## Evidenze repository
- Helmet/CORS/rate-limit/error handler:
  - `/Users/silvio/Downloads/Gestione-Fermi-master-2/backend/src/app.ts`
- CSRF middleware:
  - `/Users/silvio/Downloads/Gestione-Fermi-master-2/backend/src/interfaces/http/middlewares/csrf-protection.ts`
- Login guard + IP allowlist platform:
  - `/Users/silvio/Downloads/Gestione-Fermi-master-2/backend/src/application/services/platform-login-guard-service.ts`
  - `/Users/silvio/Downloads/Gestione-Fermi-master-2/backend/src/interfaces/http/middlewares/platform-ip-allowlist.ts`

## Gap
- Threat model STRIDE/LINDDUN formalizzato: NON TROVATO
- Security plan con ownership e periodicita test: NON TROVATO
- SAST/DAST continuo in CI: parziale/assente (SAST NON TROVATO)

## Remediation
- Must: threat model per superfici auth/upload/public links.
- Must: security test plan con frequenza.
- Owner suggerito: Security Engineer
