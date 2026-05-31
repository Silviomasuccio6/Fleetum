# GitHub Branch Protection for Fleetum

Fleetum should use GitHub repository rulesets or classic branch protection to make production changes traceable and difficult to bypass.

These settings are configured from GitHub UI, not from this repository. Keep this file aligned with the actual GitHub settings after every change.

## main

`main` is the production branch. A merge to `main` can trigger production deployment, so it should be treated as a protected release surface.

Recommended rules:

- [ ] Block direct pushes.
- [ ] Require pull request before merge.
- [ ] Require at least 1 approval.
- [ ] Require review from Code Owners.
- [ ] Dismiss stale approvals when new commits are pushed.
- [ ] Require conversation resolution before merge.
- [ ] Require status checks to pass before merge.
- [ ] Require branch to be up to date before merge.
- [ ] Block force pushes.
- [ ] Block branch deletion.
- [ ] Restrict who can bypass required pull requests.
- [ ] Restrict who can bypass required status checks.

Required checks:

- [ ] `CI`
- [ ] `Secret Scan (Gitleaks)` if enabled.
- [ ] `SAST (Semgrep, advisory)` if enabled.
- [ ] `Deploy Production` should stay GitHub Actions controlled and should not be bypassed manually except for an explicit emergency.

Recommended merge policy:

- [ ] Allow squash merge.
- [ ] Disable merge commits if the history becomes noisy.
- [ ] Delete head branches after merge.
- [ ] Require signed commits only after the local/dev workflow is ready for it.

## develop

`develop` is the staging integration branch if/when the staging environment is used.

Recommended rules:

- [ ] Require pull request before merge.
- [ ] Require status checks to pass before merge.
- [ ] Required check: `CI`.
- [ ] Require branch to be up to date before merge.
- [ ] Block force pushes.
- [ ] Block branch deletion.
- [ ] Require Code Owners review for protected files.

Staging deploy:

- [ ] `deploy-staging.yml` should be manual or tied to `develop`.
- [ ] Staging must use separate secrets, env files and database.
- [ ] Stripe test mode only.
- [ ] Email sandbox/test recipient unless explicitly approved.

## CODEOWNERS coverage

`CODEOWNERS` currently protects:

- GitHub Actions and repository automation.
- Docker Compose, Dockerfiles, Caddy, deploy and backup scripts.
- Prisma schema and migrations.
- Environment validation and server bootstrap.
- Auth, platform auth, middleware and platform routes.
- Billing, license, subscription, invoice and Stripe surfaces.
- Storage, uploads, file security and privacy compliance flows.
- Package manifests and lockfile.
- Deployment/security documentation.

When adding new high-risk files, update `CODEOWNERS` in the same PR.

## Production deploy rule

Production should update only through GitHub Actions:

```txt
feature branch -> PR -> CI PASS -> merge main -> production workflow -> health checks PASS
```

Manual VPS changes are allowed only for an explicit emergency. If used, they must be followed by a repo commit/PR that makes the repository match production again.

## Suggested flow

```txt
codex/task-branch -> PR -> develop -> staging -> PR -> main -> production
```

For small documentation-only or operational-hardening changes, a direct PR to `main` is acceptable when:

- CI is required.
- The change is reviewed.
- No secrets are included.
- The production impact is clearly stated in the PR.

## Admin checklist

- [ ] Enable repository ruleset for `main`.
- [ ] Enable repository ruleset for `develop` if used.
- [ ] Confirm `CODEOWNERS` review is required.
- [ ] Confirm Actions secrets are scoped and named clearly.
- [ ] Confirm no production secrets are stored in repository files.
- [ ] Confirm Actions cannot be triggered from unsafe events such as `pull_request_target` unless explicitly reviewed.
- [ ] Confirm production deploy logs do not print secrets.
- [ ] Confirm branch protection is documented after every repo settings change.
