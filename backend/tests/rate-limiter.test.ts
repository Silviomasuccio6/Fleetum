import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import express from "express";

process.env.NODE_ENV = "test";

const startServer = async (max: number, nodeEnv = "test") => {
  process.env.NODE_ENV = nodeEnv;
  const { createFleetumRateLimiter } = await import("../src/interfaces/http/middlewares/rate-limiter.js");
  const app = express();
  app.use(
    createFleetumRateLimiter({
      name: `test-${max}`,
      windowMs: 60_000,
      max
    })
  );
  app.get("/limited", (_req, res) => res.json({ ok: true }));

  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server address unavailable");
  return { server, url: `http://127.0.0.1:${address.port}/limited` };
};

const closeServer = async (server: http.Server) => {
  server.close();
  await once(server, "close");
};

test("rate limiter returns 429 after N+1 requests with Retry-After header", async () => {
  const { server, url } = await startServer(2);
  try {
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(url)).status, 200);

    const limited = await fetch(url);
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get("retry-after"));

    const body = (await limited.json()) as { error?: string; retryAfter?: number };
    assert.equal(body.error, "Too many requests");
    assert.equal(typeof body.retryAfter, "number");
    assert.ok(body.retryAfter! > 0);
  } finally {
    await closeServer(server);
  }
});
