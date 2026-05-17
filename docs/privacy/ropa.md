# RoPA - Registro delle attivita di trattamento

Stato: BOZZA TECNICA DA VALIDARE

Owner: DPO + Legal

Supporto tecnico: Tech Lead + Security Engineer

Ultimo aggiornamento: 2026-05-05

## 1. Identificazione

| Campo | Valore |
|---|---|
| Titolare del trattamento | DA COMPILARE |
| Dati contatto titolare | DA COMPILARE |
| DPO / referente privacy | DA COMPILARE |
| Applicazione | Gestionale autonoleggio / flotta / fermi tecnici |
| Ambiente | SaaS multi-tenant |
| Versione documento | 0.1 |

## 2. Registro trattamenti

| ID | Trattamento | Finalita | Interessati | Categorie dati | Destinatari / responsabili | Retention proposta | Misure tecniche | Stato |
|---|---|---|---|---|---|---|---|---|
| ROPA-01 | Gestione tenant e utenti | accesso applicazione, ruoli, sicurezza account | utenti tenant, admin | nome, email, ruolo, eventi login, audit | hosting, database, monitoring | durata account + audit 24 mesi | RBAC, sessioni HttpOnly, CSRF, audit log | DA VALIDARE |
| ROPA-02 | Anagrafica clienti | gestione clienti e prenotazioni | clienti, conducenti, referenti societa | dati identificativi, contatti, CF/P.IVA, indirizzo | hosting, database | durata rapporto + obblighi applicabili | RBAC, tenant isolation, audit modifiche | DA VALIDARE |
| ROPA-03 | Documenti cliente | verifica operativa e contrattuale | clienti, conducenti | patente, documento identita, passaporto, tessera sanitaria, allegati | storage file, OCR se attivo | minimo necessario; proposta 12 mesi dopo ultimo noleggio salvo obblighi | accesso limitato, validazione file, audit download | DA VALIDARE |
| ROPA-04 | Booking noleggi | prenotazione, consegna, rientro, fatturazione operativa | clienti, conducenti, operatori | prenotazioni, veicolo, km, sedi, orari, costi | database, email/WhatsApp se usati | durata contratto + obblighi fiscali/contrattuali | tenant isolation, validazioni, audit eventi | DA VALIDARE |
| ROPA-05 | Contratti noleggio | generazione, firma, invio e conservazione contratto | clienti, societa, conducenti | PDF contratto, firma, delivery email/WhatsApp, stato contratto | provider email/WhatsApp, storage, database | da definire con Legal; tipicamente obblighi civilistici/fiscali | PDF protetti, audit invii, link a scadenza se condivisi | DA VALIDARE |
| ROPA-06 | Fermi tecnici e manutenzioni | gestione flotta, manutenzioni, costi e allegati | operatori, officine, eventuali fornitori | dati veicolo, fatture, allegati, costi, note operative | database, storage file | secondo obblighi fiscali per documenti contabili | validazione upload, audit, RBAC | DA VALIDARE |
| ROPA-07 | Scadenziario e reminder | prevenzione scadenze revisione/km/manutenzione | operatori tenant | scadenze veicolo, reminder, notifiche | email/WhatsApp/calendari se attivi | finche veicolo attivo + storico tecnico | controlli accesso, audit sync | DA VALIDARE |
| ROPA-08 | Report/export | analisi operative ed economiche | utenti tenant, clienti se inclusi nei report | dati aggregati e dettaglio export | download locale utente, eventuale email | secondo policy export + audit | autorizzazione, audit export, minimizzazione colonne | DA VALIDARE |
| ROPA-09 | Sicurezza, logging e audit | incident response, accountability, antifrode | utenti, admin, clienti indiretti | IP, user agent, actor, azione, timestamp, esito | monitoring/logging provider | 12-24 mesi secondo rischio | correlation-id, log redaction, accesso ristretto | DA VALIDARE |

## 3. Basi giuridiche

Da completare e approvare da Legal.

Mappatura preliminare non vincolante:

- Esecuzione contratto: booking, contratti, comunicazioni operative al cliente.
- Obbligo legale: conservazione documenti fiscali/contabili dove applicabile.
- Legittimo interesse: sicurezza applicativa, audit, prevenzione abusi.
- Consenso o altra base specifica: eventuali comunicazioni marketing o trattamenti non necessari al servizio.

## 4. Trasferimenti extra UE

Da verificare in base ai fornitori effettivi:

- Hosting / database.
- Storage allegati.
- Email provider.
- WhatsApp provider.
- OCR/document analysis provider.
- Monitoring/logging.

Per ogni fornitore servono:

- Paese trattamento.
- Sub-processors.
- SCC o altra garanzia trasferimento, se applicabile.
- DPA firmato.

## 5. Misure tecniche e organizzative

Misure minime richieste:

- Autenticazione con cookie HttpOnly/Secure/SameSite in produzione.
- CSRF per richieste mutative.
- RBAC granulare.
- Tenant isolation testata.
- Audit log su contratti, documenti, utenti, download, export.
- Cifratura in transito TLS.
- Cifratura a riposo per database/storage, da verificare con infrastruttura.
- Validazione e limitazione upload file.
- Antivirus/malware scan per allegati, da implementare se assente.
- Backup cifrati e restore testato.
- Retention job e cancellazione/anonymizzazione.

## 6. Azioni per completamento

| Azione | Priorita | Owner | Done quando |
|---|---:|---|---|
| Compilare titolare/DPO/contatti | P0 | Legal | campi identificativi completi |
| Validare basi giuridiche | P0 | Legal | ogni trattamento ha base approvata |
| Censire fornitori reali | P0 | DPO + DevOps | elenco fornitori con DPA e trasferimenti |
| Implementare retention tecnica | P0 | Tech Lead | job/test cancellazione disponibili |
| Collegare audit download/export | P1 | Tech Lead | eventi visibili e filtrabili |

