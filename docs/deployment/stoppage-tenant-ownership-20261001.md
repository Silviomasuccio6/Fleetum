# Fleetum — ownership dei fermi

Tranche del 1 ottobre 2026. Branch `codex/fix-stoppage-tenant-ownership`, parent
`469a9904db645d9d08b9eda3e9aef4c5436ff852`. Nessuna migrazione o backfill.
Solo implementazione e verifiche locali: nessun push, merge, deploy o provider reale.

## Comportamento e compatibilita'

- Creazione e aggiornamento autorizzano sede, veicolo, officina, creatore e
  assegnatario nello stesso tenant prima di scrivere o restituire relazioni.
- Nuovi collegamenti richiedono riferimenti esistenti e non cancellati. Le risorse
  inattive dello stesso tenant restano ammesse secondo il comportamento corrente.
  Lo stesso vale per un assegnatario sospeso ma non cancellato: questa patch non
  introduce una regola di assegnazione nuova rispetto all'interfaccia esistente.
- Riferimenti storici dello stesso tenant gia' cancellati restano consultabili e
  consentono note, chiusura e rimozione del fermo. Il creatore e' immutabile.
  Non viene introdotto il vincolo sede del veicolo uguale a sede del fermo.
- Tenant, ID, contatori, timestamp interni, relazioni annidate e creatore in PATCH
  non sono campi scrivibili dal chiamante del repository. Il tenant deriva sempre
  dal contesto autorizzato. I contatti snapshot restano override espliciti gia'
  supportati; non vengono sovrascritti con il contatto corrente dell'officina.
- Parent di altro tenant o legacy con riferimenti incoerenti sono rifiutati nelle
  mutazioni e filtrati nelle letture prima di paginazione, conteggio e aggregazione.
  Nessuna riparazione automatica dei dati legacy.
- Eventi richiedono parent e attore coerenti. Eventi di sistema senza attore e
  attori storici cancellati dello stesso tenant restano leggibili. Solo l'evento
  DELETED puo' essere aggiunto dopo soft deletion, per preservare l'audit esistente.
- Reminder figli ed eventi FINAL_COST richiedono anche il proprio tenant; gli
  eventi con attore straniero/mancante sono esclusi. Lo storico reminder di parent
  softdeleted resta visibile nei consumer che gia' lo mostravano.
- Sono protette letture repository, calendario/costi/assegnazioni, notifiche,
  dashboard/analytics/team/officine, report periodici, consuntivi e downtime nella
  profitability, oltre alle foto del fermo e al riferimento di manutenzione preventiva.
- Il metodo legacy markReminderSent richiede ora tenantId, non modifica altri
  tenant e non riapre CLOSED/CANCELED. Non ha chiamanti di produzione attuali;
  producer e worker email mantengono i propri controlli licenza/lifecycle.
- Discovery globale dei reminder restituisce solo ID e tenant: la preparazione
  protetta autorizza risorse, creatore e assegnatario prima dell'enqueue e il
  dispatcher li verifica prima di ogni nuovo avvio provider. Utenti sospesi o
  softdeleted dello stesso tenant restano ammessi come riferimenti storici.

L'esclusione dei legacy incoerenti riguarda nuovi invii e operazioni ordinarie.
Una receipt provider gia' salvata o un invio gia' avviato e poi accettato conserva la semantica
della tranche precedente: sola finalizzazione locale tenant-scoped, senza reinvio
o trasformazione in FAILED per un successivo cambio di eligibility. CLOSED e
CANCELED restano tali; parent softdeleted non riceve incrementi dei contatori,
parent missing/foreign non riceve mutazioni. Si registra la storia dell'invio e,
se necessario, localFinalizationSkippedReason. Una receipt attesta accettazione
provider, non consegna al destinatario.
Se il provider rifiuta l'invio senza receipt, rimane valido il normale retry con
backoff; non si presume che un invio soltanto iniziato sia stato accettato.

## Transazioni e schema

