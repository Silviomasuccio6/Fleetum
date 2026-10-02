# Fleetum — pacchetto di validazione staging, 2 ottobre 2026

**Pacchetto pronto per revisione locale. Avvio staging e rilascio non autorizzati.**
Il prossimo intervento locale è rendere affidabili i runner CI/E2E e il contenimento
degli effetti staging. Il candidato attuale presenta impedimenti verificati nei
sorgenti; non basta ottenere una risposta health o pubblicare il branch.

## Versione e perimetro

| Oggetto | Identità |
| --- | --- |
| Candidato applicativo congelato | `459ceed2f7b9a2ee1d2756d326c94dd23acde2e3` |
| Tree applicativo | `b06205c64c2352f24cb7e4afc38ff6448757abbb` |
| Parent con correzioni pagamenti | `e0cfa263015a630e19cb220f65fa889a84ecfb83` |
| Main usato per confronto | `db1f231dc8cb699f1a5ce4215a0278c93212d16d` |
| Branch del pacchetto | `codex/staging-validation-package` |
| Checkout isolato | `/Users/silvio/Documents/Playground/Fleetum-fix-scheduled-report-cursor` |

Questo branch aggiunge soltanto documentazione e un verificatore locale in questa
directory. Il suo commit finale è distinto dal candidato applicativo: viene
registrato nel rapporto di consegna e nel passaggio, senza riferimenti circolari.
**Nessuna modifica a backend, frontend, workflow, configurazione runtime, schema,
dipendenze o redesign; nessuna nuova migrazione.**

Sono stati confrontati i 852 file tracciati della copia di esecuzione con il
candidato, esclusi due artefatti generati noti (`frontend/tsconfig.tsbuildinfo`,
`website/next-env.d.ts`). Il confronto include backend, test, workflow, manifest,
lockfile e tutte le migrazioni. Non dichiara uno status globale dei percorsi iCloud
del checkout e non sovrascrive lavoro estraneo.

Non sono stati eseguiti nuovi test applicativi, CI hosted, SSH, chiamate provider,
letture di env reali, pagamenti/email, push, PR, merge o deploy. La configurazione
live, i segreti, le immagini disponibili e la release VPS restano non verificati.
Le letture di configurazione sono limitate a sorgenti ed esempi pubblici.

## Cosa contiene

- [Registro dei 19 gate](gate-register.json): ordine, dipendenze, proprietari da
  assegnare, PASS/FAIL, evidenze necessarie e condizioni prima della dispatch.
- [Modello di esecuzione](execution-record.template.json): tutti i risultati
  esterni sono pendenti; SHA, digest, run, soglie e autorizzazioni restano vuoti.
- [Analisi workflow](workflow-readiness.md): verifica indipendente dei trigger,
  guardie DB, build/deploy, provider, cron, host, noindex e recovery. I 57 checksum
  ispezionati sono riportati nel rapporto; il coordinatore collega la copia al Git.
- [Scenari di dominio](domain-scenarios.md): 17 gruppi DG, copertura dei finding,
  casi negativi e decisioni; ogni gate G esplicita i DG collegati nel registro. I DG sono scenari: il registro G è l'ordine operativo.
- [Inventario migrazioni](migration-inventory.json): 48 SQL congelati; sei aggiunte
  rispetto al main di confronto, impatto, precheck e rollback per ciascuna.
- [Indice evidenze](evidence-index.json): 154 artefatti delle ultime due tranche,
  contenuti ricontrollati e distinta provenienza delle prove.
- [Sorgenti ispezionati](inspected-source.json), [freeze del pacchetto](package-hashes.json)
  e [verificatore locale](validate-package.py): integrità e coerenza, senza azioni
  esterne. Un PASS di questo verificatore **non chiude i gate di esecuzione**.

I finding originali mantengono la classificazione: 26 corretti nel codice, BE-03 e
SEC-10 parziali, quattro finding del redesign escluso e cinque di marketing aperti.
INT-01..06 risultano corretti nelle tranche locali precedenti. Non è una
certificazione di sicurezza o di produzione.

## Prove ereditate e loro limite

| Prova locale già registrata | Sorgente | Risultato | Limite |
| --- | --- | --- | --- |
| Release e controlli mirati | `459ceed2` | 264 backend /44 frontend /9 website /31 operations; 13 test traduttore; lint/build/prerender/audit policy PASS | Non rieseguiti durante la preparazione; audit high/critical non equivale a zero advisory. |
| Browser/API con DB temporaneo | Freeze dei cinque file di `459ceed2` sul parent `e0cfa263` | 7/7, zero skip/retry/errori; 48 migrazioni, tenant sintetici A/B, HTTPS loopback | Il runner registra il parent in `sourceSha`: l'identità finale deriva anche dai manifest congelati e commit. NODE_ENV=test non prova proxy/cookie production. |
| PostgreSQL e concorrenza finanziaria | `e0cfa263` | 522/522, 48 migrazioni | Evidenza storica: backend, ops e configurazioni invariati nel candidato. Non nuovo run sul candidato, non sandbox provider e non restore legacy. |

