# Fleetum — revisione cumulativa PR 143, 9 ottobre 2026

La revisione parte dal candidato `f8716ca4e65b6e410b44b05e665253733016117e`, confrontato con la base `db1f231dc8cb699f1a5ce4215a0278c93212d16d`. Le correzioni descritte sono locali e successive a quel candidato. Questo documento non identifica un futuro commit né una release distribuita.

## Copertura effettiva

Sono contabilizzati tutti i **332 percorsi modificati** dell'inventario originale: **45 account/sicurezza + 56 frontend/website/E2E + 128 operations/schema/documentazione + 103 backend business**. I metodi sono diversi: la copertura non significa lettura integrale di ogni riga preesistente o prova runtime di ogni comportamento.

| Artefatto di copertura | Metodo e confine |
| --- | --- |
| `account-coverage.json` | 45/45 file letti integralmente, diff cumulativi e ambito dei test; anche due test business adiacenti. |
| `client-coverage.json` | 56/56 diff cumulativi: 46 con fonte corrente integrale, 10 con contesto d'integrazione delle modifiche. Nessuna prova di ambiente live. |
| `ops-coverage.json` | 128/128 percorsi contabilizzati: 53 fonti integrali, 1 diff integrale dello schema, 44 Markdown con struttura/hash ed estratti di affermazioni, 6 JSON con struttura/identità/gate, 23 test con inventario/struttura/sintassi, 1 lockfile interamente analizzato. |
| `business-source-coverage.json` | 52 sorgenti: 45 revisionati direttamente con fonte integrale oppure diff integrale e contesto modificato; 7 delegati e chiusi dall'artefatto rental. |
| `rental-business-coverage.json` | 7/7 sorgenti rental: diff cumulativi completi, codice modificato e integrazioni; nessuna pretesa di lettura di tutte le righe legacy dei grandi controller. |
| `business-tests-coverage.json` | 49/49 test letti integralmente, incluse fixture, mock, guardie, asserzioni e cleanup. I due test esclusi da questo inventario sono quelli letti dal revisore account: 52 sorgenti + 49 test + 2 adiacenti = 103 percorsi business. |

Gli artefatti registrano hash del candidato originario e, separatamente, quelli delle correzioni. I nuovi test di rimedio non aumentano il denominatore storico di 332. La successiva revisione incrociata delle correzioni C1/B01/B02/rollback copre 10 file con hash esatti e non ha individuato un'ulteriore regressione P1/P2 concreta.

Il pacchetto staging storico ha **663 artefatti verificati per integrità degli hash**, non 663 contenuti manualmente revisionati. La validazione strutturale del pacchetto e il precedente confronto separato di 174 percorsi sorgente/migrazione restano prove distinte; il validatore senza `--source-root` non dimostra corrispondenza dei sorgenti correnti. Dopo queste correzioni i metadata correnti identificano 144 file ispezionati e 48 migrazioni (192 percorsi); il pin applicativo storico resta invariato.

## Difetti riprodotti e correzioni locali

| Riferimento | Difetto e comportamento corretto | Prova già raccolta |
| --- | --- | --- |
| **A01** | Il POST Apple `form_post` veniva respinto dal CORS prima del callback. Eccezione solo nell'app tenant, sul POST esatto `/api/auth/apple/callback`, per origine Apple o `null`; cookie browser, state monouso, provider/intent e nonce restano obbligatori. Platform e altre combinazioni conservano i controlli. | RED: due nuovi test bootstrap falliscono con 500 invece di redirect. GREEN: 72 test mirati, zero fallimenti; typecheck backend e controllo diff passati. Router business e scambio provider sintetici, middleware reale. |
| **C1** | Il form React demo ometteva `consentAnalytics`, quindi il nuovo backend sopprimeva l'evento collegato al lead anche con consenso. Ora il flag deriva una sola volta dal contesto consentito; consenso assente/rifiutato e DNT restano senza contesto/evento. | RED: 3 passati/1 fallito. GREEN: 4/4, zero skip. Callback/helper reali e contratto backend reale; browser, trasporto e hashing sintetici. |
| **B01** | I template pubblici mantenevano virgolette in mittente/cron, mentre Compose `format: raw` le conserva letteralmente. Valori resi compatibili nei due file di esempio. | RED: payload mittente errato in entrambi e cron backend non valido. GREEN: entrambi validi con factory email e validatore cron reali, SDK sintetico. Nessuna email inviata. |
| **B02 — P1** | La perdita dell'acknowledgement COMMIT poteva cancellare irreversibilmente file già collegati da una transazione riuscita. Una ricevuta completa dei nuovi metadati verifica tenant/provider/bucket/tipo/ID/chiave/checksum/dimensione e recupera il risultato senza ripetere il callback. | RED iniziale: 6 passati/4 falliti. GREEN finale: 13/13, zero skip; typecheck mirato passato. Repository/storage sintetici. Tre nuovi casi PostgreSQL sono stati letti e typechecked; esecuzione persistente finale ancora da registrare. |
| **OPS-P1-01** | Staging pubblicava gli stessi tag SHA della produzione, pur costruendo frontend differenti. Ora usa `staging-<SHA completo>`; deploy e prove runtime continuano a usare digest esatti e revisioni OCI. | RED: 4 passati/1 collisione. GREEN: 44/44 controlli correlati, zero skip, con script effettivi e Git sintetico. |
| **OPS-P2-02** | Il rehearsal accettava uno SHA dichiarato senza verificare HEAD o checkout. Il preflight ora richiede HEAD esatto, radice corretta e stato iniziale pulito, inclusi file non ignorati non tracciati, prima di allocare risorse. | RED: cinque casi accettati impropriamente. GREEN: 14/14 fra source-proof e opzioni, zero skip, con repository privati e Docker simulato. |
| **OPS-P2-03** | Il rollback precedente conservava anche tag mutabili: limite ereditato, riprodotto su base e candidato. Ora salva esclusivamente digest del repository atteso ricavati dall'ID dell'immagine in esecuzione e verificati contro lo stesso ID. | RED: 8 passati/8 falliti. GREEN: 27/27 fra deploy, runbook e identità release, zero skip. Comandi Docker e stato di release sintetici. |