Le mutazioni usano lock PostgreSQL sul tenant e sul fermo, poi sui riferimenti
prima della scrittura. SHARE impedisce cancellazione o cambio ownership concorrente
dei riferimenti durante la transazione. La creazione serializza sul veicolo anche
la decisione di duplicato aperto. Errori di ownership restituiscono 404 uniforme,
campi protetti 400 e duplicati 409, senza effetti di dominio o eventi sul target estraneo.

Lo schema ha FK globali per ID e due ID utente scalari privi di FK. Il controllo e'
applicativo: nessuna garanzia contro SQL diretto o codice esterno che bypassa i
repository. La lettura degli ID utente si basa su tenantId immutabile nelle API
attuali, include utenti cancellati per lo storico e non usa cache fra richieste.
Eventuale trasferimento utenti tra tenant richiede una progettazione separata.
Le query con IN utenti vanno misurate con tenant di dimensioni realistiche.

Nella sola guard reminder gli utenti storici sono verificati con una lettura in
transazione, senza row lock: il fermo bloccato fissa gli ID, tenantId utente e'
immutabile nelle API e sospensione/soft deletion non invalidano questi riferimenti.
Resta il fence Tenant UPDATE per tenant legacy senza subscription. Prendere User
SHARE dopo quel fence creava un deadlock reale con AuthSessionService (User UPDATE
prima della FK Tenant di AuditLog). La prova dedicata usa una sessione auth reale
e il provider simulato. I nuovi collegamenti nei create/update mantengono User
SHARE per bloccare la cancellazione concorrente. Trasferimenti e hard-delete SQL
esterni alle API richiederebbero un protocollo diverso: non si promette una
linearizzazione dei reminder rispetto a tali operazioni esterne.

## Verifiche e gate prima di una release

La suite dedicata `backend/tests/security/stoppage-tenant-ownership.test.ts`
usa PostgreSQL temporaneo e dati sintetici: foreign/missing/deleted su create e
update, ID utente, campi protetti/nested injection, legacy nelle letture e nei KPI,
storico valido, eventi/chiusura/rimozione, marker reminder e cancellazioni concorrenti.
I report vengono accodati con CSV/PDF sintetici; nessun invio reale.

Comandi riproducibili dalla radice, con runtime supportato e env di test isolato:

```sh
npm run verify:database
npm run verify:release
npm audit --omit=dev --json
git diff --check
```

`verify:database` crea PostgreSQL 16 su loopback, applica le migrazioni da zero e
rimuove il proprio ambiente. Consultare le evidenze della tranche per ambiente,
comandi esatti e risultati; nessun gate viene dedotto da un'esecuzione precedente.

Prima della produzione: review umana, CI sullo SHA finale, staging con due tenant
sintetici, test foto con storage di staging, prove concorrenti di carico e misura
latenza/contesa. Verificare eventuali fermi legacy esclusi con accesso amministrativo
autorizzato, senza esportare dati personali o correggere associazioni per supposizione.
Restano separati ownership Vehicle→Site, guard/atomicita' notifiche extra e gate
esterni precedenti; questa tranche non certifica l'intera release o il VPS live.
Il sink preventiveDue filtra ora anche la sede del veicolo; le altre API del
dominio veicoli richiedono comunque la tranche separata Vehicle→Site.

SCHEDULED_REPORT e REMINDER_EMAIL gia' PENDING conservano body e, per i report,
allegati precomposti prima della patch. I nuovi filtri proteggono la composizione
futura, senza certificare la provenienza dei vecchi contenuti, neppure quando i
riferimenti del fermo vengono successivamente corretti. Il dispatcher non
ricostruisce il testo gia' in coda. Prima del rollout serve verifica ed eventuale
quarantena autorizzata delle code precedenti, senza cancellazione o replay
automatico e senza esportare dati personali. Le code in staging devono usare
solo destinatari e dati sintetici.

## Rollback

Rollback solo applicativo, senza schema da ripristinare. Il parent riintroduce
l'accesso ai riferimenti legacy incoerenti e il vecchio marker puo' riaprire fermi
chiusi: valutare questa regressione prima di ripristinarlo. Coordinare API e worker,
evitando versioni sovrapposte durante transazioni in corso. Nessun replay, ripristino
massivo di dati, riapertura di FAILED o modifica dello stato monetario automatica.
