# Data Retention e Cancellazione

Stato: BOZZA TECNICA DA VALIDARE

Owner: DPO + Legal + Tech Lead

Ultimo aggiornamento: 2026-09-19

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
| Eventi analytics sito con consenso | percorso, attribuzione, identificativi pseudonimi | default tecnico 90 giorni | cancellazione automatica | configurabile; validare con DPO/Legal |
| Richieste demo | contatti e richiesta commerciale | default tecnico 365 giorni | cancellazione automatica | configurabile; validare con DPO/Legal e processo commerciale |
| Coda email conclusa | destinatario, oggetto, corpo, errore e metadati | default tecnico 30 giorni dopo ultimo aggiornamento | elimina il contenuto, conserva solo stato e riferimenti tecnici ammessi | solo record `SENT`/`FAILED`; configurabile |

I tre periodi aggiunti sono valori tecnici iniziali e non costituiscono una conclusione legale. Prima dell'attivazione in produzione devono essere approvati dal DPO/Legal e impostati tramite `PRIVACY_RETENTION_WEBSITE_EVENT_DAYS`, `PRIVACY_RETENTION_DEMO_LEAD_DAYS` e `PRIVACY_RETENTION_EMAIL_QUEUE_PAYLOAD_DAYS`. La parte globale del job resta disattivata finche `PRIVACY_RETENTION_GLOBAL_ENABLED` non viene impostato esplicitamente a `true`.

La retention della coda email non modifica elementi in attesa. Per i record conclusi conserva id, stato, tentativi, date e un insieme limitato di riferimenti operativi; sostituisce destinatario, oggetto e corpo con `[redacted]`, rimuove l'ultimo errore e scarta metadati liberi o allegati incorporati.

L'anteprima globale si esegue con `npm run privacy:retention:dry-run -w backend -- --global`. L'esecuzione richiede la modalità esplicita `npm run privacy:retention:run -w backend -- --global`. Entrambe restituiscono solo policy, date limite e conteggi aggregati, senza contenuti personali.

## Impatto e rollback della migrazione

La migrazione aggiunge a `EmailQueue` una colonna nullable e un indice per individuare i payload ancora da eliminare. Non modifica contratti, fatture, righe fattura, pagamenti o altri record soggetti a obblighi fiscali o civilistici. Prima del deploy va eseguita l'anteprima globale e va valutato il tempo di creazione dell'indice sul volume reale.

Per il rollback strutturale, distribuire prima il codice precedente, eliminare l'indice `EmailQueue_payloadPurgedAt_status_updatedAt_idx` e poi la colonna `payloadPurgedAt`. La cancellazione di eventi e lead e la redazione dei payload email sono intenzionalmente irreversibili nel database primario; un recupero richiede un backup autorizzato e deve rispettare la stessa policy privacy.

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
