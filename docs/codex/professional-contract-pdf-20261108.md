# PDF contrattuale professionale - 8 novembre 2026

## Comportamento

Il PDF usa un'impaginazione A4 bianca indipendente dal tema del gestionale: logo e dati del locatore, richiamo Fleetum, numero prenotazione/revisione commerciale, intestatario e conducenti, veicolo, periodo/luoghi, accordo economico, fotografia degli incassi, condizioni specifiche e testo contrattuale completo. Le immagini aziendali continuano a passare dallo storage autorizzato; non si leggono file arbitrari o URL forniti dall'utente.

La revisione commerciale è `documentRevision + 1`. Il numero `ContractSigningRequest.version` identifica una richiesta di firma e può cambiare senza creare un nuovo accordo: i due riferimenti sono etichettati separatamente.

I font Liberation Sans già presenti nel repository vengono incorporati per una stampa autonoma e per mantenere alfabeti latini, greci e cirillici. I glifi non rappresentabili producono un errore esplicito, senza cancellare o sostituire parti dell'identità. I colori aziendali troppo chiari vengono sostituiti per i testi da un colore con contrasto di almeno 4,5:1 sul bianco. L'accento grafico e il logo restano quelli salvati.

Titoli, anagrafiche, motivazioni commerciali e clausole non vengono troncati nel corpo del contratto. Le abbreviazioni dell'intestazione rimandano ai dati completi nel corpo. Tabelle lunghe continuano sulle pagine successive; ogni sezione conserva il titolo insieme al primo contenuto. Limiti espliciti: titolo di 12 righe, contratto di 40 pagine, registrazione firma di 15 pagine. Il testo che supera i limiti blocca l'emissione, non viene perso.

## Importi e documenti fiscali

L'accordo commerciale lordo e il totale autorevole della prenotazione devono coincidere in centesimi; accordi incoerenti vengono bloccati. Il dettaglio imponibile/IVA salvato viene riportato solo se si riconcilia con il totale concordato attuale. Dopo uno sconto lordo che non ha un corrispondente dettaglio fiscale salvato, il PDF dichiara la mancanza del dettaglio: non inventa aliquote, imposte o un trattamento fiscale della gratuità. Il contratto non sostituisce il documento fiscale.

Gli incassi vengono dal registro append-only del noleggio, al netto di rimborsi e storni. Sono una fotografia con data di preparazione, con residuo e credito separati. Cauzione, preautorizzazione, carta e abbonamento Fleetum non sono incassi del noleggio. Successivi movimenti non alterano un PDF già congelato e non invalidano da soli l'invito: il registro resta la fonte dello stato corrente. Non sono aggiunti al fingerprint commerciale del contratto.

## Emissione, firma e storico

Il riepilogo di conversione controlla anche la producibilità del PDF. Errori di caratteri, dimensioni, identità/condizioni, luoghi, veicolo o periodo impediscono l'emissione effettiva, non solo il pulsante. Gratuità, sconto e saldo aperto restano ammessi; non viene creato un incasso per soddisfare un prerequisito.

Preview/download e nuova firma utilizzano la stessa composizione di contenuti: testo del contratto, condizioni aziendali salvate e footer aziendale. Prima della firma il PDF indica bozza o contratto emesso da sottoscrivere; una firma non viene dedotta da una richiesta inviata, dall'apertura o dal pagamento.

Il flusso conserva il PDF originale mostrato al cliente. Nei nuovi documenti, la registrazione OTP o grafica viene aggiunta come sezione numerata separata, senza ridisegnare i contenuti delle pagine originali. Firma grafica ed evidenze condividono la stessa sezione. La versione del layout entra nelle evidenze immutabili protette dal MAC; l'impronta della copia finale continua a essere conservata separatamente.

Gli originali già congelati senza il marcatore `Fleetum contract layout v2` conservano il percorso di firma precedente. I PDF già firmati conservati sono restituiti nei loro byte, anche dopo una revisione successiva. Se un contratto storico risulta firmato ma manca il PDF originale conservato, download/invio non lo ricreano con il nuovo modello: viene richiesto il recupero dell'originale.

La registrazione non è presentata come certificazione di firma qualificata. Non vengono aggiunte clausole legali inventate né dedotte approvazioni specifiche dal consenso generale. Prima dell'uso pubblico occorre la revisione delle condizioni e delle eventuali approvazioni separate richieste per quel modello.

## Sicurezza e compatibilità

Nessuna nuova route pubblica, modifica ai permessi, migrazione o backfill del blocco 5. Le query mantengono tenant e visibilità sede. Nessuna configurazione provider, email reale, pagamento, invio CARGOS, VPS o deploy.

La verifica completa usa PostgreSQL 16 temporaneo. Il laboratorio browser usa due tenant fittizi, HTTPS su loopback, processi senza cron, email simulate e traffico HTTP esterno bloccato. La chiave crittografica di prova è casuale e dura soltanto quanto il laboratorio. Il fixture aziendale locale viene completato per esercitare l'emissione reale, senza indebolirne i requisiti.

Rollback: prima di nuove emissioni/inviti, ripristino del precedente applicativo insieme al frontend compatibile, mantenendo lo schema additivo dei blocchi precedenti. Dopo documenti v2 o inviti pendenti, preferire una correzione in avanti: un vecchio generatore non conosce i font/layout nuovi e può fallire sulle registrazioni Unicode. Non riscrivere documenti, eliminare evidenze, retrocedere gli stati o ripristinare il vecchio comando di sola marcatura della firma.

## Verifica ripetibile

- `npm run verify:database`: PostgreSQL temporaneo, riconciliazione, isolamento, firma e concorrenza.
- `npm run verify:release`: compilazione/typecheck, test e dipendenze. Se un componente fallisce, correggere e ripetere le verifiche motivate dall'errore.
- `NODE_ENV=test DOTENV_CONFIG_PATH=/dev/null node --import tsx --test tests/contract-professional-pdf.test.ts tests/contract-signature-layout.test.ts tests/contract-full-text-pdf.test.ts` dalla directory backend, senza URL di database o credenziali reali.
- `node ops/verify-local-rehearsal.mjs --run --source-sha <HEAD completo> --evidence-dir <directory assoluta nuova>` su checkout pulito e Node 22.23.1, con Docker locale. Non prova il VPS o i provider reali.

Evidenze e campioni vengono conservati nel documento di passaggio esterno, senza aggiungere i PDF dei clienti al repository.
