## Aggiornamento prioritario — B10, 25 ottobre 2026

B10 implementato e verificato in locale; rimane B11. Login identico e stile B approvato. Consegna `/Users/silvio/Documents/Playground/Fleetum-ui-ux-20261020/CONSEGNA_B10_20261025.md`; ripresa `/Users/silvio/Documents/Playground/Fleetum-ui-ux-20261020/RIPRESA_B10_COMPLETATO_20261025.md`. 246 test frontend, tipi/build/13 prerender e 22 controlli API/DB PASS; PostgreSQL temporaneo rimosso. 16 file B10; 600 file confrontati, 584 invariati, inclusi 247 backend/53 Prisma; 13 file login identici. Stato Git e diff-check ora disponibili, nessuna ricostruzione dell’indice. Runtime `/private/tmp/fleetum-b07-qa-20261023`, anteprima `http://127.0.0.1:5180/signup`, soli dati sintetici. Nessun commit/push/merge/deploy/provider/VPS. Gate file/PDF, zoom/testo/lettore schermo e verifica globale restano B11. Questa nota prevale sullo storico.

## Aggiornamento prioritario — B09, 24 ottobre 2026

B09 implementato e verificato localmente. Consegna `/Users/silvio/Documents/Playground/Fleetum-ui-ux-20261020/CONSEGNA_B09_20261024.md`; ripresa `/Users/silvio/Documents/Playground/Fleetum-ui-ux-20261020/RIPRESA_B09_COMPLETATO_20261024.md`. Prossimo B10, poi B11; login invariato. 224 test frontend, tipi/build/13 prerender, 22 controlli API e 7+7 verifiche UI/DB PASS. Il laboratorio PostgreSQL è rimosso; l’anteprima sintetica resta su 127.0.0.1:5180. 15 sorgenti B09; 583 precedenti invariati, inclusi 248 backend. Nessuna migrazione, pubblicazione o modifica a produzione/provider. Gate trasversali già assegnati a B11 preservati. Questa nota prevale sullo storico.

## Ripresa prioritaria B08 — 24 ottobre 2026

B08 implementato e verificato in locale; prossima implementazione **B09 — Profilo, azienda, utenti e fatturazione**. Consegna: `/Users/silvio/Documents/Playground/Fleetum-ui-ux-20261020/CONSEGNA_B08_20261024.md`. 213 test, TypeScript/build e 13 prerender PASS; 23 osservazioni browser, 184 campioni contrasto; salvataggi ed export su PostgreSQL sintetico, ora rimosso. 12 file della tranche, 583 sorgenti precedenti invariati compresi 248 backend; login identico. Nessun commit/push/deploy/VPS/provider.

Non rifare B00–B08 né scegliere nuovamente lo stile. B09–B11 sono i tre blocchi residui. Preserva gate file/PDF, ambiguità EN → IT del traduttore globale e verifica dello stato Git ancora limitata da iCloud; diff --check, HEAD, branch e impronte verificati. L’anteprima 5180 usa la copia di esecuzione `/private/tmp/fleetum-b07-qa-20261023`, non è la fonte da modificare.

## Ripresa prioritaria B07 — 24 ottobre 2026

B07 implementato e verificato in locale; prossima implementazione B08. Consegna: `/Users/silvio/Documents/Playground/Fleetum-ui-ux-20261020/CONSEGNA_B07_20261024.md`. 200 test frontend e build/prerender PASS; prove persistenti soltanto su PostgreSQL sintetico, laboratorio rimosso. Login e backend invariati, nessun commit/push/deploy. Indice Git iCloud ancora da rendere disponibile per lo stato globale; confronto sorgenti e diff per file verificati. L’anteprima su 5180 usa la copia di esecuzione locale, le modifiche continuano in questo checkout. Piano B00–B11 e gate manuali condivisi invariati.

## Aggiornamento prioritario B06 — 23 ottobre 2026

Contratti, Listini e modello aziendale implementati nella copia UI isolata, con card **B — Lieve profondità**, dettagli chiaro/scuro e apertura Fleetum. **Login identico.** Consegna corrente: `/Users/silvio/Documents/Playground/Fleetum-ui-ux-20261020/CONSEGNA_B06_20261023.md`: 185 test frontend, TypeScript/build/prerender PASS; 21 controlli browser riusciti e 1 PDF parziale; 25 coppie contrasto PASS; 14 controlli sul PostgreSQL temporaneo e 48 checksum migrazioni, poi rimozione delle risorse. 69 siti API con argomenti e payload invariati, 247 sorgenti backend e 10 file login identici.

