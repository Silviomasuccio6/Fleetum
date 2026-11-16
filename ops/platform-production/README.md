# Selective Platform production delivery

This is the local delivery tooling for Satinata and its targeted production
backend protections. It does not install the operational UI redesign from
PR #156, replace the public website, or deploy the whole current `main` app.
There is no production installer in this directory yet.

## Immutable application inputs

`ops/platform-release/production-candidates/20261115/candidate.json` pins the
three source commits, reconstructed trees, patches and exact file inventories:

| Role | Reviewed source | Purpose |
|---|---|---|
| Backend | `2afaf8f88498cca911fbd07866b922d2e7abf83c` | Backport onto recorded production source `db1f231`, including server logout revocation and invoice-email idempotency |
| Satinata | `1f35e6c5a35d84e38ea928a4490cd772cc56473c` | Selected Platform visual shell with the new backend contracts |
| Fallback | `0583b525fbec4b4cbfe5fb8046f5eeb6692e8671` | Prior visual shell, retaining the same backend protections |

The application's source SHA and the delivery control SHA are distinct. Do not
merge the old-baseline backend branch wholesale into `main`. Reconstruction
uses a separate Git index, checks every exported blob and executable bit, and
rejects missing or additional source files. Archives reject links, special
files, path traversal, real environment files and oversized payloads.

## 1. Unprivileged exact-source CI

`.github/workflows/platform-production-candidate-ci.yml` runs on relevant PR
changes, relevant pushes to `main`, or an explicit manual refresh. It checks
out the exact control SHA with read-only repository access. It has no protected
environment, package publication permission, server secrets or SSH steps.

The jobs perform:

1. Synthetic archive/publisher-control tests and reconstruction of all inputs.
2. Fresh backend installation, lint/build, at least 182 unit tests, 13 persistent
   HTTP/security tests on its own PostgreSQL 16, production dependency audit,
   and the preserved-data migration trial `42 -> 43 -> 48`.
3. Separate frontend jobs: at least 129 Satinata and 118 fallback tests, build
   with `https://platform.fleetum.it/platform-api`, production dependency audit,
   and compiled-archive checksums.
4. A real Linux/AMD64 backend image build without publication, network-isolated
   smoke checks, image save and Trivy scan. High/critical findings block proof.
5. Gitleaks and Semgrep scans on the actual reconstructed application sources.
   Scanner tags are resolved to immutable image digests before execution.
6. A separate `platform-production-candidate-ci` proof binding all successful
   jobs, reports, source trees and payload digests to this run and control SHA.

Docker operations explicitly target the GitHub runner's local Unix socket and
refuse ordinary local invocation. Database cleanup runs even after failure;
only the generated task-owned container and volume may be removed. The report
fails on skipped, incomplete or failed test output, failed/malformed audits,
mixed runs, wrong sources or an untested platform.

The ordinary `.github/workflows/ci.yml` proof remains required independently.
Its green status is not evidence that these three derived apps were compiled.
The custom candidate proof cannot satisfy that existing gate or vice versa.

Only reports, exact archives and bounded test logs are uploaded. Synthetic
database session files, credentials and database/upload fixtures are excluded.
Candidate artifacts expire after 14 days; use the manual unprivileged refresh
on the current `main` when needed. PR and local proofs cannot authorize image
publication. A current-main push/manual candidate proof and the current-main
ordinary push proof are both required for the protected preparer.

## 2. Read-only production layout, still a separate gate

`observe.py` is a bounded collector, prepared and tested locally. It has not
been run on the production server during this delivery-tooling phase. Explicit
read-only access approval is pending.

It reads formatted metadata for the named Fleetum containers/images, mount and
network names, hashes of bounded allowlisted Compose/Caddy files and free disk
space. It does not read environment values, credentials, database rows, logs or
customer documents. It does not write configuration or restart services.

`profile.mjs` requires an observation no older than 24 hours. Unsupported paths,
staging projects, non-AMD64 hosts, unverified configuration files, mounted static
roots or changed parent image digests stop preparation. `recorded-base.json`
pins the previous dated production-image observation; changing a protected
variable alone cannot silently accept another backend baseline. Fresh evidence
must be reviewed if that baseline changed.

This profile describes the layout; it has `executionReviewed: false` and
`readyForDeployment: false`. It does not prove schema state, invoice backlog,
backups or permission to install anything. The actual host transaction must be
completed from the observed layout rather than guessed from historical paths.

## 3. Protected image preparation, without installation

`.github/workflows/prepare-platform-production.yml` is manual, first-attempt,
current-`main` only, guarded by the `production` environment and the exact
`PREPARE_PLATFORM_PRODUCTION` confirmation. It can publish three prepared
images to GHCR; it has no server access or installation step.

Protected inputs are read inside the job steps after environment protection:

- `FLEETUM_PLATFORM_PRODUCTION_TRUSTED_CONTROL_SHA`
- `FLEETUM_PLATFORM_PRODUCTION_PREPARE_JSON`
- `FLEETUM_PLATFORM_PRODUCTION_PROFILE_JSON`

