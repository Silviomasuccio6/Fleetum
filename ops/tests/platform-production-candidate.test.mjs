import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BASES, reconstructSource, validateDescriptor } from '../platform-release/production-candidate.mjs';

const sha = 'a'.repeat(40), hash = 'b'.repeat(64);
const descriptor = () => ({ schemaVersion: 1, kind: 'platform-production-candidate', target: 'production', repository: 'Silviomasuccio6/Fleetum', readyForDeployment: false,
  sources: Object.fromEntries(Object.entries(BASES).map(([role, baseSha]) => [role, { baseSha, sourceSha: sha, treeSha: sha, patchSha256: hash, patch: `${role}.patch`, changedPaths: [role === 'backend' ? 'backend/package.json' : 'frontend/tests/platform-invoice-email-outcome.test.ts'] }])) });

test('the descriptor accepts only the three explicit production source roles', () => {
  assert.equal(validateDescriptor(descriptor()).target, 'production');
  for (const change of [d => { d.target = 'staging'; }, d => { d.readyForDeployment = true; }, d => { delete d.sources.fallback; }, d => { d.repository = 'other/repo'; }]) {
    const d = descriptor(); change(d); assert.throws(() => validateDescriptor(d));
  }
});
test('mutable refs, another baseline, missing hashes and path traversal are rejected', () => {
  for (const change of [d => { d.sources.backend.sourceSha = 'main'; }, d => { d.sources.backend.baseSha = sha; }, d => { d.sources.backend.patchSha256 = ''; }, d => { d.sources.backend.patch = '../backend.patch'; }]) {
    const d = descriptor(); change(d); assert.throws(() => validateDescriptor(d));
  }
});
test('tenant handlers, website files, styles and secrets cannot enter the bounded overlay', () => {
  for (const changed of ['backend/src/application/services/booking-service.ts', 'frontend/src/styles/globals.css', 'website/package.json', '.env', 'backend/.env']) {
    const d = descriptor(); d.sources.backend.changedPaths = [changed]; assert.throws(() => validateDescriptor(d));
  }
  const d = descriptor(); d.sources.satin.changedPaths = ['frontend/src/presentation/pages/booking/booking-page.tsx'];
  assert.throws(() => validateDescriptor(d));
});

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'fleetum-candidate-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q']); git(['config', 'user.email', 'synthetic@example.test']); git(['config', 'user.name', 'Synthetic QA']);
  writeFileSync(path.join(root, 'synthetic.txt'), 'before\n'); git(['add', 'synthetic.txt']); git(['commit', '-qm', 'synthetic baseline']);
  const baseSha = git(['rev-parse', 'HEAD']);
  writeFileSync(path.join(root, 'synthetic.txt'), 'after\n'); git(['add', 'synthetic.txt']); git(['commit', '-qm', 'synthetic patch']);
  const sourceSha = git(['rev-parse', 'HEAD']), treeSha = git(['rev-parse', 'HEAD^{tree}']);
  const bytes = execFileSync('git', ['-C', root, 'diff', '--binary', baseSha, sourceSha]);
  const patchFile = path.join(root, 'synthetic.patch'); writeFileSync(patchFile, bytes);
  const source = { baseSha, sourceSha, treeSha, patchSha256: createHash('sha256').update(bytes).digest('hex'), changedPaths: ['synthetic.txt'] };
  return { root, git, source, patchFile };
}
test('exact reconstruction preserves both the caller worktree and Git index', t => {
  const f = fixture(t), file = path.join(f.root, 'synthetic.txt');
  writeFileSync(file, 'uncommitted caller work\n');
  const indexBefore = createHash('sha256').update(readFileSync(path.join(f.root, '.git/index'))).digest('hex');
  assert.equal(reconstructSource(f.root, f.source, f.patchFile).treeSha, f.source.treeSha);
  assert.equal(readFileSync(file, 'utf8'), 'uncommitted caller work\n');
  assert.equal(createHash('sha256').update(readFileSync(path.join(f.root, '.git/index'))).digest('hex'), indexBefore);
});
test('modified patches fail before they can be applied', t => {
  const f = fixture(t); writeFileSync(f.patchFile, readFileSync(f.patchFile, 'utf8') + '\ncorruption\n');
  assert.throws(() => reconstructSource(f.root, f.source, f.patchFile), /checksum/);
});
test('a source tree cannot be substituted after review', t => {
  const f = fixture(t); f.source.treeSha = f.git(['rev-parse', `${f.source.baseSha}^{tree}`]);
  assert.throws(() => reconstructSource(f.root, f.source, f.patchFile), /Source tree mismatch/);
});
test('the changed file inventory is checked against reconstructed Git objects', t => {
  const f = fixture(t); f.source.changedPaths = ['another.txt'];
  assert.throws(() => reconstructSource(f.root, f.source, f.patchFile), /inventory mismatch/);
});
test('a symlink cannot be used as an overlay patch', t => {
  const f = fixture(t), link = path.join(f.root, 'link.patch'); symlinkSync(f.patchFile, link);
  assert.throws(() => reconstructSource(f.root, f.source, link), /regular file/);
});
