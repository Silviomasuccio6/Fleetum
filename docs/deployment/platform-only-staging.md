# Platform-only staging control

This control updates the authenticated Platform frontend while preserving the deployed application, backend, database, uploads, public website and proxy configuration. It does not provide a production release path. Implementation and tests are local until separately authorized publication and CI review; no image or server action is implied by this document.

## Source and approval boundaries

`deploy-platform-staging.yml` is dispatch-only, shares the `fleetum-staging` concurrency lock, and requires personal environment approval before source resolution and again before installation. The server transaction shares `/opt/fleetum-staging/deploy.lock` with complete releases. A wrong confirmation does not start a change. A failed attempt is not retried or rolled back automatically; use a separately approved fresh dispatch.

Three sources remain distinct:

- Application source and original Deploy Staging proof: the code already deployed, including tenant UI and backend.
- UI source and its exact successful CI source proof: the Platform build input.
- Control source and its own exact successful CI proof: the workflow/helper implementation. After merging a controls PR, use the merge SHA and its new CI, not the earlier PR head proof.

Protected staging variables are checked before building or publishing:

| Variable | Meaning |
|---|---|
| `FLEETUM_STAGING_TRUSTED_WORKFLOW_SHA` | Exact current control SHA; must match workflow and checkout |
| `FLEETUM_STAGING_APPROVED_RELEASE_SHA` | Existing application source; remains unchanged by this overlay |
| `E2E_STAGING_RUN_ID` | Original complete application deploy run; remains unchanged |
| `FLEETUM_PLATFORM_APPROVED_UI_SHA` | Exact reviewed UI source |
| `FLEETUM_PLATFORM_APPROVAL_JSON` | Complete approved tuple described below |
| `E2E_PLATFORM_RUN_ID` | Completed Platform install or rollback run for the composite Nightly, set only after success |

The approval JSON has exactly these fields: `schemaVersion:1`, `repository`, `appSha`, `uiSha`, `controlSha`, `parentControlSha`, `parentRunId`, `uiCiRunId`, `controlCiRunId`, `parentFrontend`, `backendImage`, `baselineTreeSha256`, `ingressMode`. Run IDs must be positive safe integers represented as decimal strings; sources are full 40-character SHAs, image references are full Fleetum GHCR digests, and baseline hash is SHA256 over canonical sorted `[path,bytes,sha256]` rows. Ingress is `shared` or `dedicated`. No defaults infer a source, an image, a run or an approval. Unknown fields are rejected without echoing their contents.

Do not commit a live approval or runtime inventory. Configure it only in a separately authorized execution block after fresh comparison; fixtures in tests are synthetic. Historical parent control/run remain in the tuple even when current controls advance.

## Workflow

1. **Resolve**: verify the protected tuple, successful parent deploy, exact UI/control CI runs and one unexpired artifact for each proof. Download and verify the artifacts before any source execution. Fetch only the fixed public compose/Caddy source files from the approved application commit, storing their hashes for the server guard. No credentials are needed here.
2. **Compile UI**: a separate read-only job checks out the UI SHA, rejects real env files, installs the lockfile without lifecycle scripts and builds with Node22.23.1, `NODE_ENV=production`, `VITE_PLATFORM_API_BASE_URL=/platform-api`. No deployment/registry write credentials or protected environment are available to UI build scripts.
3. **Prepare target**: trusted controls safely extract the inert compilation archive. Links, special/private files, traversal and oversized archives fail. Extract static roots from the immutable parent image without starting its entrypoint; verify the parent static hash, calculate the complete Platform dependency closure, retain original logos/shared references, and refuse collisions outside `platform.html`. Build an image with only a `COPY` of that closure. Compare both built static roots before publishing; only then resolve an immutable target digest. The complete frontend or website build is never installed.
4. **Apply**: a second personal approval exposes only the staging SSH credentials to trusted code. Strict pinned SSH, private temporary files and cleanup are mandatory. The helper locks the canonical staging path, verifies the exact running backend/frontend, mounts, fresh static hashes and public source-config hashes, pulls the immutable target and requests only `caddy` with `--no-deps --no-build --pull never`. No other service, migration or bootstrap is run. Docker is pinned to the local Unix socket with a restricted environment.
5. **Prove**: verify backend runtime continuity, complete static trees, unchanged website and strict Platform health, including the expected public IP denial. HTTPS `/platform.html` must match the target hash. Publish a version2 composite proof only on success; the future verifier additionally requires the entire GitHub run to have completed successfully. Retain attempt snapshots without credentials after failure. An unsuccessful run cannot supply a valid completed release proof.

