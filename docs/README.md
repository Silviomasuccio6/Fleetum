# Fleetum Documentation

Questa cartella raccoglie documentazione prodotto, tecnica, operativa, privacy e deployment del SaaS Fleetum.

## Documentazione tecnica corrente

- [Technical Documentation](./technical/README.md): architettura reale, moduli, API, sito pubblico e recupero password Platform.
- [Project Map](./architecture/project-map.md): mappa rapida repository.
- [API Contract and Integrations](./D09-api-contract-integrazioni.md): governance API e riferimenti al catalogo.
- [Deployment](./deployment/production-deploy.md): deploy produzione.
- [Runbook](../RUNBOOK.md): operativita VPS, backup, rollback e incident response.

## Documentazione prodotto e readiness

- [D01 Project Charter + Business Case](./D01-project-charter-business-case.md)
- [D02 Stakeholder Register + RACI](./D02-stakeholder-register-raci.md)
- [D03 Product Vision + KPI](./D03-product-vision-kpi.md)
- [D04 BRD + Processi To-Be](./D04-brd-processi-to-be.md)
- [D05 SRS User Stories + AC](./D05-srs-user-stories-ac.md)
- [D06 NFR](./D06-nfr.md)
- [D07 Data Dictionary + Data Lifecycle](./D07-data-dictionary-data-lifecycle.md)
- [D08 Architettura + ADR](./D08-architettura-adr.md)
- [D10 UX UI Spec + Design System](./D10-ux-ui-design-system.md)
- [D11 Security Plan + Threat Model](./D11-security-plan-threat-model.md)
- [D12 IAM RBAC Matrix + SoD](./D12-iam-rbac-sod.md)
- [D13 Privacy Pack](./D13-privacy-pack.md)
- [D14 Compliance Matrix fiscale legale](./D14-compliance-fiscale-legale.md)
- [D15 Test Strategy + Master Test Plan](./D15-test-strategy-master-test-plan.md)
- [D16 CI CD + Quality Gates](./D16-cicd-quality-gates.md)
- [D17 Environment + IaC Blueprint](./D17-environment-iac-blueprint.md)
- [D18 Observability Plan](./D18-observability-plan.md)
- [D19 Backup + DR Plan](./D19-backup-dr-plan.md)
- [D20 Incident Response + Data Breach Playbook](./D20-incident-response-data-breach.md)
- [D21 Go-Live Plan + Cutover Book](./D21-go-live-cutover-book.md)
- [D22 Runbook Operativo + SOP Supporto](./D22-runbook-operativo-sop-supporto.md)
- [D23 Training Plan + Handover](./D23-training-plan-handover.md)
- [D24 Post-Go-Live Review + Improvement Backlog](./D24-post-go-live-review.md)

## Regole

- Non inserire segreti, password reali, dati cliente o chiavi API.
- Aggiornare la documentazione tecnica nello stesso PR di route, flussi o infrastruttura modificati.
- I documenti in `legal/` restano bozze da validare da professionisti qualificati.
