import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { PlatformAdminService } from "../src/application/services/platform-admin-service.js";
import { prisma } from "../src/infrastructure/database/prisma/client.js";
import { requirePlatformAuth } from "../src/interfaces/http/middlewares/platform-auth.js";
import { env } from "../src/shared/config/env.js";

const platformToken = (extra: Record<string, unknown> = {}, secret = env.PLATFORM_JWT_SECRET) => jwt.sign({
  userId: "platform-admin", tenantId: "platform", roles: ["PLATFORM_ADMIN"], permissions: ["platform:manage"],
  platformAdmin: true, tokenType: "platform", ...extra
}, secret, { expiresIn: "5m" });
const authorize = async (token: string) => {
  const req = { headers: { authorization: `Bearer ${token}` } } as any;
  let error: any;
  await requirePlatformAuth(req, {} as any, (value: unknown) => { error = value; });
  return { error, auth: req.auth };
};
const withStore = async (event: any, run: () => Promise<void>, credential: any = null) => {
  const findCredential = prisma.platformAdminCredential.findUnique;
  const findEvent = prisma.platformSecurityEvent.findFirst;
  (prisma.platformAdminCredential as any).findUnique = async () => credential;
  (prisma.platformSecurityEvent as any).findFirst = async () => {
    if (event instanceof Error) throw event;
    return event;
  };
  try { await run(); }
  finally {
    (prisma.platformAdminCredential as any).findUnique = findCredential;
    (prisma.platformSecurityEvent as any).findFirst = findEvent;
  }
};

test("a durable per-token logout event rejects bearer replay on the next Platform request", async () => {
  await withStore({ id: "synthetic-revocation" }, async () => {
    const result = await authorize(platformToken());
    assert.equal(result.error?.code, "PLATFORM_SESSION_REVOKED");
    assert.equal(result.auth, undefined);
  });
});
test("revocation-store failure fails closed instead of admitting a Platform request", async () => {
  await withStore(new Error("Synthetic database failure"), async () => {
    const result = await authorize(platformToken());
    assert.equal(result.error?.statusCode, 503);
    assert.equal(result.auth, undefined);
  });
});
test("independent Platform logins issued in the same second have different tokens", () => {
  const service = new PlatformAdminService({} as any, {} as any, {} as any);
  const originalNow = Date.now;
  Date.now = () => 1791316800000;
  try {
    const first = (service as any).createPlatformSession();
    const second = (service as any).createPlatformSession();
    assert.notEqual(first.token, second.token);
    assert.notEqual((jwt.decode(first.token) as any).jti, (jwt.decode(second.token) as any).jti);
  } finally { Date.now = originalNow; }
});
test("valid unrevoked Platform session remains usable", async () => {
  await withStore(null, async () => {
    const result = await authorize(platformToken());
    assert.equal(result.error, undefined);
    assert.equal(result.auth?.tenantId, "platform");
  });
});
test("a tenant-signed token cannot authorize Platform even with forged Platform claims", async () => {
  await withStore(null, async () => {
    const result = await authorize(platformToken({}, env.JWT_SECRET));
    assert.equal(result.error?.statusCode, 401);
    assert.equal(result.auth, undefined);
  });
});
test("existing password-reset cutoff still revokes prior Platform access", async () => {
  await withStore(null, async () => {
    const result = await authorize(platformToken({ iat: Math.floor(Date.now() / 1000) - 10 }));
    assert.equal(result.error?.code, "PLATFORM_SESSION_REVOKED");
  }, { passwordChangedAt: new Date() });
});
test("Platform-signed tokens with a tenant identity are rejected before business access", async () => {
  await withStore(null, async () => {
    const result = await authorize(platformToken({ tenantId: "synthetic-tenant-a" }));
    assert.equal(result.error?.statusCode, 403);
    assert.equal(result.auth, undefined);
  });
});
