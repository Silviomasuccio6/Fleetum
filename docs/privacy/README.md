# Privacy Pack

Stato: BOZZA TECNICA VERSIONATA

Ultimo aggiornamento: 2026-05-05

## Scopo

Questa cartella contiene il pacchetto privacy D13 del gestionale.

I documenti sono pensati come base operativa per produzione SaaS, ma non sono un parere legale. Prima del go-live devono essere completati con dati aziendali reali e validati da DPO/Legal.

## Struttura

| File | Uso |
|---|---|
| `ropa.md` | Registro trattamenti / RoPA operativo |
| `dpia.md` | DPIA tecnica preliminare |
| `informativa-privacy-template.md` | Template informativa da personalizzare |
| `informativa-privacy.md` | Bozza informativa estesa, se usata dal team |
| `dpa-fornitori-template.md` | Template DPA fornitori |
| `dpa-fornitori.md` | Bozza registro/DPA fornitori estesa, se usata dal team |
| `data-retention-deletion-policy.md` | Policy retention/cancellazione tecnica |
| `retention-cancellazione.md` | Bozza retention estesa, se usata dal team |
| `privacy-technical-controls.md` | Controlli tecnici privacy-by-design |
| `misure-tecniche-organizzative.md` | TOM / misure tecniche e organizzative |

## Regola di utilizzo

- I file `*-template.md` sono modelli riutilizzabili.
- I file senza `template` possono essere usati come documenti operativi del tenant/azienda.
- Ogni documento approvato deve riportare versione, data, owner e stato.
- Ogni modifica rilevante va collegata al piano remediation privacy.

## Gate prima della produzione

Prima del go-live servono:

1. approvazione DPO/Legal;
2. DPA reali firmati con fornitori;
3. retention tecnica implementata e testata;
4. cancellazione/anonymizzazione verificata;
5. storage allegati governato, privato e cifrato;
6. test tenant isolation e RBAC su dati personali;
7. audit download/export documenti.

