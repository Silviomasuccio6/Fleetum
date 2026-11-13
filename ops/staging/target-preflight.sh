#!/bin/sh
# Metadata only: never read runtime env contents or modify the host.
set -eu
staging_release_sha=${1:-}
[ "$#" -ge 1 ] && [ "$#" -le 3 ] && [ "${#staging_release_sha}" -eq 40 ] || exit 1
case "$staging_release_sha" in *[!0-9a-f]*) exit 1 ;; esac
staging_profile=${2:-dedicated}
case "$staging_profile" in dedicated|shared) ;; *) exit 1 ;; esac
staging_docker_mode=${3:-direct}
case "$staging_docker_mode" in direct|sudo) ;; *) exit 1 ;; esac
reject() { echo 'Staging target preflight rejected unsafe filesystem or Docker ownership.' >&2; exit 1; }
docker_metadata() {
  if [ "$staging_docker_mode" = sudo ]; then
    sudo -n docker "$@"
  else
    docker "$@"
  fi
}
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
if [ "$staging_profile" = shared ]; then
  # Read-only and self-contained: preparation is optional on later deployments.
  # Do not read env contents or rely on a mutable helper in the remote checkout.
  python3 - "$(id -u)" "$(id -g)" <<'PY' || reject
import os, pathlib, re, stat, sys

root = pathlib.Path("/opt/fleetum-staging")
uid, gid = map(int, sys.argv[1:])
def check(condition):
    if not condition:
        raise ValueError("Unsafe staging filesystem metadata.")
def metadata(path):
    return os.lstat(path)
check(uid > 0 and gid > 0)
anchor = metadata(root.parent)
identities = set()
for path in reversed(root.parents):
    value = metadata(path)
    check(stat.S_ISDIR(value.st_mode) and value.st_uid == 0 and not stat.S_IMODE(value.st_mode) & 0o022)
    identities.add((value.st_dev, value.st_ino))
for path, owner, mode in [(root, uid, 0o750), (root / "app", uid, 0o750),
                         (root / "env", uid, 0o700), (root / "postgres", 70, 0o700),
                         (root / "uploads", 1000, 0o750), (root / "logs", 1000, 0o750),
                         (root / "docker-config", uid, 0o700)]:
    value = metadata(path)
    identity = value.st_dev, value.st_ino
    check(stat.S_ISDIR(value.st_mode) and (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)) == (owner, gid, mode))
    check(value.st_dev == anchor.st_dev and identity not in identities)
    identities.add(identity)
check(not set(os.listdir(root)) - {"app", "env", "postgres", "uploads", "logs", "docker-config", "deploy.lock"})
for directory, names in [(root / "env", {"backend.env", "compose.env"}), (root / "docker-config", {"config.json"})]:
    check(not set(os.listdir(directory)) - names)
for path in [root / "env/backend.env", root / "env/compose.env", root / "deploy.lock", root / "docker-config/config.json"]:
    try:
        value = metadata(path)
    except FileNotFoundError:
        check(path.name not in {"backend.env", "compose.env"})
        continue
    owners = {(uid, gid)}
    if path == root / "docker-config/config.json":
        owners.add((0, 0))
    identity = value.st_dev, value.st_ino
    check(stat.S_ISREG(value.st_mode) and (value.st_uid, value.st_gid) in owners and stat.S_IMODE(value.st_mode) == 0o600 and value.st_nlink == 1)
    check(value.st_dev == anchor.st_dev and identity not in identities)
    identities.add(identity)
with open("/proc/self/mountinfo", encoding="utf8") as handle:
    for record in handle:
        fields = record.split()
        check(len(fields) >= 7)
        mount = pathlib.Path(re.sub(r"\\([0-7]{3})", lambda match: chr(int(match[1], 8)), fields[4]))
        check(mount == pathlib.Path("/") or not (mount == root or root in mount.parents or mount in root.parents))
PY
  [ -d /opt/fleetum-staging/docker-config ] || reject
  for staging_path in /opt/fleetum-staging/docker-config /opt/fleetum-staging/docker-config/config.json /opt/fleetum-staging/app/docker-compose.staging.shared.yml /opt/fleetum-staging/app/deploy/caddy/Caddyfile.staging-shared; do
    check_path "$staging_path"
    if [ -f "$staging_path" ]; then
      [ "$(stat -c '%h' "$staging_path")" = 1 ] || reject
    fi
  done
  for staging_path in /opt/fleetum-staging/env/backend.env /opt/fleetum-staging/env/compose.env /opt/fleetum-staging/deploy.lock; do
    if [ -e "$staging_path" ]; then
      [ -f "$staging_path" ] && [ "$(stat -c '%h' "$staging_path")" = 1 ] || reject
    fi
  done
fi
staging_members=$(docker_metadata ps -a --filter label=com.docker.compose.project=fleetum-staging --format '{{.Names}}') || reject
if [ "$staging_profile" = shared ]; then
  staging_existing_networks=$(docker_metadata network ls --format '{{.Name}}') || reject
fi
for staging_member in $staging_members; do
  case "$staging_member" in fleetum_staging_backend|fleetum_staging_caddy|fleetum_staging_postgres) ;; *) reject ;; esac
