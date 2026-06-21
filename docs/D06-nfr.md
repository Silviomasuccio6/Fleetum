# D06 NFR

Stato: PRESENTE-PARZIALE

## Evidenze repository
- Timeouts e rate limit presenti nel codice:
  - `backend/src/app.ts`
  - `frontend/src/infrastructure/api/http-client.ts`

## Gap
- Catalogo NFR con SLO/SLA numerici: NON TROVATO
- Budget performance/capacity per produzione: NON TROVATO
- RTO/RPO formalizzati: NON TROVATO

## Remediation
- Must: tabella NFR (availability, latency, throughput, RTO, RPO, security, privacy).
- Owner suggerito: Solution Architect + DevOps Engineer
