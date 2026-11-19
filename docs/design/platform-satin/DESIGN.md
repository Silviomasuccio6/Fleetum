# Platform Console — Satinata

Ambito: sola Console autenticata, uso operativo quotidiano del proprietario Fleetum. Direzione scelta da Silvio il 13 novembre 2026; riferimento visivo nell'anteprima `fleetum-platform-apple-20261113/evidence/desktop-satin.png`. Logo originale obbligatorio. Nessun redesign del gestionale tenant, del sito o del login.

- Sistema tipografico nativo: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif. Titolo 24–30px; corpo 13px; secondarie 12px; etichette 11px. Nessun font Apple distribuito.
- Sidebar 212 px con inset/gap12px, altezza viewport e gruppi Gestione/Acquisizione/Sistema. Undici sezioni, aria-current, icone Lucide coerenti. Sotto1024 px menu completo modale, nessuna barra inferiore.
- Toolbar64 px satinata e sticky; breadcrumb, ricerca aziende, tema e logout. La ricerca inviata apre Aziende e rimuove gli altri filtri per rendere leggibile il risultato. La ricerca locale mantiene i propri filtri.
- Superfici dati opache; card16px, shell20px, controlli9px. Ombre soltanto sulla shell e sulle superfici sovrapposte. Nessun sollevamento delle card al passaggio del mouse.
- Quattro indicatori principali, tabella aziende e coda; utenti live e audit sotto. Errori iniziali non producono indicatori a zero. Aggiornamento fallito segnala la precedente lettura riuscita.
- Inspector desktop nonmodale su richiesta; mobile modale con scorrimento interno. Conferme native modali, Escape e focus di ritorno. Dati e azioni mantengono i servizi originali.
- Tema chiaro: fondo#f5f5f7, superfici bianche, sidebar#edf0f5, inchiostro#1e1e20 e blu primario. Tema scuro: fondo circa#18191b, superfici#202226, sidebar#202329, testo chiaro e blu più luminoso. Stati semantici con fondi leggeri e testo esplicito.
- Loghi SVG originali conservati; ritaglio del solo spazio vuoto nei due asset, larghezza visibile124 px nel frame144×36px. Cambiamento tema immediato e persistente, senza animazioni decorative obbligatorie.
- Un solo ingresso dell'inspector,200 ms; contatori esistenti rispettano movimento ridotto. CSS per movimento/trasparenza ridotti e fallback opaco. Nessuna impostazione di sistema cambiata nel collaudo.
- Toast compatti, alto a destra sotto la toolbar. Successi/info4 s, errori7 s; pausa su hover/focus, chiusura manuale accessibile, errori operativi anche inline. Il puntatore su una notifica ne sospende intenzionalmente la chiusura.

Ogni selettore nuovo è sotto `.platform-satin`, caricato esclusivamente dall'entry Platform. Dialog e toast sono discendenti della shell. I file sotto tests/support sono strumenti locali e non entrano nella build. Nessuna dipendenza, API backend, migrazione o regola commerciale modificata. Il solo parser frontend delle metriche live rifiuta il precedente fallback 404 a zero.
