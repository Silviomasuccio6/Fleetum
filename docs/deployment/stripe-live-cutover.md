# Stripe Live Cutover

Stato: pre-attivazione. Questa guida prepara il passaggio a Stripe Live senza inserire chiavi Live nel repository, in GitHub Actions o nei log.

## Scopo e regole

- Il backend Fleetum attiva una licenza solo da webhook Stripe con firma valida oppure da una modifica manuale auditata nella Platform Console.
- Il checkout usa subscription Stripe con carta obbligatoria e trial di 14 giorni.
- Il Customer Portal serve per fatture, cambio piano e cancellazione. La sostituzione carta resta nel flusso Checkout Setup di Fleetum.
- Stripe Test e Stripe Live sono ambienti distinti: prezzi, webhook secret, clienti, subscription e configurazioni Portal non sono riutilizzabili tra i due ambienti.
- Non incollare mai chiavi `sk_live_...`, `whsec_...` o `price_...` in issue, PR, chat, file `.example` o log.

## Gate bloccante: tenant Stripe Test esistenti

`TenantSubscription` conserva provider, piano e stato, ma non distingue ancora in modo esplicito una subscription Stripe Test da una Stripe Live.

Prima del cutover, dalla Platform Console classificare tutti i tenant con provider `stripe` e stato `ACTIVE`, `TRIAL` o `PAST_DUE`:

- tenant demo/test: portare a `PENDING` oppure applicare una concessione manuale locale solo se approvata e auditata;
- tenant beta reale: decidere esplicitamente se mantenerlo come concessione auditata o farlo sottoscrivere in Live;
- non cancellare BillingEvent, audit log o record storici per "pulire" il passaggio.

Non procedere a Live finche' la lista non e' stata revisionata. Altrimenti un tenant test gia' `ACTIVE` o `TRIAL` puo' mantenere l'accesso anche dopo il cambio della chiave Stripe.

## 1. Checklist account Stripe Live

- [ ] L'account Stripe Live e' attivato e verificato per l'attivita' Fleetum.
- [ ] Dati societari, coordinate di payout e informazioni pubbliche Stripe sono completi.
- [ ] Branding Stripe contiene logo Fleetum, nome riconoscibile in estratto conto e canale supporto corretto.
- [ ] Il dominio pubblico Fleetum e' verificato dove richiesto da Stripe per i metodi di pagamento scelti.
- [ ] I termini pubblici sono raggiungibili su `https://fleetum.it/termini`.
- [ ] L'informativa privacy pubblica e' raggiungibile su `https://fleetum.it/privacy`.
- [ ] Il Customer Portal Live e' configurato separatamente da quello Sandbox.

## 2. Catalogo Live: prodotti e sei prezzi

Creare o verificare in Stripe Live i prodotti/prezzi ricorrenti, tutti attivi e in EUR:

| Piano | Ciclo | Variabile VPS | Verifica |
| --- | --- | --- | --- |
| Starter | Mensile | `STRIPE_PRICE_STARTER_MONTHLY` | recurring monthly, EUR |
| Starter | Annuale | `STRIPE_PRICE_STARTER_YEARLY` | recurring yearly, EUR |
| Pro | Mensile | `STRIPE_PRICE_PRO_MONTHLY` | recurring monthly, EUR |
| Pro | Annuale | `STRIPE_PRICE_PRO_YEARLY` | recurring yearly, EUR |
| Enterprise | Mensile | `STRIPE_PRICE_ENTERPRISE_MONTHLY` | recurring monthly, EUR |
| Enterprise | Annuale | `STRIPE_PRICE_ENTERPRISE_YEARLY` | recurring yearly, EUR |

- [ ] Nessuna variabile Live punta a un `price_...` creato in Sandbox.
- [ ] Ogni prezzo e' ricorrente, attivo, in EUR e ha l'intervallo corretto.
- [ ] I prezzi mostrati in Fleetum sono allineati al catalogo Stripe e comunicati come IVA inclusa.
- [ ] Il comportamento fiscale di Stripe e le ricevute/fatture sono stati verificati con il commercialista: questa e' una verifica operativa, non consulenza fiscale.
- [ ] L'invio ricevute/fatture Stripe e il mittente email sono configurati nel dashboard Live.

## 3. Customer Portal Live

Configurare il Portal Live con le stesse scelte validate in Sandbox:

