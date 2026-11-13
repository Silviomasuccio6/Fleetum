# Fleetum — restore e compatibilità locale, 5 ottobre 2026

Questa tranche prepara il recovery con PostgreSQL16 temporaneo e dati sintetici.
Non autorizza CI ospitata, SSH, staging reale, merge o produzione. I worker restano
fermi; non viene eseguito down SQL, replay di pagamenti o consegna email.

## Identità e ambiente

- Branch locale `codex/verify-restore-rollback`, parent documentale `8352030ba213ad55ab06910ca9ee1fc65a61c21e`.
- App/schema di confronto candidato `70fdfab3522907d9d956ac260224c165774e2af6`, 48 migrazioni.
- Baseline storica locale `db1f231dc8cb699f1a5ce4215a0278c93212d16d`, 42 migrazioni.
- La baseline non attesta la versione live e non è un fallback approvato: reintroduce
  codice precedente alle correzioni di sicurezza. Il commit del runner verificato è
  registrato nel rapporto esterno e distinto dagli SHA delle app archiviate.
- Node22.23.1/npm10.9.8, dipendenze dal lock con installazione offline.
  Node usa DOTENV_CONFIG_PATH=/dev/null; Prisma CLI opera su archivi senza dotenv e
  la verifica compatibilità rifiuta la presenza dei percorsi dotenv prima delle CLI.
  Nessuna lettura di env reali, dati personali o configurazioni provider.

## Correzioni dei falsi positivi

`verify-migration-compatibility.sh` inoltra ora l'heredoc SQL con `docker exec -i`,
usa psql `-X` e blocca i percorsi dotenv prima di Git/Docker/Prisma, senza leggerli.
I processi Node con ambiente pulito ricevono DOTENV_CONFIG_PATH=/dev/null. Il nuovo
controllo comportamentale riproduceva il mancato inoltro prima del fix.

`restore-db-test.sh` richiede quattro argomenti espliciti e un target `fleetum_restore_...`.
Crea soltanto un database nuovo: se esiste, fallisce senza eliminarlo. Ripristina
SQL fidato con `ON_ERROR_STOP=1` in una singola transazione. In caso di errore resta
un target non riuscito, da trattare come tale; il runner elimina il proprio container.
Nessun DROP o cleanup di target non posseduti viene aggiunto all'helper.

L’helper accetta un plain SQL dump fidato senza cambio database o controllo di
transazioni; non è un sandbox per SQL proveniente da terzi. I vecchi default che
puntavano al container applicativo non sono più ammessi. Il workflow VPS usa invece
`deploy/backup/restore-postgres-test.sh` e non viene modificato o eseguito qui.

## Ripetibilità

Nel checkout che contiene il runner verificato:

```sh
npm run verify:restore-recovery -- \
  --source-sha 70fdfab3522907d9d956ac260224c165774e2af6 \
  --baseline-sha db1f231dc8cb699f1a5ce4215a0278c93212d16d \
  --evidence-dir /tmp/fleetum-restore-evidence-new
```

Per una copia di esecuzione senza .git, aggiungere `--git-dir` con un object store
locale verificato. Il runner rifiuta argomenti incompleti e socket Docker remoti;
prepara archivi e database temporanei propri. PostgreSQL usa un bridge Docker
dedicato con unico container attestato e pubblicazione su loopback: la rete non è
internal per permettere alle fixture Node sull'host di accedere al database. Il
container PostgreSQL non ha un blocco egress; il blocco HTTP delle fixture impedisce
chiamate ai provider durante gli smoke. Questa configurazione non prova la rete
internal né la policy egress dello stack staging. Le evidenze sono sintetiche e non sono
backup operativi di produzione. Consultare il result JSON per ogni scenario realmente
eseguito, cleanup, misure e limitazioni; il log di un solo backup non prova un restore.

## Layout dei file verificato

Le fixture mantengono le chiavi storiche `uploads/<tenant>/...` e usano
`UPLOAD_DIR=uploads` relativo nei due archivi temporanei. Ogni smoke copia e
ricontrolla soltanto i propri file sintetici; DB e chiavi non vengono riscritti.
Questa prova non dimostra che il codice storico possa leggere chiavi moderne,
né verifica il passaggio dalle chiavi legacy al percorso assoluto dello storage
staging. La mappatura dello storage reale resta nei gate G04/G12/G14.

## Impatto e rollback

Nessun nuovo schema, migrazione, backfill o dipendenza applicativa. Per ritirare le
modifiche operative, riesaminare/revertire il commit del runner; ciò non ripristina
né elimina database. Tornare al vecchio helper riapre il rischio di falso successo
ed eliminazione del target. Non rimuovere i sei vincoli/ledger/cursori dello schema48
per simulare un rollback dell'app. Il restore dei dati è una procedura distinta,
con perdita potenziale di scritture e riconciliazione degli effetti esterni.

## Limiti e gate

Le misure locali non definiscono RTO/RPO o budget di lock operativi. G04 e G14 restano
PENDING finché owner, soglie, digest app/client precedenti approvati, storage e stack
staging effettivi non sono verificati. La copertura monetaria delle fixture non è
una prova esaustiva dei 35 campi monetari su dati rappresentativi. I risultati locali
non autorizzano il riavvio di worker vecchi o la rimessa in invio di code legacy.
