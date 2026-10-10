import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { verifyControlPolicy } from './control-policy.mjs';
import { validateSshTarget } from '../e2e/staging-release-binding.mjs';

export function requestForIngress(env, root = process.cwd()) {
  const control = verifyControlPolicy({ GITHUB_WORKFLOW_SHA: env.GITHUB_WORKFLOW_SHA,
    FLEETUM_STAGING_TRUSTED_WORKFLOW_SHA: env.FLEETUM_INGRESS_TRUSTED_WORKFLOW_SHA,
    FLEETUM_STAGING_APPROVED_RELEASE_SHA: env.FLEETUM_INGRESS_APPROVED_SOURCE_SHA,
    RELEASE_SHA: env.GITHUB_WORKFLOW_SHA });
  if (!control.ok || env.CHECKOUT_SHA !== env.GITHUB_WORKFLOW_SHA) throw new Error('Unapproved ingress source/control.');
  if (!validateSshTarget(env.INGRESS_HOST, env.INGRESS_USER).ok) throw new Error('Invalid ingress SSH target.');
  const mode = env.INGRESS_MODE;
  if (!['plan', 'apply', 'recover'].includes(mode)) throw new Error('Invalid ingress operation.');
  const image = env.FLEETUM_INGRESS_CADDY_IMAGE;
  if (!/^ghcr\.io\/silviomasuccio6\/fleetum-frontend@sha256:[a-f0-9]{64}$/.test(image ?? '')) throw new Error('Immutable observed Caddy image required.');
  for (const key of ['FLEETUM_INGRESS_BASELINE_COMPOSE_SHA256', 'FLEETUM_INGRESS_BASELINE_CADDY_SHA256']) {
    if (!/^[a-f0-9]{64}$/.test(env[key] ?? '')) throw new Error('Approved baseline fingerprint required.');
  }
  const bundleHashes = Object.fromEntries(['Caddyfile', 'Caddyfile.production-shared', 'Caddyfile.staging-ingress'].map(name =>
    [name, createHash('sha256').update(readFileSync(`${root}/deploy/caddy/${name}`)).digest('hex')]));
  if (createHash('sha256').update(readFileSync(`${root}/docker-compose.prod.yml`)).digest('hex') !== env.FLEETUM_INGRESS_BASELINE_COMPOSE_SHA256) throw new Error('Reviewed Compose baseline differs from protected fingerprint.');
  if (bundleHashes.Caddyfile !== env.FLEETUM_INGRESS_BASELINE_CADDY_SHA256) throw new Error('Reviewed baseline differs from protected fingerprint.');
  const request = { mode, sourceSha: env.GITHUB_WORKFLOW_SHA, image,
    composeHash: env.FLEETUM_INGRESS_BASELINE_COMPOSE_SHA256, caddyHash: bundleHashes.Caddyfile, bundleHashes };
  if (mode !== 'plan') {
    const confirmation = mode === 'apply' ? 'ACTIVATE_STAGING_INGRESS' : 'RECOVER_STAGING_INGRESS';
    if (env.INGRESS_CONFIRM !== confirmation || !/^[a-f0-9]{64}$/.test(env.INGRESS_PLAN_DIGEST ?? '')) throw new Error('Explicit confirmation and bound plan required.');
    const flag = mode === 'apply' ? 'true' : 'false';
    if (env.FLEETUM_SHARED_STAGING_INGRESS !== flag || env.PRODUCTION_PERSISTENCE_VERIFIED !== 'true') throw new Error('Reviewed production persistence policy is not ready.');
    if (!/^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+$/.test(env.FLEETUM_INGRESS_CADDY_EMAIL ?? '') || env.FLEETUM_INGRESS_CADDY_EMAIL.length > 254) throw new Error('Protected ACME contact required.');
    Object.assign(request, { confirm: confirmation, planDigest: env.INGRESS_PLAN_DIGEST, email: env.FLEETUM_INGRESS_CADDY_EMAIL });
  }
  return request;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { process.stdout.write(JSON.stringify(requestForIngress(process.env))); }
  catch { console.error('Ingress controls refused before SSH execution.'); process.exitCode = 1; }
}
