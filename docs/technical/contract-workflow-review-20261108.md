# Block 4 — scoped independent review

A fresh read-only reviewer inspected PRODUCT.md, the craft floor, the specified
synthetic desktop/mobile/tablet and signing/revision captures, and sampled source.
No browser, tests, external calls or source edits were performed by the reviewer.

Initial disposition: fix. The first report claimed EN values missing; the current
capture clearly contained them, and the issue was not reproduced. Explicit visibility
assertions and translate=no now guard identity and amounts. The revision-cache issue
was confirmed: signed conditions could stay frozen after opening a revision. The
client key and server freeze query were aligned to the actual document revision.

The follow-up identified one introduced regression: tying conditions to the general
refresh counter could erase unsaved terms when saving price. The key now uses actual
documentRevision; price refresh preserves terms and document text. Emission/signing
require saved drafts. The browser test edits both fields, saves price, verifies both
are preserved and conversion is disabled, then restores them and completes the flow.

Final reviewer verdict:

> Regressione risolta. La chiave delle condizioni ora dipende dalla revisione effettiva,
> mentre salvare il prezzo preserva le bozze. Emissione e firma sono bloccate quando
> restano modifiche da salvare.
>
> Nessun rilievo residuo nel perimetro: dati EN visibili, condizioni modificabili dopo
> revisione e bozze preservate. Revisione limitata a queste correzioni; nessuna nuova
> esecuzione o validazione live.
>
> disposition: ship

This final disposition covers the scored fixes only. Professional PDF layout is block
5; live providers, production, broader security and independent execution of tests
were outside this review. Captures/results are preserved in the delivery archive.
