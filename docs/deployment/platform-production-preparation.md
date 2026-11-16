# Platform production compatibility preparation

The Platform UI release target is production. The existing Platform staging control does not authorize or implement a production release. A full application release is not an acceptable substitute for a Platform-only visual update.

Before constructing a production delivery path, compare the exact selected UI's request contract with a bounded, read-only production observation. `ops/platform-release/production-compatibility.mjs` parses the usecase source without executing it and assesses compiled-code metadata tied to the observed production containers. It rejects missing routes, unsupported logout revocation or invoice-email command deduplication, stale evidence, unknown source hashes, container drift and observations from staging.

This is a static compatibility review. Even a compatible result reports `readyForDeploy: false` and requires authenticated workflow acceptance with synthetic data and an explicit reviewed execution plan. Presence of code or markers does not prove transaction atomicity, provider delivery semantics, schema availability or runtime behavior.

```sh
node --test ops/tests/platform-production-compatibility.test.mjs
node ops/platform-release/production-compatibility.mjs \
  --runtime /private/path/runtime-code-evidence.json \
  --ui-ref FULL_REVIEWED_UI_SHA \
  --out /private/path/new-compatibility-report.json
```

The command writes a new report with mode 0600; it does not overwrite its input or existing output. Exit 0 means static compatibility only, 2 means a blocked contract, and 1 means incomplete or invalid evidence. It never connects to SSH, a database or a provider. Runtime observations and live identifiers stay outside the repository.

If the selected client and deployed protocol differ, decide the release scope explicitly before changing product behavior or schema:

- Retain the newer session and email guarantees by preparing a narrowly reviewed backend compatibility patch. Review persistent storage and shared queue dependencies; do not apply a broad migration or promote all of main to obtain two APIs.
- Or prepare a separately reviewed visual-only client using the protocol explicitly approved for the deployed backend. Never silently treat an unavailable logout endpoint as successful server revocation, and never advertise idempotency unsupported by the backend. Preserve existing production safeguards and leave the newer main protections intact.

A future production control needs its own immutable source/CI/image bindings, protected production approvals, shared production lock, verified backup, static/mount/configuration guards, acceptance evidence and explicit rollback. It must preserve the tenant application and public website. Reusing the staging path, container names, secrets or release proof is not a production implementation.

Frontend rollback can retain a newly introduced security backend. Backend rollback must separately account for durable token revocations and uncertain/in-flight email commands; restoring an old binary must not silently restore access or repeat deliveries. Additive schema and forward-migration compatibility must be tested on temporary PostgreSQL with synthetic data before any approval to install.
