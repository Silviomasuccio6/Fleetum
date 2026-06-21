# Fleetum Technical Documentation

Questa sezione descrive il prodotto Fleetum come esiste nel codice. E la fonte tecnica per sviluppatori, designer, agenzie web e operatori interni. Non sostituisce i documenti legali in `legal/`.

## Documenti

- [Sistema, moduli e architettura](./fleetum-system-reference.md)
- [Catalogo API](./api-catalog.md)
- [Brief per il sito pubblico](./website-build-brief.md)
- [Recupero password Platform Console](./platform-password-recovery.md)

## Regole di uso

- Le API tenant sono sotto `/api` e richiedono JWT, permessi e tenant isolation, salvo le route pubbliche elencate nel catalogo.
- Le API Platform sono sotto `/platform-api`, sono protette da IP allowlist e da JWT Platform con OTP.
- Le credenziali reali rimangono solo in VPS/GitHub Secrets. Questa documentazione usa esclusivamente nomi di variabili e placeholder.
- Quando cambia una route, aggiornare nello stesso PR `api-catalog.md` e gli eventuali flussi UI collegati.
