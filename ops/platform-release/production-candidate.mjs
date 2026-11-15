import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

export const BASES = Object.freeze({
  backend: 'db1f231dc8cb699f1a5ce4215a0278c93212d16d',
  satin: 'ed34f81fd9408aab61b76cd76bd791eda82bad3f',
  fallback: '76c1756c8394f9557e611704fee0cfeaf29a7800'
});
const SHA = /^[0-9a-f]{40}$/, HASH = /^[0-9a-f]{64}$/;
const FRONTEND_PATHS = new Set([
  'frontend/src/application/usecases/platform/platform-admin-usecases.ts',
  'frontend/src/presentation/pages/platform/platform-admin-page.tsx',
  'frontend/tests/platform-invoice-email-outcome.test.ts',
  'frontend/tests/platform-invoice-email.test.ts'
]);
const BACKEND_PATHS = new Set([
  'package.json', 'package-lock.json', 'backend/package.json', 'backend/prisma/schema.prisma',
  'backend/prisma/migrations/20260921150000_final_release_blocker_atomicity/migration.sql',
  'backend/src/application/services/platform-session-service.ts',
  'backend/src/application/services/platform-admin-service.ts',
  'backend/src/application/services/invoice-service.ts',
  'backend/src/infrastructure/email/platform-invoice-outbox.ts',
  'backend/src/infrastructure/email/email-queue-service.ts',
  'backend/src/infrastructure/email/email-sender.ts',
  'backend/src/interfaces/http/controllers/platform-admin-controller.ts',
  'backend/src/interfaces/http/middlewares/platform-auth.ts',
  'backend/src/interfaces/http/routes/platform-admin-routes.ts',
  'backend/src/interfaces/http/validators/public-validators.ts',
  'backend/src/interfaces/http/validators/rental-payments-validators.ts',
  'backend/src/interfaces/http/validators/tenant-profile-validators.ts',
  'backend/tests/platform-logout-security.test.ts',
  'backend/tests/invoice-email-queue-state.test.ts',
  'backend/tests/platform-invoice-outbox.test.ts',
  'backend/tests/platform-email-facade.test.ts',
  'backend/tests/platform-email-sender-protocol.test.ts',
  'backend/tests/security/platform-production-compatibility.test.ts',
  'docs/platform-production-compatibility-20261115.md'
]);

export function validateDescriptor(value) {
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.kind, 'platform-production-candidate');
  assert.equal(value.target, 'production');
  assert.equal(value.repository, 'Silviomasuccio6/Fleetum');
  assert.equal(value.readyForDeployment, false);
  assert.deepEqual(Object.keys(value.sources).sort(), Object.keys(BASES).sort());
  for (const [role, base] of Object.entries(BASES)) {
    const source = value.sources[role];
    assert.equal(source.baseSha, base, `${role}: unexpected baseline`);
    assert.ok(SHA.test(source.sourceSha) && SHA.test(source.treeSha), `${role}: full source/tree required`);
    assert.ok(HASH.test(source.patchSha256), `${role}: patch hash required`);
    assert.equal(source.patch, `${role}.patch`);
    assert.ok(Array.isArray(source.changedPaths) && source.changedPaths.length > 0);
    assert.equal(new Set(source.changedPaths).size, source.changedPaths.length);
    const allowed = role === 'backend' ? BACKEND_PATHS : FRONTEND_PATHS;
    assert.ok(source.changedPaths.every(p => allowed.has(p)), `${role}: path outside approved scope`);
  }
  return value;
}

export function reconstructSource(repositoryRoot, source, patchFile) {
  const repository = realpathSync(repositoryRoot);
  const git = (args, extra = {}) => execFileSync('git', ['-C', repository, ...args], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, ...extra
  }).trim();
  assert.ok(lstatSync(patchFile).isFile() && !lstatSync(patchFile).isSymbolicLink(), 'Patch must be a regular file');
  const bytes = readFileSync(patchFile);
  assert.ok(bytes.length > 0 && bytes.length <= 2 * 1024 * 1024, 'Unexpected patch size');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.patchSha256, 'Patch checksum mismatch');
  assert.equal(git(['cat-file', '-t', source.sourceSha]), 'commit');
  git(['merge-base', '--is-ancestor', source.baseSha, source.sourceSha]);
  assert.equal(git(['rev-parse', `${source.sourceSha}^{tree}`]), source.treeSha, 'Source tree mismatch');
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'fleetum-platform-index-'));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: path.join(temporary, 'index') };
    git(['read-tree', source.baseSha], { env });
    git(['apply', '--cached', '--binary', '--check', '-'], { env, input: bytes });
    git(['apply', '--cached', '--binary', '-'], { env, input: bytes });
    const treeSha = git(['write-tree'], { env });
    assert.equal(treeSha, source.treeSha, 'Reconstructed tree mismatch');
    const changes = git(['diff', '--no-renames', '--name-status', source.baseSha, treeSha]).split('\n');
    assert.ok(changes.every(line => /^[AM]\t/.test(line)), 'Only file additions and updates are allowed');
    const changedPaths = changes.map(line => line.slice(2)).sort();
    assert.deepEqual(changedPaths, [...source.changedPaths].sort(), 'Changed path inventory mismatch');
    for (const rel of changedPaths) {
      assert.ok(git(['ls-tree', treeSha, '--', rel]).startsWith('100644 blob '), 'Special file mode rejected');
    }
    return { sourceSha: source.sourceSha, treeSha, changedPaths, patchSha256: source.patchSha256 };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

export function verifyCandidate(repositoryRoot, manifestFile) {
  assert.ok(lstatSync(manifestFile).isFile() && !lstatSync(manifestFile).isSymbolicLink(), 'Manifest must be a regular file');
  const descriptor = validateDescriptor(JSON.parse(readFileSync(manifestFile, 'utf8')));
  const patchRoot = realpathSync(path.dirname(manifestFile));
  const sources = {};
  for (const role of Object.keys(BASES)) {
    sources[role] = reconstructSource(repositoryRoot, descriptor.sources[role], path.join(patchRoot, descriptor.sources[role].patch));
  }
  return {
    schemaVersion: 1, kind: 'local-platform-candidate-reconstruction', target: 'production',
    repository: descriptor.repository, sources, readyForDeployment: false,
    evidenceLevel: 'Local Git source and patch reconstruction only; no CI, image, live database or deployment proof',
    ciRunId: null, serverAccessed: false, deployExecuted: false
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { repository: { type: 'string' }, manifest: { type: 'string' }, out: { type: 'string' } } });
    assert.ok(values.repository && values.manifest && values.out, 'Expected --repository, --manifest and --out');
    const result = verifyCandidate(values.repository, values.manifest);
    writeFileSync(values.out, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ sources: Object.keys(result.sources), verified: true, readyForDeployment: false }));
  } catch (error) {
    console.error(`Candidate verification failed: ${error.message}`); process.exitCode = 1;
  }
}
