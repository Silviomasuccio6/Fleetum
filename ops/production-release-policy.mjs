import { pathToFileURL } from 'node:url';

const sha = /^[0-9a-f]{40}$/;
const result = errors => ({ ok: errors.length === 0, errors });

// This tranche intentionally holds application releases until the complete CI
// source proof is available. Registering controls is never release approval.
export function verifyProductionReleasePolicy(env = process.env) {
  const errors = [];
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main') errors.push('Production release requires explicit dispatch on main.');
  if (env.RELEASE_CONFIRM !== 'RELEASE_FLEETUM_PRODUCTION') errors.push('Explicit release confirmation missing.');
  if (!sha.test(env.GITHUB_WORKFLOW_SHA ?? '') || env.FLEETUM_PRODUCTION_TRUSTED_WORKFLOW_SHA !== env.GITHUB_WORKFLOW_SHA) errors.push('Production workflow differs from the protected control revision.');
  if (!sha.test(env.RELEASE_SHA ?? '') || env.FLEETUM_PRODUCTION_APPROVED_RELEASE_SHA !== env.RELEASE_SHA) errors.push('Release differs from the protected approved source.');
  if (env.CHECKOUT_SHA !== env.GITHUB_WORKFLOW_SHA || env.RELEASE_SHA !== env.GITHUB_WORKFLOW_SHA) errors.push('Release, checkout and current main controls must be the same full SHA.');
  return result(errors);
}

export function verifyProductionCIRun(run, { repository, sourceSha }) {
  const errors = [];
  if (!sha.test(sourceSha ?? '') || run?.head_sha !== sourceSha) errors.push('CI source mismatch.');
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || run?.head_repository?.full_name !== repository) errors.push('CI repository mismatch.');
  if (run?.status !== 'completed' || run?.conclusion !== 'success' || run?.event !== 'push' || run?.head_branch !== 'main') errors.push('Successful completed push/main CI required.');
  if (run?.path !== '.github/workflows/ci.yml' || !/^[1-9][0-9]*$/.test(String(run?.id ?? '')) || !Number.isSafeInteger(Number(run?.id))) errors.push('CI workflow or run identity invalid.');
  return result(errors);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const checked = verifyProductionReleasePolicy();
  if (!checked.ok) { console.error(checked.errors.join(' ')); process.exitCode = 1; }
  else console.log('Explicit production source and controls verified.');
}
