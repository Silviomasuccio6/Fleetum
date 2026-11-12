# Critical browser test runner

The E2E Nightly browser job uses `ubuntu-24.04` deliberately. Its Playwright
version is resolved by the committed npm lockfile.

On 12 November 2026, run
[43123971091](https://github.com/Silviomasuccio6/Fleetum/actions/runs/43123971091)
received Ubuntu 26.04.1 through `ubuntu-latest`. Playwright 1.60.0 rejected
that platform during `Install Chromium`, before any application tests or
before/after runtime observations ran. The uploaded artifact contained the
release proof only; it did not constitute a successful seven-case report.

[GitHub's migration notice](https://github.blog/changelog/2026-09-17-ubuntu-26-generally-available-and-latest-migration/)
describes the moving label and recommends pinning `ubuntu-24.04` when the
new platform is not yet supported by the workflow's tools. The previous
successful Nightly 42170031886 used Ubuntu 24.04.5 with the same Playwright
lockfile. That historical success is not evidence for a new application release.

The regression in `ops/tests/e2e-gates.test.mjs` checks the actual browser
job's runner rather than comments or another job. Changing the runner or
upgrading Playwright requires an intentional compatibility review.

This change leaves dependency versions, the seven required cases, zero-retry
policy, tenant isolation, environment approvals, source/release binding, and
runtime evidence checks intact. It does not alter application behavior.

A changed trusted workflow SHA requires a staging deploy proof bound to the
new workflow before the next Nightly can pass the existing binding checks.
Do not weaken those checks, edit an old proof, or promote a failed preparation
step to a successful application test.
