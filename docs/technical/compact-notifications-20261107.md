# Fleetum — blocco 2: notifiche compatte e durata finita

7 novembre 2026. Branch locale `codex/payments-contracts-ux-20261106`.
Base del blocco: `ef15bb35e644d49dbc115104cc1f72e3ba5d360d`.
Commit applicativo: `8887ab9` (44 file, codice/test/verificatore).
Il blocco 1 è preservato. Nessun push, deploy, provider, VPS o dato reale.

## Diagnosi riprodotta

Il precedente store assegnava durata nulla a errori, avvisi, caricamenti e messaggi
con azione. Il componente applicava la variante compatta solo a brevi successi/info.
L'ownership inline eliminava alcuni popup invece di limitare gli annunci duplicati.
Il portal dentro un dialogo trasformato poteva usare il riquadro del dialogo come
riferimento geometrico, anziché il viewport.

Le prove aggiornate prima del fix hanno eseguito 34 casi: 14 riusciti e 20 falliti.
Le precedenti aspettative di popup permanenti sono state sostituite esplicitamente
con la politica finita approvata, senza rimuovere le verifiche di isolamento,
pausa, deduplica, concorrenza o integrità degli esiti.

## Percorso dei messaggi

1. Le azioni concluse usano `snackbar.success/error/...`; i caricamenti possono
   usare `snackbar.start`, che conserva chiave e contesto per il risultato successivo.
2. Il client HTTP conserva i controlli auth/CSRF/tenant/sede/licenza e registra il
   contesto notifiche all'inizio della richiesta. Validazioni di campo e controlli
   di sessione silenziosi non generano un secondo messaggio globale.
3. Lo store filtra i dettagli tecnici/credenziali, distingue eventi e operazioni,
   coalescenti quando coincidono handler e fallback HTTP. Nessun generico successo
   viene aggiunto a una risposta HTTP 202 in coda.
4. Il clock assegna a ogni elemento il proprio tempo residuo visibile. Nuovi eventi,
   render o callback equivalenti non riavviano il conto alla rovescia.
5. Il viewport mostra massimo tre popup e mantiene la posizione sopra la barra
   superiore. Quando un dialogo è aperto, i controlli restano nel suo albero DOM
   e nella relativa navigazione con tastiera.
6. Gli errori inline e gli stati delle risorse continuano a esistere indipendentemente
   dal popup. Il centro notifiche business e i suoi dati server non vengono riempiti
   con copie arbitrarie di errori, token o dati personali.

## Politica applicata

| Stato | Tempo visibile attivo | Alla scadenza |
| --- | --- | --- |
| Conferma | 3 secondi | Il popup si chiude |
| Informazione | 4 secondi | Il popup si chiude |
| Avviso | 6 secondi | Il popup si chiude |
| Errore | 8 secondi | Il popup si chiude; spiegazione/stato nella pagina rimangono |
| Caricamento | 10 secondi | Il solo popup si chiude; nessun successo o fallimento inventato |

La chiusura ha 120 ms di uscita. Azioni e descrizioni non rendono infinito il popup.
Hover e focus sospendono indipendentemente il tempo; tab nascosta sospesa. Alla
ripresa si consuma soltanto il residuo. La chiusura manuale termina anche se un
messaggio è in coda, sotto hover o nella tab nascosta.

Un caricamento risolto in tempo viene aggiornato nello stesso elemento. Se finisce
più tardi, l'esito può comparire come nuovo popup, solo nel contesto ancora valido.
I chiamanti mantengono busy/esito nelle rispettive pagine; nessun comando finanziario
viene ritentato dal clock. Gli attuali chiamanti applicativi non usavano un popup
loading come unica registrazione dello stato dell'operazione.

Coda: massimo 20 elementi, tre visibili. Gli elementi in attesa iniziano il loro
conto quando sono mostrati. In un picco superiore al limite, vengono omessi gli
esiti in attesa meno prioritari/più vecchi, preservando i tre già visibili; una nota
generica rimanda alle rispettive pagine. Nessun contenuto finanziario o personale
è copiato in una cronologia globale. La nota scompare insieme alla coda.

## Contesto e messaggi tardivi

