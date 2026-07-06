# Fleetum Platform Analytics

Fleetum Platform Analytics e' il tracking first-party usato per capire traffico, CTA, campagne UTM e funnel completo sito -> onboarding -> checkout -> trial.

## Stato implementazione

Implementato:

- `PAGE_VIEW`
- `CTA_CLICK`
- `DEMO_FORM_VIEW`
- `DEMO_FORM_SUBMIT`
- `SIGNUP_VIEW`
- `SIGNUP_STARTED`
- `SIGNUP_COMPLETED`
- `ONBOARDING_COMPANY_COMPLETED`
- `STRIPE_CHECKOUT_STARTED`
- `STRIPE_CHECKOUT_COMPLETED`
- visitor anonimo persistente
- sessione anonima per tab/sessione browser
- UTM `source`, `medium`, `campaign`, `content`, `term`
- consenso analytics obbligatorio per salvare eventi raw
- `TRIAL_ACTIVATED` confermato da webhook Stripe verificato

## Endpoint

Endpoint pubblico:

```txt
POST /api/public/analytics/event
```

Il client invia eventi solo dopo consenso analytics. Se `consentAnalytics` e' `false`, il backend risponde `202` ma non salva l'evento.

Gli eventi finali di billing non vengono considerati affidabili dal redirect del browser:

- `STRIPE_CHECKOUT_COMPLETED` viene scritto dal webhook Stripe `checkout.session.completed`;
- `TRIAL_ACTIVATED` viene scritto solo quando Stripe conferma una subscription `trialing`;
- l'idempotenza webhook evita doppi conteggi su retry Stripe.

## Dati salvati

Per ogni evento vengono salvati:

- tipo evento;
- path pagina;
- referrer ridotto dal client;
- UTM;
- device type;
- browser;
- visitorId hashato server-side;
- sessionId hashato server-side;
- IP hashato server-side;
- user agent hashato server-side;
- metadata limitati e validati.

## Dati non salvati

Non devono essere salvati negli eventi analytics:

- password;
- token;
- dati carta;
- documenti;
- email nei metadata;
- numeri di telefono nei metadata;
- IP completo in chiaro;
- user agent grezzo.

Le richieste demo salvano i dati del lead nella tabella dedicata `DemoLead`, perche' sono dati forniti volontariamente nel form. Gli eventi analytics restano invece minimizzati.

## Consenso

Il consenso e' gestito da `fleetum_cookie_consent_v1` in `localStorage`.

Regole:

- cookie necessari sempre attivi;
- analytics spento finche' l'utente non acconsente;
- eventi in coda solo per `PAGE_VIEW` e inviati dopo consenso;
- `Do Not Track` viene rispettato dal client analytics.

## UTM consigliati

Esempio Google Ads:

```txt
https://fleetum.it/?utm_source=google&utm_medium=cpc&utm_campaign=starter_autonoleggi&utm_content=hero_a&utm_term=software_autonoleggio
```

Esempio campagna social:

```txt
https://fleetum.it/prezzi?utm_source=linkedin&utm_medium=social&utm_campaign=pricing_b2b&utm_content=post_demo
```

## Dove leggere i dati

Platform Console:

```txt
Platform Console -> Analytics
```

KPI disponibili:

- page view;
- visitatori stimati;
- CTA click;
- account creati;
- dati aziendali completati;
- checkout avviati;
- checkout completati;
- checkout falliti/annullati;
- trial attivati;
- signup avviati;
- visita -> signup;
- visita -> trial;
- checkout success rate;
- funnel per step;
- performance sorgenti con visitatori, signup, checkout e trial;
- top pagine;
- sorgenti UTM;
- campagne UTM;
- device.

## Funnel operativo

La Platform Console mostra il funnel:

```txt
Visite sito
Signup avviati
Account creati
Dati aziendali completati
Checkout avviati
Checkout completati
Trial attivati
```

Per ogni step sono calcolati:

- conversione dallo step precedente;
- conversione rispetto alle visite;
- trend giornaliero;
- performance per sorgente/referrer.

Interpretazione consigliata:

- molte visite e pochi signup: problema di promessa, fiducia, prezzo o CTA;
- molti signup e pochi dati aziendali completati: onboarding troppo lungo o campi poco chiari;
- molti dati aziendali completati e pochi checkout: pricing/copy prima di Stripe da migliorare;
- molti checkout avviati e pochi trial: configurazione Stripe, carta richiesta, trust e copy pagamento da verificare.

## Note privacy

Questa implementazione e' tecnica e privacy-by-design, ma non sostituisce review legale o DPO. Prima di usare analytics in produzione commerciale, validare:

- Cookie Policy;
- Privacy Policy;
- retention eventi;
- informativa lead demo;
- eventuali banner o preferenze consenso.

## Step successivi

1. Aggiungere insight automatici sulle pagine e CTA migliori.
2. Aggiungere export CSV aggregato.
3. Aggiungere confronto periodo precedente.
4. Aggiungere alert se il checkout success rate cala sotto una soglia configurata.
