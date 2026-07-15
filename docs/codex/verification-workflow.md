# Fleetum - Workflow di verifica

I comandi seguenti rendono ripetibili le verifiche locali senza indebolire i gate GitHub Actions.

## Verifica backend

```bash
npm run verify:backend
```

Esegue type-check backend e tutti i test backend con `NODE_ENV=test`.

## Verifica frontend

```bash
npm run verify:frontend
```

Esegue type-check, test e build/prerender del frontend.

## Verifica database isolata

```bash
npm run verify:database
```

Avvia un container PostgreSQL 16 temporaneo su una porta locale casuale, applica tutte le migration, verifica riconciliazione e dual-write monetari ed esegue i test HTTP multi-tenant. Il container e gli upload temporanei vengono rimossi anche in caso di errore.

Il comando non usa il database locale o di produzione. Richiede Docker in esecuzione.

## Verifica release

```bash
npm run verify:release
```

Esegue lint, build, test backend/frontend, controllo prerender e audit delle dipendenze di produzione. E il controllo locale completo prima di aprire una pull request, ma non sostituisce CI, review o deploy health check.

## Regole operative

- Usare `verify:backend` o `verify:frontend` durante lo sviluppo per feedback rapido.
- Usare `verify:database` quando cambiano Prisma, query tenant, denaro o flussi persistenti.
- Usare `verify:release` una volta, a task completato, prima di push/PR.
- Non eseguire test concorrenti che condividono lo stesso database.
- Se un processo viene interrotto, controllare con `pgrep -fl 'tsx|node.*--test|vite'` prima di rilanciare.
- Il merge resta consentito solo con tutti i check obbligatori GitHub verdi.
