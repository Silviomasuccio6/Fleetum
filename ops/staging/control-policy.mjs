import process from "node:process";
import { pathToFileURL } from "node:url";
const sha = /^[0-9a-f]{40}$/;
export function verifyControlPolicy(env = process.env) {
  const errors = [];
  if (!sha.test(env.FLEETUM_STAGING_TRUSTED_WORKFLOW_SHA ?? "") || env.FLEETUM_STAGING_TRUSTED_WORKFLOW_SHA !== env.GITHUB_WORKFLOW_SHA) errors.push("Staging workflow revision must match the protected approved control SHA.");
  if (!sha.test(env.FLEETUM_STAGING_APPROVED_RELEASE_SHA ?? "") || env.FLEETUM_STAGING_APPROVED_RELEASE_SHA !== env.RELEASE_SHA) errors.push("Staging candidate must match the protected approved release SHA.");
  return { ok: errors.length === 0, errors };
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = verifyControlPolicy();
  if (!result.ok) { console.error(result.errors.join(" ")); process.exitCode = 1; }
  else console.log("Protected staging control and release revisions match.");
}
