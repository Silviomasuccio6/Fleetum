# Fleetum — revisione integrata e credenziali,6ottobre2026

**Pronto per revisione locale.** Candidato `add3438cc17e23a29a45aad71282e296f45072a1`, tree `c213e764e6e52ebe34a9bdd3e3566010916d0905`, branch `codex/fix-invite-activation-security-20261006`, ref `codex/invite-profile-security-source-candidate`. HEAD documentale distinto. Due vulnerabilità High e una dipendenza Critical corrette: invito soloINVITED monouso e cambio password conCAS tenant/stato/hash precedente; invalidazione reset e revoca atomiche. Contratto logoutAllDevicesfalse conservato. Zero migrazioni/UI/productionworkflow nuove; override proxy-addr2.0.8 e unica voce lock aggiornata, nessuna nuova dipendenza.

**Release624/624**(334backend/44frontend/9website/237ops), lint/build/13prerender/auditPASS; **PostgreSQL540/540**(522regressioni+18nuoveprove), zero fail/skip. Barriere reali ai preflight e PIDwaiterPostgreSQL per entrambi ordini password/refresh; replaynegato, tenantB invariato, rollbackvero. PrimaPG538PASS conservata. SignerJWTstub, auditfailureunit soltanto; niente nuovaauthHTTPS/browser. PG16temporaneo, dotenvdevnull, cleanenv ecleanup.

**0/19gate esterni PASS.** Reviewer/owner, target/control/digest, workload e soglie non approvati. [Scheda decisioni](../staging-decision-packet-20261006.md) con proposte chiaramente non approvate, recoverylock e inputprecisi. [Rapporto integrato](../../verification/integrated-security-review-20261006.md). Vecchia riserva9bd e candidatob533 precedono nuovi fix: NON fallbackequivalenteattuale. Recovery46/153HTTP e browser7 precedenti sono storico, NON rieseguiti. Buildtestfrontend nonartefattorelease; serve pairproductionimmutabile.

Registrooriginale37:26nelcodice/2parziali/4redesign/5marketing; INT01..06 eREV01/02 corretti nelcandidato, senza certificazione produzione. Nuove decisioniPlatform/CSP/callbackUI/Next/fallback documentate. Nessun push/PR/merge/dispatch/SSH/deploy/provider/envreale/email/pagamento.

- [Registro](gate-register.json),[record pending](execution-record.template.json),[evidenze](evidence-index.json).
- [Migrazioni](migration-inventory.json),[sorgenti](inspected-source.json),[freeze](package-hashes.json).
- Runbook recupero precedente: [application-failure-recovery](../application-failure-recovery-20261005.md), storico da rieseguire sul nuovo pair.

```sh
python3 docs/deployment/staging-validation-package-20261002/validate-package.py --source-root . --audit-root /Users/silvio/Documents/Playground/Fleetum-audit-20260909
```

Il validator prova coerenza ehash, non autentica le evidenze né assegna approvazioni. Non merge/pushmain per avviareCI: può avviare produzione. Prima di attività esterne definire e approvare i perimetri della scheda.
