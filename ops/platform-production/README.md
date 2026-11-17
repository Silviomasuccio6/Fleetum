# Selective Platform production delivery

This is the local delivery tooling for Satinata and its targeted production
backend protections. It does not install the operational UI redesign from
PR #156, replace the public website, or deploy the whole current `main` app.
A separately protected manual installer is now implemented and tested. It has not been dispatched; production installation remains a separate authorization.

## Immutable application inputs

`ops/platform-release/production-candidates/20261115/candidate.json` pins the
three source commits, reconstructed trees, patches and exact file inventories:

| Role | Reviewed source | Purpose |
|---|---|---|
| Backend | `ae308aeeb83a7b98b3130e348ecccaa94d532a32` | Backport onto recorded production source `db1f231`, including server logout revocation and invoice-email idempotency |
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
2. Fresh backend installation, lint/build, at least 186 unit tests, 13 persistent
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

`observe.py` is a bounded collector for a separately authorized read-only inspection. Actual infrastructure observations, configuration fingerprints and host-specific findings belong in the private release handoff, never in this public document.

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
backups or permission to install anything. Backend and standalone shared-gateway profiles use separate Compose invocations so that their network and volume models retain their semantics. A profile remains private evidence, not an installation approval.

## 3. Protected image preparation, without installation

`.github/workflows/prepare-platform-production.yml` is manual, first-attempt,
current-`main` only, guarded by the `production` environment and the exact
`PREPARE_PLATFORM_PRODUCTION` confirmation. It can publish three prepared
images to GHCR; it has no server access or installation step.

Protected inputs are read inside the job steps after environment protection. The trusted control SHA is a public environment variable; private JSON approval/profile data are encrypted environment secrets, never plain variables:

- `FLEETUM_PLATFORM_PRODUCTION_TRUSTED_CONTROL_SHA`
- `FLEETUM_PLATFORM_PRODUCTION_PREPARE_JSON`
- `FLEETUM_PLATFORM_PRODUCTION_PROFILE_JSON`

Use compact single-line JSON for the encrypted inputs. Validation failures are caught without printing raw assertions, private objects or stack details to public logs. No private evidence values should be emitted by a script.

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

## 4. Separately authorized installation and recovery

`.github/workflows/install-platform-production.yml` is manual, current-main,
first-attempt and guarded by the existing production environment. It shares the
`fleetum-production` concurrency lock with the full release workflow. Publishing
or merging these tools does not start it.

The controller verifies both exact CI proofs, the exact successful image-preparer
run and digest-verified artifact, immutable source/image identities, a protected
profile, backup and preflight tuple, then validates the host request before SSH.
It rechecks current main and protected values again immediately before transfer.
The installer has no npm installation or registry publication permission. SSH
trust is pinned, only two trusted scripts are transferred through stdin, the
host keeps them root-owned, and the runner removes its private key afterwards.
No SSH key or secret for this new installation path has been configured here.

The host transaction takes the existing production lock, checks runtime/config
and actual complete static-parent hashes, revalidates the private backup and
aggregate database preflight, then pulls only the approved immutable images.
It stops the old backend/consumer before schema expansion, rechecks the invoice
backlog after the drain, applies only the candidate's Prisma chain, verifies all
43 canonical migration checksums and starts the new backend before the UI. It
keeps separate backend/gateway Compose models, database container identity,
mounts, named volumes, production/staging networks, original configuration files
and the existing non-secret certificate contact. The contact is kept only in
host memory, never printed or written to a credential file. Docker Compose uses
existing service env files internally; these tools never display or copy them.
Full final static/website hashes and both environments' health must pass.
Authenticated product acceptance remains pending even after infrastructure passes.

The installer requires an explicit storage-maintenance policy bound to the
protected preflight hash. It gates a narrowly scoped group-write permission and
persistent bind addition, preserves the directory owner and existing mounts,
and never changes stored relative keys or env values. Both source and destination
roots must be empty. The stopped old container is archived and checked again
after the drain: newly admitted documents, changed ownership or unexpected
content stop the release before container replacement. No recursive permission
change or silent document migration is performed. Actual current ownership,
storage layout and observed contents are private preflight inputs, not facts
asserted by the synthetic test fixtures. The CI image smoke also verifies the
runtime user required by the reviewed policy.


Phase journals preserve partial outcomes. There is no automatic retry, database
restore or original-backend downgrade; a failed migration/backend start stops
for a reviewed forward fix. The tested old-visual compatible image is prepared
as a recovery candidate. It is not automatically selected by this installer;
visual recovery must use a separately reviewed protected operation, never an
unreviewed manual Compose command or the full-main deployment workflow.

