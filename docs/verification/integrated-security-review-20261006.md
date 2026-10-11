# Fleetum — revisione integrata e transizioni credenziali, 6 ottobre 2026

## Esito e perimetro

La revisione integrata ha individuato due ulteriori vulnerabilità High nei percorsi di invito e cambio password. Il controllo dipendenze ha rilevato anche una dipendenza Critical. Corrette localmente prima della preparazione allo staging. Candidato definitivo **add3438cc17e23a29a45aad71282e296f45072a1**, tree **c213e764e6e52ebe34a9bdd3e3566010916d0905**, branch `codex/fix-invite-activation-security-20261006`; parent `e3186ac6b1614939fe5f0f7b69659d9638695037`. Checkout isolato `/Users/silvio/Documents/Playground/Fleetum-fix-scheduled-report-cursor`. Main rimane `db1f231dc8cb699f1a5ce4215a0278c93212d16d`.

La verifica riguarda sorgenti e dati sintetici locali. Non certifica staging, produzione o provider. Nessun push, PR, merge, dispatch, SSH, deploy, email reale o pagamento. Nessun env reale, segreto o dato personale applicativo letto. Redesign UI e marketing restano tranche separate.

## Finding aggiuntivi

| ID | Gravità | Difetto riconfermato | Correzione | Stato |
|---|---|---|---|---|
| REV-01 | High | Invito valido riattivava utente sospeso/attivo/cancellato; richieste concorrenti potevano sostituire due volte le credenziali | INVITED/non cancellato al preflight e al commit; lock User condiviso, claim monouso non scaduto, attivazione CAS; consumo degli altri inviti/reset e revoca refresh nella stessa transazione | RISOLTO NEL CANDIDATO LOCALE |
| REV-02 | High | Cambio password verificava l'hash prima della transazione e aggiornava poi incondizionatamente; poteva sovrascrivere reset concorrente. Revoca opzionale separata poteva fallire dopo aggiornamento password | Lock User, CAS tenant/id/ACTIVE/non cancellato/hash verificato; password, reset pendenti, revoca opzionale e audit nello stesso commit | RISOLTO NEL CANDIDATO LOCALE |

Nuovi ID separati dal registro originale di 37 finding e da INT-01…06. Il registro originale conserva 26 risolti nel codice, 2 parziali, 4 appartenenti al redesign escluso, 5 marketing aperti: questi conteggi non equivalgono a readiness di produzione. BE-03 resta parziale per snapshot legacy non ricostruibili; SEC-10 resta parziale per decisioni e attivazione privacy. INT-01…06 rimangono corretti nel candidato, senza nuova certificazione live.

### REV-01: contratto e prove

`backend/src/application/usecases/auth/accept-invite-usecase.ts:12` limita l'invito all'utente INVITED non cancellato; `:24` apre una transazione e acquisisce User FOR UPDATE. Il claim controlla ancora token, scadenza e usedAt; l'aggiornamento dell'utente richiede ancora INVITED/non cancellato. Fallimento dopo claim annulla tutte le mutazioni. Attivazione e invalidazione dei recuperi precedenti rimangono distinte dal reset di un account ACTIVE.

Il flusso esistente di creazione inviti crea un nuovo account INVITED e rifiuta email già presenti. Per riabilitare un account sospeso occorre una scelta amministrativa esplicita: un vecchio invito non la sostituisce. La risposta legittima conserva `{success:true,email}`. Inviti scaduti, riutilizzati o riferiti ad account in stato diverso ricevono l'errore generico INVALID_INVITE senza attivazione.

RED iniziale: 8 casi falliti sul codice precedente. Nuovo caso relativo ai reset storici: 8 PASS/1 FAIL prima della correzione aggiuntiva. GREEN finale unit inviti 9/9; regressioni mirate invito/sessioni/OAuth/booking 32/32, nessuno skip. I log RED sono conservati come fallimenti, non trasformati in PASS.

### REV-02: contratto e prove

`backend/src/application/usecases/auth/manage-profile-usecase.ts:28` limita il preflight al tenant e a un account ACTIVE non cancellato. Verifica bcrypt/hash avvengono fuori dal lock. `:43` prende il lock condiviso, quindi updateMany richiede tenant, ID, ACTIVE, deletedAt e passwordHash inizialmente verificato. Un reset, sospensione o cambio credenziali già completato fa fallire la richiesta obsoleta con 409 CONFLICT, senza lasciare mutazioni.

