# Local braces patch for Fleetum build tools — 2026-10-10

## Why this change

The current registry releases of braces, micromatch, fast-glob, Tailwind 3 and
the Next lint plugin still include the unpatched braces dependency.
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
lists no patched release; [upstream issue70](https://github.com/micromatch/braces/issues/70)
contains the report and the maintainer's disagreement about exposure when
patterns are trusted. On Fleetum's Node22.23.1, our tests reproduce recursive
stack exhaustion with input below the existing10000character cap.

Rather than migrating the UI framework or dropping Next lint rules, this change
replaces the vulnerable implementation with a source-reviewed local patch.
Tailwind3.4.19, Next16.3.8 and every other resolved version remain unchanged.
The application source, CSS, Tailwind config, routes, schema and migrations
remain unchanged. Full frontend PostCSS output is compared byte for byte.

## Origin, identity and installation

- Upstream: braces3.0.3, MIT license retained without changes.
- Origin: official npm tarball, SHA512 checked against registry metadata.
- Local name/version: `@fleetum/braces@3.0.3-fleetum.2`.
- This is **not an upstream release** and is not published to npm.
- Readable sources: `vendor/braces`; origin/hash/limits: `SOURCE.json`.
- Immutable archive: `vendor/fleetum-braces-3.0.3-fleetum.2.tgz`.
- Root devDependency `braces` points to that archive; `overrides.braces=$braces`
  applies it to all consumers, including nested Tailwind watchers and Next lint.
- npm lock pins the compressed archive's SHA512. `ops/pack-braces.py --check`
  compares its canonical tar payload to the readable sources; comparison does
  not depend on the host zlib compression version.
- The frontend/website Docker build stage copies `vendor` before npm ci.
  The archive installs actual files, not links. The backend-only workspace
  installation excludes this build dependency; its Dockerfile is unchanged.

Never overwrite a released local revision's archive. Increment the package
revision, archive filename, source metadata, manifest and lock together.
An unpublished intermediate install reused a cached archive after repacking;
the provenance gate rejected it. The final immutable revision2 and clean
installation are checked against the exact source bytes.

## Security behavior and limits

A shared iterative validator bounds the child traversal before each recursive
compile/expand/stringify operation, including the direct library entry points.
The parser bounds grouping before inserting another container. Limits cannot
be raised by caller options:

- AST depth at most128, counting terminal children; parser grouping at most127.
- Total scheduled traversal nodes at most20000, including repeated DAG paths.
- Child cycles and parent cycles are rejected.
- Invalid child collections are rejected as controlled syntax errors.

Errors have type SyntaxError and code `ERR_BRACES_AST_LIMIT`. Normal alternatives,
ranges, escapes, quoted literals and small shared acyclic nodes preserve the
existing API. Existing character/range bounds are retained. This patch does
not make arbitrary attacker-provided glob/regex patterns safe or bound every
possible expansion/regex complexity. It fixes the reproduced recursive
AST-stack-exhaustion path; Fleetum build patterns remain repository controlled.

Upstream index, constants, utilities and license retain original bytes.
Changes to upstream functions are calls to the shared validator and parser
depth checks; the validator itself is new and readable.

## Required gate and audit interpretation

`npm run verify:vendor` checks malicious input/ASTs through the real consumers,
source/archive/installed-file equality, lock integrity and frontend Docker installation.
It is required by `verify:release`; the unchanged CI operations glob runs the
same tests. A package name/version change alone cannot pass this gate.

**npm's advisory database does not certify this local namespace.** A zero npm
audit after replacement is an inventory result, not independent validation of
the patched code. Report it together with provenance, behavioral regression
tests, compatibility and manual diff review. No audit allowlist or severity
threshold is changed; the production audit helper remains unchanged.

Repository maintainers own this local dependency until an upstream patch or
compatible replacement is validated. Review its necessity by2026-10-24 and
when updating Tailwind, Next lint or this patch. This is a documented review
deadline, not an automation or live configuration.

## Impact, review and rollback

One frontend Dockerfile COPY line is required for a file dependency during
deterministic installation; no provider/env/runtime behavior or live image is changed.
No database migration. Existing dispatch, approval, SHA/pin/source proof,
SSH trust and shared-ingress safeguards remain unchanged. Five CI jobs do
not replace the complete six-gate application release proof.

Rollback is a coordinated revert of root manifest/lock, the local vendor
package/archive, verify:vendor integration, Docker COPY line and docs/tests.
That restores known vulnerable upstream code and is not a safe release
candidate. Do not revert the operational release/ingress safeguards.

Retire the fork only after a compatible upstream or replacement implementation
passes clean install, real-consumer security/compatibility tests, CSS comparison,
release, operations and the applicable hosted CI. Remove the archive and COPY
lines only when no local file dependency needs them. No merge/deploy is included.
