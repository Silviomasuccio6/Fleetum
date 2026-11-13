# Fleetum — compatibilità monetaria e storage, 5 ottobre 2026

Questo runbook descrive le verifiche della tranche successiva al recovery locale.
L’esito effettivo va letto nelle evidenze della singola esecuzione: questo documento
non dichiara superate prove su PostgreSQL, HTTP, staging o produzione.

Le prove usano soltanto dati sintetici, archivi Git identificati da SHA completi e
risorse temporanee possedute dal runner. Non autorizzano merge, deploy, modifica di
provider, lettura di env reali, invio email, pagamenti o riavvio di worker.

## Identità da registrare

Prima dell’esecuzione registrare commit e tree del tooling, SHA del candidato
applicativo, SHA della baseline e hash dei file effettivamente eseguiti. Il commit
documentale finale può essere diverso dal commit del candidato applicativo.

La baseline storica `db1f231dc8cb699f1a5ce4215a0278c93212d16d` contiene 42 migrazioni;
il candidato di confronto contiene 48 migrazioni. Il runner controlla ascendenza,
immutabilità delle migrazioni già presenti e delta additivo. Node richiesto:
22.23.1; PostgreSQL: immagine locale PostgreSQL16, senza pull di immagini.

La baseline non identifica la versione live e non è un fallback approvato: precede
correzioni di sicurezza. Provare una vecchia applicazione su uno schema aggiornato
dimostra soltanto la compatibilità dei percorsi realmente esercitati.

## Denaro: catalogo e oracle della fixture

Il catalogo autoritativo resta
`backend/src/domain/money/exact-money-fields.ts`. La fixture lo carica dallo stesso
archivio dell’app tramite il loader TS; non usa una lista alternativa tratta da
`dist` e non introduce un nuovo algoritmo di riconciliazione.

I 35 campi appartengono a 13 tabelle. Ognuno conserva il Float legacy e la shadow
Decimal corrispondente, con suffisso `Exact`:

| Tabella | Campi verificati |
| --- | --- |
| TenantSubscription | priceMonthly |
| Vehicle | purchasePrice, residualValue, monthlyFixedCost |
| VehicleCost | amount |
| VehicleMaintenance | cost |
| VehicleMaintenanceAttachment | invoiceTotalAmount |
| RentalBooking | expectedTotal, finalTotal |
| RentalPriceList | baseRateAmount, vatRate, discountPercent |
| RentalExtraKmPolicy | flatRatePerKm |
| RentalExtraKmTier | ratePerKm |
| RentalBookingPricingSnapshot | baseRateAmount, vatRate, discountPercent, extraKmEstimatedCost, extraKmActualCost, expectedSubtotal, expectedTaxAmount, expectedTotal, finalSubtotal, finalTaxAmount, finalTotal |
| Stoppage | estimatedCostPerDay |
| Invoice | subtotal, taxRate, taxAmount, total |
| InvoiceItem | unitPrice, subtotal, taxRate, taxAmount, total |

Le dodici tabelle senza unicità per tenant ricevono tre scenari in ciascuno dei due
tenant: decimali positivi rappresentativi, zero, null dove ammesso. Nei campi
obbligatori il terzo scenario conserva zero. Le relazioni collegano soltanto righe
del medesimo tenant. Gli importi restano realistici e aliquote/sconti tra 0 e 100.
Le aspettative Decimal sono stringhe letterali e includono arrotondamenti a due e
quattro decimali; l’oracle non arrotonda valori binari in JavaScript.

TenantSubscription permette una sola riga per tenant. La preparazione verifica
null in entrambe le rappresentazioni, poi conserva A decimale e B zero negli
snapshot. Il null di subscription è quindi una prova di preparazione distinta,
non un null mantenuto attraverso le quattro fasi. La fixture persiste 72 nuove
righe nelle altre tabelle e aggiorna due subscription: ogni fotografia contiene
**206 coppie campo/riga**. `InvoiceItem.quantity` e
`RentalBookingPricingSnapshot.daysCharged` sono frazioni non monetarie e restano
esclusi dalle 35 coppie del catalogo.

## Quattro fasi e ricevute richieste

