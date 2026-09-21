# D18 Observability Plan

Stato: PRESENTE-PARZIALE

## Evidenze repository

- Logging strutturato e HTTP: `backend/src/infrastructure/logging/logger.ts`, `backend/src/app.ts`.
- Request ID propagato e restituito nelle risposte: `backend/src/interfaces/http/middlewares/request-context.ts`.
- Redazione di token, credenziali e URL contratto nei logger e nelle label metriche, coperta da test.
- Health/readiness e metriche protette per API tenant e Platform.
- Metriche su HTTP, Prisma, auth, code email, storage, retention e restore drill.
- Platform Console espone lo stato dei sottosistemi; script di alert disco e backup supportano email/webhook.

## Gap e gate esterni

- Nessun tracing distribuito end-to-end.
- Collector, dashboard, alert rules e retention delle metriche effettivamente in uso non sono verificabili dal repository.
- SLO/error budget per disponibilita e latenza non sono formalizzati.
- La redazione applicativa non prova la configurazione dei log di reverse proxy, CDN o WAF ne' bonifica i log storici.
- Devono essere verificati in staging/produzione routing degli alert, owner, escalation e test di ricezione.

## Criterio di uscita

Prima del go-live devono esistere evidenze redatte per: metriche raccolte, alert 5xx/latency/saturazione/disco recapitato, retention dei log, sanitizzazione dei sistemi esterni e procedura di escalation con owner.