- [ ] Cronologia fatture: attiva.
- [ ] Informazioni cliente: disattive, per evitare divergenza con il profilo aziendale Fleetum che e' la fonte dati per documenti e contratti.
- [ ] Metodi di pagamento: disattivi nel Portal. La carta si sostituisce dal pulsante Fleetum dedicato, senza esporre una rimozione carta.
- [ ] Annullamento abbonamento: attivo, al termine del periodo di fatturazione.
- [ ] Motivo annullamento: attivo.
- [ ] Coupon di retention: disattivi finche' non esiste una policy commerciale approvata.
- [ ] Cambio piano: attivo solo tra i sei prezzi Fleetum.
- [ ] Cambio quantita'/seat: disattivo finche' Fleetum non sincronizza i seat con Stripe.
- [ ] Per il primo lancio, usare modifiche piano immediate e testare la prorazione. Il downgrade programmato a fine periodo e' limitato da Stripe quando i prezzi appartengono a prodotti diversi.
- [ ] Intestazione Portal: `Gestisci il tuo abbonamento Fleetum`.
- [ ] Return URL: `https://fleetum.it/upgrade?portal=returned`.
- [ ] Non attivare il link no-code pubblico del Portal: Fleetum crea sessioni Portal temporanee e tenant-scoped via API autenticata.

## 4. Segreti e variabili: dove risiedono

### GitHub Environment `production`

Il workflow di deploy non deve ricevere chiavi Stripe. GitHub conserva solo i segreti/variabili di deploy e quality gate.

| Tipo | Nome | Note |
| --- | --- | --- |
| Secret | `FLEETUM_VPS_SSH_KEY` | chiave privata deploy, mai nei log |
| Secret opzionale | `SEMGREP_APP_TOKEN` | solo SAST, non Stripe |
| Variable | `FLEETUM_VPS_HOST` | host senza protocollo/porta |
| Variable | `FLEETUM_VPS_USER` | utente deploy |
| Variable | `FLEETUM_APP_DIR` | normalmente `/opt/fleetum/app` |
| Variable | `FLEETUM_ENV_FILE` | normalmente `/opt/fleetum/env/compose.env` |
| Variable | `FLEETUM_LAST_DEPLOY_FILE` | normalmente `/opt/fleetum/last-deploy.txt` |

Non aggiungere `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` o `STRIPE_PRICE_*` ai GitHub Secrets: il workflow non ne ha bisogno e aumenterebbe inutilmente la superficie di esposizione.

### VPS: `/opt/fleetum/env/backend.env`

Le uniche variabili Stripe Live runtime stanno nel file VPS con permessi ristretti:

```env
BILLING_TRIAL_DAYS=14
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_STARTER_MONTHLY=
STRIPE_PRICE_STARTER_YEARLY=
STRIPE_PRICE_PRO_MONTHLY=
STRIPE_PRICE_PRO_YEARLY=
STRIPE_PRICE_ENTERPRISE_MONTHLY=
STRIPE_PRICE_ENTERPRISE_YEARLY=
STRIPE_PORTAL_RETURN_URL=https://fleetum.it/upgrade?portal=returned
STRIPE_BILLING_PORTAL_CONFIGURATION_ID=
```

- [ ] Il file e' fuori dal repository e leggibile solo dall'utente/servizio autorizzato.
- [ ] Il backup sicuro della configurazione precedente e' disponibile fuori dal repository.
- [ ] La chiave inizia con il prefisso Live corretto e tutti i sei price ID appartengono allo stesso account Live.
- [ ] Il `STRIPE_WEBHOOK_SECRET` e' quello del solo endpoint Live, non quello Sandbox.
- [ ] `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` resta vuoto se si usa la configurazione Portal Live predefinita; valorizzarlo solo per una configurazione specifica gia' testata.

## 5. Endpoint webhook Live

Creare un endpoint Stripe Live HTTPS:

```text
https://api.fleetum.it/api/billing/webhook
```

Eventi obbligatori:

- [ ] `checkout.session.completed`
- [ ] `customer.subscription.created`
- [ ] `customer.subscription.updated`
- [ ] `customer.subscription.deleted`
- [ ] `invoice.paid`
- [ ] `invoice.payment_succeeded`
- [ ] `invoice.payment_failed`

Il webhook Live ha un signing secret diverso da Sandbox. Fleetum riceve il body raw e rifiuta firme mancanti o non valide; non testare l'endpoint dal browser o dal frontend.

## 6. Copy UI approvato per Live

