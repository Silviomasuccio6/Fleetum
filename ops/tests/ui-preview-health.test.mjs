import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {readUiPreviewHealth} from '../ui-preview-health.mjs';

test('UI health probe rejects non-loopback targets and credentials before network access', async () => {
  for (const target of ['https://127.0.0.1:5180', 'http://localhost:5180', 'http://127.0.0.1.example.invalid',
    'http://192.0.2.1', 'http://user:password@127.0.0.1', 'http://127.0.0.1/path',
    'http://127.0.0.1?redirect=external', 'http://127.0.0.1/#fragment']) {
    await assert.rejects(readUiPreviewHealth(target), /numeric loopback origin/);
  }
});

test('UI health probe accepts only the local synthetic lab and never follows redirects', async t => {
  let mode = 'preview', destinationCalls = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/destination') { destinationCalls++; response.end('{}'); return; }
    assert.equal(request.url, '/api/health');
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.cookie, undefined);
    if (mode === 'redirect') { response.writeHead(302, {Location: '/destination'}); response.end(); return; }
    response.writeHead(mode === 'failure' ? 503 : 200, {'Content-Type': 'application/json'});
    response.end(JSON.stringify({mode: mode === 'preview' ? 'ui-preview' : 'application'}));
  });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await readUiPreviewHealth(base), {mode: 'ui-preview'});
  mode = 'application'; await assert.rejects(readUiPreviewHealth(base), /Refuse to test/);
  mode = 'failure'; await assert.rejects(readUiPreviewHealth(base), /health check failed/);
  mode = 'redirect'; await assert.rejects(readUiPreviewHealth(base)); assert.equal(destinationCalls, 0);
});