**Ripresa: B07 — Fermi, manutenzioni e scadenze.** B06 mantiene il gate manuale PDF/file già condiviso con i blocchi precedenti; HTTP e file generati sono verificati, la resa nel browser integrato resta da confermare. Il piano mantiene B00–B11. Nessuna pubblicazione/deploy/VPS/provider; branch `codex/ui-ux-booking-pilot`, HEAD `e711626cafdfb757836548aa00ee10d1b5272525`, modifiche locali. [Anteprima Listini](http://127.0.0.1:5180/booking/listini), dati fittizi e salvataggi disattivati. Non rifare l’allineamento o B06. Questa nota prevale sullo storico sottostante.

## Aggiornamento prioritario — allineamento B00–B05, 23 ottobre 2026

Riferimento approvato card B, materiali chiaro/scuro e movimento Fleetum ora applicati a Clienti, Prenotazioni, Dashboard e Veicoli. Consegna corrente: `/Users/silvio/Documents/Playground/Fleetum-ui-ux-20261020/CONSEGNA_ALLINEAMENTO_B00_B05_20261023.md`. 171 test e build/prerender PASS; 28 osservazioni browser, 85 misure di contrasto, 52 siti di chiamata API identici. Login e codice fuori perimetro preservati, nessuna nuova prova DB. Lavoro locale non pubblicato sul branch e HEAD già indicati sotto.

**Prossimo B06 — Contratti e listini**, con gli stessi materiali, dopo mappatura funzionale. Allineamento delle quattro pagine concluso; non ripeterlo alla ripresa. Gate manuali file/PDF/libretto e B11 invariati. Nessun deploy, merge, push, VPS o provider. Questa nota prevale sullo storico successivo.

## Aggiornamento prioritario B05 — 22 ottobre 2026

Clienti e documenti implementati e verificati in locale. Consegna corrente `/Users/silvio/Documents/Playground/Fleetum-ui-ux-20261020/CONSEGNA_B05_20261022.md`, mappa `screens/B05_CLIENTI.md`, prove `verification/b05-customers-20261022/`. 162 test frontend + typecheck/build/prerender PASS, 24 osservazioni CUA, 16 misure contrasto PASS. Persona/società, indirizzi, modifica, allegati/rimozione, bozza di scansione e storico su PostgreSQL 16 sintetico verificati, 48 checksum identici; container e directory temporanea rimossi. Parser positivo su PDF sintetico verificato separatamente. 54 campi e 11 use case preservati + createCustomer già disponibile; 10 file login e 17 sorgenti precedenti fuori perimetro identici. UI locale non pubblicata su `codex/ui-ux-booking-pilot`, HEAD `e711626cafdfb757836548aa00ee10d1b5272525`. Stile satinato e login invariati. Restano i gate manuali di apertura file/PDF già previsti, revisione e B11. Prossimo blocco **B06 — Contratti e listini**; gli ID B00–B11 non cambiano. Nessun push/PR/merge/deploy/VPS/provider. Anteprima `http://127.0.0.1:5180/anagrafiche/clienti`, sola lettura e dati fittizi. Questa nota prevale sullo storico sottostante.

## Aggiornamento prioritario B04 — 22 ottobre 2026

Veicoli implementato e verificato in locale: elenco, dettagli, nuovo/modifica, importazione e rimozioni. Consegna corrente: `/Users/silvio/Documents/Playground/Fleetum-ui-ux-20261020/CONSEGNA_B04_20261022.md`; mappa `screens/B04_VEICOLI.md`; prove `verification/b04-vehicles-20261021/`, runtime odierno in `attempt-3-20261022/`. Node 22.23.1, 147 test + typecheck/build/prerender PASS, 25 osservazioni browser, 18 misure contrasto PASS, scritture sintetiche su PostgreSQL 16 e 48 checksum verificati. Container/directory temporanei rimossi. 9 use case e 14 campi preservati, 10 file login e 12 sorgenti B02/B03 fuori perimetro identici. Tranche non pubblicata su `codex/ui-ux-booking-pilot`, HEAD `e711626cafdfb757836548aa00ee10d1b5272525`. Login identico, stile satinato invariato, nessuna nuova direzione da scegliere. Prossima implementazione **B05 — Clienti e documenti**, piano invariato B00–B11. Restano manuali apertura libretto e il gate B02 allegati/PDF/stampa; nessuna conformità completa o idoneità production dichiarata. Nessun push/merge/deploy/VPS/provider. Anteprima `http://127.0.0.1:5180/anagrafiche/veicoli`, dati sintetici e scritture disattivate. Per la ripresa prevale questa nota; sotto rimane lo storico.

## Aggiornamento prioritario B03 — 21 ottobre 2026

Dashboard applicativa completata e verificata in locale. Consegna corrente: `/Users/silvio/Documents/Playground/Fleetum-ui-ux-20261020/CONSEGNA_B03_20261021.md`. Mappa: `screens/B03_DASHBOARD.md`. Node 22.23.1, 136 test frontend + typecheck/build/prerender, 17 controlli CUA e 24 coppie contrasto PASS. Sette query esistenti conservate con guardie ruolo/piano, nessun backend/schema/HTTP mutato; B03 browser usa fixture e non promuove i gate database/staging. Login e B00/B01/B02 preservati. B02.6 resta aperto soltanto per apertura allegati/PDF/stampa manuale. Prossimo blocco **B04 — Veicoli e disponibilità** del piano invariato B00–B11. Nessun push/PR/merge/deploy/VPS/provider eseguito. Stato locale non committato su `codex/ui-ux-booking-pilot`, HEAD `e711626cafdfb757836548aa00ee10d1b5272525`. Anteprima `http://127.0.0.1:5180/dashboard`. Le note sottostanti sono storico: per la ripresa prevale questo aggiornamento e la consegna B03.

## Aggiornamento prioritario B02 — 21 ottobre 2026

B02 implementato nella copia UI, login invariato. Consegna corrente: `/Users/silvio/Documents/Playground/Fleetum-ui-ux-20261020/CONSEGNA_B02_20261021.md`. 126 test frontend + build, 19 vendor, salvataggi sintetici e 48 checksum migrazioni PASS. Unico gate specifico aperto: apertura allegati/PDF/stampa nel browser, da verificare manualmente; la policy IAB ha bloccato l’apertura, nessun aggiramento. Upload/rimozione PASS. Il piano mantiene B00–B11, B03 Dashboard è il prossimo blocco di implementazione. Nessuna pubblicazione o modifica production autorizzata. Le sezioni successive conservano lo storico; per lo stato corrente prevale questa nota e la consegna B02.

# Fleetum Workspace — pilota Prenotazioni

## Aggiornamento B01 — 21 ottobre 2026

Nuova/modifica prenotazione riordinate in quattro sezioni, con riepilogo e comandi fissi, errori collegati ai campi e traduzioni del modulo completate. Login invariato per istruzione esplicita. 117 test frontend e 28 controlli CUA riusciti; creazione, ricaricamento e modifica/consuntivo verificati sul PostgreSQL temporaneo, poi rimosso. Backend, API e sicurezza non modificati. Consegna e limiti: `/Users/silvio/Documents/Playground/Fleetum-ui-ux-20261020/CONSEGNA_B01_20261021.md`. Prossimo blocco B02.

## Storico: materiale scelto e applicato

Silvio ha scelto l’esempio di minimalismo con vetro satinato e ha autorizzato di applicarlo alla pilota. Aggiornati soltanto stili comuni, classi/attributo del layout e posizione del banner del laboratorio. Tutti i percorsi funzionali e i controlli del prodotto sono preservati. La pagina aggiornata è su `http://127.0.0.1:5180/booking`.

Nuove verifiche: `npm run verify:frontend` con Node 22.23.1 PASS (113/113 test, typecheck e build/prerender); 18 verifiche browser CUA riuscite con due attese dello scenario lento risolte e documentate; sei larghezze senza overflow del documento; contrasto selezionato 16/16 PASS. Non rieseguiti il precedente runner Playwright/axe o i gate backend/database. Consegna attuale: `/Users/silvio/Documents/Playground/Fleetum-ui-ux-20261020/CONSEGNA_VETRO_PRENOTAZIONI_20261020.md`. Le informazioni seguenti descrivono la base della prima pilota e restano distinte dalle prove attuali.

20 ottobre 2026. Prima implementazione locale da rivedere con Silvio, non redesign concluso dell'intero gestionale.

## Copia e perimetro

- Checkout UI: `/Users/silvio/Documents/Playground/Fleetum-ui-booking-20261020`.
- Branch: `codex/ui-ux-booking-pilot`, base `e711626cafdfb757836548aa00ee10d1b5272525`; tree iniziale uguale alla release staging `4f0450667cf45af6cebeb9cfbf9e5cec6019e2c5`.
- Checkout Git isolato, con cronologia comune alle altre copie; non è un nuovo repository GitHub. Nessun merge, push o deploy eseguito.
- Backend, database, provider e regole del dominio non modificati. Le prove di questa pilota sono locali e sintetiche.

Il metodo, il sistema comune e la scheda funzionale sono in `/Users/silvio/Documents/Playground/Fleetum-ui-ux-20261020/`.

## Cosa comprende

Struttura generale sobria, navigazione raggruppata e barra mobile con quattro destinazioni più menu completo; intestazione e indicatori condivisi; pagina Prenotazioni con calendario ed elenco, periodo/Oggi, ricerca, sede/stato, dettaglio e apertura dei moduli esistenti. Su telefono indicatori e filtri aggiuntivi sono apribili. Il calendario combina veicolo e sede nella colonna fissa, supporta le frecce da tastiera e separa visivamente prenotazioni che condividono lo stesso giorno.

Focus dei dialoghi, associazioni fra etichette e campi, etichette dei pulsanti, contrasto e temi sono parte delle verifiche. Il caricamento mensile ignora risposte superate da una ricerca più recente. Non sono state cambiate query o autorizzazioni backend.

Le altre pagine ereditano la struttura e le fondamenta condivise: non sono per questo dichiarate ridisegnate o collaudate individualmente. Il completo riordino dei moduli lunghi e delle operazioni avanzate di Prenotazioni rimane una sottofase successiva, conservando i relativi percorsi.

## Anteprima locale

Con Node 22.23.1 e le dipendenze installate, dalla radice del checkout:

```sh
npm run dev:ui-preview
```

- Gestionale pilota: `http://127.0.0.1:5180/booking`.
- Componenti: `http://127.0.0.1:5180/ui-preview.html`.

Aprire gli indirizzi HTTP: il file HTML aperto direttamente dal filesystem non avvia React/Vite. Il server ascolta soltanto sul loopback del Mac; non pubblica la pagina su Internet. Ignora i file env e presenta utente, tenant, veicoli e clienti fittizi. Il backend reale e i provider non vengono avviati. Tutti i salvataggi, invii e pagamenti rispondono con un rifiuto esplicito: nessuna operazione economica o persistente viene simulata come riuscita.

Il selettore del laboratorio permette dati normali, nessun dato, errore e caricamento lento. Per terminare, interrompere il processo dell'anteprima. Questa modalità è un comando locale separato e non viene aggiunta agli ingressi del build production; il server di prova non è una modifica ai controlli di autenticazione del prodotto.

## Verifiche ripetibili

```sh
npm run verify:frontend
npm run verify:ui-booking
git diff --check
```

Il secondo comando richiede il laboratorio già attivo e un Chromium di Playwright installato. Il runner controlla che `/api/health` identifichi il laboratorio e blocca destinazioni esterne. Evidenze e schermate sono in `output/playwright/ui-booking/` (ignorata da Git).

Se si fornisce `FLEETUM_UI_AXE_SCRIPT` con il percorso di una copia locale verificata di `axe.min.js`, il runner esegue anche le regole automatiche WCAG sui tre contesti desktop, telefono e tema scuro. In assenza del motore registra esplicitamente `NOT_RUN_NO_ENGINE`. Le verifiche automatiche non costituiscono conformità completa: revisione con lettore schermo, tutti i moduli/stati e salvataggi su backend isolato rimangono separati.

## Limiti di consegna

Prima estendere il lavoro, raccogliere la revisione della pagina reale da Silvio. Nessuna autorizzazione di pubblicazione o deploy è implicita nel lavoro UI. Le prove locali non promuovono gate database, multi-tenant, provider, staging o produzione e non modificano i report storici sigillati.
