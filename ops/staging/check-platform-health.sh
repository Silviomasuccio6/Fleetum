#!/usr/bin/env bash
# Trusted staging-only control. Strict Platform deliberately rejects public health.
set -euo pipefail
reject() { echo 'Staging Platform health verification failed.' >&2; exit 1; }
[ "$#" -eq 1 ] || reject
case "$1" in
  direct) docker_command=(docker --config /opt/fleetum-staging/docker-config) ;;
  sudo) docker_command=(sudo -n docker --config /opt/fleetum-staging/docker-config) ;;
  *) reject ;;
esac
exec 0</dev/null
# Probe only the staging backend's loopback; no IP/header spoofing or guard bypass.
"${docker_command[@]}" exec fleetum_staging_backend node -e '
(async () => {
  const response = await fetch("http://127.0.0.1:4100/platform-api/health", { signal: AbortSignal.timeout(10000) });
  if (response.status !== 200) throw new Error();
  const body = await response.json();
  if (body?.ok !== true || body?.service !== "fleetum-platform-api") throw new Error();
})().catch(() => { console.error("Staging Platform loopback health failed."); process.exitCode = 1; });
' || reject
# TLS/routing must reach the actual strict allowlist, not just any 403 response.
response=$(curl --silent --show-error --max-time 20 --max-filesize 4096 \
  --write-out $'\n%{http_code}' https://platform-staging.fleetum.it/platform-api/health) || reject
[ "${response##*$'\n'}" = 403 ] || reject
printf '%s' "${response%$'\n'*}" | "${docker_command[@]}" exec -i fleetum_staging_backend node -e '
try {
  const input = require("node:fs").readFileSync(0, "utf8");
  if (input.length > 4096 || JSON.parse(input)?.error !== "PLATFORM_IP_FORBIDDEN") throw new Error();
} catch {
  console.error("Staging Platform strict public denial failed."); process.exitCode = 1;
}
' || reject
echo 'Staging Platform health and strict public denial verified.'
