# DPA Fornitori e Sub-responsabili - Bozza

Versione: 1.0  
Data: 2026-05-05  
Stato: BOZZA - da validare con DPO/Legal

## 1. Scopo

Questo documento definisce la base per gli accordi di trattamento dati con fornitori e sub-responsabili usati dal gestionale SaaS.

## 2. Fornitori da censire

| Categoria | Fornitore reale | Ruolo privacy | Paese trattamento | DPA presente | Sub-processor list | Note |
|---|---|---|---|---|---|---|
| Hosting/app server | DA DEFINIRE | Sub-responsabile | DA DEFINIRE | MANCANTE | MANCANTE | Obbligatorio prima produzione |
| PostgreSQL managed/self-hosted | DA DEFINIRE | Sub-responsabile | DA DEFINIRE | MANCANTE | MANCANTE | Include backup |
| Object storage allegati | DA DEFINIRE | Sub-responsabile | DA DEFINIRE | MANCANTE | MANCANTE | Preferire storage UE/cifrato |
| Email provider | DA DEFINIRE | Sub-responsabile | DA DEFINIRE | MANCANTE | MANCANTE | Resend transactional |
| WhatsApp provider | DA DEFINIRE | Sub-responsabile/autonomo da valutare | DA DEFINIRE | MANCANTE | MANCANTE | WhatsApp Business/API o fallback wa.me |
| Monitoring/error tracking | DA DEFINIRE | Sub-responsabile | DA DEFINIRE | MANCANTE | MANCANTE | Sentry/altro |
| Backup/DR | DA DEFINIRE | Sub-responsabile | DA DEFINIRE | MANCANTE | MANCANTE | Retention e cifratura |
| Antivirus/OCR | DA DEFINIRE | Sub-responsabile | DA DEFINIRE | MANCANTE | MANCANTE | Se documenti inviati a provider esterno |

## 3. Clausole minime DPA

Ogni DPA deve includere:

- oggetto, durata, natura e finalita del trattamento;
- categorie dati e interessati;
- istruzioni documentate del titolare;
- obbligo di riservatezza;
- misure tecniche e organizzative;
- condizioni per sub-responsabili;
- supporto per diritti interessati;
- supporto per data breach;
- cancellazione/restituzione dati a fine servizio;
- audit/verification rights;
- trasferimenti extra UE e garanzie.

## 4. Misure tecniche richieste ai fornitori

| Controllo | Requisito minimo |
|---|---|
| Cifratura in transito | TLS 1.2+ |
| Cifratura a riposo | Obbligatoria per DB, backup, allegati |
| Access control | MFA per console provider, least privilege |
| Logging | Audit accessi amministrativi |
| Backup | Retention definita e restore test |
| Incident response | Notifica tempestiva data breach |
| Data location | Preferenza UE/SEE |
| Sub-processor | Lista aggiornata e diritto opposizione/notice |

## 5. Workflow approvazione fornitore

1. Product/Tech propone il fornitore.
2. Security valuta TOM, certificazioni, data location, accesso ai dati.
3. DPO/Legal valuta DPA, SCC, sub-processor.
4. Management approva rischio residuo.
5. Il fornitore viene inserito nel registro sub-responsabili.

## 6. Stato attuale

MANCANTE: fornitori reali e DPA firmati.  
Bloccante produzione: si, se il sistema tratta dati reali di clienti/documenti.