- [ ] Il titolo non deve parlare di "Stripe Test" o "sandbox".
- [ ] Deve essere esplicito: prova di 14 giorni, carta obbligatoria prima del trial, primo addebito alla fine del trial.
- [ ] Deve essere esplicito: rinnovo automatico al termine del trial secondo il ciclo scelto, salvo annullamento.
- [ ] I prezzi mostrati devono indicare IVA inclusa, coerentemente con il catalogo commerciale.
- [ ] In caso di pagamento fallito, l'utente deve essere guidato a sostituire la carta dalla pagina Upgrade.
- [ ] Il completamento checkout non abilita il tenant lato browser: l'UI attende il webhook Stripe verificato.

## 7. Test Live controllato

Eseguire in una finestra concordata e solo con un account interno Fleetum, email controllata e carta aziendale autorizzata.

1. Creare un tenant interno dedicato al test Live; non usare dati cliente reali.
2. Completare Checkout Starter mensile con carta valida e trial 14 giorni.
3. Verificare in pochi minuti: `TenantSubscription=TRIAL`, BillingEvent `PROCESSED`, audit billing e accesso gestionale consentito.
4. Aprire Customer Portal: fatture, cambio piano e cancellazione devono rispettare la configurazione Live; la carta non deve essere rimovibile dal Portal.
5. Testare la sostituzione carta solo dal pulsante Fleetum dedicato.
6. Per validare un pagamento reale, ottenere approvazione interna, terminare anticipatamente il trial del tenant di test nel dashboard Stripe e verificare `invoice.paid`/`ACTIVE`.
7. Eseguire rimborso completo del pagamento dal dashboard Stripe e registrare importo, timestamp, invoice e motivo nel registro operativo privato. Un rimborso non annulla automaticamente la subscription.
8. Cancellare la subscription di test e verificare l'evento `customer.subscription.deleted`, stato Fleetum `CANCELED` e blocco accesso dopo la cessazione effettiva.

Non simulare volutamente un pagamento fallito in Live. La regressione `invoice.payment_failed` resta obbligatoria in Sandbox/Test Mode.

## 8. Go / no-go e rollback

### Go

- [ ] Tutti i punti delle sezioni 1-6 sono completati.
- [ ] CI verde, backup offsite e restore drill recenti.
- [ ] Revisione dei tenant Stripe Test completata.
- [ ] Endpoint Live consegna un evento di test verificato senza errori backend.
- [ ] Finestra operativa, owner e canale di escalation definiti.

### No-go

Non attivare Live se manca anche uno solo tra: sei prezzi Live, signing secret Live, catalogo Portal, revisione tenant Test, backup verificato, CI verde o owner della finestra.

### Rollback prima del primo cliente Live

1. Fermare il cutover prima di creare subscription Live per clienti reali.
2. Ripristinare la precedente configurazione runtime dal backup protetto del file `backend.env` e riavviare tramite deploy sicuro.
3. Verificare `/api/ready`, login, license guard e assenza di errori Stripe nei log.
4. Non cancellare eventi, clienti, subscription o audit Live/Test per nascondere l'incidente; registrarne la causa nel runbook operativo.

### Rollback dopo il primo cliente Live

Non sostituire una chiave Live con una Test dopo avere creato subscription Live: i webhook Live verrebbero rifiutati e lo stato Fleetum potrebbe restare indietro.

1. Mantenere configurati chiave e webhook Live per continuare a ricevere eventi.
2. Usare rollback applicativo alle immagini precedenti solo se il problema e' nel codice; seguire il rollback deploy in `RUNBOOK.md`.
3. Per una subscription Live errata, rimborsare/cancellare nel dashboard Stripe e attendere i webhook verificati.
4. Se e' necessario un restore database, seguire la procedura backup/restore e riconciliare gli eventi Stripe successivi al backup prima di riaprire il servizio.

## 9. Verifica post-cutover

- [ ] `https://api.fleetum.it/api/ready` risponde 200.
- [ ] Login tenant e Platform Console funzionano.
- [ ] Un checkout Live interno passa a `TRIAL` solo dopo webhook.
- [ ] Un tenant `PENDING` continua a ricevere `LICENSE_PENDING` e non entra in dashboard.
- [ ] Customer Portal e sostituzione carta funzionano secondo la configurazione approvata.
- [ ] Nessun secret o payload Stripe sensibile appare nei log, GitHub Actions o audit visualizzati a utenti tenant.