I manifest storici contengono 75 e 79 file: tutti i 154 checksum sono stati
verificati durante questa preparazione. L'indice conserva i risultati con il loro
commit; non converte prove locali in risultati staging. Nessuna directory hosted
o staging viene riempita con risultati fittizi.

## Impedimenti prima di avviare staging

1. **Ambiente CI PostgreSQL incompleto.** La nuova suite lifecycle richiede
   `RUN_TENANT_ISOLATION_TESTS=1`, `NODE_ENV=test`, `DOTENV_CONFIG_PATH=/dev/null`
   e DB sintetico loopback. Il job CI non assegna i due flag mancanti
   RUN_TENANT/DOTENV; lo script locale assegna RUN_TENANT ma eredita DOTENV dal
   chiamante. Le assert della suite producono FAIL, non skip, prima della connessione.
   È una previsione fondata sul codice: nessuna CI hosted è stata eseguita qui.
2. **Identità realmente testata da CI.** Il trigger è solo push main/PR main;
   il checkout PR default può essere il merge ref mentre il controllo staging usa
   il metadato `run.head_sha`. Servono checkout attestato e percorso CI sicuro per
   il candidato. Non effettuare merge main per ottenere CI: può attivare produzione.
3. **E2E scollegati dalla release.** Nightly è separato, checkout non vincolato al
   deploy, gate minimo storico sei invece dei sette casi correnti. Richiedere SHA
   dei test, SHA/digest running e report completo della stessa release.
4. **Host e tenant non attestati.** Il validator usa una denylist, non l'allowlist
   staging; email diverse non provano tenant diversi o dati sintetici. Attestare
   i tre host staging, redirect/routing, tenant A/B e risorse isolate prima del test.
5. **Email e cron possono produrre effetti.** L'esempio usa Resend e destinatari
   Fleetum; il CMD production avvia i cron. Non esiste un toggle globale che
   spenga email/reminder/report. Predisporre e provare un controllo di contenimento
   e un sink/simulatore prima del primo avvio; privacy/dunning disabilitati, rete
   provider bloccata salvo successive prove sandbox autorizzate.
6. **Noindex effettivo mancante.** Il flag website della build non garantisce il
   frontend servito da Caddy: robots e sitemap frontend restano pubblici. Verificare
   e correggere risposta noindex/robots sullo staging prima dell'esposizione.
7. **Recovery e identità runtime da provare.** Staging non esegue backup o rollback
   automatici; i probe non controllano SHA/digest. Registrare digest distinti della
   build staging e versione precedente, manifest, lock, backup/restore e recovery.
   Tag SHA condivisi tra build production/staging non provano la stessa variante.

Questi punti sono incorporati nei gate G01/G02/G04/G05/G06/G14. Non vengono
corretti implicitamente da questo pacchetto: la prossima tranche di hardening
locale deve includere modifiche minime, prove di regressione e nuovo freeze.

## Ordine di lavoro e criteri

| Fase | Gate | Prima di dichiarare PASS |
| --- | --- | --- |
| Preparazione/review | G00 | Reviewer, SHA e rischi firmati; prove congelate e diff corrente. |
| Hardening pipeline | G01 | Ambiente PG sicuro, SHA checkout realmente attestato e binding E2E, test nuovi senza indebolire guardie. |
| Contenimento staging | G02 | Risorse/host/tenant distinti, email simulate, cron controllati, egress e noindex provati prima dell'avvio. |
| Decisioni prodotto/privacy | G03 | Owner e trattamento dei termini legacy/retention; nessuna inferenza di termini mancanti o default legali. Può procedere in parallelo alla preparazione tecnica. |
| Restore/migrazioni | G04 | PG temporaneo sintetico, legacy fixture, 42→48, duplicati rifiutati, importi e app precedente verificati, lock misurati. |
| CI esatta | G05 | Tutti check richiesti, suite persistenti eseguite, checkout e run del candidato; esecuzione hosted ancora da autorizzare. |
| Dispatch staging e identità | G06 | Autorizzazione separata, backup, digest/manifest/container coerenti e routing/health; nessuna risorsa production. |
| Accesso e flussi | G07–G09 | Revoca alla richiesta successiva/SLA, cookie/proxy/Platform, 7 E2E A/B e OAuth browserA/B/replay/provider reali di test. |
| Finanza, code, storage | G10–G12 | Sandbox autorizzata, effetti economici/audit coerenti, sink email/cron/cursori, create-only/quota/restore e legacy segregati. |
| Carico e recovery | G13–G14 | Profilo e soglie approvati prima: p95/errori/lock/queue, RTO/RPO; invarianti e rollback provati. |
| Chiusura dei residui | G15–G16 | Decisioni competenti e controlli dimostrati su legacy/retention, outcome ignoti, capture/release e refund/dispute. |
| Marketing | G17 | Filone separato; prima di campagne/Enterprise servono claim/pricing/consenso/misure approvati. |
| Decisione production | G18 | Tutti G00..G16 PASS, review finale e autorizzazione esplicita successiva. Questo pacchetto non autorizza merge/deploy. |