Il contesto comprende tenant/utente/autorità e revisione sede, oppure revisione della
sessione Platform, più percorso/hash. Ogni cambio di questi valori produce una nuova generazione:
A → B → A non può riabilitare una callback catturata nella prima visita ad A.
I cambi cancellano la coda; i risultati vecchi vengono ignorati sul nuovo schermo.
Il solo cambio query (filtri o apertura del dettaglio appena creato nella stessa
pagina) conserva ID e tempo residuo: non cancella la conferma del salvataggio.

Il client HTTP acquisisce il contesto prima di attese e refresh. Sono stati inoltre
vincolati 41 percorsi di esito in 26 handler asincroni di calendario, eventi,
fermi, Platform e logout. Non cambiano le richieste, i salvataggi, le autorizzazioni
né i risultati delle operazioni. Tenant e Platform restano separati.

Inoltre `publishOperationFeedback` collega 67 esiti di salvataggio/comando già
espliciti in 16 file al popup, conservando il messaggio inline e il contesto catturato
prima dell’attesa. Prenotazioni, clienti, flotta, listini, utenti, impostazioni,
manutenzioni, scadenze, contratti e garanzie non restano quindi privi di conferma.
Le risposte di accodamento, richiesta o apertura di anteprima usano info con il
testo reale, senza inventare consegna email, pagamento o trasmissione. Le schermate
login/recupero Platform sono escluse da questo collegamento. Nessuna inferenza
automatica dal DOM o dal semplice successo HTTP.
La conferma email nel dettaglio cliente diceva «inviato» per lo stesso endpoint
accodato usato dalle altre pagine: ora indica «accodato» con tono informativo.
Una prova esegue quel vero handler e confronta l’esito con la pagina Contratti.

## Persistenza degli errori e accessibilità

I form e i pannelli di prenotazioni, garanzie e contratti conservano i propri errori.
Per cinque errori delle integrazioni calendario e otto percorsi Platform che si
limitavano al toast è stato aggiunto `useOperationIssue`: un solo errore della pagina,
filtrato e vincolato al contesto, visibile anche dopo la scadenza del popup. Non è una
nuova fonte contabile né una prova dell'esito del provider. Il nuovo tentativo può
sostituirlo; cambiando contesto non viene mostrato al nuovo utente/sede/schermo.

L'ownership inline ora governa l'annuncio, non l'esistenza del popup. Se la stessa
spiegazione è già annunciata da un alert/status della pagina, il popup rimane visibile
con live announcement disattivato. Il controllo viene aggiornato anche quando il
messaggio inline arriva dopo il primo render. Errori senza owner usano alert; gli
altri stati usano status. I contenuti sono testo React, non HTML eseguibile.

Nessun autofocus del popup, controlli raggiungibili da tastiera e pausa su focus.
Riduci movimento elimina entrata posizionale e rotazione dello spinner; non è stata
cambiata alcuna impostazione del Mac. Pulsanti touch con area adeguata, testi lunghi
integri e verifiche nei due temi/lingue.

## Posizione e variante grafica

Tutti i toni condividono la variante Compatta: icona laterale, testo e X. Descrizioni,
azioni e messaggi lunghi usano una riga espandibile della stessa famiglia, senza
troncamenti. Materiali/colori già presenti, nessun redesign di login o gestionale.

Il browser supportato usa un popover manuale nel top layer: evita trasformazioni
ed overflow degli antenati mantenendo il DOM nel dialogo. Il fallback calcola le
coordinate rispetto all'antenato trasformato, senza spostare i controlli fuori dal
focus scope. Verificati entrambi sul dialogo compatto reale di Fleetum, compreso il
controllo effettivamente raggiungibile al punto dello schermo e il ritorno al body.

Riferimento: [MDN showPopover](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/showPopover)
e [Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API).
La verifica riguarda Chromium; non è una prova fisica di tutte le versioni Safari.

## Revisione del comportamento

| Before | After | Why |
| --- | --- | --- |
| Errori/avvisi/azioni permanenti | Durate finite e pausa con residuo | La X diventa facoltativa |
| Solo pochi successi/info compatti | Tutti i toni della stessa famiglia | Coerenza con la variante scelta |
| Inline identico eliminava il popup | Popup visibile, annuncio duplicato evitato | Feedback riconoscibile e spiegazione persistente |
| Callback vecchia dopo ritorno alla stessa pagina | Generazione nuova e scope catturato | Nessuna notifica tardiva nel contesto successivo |
| Portal riferito alla modale trasformata | Riferimento al viewport e focus nel dialogo | Posizione coerente senza rompere la tastiera |
| Loading infinito | Popup finito, stato operazione separato | Nessun falso esito o invito a ripetere un addebito |

