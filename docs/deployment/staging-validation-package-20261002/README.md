# Fleetum — recupero applicativo verificato localmente,5ottobre2026

**Pronto per revisione locale.** Candidato `b5332ca5d9100c82cc4c6ffb5ba4c2f8e86a650c`, tree `2fa16975b0b50800d16a6aff0926293cf4d9656b`, branch `codex/verify-application-failure-recovery`, ref `codex/application-recovery-source-candidate`. Documento di chiusura eHEAD separati. Correzioni in11file ops/fixture/test; backend/frontend/schema/dipendenze/workflow production invariati. Non integrato redesign.

**Release598/598** (308backend/44frontend/9website/237operations), lint/build/13prerender/auditPASS; **recovery46/46+153HTTP**. Quattro guasti reali locali: config invalida, health200/dbunready, startupSIGKILL, client errato conAPIpronta. Riserva9bd security-equivalente, mantenimento in manutenzione fino a verifiche della coppia/ready/dati. Riapertura1.3–1.9s;67tabelle e4upload invariati. Denaro35campi/13tabelle/206coppie in5fasi, due restore e8layout. PostgreSQL16.13 tmpfs sintetico; processi/gateway/container/network/scratch rimossi. Prima provaFAILconservata, causa/verificatore corretto e run finale distinto.

FullPG522/522 è ereditato, non nuovo run. Browser7/7 storico; nessun nuovo browser/Platformlogin. ImmaginiOCI e release precedente distinta non testate; hash frontend differisce tra build indipendenti: prova sulla coppia concreta congelata dentro il run. Budget30s nonSLAapprovato. Backend reserve invariato e tutte le appfix preservate per confronto imposto.

**0/19gate esterni PASS.** Reviewer/owner, control/versioni/digest effettivi e budget/approvazioni restano da definire. CIhosted, staging, provider, storage/mountlive e osservabilità live da verificare previa autorizzazione distinta. Finding originali37 invariati:26corretti,2parziali,4redesign,5marketing. Nessun push/PR/dispatch/SSH/merge/deploy/main/env reale/email/pagamento.

- [Nuovo runbook](../application-failure-recovery-20261005.md), [denaro/storage](../money-storage-compatibility-20261005.md), [restore](../restore-recovery-20261005.md).
- [Registro](gate-register.json), [record pendente](execution-record.template.json), [evidenze](evidence-index.json).
- [Migrazioni](migration-inventory.json), [sorgenti](inspected-source.json), [freeze](package-hashes.json).

```sh
python3 docs/deployment/staging-validation-package-20261002/validate-package.py \
  --source-root . --audit-root /Users/silvio/Documents/Playground/Fleetum-audit-20260909
```

Il validator controlla coerenza/hash, non autenticità/sufficienza di prove. **Prossimo passo:** revisione umana integrata e definizione di release/digest/owner/budget per eventuale staging separato. Non usare merge main per avviare CI.
