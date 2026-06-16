# Fleetum Landing SEO Checklist

## Rendering Strategy

- [x] La landing resta SPA Vite per mantenere semplicità operativa.
- [x] I meta tag runtime sono gestiti con `react-helmet-async`.
- [x] `index.html` contiene fallback statici per crawler e anteprime social.
- [ ] Valutare prerender statico delle sole pagine pubbliche se Search Console mostra indexing lento.
- [ ] Valutare SSR solo se la landing diventa contenuto editoriale complesso o multi-lingua spinta.

## Meta Tag

- [x] Title.
- [x] Description.
- [x] Canonical URL.
- [x] Open Graph title/description/url/image.
- [x] Twitter card.
- [x] JSON-LD SoftwareApplication.
- [x] JSON-LD FAQ per pagine verticali.
- [x] JSON-LD Breadcrumb per pagine verticali.

## Performance

- [x] Route tenant principali in `React.lazy`.
- [x] `Suspense` con `PageLoader`.
- [x] Auth e landing non lazy per primo render rapido.
- [x] Prefetch post-login di dashboard, booking e veicoli.
- [x] `manualChunks` Vite per React, charts, forms, UI icons e HTTP.
- [x] Warning chunk Vite a 500 KB.

## Tailwind

- [x] `content[]` include `index.html`.
- [x] `content[]` include `platform.html`.
- [x] `content[]` include `src/**/*.{ts,tsx}`.
- [x] Tailwind v3 purge/content scan attivo via build production.
- [x] `@tailwindcss/typography` non installato perché non risultano contenuti markdown/prose nel frontend.

## Lighthouse CI

- [x] Lighthouse CI aggiunto al workflow.
- [x] Target operativo: Performance 85, SEO 95, Accessibility 90.
- [x] Gate CI: Performance sotto 85 fallisce, quindi anche sotto 70.
- [x] SEO sotto 95 fallisce.
- [x] Accessibility sotto 90 fallisce.
- [x] Report caricati come artifact GitHub Actions.

## Prossimi Step SEO

- [ ] Aggiungere immagini Open Graph dedicate, dimensione consigliata 1200x630.
- [ ] Collegare Search Console e monitorare coverage/indexing.
- [ ] Aggiungere pagine verticali per città/segmenti solo con contenuto reale, non doorway pages.
- [ ] Misurare Core Web Vitals reali in produzione.
- [ ] Valutare prerender statico delle pagine pubbliche se i crawler non eseguono correttamente la SPA.
