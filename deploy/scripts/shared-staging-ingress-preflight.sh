#!/usr/bin/env bash
# Metadata only; this guard creates no network and changes no container or file.
set -euo pipefail
reject() { echo 'Shared staging ingress metadata rejected.' >&2; exit 2; }
[ "$#" -eq 0 ] || reject
if ! docker network inspect --format '{"name":{{json .Name}},"driver":{{json .Driver}},"internal":{{json .Internal}},"ipam":{{json .IPAM.Config}},"labels":{{json .Labels}},"members":{{json .Containers}}}' fleetum_staging_ingress 2>/dev/null |
  python3 -c '
import json, re, sys
try:
    raw = sys.stdin.buffer.read(131073)
    if len(raw) > 131072: raise ValueError()
    data = json.loads(raw)
    if data["name"] != "fleetum_staging_ingress" or data["driver"] != "bridge" or data["internal"] is not True: raise ValueError()
    ipam = data["ipam"]
    if not isinstance(ipam, list) or len(ipam) != 1: raise ValueError()
    if ipam[0]["Subnet"] != "10.203.91.0/28" or ipam[0]["Gateway"] != "10.203.91.1" or ipam[0].get("IPRange") not in (None, ""): raise ValueError()
    labels = data["labels"]
    if labels["com.fleetum.environment"] != "staging" or labels["com.fleetum.purpose"] != "shared-ingress": raise ValueError()
    members = data["members"]
    if not isinstance(members, dict) or len(members) > 2: raise ValueError()
    expected = {"fleetum_caddy": "10.203.91.2/28", "fleetum_staging_caddy": "10.203.91.3/28"}
    names = set()
    for identifier, member in members.items():
        if not re.fullmatch(r"[0-9a-f]{64}", identifier): raise ValueError()
        name = member["Name"]
        if name not in expected or name in names or member["IPv4Address"] != expected[name] or member.get("IPv6Address") not in (None, ""): raise ValueError()
        names.add(name)
    # Either single canonical Caddy is allowed so gateway recreation can recover.
except Exception:
    sys.exit(1)
'; then reject; fi
echo 'Shared staging ingress metadata accepted.'
