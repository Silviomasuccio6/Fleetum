# D09 API Contract + Integrazioni

Stato: PRESENTE-PARZIALE

## Evidenze repository
- API implementate via route/controller:
  - `/Users/silvio/Downloads/Gestione-Fermi-master-2/backend/src/interfaces/http/routes`
  - `/Users/silvio/Downloads/Gestione-Fermi-master-2/backend/src/interfaces/http/controllers`
- Integrazioni Google/Apple/Resend nel codice env+service.

## Gap
- OpenAPI/Swagger/Postman ufficiale: NON TROVATO
- Versioning API policy documentata: NON TROVATO
- Contratti errore standard formalizzati: NON TROVATO

## Remediation
- Must: OpenAPI 3.1 con schema request/response/error.
- Should: collection testabile per smoke API.
- Owner suggerito: Tech Lead
