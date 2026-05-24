# GitHub Branch Protection for Fleetum

## main

Recommended settings:

- [ ] No direct push.
- [ ] Pull request required.
- [ ] Require at least 1 approval.
- [ ] Require conversation resolution.
- [ ] Require status checks to pass.
- [ ] Required check: `Secret Scan (Gitleaks)`.
- [ ] Required check: `SAST (Semgrep, advisory)`.
- [ ] Required check: `Lint, Build, Test, Audit`.
- [ ] Require branch up to date before merge.
- [ ] Block force push.
- [ ] Block branch deletion.
- [ ] CODEOWNERS review for protected files.

## develop

Recommended settings:

- [ ] Pull request required.
- [ ] Require CI to pass.
- [ ] Block force push.
- [ ] Block branch deletion.

## Suggested flow

```txt
codex/task-branch -> PR -> develop -> staging -> PR -> main -> production
```

## Notes

GitHub branch protection is configured from GitHub UI or repository rulesets. Do not store tokens or admin credentials in the repo.
