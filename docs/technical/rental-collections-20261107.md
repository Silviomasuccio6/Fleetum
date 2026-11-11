# Fleetum — blocco 3: Pagamenti e garanzie

7 novembre 2026. Candidato locale nel branch `codex/payments-contracts-ux-20261106`,
base `61645778a7f07945f3b97dff9ae02b472c81bd64`. Nessun push, merge, deploy, VPS,
provider o dato reale. Commit applicativo `78d2ffa4809e07ab992ebe02867e2f920a3bb8d6` (36 file). Il login e la direzione grafica già scelta sono preservati.

## Comportamento e fonte unica

La nuova route `/pagamenti-garanzie` è collegata a navigazione, ricerca delle sezioni,
prenotazioni e contratti. Il pannello della prenotazione conserva riepilogo e link;
le azioni su carte, garanzie ed extra si trovano soltanto nella pagina dedicata.

Il totale del noleggio viene da `RentalBooking.finalTotal ?? expectedTotal`, compreso
lo zero. Il listino salvato è descrittivo: tariffa e unità DAILY/WEEKLY/MONTHLY,
percentuale di sconto, nome e versione temporale. La lettura della tariffa usa
ExactMoneyReader; il totale della prenotazione segue la modalità legacy/exact
configurata, con conversione controllata in centesimi. Nessuno sconto viene
ricostruito a partire dal totale concordato. Il subtotal della vecchia quotazione
è già successivo allo sconto e non è presentato come prezzo lordo di listino.

I record storici non contengono una provenienza affidabile dell'autore/motivo dello
sconto. La UI lo dichiara; snapshot o tariffa assenti restano non disponibili.
La nuova modifica autorizzata di prezzi/sconti con provenienza esplicita appartiene
al blocco 4 già concordato. Questo blocco non aggiunge un editor alternativo.

`RentalCollectionEntry` è l'unico registro degli **incassi manuali del corrispettivo
base**. Non riusa Invoice/abbonamento Fleetum e non incorpora cauzioni o extra.
Ogni movimento contiene importo intero in centesimi EUR, metodo, data effettiva,
riferimento, causale, autore e data di registrazione. L'esportazione privacy del
cliente comprende i movimenti delle sue prenotazioni, senza requestKey/requestHash.

| Caso | Risultato |
| --- | --- |
| Totale 80 €, incassato 50 € | Residuo 30 €, incasso parziale |
| Totale 0 €, nessun movimento | Gratuito / nessun importo dovuto |
| Totale mancante | Da definire; residuo ignoto, non zero |
| Incassato oltre il totale | Credito del cliente separato, non nascosto |
| Garanzia autorizzata o carta salvata | Nessun incremento dell'incasso del noleggio |
| Bonifico soltanto atteso | Nessun incasso registrato automaticamente |
| Refund manuale | Nuova uscita collegata all'incasso originale |
| Storno | Nuova rettifica esatta, storico originale conservato |

I metodi sono contanti, bonifico già ricevuto e POS esterno. La conferma dichiara
che il denaro è già stato ricevuto/restituito: non addebita una carta, non dispone
bonifici e non attesta verifica online. Non si accettano status o metodo Stripe
forniti dal browser. Non si crea un movimento fittizio da 0 €.

## Concorrenza, sicurezza e rettifiche

- Lock della prenotazione nella transazione per serializzare incassi, rimborsi e
  storni. Idempotency-Key obbligatoria, univoca per tenant; hash vincolato a booking,
  autore e payload normalizzato. Replay restituisce lo stesso ID senza altro audit.
- Due rimborsi concorrenti con chiavi diverse non possono superare l'incasso
  disponibile. Un rimborso punta a un incasso valido della stessa prenotazione.
- Lo storno è integrale e monouso. Non storna un altro storno. Prima di stornare un
  incasso con rimborsi attivi bisogna rettificare quei rimborsi; nessuna cancellazione
  o modifica retroattiva. Inserimento e audit sono atomici.
- Chiavi riutilizzate per operazioni diverse producono conflitto; non espongono ID
  di altri contesti. Una collisione concorrente dell'indice univoco torna 409.
- Il form usa un lock sincrono prima della richiesta. Dopo rete/timeout/5xx con esito
  incerto, mantiene dati e chiave per il medesimo retry; non proclama il fallimento
  finanziario né permette di trasformare il retry in una nuova richiesta modificata.
