#!/bin/sh
# Metadata only: never read runtime env contents or modify the host.
set -eu
staging_release_sha=${1:-}
[ "$#" -eq 1 ] && [ "${#staging_release_sha}" -eq 40 ] || exit 1
case "$staging_release_sha" in *[!0-9a-f]*) exit 1 ;; esac
reject() { echo 'Staging target preflight rejected unsafe filesystem or Docker ownership.' >&2; exit 1; }
check_path() {
  [ ! -L "$1" ] || reject
  if [ -e "$1" ]; then
    [ "$(realpath -e "$1")" = "$1" ] || reject
  fi
}
for staging_path in /opt/fleetum-staging /opt/fleetum-staging/app /opt/fleetum-staging/env /opt/fleetum-staging/postgres /opt/fleetum-staging/uploads /opt/fleetum-staging/logs; do
  [ -d "$staging_path" ] || reject
  check_path "$staging_path"
done
for staging_path in /opt/fleetum-staging/env/backend.env /opt/fleetum-staging/env/compose.env; do
  [ -f "$staging_path" ] || reject
  check_path "$staging_path"
done
for staging_path in /opt/fleetum-staging/deploy.lock /opt/fleetum-staging/app/deploy /opt/fleetum-staging/app/deploy/caddy /opt/fleetum-staging/app/deploy/caddy/Caddyfile.staging /opt/fleetum-staging/app/docker-compose.staging.yml /opt/fleetum-staging/app/.deploy-staging "/opt/fleetum-staging/app/.deploy-staging/$staging_release_sha"; do
  check_path "$staging_path"
done
staging_members=$(docker ps -a --filter label=com.docker.compose.project=fleetum-staging --format '{{.Names}}') || reject
for staging_member in $staging_members; do
  case "$staging_member" in fleetum_staging_backend|fleetum_staging_caddy|fleetum_staging_postgres) ;; *) reject ;; esac
done
for staging_member in fleetum_staging_backend fleetum_staging_caddy fleetum_staging_postgres; do
  if docker container inspect --format '{{.Id}}' "$staging_member" >/dev/null 2>&1; then
    [ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$staging_member")" = fleetum-staging ] || reject
  fi
done
for staging_network in fleetum_staging_private fleetum_staging_edge; do
  if docker network inspect --format '{{.Id}}' "$staging_network" >/dev/null 2>&1; then
    [ "$(docker network inspect --format '{{index .Labels "com.docker.compose.project"}}' "$staging_network")" = fleetum-staging ] || reject
  fi
done
echo 'Staging target filesystem and Docker ownership preflight accepted.'
