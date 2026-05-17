# Data Minimization, Retention e Cancellazione

Versione: 1.0  
Data: 2026-05-05  
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

## 4. Requisiti tecnici mancanti

| Requisito | Stato | Priorita |
|---|---|---:|
| Job cleanup sessioni/log scaduti | PARZIALE | P1 |
| Job retention allegati/documenti | MANCANTE | P0 |
| Anonymization cliente assistita | MANCANTE | P0 |
| Audit cancellazione dati | MANCANTE | P0 |
| Classificazione allegati per retention | PARZIALE | P1 |
| Revoca link pubblici contratto | PARZIALE | P1 |

## 5. Done tecnico

- Esiste comando/admin action per export dati cliente.
- Esiste comando/admin action per cancellazione/anonymization.
- Ogni cancellazione produce audit.
- I backup rispettano retention.
- Gli allegati scaduti vengono rimossi dallo storage e dal DB.
- La cancellazione e' testata con casi multi-tenant.
