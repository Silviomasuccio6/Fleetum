# Fleetum Production Deploy

## VPS

- OS: Ubuntu 24.04 LTS
- User deploy: `fleetum`
- App root: `/opt/fleetum/app`
- Env root: `/opt/fleetum/env`
- Backups: `/opt/fleetum/backups`

## DNS richiesti

Tutti i record devono puntare all'IPv4 della VPS:

```text
A     fleetum.it            57.131.47.124
A     www.fleetum.it        57.131.47.124
A     api.fleetum.it        57.131.47.124
A     platform.fleetum.it   57.131.47.124
```

## Avvio

```bash
cd /opt/fleetum/app
docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.yml up -d --build
```

## Healthcheck

```bash
curl -fsS https://api.fleetum.it/api/health
curl -fsS https://platform.fleetum.it/platform-api/health
```

## Backup database

```bash
/opt/fleetum/app/ops/backup-db-prod.sh
```

## Note sicurezza

- Non mettere chiavi live in repository.
- `backend.env` deve stare solo in `/opt/fleetum/env/backend.env`.
- `compose.env` deve stare solo in `/opt/fleetum/env/compose.env`.
- `platform.fleetum.it` richiede `PLATFORM_ALLOWED_IPS` configurato con gli IP autorizzati.
