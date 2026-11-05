import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {runInNewContext} from 'node:vm';
import redirects from 'follow-redirects';

test('cross-origin redirects strip declared credentials from same-realm and cross-realm header lists', async t => {
  let received;
  const destination = http.createServer((request, response) => {
    received = request.headers;
    response.end('ok');
  });
  destination.listen(0, '127.0.0.1');
  await once(destination, 'listening');
  const origin = http.createServer((_request, response) => {
    response.writeHead(302, {Location: `http://127.0.0.1:${destination.address().port}/`});
    response.end();
  });
  origin.listen(0, '127.0.0.1');
  await once(origin, 'listening');
  t.after(async () => {
    await Promise.all([origin, destination].map(server => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    })));
  });
  for (const sensitiveHeaders of [['x-fleetum-test-credential'], runInNewContext('["x-fleetum-test-credential"]')]) {
    received = undefined;
    await new Promise((resolve, reject) => {
      const request = redirects.http.get(`http://127.0.0.1:${origin.address().port}/`, {
        sensitiveHeaders,
        headers: {'X-Fleetum-Test-Credential': 'fixture', 'X-Control': 'retained'}
      }, response => {
        response.resume();
        response.once('end', resolve);
        response.once('error', reject);
      });
      request.setTimeout(5000, () => request.destroy(new Error('Local redirect test timed out')));
      request.once('error', reject);
    });
    assert.equal(received?.['x-fleetum-test-credential'], undefined, 'custom credentials must not reach the other origin');
    assert.equal(received?.['x-control'], 'retained', 'unrelated headers should remain available');
  }
});
