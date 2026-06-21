# D12 IAM/RBAC Matrix + SoD

Stato: PRESENTE-PARZIALE

## Evidenze repository
- Ruoli/permessi in seed e middleware:
  - `backend/prisma/seed.ts`
  - `backend/src/interfaces/http/middlewares/permissions.ts`
  - `backend/src/interfaces/http/routes`

## Gap
- Matrice IAM ufficiale per modulo e azione: NON TROVATO
- SoD (segregation of duties) policy documentata: NON TROVATO
- Revisione periodica accessi: NON TROVATO

## Remediation
- Must: IAM matrix per ruolo -> endpoint -> azioni.
- Must: SoD policy su operazioni economiche/contratti.
- Owner suggerito: Security Engineer + PM
