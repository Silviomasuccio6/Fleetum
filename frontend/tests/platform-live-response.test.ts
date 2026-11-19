import assert from "node:assert/strict";
import test from "node:test";
import { readPlatformLiveResponse } from "../src/application/usecases/platform/platform-live-response";

test("missing live endpoint cannot turn into a fabricated zero-revenue snapshot", async () => {
  await assert.rejects(readPlatformLiveResponse(new Response("Not found", { status: 404 })),
    (error: Error & { status?: number }) => error.status === 404 && /non disponibili/.test(error.message));
});

test("live metrics auth errors retain status and code for the existing login handler", async () => {
  await assert.rejects(readPlatformLiveResponse(Response.json({ message: "Sessione scaduta", code: "UNAUTHORIZED" }, { status: 401 })),
    (error: Error & { status?: number; code?: string }) => error.status === 401 && error.code === "UNAUTHORIZED" && error.message === "Sessione scaduta");
});

test("a successful real zero snapshot is retained while malformed success is rejected", async () => {
  const payload = { activeUsersLive: 0, mrrMonthly: 0, topTenants: [], generatedAt: "2026-11-13T12:00:00Z" };
  assert.deepEqual(await readPlatformLiveResponse(Response.json(payload)), payload);
  await assert.rejects(readPlatformLiveResponse(new Response("Invalid JSON", { status: 200 })), /non valida/);
});
