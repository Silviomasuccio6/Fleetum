# Data Minimization, Retention e Cancellazione

Versione: 1.1

Data: 2026-09-21

Stato: BOZZA TECNICA - da validare con DPO/Legal

## 1. Principi

- Raccogliere solo dati necessari per finalita operative, contrattuali, fiscali, sicurezza o obbligo normativo.
- Limitare note libere e allegati non pertinenti.
- Separare dati operativi da dati documentali sensibili.
- Conservare documenti solo per tempi giustificati.
- Rendere cancellazione/anonymization tracciabile.

## 2. Retention proposta

| Categoria | Retention proposta | Motivazione | Azione tecnica |
|---|---:|---|---|
| Utenti tenant attivi | Durata account | Operativita SaaS | Soft delete/disattivazione |
| Sessioni refresh | Fino a scadenza/revoca + 90 giorni audit | Sicurezza | Cleanup schedulato |
| Audit log sicurezza | 24 mesi | Accountability/security | Archivio protetto + purge |
| Clienti anagrafica | Durata rapporto + obblighi applicabili | Contratti/tutela | Anonymization su richiesta se possibile |
| Contratti noleggio PDF | 10 anni proposta da validare | Civilistico/fiscale | Storage cifrato, lifecycle |
| Documenti identita/patente | Minimo necessario; proposta legata al contratto + tutela | Identificazione/conducente | Separare retention da contratto |
| Allegati manutenzione/fatture | Secondo obblighi fiscali se fattura | Contabilita | Classificazione allegato |
| Log applicativi tecnici | 30-180 giorni | Debug/security | Redaction e purge |
| Backup DB/allegati | 30-90 giorni | DR | Retention automatica |
| Link pubblici contratti | 24-168 ore default | Condivisione sicura | Expiry + revoca |

## 3. Cancellazione/anonymization

### Richiesta cancellazione cliente

Workflow proposto:

1. Ricezione richiesta privacy.
2. Verifica identita richiedente.
3. Verifica blocchi legali/fiscali/contrattuali.
4. Se cancellabile: eliminazione/anonymization dati cliente.
5. Se non cancellabile: limitazione trattamento e risposta motivata.
6. Audit dell'operazione.

### Dati da anonymizzare

- Nome/cognome.
- Email/telefono.
- Indirizzo.
- Codice fiscale.
- Documento/patente.
- Note libere contenenti dati personali.

### Dati da conservare se obbligatori

- Contratti e registrazioni fiscalmente/civilisticamente necessarie.
- Audit minimo di sicurezza.
- Dati necessari per contenziosi, sinistri, obblighi autorita.

## 4. Stato tecnico osservato

| Requisito | Stato | Priorita |
|---|---|---:|
| Cleanup token/sessioni scaduti | PRESENTE e testato localmente; schedulazione reale da verificare | P1 |
| Retention file gia' soft-deleted | PRESENTE e testata su `StoredFileObject`; backfill file storici obbligatorio | P0 |
| Retention `WebsiteEvent`, `DemoLead`, payload email terminali | PRESENTE con preview/run e cron globale disabilitato | P0 |
| Anonymization cliente assistita | PRESENTE e testata localmente; blocchi legali richiedono procedura | P0 |
| Audit cancellazione/anonymization | PRESENTE nei servizi testati; coverage business da riesaminare | P1 |
| Classificazione allegati per retention | PARZIALE; periodi per categoria da approvare | P0 |
| Revoca/scadenza link pubblici contratto | PRESENTE-PARZIALE; collaudo staging e log esterni richiesti | P1 |

Il job globale resta intenzionalmente disabilitato con `PRIVACY_RETENTION_GLOBAL_ENABLED=false`. I default tecnici di 90 giorni per eventi sito, 365 per lead e 30 per payload email non costituiscono approvazione legale. Il dry-run globale va eseguito su un clone gia' migrato e redatto; la colonna `EmailQueue.payloadPurgedAt` non esiste prima della migrazione dedicata.

## 5. Done tecnico

- Export e anonymization cliente sono disponibili e coperti da test locali.
- La retention usa conferma esplicita, preview aggregata e audit.
- Gli oggetti soft-deleted vengono rimossi dallo storage prima di cancellare il metadata; un errore fisico conserva il metadata per il retry.
- Prima dell'attivazione globale servono approvazione DPO/Legal, backfill di `StoredFileObject`, dry-run revisionato e rehearsal staging.
- Backup e copie offsite devono applicare la retention approvata; la cancellazione dai backup segue il ciclo documentato, non una rimozione immediata non verificabile.