I PASS richiedono osservazioni ed evidenze, non solo una checkbox o l'accettazione
generica del rischio. Le soglie prestazioni e RTO/RPO sono **da concordare**, con
owner e data precedenti alla prova. Un esito non eseguito, dipendenza mancante o
provider non disponibile resta pendente. Qualunque variazione applicativa/workflow
richiede nuovo candidato e nuova correlazione CI/build/test, con gate pertinenti.

Il freeze attuale serve a preparare la validazione; non va passato ciecamente a
un workflow dopo averlo corretto su un altro commit. La nuova tranche aggiorna
il pacchetto al suo SHA finale e indica quali prove ha ripetuto e quali eredita.

## Migrazioni e rollback

La differenza rispetto al main di confronto è **42→48**, sei migrazioni già
presenti: OAuth, claim deposito attivo, retention payload email, atomicità
comandi/lease, deduplica email, cursore report. Gli SQL base non cambiano; sono
congelati nell'inventario. Il numero di migrazioni effettivo del DB staging va
osservato separatamente: il main storico non prova la versione live.

Gli indici sulle tabelle esistenti non sono concurrent: misurare lock e durata
su volume sintetico concordato. Prima della dispatch G04 include un piano fallback
provato in isolamento; G14 è la successiva esercitazione completa dello stack
staging, senza dipendenza circolare dal primo deploy. La barriera deposito rifiuta duplicati attivi:
non cancellare o scegliere arbitrariamente quale deposito conservare. Code
precomposte e upload storici non sono riparati dai nuovi filtri o ledger.

Il rollback applicativo usa i **digest precedenti realmente approvati** e lo
schema48 conservato, dopo una prova di compatibilità con client e worker coordinati.
Un parent locale non è automaticamente la release precedente di produzione.
Un rollback che reintroduce i difetti pagamenti richiede decisione esplicita.
Non eseguire DROP, down SQL, restore DB o reinvio PI/email come rollback automatico.
Restore DB/upload e riconciliazione degli effetti esterni sono percorsi separati.
Rollback del solo pacchetto: revert del commit documentale, nessun effetto runtime.

## Uso del verificatore locale

Con Python standard, senza installazioni, rete o env reali:

```sh
python3 docs/deployment/staging-validation-package-20261002/validate-package.py \
  --source-root . \
  --audit-root /Users/silvio/Documents/Playground/Fleetum-audit-20260909
```

Il record iniziale deve risultare coerente con **zero gate esterni PASS**.
Il verificatore controlla freeze, identità, delta SQL, dipendenze, hash degli
artefatti, dati obbligatori per CI/digest/E2E e soglie per carico/restore. Run ID devono essere
positivi; l’E2E registra anche i digest osservati durante la prova e una timeline UTC. Rifiuta
SHA errati, PASS senza evidenze, prerequisiti mancanti e percorsi fuori dal record.
Non attesta l'autenticità del run remoto o la sufficienza tecnica/legale dei
risultati: queste restano responsabilità dei reviewer.

Copiare il modello in una directory separata per una futura esecuzione autorizzata;
non modificare il freeze del pacchetto per far sembrare superato un gate. Ogni PASS
richiede owner, decisione, timeline UTC e almeno un artefatto redatto, revisionato
e hashato; per ciascuno scenario usare anche il template nel report di dominio.

```sh
python3 docs/deployment/staging-validation-package-20261002/validate-package.py \
  --record /private/tmp/fleetum-staging-run/execution-record.json
```

Non inserire nei record credenziali, cookie/token, header Authorization, state/code/
nonce/verifier OAuth, segreti webhook, URL firmati, body/PDF legacy personali o
dump/env reali. Conservare solo fixture sintetiche, metadata redatti, risultati,
counts, digest, run IDs e decisioni. Una trace di browser necessita revisione prima
di essere condivisa. La verifica locale non avvia provider, migration o deploy.

## Prossima azione concreta

Aprire una tranche **locale** di hardening CI/staging: correggere ambiente delle
prove PostgreSQL, identità checkout/candidato e binding E2E; rafforzare validazione
host/tenant, contenimento cron/email e noindex. Scrivere prima i test negativi,
preservare guardie tenant/Platform e trigger production, poi congelare il nuovo
candidato e aggiornare questo pacchetto. Push/PR/dispatch e provider sandbox
restano passaggi successivi da autorizzare, dopo un diff concreto e revisionabile.
