import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createHash } from "node:crypto";
import { SocialOAuthService } from "../../src/application/services/social-oauth-service.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { env } from "../../src/shared/config/env.js";

const runId = `oauth-flow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const stateHash = (state: string) => createHash("sha256").update(state, "utf8").digest("hex");

describe("OAuth flow persistence", () => {
  before(async () => {
    // This suite tests local persistence, not Google connectivity. Provider
    // configuration must never depend on developer or production credentials.
    Object.assign(env, {
      GOOGLE_CLIENT_ID: "oauth-persistence-client.apps.example.test",
      GOOGLE_CLIENT_SECRET: "oauth-persistence-synthetic-secret",
      GOOGLE_REDIRECT_URI: "https://oauth.example.test/api/auth/google/callback"
    });
    await prisma.$connect();
    const table = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'OauthFlow'
    `;
    assert.equal(table.length, 1, "OAuth persistence test requires the OauthFlow migration");
  });

  after(async () => {
    await prisma.oauthFlow.deleteMany({ where: { returnTo: { startsWith: `/${runId}` } } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("stores only hashes for state/browser binding and atomically permits one callback", async () => {
    const service = new SocialOAuthService();
    const flow = await service.createState("google", "login", `/${runId}/return`);
    const stored = await prisma.oauthFlow.findUniqueOrThrow({ where: { stateHash: stateHash(flow.state) } });

    assert.notEqual(stored.stateHash, flow.state);
    assert.notEqual(stored.browserBindingHash, flow.browserBinding);
    assert.equal(stored.stateHash, stateHash(flow.state));
    assert.equal(stored.browserBindingHash, stateHash(flow.browserBinding));
    assert.equal(stored.consumedAt, null);
    assert.ok(stored.codeVerifier);
    assert.ok(stored.oidcNonce);

    await assert.rejects(
      () => service.consumeState("google", flow.state, "binding-from-browser-b"),
      (error: any) => error?.code === "OAUTH_BROWSER_MISMATCH"
    );
    const afterWrongBrowser = await prisma.oauthFlow.findUniqueOrThrow({ where: { stateHash: stateHash(flow.state) } });
    assert.equal(afterWrongBrowser.consumedAt, null);

    const concurrent = await Promise.allSettled([
      service.consumeState("google", flow.state, flow.browserBinding),
      service.consumeState("google", flow.state, flow.browserBinding)
    ]);
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
    const winner = concurrent.find((result) => result.status === "fulfilled");
    const loser = concurrent.find((result) => result.status === "rejected");
    assert.ok(winner?.status === "fulfilled");
    assert.ok(loser?.status === "rejected");
    assert.equal(loser.reason?.code, "OAUTH_STATE_REPLAYED");
    assert.equal(winner.value.codeVerifier, stored.codeVerifier);
    assert.equal(winner.value.oidcNonce, stored.oidcNonce);

    const consumed = await prisma.oauthFlow.findUniqueOrThrow({ where: { stateHash: stateHash(flow.state) } });
    assert.ok(consumed.consumedAt);
    assert.equal(consumed.codeVerifier, null);
    assert.equal(consumed.oidcNonce, null);
  });
});
