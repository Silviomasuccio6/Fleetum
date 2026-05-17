# Privacy Technical Controls

Stato: BOZZA TECNICA

Owner: Security Engineer + Tech Lead

Ultimo aggiornamento: 2026-05-05

## 1. Scopo

Mappare i controlli tecnici richiesti per proteggere dati personali, documenti, contratti e allegati nel gestionale.

## 2. Controlli minimi

| Area | Controllo | Stato | Evidenza / nota |
|---|---|---:|---|
| Autenticazione | sessione via cookie HttpOnly, non token persistenti nel browser | PARZIALE | patch recente su auth; verificare produzione Secure/SameSite |
| CSRF | token CSRF per mutazioni | PRESENTE-PARZIALE | verificare coverage endpoint |
| RBAC | ruoli e permessi applicativi | PARZIALE | serve matrice aggiornata e test |
| Tenant isolation | query filtrate per tenantId | PARZIALE | servono test automatici IDOR |
| Audit log | operazioni critiche tracciate | PRESENTE-PARZIALE | download/upload/delete documenti rafforzati; completare coverage business |
| Upload file | limite size, mime e magic-byte | PRESENTE-PARZIALE | aggiunto controllo PDF/Office/EICAR; collegare antivirus reale in prod |
| Download file | autorizzazione prima del download + audit | PRESENTE-PARZIALE | audit aggiunto sui download documentali principali |
| Storage allegati | filesystem applicativo | RISCHIO | valutare object storage privato cifrato |
| Log privacy | redaction dati sensibili | DA VERIFICARE | evitare CF, documenti, token, path sensibili |
| Cifratura transito | TLS in produzione | NON VERIFICABILE | dipende dal deploy |
| Cifratura riposo | DB/storage cifrati | NON VERIFICABILE | dipende da infrastruttura |
| Retention | job/API/script cancellazione dati | PRESENTE-PARZIALE | dry-run/run e cron opzionale; validare policy definitiva |
| Backup/restore | backup cifrati e restore test | NON VERIFICABILE | richiesto pre-produzione |
| Link condivisibili | scadenza/revoca/audit | PRESENTE-PARZIALE | link contratto con scadenza, audit download e revoca logica WhatsApp |

## 3. Eventi da auditare

| Evento | Priorita | Campi audit consigliati |
|---|---:|---|
| Login/logout/fallimenti | P0 | actor, tenant, ip hash, user agent, esito |
| Creazione/modifica cliente | P0 | actor, tenant, customerId, campi modificati non sensibili |
| Upload documento cliente | P0 | actor, tenant, attachmentId, mime, size, esito |
| Download documento cliente | P0 | actor, tenant, attachmentId, esito |
| Generazione contratto | P0 | actor, tenant, bookingId, contractId |
| Invio email/WhatsApp contratto | P0 | actor, tenant, channel, esito, recipient mascherato |
| Firma contratto | P0 | actor/cliente, tenant, contractId, metodo |
| Export CSV/XLSX/PDF | P1 | actor, tenant, tipo export, filtri, conteggio righe |
| Cancellazione/anonymizzazione | P0 | actor, tenant, entityId, tipo azione |
| Accesso platform admin | P0 | actor, tenant target, motivo, esito |

## 4. Requisiti privacy-by-design backlog

| ID | Requisito | Priorita | Done quando |
|---|---|---:|---|
| PTC-01 | Test tenant isolation su API sensibili | P0 | test fallisce se tenant A legge dati tenant B |
| PTC-02 | Retention job dati/documenti | P0 -> P1 | script + cron opzionale + dry-run disponibili |
| PTC-03 | Audit download/export | P0 -> P1 | download documenti tracciati; completare export business specifici |
| PTC-04 | Storage privato allegati | P1 | file non sono serviti staticamente senza auth |
| PTC-05 | Antivirus upload | P1 | EICAR test bloccato localmente; collegare AV reale in produzione |
| PTC-06 | Magic-byte validation | P1 -> PASS locale | PDF/Office/immagini/testi validati |
| PTC-07 | Redaction log | P1 | test snapshot log senza CF/documenti/token |
| PTC-08 | Link contratto a scadenza | P0 -> P1 | link scade, auditato e revocabile per share WhatsApp |
| PTC-09 | DSR export/cancellazione | P1 -> PASS locale parziale | export/anonymization cliente noleggio disponibili |

## 5. Gate produzione privacy

La produzione non dovrebbe essere autorizzata finche i controlli P0 non sono:

- implementati;
- testati;
- documentati;
- accettati da DPO/Legal.
