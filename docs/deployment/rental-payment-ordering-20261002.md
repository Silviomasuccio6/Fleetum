# Fleetum — ordine degli eventi e concorrenza pagamenti, 2 ottobre 2026

Branch `codex/fix-rental-payment-ordering`, base `47e530d30500c704a8ab6e62b358ae8a78a1d8f3`.
Commit finale, diff, checksum e risultati sono registrati nelle evidenze esterne
`Fleetum-audit-20260909/evidence/20261002-rental-payment-ordering/` dopo la consegna.
Questa tranche corregge INT-01 e INT-02 del registro integrato del 1 ottobre.

## Comportamento

- Extra PAID/REFUNDED/DISPUTED e depositi con somme catturate non retrocedono per
  eventi PaymentIntent più vecchi, risposte tardive o errori della richiesta iniziale.
- Ogni riconciliazione legge il record, recupera il PaymentIntent corrente da Stripe
  e applica una scrittura condizionale sullo stesso snapshot. Un conflitto rilegge
  record e provider; dopo cinque tentativi restituisce un errore ritentabile.
- Prima del journal eventi vengono verificati domain/purpose, tenant, booking,
  cliente, risorsa, metodo, Stripe Customer/PaymentMethod, importo, valuta e PI.
  Il primo collegamento è consentito solo sul claim AUTHORIZING/PAYMENT_PROCESSING;
  un PI esistente non viene sostituito. Stati provider sconosciuti sono rifiutati.
- Il metodo storico può essere rimosso o archiviato: questo non impedisce di
  registrare gli esiti finanziari del PI già collegato. Avviare un pagamento
  richiede comunque un metodo attivo con mandato.
- Una cattura finale inferiore alla garanzia rimane PARTIALLY_CAPTURED; il webhook
  non la trasforma in una cattura completa e non inventa l'importo ricevuto.
- Il claim di addebito, l'approvazione e l'annullamento sono condizionali. Un solo
  vincitore avvia la creazione Stripe. Durante PAYMENT_PROCESSING o con un PI
  collegato l'annullamento locale restituisce 409 e non promette un annullamento.
- Un errore di rete, 409/429/5xx o non classificabile conserva lo stato incerto.
  Un PI presente nell'errore viene recuperato e collegato dopo verifica completa.
  Un errore di persistenza dopo successo provider non viene trattato come un rifiuto.
- Gli audit delle transizioni finanziarie, incluso l'avvio dell'extra, sono nella
  stessa transazione della CAS. Un errore audit annulla entrambi; replay/stato
  coincidente non aggiungono un secondo audit economico. Le chiamate Stripe sono
  fuori dalla transazione. Il lock Tenant precede la riga finanziaria e gli audit FK.

## Retry e decisioni operative

Un extra già collegato a un PI viene soltanto riconciliato: non si crea un secondo
PI, non si cambia implicitamente carta e non si riconferma un addebito. Un extra
PROCESSING senza PI non viene ricreato automaticamente, anche dopo 24 ore:
attendere webhook o verifica operativa del provider. Le chiavi Stripe possono
essere eliminate dopo almeno 24 ore; ripetere create indefinitamente non è sicuro.

L'autorizzazione deposito conserva il retry esistente sulla stessa chiave e payload
solo entro 23 ore dalla creazione del claim, letta dal database. Un claim già legato
usa retrieve; un claim più vecchio senza PI restituisce 409 e richiede verifica.
Nessuno stato incerto viene sbloccato con timer o cancellazione locale.

Charge/refund/dispute con metadata vuoti vengono inoltrati al rental handler solo
per `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`. Il handler
recupera Charge/Dispute e PI autorevoli; oggetti non rental restano ignorati e non
mutano abbonamenti SaaS. Firma e raw body esistenti rimangono necessari.

Si conserva la rappresentazione sintetica esistente REFUNDED/DISPUTED: non è un
ledger di rimborsi parziali né una policy completa per dispute vinte/perse.
DISPUTED prevale; nessun evento PI ripristina PAID dopo refund/dispute. Un modello
analitico di importi rimborsati ed esiti delle contestazioni resta lavoro separato.

## Verifiche riproducibili

Usare una copia isolata senza env reali, dipendenze da lockfile e Node 22.23.x.
Per i test in memoria disabilitare dotenv e fornire un database loopback inutilizzabile:

```sh
NODE_ENV=test DOTENV_CONFIG_PATH=/dev/null node --import tsx --test backend/tests/rental-payment-ordering.test.ts backend/tests/rental-payment-service.test.ts backend/tests/billing-webhook.test.ts
NODE_ENV=test DOTENV_CONFIG_PATH=/dev/null node --import tsx ops/e2e/rental-financial-diagnostic.ts
npm run verify:release
```

Eseguire con ambiente pulito, senza variabili provider reali. Il diagnostico usa
26 dipendenze in memoria, rete bloccata e PI sintetici: `defectObserved=false`
non sostituisce le prove persistenti o la verifica della firma HTTP.

```sh
npm run verify:database
node ops/verify-local-rehearsal.mjs --run --evidence-dir /private/tmp/fleetum-payment-rehearsal --source-sha 47e530d30500c704a8ab6e62b358ae8a78a1d8f3
```

Il gate database va lanciato con Docker vincolato al socket Unix locale e dotenv
/dev/null. Lo script imposta RUN_TENANT_ISOLATION_TESTS solo dopo aver creato il
PostgreSQL temporaneo; la nuova suite rifiuta env diversi da test/devnull e URL
non loopback/non sintetici. Non eseguire suite concorrenti sullo stesso database.

I RED iniziali sono 29 test in memoria e 13 PostgreSQL, più quattro test di dispatch
firmato sul body billing originale. Il gate finale, con ulteriori regressioni,
comandi, conteggi e identità dei file è nell'evidence README. Non confondere run
intermedi con il candidato congelato. Nessuna prova provider live è dichiarata.

## Impatto, rollback e gate esterni

Nessuna migrazione, backfill, dipendenza, configurazione provider o redesign.
Rollback applicativo coordinato alla base, senza schema; reintroduce i difetti.
Non cancellare/reinviare PI, webhook o importi per effettuare rollback. Nessuna
riparazione monetaria sui dati storici viene eseguita da questa tranche.

Il journal dell'evento viene finalizzato dopo la transazione economica; un crash
può lasciarlo FAILED/RECEIVED, ma il retry ritrova stato e audit già coerenti.
L'idempotenza degli audit economici non significa esecuzione unica di ogni evento.
Capture/release non hanno un journal durevole che garantisca un unico comando
esterno concorrente: sono validati, idempotenti per la chiave prevista e riconciliati;
non si dichiara un fencing persistente delle chiamate dopo crash.

Prima della produzione: review umana, CI sullo SHA esatto, provider sandbox con
firma/retry/out-of-order reali, staging due tenant, storage, carico/contesa,
restore/rollback e verifica release/digest VPS. Restano i gate generali retention,
legacy, proxy e marketing del registro integrato. Nessun merge/push/deploy autorizzato.

Fonti primarie: [webhook e ordine eventi](https://docs.stripe.com/webhooks#event-delivery-behaviors),
[idempotenza](https://docs.stripe.com/api/idempotent_requests),
[cattura finale](https://docs.stripe.com/api/payment_intents/capture),
[eventi refund/dispute](https://docs.stripe.com/api/events/types).
