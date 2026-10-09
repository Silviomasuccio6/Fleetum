# Fleetum — compilazione production e recupero locale, 7 ottobre 2026

## Identità ed esito delle prove completate

Candidato di tooling `ecb8816f27222cb4e5411f94083a2059da81a213`, tree `d7c959e3b45101ffafde4a33f8f93b460e4f25e3`, branch `codex/verify-production-recovery-20261007`. Applicazione e riserva `dabbb8862cbce2c48bfafa0413781b35fb582348`: il confronto attesta **557 percorsi applicativi invariati**, 0 nuove dipendenze e 0 nuove migrazioni. Il tooling aggiunge la compilazione esplicita e le prove di sicurezza; la riserva ricompilata conserva la stessa applicazione e i fix correnti. Nessuna release precedente distinta o coppia OCI approvata è stata collaudata. Main resta `db1f231dc8cb699f1a5ce4215a0278c93212d16d`. Il commit documentale successivo sarà distinto dal candidato testato.

I risultati qui riportati derivano dal result JSON completo e dai receipt finali, con sorgenti congelate uguali prima/dopo i due gate. Recovery: **49 controlli e 169 asserzioni HTTP**, durata complessiva 146676 ms, **4 scenari** e **2 restore**. Release: **715/715 test**, backend 348, frontend 93, website 9, operations 265; zero failure/skip, comando verify:release concluso con codice 0. Review statica indipendente e confronto root coprono esattamente 11 file di tooling/runbook; il PASS runtime è attestato separatamente.

## Compilazione e runtime

Il recovery ha invocato `--application-recovery --production-build` con i due SHA fissati. Le compilazioni backend/frontend ricevono `NODE_ENV=production`; installazione, generazione, database e subprocessi fixture conservano **NODE_ENV=test**, dotenv `/dev/null`, ambiente sintetico e provider HTTP bloccati. La prova non certifica il comportamento runtime NODE_ENV=production. Il sito Next non è il client frontend ricompilato e recuperato da questo runner: **il recupero del sito Next resta non coperto**. La release verifica separatamente i propri build, senza trasformare queste prove locali in installazione staging o produzione.

## Guasti, restore e dati riconosciuti

| Scenario | Recovery locale ms | Record riconosciuti persi | Tabelle conservate | Upload conservati |
|---|---:|---:|---:|---:|
| startup-rejected | 1212.416 | 0 | 67 | 4 |
| database-unready | 1462.027 | 0 | 67 | 4 |
| pause-before-import | 1031.298 | 0 | 67 | 4 |
| client-artifact-mismatch | 971.086 | 0 | 67 | 4 |

Ogni scenario mantiene manutenzione finché backend/client fidati, entrambe le readiness e i dati conservati consentono la riapertura. Gli hash prima/dopo di tutte le tabelle e dei byte upload coincidono; la pagina, JavaScript e CSS sono restituiti dai byte inventariati. La coppia include **189 file backend e 148 file frontend**, con manifest separati nel bundle. Il pair dist backend/frontend è congelato e recuperato durante il run, poi lo scratch viene cancellato: la consegna conserva manifest, hash e prove, **non i binari dist, immagini OCI o una nuova release pronta a installazione/pubblicazione**. Il conteggio dei record cresce legittimamente fra gli scenari per login/audit e scritture dello smoke: il confronto di perdita è per ciascun punto di guasto, non fra scenari diversi.

I restore first/second coincidono con lo snapshot schema48 prima dell'avvio degli smoke; migrazioni storiche 42 → 48, senza nuove migrazioni in questa tranche. Denaro: 35 campi, 13 tabelle e 206 coppie campo/riga; mismatch zero e hash stabile attraverso 5 fasi. Matrice storage: 8 combinazioni. Restano i limiti della fixture su magnitudini/calcoli, UPDATE monetario parziale e compatibilità storica dei soli layout legacy; il JSON completo conserva i dettagli.

