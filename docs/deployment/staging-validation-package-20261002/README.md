# Fleetum — pacchetto di revisione aggiornato, 5 ottobre 2026

**Pronto per revisione locale; nessuna dispatch o produzione autorizzata.**
Candidato sorgente `579d7171bc90f17a50489eee0ffe1b31521383d0`, tree `38c90293528e59e4956f212230f05d41028c1a8f`, branch `codex/verify-restore-rollback`.
Usare il ref `codex/restore-recovery-source-candidate`; il successivo commit
documentale è distinto e registrato nel rapporto esterno.

La tranche aggiunge un runner ripetibile per backup/ripristino su PostgreSQL16
temporaneo con dati sintetici. Corregge due falsi positivi degli strumenti: SQL
della compatibilità non inoltrato a Docker e restore che poteva eliminare un
target o dichiarare successo dopo errore. I percorsi dotenv sono rifiutati prima
di Prisma senza leggere contenuti; il restore richiede un target nuovo esplicito.

**Release finale 271/44/9/143**, zero failure/skip, lint/build/13prerender/audit
high-critical PASS. **Recovery 23/23 scenari e 27 asserzioni HTTP**: schema 42→48,
app storica su DB48, due ripristini con tutte le 67 tabelle e 2 file sintetici identici,
isolamento tenant/CSRF/download; target esistente, SQL errato, dump/file
manomessi o mancanti, duplicati deposito e timeout lock/statement rifiutati.
Durata 106248 ms; cleanup proprio verificato. Compatibilità base finale PASS 27 s.

Il tooling sopra è legato al candidato attuale. Gli archivi applicativi provati
sono `70fdfab3522907d9d956ac260224c165774e2af6` e baseline `db1f231dc8cb699f1a5ce4215a0278c93212d16d`; backend/frontend/schema/lockfile
e workflow production sono invariati rispetto al candidato precedente. La
baseline storica main precede i fix di sicurezza e **non è fallback approvato**.

Ereditati e separati: PG 522/522, browser 7/7 e proxy 21 HTTP/16 template del 3 ottobre,
senza dichiararli nuovi run. Isolamento email/cron, allowlist, noindex e pinCI/E2E
restano nel codice; nessuna nuova prova hosted CI, SSH, provider o staging reale.
Tutti i 19 gate esterni rimangono pendenti: **0/19 PASS**; owner, autorizzazioni e
budget restano vuoti. G04/G12/G14 ricevono prove preparatorie, non un PASS.

- [Runbook recovery](../restore-recovery-20261005.md), [isolamento](../staging-isolation-20261003.md), [CI/E2E](../ci-e2e-release-binding-20261002.md).
- [Registro](gate-register.json), [record pendente](execution-record.template.json), [evidenze](evidence-index.json).
- [Migrazioni](migration-inventory.json), [sorgenti](inspected-source.json), [freeze](package-hashes.json).

Limiti del recovery: fixture monetaria: 4 campi, non 35; chiavi storiche relative
`uploads/...`, non mapping al percorso assoluto staging o app storica su chiavi
moderne; bridge PG con egress container non bloccato, non rete internal staging.
Restano digest app/client precedenti approvati, health failure/restart stack,
RTO/RPO e budget lock, reconcile sandbox e decisioni legacy/privacy. Schema 48,
zero nuove migrazioni/dipendenze. Finding 37 invariati: 26 risolti/2 parziali/4 redesign/5 marketing;
INT01..06 corretti nel codice. Redesign e campagne restano separati.

Il verificatore controlla coerenza/hash e attestazioni obbligatorie, non autenticità
o sufficienza delle prove:

```sh
python3 docs/deployment/staging-validation-package-20261002/validate-package.py \
  --source-root . --audit-root /Users/silvio/Documents/Playground/Fleetum-audit-20260909
```

**Prossima azione locale:** completare la riconciliazione dei 35 campi monetari e
la matrice layout legacy/percorso assoluto su fixture sintetiche. Per chiudere i
gate esterni servono successivamente reviewer, operatori, soglie/versioni
approvate e autorizzazione distinta. Nessun merge/main/deploy automatico,
nessun down SQL o replay di effetti esterni.
