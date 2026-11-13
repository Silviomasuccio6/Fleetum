# D06 NFR

Stato: PRESENTE-PARZIALE

## Evidenze repository
- Timeouts e rate limit presenti nel codice:
  - `backend/src/app.ts`
  - `frontend/src/infrastructure/api/http-client.ts`
- RPO 24 ore e RTO 4 ore formalizzati in `RUNBOOK.md` e `deploy/backup/README.md`.

## Gap
- Catalogo NFR con SLO/SLA numerici: NON TROVATO
- Budget performance/capacity per produzione: NON TROVATO
- SLO disponibilita/latency ed error budget: NON TROVATO

## Remediation
- Must: tabella NFR (availability, latency, throughput, RTO, RPO, security, privacy).
- Owner suggerito: Solution Architect + DevOps Engineer