done
for staging_member in fleetum_staging_backend fleetum_staging_caddy fleetum_staging_postgres; do
  if docker_metadata container inspect --format '{{.Id}}' "$staging_member" >/dev/null 2>&1; then
    [ "$(docker_metadata inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$staging_member")" = fleetum-staging ] || reject
    if [ "$staging_profile" = dedicated ] && [ "$staging_member" = fleetum_staging_caddy ]; then
      # A default/omitted workflow choice cannot detach an active shared proxy.
      staging_active_ingress=$(docker_metadata inspect --format '{{if index .NetworkSettings.Networks "fleetum_staging_ingress"}}shared{{end}}' "$staging_member") || reject
      [ "$staging_active_ingress" != shared ] || reject
    fi
    if [ "$staging_profile" = shared ]; then
      [ "$(docker_metadata inspect --format '{{len .HostConfig.PortBindings}}' "$staging_member")" = 0 ] || reject
      staging_networks=$(docker_metadata inspect --format '{{range $name, $value := .NetworkSettings.Networks}}{{printf "%s\n" $name}}{{end}}' "$staging_member") || reject
      case "$staging_member" in
        fleetum_staging_backend|fleetum_staging_postgres)
          [ "$staging_networks" = fleetum_staging_private ] || reject
          ;;
        fleetum_staging_caddy)
          staging_private_seen=false
          staging_ingress_seen=false
          for staging_network in $staging_networks; do
            case "$staging_network" in
              fleetum_staging_private) [ "$staging_private_seen" = false ] || reject; staging_private_seen=true ;;
              fleetum_staging_ingress) [ "$staging_ingress_seen" = false ] || reject; staging_ingress_seen=true ;;
              *) reject ;;
            esac
          done
          [ "$staging_private_seen" = true ] && [ "$staging_ingress_seen" = true ] || reject
          staging_aliases=$(docker_metadata inspect --format '{{with index .NetworkSettings.Networks "fleetum_staging_ingress"}}{{range .Aliases}}{{printf "%s\n" .}}{{end}}{{end}}' "$staging_member") || reject
          staging_alias_seen=false
          for staging_alias in $staging_aliases; do
            if [ "$staging_alias" = fleetum-staging-ingress ]; then staging_alias_seen=true; fi
          done
          [ "$staging_alias_seen" = true ] || reject
          ;;
      esac
    fi
  elif [ "$staging_profile" = shared ] || [ "$staging_member" = fleetum_staging_caddy ]; then
    for staging_existing_member in $staging_members; do
      [ "$staging_existing_member" != "$staging_member" ] || reject
    done
  fi
done
for staging_network in fleetum_staging_private fleetum_staging_edge; do
  if docker_metadata network inspect --format '{{.Id}}' "$staging_network" >/dev/null 2>&1; then
    [ "$(docker_metadata network inspect --format '{{index .Labels "com.docker.compose.project"}}' "$staging_network")" = fleetum-staging ] || reject
    if [ "$staging_profile" = shared ] && [ "$staging_network" = fleetum_staging_private ]; then
      [ "$(docker_metadata network inspect --format '{{.Internal}}' "$staging_network")" = true ] || reject
    fi
  elif [ "$staging_profile" = shared ]; then
    for staging_existing_network in $staging_existing_networks; do
      [ "$staging_existing_network" != "$staging_network" ] || reject
    done
  fi
done
if [ "$staging_profile" = shared ] && docker_metadata network inspect --format '{{.Id}}' fleetum_staging_ingress >/dev/null 2>&1; then
  [ "$(docker_metadata network inspect --format '{{index .Labels "com.fleetum.environment"}}' fleetum_staging_ingress)" = staging ] || reject
  [ "$(docker_metadata network inspect --format '{{index .Labels "com.fleetum.purpose"}}' fleetum_staging_ingress)" = shared-ingress ] || reject
  [ "$(docker_metadata network inspect --format '{{.Driver}}' fleetum_staging_ingress)" = bridge ] || reject
  [ "$(docker_metadata network inspect --format '{{.Internal}}' fleetum_staging_ingress)" = true ] || reject
  [ "$(docker_metadata network inspect --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}' fleetum_staging_ingress)" = 10.203.91.0/28 ] || reject
  [ "$(docker_metadata network inspect --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}' fleetum_staging_ingress)" = 10.203.91.1 ] || reject
  staging_ingress_members=$(docker_metadata network inspect --format '{{range .Containers}}{{printf "%s\n" .Name}}{{end}}' fleetum_staging_ingress) || reject
  for staging_member in $staging_ingress_members; do
    case "$staging_member" in
      fleetum_caddy) staging_ip=10.203.91.2 ;;
      fleetum_staging_caddy) staging_ip=10.203.91.3 ;;
      *) reject ;;
    esac
    [ "$(docker_metadata inspect --format '{{with index .NetworkSettings.Networks "fleetum_staging_ingress"}}{{.IPAddress}}{{end}}' "$staging_member")" = "$staging_ip" ] || reject
  done
elif [ "$staging_profile" = shared ]; then
  # This external network is provisioned separately. Never migrate first and
  # discover at Compose up that the selected shared ingress cannot exist.
  reject
fi
echo 'Staging target filesystem and Docker ownership preflight accepted.'
