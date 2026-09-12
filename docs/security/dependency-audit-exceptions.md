# Production dependency audit exceptions

## Policy

Fleetum fails CI for every high or critical production dependency advisory
unless it appears in the exact allowlist implemented by
`ops/audit-production-dependencies.mjs`.

An exception must:

1. identify one advisory ID;
2. be restricted to the expected transitive dependency path;
3. include a technical risk assessment;
4. be reviewed whenever the parent package is upgraded;
5. have a review deadline.

## Active exceptions

None.

## Retired exceptions

### `GHSA-mh99-v99m-4gvg` - `brace-expansion`

Retired on 2026-09-12 after the ExcelJS archive dependency tree resolved to
patched `brace-expansion` releases. The production audit allowlist was removed
at the same time, so every future high or critical production advisory blocks
the release gate.
