# Allineamento PR #158 a main — 13 novembre 2026

## Contenuto e autorizzazione

Base della PR aggiornata: `c46ede5140d26e736de5b77dab190750504f80c3`. Candidato originario recuperabile: `ee34ffb71fea21801a195410fde46723950db5c2`. Il commit di allineamento ha questi due parent e resta sul solo branch `codex/platform-satin-ui`; nessun force push, merge della PR in main o deploy.

Conflitti risolti esclusivamente in `platform-admin-layout.tsx` e `platform-admin-page.tsx`:

- Conservati shell, undici sezioni, loghi originali, CSS Satinata, ricerca, inspector, conferme e toast scelti.
- Logout asincrono con pulsante occupato: la sessione resta aperta se il server non conferma. Una risposta vecchia non cancella un nuovo login né lo manda alla schermata di accesso.
- Errori delle metriche live creati dalla stessa factory delle altre richieste: conservano status, codice e generazione della sessione senza bearer nei metadati. Indisponibilità non equivale a zero utenti o ricavi.
- Invio fattura con chiave mantenuta nei retry fino al successo e protezione dal doppio clic. Un successivo invio intenzionale usa una nuova chiave. La chiave è conservata nella pagina corrente, come in main: non è garantita fra reload, schede diverse o nuovi accessi.
- Fixture locale aggiornata per il logout e l'header idempotente; non entra nel prodotto compilato.

Nessuna differenza rispetto al main allineato in backend, schema, migrazioni, package/lockfile, workflow, login/reset, auth storage, sito pubblico o gestionale tenant. I molti file provenienti da main sono storia del merge, non nuove modifiche UI da promuovere in produzione.

## Verifiche locali riproducibili

Node 22.23.1, checkout isolato, `npm ci --ignore-scripts --no-audit --fund=false`. Prisma generato con cache temporanea. Nessun env reale letto. Test con `DOTENV_CONFIG_PATH=/dev/null`, `NODE_ENV=test`, `DATABASE_URL=postgresql://synthetic:synthetic@127.0.0.1:9/synthetic`, valori email fittizi previsti dalla CI e `FLEETUM_ENVIRONMENT` non impostato. Nessun provider o database reale.

```sh
node --import tsx --test frontend/tests/platform-logout.test.ts frontend/tests/platform-live-response.test.ts frontend/tests/platform-invoice-email.test.ts
npm run verify:release
npm audit --workspace frontend --omit=dev --include-workspace-root=false --json
git diff --check
```

- Regressioni mirate: **27/27 PASS**, inclusi callback UI effettivi, concorrenza, retry e sessioni correnti/obsolete.
- Release completa: **1.190 esecuzioni PASS**, zero fail/skip; vendor 19, backend 501, frontend 124, website 9, operations 537. Vendor viene rieseguito in operations, quindi non sono tutti casi distinti. Lint, build multipagina e prerender 13 pagine riusciti.
- Audit produzione: gate high/critical superato. Audit frontend: zero rilievi in tutte le severità.
- Primo tentativo release non valido: `FLEETUM_ENVIRONMENT=local`, valore non ammesso dalla base aggiornata, impediva il caricamento di alcuni test backend. Ripetuto l'intero comando senza quel valore; nessuna modifica al prodotto o soppressione test.
- Docker locale non risponde entro il timeout di 8 secondi: nessun DB avviato, **gate database locale non eseguito**. I gate PostgreSQL temporaneo e compatibilità schema saranno verificati nella CI del nuovo SHA; gli esiti remoti vanno letti nella consegna aggiornata/PR.

## Browser e isolamento visivo

Build aggiornata servita su loopback 5215 con soli asset Platform e proxy `/platform-api` verso API sintetica 5213. `/api` e gli altri percorsi applicativi sono rifiutati. Accesso attraverso la schermata esistente, nessun bypass, account e OTP fittizi.

Login riuscito. Con errore simulato del server, logout resta in Console con «Uscita non confermata». Dopo risposta positiva, pulsante occupato durante l'attesa, ritorno al login e una sola POST `/auth/logout` nella registrazione sintetica. Screenshot in `evidence/alignment/`. Questa prova verifica il client, non la revoca del backend reale.

CSS Satinata, navigazione, dialog e loghi byte-identici al candidato originario; nessuna nuova direzione grafica. Le verifiche complete delle undici sezioni, temi e frame responsive del primo candidato sono storiche: non sono state ripetute integralmente in questa tranche. Nessuna nuova prova VoiceOver o Safari iOS.

## Limiti di rilascio

Il nuovo bundle non va montato sul vecchio backend production: ora attende il logout server. Il confronto dei vecchi asset è prova del pacchetto originario, non di questa build. Prima di un rilascio servono revisione della PR, tutti i gate remoti sullo SHA esatto, collaudo Platform con backend compatibile e una consegna limitata conforme alle protezioni attuali. Non promuovere l'intero main solo per cambiare la UI. Nessuna nuova chiave, segreto o modifica live in questa tranche.