- Tenant e sedi sono filtrati lato server prima di count, aggregati e paginazione.
  Visibilità dalla sede responsabile/ritiro/restituzione della prenotazione,
  indipendente dall'attuale sede dell'auto. Record veicolo/cliente di altri tenant
  sono esclusi. Un cliente condiviso non estende l'accesso ai suoi pagamenti.
- Ruoli/licenza/auth/CSRF/rate limit originali restano in funzione. Nessun permesso
  è stato concesso in seed o produzione. Nei test i grant temporanei sono ripristinati.
- Le prenotazioni archiviate con movimenti restano consultabili nella vista autorizzata;
  nuove registrazioni sono bloccate. Non si nasconde lo storico con una soft delete.

## API

Tutte sotto `/api/rental-payments`, cache `private, no-store`.

| Metodo/percorso | Permesso |
| --- | --- |
| GET `/workspace` | rental-payments:read |
| GET `/bookings/:bookingId/collections` | rental-payments:read |
| POST `/bookings/:bookingId/collections` | rental-payments:charge |
| POST `/bookings/:bookingId/collections/:entryId/refund` | rental-payments:refund |
| POST `/bookings/:bookingId/collections/:entryId/reverse` | rental-payments:refund |

Filtri: search, bookingId, customerId, siteId, from/to (giorni del periodo noleggio,
interpretati in UTC), state e method; pagina 1–100000, dimensione 1–100. Stato e
metodo derivano dal registro confermato; il metodo significa metodo registrato,
anche se la registrazione è stata successivamente rettificata. Stati finanziari:
UNKNOWN, DUE, PARTIAL, PAID, FREE, CREDIT. Le query sono parametrizzate; i caratteri
wildcard nella ricerca vengono trattati come testo. Nessun payload provider grezzo
è esposto dalla nuova pagina. Valutazione dei filtri prima di impaginare; aggregati
sull'intero risultato filtrato, non sulle sole venti righe visibili.

Errori: dati schema non validi 422, data futura di movimento 400, risorsa non visibile
404, conflitti 409. Le aspettative iniziali di 400 per Zod sono state corrette al
contratto HTTP esistente, senza cambiare il middleware o allargare le asserzioni.

## Stripe e scadenze

Le operazioni garanzie/extra riusano i servizi esistenti e i loro stati verificati
lato server. Conferme contestuali riportano importo, prenotazione e operazione;
lock UI e autorizzazioni vengono ricontrollati negli handler. La riconciliazione
può conservare `captureBefore` soltanto dalla charge espansa associata al
PaymentIntent autorevole. Nessuna durata di sette giorni è inventata. Scadenza
assente dichiarata come tale; termine noto superato impedisce una cattura inconsapevole.
Una garanzia con termine noto già superato non entra nel KPI delle somme bloccate,
senza inventare uno stato provider EXPIRED o trasformarla in un incasso.

