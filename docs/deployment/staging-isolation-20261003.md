# Fleetum — isolamento staging, 3 ottobre 2026

Tranche locale, branch `codex/fix-staging-isolation`, parent `e9843cb985a8e400e92e9d24afb86271c64f8218`. SHA finale, tree e risultati esatti sono registrati nel rapporto esterno `Fleetum-audit-20260909/STAGING_ISOLATION_20261003.md`. Non autorizza push, merge, dispatch, deploy o uso di provider.

## Baseline e comportamento

`FLEETUM_ENVIRONMENT` è distinto da `NODE_ENV`: il primo attiva la policy staging, il secondo rimane production nell’immagine. Senza il nuovo flag il comportamento precedente resta invariato. Lo staging Compose impone letteralmente il flag, email disabled, retention/dunning false; non permette override tramite backend.env. Env valida origini canoniche, DB PostgreSQL host `postgres`, porta5432, user/database `fleetum_staging`, storage local, nessuna credenziale Resend/Stripe/OAuth/S3. I valori sensibili non entrano nei messaggi di rifiuto. Prima della migrazione viene caricato `dist/shared/config/env.js`; una configurazione errata arresta il comando prima di Prisma. Il capability preflight rifiuta candidati storici senza questa policy prima di build/publish; non è una review indipendente del codice.

L’email sender interrompe lo staging prima di costruire Resend e restituisce503 `STAGING_EMAIL_DISABLED`. Non è un sink di consegna: un invio bloccato non viene dichiarato riuscito. Reminder, coda email, report programmati, retention e dunning non vengono avviati dal bootstrap staging. Password reset, inviti e notifiche che richiedono una consegna email non possono essere collaudati end-to-end in questa baseline. Le regressioni del percorso ordinario sono verificate con provider simulato; una futura configurazione sandbox richiede progetto e review separati.

Il backend e PostgreSQL hanno solo la rete Docker interna `fleetum_staging_private`; Caddy dispone anche di una rete edge. Il backend non ha accesso diretto alla rete esterna nella topologia dichiarata. Le osservazioni read-only verificano flag, membership esclusiva del backend e identità/internal della rete, oltre a immagini e restart. Non espongono `.Config.Env`, solo booleans di confronto esatto e IDs tecnici; duplicati/noncanonical flags falliscono. Deploy osserva la policy prima di health/proof; E2E la ricontrolla prima e dopo. Il progetto Compose è letteralmente `fleetum-staging` e ogni comando passa `--project-name fleetum-staging`, evitando il default derivato dalla directoryapp. Il preflight host controlla solo metadati di percorsi reali/symlink e ownership Docker; servizi orfani del progetto o risorse con owner diverso causano rifiuto prima delle mutazioni, senza eliminarli automaticamente. Artefatti precedenti senza `isolationPolicyVersion:1` vengono rifiutati.

Le variabili protette `FLEETUM_STAGING_TRUSTED_WORKFLOW_SHA` e `FLEETUM_STAGING_APPROVED_RELEASE_SHA` devono corrispondere rispettivamente alla revisione del workflow e al candidato esatto, altrimenti niente build/deploy/E2E. CI verde non equivale a review. Gate/observer con SSH vengono eseguiti dal checkout separato `.fleetum-control` della revisione del workflow, senza eseguire script del candidato con quelle credenziali. Proof e run devono attestare lo stesso controlSHA. Le protezioni reali dei branch/environment e chi può modificare tali variabili restano un gate esterno: il codice non protegge da un amministratore che altera deliberatamente workflow o policy.

Il contesto `GITHUB_WORKFLOW_SHA` identifica la revisione della definizione, secondo la [documentazione ufficiale GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/variables).

SSH usa trust pinned in `FLEETUM_STAGING_KNOWN_HOSTS`, senza keyscan o configurazione SSH ambientale. Path di deploy ammessi solo `/opt/fleetum-staging/app`, `/opt/fleetum-staging/env/compose.env`, `/opt/fleetum-staging/deploy.lock`; varianti custom precedenti non sono ammesse nella baseline isolata. Nessun valore/configuration live è stato aggiornato.

## Target, tenant e discovery

E2E accetta solo HTTPS staging.fleetum.it per UI e API api-staging.fleetum.it/api oppure staging.fleetum.it/api, con porta443, nessuna query/hash/credenziale/percorso aggiuntivo. Account differenti non sono sufficienti: il global setup autentica due contesti cookie isolati, richiede CSRF e due tenantId non vuoti e diversi prima dei test business; redirect rifiutati e contesti sempre eliminati. Nessun tenantId/token/password viene stampato. Questo controllo non attesta la natura sintetica dei dati né revoca le sessioni server create dall’autenticazione.

Rehearsal locale separato: opt-in `E2E_TARGET_MODE=local-rehearsal`, `NODE_ENV=test`, nessun hosted CI, unico origin HTTPS127.0.0.1 con porta esplicita. Runner rifiuta hosted CI prima di allocare risorse; non può trasformare un hostname arbitrario in target ammesso. Bootstrap applicato anche al runner locale. Parser CLI rifiuta opzioni sconosciute/duplicate/mancanti e richiede SHA completo per esecuzione; trace e video disabilitati per impedire la persistenza dei corpi login/cookie negli artefatti.

Caddy applica ai tre host `X-Robots-Tag: noindex, nofollow, noarchive`, `/robots.txt` disallow-all e sitemap404. I file SEO e il Caddy di produzione restano invariati. Route esplicite impediscono al file statico robots di prevalere; la gestione errori applica gli header anche alle risposte502. Le prove Caddy locali adattano solo trasporto/TLS/upstream a un container sintetico senza egress; non provano proxy o certificati dello staging reale.

## Verifiche e limiti

Prima dei fix sono state conservate prove RED per policy, network e target/preflight. Poi test mirati GREEN, review del diff, verifica release con Node22 e controlli locali sintetici. Comandi, exit/count, hash sorgenti e ambienti sono nel rapporto esterno. Non sono stati letti env reali, dati personali o chiavi provider, né eseguiti email, pagamenti, SSH/staging/GitHub reali.

Restano gate indipendenti su host/path/mount e purezza dei dati, firewall/egress reale, routing HTTPS, protezioni GitHub e owner, provider sandbox, restore/migrazioni/carico, decisioni legacy/privacy. Controlli locali non trasformano alcun gate esterno inPASS. Schema e lockfile invariati; zero migrazioni o dipendenze nuove. Redesign UI escluso.

## Impatto e rollback

Il nuovo codice è inattivo sul percorso ordinario senza flagstaging. Sulla baseline staging le chiavi provider esistenti o i parametri noncanonici causano arresto anticipato; non vanno aggirati per ottenere un healthcheck verde. Rete interna richiede una sostituzione/revisione delle risorse staging alla futura esecuzione autorizzata; nessuna risorsa live è stata cambiata qui.

Rollback tramite revert del commit applicativo e del successivo refresh documentale, in ordine inverso. Arrestare lo staging e riesaminare la topologia prima della futura esecuzione: il revert riapre i gap di contenimento. Non ci sono downSQL, restore automatici o side effect finanziari da annullare.
