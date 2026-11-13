# Dependency security remediation - 2026-09-12

## Scope

This tranche updates the dependency graph inherited from commit
`772c15013e93949469949c7e09600b22d5089987`. It changes no production
configuration, provider integration, secret, database schema, or user data.

## Findings and resolution

The initial production audit reported 14 advisories: 5 high and 9 moderate.
After the production fixes, the first full audit of development and build
dependencies still reported 13 advisories: 3 critical, 6 high, 1 moderate, and
3 low.

The remediation updates the affected direct packages and their lockfile graph:

- `sharp` 0.35.4, `morgan` 1.12.1, and `csv-parse` 7.0.2 in the backend;
- `react-router-dom` 7.18.3 in the frontend, with the supported `StaticRouter`
  import used by public-page prerendering;
- Next.js and `eslint-config-next` 16.3.4 in the website;
- patched transitive versions for `body-parser`, `qs`, `deepmerge-ts`,
  `follow-redirects`, `uuid`, `brace-expansion`, and the build toolchain;
- `esbuild` 0.28.1 pinned at the workspace root because both Vite and `tsx`
  consume it and the preceding 0.27.3 release was the last remaining advisory.

`uuid` is pinned to 11.1.1 because ExcelJS still loads it through CommonJS.
The later ESM-only major release would introduce an avoidable runtime risk.
Prisma remains on 6.19.3; its `deepmerge-ts` dependency is overridden to 8.0.2
and was validated by client generation, schema validation, unit tests, and the
temporary PostgreSQL gate.

The previous ExcelJS exception for `GHSA-mh99-v99m-4gvg` is retired. The audit
script now rejects every high or critical production advisory without an
allowlist.

## Verification

All checks used Node.js 22.23.1 and npm 10. The dependency graph was evaluated
without application secrets or personal data.

- Full npm audit: 0 vulnerabilities across production and development packages.
- Production dependency audit: no high or critical findings.
- Clean-install dry run passed for the local platform and Linux x64; the lockfile
  records all 26 optional `esbuild` platform packages at 0.28.1.
- Release gate: lint and builds passed for backend, frontend, and website.
- Tests: backend 173/173, frontend 20/20, website 9/9.
- Public prerender verification: 13 pages and SEO discovery assets.
- PostgreSQL 16 temporary gate: 43 migrations, 35 exact-money fields, 13
  dual-write tables, and 9/9 persistent security tests passed.
- Diff whitespace check: passed.

The Vite build emits a forward-looking configuration warning about its future
native config loader. It does not affect the current Vite 8.3.0 build and is
tracked separately from this security remediation.

## Rollback

Rollback is a source-only revert of this tranche followed by a clean
`npm ci` using the restored lockfile. No database rollback or data migration is
required. Reverting also restores the vulnerable dependency graph, so a rollback
must not be released without a replacement remediation and a new audit.
