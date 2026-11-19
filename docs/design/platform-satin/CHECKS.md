> Prove storiche del candidato ee34ffb. Esiti aggiornati della release completa, audit e sessioni in [ALIGNMENT_20261113.md](ALIGNMENT_20261113.md). PR e copia selettiva privata degli asset sono state completate successivamente; la prova del vecchio pacchetto non vale per la nuova build.

# Verifiche — Platform Satinata,13 novembre 2026

## Ambiente e comandi

Checkout isolato `/private/tmp/fleetum-platform-satin-ui-20261113`, branch `codex/platform-satin-ui`; Node22.23.1 da `/opt/homebrew/opt/node@22/bin`. Dipendenze installate dal lockfile senza aggiornarlo. Nessun file env reale letto; nessun DB o provider reale usato.

- `PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run verify:frontend`: PASS. Typecheck,27/27 test frontend e build Vite multipagina index/platform con prerender. Sette nuove prove: isolamento CSS/navigazione (2), idempotenza lista fatture (2), risposta metriche live e propagazione errori auth (3).
- `npm run verify:prerender -w frontend`: PASS.
- `NODE_ENV=test ... node --import tsx --test backend/tests/platform-plan-actions-ui.test.ts backend/tests/platform-license-billing-link.test.ts backend/tests/platform-security.test.ts backend/tests/platform-password-recovery.test.ts`:23/23 PASS. Repository/auth/email simulati; nessun test persistente. Segreti di prova distinti; DATABASE_URL localhost:9 inutilizzabile; Prisma Client generato con cache temporanea. Non sono23 prove database né la release completa.
- `npm audit --workspace frontend --omit=dev --include-workspace-root=false --json`: FAIL gate sicurezza;3 high(Axios,follow-redirects,Zod),2 moderate(React Router/DOM). Dettagli pubblici in evidence/dependency-audit-summary.json. Non eseguiti audit fix o aggiornamenti di dipendenze. I file package/lock restano identici alla base.
- `git diff --check`: PASS.

I primi tentativi di generazione/test hanno incontrato cache Prisma non scrivibile, DNS in ambiente ristretto, client non generato e segreto sintetico troppo corto. Sistemato esclusivamente l'ambiente locale e ripetute le suite fallite, con esiti sopra. Il primo tentativo di audit non aveva rete: non è stato contato come PASS; l'audit riuscito a contattare npm ha prodotto i5 rilievi.

## Browser

API di controllo browser del client, laboratorio su5212/5213 e pacchetto compilato su5214. Il codice applicativo non contiene bypass di login; accesso tramite schermata/servizio originali contro un server sintetico locale, OTP sintetico, nessun messaggio spedito. L'API fake non dimostra la sicurezza del backend: quella è coperta soltanto dai test pertinenti e resta da collaudare nello staging.

- Tutte11 sezioni aperte, heading presenti e nessun overflow documento nella build compilata; console nuova senza errori. Prova distinta dalla precedente demo statica.
- Ricerca titolare, reset filtri, vista vuota, elenco250 aziende e filtro a un risultato; dettagli su richiesta senza perdere filtro. Dataset con nome legale lungo, titolare assente e tutti7 stati licenza.
- Inspector desktop nonmodale; conferma downgrade cancellata, Escape e ritorno focus. Inspector mobile modale; menu con tutte11 sezioni.
- Doppio rinnovo: una sola POST nella registrazione sintetica. Sospensione simulata aggiorna lo stato nell'inspector; generazione fattura apre Billing; consegna email e marca pagata simulati; stato lead e revoca dispositivo simulati. Nessun incasso o invio reale.
- Problema trovato e corretto: fattura già esistente restituita dalla generazione duplicava righe/totale UI. Ora upsert per ID, con regressioni unit dedicate. La lista completa non perde altre fatture.
- Metriche live404: segnalazione di indisponibilità, valori assenti mostrati con trattino; zero reale conservato.
- Errori409 operazione visibili inline e toast;503 iniziale senza strip KPI;401 torna al login; logout e nuovo accesso diretto a console senza token tornano al login.
- Chiaro/scuro e refresh verificati; loghi originali. Meta+K mette focus sulla ricerca; salta al contenuto conserva #/console e mette focus su main. Toast temporanei osservati scomparire; pausa intenzionale se il puntatore/focus resta sulla notifica.
- Viewport interna320/390/768/1440 px in iframe, misurata dal documento: scrollWidth uguale alla viewport, tabella con scroll locale. Il controllo viewport nativo del browser non applicava le dimensioni: non contato come prova mobile. Corretto un overflow causato dalla label accessibile assoluta della tabella.
- Smoke locale home pubblica e login tenant: nessuna shell/CSS Platform caricata. Nel montaggio locale180 file originali preservati byte per byte; nessuna sostituzione di sito/tenant o website separato.

Screenshot desktop-light.png,desktop-dark.png,mobile-390-frame.png e risultati in evidence/browser-results.json. Frame mobile non equivale a device fisico o Safari iOS. Nessuna prova VoiceOver nativa né modifica delle preferenze del Mac. CSS reduced-motion/reduced-transparency presente e isolato; verifica nativa ancora aperta.

Durante predisposizione del laboratorio una fixture fattura incompleta ha causato un errore; la fixture è stata corretta con i campi del contratto API, poi le11 sezioni hanno superato i controlli. Il prodotto non viene modificato per accettare contratti API fittizi incompleti.

## Isolamento e limiti

Endpoint/payload API, auth storage, guard, login/reset, backend, schema, catalogo prezzi, lockfile, sito/tenant e loghi non modificati. Nel use case frontend cambia soltanto la lettura della risposta metriche live: un 404 non produce più uno snapshot inventato a zero; status e code auth vengono conservati. Ogni nuovo selettore è sotto la shell autenticata; dialog e toast non escono in portal su body. Il CSS globale ricompilato non aggiunge o modifica regole preesistenti:61 regole non più usate dal vecchio chrome Platform vengono eliminate da Tailwind. I bundle completi possono cambiare nomi/hash per la nuova composizione: non sono dichiarati byte-identici. Il montaggio limitato tiene i vecchi file per gli altri entry point.

La lettura VPS ha identificato immagini e tag, non tutti i sorgenti effettivi. L'esportazione integrale dei file statici è stata rifiutata dalla revisione automatica ed è rimasta non eseguita. Non aggirato il rifiuto.

Esito finale: pronto per revisione dell'integrazione locale, NON pronto per produzione. PR/CI remota, gate sicurezza, consegna limitata conforme, confronto reale, staging e verifiche native aperti. Audit preesistente preservato, non chiuso dal redesign. Vedere RELEASE_PLAN.md.
