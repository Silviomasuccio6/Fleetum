# Release continuity hardening — 2026-09-15

## Scope

This tranche addresses the operational findings OPS-01, OPS-03 and OPS-04. It changes release identity, synthetic staging E2E gates and application rollback behavior. It does not change application data models and contains no database migration.

## OPS-01 — Immutable release identity

### Motivation

The previous production workflow could resolve `main` independently in multiple jobs and used abbreviated image tags plus `latest`. A branch move during a run could therefore weaken the evidence connecting CI, source, image and deployed manifests.

### Behavior and impact

- One initial job resolves the full 40-character Git SHA.
- Automatic production runs accept only a successful `push` CI run for `main` from this repository.
- Manual runs require a successful `push` CI workflow run on `main` for the exact selected SHA; a pull-request merge-ref result is not accepted as proof for its head SHA.
- SAST, image builds and deployment all check out the resolved SHA.
- Backend and frontend publish full-SHA tags and deploy by the immutable digests returned by their builds. Before backup or migration, the VPS pulls each full-SHA tag and verifies that it resolves to the same local image as the selected digest.
- The release state records the SHA, CI run, deploy run, previous images, target images and completion timestamp with atomic file replacement.

### Rollback

Reverting the workflow and deploy-script changes restores the former release process. Do not revert during an active release. Existing digest references remain valid Docker image inputs.

## OPS-03 — Fail-closed critical-flow E2E

### Motivation

The nightly workflow previously defaulted to production URLs and exited successfully when credentials were absent. A green scheduled run did not prove that the critical flows executed.

### Behavior and impact

- Staging frontend/API URLs and two distinct synthetic tenant accounts are mandatory.
- Exact Fleetum production hosts, non-HTTPS URLs, embedded URL credentials and incomplete configuration are rejected before dependency installation.
- Playwright emits line, HTML and JSON reports.
- The result gate requires all six named critical tests across login, booking/contract, vehicle/report and tenant isolation, including the authenticated cross-tenant mutation case, plus zero skips, zero failures and zero top-level runner errors.
- Reports and failure diagnostics are retained as workflow artifacts.

### Rollback

Reverting the E2E workflow and the two `ops/e2e` validators restores the prior scheduled behavior. This would also restore the former false-green risk and is not recommended.

## OPS-04 — Restart and rollback safety

### Motivation

The safe deployment script previously stopped immediately when `docker compose up` failed. A partial restart could leave mixed services without attempting the already documented application rollback.

### Behavior and impact

- Safe deploy and manual rollback share an exclusive lock.
- Manifests upload to a SHA-versioned staging directory and are promoted to the active directory only while that VPS lock is held.
- A failed or partial restart triggers application rollback to the recorded previous images.
- Backend readiness plus the frontend, robots, sitemap, `llms.txt` and social-preview checks run while the deploy lock and rollback context are still active.
- A failed readiness or public frontend check uses the same rollback path, and the rollback must pass the same full check set before it is reported as complete.
- Rollback failure is reported separately while the deploy preserves its original failure status.
- The rollback state is parsed as data, not sourced as shell code, and image references are allowlisted.
- Database restore is never automatic.

### Rollback

Reverting both deploy scripts together restores the former behavior. Do not revert only one script because their lock handoff and state format are coordinated.

## Verification evidence

- Operations safety tests: 19 passing tests, including restart failure, backend and frontend health failure, rollback failure, digest/tag mismatch, staged manifest promotion, release identity and E2E fail-closed cases.
- Shell syntax validation passed for preflight, shared production health, safe deploy and rollback scripts.
- GitHub workflow YAML parsing passed for CI, production deploy and nightly E2E.
- Backend: 184 tests passed.
- Frontend: 20 tests passed.
- Website: 9 tests passed.
- Frontend prerender: 13 public routes/assets passed.
- Production dependency audit: no high or critical finding.
- Temporary PostgreSQL 16 gate: 44 migrations applied, monetary reconciliation and dual-write checks passed, and 17 persistent database/security tests passed.

The application suites ran with synthetic data and temporary local infrastructure. No live environment file, production data, provider configuration, deploy, push or merge was used.

## Gates that remain external

- GitHub PR review and the real hosted CI run.
- A staging E2E run with configured synthetic tenant accounts.
- For a release containing migrations, a rehearsal proving that the preceding application version serves critical flows against the migrated schema.
- Current production evidence for offsite backups, restore drills, disk capacity and the image digests actually running on the VPS.
