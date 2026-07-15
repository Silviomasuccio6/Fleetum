# Fleetum - Handoff operativo

Questo protocollo riduce il tempo perso tra task, revisioni e riprese del lavoro. I valori dinamici non vanno copiati stabilmente in questo file: si leggono dal repository con:

```bash
npm run work:status
```

Per includere la pull request associata al branch, quando GitHub CLI e autenticata:

```bash
npm run work:status -- --remote
```

Il comando e in sola lettura e non mostra remote URL, variabili ambiente, diff o segreti.

## Handoff richiesto

Prima di interrompere o passare un task, registrare nel messaggio finale:

- obiettivo e perimetro del task;
- branch e commit HEAD;
- pull request e stato CI;
- file modificati;
- comandi di verifica eseguiti e relativo esito;
- impatto su runtime, database e produzione;
- eventuali bloccanti esterni;
- prossima azione esatta.

Non inserire mai password, token, hash, chiavi API, URL firmati, dati personali o contenuto di file `.env`.

## Template

```text
Obiettivo:
Branch / HEAD:
PR / CI:
File modificati:
Verifiche completate:
Impatto runtime/database/produzione:
Bloccanti:
Prossima azione:
```
