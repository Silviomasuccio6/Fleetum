# Codex Task Template Fleetum

Usa questo template per ogni nuovo task.

## Obiettivo

Descrivi cosa va fatto in modo specifico e verificabile.

## Contesto

- Area: backend/frontend/deploy/docs/platform/billing/privacy.
- Ambiente: local/staging/production.
- Moduli collegati.
- Rischi principali.

## File da leggere prima

```txt
[elenco file]
```

## Cosa fare

- [ ] Analizzare stato attuale.
- [ ] Proporre piano breve.
- [ ] Implementare modifica minima.
- [ ] Eseguire controlli.
- [ ] Aggiornare documentazione se necessario.

## Cosa non fare

- [ ] Non inserire secrets.
- [ ] Non modificare schema DB salvo richiesto.
- [ ] Non bypassare auth/tenant isolation.
- [ ] Non fare refactor fuori scope.
- [ ] Non fare deploy manuale se esiste GitHub Actions.

## Criteri di accettazione

- [ ] Funzionalita verificata.
- [ ] Tenant isolation rispettata.
- [ ] Build/lint/test passano o motivazione documentata.
- [ ] Nessuna regressione nota.
- [ ] Rischi residui dichiarati.

## Output finale richiesto

```md
## Modifiche effettuate
## File creati/modificati
## Comandi eseguiti
## Esito controlli
## Rischi residui
## Impatto produzione
## Prossimi step consigliati
```
