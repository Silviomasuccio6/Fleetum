# DPIA - Valutazione d'impatto privacy preliminare

Stato: BOZZA TECNICA DA VALIDARE

Owner: DPO + Legal

Supporto tecnico: Security Engineer + Tech Lead

Ultimo aggiornamento: 2026-05-05

## 1. Decisione preliminare

Esito screening: DPIA RACCOMANDATA / DA COMPLETARE PRIMA DEL GO-LIVE.

Motivi tecnici:

- Il gestionale tratta documenti personali caricati come PDF/JPG/PNG/WebP.
- Sono previsti documenti di identita, patente, firme contrattuali, dati fiscali e contatti.
- Il prodotto e SaaS multi-tenant: un errore di isolamento puo esporre dati tra clienti diversi.
- Sono presenti funzioni di OCR/analisi documentale e generazione contratti.
- Sono previsti invii tramite email/WhatsApp e link/documenti condivisibili.

## 2. Descrizione trattamento

| Elemento | Descrizione |
|---|---|
| Sistema | Gestionale autonoleggio / flotta / fermi tecnici |
| Utenti | operatori tenant, amministratori, platform admin |
| Interessati | clienti noleggio, conducenti, referenti societa, utenti SaaS |
| Dati principali | anagrafica, documenti, patente, contratti, firma, booking, veicoli, allegati |
| Finalita | noleggio, contratti, gestione flotta, manutenzione, sicurezza, reporting |
| Tecnologia | React, Node/Express, Prisma/PostgreSQL, filesystem/storage allegati |

## 3. Necessita e proporzionalita

| Valutazione | Stato | Note |
|---|---:|---|
| Dati anagrafici cliente | NECESSARI | necessari per contratto e operativita noleggio |
| Patente | NECESSARIA | requisito operativo per conducenti |
| Documento identita | DA VALIDARE | minimizzare copia integrale se non indispensabile |
| Tessera sanitaria | DA LIMITARE | acquisire solo se strettamente necessario; evitare dati non pertinenti |
| Allegati fatture/manutenzioni | NECESSARI/PARZIALI | distinguere documenti contabili da documenti non essenziali |
| OCR documenti | UTILE MA RISCHIOSO | prevedere conferma manuale prima del salvataggio definitivo |
| Invio WhatsApp | DA GOVERNARE | usare link sicuri a scadenza, non allegati pubblici permanenti |

## 4. Rischi e misure

| ID | Rischio | Impatto | Probabilita | Livello | Misure richieste | Stato |
|---|---|---:|---:|---:|---|---|
| DPIA-R01 | Accesso non autorizzato ad allegati/documenti | Alto | Medio | Alto | RBAC, tenant isolation, audit download, storage privato | PARZIALE |
| DPIA-R02 | IDOR tra tenant su API/documenti | Critico | Medio | Critico | test tenant isolation, query tenant-safe, deny by default | DA TESTARE |
| DPIA-R03 | Conservazione eccessiva documenti | Alto | Alto | Alto | retention policy, job cancellazione, review periodica | DA IMPLEMENTARE |
| DPIA-R04 | File malevoli caricati | Alto | Medio | Alto | mime/magic validation, antivirus scan, limiti size | PARZIALE |
| DPIA-R05 | Dati personali in log/errori | Medio | Medio | Medio | log redaction, errori generici in produzione | DA VERIFICARE |
| DPIA-R06 | Link contratto condivisibile troppo esposto | Alto | Medio | Alto | token scadenza, revoca, audit accessi | DA IMPLEMENTARE/VERIFICARE |
| DPIA-R07 | OCR errato compila dati sbagliati | Medio | Medio | Medio | confidence score, revisione manuale obbligatoria | PARZIALE |
| DPIA-R08 | Backup con documenti non cancellabili | Alto | Medio | Alto | backup retention breve, cifratura, restore test, policy cancellazione differita | DA DEFINIRE |
| DPIA-R09 | Accesso platform admin troppo ampio | Alto | Medio | Alto | RBAC platform, break-glass, audit admin | DA VERIFICARE |

## 5. Misure minime prima della produzione

P0:

- DPIA approvata da DPO/Legal.
- Test tenant isolation su API clienti, booking, contratti, allegati.
- Retention e cancellazione/anonymizzazione implementate.
- DPA fornitori firmati e censiti.
- Storage allegati privato, con audit download.
- Link contratti con token a scadenza e revoca.

P1:

- Antivirus/malware scan upload.
- Alerting su accessi falliti e download anomali.
- Log redaction verificata.
- Procedure data breach operative.

## 6. Rischio residuo

Rischio residuo attuale: ALTO.

Motivazione: la base documentale ora esiste, ma mancano ancora validazione legale, implementazione tecnica completa della retention, evidenze di test tenant isolation e governance effettiva dei fornitori.

## 7. Decisione go-live privacy

Decisione preliminare: NO-GO PRIVACY fino a chiusura P0.

La decisione puo diventare GO WITH CONDITIONS solo con:

- approvazione DPO/Legal;
- mitigazioni P0 implementate e testate;
- tracciabilita fornitori e DPA;
- piano P1 con owner e data.