| Fase | Stato database | Criterio di accettazione |
| --- | --- | --- |
| schema42 | Schema storico e fixture sintetica | 35 campi/13 tabelle/206 coppie conformi alle aspettative |
| schema48 | Stesso database dopo le sei migrazioni additive | Stesso hash monetario e zero mismatch |
| first-restore | Primo nuovo database da dump schema48 | Stesso hash monetario e fotografia completa delle tabelle |
| second-restore | Secondo nuovo database dallo stesso dump | Stessi hash, inventario e bytes registrati |

Gli snapshot estraggono il Float e il Decimal come testo PostgreSQL, identificano
le righe della fixture e controllano il tenant; per InvoiceItem il tenant deriva
dalla fattura collegata. I report persistono conteggi per campo e un hash canonico,
senza importi. Duplicati, righe mancanti, tenant errato, Float alterati, Decimal
alterati o null incoerenti fanno fallire la verifica.

Nelle quattro fasi eseguire anche gli strumenti ufficiali dell’archivio corrente:

- `backend/src/scripts/reconcile-exact-money.ts`: ogni campo deve avere righe
  effettivamente presenti, zero mismatch e una sola ricevuta finale con 35 campi.
- `backend/src/scripts/verify-exact-money-dual-write.ts`: verifica INSERT per tutti
  i 35 campi in 13 tabelle e UPDATE per `VehicleCost.amount` soltanto. La ricevuta
  aggregata non prova gli UPDATE degli altri 34 campi. Le righe
  temporanee create da questo comando vengono rimosse nella sua transazione.

Un exit code zero o una tabella vuota non bastano per dichiarare copertura. Le
ricevute vengono validate dal runner e i test negativi verificano che log incompleti,
duplicati o conteggi di tipo errato non producano un falso successo.

## Storage: otto combinazioni locali

La matrice del provider corrente combina due radici `UPLOAD_DIR` con quattro
rappresentazioni di chiave. Ogni caso usa un proprio albero temporaneo, files di A/B,
manifest con dimensione e SHA256 e due materializzazioni da backup identiche.

| Radice | Layout | Chiave rappresentativa |
| --- | --- | --- |
| Relativa | modern | tenants/tenant-a/vehicle-booklets/example.pdf |
| Relativa | legacy | uploads/tenant-a/vehicle-booklets/example.pdf |
| Relativa | modern-direct | tenant-a/vehicle-booklets/example.pdf |
| Relativa | legacy-tenants | uploads/tenants/tenant-a/vehicle-booklets/example.pdf |
| Assoluta temporanea | modern | tenants/tenant-a/vehicle-booklets/example.pdf |
| Assoluta temporanea | legacy | uploads/tenant-a/vehicle-booklets/example.pdf |
| Assoluta temporanea | modern-direct | tenant-a/vehicle-booklets/example.pdf |
| Assoluta temporanea | legacy-tenants | uploads/tenants/tenant-a/vehicle-booklets/example.pdf |

La radice assoluta è una directory sintetica nel task, anche quando il suo nome
richiama il percorso previsto per staging. Non è la directory reale di staging.

La materializzazione conserva le chiavi nel database e rimuove un solo prefisso
storico `uploads/` nel percorso fisico. Richiede un tenant riconoscibile e un
manifest univoco; rifiuta duplicazioni che convergono sullo stesso oggetto, digest
errati, file mancanti, traversal e symlink. Non sceglie silenziosamente un file
alternativo. Il provider deve leggere il file atteso, proteggere la creazione da
sovrascritture, creare nuove directory, cancellare in modo idempotente e lasciare
intatto il file dell’altro tenant. Una copia alternativa ambigua deve produrre
errore.

La matrice filesystem non verifica autorizzazioni HTTP e non usa un database. Le
prove HTTP del runner sono evidenze separate: login di A/B, readiness, letture
tenant, scrittura autorizzata con CSRF, download consentito al proprietario con hash
dei bytes e rifiuto per altro tenant o anonimo. Registrare distintamente quali
download usano chiavi legacy e quali moderne e quale radice è stata usata.

La vecchia app viene provata soltanto con chiavi legacy e radice relativa. Non
estendere questo risultato alle chiavi moderne, alle radici assolute o a un
rollback operativo della release corrente.

## Firma dei bytes PDF e inventario

La verifica della firma PDF indica il controllo dei bytes iniziali `%PDF`, la
coerenza con `application/pdf` e l’integrità dei bytes dopo il restore. Non è una
verifica di firma digitale o validità legale del documento. I test del consumer
locale devono ottenere il percorso dal provider, così la firma viene controllata
sul medesimo oggetto che il download serve, anche con chiavi legacy e radice
assoluta. I controlli sul malware restano separati e non diventano una scansione
antivirus completa.

