# Fleetum — sicurezza client e logout Platform, 7 ottobre 2026

## Esito locale e identità

Candidato `dabbb8862cbce2c48bfafa0413781b35fb582348`, tree `cef82dfa74ff1e024fb95132a718c1f8794bfac8`, branch `codex/fix-client-platform-security-20261007` nel checkout isolato `/Users/silvio/Documents/Playground/Fleetum-fix-scheduled-report-cursor`. Parent `a5a39824162bb1e9634ad256134e5f60b5236709`; main invariato `db1f231dc8cb699f1a5ce4215a0278c93212d16d`. Cinque commit separati: `f1af8497cafd680795ab64ff2b954ee0611de138`, `051cc1f47c5752df9e8b84ef5db182af5aee95e9`, `80fdc535e056cdc2e207701a95f8f5f57aa839a4`, `17d9c6ddb2b68888d90f6a96cd6a0a49ae634dfc`, `dabbb8862cbce2c48bfafa0413781b35fb582348`. La consegna è pronta per revisione locale, senza push, PR, merge, dispatch, SSH, deploy o modifica dei provider. Nessun env reale, segreto o dato personale applicativo usato. Non è una certificazione di produzione. Redesign UI e marketing restano separati.

## Difetti ricontrollati e cambiamenti

| ID | Gravità osservata | Cambiamento | Stato |
|---|---|---|---|
| REV-04 | Low: identità UI da fragment, nessun bypass API dimostrato | Callback social interroga auth/me prima di sessione client, metriche, licenza e onboarding; ignora user nel fragment, rimuove il fragment dalla cronologia e conserva routing sicuro. Guardie alle risposte dopo smontaggio | Risolto nel codice locale |
| REV-05 | Medium: logout Platform solo locale e replay valido fino alla scadenza | POST autenticata persiste revoca del singolo bearer, ogni controllo Platform legge PostgreSQL, jti UUID separa login simultanei; retry idempotente e revoca non estesa ai tenant | Risolto nel codice locale |
| REV-05 client | Race riprodotte, nessun bypass backend | Logout attende conferma, conserva la possibilità di riprovare; errori e risposte di una vecchia generazione non cancellano né reindirizzano un login nuovo | Risolto nel codice locale |
| REV-06 | Gap di collaudo: staging serviva SPA sulle pagine Next | Marketing e asset Next serviti dal sito esportato; login/tenant restano SPA con fallback spa.html. Robots, sitemap, errori e noindex staging preservati | Corretto e provato localmente, host esterno pendente |
| REV-07 | High upstream: sharp 0.35.4 con librsvg vulnerabile | Backend e Next risolvono sharp 0.35.5 esatto; prebuilt e librsvg 2.63.2 verificati localmente con immagini sintetiche | Risolto nel candidato locale; runtime Linux/live da verificare |
| HARD-01 | Difesa aggiuntiva del browser | CSP staging cumulativa base-uri self, object-src none, frame-ancestors none, form-action self, senza sostituire la CSP più restrittiva di Helmet | Parziale: script-src/default-src sito e CSP produzione ancora aperti |

File principali: frontend/src/presentation/pages/auth/social-auth-callback-page.tsx; backend/src/application/services/platform-session-service.ts; backend/src/interfaces/http/middlewares/platform-auth.ts; frontend/src/application/usecases/platform/platform-admin-usecases.ts; frontend/src/infrastructure/platform/platform-auth-storage.ts; frontend/src/presentation/components/layout/platform-admin-layout.tsx; frontend/src/presentation/pages/platform/platform-admin-page.tsx; deploy/caddy/Caddyfile.staging. Il diff completo, linee e hash sono nel bundle di prove.

## Dipendenza immagini

Il primo release ha superato 689 test ma ha fallito la policy audit per sharp. L'[avviso del maintainer](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w), pubblicato il 30 settembre, identifica librsvg e versioni sharp precedenti a 0.35.5. La patch 0.35.5 include librsvg 2.63.2. Aggiornamento esatto circoscritto e override anche per Next, con lock della famiglia sharp e prove native sintetiche. Nessuna policy audit allentata. Il rischio documentato dipende anche dal runtime Linux: non abbiamo verificato attacco o configurazione Fleetum live. Installazioni che usano librsvg/libvips globali devono verificarne la versione: il solo package pin non le certifica. Tentativi audit JSON falliti per rete sono conservati come errori.

## Contratto di revoca e compatibilità

Il successo HTTP del logout segue il commit della revoca. Ogni controllo di autorizzazione successivo deve rifiutare lo stesso bearer, anche su un altro processo collegato allo stesso database. Le richieste già ammesse possono terminare. Questo è un contratto funzionale locale: uno SLA di latenza misurato su host/repliche resta da approvare e verificare in staging. Login indipendenti e sessioni tenant rimangono validi; OTP, reset e trusted device non sono revocati dal logout ordinario.

PlatformSecurityEvent registra soltanto SHA256 del bearer e expiresAt nei details, con action PLATFORM_SESSION_REVOKED. Non registra token o password. Questo evento è ora stato di sicurezza autorevole: conservarlo almeno fino a expiresAt. Cancellazione anticipata o rollback a codice che ignora la revoca può ripristinare un bearer ancora valido. Nessuna cancellazione di questi eventi è stata introdotta. Una query JSON su action usa il modello e indice già presenti: crescita, retention e costo per richiesta richiedono osservazione prima del rilascio.

