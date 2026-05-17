# Data Retention e Cancellazione

Stato: BOZZA TECNICA DA VALIDARE

Owner: DPO + Legal + Tech Lead

Ultimo aggiornamento: 2026-05-05

## 1. Obiettivo

Definire criteri minimi di conservazione, cancellazione, anonimizzazione e prova tecnica per i dati personali/documentali trattati dal gestionale.

## 2. Principi

- Conservare solo cio che serve.
- Separare dati operativi, contrattuali, fiscali, sicurezza e supporto.
- Limitare le copie documentali ad alto rischio.
- Rendere cancellazione/anonymizzazione testabile.
- Tenere audit della cancellazione senza conservare contenuto personale eccedente.

## 3. Matrice retention proposta

| Categoria | Esempi | Retention proposta | Azione a scadenza | Note |
|---|---|---|---|---|
| Account utenti | nome, email, ruolo | durata account + 24 mesi audit | anonimizza/disattiva | validare con policy sicurezza |
| Clienti anagrafica | nome, contatti, CF/P.IVA | durata rapporto + obblighi applicabili | anonimizza se non piu necessario | non cancellare se collegato a obbligo legale |
| Documenti identita/patente | scansioni, OCR, numero documento | minimo necessario; proposta 12 mesi dopo ultimo noleggio | elimina allegato e conserva solo metadati necessari | da validare Legal |
| Contratti PDF | contratto, firma, delivery | da definire con obblighi civilistici/fiscali | conserva o archivia cifrata | spesso serve conservazione pluriennale |
| Fatture/manutenzioni | PDF fatture, costi | secondo obblighi fiscali applicabili | conserva fino a scadenza fiscale | validare fiscalista/Legal |
| Booking operativo | periodo, veicolo, km, cliente | durata rapporto + obblighi contrattuali | anonimizza cliente se possibile | mantenere analytics aggregata |
| Log applicativi | errori, IP, user agent | 30-180 giorni | cancellazione automatica | evitare PII nei log |
| Audit sicurezza | actor, azione, oggetto, esito | 24 mesi | cancellazione/archiviazione | necessario per incident response |
| Export generati | CSV/XLSX/PDF temporanei | max 7-30 giorni se server-side | elimina file | preferire download diretto non persistente |
| Backup | DB/allegati | 30-90 giorni | rotazione automatica | backup cifrati e restore testato |

## 4. Workflow cancellazione

1. Ricezione richiesta o trigger retention.
2. Verifica identita/richiesta e vincoli legali.
3. Classificazione dati:
   - cancellabili subito;
   - anonimizzabili;
   - da conservare per obbligo legale;
   - presenti in backup in attesa rotazione.
4. Esecuzione:
   - soft delete record operativo;
   - cancellazione allegati non necessari;
   - anonimizzazione campi personali;
   - revoca link condivisibili;
   - audit evento cancellazione.
5. Conferma completamento.
6. Scadenza naturale backup secondo rotazione.

## 5. Requisiti tecnici da implementare

| Requisito | Priorita | Done quando |
|---|---:|---|
| Job retention schedulato | P0 | esegue in ambiente test e produce report |
| API/admin action cancellazione cliente | P0 | cancella/anonymizza dati secondo policy |
| Cancellazione allegati filesystem/storage | P0 | file fisico non piu accessibile |
| Revoca link contratto/documento | P0 | token invalidato immediatamente |
| Audit cancellazione | P0 | evento consultabile senza PII eccedente |
| Report dati conservati per cliente | P1 | esporta mappa dati per richiesta accesso |
| Retention backup documentata/testata | P1 | restore test + retention evidenziata |

## 6. Evidenze richieste per go-live

- Test automatico o smoke test cancellazione.
- Log/audit evento retention.
- Documentazione backup retention.
- Verifica manuale che allegati cancellati non siano scaricabili.
- Approvazione DPO/Legal sui periodi.