## Ambiente e ripetizione

macOS locale, Node 22.23.1, dipendenze già presenti del lockfile (nessuna installazione).
Nessun file env reale letto. Il browser usa solo dati e risposte sintetici.

```sh
# Node 22.23.1 nel PATH; nessuna variabile database reale.
npm run verify:frontend
# Solo contro l'anteprima UI del candidato, verificata dall'health check:
FLEETUM_NOTIFICATIONS_UI_URL=http://127.0.0.1:5180 node ops/verify-notifications-ui.mjs
node --check ops/verify-notifications-ui.mjs
git diff --check
```

Nell'esecuzione registrata la porta era **5287**, con copia temporanea del runner
`ops/ui-preview.mjs`, cache separata e `server.hmr=false`. La porta utente 5180
non è stata riavviata o sostituita. Il processo è stato identificato prima del
SIGTERM e il solo entrypoint temporaneo è stato eliminato al termine.
La suite browser è stata eseguita sui componenti finali; le successive correzioni
riguardano esclusivamente il testo/tono dell'email dal cliente e la persistenza di
errori Platform, coperti dai test di pagina e dall'ultima suite frontend completa.
Il build conserva il preesistente avviso Vite su una futura modalità di caricamento
configurazione: nessuna configurazione, dipendenza o soglia è stata modificata per
sopprimerlo. Type-check, build e prerender terminano con exit 0.

## Prove finali

- `npm run verify:frontend`: type-check, **404/404 test**, build e prerender riusciti;
  zero falliti o saltati. Le 72 prove mirate sono comprese nella suite finale.
- `ops/verify-notifications-ui.mjs`: **26/26 scenari Chromium**, clock controllato
  prima dell'avvio del componente, dati sintetici, zero richieste esterne o
  eccezioni JavaScript. Le risposte 503 della prova sono simulate intenzionalmente.
- Quaranta combinazioni tono/viewport/tema: cinque toni, quattro larghezze
  (320/390/768/1440), chiaro/IT e scuro/EN. In più testo lungo/azione, modale reale
  e fallback, tab/focus/hover, loading, errore inline, route/sede/tenant/Platform,
  picco di 1.000 messaggi, conferma salvataggio con cambio query senza reset del
  tempo, accodamento informativo e pagina Prenotazioni effettiva.
- Nella pagina Prenotazioni il riepilogo sintetico è stato fatto rispondere 503,
  mantenendo gli header di sede. Un solo popup compatto; dopo 8 secondi resta
  l'errore della sezione. Nessuna chiamata Stripe o mutazione finanziaria.
- Ispezione visiva di desktop, mobile scuro e popup con dialogo aperto.
- Controllo sintassi, diff e preservazione della base del blocco 1.

Il laboratorio dei componenti è sotto `ops/fixtures/notifications-ui.jsx`, non è
importato da alcun entrypoint prodotto. Serve esclusivamente su loopback dopo il
controllo health `ui-preview`. Bootstrap React idempotente e ricaricamento a caldo
spento nella copia temporanea: la doppia istanza osservata all'avvio della prima
prova era del laboratorio, non è stata nascosta dal verificatore.
I mock delle API snackbar sono stati aggiornati con capture; i test delle pagine
eseguono il vero helper di conferma anche nei contesti VM simulati. Nessuna
asserzione su logout, readonly, filtro o concorrenza è stata rimossa.

Backend, schema e query non modificati: nessun PostgreSQL avviato in questo blocco.
Le 896 prove database appartengono al blocco 1, non sono dichiarate ripetute qui.
`verify:release` completa rinviata al candidato dopo i cinque blocchi. Nessun nuovo
Nightly/CI/deploy o test provider; Safari/iPhone fisico e VoiceOver restano aperti.

Rollback locale: revert revisionato del commit applicativo `8887ab9` del blocco 2, senza
restore DB. Reintrodurrebbe popup permanenti e vecchia gestione dei contesti;
nessun rollback è stato eseguito.

Prossimo: **blocco 3, pagina Pagamenti e garanzie e fonte unica degli incassi**.
Contratti gratuiti/scontati/con residuo continuano a essere previsti; conversione,
firma in presenza e PDF professionale restano i blocchi 4 e 5.