Un cambio password riuscito invalida gli altri reset presenti durante la transazione. Il produttore RequestPasswordResetUseCase non prende questo lock: nessuna garanzia estesa a ogni emissione già in volo o a futuri token. `logoutAllDevices=false` conserva le sessioni per il contratto esistente; `true` le revoca nella stessa transazione con audit AUTH_SESSIONS_REVOKED_ALL quando presenti. Risposta `{updated:true,sessionsRevoked:boolean}` conservata. Nessun cambio a validator, form, me/updateProfile, middleware tenant/Platform o servizio sessioni.

RED unit: 13 FAIL/1 PASS prima della correzione. GREEN: 14/14, nessuno skip. Test di rollback coprono anche fallimento della revoca o dell'audit. Password e token non sono registrati nei log.

### REV-03: dipendenza proxy-addr — Critical upstream, exploit Fleetum live non verificato

Il gate audit finale ha rilevato proxy-addr2.0.7 vulnerabile. Fonte primaria: [advisory del maintainer](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h), CVE-2026-90711, patch2.0.8. Con subnet IPv6 configurate impropriamente, IPv4 esterni potevano essere trattati come proxy fidati. Non abbiamo letto configurazione live né dimostrato sfruttamento Fleetum.

Override root esatto2.0.8 e lock aggiornato nella sola voce di quel pacchetto. Tarball ufficiale verificato con integrità npm; dipendenze forwarded/ipaddr.js invariate. Tre test reali sulla libreria installata: RED1FAIL/2PASS, GREEN3/3. Versione risolta per Express controllata; policy audit non modificata. Nessuna nuova dipendenza, aggiornamento circoscritto. Primo release331/44/9/237 passava tutti i test ma falliva audit: receipt FAIL conservata. Due tentativi di acquisire il JSON audit sono falliti per DNS e sono conservati come errori, non PASS. Gate finale rieseguito sul nuovo freeze.

| ID | Gravità | Stato |
|---|---|---|
| REV-03 | Critical della dipendenza | RISOLTO NEL CANDIDATO LOCALE con proxy-addr2.0.8 e nuove prove; esposizione live non osservata |

## Verifica finale sul candidato

- **PostgreSQL540/540 PASS**, zero failure/skip: 522 regressioni già presenti +18 nuove prove sulle credenziali. Barriere forzano entrambi i preflight iniziali per inviti e doppio cambio password. Nei due ordini profile/refresh, pg_stat_activity e pg_blocking_pids provano il secondo PID bloccato dal primo prima del rilascio. Entrambi completano senza deadlock; vecchi refresh e successori sono rifiutati dopo revoca, tenant B invariato.
- **Release624/624 PASS**:334backend/44frontend/9website/237operations, zero failure/skip; lint, build,13prerender e audit production policy high-critical PASS.
- Prima prova PG538/538 conservata sul candidato preliminare c1ca811, precedente al rafforzamento dei tre test e all'aggiunta dei due ordini lock. Non sostituisce il gate finale.
- Integrità del pacchetto verificata separatamente con validator e suite37 casi; risultato e freeze documentale nella ricevuta di chiusura.

Ambiente: Node 22.23.1/npm 10.9.8; PostgreSQL 16 temporaneo, schema applicato con le 48 migrazioni esistenti; dati sintetici. Il runner database configura da solo DOTENV_CONFIG_PATH=/dev/null e opt-in test: erano assenti nell'ambiente del chiamante. Container/database/uploads temporanei rimossi al termine; nessun volume di produzione. Test database seriali. Questa prova non attesta firewall o deny egress dell'host staging.

Comandi riproducibili con ambiente sintetico e Node compatibile:

```sh
NODE_ENV=test DOTENV_CONFIG_PATH=/dev/null node --import tsx --test backend/tests/auth-invitation-security.test.ts
NODE_ENV=test DOTENV_CONFIG_PATH=/dev/null node --import tsx --test backend/tests/profile-password-security.test.ts
npm run verify:database
npm run verify:release
python3 docs/deployment/staging-validation-package-20261002/validate-package.py --source-root . --audit-root /Users/silvio/Documents/Playground/Fleetum-audit-20260909
```

I comandi completi, ambiente pulito, guardie e risultati sono nel bundle immutabile `evidence/20261006-account-security-review`. La verifica release usa DATABASE_URL sintetico su loopback non raggiungibile; non esegue test persistenti. Gli unit usano doppi controllati; i nuovi test security esercitano PostgreSQL reale. Nei test ordinati refresh/profile il signer sintetico serve a verificare persistenza e revoca: non certifica firma JWT, browser, HTTPS o cookie Secure.