L’inventario deve collegare chiave registrata, tenant, risorsa, dimensione e hash ai
file effettivamente materializzati. Una chiave legacy piatta senza tenant
riconoscibile resta esclusa dalla migrazione automatica e richiede inventario
manuale. I nuovi attachment della fixture monetaria esercitano solo metadata
monetari: non sono nuovi file da considerare coperti dal backup.

## Comandi riproducibili

Eseguire in una copia isolata, senza dotenv reali e con Node22.23.1 nel PATH. I
placeholder SHA devono essere sostituiti con le identità complete registrate nel
rapporto della tranche. La directory di evidenze deve essere nuova.

```sh
npm run verify:restore-recovery -- \
  --source-sha 9bd57ff2f935a3a56205f381b41d35bfc982dd9a \
  --baseline-sha db1f231dc8cb699f1a5ce4215a0278c93212d16d \
  --evidence-dir /private/tmp/fleetum-money-storage-evidence-new
```

In una copia senza `.git`, aggiungere `--git-dir` con un object store locale
verificato. È ammesso soltanto un socket Docker locale Unix. Non eseguire due
rehearsal database contemporaneamente.

Test indipendenti dal database:

```sh
NODE_ENV=test DOTENV_CONFIG_PATH=/dev/null node --test \
  ops/tests/restore-recovery-money.test.mjs \
  ops/tests/restore-recovery-storage.test.mjs \
  ops/tests/restore-recovery-evidence.test.mjs

NODE_ENV=test DOTENV_CONFIG_PATH=/dev/null node --import tsx --test \
  backend/tests/local-storage-compatibility.test.ts \
  backend/tests/file-security.test.ts \
  backend/tests/storage-provider.test.ts \
  backend/tests/enterprise-contract-signature-storage.test.ts \
  backend/tests/storage-migration-plan-paths.test.ts
```

La matrice può essere ripetuta separatamente, dopo aver creato una directory
temporanea nuova e vuota posseduta dal task:

```sh
node ops/fixtures/restore-recovery-storage.mjs \
  --source-root <ARCHIVIO_CANDIDATO_ASSOLUTO> \
  --owned-root <DIRECTORY_TEMPORANEA_NUOVA_E_VUOTA>
```

## Limiti, impatto e gate esterni

Non viene aggiunta una nuova migrazione monetaria, non vengono eliminati shadow,
trigger o vincoli e non viene autorizzato il cutover degli importi in produzione.
Valori e arrotondamenti sono rappresentativi: non coprono ogni magnitudine,
permutazione, calcolo commerciale, settlement o ciclo completo di fatturazione.

La rete PostgreSQL del rehearsal è un bridge locale dedicato con pubblicazione
loopback, non una dimostrazione del blocco egress dello stack staging. I provider
HTTP sono bloccati nelle fixture e i worker restano fermi. Non vengono verificate
mutazioni ostili concorrenti del filesystem, storage remoto o dati reali.

G04/G12/G14 restano PENDING fino alle verifiche sull’effettivo stack e storage
staging, inventario legacy reale, versioni/digest applicazione e client approvati,
prova di guasto/readiness e budget RTO/RPO concordati. I risultati locali non
approvano una release di fallback né una procedura di ripristino in produzione.


## Evidenze locali di questa tranche

Candidato codice `9bd57ff2f935a3a56205f381b41d35bfc982dd9a`, tree `601334fb1bb051abe9f0caabddc7f00027f28021`, branch `codex/verify-money-storage-compatibility`.
Recovery finale30/30,57asserzioniHTTP,35campi/13tabelle/206coppie in4fasi con hash identico,
8layout,67tabelle e4file ripristinati due volte;107725ms. PostgreSQL16.13 temporaneo.
Nuovo gate database522/522 eoperations182/182; zero failure/skip.
Release308backend/44frontend/9website/182operations su bfb110ce, seguita da
una correzione della sola fixture del runner e dai gateoperations/recovery finali:
application source, dipendenze, workflow e schema identici; binding dettagliato in release-equivalence.json.
PDF/inventario eS3mock non equivalgono a inventario/provider live.
Tutti19gate esterni restano pendenti. Rapporto ed evidenze nel folder audit esterno.