## Revoca Platform persistente

Prima del dump schema48 il servizio applicativo reale esegue un logout sintetico e persiste l'evento autorevole. Digest e scadenza dell'evento coincidono dopo entrambi i restore; il sibling non viene revocato. Ogni smoke compilato prima/dopo i guasti richiede **401 PLATFORM_SESSION_REVOKED** per il bearer ancora valido e **200** per quello indipendente. I bearer sono ricostruiti dalla fixture e non inclusi nel bundle; il receipt conserva soltanto conteggi, expiry e digest dell'evento. Non è una prova di logout su host/repliche reali né di uno SLA approvato.

## Stack immagini realmente caricato

| Risoluzione nell'archive | Stato osservato | Sharp | librsvg | Binari inventariati |
|---|---|---|---|---:|
| backend | verified | 0.35.5 | 2.63.2 | 2 |
| Next | verified | 0.35.5 | 2.63.2 | 2 |

La verifica carica lo stack risolto dall'archive, rende un SVG sintetico in PNG limitato e registra addon/shared-library con SHA256 e dimensioni. Le identità delle versioni e dei binari devono coincidere a ogni processo che dichiara listening e prima del recupero. La risoluzione nativa Next sopra è distinta dalla copertura del recupero del sito Next. Sono prove del runtime sul sistema locale, senza attacco exploit, immagine Linux/OCI, runtime live o monitoraggio continuo dei binari dopo il caricamento. Manifest dist e manifest nativi restano separati.

## Cleanup, provenienza e limiti aperti

Cleanup del result: container removed-and-verified, rete removed-and-verified, scratch removed, figli fermati True, gateway chiuso True; il receipt root aggiunge il controllo read-only dell'assenza dei residui propri. Il bridge dedicato consente egress del container: il blocco HTTP della fixture non prova una policy staging deny-egress.

Bundle primario `evidence/20261007-production-build-recovery`: receipt, log finali, review, script di esecuzione/confezionamento congelati, diff, test RED/GREEN e manifest degli artefatti; result JSON ricorsivo da run-final e i quattro file espliciti della delivery del worker. Sono inclusi **soltanto i 2 dump e 4 upload PDF sintetici dichiarati dai backup manifest**, con hash/dimensioni verificati e i relativi `.manifest.json`; nessun glob generico include SQL/PDF. Archivi installati, node_modules, binari dist, file non dichiarati e segreti/bearer serializzati sono esclusi. SHA256SUMS verifica integrità dei contenuti, non autenticità o sufficienza indipendente. Script di confezionamento consegnato e congelato incluso per ripetibilità; SHA256 `2f5862600d14d713ac842b955c5b68b7091e711293f957909719c66280a22350` verificato prima delle scritture.

**0/19 gate esterni PASS**. Hosted CI, DNS/TLS/edge, staging reale, provider, browser/E2E nuovi, owner, budget approvati, soglie RTO/RPO/SLA, fallback OCI distinto e autorizzazioni rimangono aperti. Il limite locale di 30000 ms è un bound di test e non una soglia approvata. Nessun push, PR, merge, dispatch, SSH o deploy è attribuito a questa tranche; nessun env reale o dato personale applicativo usato. La precedente prova PostgreSQL completa/client-browser resta storica: non viene ricontata come nuova esecuzione di questo tooling.

Registro originale dei **37 finding invariato**: 26 risolti nel codice, 2 parziali, 4 nel redesign e 5 nel marketing; BE-03 e SEC-10 restano parziali. Questa tranche verifica il recovery della stessa applicazione aggiornata, senza aggiornare decisioni o stato dei gate esterni. Le prove precedenti restano conservate nel registro con la loro identità e i loro limiti.

La nuova UI è rinviata per decisione dell'utente. La prossima tranche locale ricontrollerà i residui di sicurezza/privacy e lo storico, poi review/CI e staging con autorizzazioni distinte; non è richiesta implementazione in questa consegna.
