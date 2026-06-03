# Fleetum GDPR Technical Checklist

> Documento tecnico, non consulenza legale. Le bozze e le scelte operative vanno validate con professionisti privacy/GDPR, legale e sicurezza.

## Endpoint Implementati

- [x] `POST /api/gdpr/erasure-request`
- [x] `GET /api/gdpr/data-export/:customerId`
- [x] Endpoint legacy mantenuti: `/api/privacy/data-subjects/customers/:customerId/export`
- [x] Endpoint legacy mantenuti: `/api/privacy/data-subjects/customers/:customerId/anonymize`

## Right To Erasure

- [x] La cancellazione cliente usa anonimizzazione, non hard delete dei booking.
- [x] Le prenotazioni storiche restano disponibili senza PII diretta del cliente.
- [x] I campi snapshot booking vengono ripuliti: nome anonimizzato, email/telefono/documento rimossi.
- [x] I contratti collegati vengono preservati e i campi email/body/error sensibili vengono ripuliti.
- [x] Gli allegati cliente vengono cancellati di default dallo storage.
- [x] La richiesta viene tracciata con audit action `DATA_SUBJECT_ERASURE_REQUESTED`.
- [x] L'esecuzione viene tracciata con audit action `DATA_SUBJECT_ANONYMIZED`.
- [ ] Validare con consulente privacy quali allegati possono/devono essere conservati per obblighi specifici.
- [ ] Validare con commercialista/legal quali dati fiscali devono restare disponibili e per quanto.

## Data Export

- [x] L'export restituisce JSON con dati cliente, allegati metadata e booking/contratti collegati.
- [x] L'export filtra per `tenantId`.
- [x] L'export scrive audit action `DATA_SUBJECT_EXPORT`.
- [ ] Valutare export scaricabile come file firmato/temporaneo se il payload diventa grande.
- [ ] Valutare mascheramento selettivo per operatori non admin.

## Consent Log

- [x] Aggiunto model Prisma `ConsentLog`.
- [x] Il modello supporta tenant, customerId, userId, subject, tipo consenso, granted/revoked, canale, source, IP, user-agent, documento/versione e metadata.
- [ ] Collegare `ConsentLog` ai flussi marketing reali quando vengono attivati.
- [ ] Loggare revoca consenso con `granted=false`.
- [ ] Evitare invii marketing se manca un consenso valido.

## Privacy By Design

- [x] Campi PII annotati nello schema Prisma con `/// @pii`.
- [x] Script report PII disponibile:

```bash
npm run privacy:pii-report -w backend
```

- [ ] Rieseguire il report PII a ogni nuova migration o nuovo modello dati.
- [ ] Aggiungere review obbligatoria quando una PR introduce nuovi campi PII.
- [ ] Evitare PII nei log applicativi e nei dettagli audit dove non necessaria.
- [ ] Verificare che file upload/documenti siano privati e accessibili solo con auth o URL firmati.

## Tenant Isolation

- [x] Endpoint GDPR protetti da auth tenant.
- [x] Query export/anonymize filtrate per `tenantId`.
- [x] Azioni di erasure richiedono permesso `users:write`.
- [x] Export richiede permesso `vehicles:read`, coerente con le route privacy esistenti.
- [ ] Valutare permessi dedicati futuri: `privacy:read`, `privacy:write`, `privacy:export`.

## Retention

- [x] Job/script retention esistenti per token/sessioni/allegati clienti cancellati.
- [x] Preview retention disponibile prima dell'esecuzione.
- [ ] Definire tempi retention finali con consulente privacy/legal/commercialista.
- [ ] Documentare retention per contratti, documenti identità, patenti, foto danni, pagamenti e audit log.

## Verifiche Tecniche

- [ ] `npm run prisma:deploy -w backend` applica la migration `ConsentLog`.
- [ ] `npm run prisma:generate -w backend` aggiorna Prisma Client.
- [ ] `npm run lint -w backend` passa.
- [ ] `npm run build -w backend` passa.
- [ ] Test manuale export cliente su tenant demo.
- [ ] Test manuale erasure cliente su tenant demo.
- [ ] Verifica audit log dopo export/erasure.
