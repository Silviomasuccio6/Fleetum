# Google Search Console - Fleetum

## Obiettivo

Collegare il dominio pubblico `fleetum.it` a Google Search Console per monitorare indicizzazione, query organiche, errori e Core Web Vitals reali.

## Configurazione consigliata

1. Aprire [Google Search Console](https://search.google.com/search-console/).
2. Selezionare **Aggiungi proprieta'** e scegliere **Dominio**.
3. Inserire `fleetum.it`, senza `https://` e senza prefissi come `www`.
4. Copiare il record TXT mostrato da Google.
5. Nel provider DNS che gestisce `fleetum.it`, creare il record TXT richiesto sul dominio radice.
6. Tornare in Search Console e selezionare **Verifica**.

Una proprieta' di tipo Dominio copre `fleetum.it`, `www.fleetum.it` e tutti i sottodomini, incluso `api.fleetum.it`. Non inserire il valore TXT nel repository o nei file environment.

## Dopo la verifica

1. Aprire **Sitemap** e inviare `https://fleetum.it/sitemap.xml`.
2. Usare **Controllo URL** per richiedere l'indicizzazione di:
   - `https://fleetum.it/`
   - `https://fleetum.it/software-autonoleggio`
   - `https://fleetum.it/prezzi`
   - `https://fleetum.it/demo`
3. Controllare entro le settimane successive **Pagine**, **Esperienza** e **Rendimento**.
4. Configurare un report mensile sulle query che contengono termini come `software autonoleggio`, `gestionale noleggio auto` e `gestionale rent a car`.

## Verifica post-deploy

Le seguenti risorse devono rispondere `200` e contenere contenuto reale, non il fallback della SPA:

- `https://fleetum.it/robots.txt`
- `https://fleetum.it/sitemap.xml`
- `https://fleetum.it/llms.txt`
- `https://fleetum.it/brand/fleetum-social-preview.png`

Per aggiornare la sitemap in futuro, modificare solo URL pubblici canonici e impostare `lastmod` alla data di modifica effettiva della pagina.
