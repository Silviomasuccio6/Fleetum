# Proposta di rilascio limitato — non eseguita

## Vincolo reale

Il frontend production osservato è l'immagine `sha256:f45eee091eca06f8745ed94096eb9ebe06d79bc2c6ab41d1575405195d49f6eb`, tag `db1f231dc8cb`. La base locale associata al tag è `db1f231dc8cb699f1a5ce4215a0278c93212d16d`. La tag non prova da sola la corrispondenza riproducibile dei sorgenti e dei parametri pubblici di build.

Main GitHub è stato verificato in lettura il13 novembre: `c46ede5140d26e736de5b77dab190750504f80c3`. Rispetto alla base ha431 file modificati. La policy corrente in `ops/production-release-policy.mjs` richiede main, workflow fidato, rilascio/checkout/controlli allo stesso SHA completo, approvazione protetta e CI push/main riuscita sullo stesso SHA. Il workflow completo pubblica backend e frontend e applica migrazioni. Non usare il vecchio workflow presente nel checkout db1 per aggirare i controlli correnti.

Il solo commit UI su base db1 non è quindi immediatamente promuovibile dal workflow corrente. Una PR in bozza può servire alla revisione, non costituisce approvazione per integrarlo o rilasciarlo. Il confronto merge-base della PR non dimostra da solo il contenuto completo del deployment.

## Pacchetto locale già preparato

`evidence/overlay-manifest.json` elenca41 file raggiungibili dal nuovo platform.html, inclusi i due loghi originali, con SHA256. Una prova locale applica quei file a una build pulita della base db1:180 file esistenti rimangono byte-identici; fra i file preesistenti cambia soltanto platform.html; zero collisioni di asset con nome identico e contenuto diverso. I nuovi asset hanno nomi distinti. Sito/tenant mantengono HTML e vecchi riferimenti agli asset.

L'anteprima compilata5214 usa questo montaggio e soltanto API sintetiche locali. NON è un'immagine costruita sui file estratti dalla produzione e NON è un deploy staging.

## Percorso proposto da revisionare

1. Pubblicare il candidato UI in una PR in bozza, indicando base e limiti. Eseguire i controlli remoti senza merge né deploy. Preservare il backend/auth nuovo di main: eventuali conflitti non vanno risolti reintroducendo il logout locale su main.
2. Chiudere il controllo delle dipendenze della base: audit frontend attuale3high/2moderate, non introdotte dal restyling. React Router è nella closure Platform; Axios/Zod/follow-redirects non risultano nella closure preparata, ma questo non autorizza a sopprimere il gate del repository. La soluzione e i test vanno approvati in una tranche circoscritta, senza aggiornamenti automatici generali.
3. Identificare e, solo con autorizzazione valida, confrontare gli asset statici reali della produzione e i parametri pubblici di build. L'esportazione completa di /srv/fleetum è stata rifiutata dalla revisione automatica perché contenuti/sensibilità non verificati e consenso alle letture insufficiente. Nessuna esportazione eseguita, nessun tentativo alternativo per aggirare il rifiuto. Non leggere env, configurazioni sensibili, DB, log utenti o uploads.
4. Revisionare un percorso di consegna dedicato che mantenga le protezioni esistenti: immagine frontend derivata dal digest attivo immutabile, aggiungendo soltanto la closure Platform e platform.html; nessun cambio backend/DB/migrazioni/website. Se il processo richiede modifica alla policy, proporla esplicitamente come modifica di governance con propri test, riferimenti fidati e approvazioni: non implementata in questo branch e mai bypass manuale. La ricetta non è ancora un job pronto da eseguire.
5. Collaudare il candidato esatto con API compatibili e dati sintetici in ambiente isolato protetto. Lo staging corrente ha backend più nuovo di production: non sostituire silenziosamente il suo client Platform con un contratto di logout precedente. Preparare la compatibilità senza indebolire sessioni/IP/OTP. Il Nightly tenant esistente non sostituisce il collaudo Platform.
6. Prima del via libera finale: SHA completo, CI e revisione, prova della closure contro l'immagine reale, esito sicurezza e staging, immagini parent/target/rollback immutabili, componenti effettivamente sostituiti, durata/revoca di eventuali accessi temporanei, approvazione personale di Silvio.

## Rollback richiesto

Per il rilascio limitato proposto: conservare il digest frontend attivo e la configurazione corrente; tornare alla precedente immagine frontend con la stessa protezione/lock/readiness del processo approvato. Backend, database e uploads non devono essere sostituiti o ripristinati. Verificare Platform, login tenant e sito dopo il ritorno. Non esiste ancora un rollback eseguito di questa tranche, né un'immagine target pubblicata.

## Stato dei gate

- Integrazione e revisione locale: concluse nei limiti di CHECKS.md.
- Pubblicazione/PR/CI remota: non eseguite.
- Audit dipendenze base: NON superato (3high,2moderate).
- Confronto con asset effettivi production: aperto, esportazione rifiutata.
- Pipeline limitata conforme: proposta, non implementata.
- Collaudo staging Platform e produzione: non eseguiti.
- Nessun merge, deploy, nuovo accesso amministrativo o modifica live autorizzati implicitamente dalle prove locali.
