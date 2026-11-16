# Production Platform candidate: local preparation, 15 November 2026

This directory describes the selected Satinata plus targeted production backend
protections. It is not an approval, deploy workflow, CI result or image proof.
The current staging-only release controls cannot install this production patch.

The subsequent local exact-source CI and protected image-preparation tooling is
documented in [the delivery runbook](../../../platform-production/README.md).
That path still has no production installer or new live-server evidence.

| Role | Base | Local reviewed source | Files changed from base |
|---|---|---|---|
| Backend backport | db1f231 | 2afaf8f | 24 |
| Selected Satinata | ed34f81 | 1f35e6c | 4 |
| Old-visual compatible fallback | 76c1756 | 0583b52 | 3 |

`candidate.json` pins full commits, derived Git trees, exact inventories and
SHA-256 checksums for the three patches. `production-candidate.mjs` reconstructs
them in separate temporary Git indexes; it never changes the caller worktree or
index, fetches from the network, contacts a server or deploys. Its receipt always
states `readyForDeployment: false` and carries no inferred CI run.

```sh
node ops/platform-release/production-candidate.mjs \
  --repository . \
  --manifest ops/platform-release/production-candidates/20261115/candidate.json \
  --out /private/tmp/platform-candidate-reconstruction.json
node --test ops/tests/platform-production-candidate.test.mjs
```

The source commits must be available in the local Git object database. The
backend starts from the recorded production source, not all of current main.
Do not merge its old-baseline branch wholesale into main. Review the narrowly
scoped patch, exact dependency lockfile and the migration/rollback note at
`docs/platform-production-compatibility-20261115.md` in that derived source.

The migration is the byte-identical canonical unit already present in main.
Besides the active invoice ledger/queue leases, it creates two passive ledgers
and two nullable DemoLead fields. No corresponding tenant feature handlers are
promoted. Retaining its canonical name/checksum was verified against the later
main migration chain on synthetic PostgreSQL only.

Satinata and the fallback both require the new backend. The fallback preserves
server logout and invoice-email safeguards while restoring the prior visual
shell. It is not a full backend downgrade or database restore.

Local evidence: backend build, 182 unit regressions; 13 PostgreSQL cases (7 Platform and 6 tenant HTTP cases);
selected frontend build and 129 tests; fallback build and 118 tests; production
dependency audits with zero reported vulnerabilities. Migration source chain
42→43→48 applied with a preserved synthetic baseline row. These are local dated
results, not GitHub CI or production acceptance. Independent evidence, command
logs, static closures and recovery bundles are held in the private handoff.

Static packaging was rehearsed against 117 previously selected static files:
25 files in Satinata's closure, 23 in the fallback; only platform.html replaced,
116 existing files preserved and no collisions. This is not verification of the
complete live frontend tree or the separate website root. Original logos stay
unchanged. A production install must prove those roots and parent images live.

Remaining gates: public review/CI on the exact sources; a dedicated protected
production release path binding backend/UI/control/image proofs; fresh live
image/schema/aggregate-backlog preflight and verified backups; explicit release
authorization/approval; post-install authenticated checks. No server write,
provider change, real email, customer-data export or deployment was performed
while preparing this candidate.
