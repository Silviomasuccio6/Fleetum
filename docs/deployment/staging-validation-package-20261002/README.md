# Fleetum — privacy e storico, 8 ottobre2026

Candidato `dbe8ada7d9f1a66b14dd0c4bc0ab3a5f46e90600`, tree `2d50f467364c83c7cc8d57e40490760d1a62b159`, branch `codex/fix-privacy-history-20261008`, ref `codex/privacy-history-source-candidate`; HEAD documentale distinto. [Rapporto](../../verification/privacy-history-security-20261008.md).

PostgreSQL **564/564**, release **766/766** (372/107/9/278), browser compilato/API sintetiche **4/4**. Zero fail/skip, lint/build/prerender/audit PASS. Export per soggetto, upload/edit cliente serializzati con erasure, pricing storico preservato, cron paginato e audit dipendenze fail-closed.

**0/19 gate esterni PASS**. BE-03/SEC-10 parziali; registro originale37 invariato26/2/4/5. Nuova UI rinviata. Nuova riserva/recovery da verificare perché l'applicazione è cambiata; risultati7 ottobre storici. Nessun push/merge/deploy/provider/env reale. Browser API simulate, nessuna attestazione staging o produzione.

[Registro](gate-register.json), [record](execution-record.template.json), [evidenze](evidence-index.json), [migrazioni](migration-inventory.json), [sorgenti](inspected-source.json). Il validator controlla coerenza/hash; non assegna owner o autorizzazioni. Nessun merge main per avviare CI.