Riferimenti primari consultati: [Stripe, autorizzazione e cattura](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method)
e [Charge object](https://docs.stripe.com/api/charges/object).

L'incasso online base resta esplicitamente da configurare per ogni autonoleggio:
manca il modello esercente/beneficiario già rilevato nel blocco 1. Non viene usata
la chiave dell'abbonamento Fleetum come scorciatoia. Non sono stati attivati Connect,
checkout base, refund online o provider reali. Il nuovo rimborso è una registrazione
manuale; gli stati Stripe di garanzie/extra rimangono nel loro dominio.

## Migrazione e rollback

`20261107170000_rental_collection_ledger` è additiva:

- nuova tabella e due enum per tipo/metodo del movimento;
- indici univoci su richiesta tenant e storno della stessa origine;
- FK composite verso prenotazione, autore e origine nella stessa azienda/pratica;
- CHECK importi positivi entro il limite applicativo e valuta EUR;
- trigger append-only contro UPDATE/DELETE;
- colonna nullable `RentalDeposit.captureBefore`;
- indici univoci `(id,tenantId)` su User/RentalBooking necessari alle FK.

Non riscrive prezzi, saldi o movimenti esistenti e non fa backfill di incassi presunti.
I nuovi indici richiedono spazio e lock in fase di installazione: capacità e tempi
sul dataset reale non misurati da questa tranche. Nessuna migrazione eseguita su
staging/produzione. La generazione del client Prisma locale è avvenuta sulle
dipendenze esistenti; nessuna installazione o modifica al lockfile.

Rollback applicativo: ritirare pagina e nuove API tramite revert revisionato,
**conservando tabella e movimenti già registrati**. Non eliminare un ledger non vuoto,
non aggirare il trigger e non ricostruire incassi a partire dai prezzi. L'applicazione
precedente ignora le nuove capacità; restrizioni FK continuano a proteggere lo
storico. La rimozione dello schema vuoto è ammissibile solo in un ambiente temporaneo
verificato o in un piano separato con conservazione approvata dei dati. Restore sul
database attivo non incluso. Il test usa TRUNCATE soltanto nel database sintetico
verificato per eliminare i suoi fixture prima della rimozione del contenitore.

## Verifiche e revisione

Ambiente macOS locale, Node 22.23.1, dotenv reale escluso; PostgreSQL 16 in contenitori
usa-e-getta su porta casuale loopback, storage sintetico e provider simulati.

- Backend: **603/603**, type-check riuscito.
- Frontend: **408/408**, type-check, build e prerender riusciti.
- Database completo: **904/904**, zero fail/skip/cancel; migration e dual-write riusciti.
- Aggiunta finale alla stessa suite ledger: verifica dell'export privacy senza
  chiavi tecniche e della garanzia nota scaduta esclusa dal KPI, eseguita in un
  laboratorio PostgreSQL mirato separato: **8/8**. La successiva condizione sul KPI
  scaduto e l'asserzione privacy sono coperte da questa esecuzione finale; non si
  dichiarano ripetute tutte le 904 prove dopo quel solo aggiustamento.
- Browser nuova pagina: **9/9** scenari, 390/768/1440 px, chiaro IT e scuro EN,
  dettaglio/gratuito/errori/empty/readonly e retry esatto dopo errore di rete.
  Il secondo submit rapido non crea una seconda richiesta; il risultato aggiornato
  mostra 65,25 € ricevuti e 14,75 € residui dopo il nuovo incasso sintetico di 15,25 €.
- Regressione blocco 2: **26/26** scenari notifiche, compreso il nuovo riepilogo
  prenotazione con errore inline che rimane dopo il popup.
- Health guard dell'anteprima: **2/2**; niente chiamate browser esterne o eccezioni JS.
- Sintassi dei runner, controllo diff e ispezione screenshot completati.

Comandi: `npm run verify:backend`, `npm run verify:frontend`,
`TMPDIR=/private/tmp npm run verify:database`,
`FLEETUM_COLLECTIONS_UI_URL=http://127.0.0.1:5288 node ops/verify-collections-ui.mjs`,
`FLEETUM_NOTIFICATIONS_UI_URL=http://127.0.0.1:5288 node ops/verify-notifications-ui.mjs`,
`node --test ops/tests/ui-preview-health.test.mjs`, `git diff --check`.
I log e i risultati finali sono nella consegna esterna al checkout.

L'anteprima è in sola lettura con dati sintetici; POST del collaudo intercettati nel
browser, nessun incasso realmente mosso. Il runner finale ha snapshot tariffa e DTO
aggiornati; il laboratorio era stato riavviato per evitare fixture mantenuti in memoria.
Le query persistenti sono provate separatamente dalle API HTTP reali sul PostgreSQL
temporaneo. Le prime prove hanno evidenziato enum fixture errati, status di validazione
attesi male e un percorso TMPDIR incompatibile con una suite esistente: corretti i
fixture e usato /private/tmp, senza indebolire guardie o scadenze.

Revisione indipendente in contesto nuovo: 13 immagini valide e campionamento del
diff finanziario/sicurezza. Tre rilievi: provenienza prezzo, contesto persistente,
eyebrow ereditato nei nuovi pannelli. Tutti e tre risolti e ricontrollati su catture
rigenerate; verdetto `ship` limitato a quei tre fix. Non equivale a un audit generale
senza rilievi o a una certificazione del provider. Il motore di analisi grafica
non era disponibile: nessun detector automatico dichiarato riuscito.
Il contesto della superficie è in `frontend/src/presentation/pages/rental-payments/PRODUCT.md`.

Restano il collaudo fisico Safari/iPhone e VoiceOver già rinviato, la verifica release
consolidata e le verifiche esterne prima di un futuro rilascio. Questa tranche non
promuove gate live. Prossimo: blocco 4, conversione manuale e firma, mantenendo
contratti gratuiti, scontati e con saldo ancora da incassare ammessi.
