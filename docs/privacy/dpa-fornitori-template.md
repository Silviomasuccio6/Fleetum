# Template DPA Fornitori / Responsabili del trattamento

Stato: TEMPLATE DA VALIDARE LEGALMENTE

Ultimo aggiornamento: 2026-05-05

## 1. Scopo

Questo template serve a censire e governare i fornitori che trattano dati personali per conto del titolare o del tenant.

Il documento non sostituisce un accordo legale firmato. Deve essere completato e approvato da Legal/DPO.

## 2. Fornitore

| Campo | Valore |
|---|---|
| Nome fornitore | DA COMPILARE |
| Servizio | DA COMPILARE |
| Ruolo privacy | Responsabile / Sub-responsabile / Titolare autonomo / DA VALUTARE |
| Paese trattamento | DA COMPILARE |
| Sub-processors | DA COMPILARE |
| DPA firmato | SI / NO |
| Data firma | DA COMPILARE |
| SCC/garanzie trasferimento | DA COMPILARE |
| Referente sicurezza | DA COMPILARE |

## 3. Categorie fornitori da censire

| Categoria | Esempi dati trattati | Rischio | DPA richiesto |
|---|---|---:|---:|
| Hosting/cloud | database, documenti, log | Alto | SI |
| Database managed | dati applicativi e personali | Alto | SI |
| Object/file storage | PDF, immagini documenti, contratti | Alto | SI |
| Email provider | email cliente, contratto PDF/link | Medio/Alto | SI |
| WhatsApp provider | telefono, messaggio, link contratto | Medio/Alto | SI |
| OCR/document analysis | immagini documenti, dati estratti | Alto | SI |
| Monitoring/logging | log, errori, IP, user agent | Medio | SI |
| Backup provider | dump DB, allegati | Alto | SI |

## 4. Clausole operative minime

Il DPA deve prevedere almeno:

- trattamento solo su istruzioni documentate;
- riservatezza delle persone autorizzate;
- misure tecniche e organizzative adeguate;
- gestione sub-processors con autorizzazione e notifica;
- supporto a richieste diritti interessati;
- supporto incidenti, data breach e DPIA;
- cancellazione o restituzione dati a fine servizio;
- evidenze di compliance e diritto di audit;
- gestione trasferimenti extra UE;
- tempi di notifica incidenti;
- obbligo di logica least privilege.

## 5. Matrice fornitori reali

| Fornitore | Categoria | Dati | Paese | DPA | Trasferimento extra UE | Stato |
|---|---|---|---|---:|---:|---|
| DA COMPILARE | hosting | database/allegati | DA COMPILARE | NO | DA VERIFICARE | P0 |
| DA COMPILARE | email | email/contratti | DA COMPILARE | NO | DA VERIFICARE | P0 |
| DA COMPILARE | WhatsApp | telefono/link | DA COMPILARE | NO | DA VERIFICARE | P0 |
| DA COMPILARE | OCR | documenti immagini/PDF | DA COMPILARE | NO | DA VERIFICARE | P0 |

## 6. Criteri di accettazione fornitore

Un fornitore puo essere usato in produzione solo se:

1. e identificato nel registro fornitori;
2. ha DPA firmato o ruolo privacy chiarito;
3. sono noti sub-processors e paesi trattamento;
4. sono note misure sicurezza e cifratura;
5. esiste processo di cancellazione/restituzione dati;
6. le credenziali sono gestite come segreti e non nel repository.

