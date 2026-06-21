# D18 Observability Plan

Stato: PRESENTE-PARZIALE

## Evidenze repository
- Logging applicativo pino + morgan:
  - `backend/src/infrastructure/logging/logger.ts`
  - `backend/src/app.ts`
- Health/readiness endpoint implementati.

## Gap
- Correlation-id end-to-end: NON TROVATO (middleware request-context no-op)
- Tracing distribuito: NON TROVATO
- Metriche applicative centralizzate (latency, error budget): NON TROVATO
- Alerting operativo documentato: NON TROVATO

## Remediation
- Must: request-id/correlation-id obbligatorio e propagato.
- Must: metriche + alert 5xx/latency/saturation.
- Owner suggerito: DevOps + Tech Lead
