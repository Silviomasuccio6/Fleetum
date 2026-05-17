# Informativa Privacy - Bozza

Versione: 1.0  
Data: 2026-05-05  
Stato: BOZZA - da validare e personalizzare con DPO/Legal  
Uso previsto: base per informativa verso clienti/conducenti/operatori del gestionale.

> Inserire prima dell'uso: identita del titolare, dati contatto, DPO se nominato, sedi, fornitori reali, tempi definitivi di conservazione e canali esercizio diritti.

## 1. Titolare del trattamento

Il titolare del trattamento e' il soggetto che utilizza il gestionale per gestire noleggi, contratti, clienti, veicoli e operazioni di flotta.

Campi da completare:

- Ragione sociale:
- Indirizzo:
- P.IVA/CF:
- Email privacy:
- PEC:
- DPO, se nominato:

## 2. Responsabile del trattamento SaaS

La societa fornitrice del gestionale SaaS puo operare come responsabile del trattamento per conto del titolare, secondo DPA/accordo sul trattamento dati.

## 3. Dati trattati

Il sistema puo trattare:

- dati anagrafici e contatti;
- dati fiscali, societari e di fatturazione;
- dati documento identita, patente, passaporto o altri documenti necessari;
- dati prenotazione, contratto, firma, consegna/rientro;
- dati veicolo, targa, km, manutenzioni e scadenze;
- allegati PDF/JPG/PNG/WebP;
- log tecnici, audit, IP, user agent, stato invii email/WhatsApp;
- dati necessari per obblighi verso autorita competenti, ove applicabile.

## 4. Finalita

- Gestione anagrafica clienti e conducenti.
- Gestione prenotazioni e contratti di noleggio.
- Verifica documenti e requisiti di guida.
- Invio comunicazioni operative e contrattuali.
- Gestione veicoli, manutenzioni, revisioni, fermi tecnici e scadenze.
- Adempimenti amministrativi, fiscali, contabili, assicurativi e di pubblica sicurezza, ove applicabili.
- Sicurezza applicativa, audit, prevenzione abusi e continuita operativa.

## 5. Base giuridica

Da validare con Legal/DPO per ciascun titolare. In linea generale possono rilevare:

- esecuzione di misure precontrattuali/contratto;
- obblighi legali;
- legittimo interesse alla sicurezza, tutela diritti e gestione operativa;
- consenso solo dove necessario e non sostituibile da altra base giuridica.

## 6. Destinatari

I dati possono essere trattati da:

- personale autorizzato del titolare;
- fornitore SaaS e soggetti tecnici autorizzati;
- provider hosting, database, object storage, backup;
- provider email/WhatsApp/SMS;
- consulenti, assicurazioni, officine o autorita quando necessario;
- sub-responsabili indicati nel DPA.

## 7. Trasferimenti extra UE

Da completare in base ai fornitori reali. Se presenti trasferimenti extra UE, documentare garanzie appropriate, SCC e misure supplementari.

## 8. Conservazione

I dati sono conservati per il tempo necessario alle finalita indicate e agli obblighi applicabili. Bozza tecnica:

- account utenti: durata rapporto + 24 mesi log sicurezza;
- contratti e dati fiscali: secondo obblighi civilistici/fiscali applicabili;
- documenti identita/patente: minimo necessario per contratto, tutela e obblighi;
- log sicurezza: 24 mesi proposta;
- backup: 30-90 giorni proposta;
- allegati non necessari: cancellazione anticipata secondo policy.

I tempi definitivi devono essere approvati da DPO/Legal.

## 9. Diritti degli interessati

Gli interessati possono esercitare, nei limiti previsti dalla normativa, diritti di accesso, rettifica, cancellazione, limitazione, opposizione, portabilita e reclamo all'autorita di controllo.

Canale richieste privacy:

- Email:
- PEC:
- Tempi gestione interna:

## 10. Sicurezza

Sono previste misure tecniche e organizzative quali:

- autenticazione e autorizzazioni per ruolo;
- separazione tenant;
- audit log;
- protezione sessioni;
- cifratura in transito tramite HTTPS in produzione;
- backup e ripristino;
- controlli sugli upload;
- accesso ristretto ai documenti.

Misure da completare prima produzione: storage allegati privato/cifrato, antivirus, retention automatizzata, audit download sensibili.

## 11. Decisioni automatizzate

Il sistema puo proporre estrazioni OCR/autofill da documenti o fatture, ma la decisione finale e la correzione devono restare sotto controllo umano. Non sono previste decisioni interamente automatizzate con effetti giuridici senza intervento umano.
