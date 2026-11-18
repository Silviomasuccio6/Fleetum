# GitHub security controls

Repository settings take effect separately from files proposed in a pull request.
Verify settings and an actual analysis on the intended commit before describing a
control as active and verified. Required checks, release approvals and automerge
policies are managed separately; this guide does not change them.

## Dependencies

The dependency graph covers recognized manifests and lockfiles. Fleetum has one
root npm lockfile with npm workspaces for backend, frontend, website and shared
packages. Do not configure duplicate per-workspace update jobs for that lockfile.
Use the dependency graph/SBOM to check actual recognition; vendored/local packages
still require the repository's provenance and dependency tests.

Dependabot alerts and security updates are repository settings. Security updates
do not require a dependabot.yml file. No ordinary scheduled version-update jobs
are added here. If future customization is needed, retain the required schedule
keys but set open-pull-requests-limit to zero for security-only entries, omit
target-branch, and scope any groups to applies-to: security-updates. This option
does not change GitHub's separate limit for security PRs. Review updates manually.

## Code scanning

Use one CodeQL mode. The intended repository setting is default setup with the
default query suite, standard GitHub-hosted runners, and actions,
javascript-typescript and python. GitHub manages its triggers and periodic scans;
there is no competing advanced workflow in the repository. Confirm the effective
configuration and analysis results in the Security tab/API.

Semgrep remains the separate SAST job in ci.yml, with its existing OWASP/Node
rules and ERROR threshold. The use of codeql-action/upload-sarif uploads Semgrep
results; it is not itself a CodeQL analysis. Current GitHub documentation limits
the default-setup upload restriction to CodeQL results, allowing third-party SARIF
to coexist. Verify a real Semgrep upload after enabling default setup.

Missing or invalid SARIF is an analysis error, not an empty successful report.
The evidence helper validates tool identity, scanner exit, report structure and
notifications; the Semgrep result also requires nonempty rule metadata. Warnings
stay visible. This validates evidence integrity, not complete source coverage.

## Secrets

GitHub secret scanning and push protection detect supported patterns. Gitleaks
adds the working-tree CI gate and the manual/scheduled full-history scan. Baseline
fingerprints and narrow allowlists are reviewed in the repository; do not expand
them simply to obtain green checks.

The history scan explicitly uses Gitleaks --exit-code 10 for findings: its default
exit 1 is also used for errors. Only a consistent real report distinguishes clean
and findings; other exits, missing/invalid SARIF or unredacted secret snippets fail
the analysis. Non-blocking historical triage remains explicit: a successful job
may still contain findings requiring private review. Manual fail_on_findings=true
fails on those findings. Errors cannot take the non-blocking findings path.

The scanner checks the requested source ref and reachable history. Its evidence
validator comes from the exact workflow revision, so an old scan ref need not
contain the helper. The job deletes the temporary SARIF after validation and
publishes only the `gitleaks-history-summary` JSON artifact. It records the
outcome, counts, checkout SHA and number of reachable commits. Review individual
findings in a private environment. The workflow uses `contents: read` and runs
independently of deployment environments.

## Private reports

Private vulnerability reporting must be enabled in repository settings; SECURITY.md
documents the channel but cannot enable it. Keep sensitive findings and evidence
out of public PR descriptions and documentation. Do not publish advisories,
rotate credentials or change access as part of a routine configuration review.

## References

- [CodeQL setup types](https://docs.github.com/en/code-security/concepts/code-scanning/setup-types)
- [SARIF default-setup restriction](https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/troubleshoot-sarif-uploads/default-setup-enabled)
- [Dependabot security-only customization](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/customizing-dependabot-security-prs)
- [Gitleaks exit codes and redaction](https://github.com/gitleaks/gitleaks)
