# Fleetum VPS Security Maintenance

## Scope

This procedure applies to approved Ubuntu security updates that require a VPS reboot. It protects
Fleetum data and availability without changing tenant data, billing, authentication or application
configuration.

## Preconditions

- A 10-minute low-traffic maintenance window is agreed.
- No production deployment or Prisma migration is running.
- PostgreSQL and uploads backups completed successfully and are reachable offsite.
- `/api/ready`, the landing page and the Platform Console are healthy before maintenance.
- Docker and cron are enabled for automatic startup.

## Execution

```bash
sudo apt update
sudo apt upgrade
sudo reboot
```

Do not combine OS updates with application deploys. Record the exact UTC start time before reboot.

## Post-Reboot Verification

```bash
systemctl is-active docker
systemctl is-active cron
docker ps
curl -fsS https://api.fleetum.it/api/ready
curl -fsS https://fleetum.it/
curl -fsS https://platform.fleetum.it/
```

Confirm normal Platform login, tenant login and a read-only booking lookup. Record the UTC end
time and compute downtime from the start/end timestamps.

## Rollback Decision

- Host unreachable: use provider console and boot diagnostics.
- Docker/application unhealthy after host recovery: use the Fleetum application rollback script.
- Kernel regression: boot the previous kernel from the bootloader or provider recovery console.
- Database restore is not a rollback for an OS update and must not be used unless data corruption
  is independently confirmed.
