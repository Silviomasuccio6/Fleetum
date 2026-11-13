# Fleetum — recovery locale della versione aggiornata, 7 ottobre 2026

Questa prova aggiorna il [runner precedente](application-failure-recovery-20261005.md). Il redesign della UI resta rinviato. App/schema/package/lock provengono dalle correzioni verificate nel candidato dabbb8862cbce2c48bfafa0413781b35fb582348; il tooling e il commit documentale successivi hanno identità distinte.

## Scopo e limiti

Compilare il backend e il frontend in modalità produzione, congelare la coppia concreta e verificarne integrità e recupero sui quattro guasti controllati già previsti. La fixture esegue l'applicazione in NODE_ENV=test con configurazione sintetica, provider HTTP bloccati prima degli import, cron fermi e database temporaneo. Il build production non certifica il comportamento di runtime production, cookie HTTPS in un browser, host esterno o immagini OCI.

La riserva aggiornata è il codice dabbb886, incorporando inviti/reset, cambio password, OAuth client, revoca Platform e patch sharp. Il runner impone equivalenza applicativa con il nuovo tooling. Riavvia la stessa applicazione compilata di riserva: questa è una prova di recupero della coppia congelata, non uno switch verso una precedente release distinta approvata. Le riserve9bd/b533 e la baseline storica non sono fallback correnti approvati.

## Preparazione e comando

Usare Node22.23.1 nel PATH, npm cache locale, engine Prisma verificati e PostgreSQL16 già in cache. Nessun npm script lifecycle durante l'installazione offline, nessun pull. Lo SHA tooling completo deve essere sostituito dopo aver congelato i file; la directory di prove deve essere nuova, assoluta e canonica.

```sh
NODE_ENV=test DOTENV_CONFIG_PATH=/dev/null node ops/verify-restore-recovery.mjs \
  --source-sha <SHA_COMPLETO_TOOLING_VERIFICATO> \
  --baseline-sha db1f231dc8cb699f1a5ce4215a0278c93212d16d \
  --recovery-source-sha dabbb8862cbce2c48bfafa0413781b35fb582348 \
  --application-recovery --production-build \
  --git-dir /absolute/verified-local-object-store \
  --docker-host unix:///absolute/local/docker.sock \
  --evidence-dir /private/tmp/new-fleetum-recovery-evidence
```

La baseline ha42migrazioni e serve al confronto storico; l'applicazione corrente usa48. Non usare dati reali o un database persistente. NODE_ENV=production viene passato solo alle compilazioni reali; default e processi delle fixture restano test. Errori, interruzioni, risultati incompleti o cleanup fallito impediscono di dichiarare PASS.

## Stato di sicurezza e dati

Le nuove prove devono preparare la revoca Platform nel database corrente prima del dump schema48, attraverso il servizio applicativo effettivo. Il token della prova resta valido durante i restore e i guasti:401 deve derivare dalla revoca persistente, non dalla semplice scadenza. Una sessione indipendente resta ammessa. Bearer e password sintetici non vengono scritti nelle ricevute.

Confrontare gli snapshot canonici di tutte le tabelle e i bytes upload prima/dopo i due restore e ogni recupero applicativo. Le35grandezze monetarie della fixture devono essere coerenti nelle cinque fasi; INSERT copre il catalogo completo, UPDATE soltanto VehicleCost.amount. Conservare gli eventi PLATFORM_SESSION_REVOKED almeno fino alla scadenza del token.

Il manifest dist non include node_modules: l'evidenza della libreria immagini deve quindi identificare versioni native effettivamente caricate e hash dei binari. Richiedere sharp almeno0.35.5 e librsvg almeno2.63.2. Gli avvii che raggiungono listening devono fornire una ricevuta coerente; quelle della coppia fidata e dei recuperi devono coincidere. La prova backend non equivale a una prova Next se Next non è installato nell'archivio di recovery.

## Accettazione e cleanup

Richiedere result.success=true, quattro scenari riusciti, due restore completi, dati/file invariati, tutti gli smoke positivi/negativi e ricevute native valide. Manutenzione503 deve restare attiva finché readiness tenant/Platform, generazione corrente, coppia e dati non soddisfano la policy. Il solo health200 non basta.

Richiedere cleanup dei soli subprocessi/gateway/container/reti/scratch appartenenti al runner. Non usare prune o kill per prefisso. In caso di errore mantenere le prove e ripartire con una nuova directory; nessun restore automatico del database per correggere il guasto dell'applicazione, nessun down SQL o replay.

Budget30s e freschezza readiness1s sono limiti della fixture, non RTO/RPO/SLA approvati. Gli esiti, SHA e hash effettivi sono riportati nel nuovo rapporto di verifica, senza ereditare come nuove prove i risultati storici. Le19verifiche esterne restano aperte. Nessun push, merge, deploy, provider, email reale o pagamento è autorizzato da questo runbook.
