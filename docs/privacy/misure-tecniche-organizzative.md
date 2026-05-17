# Misure Tecniche e Organizzative Privacy/Security

Versione: 1.0  
Data: 2026-05-05  
Stato: BOZZA TECNICA

## 1. Misure gia presenti nel repository

| Misura | Evidenza | Stato |
|---|---|---|
| RBAC/permessi route | `requirePermissions(...)` sulle route | PRESENTE |
| Tenant isolation a query | `tenantId` diffuso nei modelli/query | PRESENTE-PARZIALE |
| CSRF | Middleware `requireCsrfProtection` | PRESENTE |
| Cookie sessione HttpOnly | `fermi_access`, `fermi_refresh` lato backend | PRESENTE |
| Rate limit auth | Middleware auth/platform | PRESENTE |
| Helmet/CSP | App Express | PRESENTE |
| Audit log | Modello `AuditLog` | PRESENTE-PARZIALE |
| Secret scan CI | Gitleaks workflow | PRESENTE |
| Backup script | `ops/backup-db.sh` | PRESENTE |
| Restore test script | `ops/restore-db-test.sh` | PRESENTE |

## 2. Misure mancanti o parziali

| Misura | Stato | Priorita | Note |
|---|---|---:|---|
| Storage allegati privato/cifrato | MANCANTE | P0 | Filesystem locale non sufficiente per SaaS |
| Antivirus upload | MANCANTE | P0 | Necessario per PDF/JPG/documenti |
| Magic-number validation completa PDF/Office | PARZIALE | P0 | Immagini validate, altri file da rafforzare |
| Audit download documenti | PARZIALE | P1 | Serve evento per ogni accesso documento/contratto |
| Retention automatizzata | MANCANTE | P0 | Job e policy |
| Monitoring e alerting | MANCANTE | P0 | Errori, download anomali, login anomali |
| DPA fornitori | MANCANTE | P0 | Obbligatorio con dati reali |
| Restore periodico verificato | NON VERIFICABILE | P0 | Serve evidenza |
| Test tenant isolation | MANCANTE | P0 | Necessario SaaS |

## 3. Controlli minimi produzione

- HTTPS obbligatorio.
- Cookie `Secure`, `HttpOnly`, `SameSite`.
- JWT secret e platform secret robusti e ruotabili.
- CORS allowlist per domini reali.
- Platform console con IP allowlist + MFA/OTP obbligatorio.
- Object storage privato per allegati.
- Antivirus e validazione contenuto upload.
- Log centralizzati con redaction.
- Backup cifrati e restore testato.
- Audit accessi a documenti e contratti.
- Tenant isolation testata.

## 4. Matrice dati/misure

| Dato | Misure richieste |
|---|---|
| Documenti identita/patente | Storage cifrato, RBAC, audit download, retention, AV scan |
| Contratti PDF/firme | Link scadenza/revoca, audit, cifratura storage |
| Dati clienti | Tenant isolation, RBAC, minimizzazione, export/cancellazione |
| Fatture/allegati manutenzione | Classificazione, retention fiscale, AV scan |
| Log/sessioni | Redaction, retention breve, accesso ristretto |

## 5. Piano tecnico privacy P0

1. Migrare allegati a object storage privato.
2. Integrare AV scan e magic validation file.
3. Implementare test tenant isolation.
4. Implementare audit download documenti.
5. Implementare retention/cancellazione/anonymization.
6. Centralizzare monitoring e alerting.
