#!/usr/bin/env bash
# Trusted workflow control; credential JSON, if requested, is consumed via stdin only.
set -euo pipefail
reject() { echo 'Staging deploy controls rejected.' >&2; exit 1; }
[ "$#" -eq 6 ] || reject
release_sha=$1
backend_image=$2
frontend_image=$3
ingress_mode=$4
bootstrap=$5
docker_mode=$6
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || reject
[[ "$backend_image" =~ ^ghcr\.io/silviomasuccio6/fleetum-backend@sha256:[0-9a-f]{64}$ ]] || reject
[[ "$frontend_image" =~ ^ghcr\.io/silviomasuccio6/fleetum-frontend@sha256:[0-9a-f]{64}$ ]] || reject
case "$ingress_mode" in dedicated|shared) ;; *) reject ;; esac
case "$bootstrap" in true|false) ;; *) reject ;; esac
case "$docker_mode" in direct|sudo) ;; *) reject ;; esac
# Reserve the credential stream exclusively for the bootstrap, even when Compose
# defaults to interactive stdin for a non-TTY migration container.
exec 3<&0
exec 0</dev/null
umask 077
app=/opt/fleetum-staging/app
bundle="$app/.deploy-staging/$release_sha"
[ -f "$bundle/trusted-preflight.sh" ] || reject
[ -f "$bundle/docker-compose.staging.yml" ] && [ -d "$bundle/deploy" ] || reject
if [ "$ingress_mode" = shared ]; then
  [ -f "$bundle/docker-compose.staging.shared.yml" ] || reject
fi
[ -d /opt/fleetum-staging/docker-config ] || reject
cd "$app"
exec 9>/opt/fleetum-staging/deploy.lock
flock -n 9 3<&-
# Repeat the trusted metadata guard under the lock before promoting any manifests.
sh "$bundle/trusted-preflight.sh" "$release_sha" "$ingress_mode" "$docker_mode" 3<&-
rsync -a "$bundle/docker-compose.staging.yml" "$app/docker-compose.staging.yml" 3<&-
if [ "$ingress_mode" = shared ]; then
  rsync -a "$bundle/docker-compose.staging.shared.yml" "$app/docker-compose.staging.shared.yml" 3<&-
fi
rsync -a "$bundle/deploy/" "$app/deploy/" 3<&-
export FLEETUM_BACKEND_IMAGE="$backend_image" FLEETUM_FRONTEND_IMAGE="$frontend_image"
docker_command=(docker --config /opt/fleetum-staging/docker-config)
if [ "$docker_mode" = sudo ]; then docker_command=(sudo -n docker --config /opt/fleetum-staging/docker-config); fi
compose_args=(--project-name fleetum-staging --env-file /opt/fleetum-staging/env/compose.env -f docker-compose.staging.yml)
if [ "$ingress_mode" = shared ]; then compose_args+=(-f docker-compose.staging.shared.yml); fi
staging_compose() { "${docker_command[@]}" compose "${compose_args[@]}" "$@" 3<&-; }
staging_compose pull
staging_compose run --rm -T backend sh -c 'node dist/shared/config/env.js && npx prisma migrate deploy --schema prisma/schema.prisma'
if [ "$bootstrap" = true ]; then
  # Never place the credentials in argv, an env file, a temporary file or logs.
  staging_compose run --rm -T backend node dist/scripts/staging-bootstrap.js <&3 3<&-
fi
exec 3<&-
staging_compose up -d --no-build
# Retain the lock through the first readiness checks; failed health never restores DB automatically.
ready=false
for attempt in {1..12}; do
  if curl --fail --silent --show-error --max-time 20 --output /dev/null https://api-staging.fleetum.it/api/ready; then ready=true; break; fi
  sleep 5
done
[ "$ready" = true ] || { echo 'Staging readiness failed; retain evidence and review recovery.' >&2; exit 1; }
curl --fail --silent --show-error --max-time 20 --output /dev/null https://staging.fleetum.it/
curl --fail --silent --show-error --max-time 20 --output /dev/null https://platform-staging.fleetum.it/platform-api/health
echo 'Staging deployment and readiness completed.'
