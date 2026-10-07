# Fleetum — sicurezza client/Platform, 7 ottobre 2026

Candidato `dabbb8862cbce2c48bfafa0413781b35fb582348`, tree `cef82dfa74ff1e024fb95132a718c1f8794bfac8`, branch `codex/fix-client-platform-security-20261007`, ref `codex/client-platform-security-source-candidate`. HEAD documentale distinto. [Rapporto](../../verification/client-platform-security-20261007.md).

PostgreSQL **552/552**, release **696/696** (348/93/9/246), zero failure/skip; build production, lint/prerender/audit PASS. Callback da auth/me, revoca Platform persistente con retry e guardie contro risposte obsolete, routing Next/SPA staging e CSP basale cumulativa. Browser/API sintetici e Caddy locale attestati separatamente.

**0/19 gate esterni PASS**. Storage bearer client e CSP script/produzione restano aperti; privacy/legacy, riserva aggiornata, recupero sul nuovo pair e target/operatori/budget/autorizzazioni pendenti. Nessun push/merge/deploy/provider/env reale. Registro originale di 37 finding: 26/2/4/5, redesign e marketing separati.

[Registro](gate-register.json), [record](execution-record.template.json), [evidenze](evidence-index.json), [migrazioni](migration-inventory.json), [sorgenti](inspected-source.json). La [scheda del 6 ottobre](../staging-decision-packet-20261006.md) è storica per l'identità candidato: il presente README/registro e il rapporto 7 ottobre prevalgono. Le soglie allora proposte restano non approvate. I precedenti recovery/browser tenant non sono nuove prove di questo SHA.

```sh
python3 docs/deployment/staging-validation-package-20261002/validate-package.py --source-root . --audit-root /Users/silvio/Documents/Playground/Fleetum-audit-20260909
```

Il validator controlla coerenza/hash; non autentica evidenze né assegna owner o approvazioni. Nessun merge main per avviare CI.