For a release, the approved database identity, migration names/checksums,
aggregate queue state and backup receipts must be validated privately. Backup
data must remain on the host. Full archive parsing without a restore target
proves readability/integrity, not a successful restore into another database.
The tooling does not copy production data into local test databases. Environment
files and live infrastructure observations are excluded from public artifacts.


Required external evidence remains:

- Obtain or refresh the privately reviewed layout, baseline checksums, aggregate queue state and backup before their approval/freshness windows expire.
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

The initial local wrapper executions compiled/tested the original inputs. The selected backend has since received the image-security refinement; its new local186-test result does not reuse the earlier database/image proof:

| Check | Result | Delivery recipe snapshot |
|---|---|---|
| Satinata frontend | 129 tests, build and production audit passed | `5214a9a` |
| Compatible fallback | 118 tests, build and production audit passed | `5214a9a` |
| Initial backend `2afaf8f` | 182 unit + 13 persistent tests, lint/build/audit and migration trial passed | `f70ceb7` |
| Hardened backend `ae308ae` | 186 unit tests, four multipart regressions, lint/build/production audit passed; updated database/image CI required | isolated source checkout |

These reports identify Darwin/ARM64 and local run `1`; the candidate policy
rejects them as GitHub/Linux proofs. The wrapper was corrected to finish ESM
evaluation before importing the backend adapter and to keep relative upload
keys for the existing storage unit-test contract. Application sources were
unchanged. The task-owned native PostgreSQL cluster was stopped and its data,
password/session removed; no system database service was changed.

Local tooling checks:

The final host-adapted tooling passed638/638 operations tests,58/58 targeted Node controls and39/39 Python fixtures (the Python suite is also invoked by Node). Exact final counts and commit identity are recorded in the private handoff; do not add overlapping Node/Python counts.
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

Publishing or merging these controls does not deploy an application. Image
preparation and installation are distinct manual protected workflows. Actual
source/image CI, private host evidence, explicit installation authorization and
authenticated acceptance must pass before a production release is called complete.

Image hardening retains Node22.23.1, applies the reported Alpine security package updates, pins Multer2.5.0 and removes global npm/npx only from the runtime. The unprivileged image smoke requires native Sharp loading, the direct Prisma CLI with no network and the absence of global npm. Trivy stdout JSON is parsed separately from stderr diagnostics; complete diagnostics remain in the task log. No finding waiver or lowered severity threshold is introduced.
# Frontend-only completion after a partial installation

`complete-platform-production-frontend.yml` is a separate, manually approved
production operation. It does not call the full installer. It verifies both the
original successful application CI/preparation and the new current-main controller
CI, the original failed installation and personal approvals, exact artifact ZIP
digests, unchanged candidate sources, and the explicitly approved live state.
Prepared artifacts retain their original control SHA. The outcome records both
controller identities and all corresponding run IDs.

The root-owned helper rechecks canonical migration history (42 plus the approved
patch), existing backup integrity, backend image manifest/config/source/tree,
backend and database container identity/start time, persistent storage access,
configuration hashes and shared gateway mounts/networks. It changes only the
`caddy` service using the existing standalone gateway model, immutable already
prepared images and `--no-deps --no-build --pull never`; there is no backend/DB
lifecycle, migration, restore, upload permission change or document operation.

The original frontend/static parent must still match. After activation the exact
prepared static tree and unchanged public website must match; all shared health
checks and backend/DB invariants must pass. Only an explicitly approved, single
visual fallback to the prepared compatible frontend is allowed. Backend drift
blocks this fallback. A recovered outcome is labelled `fallback`, never a
successful Satinata acceptance. No automatic second workflow or install attempt
is permitted. Authenticated operator acceptance remains a separate final gate.

The SSH grant must pin the exact reviewed loader, three helper hashes, canonical
request, run ID and a window of at most six hours; accept it only once. Preserve
the existing production reviewer and global deployment lock. Revoke the grant,
GitHub inputs and local private key at completion, before authenticated QA.

Docker manifest and image configuration digests are distinct. `image_identity.py`
bridges them through the immutable registry descriptor/config graph, checks the
tested config digest, exact RepoDigest, runtime/local image equality, source/tree
labels and Linux AMD64. Both classic config-addressed and manifest-addressed image
stores are supported. All mismatches remain fatal. The full installer resolves
this graph before stopping its old consumer and reuses it after start.
