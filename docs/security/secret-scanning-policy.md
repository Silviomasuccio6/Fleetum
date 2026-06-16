# Secret Scanning Policy

Fleetum usa due livelli di secret scanning per bilanciare sicurezza e produttivita':

1. PR/push working tree scan: blocca nuove introduzioni di segreti.
2. Full history scan: controlla tutta la history Git in modo manuale/schedulato e produce artifact redatti.

Questa policy non sostituisce la rotazione dei segreti. Se un segreto reale e' stato committato,
considerarlo compromesso anche se viene rimosso dal repository.

## CI per PR e push

Il workflow `.github/workflows/ci.yml` esegue Gitleaks con:

```bash
gitleaks detect --source /repo --no-git --redact
```

Scopo:

- scansionare solo working tree e diff effettivo;
- evitare che vecchi falsi positivi storici blocchino ogni PR;
- bloccare nuove chiavi, token, password e `.env` committati per errore;
- non stampare segreti nei log grazie a `--redact`.

Questo job deve rimanere bloccante.

## Scansione completa della history

Il workflow `.github/workflows/secret-history-scan.yml` esegue una scansione completa con:

```bash
gitleaks detect --source /repo --redact --log-opts="--all"
```

Trigger:

- manuale tramite `workflow_dispatch`;
- schedulato ogni lunedi' alle 03:27 UTC.

Comportamento:

- checkout completo con `fetch-depth: 0`;
- fetch esplicito di tutti i branch remoti e tag;
- include la history raggiungibile con `--log-opts="--all"`;
- genera artifact SARIF redatto;
- non fallisce di default per evitare blocchi ingestibili durante triage legacy;
- puo' fallire manualmente usando `fail_on_findings=true`.

## Baseline e falsi positivi

Se Gitleaks trova stringhe storiche verificate come non-segreti o placeholder non produttivi:

1. verificare manualmente che non siano credenziali reali;
2. non copiare il valore del presunto segreto in chat, issue o PR;
3. aggiungere solo il fingerprint alla `.gitleaksignore`;
4. aprire PR con motivazione breve e riferimento al run redatto;
5. rieseguire `Secret History Scan`.

Non committare report raw di Gitleaks se contiene valori non redatti.

## Se viene trovato un segreto reale nella history

Procedura obbligatoria:

1. Revocare o ruotare immediatamente il segreto presso il provider.
2. Identificare scope e periodo di esposizione.
3. Verificare log provider per uso anomalo.
4. Aprire incidente interno senza includere il valore del segreto.
5. Rimuovere il segreto dal working tree, se ancora presente.
6. Pianificare rewrite history con `git filter-repo` o BFG su clone mirror.
7. Force-push coordinato di branch e tag.
8. Comunicare a tutti i collaboratori di reclonare o riallineare i clone locali.

Per GitHub pubblico o fork esistenti, il rewrite della history del repository principale
non elimina automaticamente copie, fork o cache esterne. I fork vanno cancellati o risincronizzati
dai rispettivi owner; se contengono segreti reali, aprire richiesta a GitHub Support.

## Comando locale: working tree

Usare prima della commit:

```bash
docker run --rm \
  -v "$PWD:/repo" \
  ghcr.io/gitleaks/gitleaks:latest \
  detect --source /repo --no-git --redact
```

## Comando locale: full history

Usare su clone completo:

```bash
git fetch --all --tags --prune
docker run --rm \
  -v "$PWD:/repo" \
  -w /repo \
  -e GIT_CONFIG_COUNT=1 \
  -e GIT_CONFIG_KEY_0=safe.directory \
  -e GIT_CONFIG_VALUE_0=/repo \
  ghcr.io/gitleaks/gitleaks:latest \
  detect \
    --source /repo \
    --redact \
    --log-opts="--all" \
    --report-format sarif \
    --report-path gitleaks-history.sarif
```

## Verifiche mirate legacy Fleetum

```bash
git log --all -S "<legacy-brand-or-system-marker>" --oneline
git log --all -S "<legacy-real-email>" --oneline
git log --all -S "<legacy-customer-script-marker>" --oneline
git rev-list --objects --all | grep -E '<legacy-customer-script-marker>|\\.gs$' || true
```

Se una verifica torna positiva, non considerare il repository completamente pubblico finche'
la history non e' stata ripulita o il rischio non e' stato formalmente accettato.