The strict image-approval object binds the control SHA, manifest hash, both
independent main CI run IDs, immutable backend/frontend parent images, canonical
profile hash and an expiry no more than six hours ahead. It is not an install
approval. No real approval/profile values have been configured by this local
implementation.

`prepare.mjs` checks GitHub workflow/run identities, repository, branch, source,
conclusion and artifact metadata. Each download must pass a hard SHA-256 ZIP
check and contain exactly the allowed regular filename. Payload hashes must
also match the candidate proof. No untrusted archive is executed. Main and the
protected input tuple are checked again before the builder runs.

`prepare_images.py` loads the already-tested backend image and validates its
actual architecture and source/tree labels. It never runs the app, installs its
packages or recompiles it with publishing credentials. The frontend images use
the immutable observed production parent plus only the selected Platform
static closure. Parent `ONBUILD` instructions are rejected before building;
the overlay Dockerfiles contain only `FROM`, `LABEL` and `COPY`.

Both final frontend static trees are extracted without starting containers and
compared with their expected full-tree hashes. Tenant static files and the
entire separate public website root must be preserved. Both variants must pass
before the first image push. Result metadata binds immutable image digests,
source/control identities, parent roots and overlay-manifest hashes, and still
states `installationExecuted: false` and `readyForDeployment: false`.

The uploaded review artifact contains only the prepared-image metadata and the
two overlay manifests, not the host profile, request, approvals, credentials or
downloaded archives. A failed attempt has no automatic second publication or
installation attempt.

## Remaining installation and rollback work

Before an actual production release, complete and review the host adapter from
fresh authorized metadata. The install gate already has a distinct policy
requiring exact source/CI identity, parent/static/website/profile hashes,
preflight and backup hashes, current-main first dispatch and a bounded approval.
There is deliberately no workflow invoking a host transaction yet.

Required external evidence remains:

- Fresh actual layout and immutable parent images, followed by an approved
  schema and aggregate invoice-queue preflight if needed; those database reads
  are outside the metadata collector's permission.
- Verified production backup and restore procedure appropriate to the actual
  persistence layout, without restoring over the active database during tests.
- Real Linux CI, Docker build/scans, immutable registry image proof and static
  preservation verification against the actual parent image.
- Explicit publication/integration and production release authorization, with
  the required personal environment approvals.
- Reviewed installation, health/authenticated checks and recovery transaction
  preserving the actual Compose/Caddy configuration and storage.

The fallback restores only the former Platform appearance while retaining the
new backend safeguards. It is not a database downgrade. The canonical migration
adds the invoice dispatch ledger/queue leases, two passive ledgers and nullable
DemoLead fields; the source-level migration/rollback analysis is in
`docs/platform-production-compatibility-20261115.md` of the derived backend.
Do not blindly drop those tables or re-enable the previous backend after live
use; assess any queued work first. No active-database restore is implemented.

## Local verification available on 16 November 2026

The local wrapper executions compiled and tested the pinned application inputs:

| Check | Result | Delivery recipe snapshot |
|---|---|---|
| Satinata frontend | 129 tests, build and production audit passed | `5214a9a` |
| Compatible fallback | 118 tests, build and production audit passed | `5214a9a` |
| Backend | 182 unit + 13 persistent tests, lint/build/audit and migration trial passed | `f70ceb7` |

These reports identify Darwin/ARM64 and local run `1`; the candidate policy
rejects them as GitHub/Linux proofs. The wrapper was corrected to finish ESM
evaluation before importing the backend adapter and to keep relative upload
keys for the existing storage unit-test contract. Application sources were
unchanged. The task-owned native PostgreSQL cluster was stopped and its data,
password/session removed; no system database service was changed.

Local tooling checks:

Final results on Node 22.23.1: operations **633/633**, targeted controls
**53/53** (a subset of operations), and **25 Python fixtures** (executed by
the Node wrapper as well). No final failures, cancellations or skipped tests.
Python/Node syntax checks and `git diff --check` also passed.

```sh
node --test ops/tests/platform-production-*.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s ops/platform-production -p 'test_*.py'
npm run test:operations
git diff --check
```

The operations suite includes existing synthetic Unix-socket tests; a locally
restricted runner may need permission for these sockets. Do not skip the tests
or change the application to hide that restriction. The first restricted run
failed on those sockets; the targeted unrestricted rerun passed. Full-suite
rerun initially used the Mac's global Node 20 and failed on unsupported module
APIs. The final full run explicitly selected the required Node 22.23.1 without
changing global settings and passed. Dated passing and failed-attempt logs are
kept separately in the private delivery handoff.

No new push, PR edit, merge, registry publication, server access, production or
staging deploy was performed while implementing this local delivery phase.
Source CI, real image/scanner evidence, live metadata, backup and installation
remain open gates.
