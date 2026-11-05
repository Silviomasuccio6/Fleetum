// Plain HTTP is restricted to a numeric loopback address for the synthetic lab.
// Never follow a redirect or attach browser credentials to this readiness probe.
export async function readUiPreviewHealth(base) {
  const origin = new URL(base);
  if (origin.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(origin.hostname) ||
      origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('UI verification requires a numeric loopback origin');
  }
  const response = await fetch(new URL('/api/health', origin), {
    redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(5000),
    headers: {Accept: 'application/json'}
  });
  if (!response.ok) throw new Error('UI preview health check failed');
  const health = await response.json();
  if (health?.mode !== 'ui-preview') throw new Error('Refuse to test any real application server');
  return health;
}