Le prove attuali di recupero applicazione/client del 5 ottobre (46 controlli/153 HTTP) e browser 7/7 sono **storiche, non rieseguite sul nuovo codice account**. Non sono presentate come prove nuove del candidato. La riserva 9bd57ff2 e il candidato b5332ca precedono REV-01/02/03: non preservano i nuovi fix e non sono fallback approvati per questa release. Il runner recupero richiede equivalenza dell'app backend e rigetterebbe la vecchia riserva contro il candidato nuovo.

## Revisione indipendente e limiti client

Revisione indipendente degli otto file modificati: nessun blocker statico, inclusi i test finali con preflight/barriere e wait SQL su PID reali. Lock User prima di token/sessioni, CAS strette, stesso commit per mutazioni e revoche, query negative cross-tenant e rollback. Controlli HTTP già esistenti di auth/CSRF/rate/license/Platform non modificati. Nessuna migrazione o nuova dipendenza; aggiornata solo la versione transitive proxy-addr; rollback SQL non necessario. Revert dei tre commit reintroduce le vulnerabilità e richiede review prima di usarlo come rollback.

La revisione client non dimostra bypass critici nel perimetro letto, ma lascia decisioni/prove prima della release:

| Area | Evidenza sorgente | Implicazione e prossima prova |
|---|---|---|
| Platform, Medium | sessionStorage per Bearer e logout locale; TTL predefinito sorgente 15 minuti, configurazione reale non letta | Definire SLA di logout/revoca Platform e verificare logout/replay. Non attribuire automaticamente il contratto sessioni tenant a Platform |
| CSP, Medium | Assente nei template Caddy letti; nessuna prova degli header edge reali e nessun exploit XSS confermato | Osservare header autorizzati e definire policy compatibile con SPA, website e OAuth |
| Callback social UI, Low | Il client imposta identità dal fragment `#user` prima di auth/me | Usare identità restituita dal server; la revisione non prova accesso privilegiato alle API |
| Website Next | Immagine include website/out ma template staging serve SPA e non replica tutte le route website produzione | E2E autenticati e `/demo` SPA non certificano il form Next e l'intero funnel |
| Artefatti frontend | Build del drill mantiene NODE_ENV=test e JSX development contiene path scratch assoluti; differenze hash fra build indipendenti | Forte inferenza sul motivo, non prova normalizzata dei due output rimossi. Compilare production e promuovere la stessa coppia immutabile con parametri/digests |

Riferimenti di dettaglio: frontend/src/infrastructure/platform/platform-auth-storage.ts:8; frontend/src/application/usecases/platform/platform-admin-usecases.ts:375; backend/src/shared/config/env.ts:151; backend/src/interfaces/http/middlewares/platform-auth.ts:15; deploy/caddy/Caddyfile.staging:5 e :47; frontend/src/presentation/pages/auth/social-auth-callback-page.tsx:50; frontend/Dockerfile.prod:35; website/lib/public-api.ts:23. I limiti non sono conteggiati come exploit High dimostrati.

## Consegna e prossimo passo

Tre commit correttivi distinti, test e documento nel branch isolato; candidato esatto uguale a sorgente testata/checkout/commit con freeze prima e dopo. 8 file di codice/test/package byte-uguali;900 altri tracciati della copia invariati rispetto al parent,4 file test nuovi. Tre commit finding distinti: `c03bd422aa843eb73c2f7d7636ea839c378bcac7`, `e8b2173367c06485954b0deba67c7436e7e5e7fa`, `add3438cc17e23a29a45aad71282e296f45072a1`. Il gate completo riguarda lo SHA finale combinato; non è una certificazione release separata del commit intermedio. Stato globale del worktree nativo non dichiarato, a causa della lentezza FileProvider; due file generati sono esclusi dalla guardia come già documentato. Main invariato.

Il packet [STAGING_DECISION_PACKET_20261006.md](../deployment/staging-decision-packet-20261006.md) rende reviewabili versione, coppia artefatti/fallback, target, operatori, soglie proposte e sequenza. Nessun owner o autorizzazione inventato: **0/19 gate esterni PASS**. La tranche è pronta per revisione locale dopo i risultati finali documentati. Prima di attività esterne servono decisioni e autorizzazioni distinte per pubblicazione/CI e dispatch staging; un merge su main può avviare produzione.
