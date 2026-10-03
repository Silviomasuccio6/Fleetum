# Fleetum — pacchetto staging aggiornato, 3 ottobre 2026

**Pronto per revisione locale; nessuna dispatch o produzione autorizzata.**
Candidato sorgente `70fdfab3522907d9d956ac260224c165774e2af6`, tree `0bf8de49e2da4437115c084bf78e3484715fde7d`, branch `codex/fix-staging-isolation`.
Il commit documentale finale è distinto e registrato nel rapporto esterno; usare il ref
`codex/staging-isolation-source-candidate` per il sorgente esatto, non implicitamente HEAD documentale.

CI/E2E della tranche precedente restano validi nel codice. La baseline staging ora blocca
email/provider e cinque cron, valida prima di Prisma, fissa progetto/rete/path, osserva
policy/internal membership, limita target, autentica due tenant distinti e applica noindex
anche a robots/sitemap/errori. Controlli SSH presi da checkout trusted separato e pin protetti
workflow/release obbligatori; preflight metadata rifiuta symlink/ownership/orfani. Trace/video off.

Release locale **271/44/9/85**, PostgreSQL **522/522**, proxy locale **21HTTP/16template** PASS.
Browser/API locale **7/7**, preflight reale e retries0 sul candidato corretto; primo erroreloader conservato.
Queste prove non sono hosted CI o staging reale. G01 e G02 sono **PENDING** review/esecuzione,
non PASS. Nessun gate esterno è stato eseguito: **0/19 PASS**, owner e autorizzazioni restano vuoti.
Le chiavi provider anche sandbox e i custom path precedenti non sono ammessi nella baseline;
reset/inviti che richiedono consegna email necessitano di una futura prova sandbox/sink approvata.

- [Runbook isolamento](../staging-isolation-20261003.md) e [CI/E2E](../ci-e2e-release-binding-20261002.md).
- [Registro](gate-register.json), [record pendente](execution-record.template.json), [prove](evidence-index.json).
- [Migrazioni](migration-inventory.json), [sorgenti](inspected-source.json), [freeze](package-hashes.json).

I report workflow/scenari storici restano consultabili; i gap di codice chiusi sono superati dai
runbook correnti. Restano host/storage/dati/egress/routing e protezioni reali, provider sandbox,
restore/migrazioni/carico e decisioni legacy/privacy. Schema48, zero nuove migrazioni/dipendenze;
main/VPS live non equivalenti. Finding37 invariati26risolti/2parziali/4redesign/5marketing; INT01..06
corretti nel codice. Redesign e campagne separati.

Il verificatore controlla coerenza/hash e attestazioni obbligatorie, non autenticità o sufficienza:

```sh
python3 docs/deployment/staging-validation-package-20261002/validate-package.py \
  --source-root . --audit-root /Users/silvio/Documents/Playground/Fleetum-audit-20260909
```

**Prossima azione:** review del candidato esatto e preparazione del collaudo restore/migrazioni
con soglie e responsabilità definite. Attività esterne richiedono autorizzazione successiva.
Nessun merge/main/deploy automatico; rollback per revert riesaminato, senza downSQL o side effect.
