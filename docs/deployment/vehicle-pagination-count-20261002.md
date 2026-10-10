# Fleetum — contatori e traduzione dinamica, 2 ottobre 2026

## Problema e comportamento atteso

INT-05 era una segnalazione da screenshot: veicoli visibili con totale zero,
senza payload API storico. Il traduttore globale memorizzava una sola volta
l'origine di ciascun nodo testuale. Quando React aggiornava il nodo numerico
iniziale da `0` al totale corrente, l'observer ripristinava `0`, anche in italiano.
La stessa cache poteva ripristinare numeri di pagina, testi dinamici e attributi
`placeholder`, `title` e `aria-label` dopo un aggiornamento del rendering.

La correzione conserva l'origine e l'ultimo valore applicato dal traduttore.
Un nuovo valore del rendering aggiorna l'origine; la mutazione del traduttore
stesso non la sostituisce. I passaggi ripetuti convergono senza nuove scritture.
Testo e attributi svuotati rimuovono il loro stato. La lingua viene riletta quando
si esegue il callback pianificato, per usare la scelta attuale.

Il totale resta quello dell'API filtrata, anche sulle pagine successive; non è
sostituito con il numero di righe visibili. Backend, query tenant, filtri sede e
soft-delete, schema, dipendenze e provider rimangono invariati. Il layout rimane
quello corrente e il redesign separato resta escluso.

## Verifica

I test riproducono prima il difetto senza cambiare il comportamento applicativo:
solo due funzioni esistenti sono esportate per esercitarle direttamente.
Copertura in memoria: numeri aggiornati IT/EN, cambio pagina/lingua, testo dinamico,
spaziatura, nodi e attributi svuotati e riutilizzati, accessibilità e assenza di
nuove scritture dopo un passaggio ripetuto. I tag esclusi in precedenza restano esclusi.

Il browser confronta il payload effettivo dell'API con il contatore visibile dopo
l'observer. Usa due tenant sintetici e una marca univoca comune: 23 veicoli A e
uno B. Verifica totale A 23, pagine 20+3, ricerca senza risultati 0, ripristino 23,
cambio IT/EN, pulsanti e targhe ordinate delle due pagine. Il veicolo B è escluso
e la sua API restituisce totale 1. Mantiene le prove storiche di login, contratti,
export e isolamento. I risultati e i comandi sono registrati nel rapporto della
tranche e nelle evidenze associate al commit; questo documento non certifica
staging o produzione.

Ambiente ammesso: Node 22.23.1/npm 10.9.8, `NODE_ENV=test`, dotenv disabilitato;
PostgreSQL 16 temporaneo Docker locale tramite socket Unix, porta loopback casuale,
48 migrazioni, sender simulato e cron disabilitati. Nessun provider, pagamento o
email reale, env reale o dato personale applicativo. Cleanup di processi, container,
upload e certificati temporanei previsto dal runner. Credenziali di entrambi i
tenant obbligatorie nei test; nessun caso saltato è accettato nel gate locale.

Comandi, dalla copia di esecuzione e con ambiente pulito:

```text
node --import tsx --test frontend/tests/global-text-translator.test.ts
npm run verify:release
node ops/verify-local-rehearsal.mjs --run --evidence-dir <directory-di-evidenze> --source-sha <parent>
git diff --check
```

Il parametro del rehearsal registra il parent; il manifest SHA-256 identifica
precisamente i file modificati che sono stati testati e poi committati.

## Rilascio e rollback

Nessuna migrazione o backfill. Revisione del diff e CI sul commit esatto prima di
qualsiasi integrazione. Verificare in staging italiano/inglese, elenchi vuoti e
paginati, aggiornamenti dopo creazione/cancellazione e testi/accessibilità dinamici.
La compilazione locale e HTTPS di prova non attestano flag cookie, cache CDN,
proxy o versione della VPS. Nessun merge o deploy è autorizzato da questa tranche.

Rollback applicativo al parent `e0cfa263015a630e19cb220f65fa889a84ecfb83`, senza
modifiche al database. Reintroduce il difetto di visualizzazione; non annulla le
correzioni finanziarie presenti nel parent e non richiede operazioni monetarie.

## Limiti separati

Il backend conta e legge le righe con lo stesso filtro, ma in due query senza uno
snapshot condiviso. Una modifica concorrente può rendere temporaneamente diversi
i due risultati: questo limite non viene attribuito allo screenshot e non è
modificato in questa tranche. Nessuna garanzia di snapshot API viene aggiunta.

Il traduttore continua a modificare il DOM sotto React e conserva il dizionario
esistente; questa correzione non sostituisce l'architettura di localizzazione né
certifica tutte le stringhe o tutti i componenti dell'app. Le prove coprono il
percorso dei contatori, le funzioni condivise e i flussi browser registrati.
