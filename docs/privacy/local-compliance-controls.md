# Controlli Compliance Locali Implementati

Stato: IMPLEMENTATO-TECNICO / DA VALIDARE DPO-LEGAL

Ultimo aggiornamento: 2026-05-14

## 1. Scopo

Questo documento registra i controlli tecnici implementati in local per avvicinare Fleetum alla readiness privacy/compliance prima della produzione.

Non sostituisce validazione legale, DPO o fiscalista.

## 2. Endpoint privacy tenant-safe

Tutti gli endpoint sono sotto `/api/privacy`, richiedono autenticazione tenant, CSRF sulle mutazioni e permessi applicativi.

| Endpoint | Metodo | Scopo | Permesso |
|---|---:|---|---|
| `/api/privacy/data-subjects/customers/:customerId/export` | GET | esporta mappa dati cliente noleggio | `privacy:export` |
| `/api/privacy/data-subjects/customers/:customerId/anonymize` | POST | anonimizza cliente e allegati collegati | `privacy:manage` |
| `/api/privacy/retention/preview` | GET | dry-run retention dati tecnici/documentali | `privacy:manage` |
| `/api/privacy/retention/run` | POST | esegue retention con conferma esplicita | `privacy:manage` |

## 3. Conferme obbligatorie

Le azioni distruttive richiedono conferma esplicita:

```json
{ "confirmation": "ANONYMIZE_CUSTOMER", "legalBasis": "Richiesta verificata / base privacy interna" }
```

```json
{ "confirmation": "RUN_RETENTION" }
```

## 4. Retention locale

Script disponibili:

```bash
npm run privacy:retention:dry-run -w backend
npm run privacy:retention:run -w backend
```

La retention include anche i `StoredFileObject` gia' marcati con `deletedAt`.
La finestra di grazia e' configurabile con:

```txt
PRIVACY_RETENTION_DELETED_FILE_GRACE_DAYS=30
```

Esecuzione manuale con finestra dedicata:

```bash
npm run privacy:retention:dry-run -w backend -- --tenant=<tenantId> --deleted-file-grace-days=30
npm run privacy:retention:run -w backend -- --tenant=<tenantId> --deleted-file-grace-days=30
```

Il job rimuove solo file gia' cancellati logicamente, appartenenti al tenant e al provider storage corrente.
Non elimina contratti, loghi o allegati ancora attivi.

Variabili:

```env
PRIVACY_RETENTION_CRON_ENABLED=false
PRIVACY_RETENTION_CRON_SCHEDULE="30 3 * * *"
```

Default tecnici:

| Categoria | Default |
|---|---:|
| Token reset/invito scaduti | 30 giorni |
| Sessioni refresh scadute/revocate | 90 giorni |
| Allegati cliente già anonimizzato/eliminato | 30 giorni |

## 5. Upload hardening

Il layer upload ora verifica:

- MIME type allowlist;
- magic-byte reale per immagini, PDF, Office OpenXML, Office legacy e testo;
- blocco payload EICAR come test locale malware;
- cancellazione file se la validazione fallisce;
- audit upload/download/delete documenti.

Nota: il controllo EICAR locale non sostituisce un antivirus reale di produzione. In produzione va collegato ClamAV o servizio equivalente.

## 6. Audit aggiunti

Eventi tecnici introdotti o rafforzati:

- `DOCUMENT_UPLOAD`
- `DOCUMENT_DOWNLOAD`
- `DOCUMENT_DELETE`
- `DATA_SUBJECT_EXPORT`
- `DATA_SUBJECT_ANONYMIZED`
- `DATA_RETENTION_EXECUTED`
- `PUBLIC_CONTRACT_DOWNLOAD`
- `PUBLIC_CONTRACT_LINKS_REVOKED`

## 6.1 Osservabilità storage e retention

La Platform Console mostra un riepilogo operativo dei documenti tracciati in `StoredFileObject`:

- file attivi e dimensione totale;
- file soft-deleted in attesa del periodo di grazia;
- dimensione recuperabile dalla prossima retention;
- ultimo cleanup privacy;
- principali tipologie documento per spazio occupato;
- eventi storage recenti senza nomi file o URL firmati.

Le metriche Prometheus dedicate sono esposte solo quando le metriche sono abilitate e protette da token.
Non vengono esportati nomi file, storage key, URL firmati o contenuti dei documenti.

## 7. Link pubblici contratti

I link pubblici contratto hanno:

- token firmato;
- scadenza;
- audit accesso download;
- revoca logica dei link WhatsApp tramite endpoint booking:

```http
POST /api/rental-bookings/:id/contract/share/revoke
```

## 8. Verifiche locali eseguite

| Controllo | Esito |
|---|---:|
| Backend build | PASS |
| Backend test suite | PASS |
| Frontend build | PASS |
| Retention dry-run local | PASS |
| Test magic-byte PDF/Office/EICAR | PASS |

Script cumulativo disponibile:

```bash
./ops/preflight-compliance.sh
```

## 9. Gap residui non chiudibili solo in local

- Validazione DPO/Legal di RoPA, DPIA, informative e DPA.
- DPA firmati con fornitori reali.
- Storage allegati cifrato/privato in infrastruttura reale.
- Antivirus reale su ambiente di produzione.
- Backup cifrati e restore periodico su VPS/provider.
- TLS/DNS/CORS produzione su dominio definitivo.
- Validazione fiscale e conservazione documentale/fatture.
- Test CARGOS reale con credenziali/ambiente ufficiale.
