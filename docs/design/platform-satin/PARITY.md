> Matrice del candidato originario ee34ffb. Nell’allineamento a main c46ede5 restano le undici sezioni e il disegno; logout, sessioni ed email seguono ora i contratti correnti. Vedere [ALIGNMENT_20261113.md](ALIGNMENT_20261113.md).

# Platform Satinata — base e parità

## Base verificata il 13 novembre 2026

Branch isolato `codex/platform-satin-ui`, base `db1f231dc8cb699f1a5ce4215a0278c93212d16d`.
Il checkout staging `195742b99c192e2c6af1836c3dc2b79ccc874e3f` e quello dell'audit non vengono modificati.

Lettura attuale del VPS, senza environment/configurazioni/DB: frontend production `sha256:f45eee091eca06f8745ed94096eb9ebe06d79bc2c6ab41d1575405195d49f6eb`, tag `db1f231dc8cb`; backend con stesso tag. Frontend staging `sha256:cac62832cd9c344f3bf71143c079bb32474264ab376e26a2f0bad8028e16a786`. Nessuna etichetta OCI revision nel frontend. Il tag corrisponde al commit locale completo sopra, ma non costituisce da solo attestazione riproducibile dei sorgenti installati. `/opt/fleetum/app` non è un checkout git. Queste letture non attestano la revisione backend completa né chiudono l'audit sicurezza.

Main locale c46ede5 rispetto alla base contiene 431 file modificati: promuoverlo integralmente non rispetterebbe il solo restyling Platform. Nessun merge, push, deploy, segreto, accesso temporaneo o modifica live in questa tranche.

## Matrice delle funzioni

La pagina esistente e i suoi servizi restano la fonte applicativa, non il runtime statico del prototipo. Dove l'incumbent non aveva paginazione/ordinamento, non viene dichiarata una funzione inesistente.

| Sezione | Informazioni conservate | Filtri / azioni / controlli | Presentazione e prova richiesta |
|---|---|---|---|
| Panoramica | Aziende e licenze attive, scadenze 7 giorni, licenze da verificare, MRR e delta/mese, utenti live e finestra 15 minuti, top aziende, avvisi | Aggiorna, apri azienda su richiesta, accesso a elenco e audit | Strip 4 indicatori, tabella aziende, coda, live e attività; fixture completa/vuota/errore, nessuno zero da caricamento fallito |
| Aziende | Nome commerciale/legale, P.IVA, titolare e contatto, completezza, stato tenant, utenti/veicoli/seats, piano, prezzo, ciclo e scadenza | Ricerca azienda/titolare/P.IVA, piano, tutti i 7 stati licenza, attivo/inattivo, reset; azioni contestuali | Tabella completa con scorrimento locale; inspector apribile, filtri conservati alla chiusura |
| Licenze e piani | STARTER/PRO/ENTERPRISE da catalogo, MRR/lost/delta, ARPA/ARR, breakdown, trend, formule e periodi | 2W/1M/6M/1Y, CSV; cambio piano/downgrade, attivazione, trial 14g, rinnovo 30/365g, sospensione/riattivazione, disattiva/riattiva tenant, modifica manuale seats/prezzo/ciclo/stato/scadenza | Payload invariati; conferme native, blocco doppio invio sincrono, esito reale, ritorno focus |
| Fatture | Numero, azienda, importi, periodo, stato, delivery, tentativi/errori | Genera, scarica PDF, invia email, marca pagata con servizi esistenti e busy state | Nessun invio reale nel laboratorio; fallimento visibile; importo/incasso/consegna distinti |
| Utenti | Nome, email, stato, tenant | Apri azienda correlata | Dataset completo/parziale, nomi lunghi |
| Analytics sito | Visite, CTA, onboarding/checkout/trial, tassi, funnel, trend, pagine/fonti/campagne/device/browser e insight | Finestra 7/30/90 giorni | Grafici esistenti, contrasto, vuoto ed errore |
| Richieste demo | Azienda, referente, email/telefono, flotta, messaggio, fonte/UTM, data, stato e consegna | NEW/CONTACTED/QUALIFIED/WON/LOST/SPAM | Aggiornamento esistente, doppio invio impedito, errore inline |
| Eventi e audit | Tenant, azione, data, attore, IP, quick action, watchlist | Consultazione e navigazione alle aziende | Dati originali, nessuna attestazione sicurezza inventata |
| Stato servizi | API, DB, email/code, Stripe, storage, retention, eventi, backup e restore drill, RPO/RTO/table counts/uploads | Consultazione, aggiorna | Tutti i campi esistenti, nessuna modifica infrastruttura |
| Sicurezza | OTP contatto, TTL, IP/CORS, blocchi, dispositivi/stati/scadenze, eventi | Revoca dispositivo esistente | Stato da endpoint; nessun badge statico «IP restricted» come prova |
| Impostazioni | Workspace, conteggi, navigazione/strumenti operativi | Aggiorna tutto, reset filtri, link sezioni | Nessuna nuova configurazione provider |

## Confini

Invariati: backend, DB/migrazioni, endpoint/payload API, contratti commerciali, auth/storage, route guard, schermate login/reset, gestionale tenant, sito pubblico, loghi originali. CSS aggiunto solo dall'entry Platform e ogni selettore sotto `.platform-satin` (oppure `.dark .platform-satin`). Dialog nativi restano discendenti della shell, nessun portal in body. Toast dedicati solo alla Console autenticata; login mantiene il viewport originario.

Il logout mantiene il contratto della base production (pulizia locale Platform). Non dichiarare revoca server come nuova capacità: l'implementazione successiva su main richiede allineamento backend separato. L'audit preesistente rimane distinto.

## Direction contract

THESIS: Console operativa per leggere aziende, licenze e priorità, con la Satinata scelta da Silvio.
OWN-WORLD: neutri freddi, blu Fleetum, superfici dati opache, chrome satinato, carattere di sistema, loghi originali.
STORY: individuare un'azienda o un'anomalia, aprire il dettaglio e usare i controlli esistenti senza perdere contesto.
FIRST VIEWPORT: sidebar 212 px, gap/inset 12px, toolbar 64 px, quattro indicatori, elenco e coda laterale; live/attività sotto.
FORM: Satinata selezionata nell'anteprima interattiva, `evidence/desktop-satin.png`; seed: none (unavailable).
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Eccezione frontend circoscritta ai servizi: il parser delle metriche live rifiuta il precedente fallback404 a valori zero, preservando status/code auth. Endpoint, richieste e servizi backend restano invariati.
