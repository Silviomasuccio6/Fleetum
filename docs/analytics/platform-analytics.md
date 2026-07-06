# Fleetum Platform Analytics

Fleetum Platform Analytics e' il tracking first-party usato per capire traffico, CTA, campagne UTM e funnel iniziale del sito pubblico.

## Stato implementazione

Step 1 implementato:

- `PAGE_VIEW`
- `CTA_CLICK`
- `DEMO_FORM_VIEW`
- `DEMO_FORM_SUBMIT`
- `SIGNUP_VIEW`
- `SIGNUP_STARTED`
- `SIGNUP_COMPLETED`
- `STRIPE_CHECKOUT_STARTED`
- visitor anonimo persistente
- sessione anonima per tab/sessione browser
- UTM `source`, `medium`, `campaign`, `content`, `term`
- consenso analytics obbligatorio per salvare eventi raw

## Endpoint

Endpoint pubblico:

```txt
POST /api/public/analytics/event
```

Il client invia eventi solo dopo consenso analytics. Se `consentAnalytics` e' `false`, il backend risponde `202` ma non salva l'evento.

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
- visita -> demo;
- signup avviati;
- visita -> signup;
- top pagine;
- sorgenti UTM;
- campagne UTM;
- device.

## Note privacy

Questa implementazione e' tecnica e privacy-by-design, ma non sostituisce review legale o DPO. Prima di usare analytics in produzione commerciale, validare:

- Cookie Policy;
- Privacy Policy;
- retention eventi;
- informativa lead demo;
- eventuali banner o preferenze consenso.

## Step successivi

1. Aggiungere tabella funnel dettagliata in Platform.
2. Collegare `STRIPE_CHECKOUT_COMPLETED` dai webhook Stripe.
3. Aggiungere insight automatici sulle pagine e CTA migliori.
4. Aggiungere export CSV aggregato.
