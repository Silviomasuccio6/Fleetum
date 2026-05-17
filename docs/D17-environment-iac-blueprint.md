# D17 Environment + IaC Blueprint

Stato: PRESENTE-PARZIALE

## Evidenze repository
- Docker compose locale:
  - `/Users/silvio/Downloads/Gestione-Fermi-master-2/docker-compose.yml`
- Setup staging:
  - `/Users/silvio/Downloads/Gestione-Fermi-master-2/STAGING_SETUP.md`
- Nginx example:
  - `/Users/silvio/Downloads/Gestione-Fermi-master-2/deploy/nginx/fermi.conf.example`

## Gap
- IaC (Terraform/Ansible/Pulumi): NON TROVATO
- Blueprint ambienti dev/stage/prod con parametrizzazione completa: NON TROVATO

## Remediation
- Must: blueprint ambienti con configurazioni isolate.
- Should: IaC versione controllata.
- Owner suggerito: DevOps Engineer
