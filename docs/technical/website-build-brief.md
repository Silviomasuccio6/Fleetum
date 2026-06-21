# Brief Tecnico per il Sito Pubblico Fleetum

Stato: pronto per design e sviluppo landing
Aggiornato: 2026-06-21

## Obiettivo del sito

Convertire aziende di autonoleggio e fleet management in demo request e signup qualificati. Il sito deve spiegare il valore operativo in pochi secondi, non replicare l'app tenant e non esporre dati interni.

## Architettura corretta

- Dominio marketing: `fleetum.it`.
- App tenant: stesso dominio, route protette dopo login.
- Platform Console: `platform.fleetum.it`, mai linkata pubblicamente.
- API pubbliche consentite: `POST /api/public/analytics/event`, `POST /api/public/demo-request`.
- Form signup usa il flusso applicativo `/signup`, che prosegue in onboarding e Stripe Checkout.
- Non inserire chiavi Stripe, Resend, Google OAuth, URL di storage o endpoint Platform nel bundle pubblico.

## Sitemap consigliata

| Pagina | URL | Intento | CTA primaria |
|---|---|---|---|
| Home | `/` | capire valore e fidarsi | Richiedi demo / Inizia prova |
| Prezzi | `/prezzi` | scegliere piano | Scegli il tuo piano |
| Booking | `/booking-noleggi` | dimostrare calendario e disponibilita | Vedi come funziona |
| Contratti | `/contratti-noleggio-digitali` | ridurre carta e consegne | Richiedi demo |
| Redditivita | `/report-redditivita-veicolo` | mostrare ROI flotta | Guarda i report |
| Software autonoleggio | `/software-autonoleggio` | SEO ad alta intenzione | Prova Fleetum |
| Rent a car | `/software-rent-a-car` | SEO verticale | Prenota una demo |
| Gestionale flotta | `/gestionale-flotta` | SEO verticale | Scopri Fleetum |
| Demo | `/demo` | acquisizione lead | Invia richiesta |
| Fiducia | `/trust` | sicurezza, privacy, affidabilita | Contatta il team |
| Legali | `/privacy`, `/cookie`, `/termini`, `/dpa` | trasparenza | Nessuna CTA commerciale |

## Hero e messaggio

La home deve dire con chiarezza:

- per chi: autonoleggi, rent-a-car, flotte multi-sede;
- cosa: booking, contratti, veicoli, manutenzioni e margini in un solo sistema;
- risultato: piu prenotazioni gestibili, meno errori operativi, controllo economico per veicolo.

CTA primaria: `Inizia la prova` o `Scegli il piano` porta al signup applicativo.
CTA secondaria: `Richiedi una demo` porta a `/demo`.

## Sezioni home

1. Hero con screenshot reale del booking, non mock data inventati.
2. Prova sociale: categorie cliente, non loghi non autorizzati.
3. Tre problemi/soluzioni: occupazione flotta, contratti, redditivita.
4. Booking calendario come feature protagonista: veicolo per riga, giorni per colonna, stati leggibili.
5. Flusso operativo: acquisizione cliente -> booking -> contratto -> consegna -> riconsegna -> report.
6. Multi-sede, ruoli e sicurezza.
7. Prezzi e trial con carta richiesta prima dell'attivazione.
8. FAQ autentiche su onboarding, Stripe, dati, supporto.
9. CTA finale demo/signup.

## Design e UX

- Design light, SaaS B2B, tipografia leggibile e griglia ampia.
- Palette coerente con Fleetum; non usare dark mode come default della landing.
- Booking deve avere priorita visiva: screenshot larghi, callout su disponibilita, entrate/uscite, sede e stati.
- Mostrare dati fittizi solo se etichettati `Demo`; preferire UI reale senza PII.
- Mobile: CTA fissa discreta, griglie trasformate in card, non comprimere screenshot illeggibili.
- Accessibilita: contrasto AA, focus visibile, alt text utili, nessuna informazione solo tramite colore.

## Analytics consentiti

Inviare solo eventi minimizzati dopo consenso privacy appropriato:

| Evento | Quando |
|---|---|
| `PAGE_VIEW` | visualizzazione pagina pubblica |
| `CTA_CLICK` | click CTA demo, prezzi o signup |
| `DEMO_FORM_STARTED` | prima interazione form demo |
| `DEMO_FORM_SUBMIT` | invio valido form demo |
| `SIGNUP_STARTED` | avvio registrazione |
| `SIGNUP_COMPLETED` | completamento registrazione |

L'endpoint analytics hashizza identificatori tecnici; non inviare PII, token, codice fiscale, numero carta o contenuto form nel campo metadata.

## Form demo

Endpoint: `POST /api/public/demo-request`.

Campi supportati: azienda, referente, email, telefono opzionale, dimensione flotta opzionale, messaggio opzionale, sorgente e UTM. Il sito deve validare lato client per UX, ma trattare la validazione backend come definitiva.

Success state: conferma sobria, nessuna promessa di tempo di risposta non verificata. Error state: mantenere i dati digitati e invitare a riprovare senza mostrare dettagli infrastrutturali.

## SEO e performance

- HTML prerenderizzato per pagine pubbliche.
- `title`, description, canonical, Open Graph e JSON-LD per ogni pagina.
- `robots.txt`, `sitemap.xml`, `llms.txt` aggiornati al deploy.
- Og image con logo centrato e testo leggibile in 1200x630.
- Immagini WebP/AVIF, responsive, lazy loading sotto fold.
- Caricare dashboard e librerie grafiche solo dopo login tramite lazy route.
- Lighthouse target: Performance >= 85, SEO >= 95, Accessibility >= 90.

## Cosa non fare

- Non mostrare path `/platform-api` o l'IP della VPS.
- Non usare endpoint autenticati da landing.
- Non pubblicare screenshot con targa, patente, email o nomi reali.
- Non promettere compliance legale assoluta; usare testi validati nel pacchetto legal.
- Non attivare un tenant dal browser dopo checkout: il webhook Stripe e la fonte di verita.
