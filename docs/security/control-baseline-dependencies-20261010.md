# Dependency correction for the isolated staging controls

Base: `7f8f4a574ca55a8cf45a8768aebe312a529105f0`, PR145. Its initial CI failed
at the production audit with inherited high/critical findings. This correction
updates the relevant dependency graph without importing the application
candidate PR144, changing schema/migrations, or adopting a UI redesign.

## Changes and compatibility

- Axios 1.20.0, Morgan 1.12.1, CSV Parse 7.0.2 and Sharp 0.35.5 resolve the
  production advisories identified in the baseline audit.
- React Router 7.18.3 resolves the navigation advisories. Public prerendering
  imports the supported `StaticRouter` export from `react-router-dom`; the
  application's routes and guards keep their existing behavior.
- Prisma CLI/client remain 6.19.3. Its `deepmerge-ts` dependency is pinned to
  8.0.2 rather than downgrading Prisma or changing the database schema.
- Root overrides select patched `proxy-addr`, `body-parser`, `qs`, `uuid`,
  Sharp, esbuild, source-map-js, postcss-selector-parser and shell-quote.
  UUID 11.1.1 preserves the CommonJS loading used by ExcelJS.
- Next and eslint-config-next use 16.3.8. The historical candidate's 16.3.4
  is insufficient for the current advisories; this correction is evaluated
  against the current reports rather than a previous green run.
- The lock preserves resolved direct versions of Stripe, Resend, cron,
  Helmet, form handling and Playwright. Build packages with actual advisories
  are updated within their declared ranges. No forced audit fix is used.

The npm lock must agree with the installed graph and the declared manifests.
A successful install alone does not prove that overrides took effect: verify
with `npm ls` and the real module loaded by each consumer. Clean installation
also needs the optional platform packages used by Linux CI and builds.

## Audit and tests

The old ExcelJS exception is retired. The production audit rejects every
high/critical finding and rejects malformed, inconsistent or unavailable npm
evidence; its tests run the actual script with only process spawning mocked.

The proxy regression resolves the actual package from Express and reproduces
the IPv4-mapped trust-subnet bypass before the patch. Synthetic compatibility
tests cover CSV quoting/prototype handling, ExcelJS XLSX export/import,
Morgan log escaping, native Sharp rendering and nested route matching.
Existing auth, file-security and operation tests remain in the release gates.

Required verification: clean `npm ci`, real dependency-tree inspection,
operations tests, `npm run verify:release`, and `npm run verify:database` on
temporary PostgreSQL only. Report production and complete/build audits
separately; neither a skipped CI job nor a historical result is a pass.

## Open build finding

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
affects braces 3.0.3 with no compatible published patched version in the
advisory. It propagates through the development-only Tailwind 3/glob and
Next lint dependency graph. No high/critical production exception is added.

The reviewed build consumes repository CSS and fixed glob configuration,
not tenant-uploaded patterns. This bounds the observed usage; it does not
prove that the dependency is safe with arbitrary untrusted repository inputs.
Replacing Tailwind 3 or the lint/glob stack is a separate compatibility change
and must preserve the existing visual output. Full audit remains nonzero
until that dependency is removed or an upstream patch is verified.

## Impact and rollback

No provider, secret, production configuration, database migration or live
environment changes are required. The manual release trigger, approval/pins,
source proof, SSH trust and shared-ingress safeguards remain unchanged.
The controls-only CI still cannot authorize an application release without
the complete six-gate source proof.

Rollback is a coordinated revert of manifests, lock, StaticRouter import and
audit documentation. It restores known vulnerable dependencies and is not a
security-safe release candidate. Never revert the production/ingress controls
or reintroduce their automatic deployment trigger as part of this rollback.
