# Fleetum — revisione denaro/storage, 5 ottobre 2026

**Tranche locale pronta per revisione.** Candidato codice `9bd57ff2f935a3a56205f381b41d35bfc982dd9a`, tree `601334fb1bb051abe9f0caabddc7f00027f28021`, branch `codex/verify-money-storage-compatibility`, ref `codex/money-storage-source-candidate`. Il successivo commit documentale resta distinto.

Corretto il mapping dei file storici con root upload assoluta; prefissi duplicati e symlink vengono rifiutati. La firma grafica PDF e l'inventario ora usano lo stesso resolver/provider. Chiavi e bytes esistenti non vengono riscritti. Nessuna migrazione o dipendenza nuova, schema48 invariato. Prima dell'adozione serve inventario dei mount e dei symlink live; nessuna produzione verificata.

**Recovery30/30 +57HTTP**,35campi/13tabelle/206coppie in4fasi con hash identico,8combinazioni storage e due ripristini di67tabelle/4file;107725ms. **Nuovo gatePG522/522**, operations182/182, zero failure/skip. Release308/44/9/182,543test, lint/build/13prerender/audit PASS: eseguita su bfb110ce; il solo delta finale corregge la fixture del runner. Sorgenti applicativi equivalenti; operations e recovery rieseguiti sul candidato finale. Vedere release-equivalence.json.

App corrente archivio `9bd57ff2f935a3a56205f381b41d35bfc982dd9a`, baseline storica db1f231d. La vecchia app è provata soltanto con chiavi legacy relative e precede i fix sicurezza: **non è fallback approvato**. Il verificatore ufficiale prova35INSERT, UPDATE solo VehicleCost.amount. Null subscription solo nella preparazione; attachment monetari nuovi metadata senza file. Valori rappresentativi, non tutti i calcoli commerciali.

Browser7/7 e proxy21HTTP/16template restano prove storiche; nessun nuovo browser, CI hosted, SSH, provider o staging. S3mock, inventario fakePrisma e PG bridge non provano provider/live o denyegress. Nessun merge/deploy/main/env reale/email/pagamento.

**0/19gate esterni PASS**; owner, autorizzazioni e budget vuoti. G04/G12/G14 ancora PENDING: restano inventario legacy/mount live, versioni/digest app-client approvati, healthfailure/restart stack, RTO/RPO/lock e reconcile sandbox. Finding37:26risolti/2parziali/4redesign/5marketing; conteggio originale invariato.

- [Runbook denaro/storage](../money-storage-compatibility-20261005.md), [recovery precedente](../restore-recovery-20261005.md), [isolamento](../staging-isolation-20261003.md).
- [Registro](gate-register.json), [record pendente](execution-record.template.json), [evidenze](evidence-index.json).
- [Migrazioni](migration-inventory.json), [sorgenti](inspected-source.json), [freeze](package-hashes.json).

Il verificatore controlla coerenza/hash, non autenticità o sufficienza della prova:

```sh
python3 docs/deployment/staging-validation-package-20261002/validate-package.py \
  --source-root . --audit-root /Users/silvio/Documents/Playground/Fleetum-audit-20260909
```

**Prossimo passaggio:** revisione del candidato e piano concreto del fallback applicazione/client e guasto controllato, con versioni e soglie da definire prima di qualunque futura dispatch. Le attività esterne richiedono autorizzazione distinta; non usare merge main per avviare CI.
