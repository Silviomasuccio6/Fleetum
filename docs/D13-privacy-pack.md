# D13 Privacy Pack (RoPA, DPIA, informative, DPA)

Stato: PRESENTE-PARZIALE

Esito readiness: WARN

Owner: DPO + Legal + Tech Lead

Ultimo aggiornamento: 2026-05-05

## Scopo

Questo documento sostituisce lo stato precedente `ASSENTE` e indicizza il pacchetto privacy operativo del gestionale.

Il pacchetto copre:

- RoPA / registro trattamenti.
- DPIA tecnica preliminare.
- Template informativa privacy.
- Template DPA / accordo responsabile trattamento fornitori.
- Policy retention e cancellazione.
- Mappa controlli tecnici privacy.

Nota importante: i documenti sono una base tecnica e operativa versionata. Prima della produzione serve revisione formale DPO/Legal, completamento dei campi aziendali e approvazione finale.

## Evidenze repository

| Documento | Stato | Path |
|---|---:|---|
| RoPA | PRESENTE-PARZIALE | `/docs/privacy/ropa.md` |
| DPIA | PRESENTE-PARZIALE | `/docs/privacy/dpia.md` |
| Informativa privacy | PRESENTE-PARZIALE | `/docs/privacy/informativa-privacy-template.md` |
| DPA fornitori | PRESENTE-PARZIALE | `/docs/privacy/dpa-fornitori-template.md` |
| Data retention / cancellazione | PRESENTE-PARZIALE | `/docs/privacy/data-retention-deletion-policy.md` |
| Controlli tecnici privacy | PRESENTE-PARZIALE | `/docs/privacy/privacy-technical-controls.md` |
| Controlli compliance locali | PRESENTE | `/docs/privacy/local-compliance-controls.md` |

File complementari presenti nella stessa cartella:

- `/docs/privacy/informativa-privacy.md`
- `/docs/privacy/dpa-fornitori.md`
- `/docs/privacy/misure-tecniche-organizzative.md`
- `/docs/privacy/retention-cancellazione.md`
- `/docs/privacy/local-compliance-controls.md`
- `/docs/privacy/README.md`

## Baseline normativa usata

Riferimenti tecnici di baseline:

- GDPR Art. 30: registro delle attivita di trattamento.
- GDPR Art. 35: valutazione d'impatto sulla protezione dei dati.
- GDPR Art. 28: responsabili del trattamento e accordi con fornitori.
- Linee guida EDPB/WP29 sulla DPIA come riferimento metodologico.

## Dati personali trattati dal gestionale

| Area | Dati trattati | Note |
|---|---|---|
| Utenti SaaS | nome, email, ruoli, sessioni, audit | dati operativi account |
| Clienti noleggio | nome, cognome, email, telefono, indirizzo, CF | persone fisiche |
| Societa clienti | ragione sociale, P.IVA, PEC, SDI, referente | persone giuridiche + referenti |
| Documenti | patente, documento identita, passaporto, tessera sanitaria, allegati PDF/JPG/PNG/WebP | area ad alto rischio operativo |
| Contratti | PDF contratto, firme, OTP/firma remota se attivata, delivery email/WhatsApp | dati contrattuali |
| Booking | prenotazioni, uscite/rientri, km, veicolo, sede | dati operativi |
| Fermi/manutenzioni | fatture, allegati, costi, fornitori/officine | dati economici/documentali |
| Scadenziario | revisioni, scadenze km, reminder | dati veicolo |
| Log/audit | accessi, modifiche, invii, download, errori | non devono contenere segreti o documenti integrali |

## Principi operativi da applicare

- Data minimization: raccogliere solo dati necessari al noleggio, contratto, obblighi amministrativi e sicurezza.
- Purpose limitation: separare finalita operative, contrattuali, fiscali, sicurezza e supporto.
- Retention definita: ogni categoria dati deve avere periodo di conservazione e trigger di cancellazione.
- Accesso least privilege: visibilita dati documentali solo a ruoli autorizzati.
- Tenant isolation: nessun dato cliente deve essere leggibile da tenant diversi.
- Auditability: operazioni critiche su dati personali/documenti/contratti devono essere tracciate.
- Secure storage: allegati documentali non devono restare in storage pubblico non cifrato o non governato.

## Gap ancora aperti

| Gap | Impatto | Priorita | Owner |
|---|---:|---:|---|
| Validazione DPO/Legal mancante | Go-live non approvabile formalmente | P0 | DPO + Legal |
| Campi aziendali/titolare/DPO non compilati | Informativa e RoPA incompleti | P0 | Legal |
| Retention tecnica local implementata, da validare e collegare a policy definitiva | Rischio conservazione eccessiva se non configurata in produzione | P0 -> P1 | Tech Lead + DPO |
| Cancellazione/anonymizzazione local implementata per clienti noleggio, da validare con Legal | Rischio diritti interessato non gestiti su tutti i casi legali | P0 -> P1 | Tech Lead + Legal |
| Allegati su filesystem applicativo | Rischio backup/deploy/permessi/storage | P1 | DevOps |
| Antivirus reale produzione non collegato | Rischio file malevoli | P1 | Security |
| Cifratura a riposo non verificabile | Rischio protezione documenti | P1 | DevOps |
| DPA reali con fornitori non allegati | Rischio contrattuale fornitori | P0 | Legal |

## Criterio di chiusura D13

D13 puo passare a `PRESENTE-CONFORME` solo quando:

1. DPO/Legal validano RoPA, DPIA, informative e DPA.
2. I fornitori reali sono censiti e collegati a DPA firmati.
3. Retention e cancellazione sono implementate tecnicamente e testate.
4. Upload/download documenti hanno controlli di sicurezza completi.
5. I log non contengono dati personali eccedenti o segreti.
6. Esistono evidenze di test su tenant isolation, RBAC e download allegati.