The manifest and target digest shown before the second approval are the actual CI build outputs. Earlier local review hashes must not be reused as though a different build environment necessarily produced identical bytes. A changed live parent, configuration or static tree requires a new reviewed baseline; there is no overwrite fallback.

The helper uploads a new per-run directory under `.deploy-platform/<numeric-run-id>` and a public-image-only compose override. It does not replace app manifests or env files. Subsequent complete releases intentionally use their own manifests; the composite binding must then be explicitly updated, never silently ignored.

## Nightly and compatibility

Without `E2E_PLATFORM_RUN_ID`, the existing version1 parent-deploy binding remains unchanged. With an explicit Platform selector, Nightly downloads the exact completed Platform artifact and verifies the complete parent → UI/control CI → overlay chain. The application checkout is still `E2E_RELEASE_SHA`; runtime frontend digest comes from the overlay proof and backend remains the parent backend. All existing source/repository/workflow/isolation and before/after continuity checks remain required. A version1 proof cannot stand in for an explicitly selected overlay; an overlay cannot enter the legacy path.

A completed rollback also uses a composite proof. Keep its run ID as `E2E_PLATFORM_RUN_ID`; do not clear the selector and expect the historical parent control SHA to equal the newer workflow SHA. After an explicitly approved complete release, switch back only using its valid complete-release proof.

Nightly's existing tenant tests are regression checks, not full Platform workflow acceptance. The actual Platform login/OTP, company/license/invoice/report/device flows still need the separately planned synthetic-account collaudo. Do not bypass OTP/IP restrictions or enable real email/payment providers to make that test pass. Native VoiceOver/device checks remain separate.

## Explicit rollback

Dispatch the same protected workflow with operation `rollback`, the previous successful **install** run ID and confirmation `CHANGE_PLATFORM_STAGING`. The prior proof, manifest, source/CI tuple and currently running target must match; rollback-of-rollback and implicit overlay stacking are rejected. Restore only the original immutable parent frontend, preserving backend, database, uploads and public website. Verify the restored static/website hashes and health, then publish the rollback proof. No new image is built or published for rollback. Changed control revisions or an unrelated current runtime fail rather than invoking a permissive recovery path.

## Local verification and remaining gates

Run `npm run test:operations` with Node22 and Python3; it includes the synthetic packaging/image/transaction tests. Direct Python: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s ops/platform-release -p 'test_*.py' -v`. The workflow tests parse YAML and compile every GitHub script/shell step without executing it. Existing ingress tests require a local synthetic Unix socket.

Tests simulate Docker, registry, SSH and server transactions; they do not prove a real image build, GitHub environment setup or successful remote deployment. Before any dispatch: review/publication and remote CI, approved controls merge if needed, current-control push/main CI, protected variables, reviewed live baseline, registry permissions, backup of the frontend identity/proof, and bounded temporary staging access with expiry/revocation plan. Create no keys and change no variables as part of local preparation. Do not run the helper manually to bypass GitHub protections.

A failure after the frontend switch can leave the new frontend running. This is reported as failed; it is not automatically repeated or reverted. Retain evidence, inspect safely, and approve the explicit rollback if appropriate. The existing security audit is not closed by these delivery controls.