Logout concorrenti usano lock advisory di transazione sul digest, lock_timeout 2s, maxWait 2s e timeout transazione 5s. Solo la route logout può accettare un bearer già revocato per confermare un retry; le route business non hanno questa eccezione. Revoca da reset password resta indipendente. Errori delle letture di sicurezza producono 503 senza ammettere l'accesso. Chiave, tipo e identità Platform sono distinti dall'accesso tenant.

Il client non dichiara completato un logout con errore di rete, 403/429/5xx o risposta 200 senza revoked:true. Una risposta 401 esplicita scaduta/revocata consente la pulizia locale. Revisioni numeriche e WeakMap delle risposte collegano errori e logout alla sessione originaria; nessun bearer viene aggiunto agli errori. Verifica finale sincrona prima della navigazione copre anche un login intervenuto nella continuazione della Promise.

## Evidenze finali

- PostgreSQL **552/552**, zero failure/skip, con le 48 migrazioni esistenti e soli dati sintetici.
- Release **696/696**: backend 348, frontend 93, website 9, operations 246; zero failure/skip, lint/build/prerender e audit high-critical secondo policy esistente.
- Build frontend e Next con NODE_ENV=production; test backend impostano esplicitamente NODE_ENV=test. dotenv disabilitato. Hash degli output montati in sola lettura nel test browser registrati prima e dopo.
- Unit RED prima delle modifiche e GREEN finali conservati; prove incrociate delle race pre-ACK e post-clear conservate, revisione indipendente FINAL_REVIEW_PASS dei file di sicurezza/routing prima della patch immagini e degli ultimi due aggiustamenti delle fixture. I 15 file rimasti identici sono attestati; la patch immagini e le due modifiche alle fixture sono coperti dalla revisione root separata. Nessuna nuova revisione indipendente è attribuita a questi delta.
- Caddy reale e Chromium locali: **10/10 casi browser** e **31 controlli HTTP** PASS, con ricevuta di cleanup e output immutati; sito Next idratato e form demo con API sintetica, CSP basale, routing e callback OAuth con risposte auth/me/refresh controllate, logout UI con errore e retry.
- Primo run PostgreSQL: 552 test passavano, ma il file di accettazione è stato rafforzato durante il run. Guardia finale ha invalidato la prova. Log e freeze originali conservati come INVALIDATED_SOURCE_GUARD, nessun gate attribuito. Il risultato sopra riguarda il nuovo freeze finale.
- Dopo npm ci pulito, un run ha registrato 551/552 casi riusciti e un hook di cleanup fallito. Il processo figlio aveva perso il percorso esplicito del motore Prisma e una fixture cauzione non eliminava il proprio audit atomico. Entrambi corretti nei soli test, senza ridurre le asserzioni; ricevuta fallita e assenza di container residui conservate. Il gate sopra è una nuova esecuzione completa successiva.

Comandi e ambiente completi sono negli script run-database.py e run-release.py del bundle. Comandi applicativi: npm run verify:database, npm run verify:release, node --import tsx --test per i nuovi unit, node --test ops/tests/staging-client-routing-security.test.mjs, runner Caddy/Chromium locale conservato separatamente. Node 22.23.1/npm10.9.8, PostgreSQL16 temporaneo; cleanup dei processi/container/reti propri verificato.

## Limiti e gate ancora aperti

Il callback usa identità del server; la cancellazione copre le mutazioni dell'effetto. Il client HTTP condiviso può separatamente aggiornare identità verificata dal server durante il refresh. socialSignup resta un hint non autorevole per una metrica soggetta a consenso, mai prova di attivazione o pagamento.

Platform continua a usare sessionStorage per il bearer: l'esposizione a uno script compromesso resta aperta. Non è stata introdotta auth via cookie né disabilitata CSRF. La CSP basale non limita gli script e non chiude XSS; Next inline hydration richiede hash/nonce collegati agli artefatti per una policy più stretta. Template produzione invariato.

Le API del browser sono simulate e non provano provider OAuth, cookie HTTPS reali o revoca backend: quest'ultima è coperta separatamente da HTTP/JWT/PostgreSQL locale. TLS locale e host adattati non attestano DNS, firewall, allowlist, edge o staging esterno. L'immagine Caddy in cache non è un nuovo digest backend/frontend pubblicato.

Recovery e i sette E2E tenant precedenti sono storici, non rieseguiti su questo candidato. Nessun fallback attuale OCI approvato: versioni 9bd/b533 e add3438 precedono alcune correzioni correnti. Serve coppia applicazione/client immutabile e riserva che preservi i nuovi fix, con prova schema48/DB/upload. Nessuna nuova migrazione o dipendenza diretta applicativa; schema, provider e workflow produzione invariati. Package e lock aggiornati soltanto per la patch sharp e relativi binari, con delta attestato: semver 7.8.5 e @emnapi/runtime 1.11.3 soltanto ricollocati, nessuna altra versione aggiornata. Installazione pulita npm ci con script lifecycle disabilitati e lock invariato. Rollback SQL non necessario; revert delle correzioni reintroduce i difetti e richiede revisione.

Registro originale di 37 finding invariato: 26 risolti nel codice, 2 parziali, 4 nel redesign, 5 nel marketing. BE-03 snapshot legacy non ricostruibili e SEC-10 decisioni/attivazione privacy restano parziali. INT-01…06 e REV-01…03 precedenti restano nel codice. **0/19 gate esterni PASS**, nessun owner, budget o autorizzazione inventato.

Prossimo passaggio locale: preparare gli artefatti production e una riserva aggiornata, poi ripetere il recupero applicazione/client sul nuovo insieme. Target isolato, operatori, soglie, controlli protetti e autorizzazioni separate restano necessari per CI hosted e installazione staging. Nessun merge main per ottenere CI: può attivare produzione.
