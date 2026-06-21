# Piano di misurazione SEO e conversioni

## Principio

Fleetum usa eventi first-party visibili nella Platform Console. La raccolta di eventi di navigazione e CTA avviene solo dopo consenso esplicito alla categoria Analytics. Le richieste demo restano registrate come lead operativi, anche quando il visitatore non abilita analytics.

## Funnel misurato

| Evento | Significato | Esempi di origine |
| --- | --- | --- |
| `PAGE_VIEW` | Visita a una pagina pubblica | home, pagine prodotto, demo, signup |
| `PRICING_VIEW` | Esposizione della sezione o pagina prezzi | home, `/prezzi` |
| `CTA_CLICK` | Click verso demo o signup | hero, header, prezzi, CTA finale |
| `DEMO_FORM_VIEW` | Apertura della pagina demo | `/demo` |
| `DEMO_FORM_SUBMIT` | Lead demo inviato con successo | endpoint demo pubblico |
| `SIGNUP_VIEW` | Apertura del flusso di registrazione | `/signup` |
| `SIGNUP_STARTED` | Primo step signup valido o avvio Google | dati azienda, Google OAuth |
| `SIGNUP_COMPLETED` | Tenant creato con successo | registrazione email |
| `LOGIN_CLICK` | Click verso il login | header, hero, pagine prodotto |

## Attribuzione

Quando l'utente ha accettato Analytics, Fleetum conserva nella sola sessione browser `utm_source`, `utm_medium` e `utm_campaign`. L'attribuzione e' mantenuta durante la navigazione verso demo e signup. Il referrer viene ridotto al solo dominio di origine: query string e percorsi non vengono salvati.

## KPI nella Platform Console

- Page view e visitatori stimati.
- CTA click.
- Visita a demo e tasso visita -> demo.
- Signup avviati.
- Signup completati e tasso visita -> signup.
- Top pagine, referrer, device e browser.

## Search Console

Search Console resta la fonte per impression, click organici, query e stato di indicizzazione. La configurazione DNS e l'invio sitemap sono descritti in [search-console-setup.md](./search-console-setup.md).

## Verifica mensile

1. Confrontare query e pagine organiche in Search Console con conversioni nella Platform Console.
2. Individuare le pagine con visite ma CTA basse e migliorare copy, prova sociale o CTA.
3. Verificare le campagne UTM per distinguere traffico organico, referral e campagne a pagamento.
4. Non introdurre Google Analytics, Meta Pixel o altri script terzi senza aggiornare banner, Cookie Policy e consenso.
