# Production dependency audit exceptions

## Policy

Fleetum fails CI for every high or critical production dependency advisory.
`ops/audit-production-dependencies.mjs` rejects unavailable, malformed or
inconsistent npm audit reports as well. There is no active allowlist.

An exception must:

1. identify one advisory ID;
2. be restricted to the expected transitive dependency path;
3. include a technical risk assessment;
4. be reviewed whenever the parent package is upgraded;
5. have a review deadline.

## Active exceptions

None.

## Retired exception

### `GHSA-mh99-v99m-4gvg` - `brace-expansion`

Retired in the isolated control-baseline dependency correction on 2026-10-10.
The archive dependency graph resolves to patched `brace-expansion` versions;
ExcelJS export/import and clean-install compatibility are verified separately.
The previously scheduled review deadline was 2026-10-31. No new exception is
introduced: future high/critical production advisories always block the gate.

The complete audit of development/build packages is reported separately. An
upstream package without a compatible patched version remains an open finding;
it must not be described as fixed by a production-only audit.