Per **B02**, ricevute assenti, parziali, incoerenti o illeggibili producono `503 UPLOAD_COMMIT_UNCERTAIN`: i file vengono conservati e richiedono riconciliazione. I rollback accertati prima del completamento e gli errori di serializzazione mantengono la compensazione. Il nuovo test PostgreSQL verifica commit reale seguito da errore sintetico di acknowledgement, metadati/relazioni/byte e rollback del callback; non simula una vera interruzione di rete del database.

Per **OPS-P2-03**, uno stato precedente con tag viene **rifiutato prima di qualsiasi comando Docker di rollback**; non esiste fallback che risolva il tag corrente. Digest mancanti, ambigui o discordanti impediscono backup/migrazione/restart. Un vecchio stato richiede conversione operativa separatamente revisionata, senza inventare l'identità storica. Il rollback applicativo non ripristina automaticamente database o upload.

Le correzioni documentali eliminano il percorso relativo `--evidence-dir` rifiutato dal parser, mostrano lo SHA HEAD effettivo e distinguono le prove storiche dalla nuova verifica iniziale. I riferimenti ai runbook in `domain-scenarios.md` diventano relativi e portabili. Il **preflight iniziale non è un freeze dopo il build** e non attesta assenza di modifiche durante l'esecuzione.

La scansione ha inoltre riprodotto un falso positivo sul checksum del test OAuth nel manifest. La allowlist aggiunge solo quel percorso sorgente enumerato, con AND fra manifest esatto e intera riga digest SHA256; le regole predefinite restano abilitate. Una prova separata rileva tutte le 11 credenziali sospette generate a runtime, anche nei due manifest.

## Verifiche finali e limiti

Le prove sopra sono quelle mirate già conservate, eseguite con Node 22.23.1 e risorse sintetiche isolate; non vengono sommate come un nuovo gate completo. Al momento della redazione restano da registrare **release completa, suite PostgreSQL temporanea e CI finale sul candidato congelato**. I risultati CI precedenti riguardano il loro SHA e non certificano questi nuovi byte. Il coordinatore aggiungerà comandi, log ed esiti effettivi dopo il freeze.

Non sono stati provati Apple OAuth con browser/provider live, staging, Resend, Stripe o registry/rollback operativi. Restano i limiti già documentati: confini fra endpoint, snapshot legacy, configurazioni privacy/retention e controlli browser/Platform live. I gate formali staging restano **0/19 promossi**; revisione e mock non autorizzano installazione, merge o deploy. Questa tranche non aggiunge migrazioni, schema o dipendenze e non modifica ambienti reali.

Le evidenze dettagliate, RED/GREEN, comandi, hash per file e limiti sono nel bundle audit esterno `/Users/silvio/Documents/Playground/Fleetum-audit-20260909/evidence/20261009-full-pr-review`: i sei JSON di copertura sopra, `account-review.md`, `client-review.md`, `business-env-review.md`, `business-tests-review.md`, `rental-business-review.md`, `ops-review.md` e `final-security-diff-review.md`. Il rapporto conclusivo del coordinatore collegherà anche i log dei gate completi e il controllo CI finale, senza reinterpretare quelli storici.
