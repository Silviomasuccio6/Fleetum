# Fleetum Platform Satinata — consegna locale

Direzione scelta e integrata, non rilasciata online. Checkout isolato su `codex/platform-satin-ui`, base associata all'immagine production `db1f231dc8cb699f1a5ce4215a0278c93212d16d`. Il commit di consegna è HEAD del branch; SHA completo e copia durevole sono nel passaggio unico.

- [Stato corrente](STATUS.md)
- [Base e matrice delle undici sezioni](PARITY.md)
- [Regole visive effettivamente implementate](DESIGN.md)
- [Comandi, verifiche e limiti](CHECKS.md)
- [Proposta di rilascio limitato e gate aperti](RELEASE_PLAN.md)
- [Screenshot chiaro](evidence/desktop-light.png), [scuro](evidence/desktop-dark.png), [frame mobile](evidence/mobile-390-frame.png)
- [Risultati browser](evidence/browser-results.json), [manifest pacchetto limitato](evidence/overlay-manifest.json), [confronto CSS](evidence/global-css-comparison.json), [audit dipendenze](evidence/dependency-audit-summary.json)

## Verdetto della revisione locale

Pronto per rivedere il candidato UI. Sono riusciti typecheck, build multipagina, prerender,27 test frontend e23 regressioni Platform. La build compilata è stata aperta nel browser con tutte le undici sezioni e trasporto sintetico; vedi i limiti delle singole prove, senza interpretarli come test remoti o certificazione di accessibilità.

La revisione ha confrontato il diff con i vincoli: nessuna modifica backend/schema/catalogo/prezzi/provider, nessun ingresso nei checkout audit/main/staging, nessuna nuova dipendenza o configurazione live. Tutte le chiamate e i payload operativi restano quelli esistenti. Sono stati corretti, a livello frontend, doppio invio, dati del dettaglio dopo aggiornamento, duplicazione della stessa fattura e ripiego falso a zero delle metriche live. Il contratto di logout locale della base production è esplicitato: non portarlo su main o su backend aggiornati senza la relativa compatibilità.

NON pronto alla produzione: audit della base3high/2moderate, confronto reale degli asset non eseguito, percorso di consegna limitato soltanto proposto, PR/CI remota e staging Platform ancora aperti. Nessun merge/deploy/chiave/segreto creati. La UI non chiude l'audit sicurezza precedente.

## Riprodurre localmente

Usare Node22.23.1, `npm ci --ignore-scripts`, generare Prisma Client se servono le regressioni backend. Nessun env reale. Il supporto `frontend/tests/support/platform-satin-lab.mjs` avvia esclusivamente l'API sintetica sul loopback5213; credenziali e OTP sono fittizi, indicati nel supporto test. Per un nuovo sviluppo locale, avviare Vite con `VITE_PLATFORM_API_BASE_URL=http://127.0.0.1:5213/platform-api` e porta5212. Il frame responsive di supporto non è un componente del prodotto né entra in dist.

L'anteprima compilata di consegna è `http://127.0.0.1:5214/platform.html#/console`, con proxy locale al solo server sintetico. Il montaggio usa una build locale della base e preserva i suoi file non Platform. Non contiene un'esportazione della produzione. Non copiare il server fake, i controlli QA o i suoi dati in staging/production.
