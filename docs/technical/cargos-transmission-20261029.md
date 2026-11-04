# CARGOS — invio manuale, controlli e ricevute

Aggiornamento locale 1 novembre 2026. Candidato isolato, senza attivazioni o invii reali. La conformità dell’esercente e il collaudo con utenza abilitata restano verifiche esterne.

## Protocollo verificato

Fonti ufficiali consultate: [manuale API, revisione 01 del 6 febbraio 2024](https://cargos.poliziadistato.it/Cargos_Portale/Download/Manuali/p2.pdf), [catalogo API](https://cargos.poliziadistato.it/CARGOS_API/Help), [manuale del portale](https://cargos.poliziadistato.it/Cargos_Portale/Download/Manuali/p0.pdf).

Il catalogo documenta Token, Check, Send e Tabella. Check verifica il record e non registra un invio. Send restituisce un esito per record: solo `esito=true` con `transactionid` valido costituisce un’accettazione API. Non è documentata un’API per cercare invii o recuperare ricevute. Il portale espone Analisi Invii e ricevute PDF; il manuale indica la disponibilità delle ricevute degli ultimi 30 giorni. Non si inventano endpoint né si automatizza il portale.

Il significato di contraente e conducente richiede chiarimento ufficiale quando sono soggetti distinti. Per ora persone giuridiche o conducente principale diverso dal cliente della prenotazione sono bloccati prima di Check/Send/conferma manuale: la bozza è consultabile ma non si presume corretta una mappatura non documentata. I codici territoriali/documentali restano soggetti alle tabelle ufficiali; il Check remoto effettua il controllo preventivo, senza sostituire la verifica dell’integrazione reale.

## Comandi e stati

- La creazione effettiva del contratto apre «Trasmetti contratto a CARGOS». Nessun invio automatico.
- GET `/:id/cargos` legge il riepilogo locale, i controlli, le ricevute e gli ultimi 40 eventi. GET `/:id/cargos/history?cursor=` continua lo storico, con cursore appartenente allo stesso contratto visibile.
- PATCH `/:id/cargos/draft` aggiorna solo i campi ammessi, prima di un invio acquisito. Il contratto, il veicolo, il cliente e l’agenzia restano autorevoli. Le parti dei conducenti strutturati provengono dalla versione del contratto.
- POST `/:id/cargos/check` controlla dati correnti su CARGOS e registra VALID/INVALID/UNAVAILABLE con impronta e data. Non cambia la prenotazione in SENT. Non è disponibile per invii già avviati o incerti.
- POST `/:id/cargos/transmit` richiede impronta corrente, stipula, dati completi e configurazione valida. Acquisisce SENDING, registra un evento, esegue Check e poi Send solo se Check è positivo. Attore, tenant, licenza, sedi, connessione e dati sono ricontrollati prima di entrambe le richieste contenenti il record.
- ACCEPTED con dati invariati è idempotente; SENDING/UNKNOWN/MANUAL_CONFIRMED impediscono nuovi invii. REJECTED/UNAVAILABLE consentono un nuovo comando esplicito; nessun ritentativo automatico del provider.
- Un errore prima di Send è UNAVAILABLE. Errori o risposte ambigue dopo l’avvio di Send sono UNKNOWN. Un vecchio SENDING viene mostrato come incerto dopo un minuto, senza riciclarlo. La verifica manuale è ammessa per UNKNOWN o SENDING interrotto da oltre cinque minuti.
- Stato trasmissione e prenotazione vengono finalizzati insieme. Il vecchio POST `/:id/cargos` resta 410; create/PATCH non possono attribuire SENT dal browser.
- «Rileggi stato locale» non interroga il portale. Il popup impedisce doppio clic e chiusura durante le operazioni, mantiene separati controllo e invio e scarta risposte di un contesto tenant/sede superato.

Endpoint HTTPS ufficiale fisso, niente redirect, Basic per Token, token cifrato AES-256-CBC secondo il protocollo e header Bearer/Organization per Check e Send. Record di 1505 caratteri, senza troncamenti; timeout 15 secondi per singola richiesta e risposta massima 1 MiB. Nei log/eventi non vengono conservati token, credenziali, record grezzi o descrizioni d’errore del provider. I codici d’errore sono filtrati.

## Ricevute e verifica manuale

POST `/:id/cargos/receipts` richiede amministratore aziendale nella vista tutte le sedi, permesso di scrittura, sessione/CSRF/licenza validi, chiave idempotenza UUID, PDF originale, protocollo, data non futura, riferimento dell’invio, impronta del tentativo e dichiarazione esplicita della verifica sul portale. Check e caricamento hanno un limite aggiuntivo di 10 richieste/minuto per attore e pratica, oltre ai controlli generali esistenti.

ARCHIVE associa un documento al riferimento già ACCEPTED o MANUAL_CONFIRMED; non crea accettazione. CONFIRM_PORTAL richiede un invio incerto, dati ancora identici e una ricevuta pertinente verificata dal responsabile. Registra MANUAL_CONFIRMED e autore/data/impronte, senza chiamare Send o inventare una data di accettazione API. Una ricerca senza risultati non prova mancato invio e non sblocca il ritentativo. Il documento non è verificato automaticamente per provenienza, firma o contenuto: l’associazione è un’attestazione del responsabile, riconoscibile nell’interfaccia.

I riferimenti non si riutilizzano per contratti diversi dello stesso tenant. Retry identici conservano una sola ricevuta/un solo evento. Errori espliciti di rollback per concorrenza vengono ritentati al massimo due volte dopo la compensazione dell’oggetto temporaneo; un commit incerto non viene trattato come rollback.

Il PDF, massimo 2 MiB e 100 pagine, deve essere leggibile e privo dei contenuti attivi/azioni vietati dal validatore. Si preservano esattamente i byte originali, con SHA-256 e quota tenant; il controllo tecnico non è una certificazione di sicurezza o autenticità del PDF. Metadati immutabili via UPDATE trigger e relazioni composite tenant. Nessuna API di modifica/cancellazione delle ricevute. La cancellazione per retention rimane da definire in un flusso dedicato e controllato; non si rende impossibile la gestione futura dei dati.

GET `/:id/cargos/receipts/:receiptId/pdf` richiede amministratore e tutte le sedi: una ricevuta può contenere più contratti. Prenotazione/receipt/file devono appartenere allo stesso tenant e alla stessa pratica; byte e metadati devono corrispondere all’impronta prima del download privato. Nessuna chiave storage nel DTO, cache privata disabilitata e download come allegato con nosniff/CSP sandbox. Gli operatori della pratica vedono solo i metadati pertinenti.

READY_FOR_HANDOVER/IN_RENT richiedono il riscontro API coerente oppure la conferma manuale con ricevuta pertinente, file privato non cancellato e dati invariati. Il controllo della transizione usa metadati sotto transazione; la verifica dei byte avviene al download, senza letture storage durante i lock della prenotazione.

## Migration e ritorno alla versione precedente

Migration aggiuntiva `20261101120000_cargos_receipts`: cinque colonne di controllo/conferma, stato MANUAL_CONFIRMED, tabella ricevute, vincoli tenant, trigger UPDATE e unicità del riferimento provider per tenant. Non converte record precedenti in accettati. Applicata esclusivamente ai PostgreSQL temporanei.

Prima di un futuro rilascio: backup verificato di database e storage, controllo aggregato di eventuali duplicati `(tenantId,transactionId)` non nulli e revisione degli esiti legacy. L’indice UNIQUE fallisce sui duplicati: non cancellarli automaticamente. Può richiedere lock durante la creazione; valutare dimensioni reali nel piano di rilascio.

Rollback consigliato: disabilitare nuovi comandi e ripristinare il binario compatibile lasciando le aggiunte DB e i file conservati. Il vecchio servizio non riconosce MANUAL_CONFIRMED come accettato e può bloccare una consegna: non trasformare questi stati in ACCEPTED. Non rimuovere tabella/colonne/trigger o file se ci sono evidenze; un down-schema richiede esportazione protetta e riconciliazione dedicate. Nessun rollback distruttivo è eseguito da questa tranche.

## Gate ancora aperti

Utenza API CARGOS abilitata dell’esercente, verifica delle tabelle/casistiche con il servizio, collaudo reale autorizzato e revisione legale del modello/processo. Apple e VoiceOver restano sospesi secondo le decisioni precedenti. La prova locale non abilita credenziali, provider, email o produzione.
