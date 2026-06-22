import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PlatformAdminService } from "../src/application/services/platform-admin-service.js";
import { env } from "../src/shared/config/env.js";

type OtpRecord = {
  key: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
};

const makeService = () => {
  const otps = new Map<string, OtpRecord>();
  const sentMessages: Array<{ text: string }> = [];
  let passwordHash: string | null = null;
  let resetRequests = 0;
  let resetsCleared = 0;
  let loginSuccesses = 0;

  const authStore = {
    findPasswordCredential: async () => passwordHash ? { passwordHash } : null,
    findActiveOtp: async (key: string, now: Date) => {
      const record = otps.get(key);
      return record && record.expiresAt > now ? record : null;
    },
    deleteExpiredOtps: async (now: Date) => {
      for (const [key, value] of otps.entries()) if (value.expiresAt < now) otps.delete(key);
    },
    upsertOtp: async (input: Omit<OtpRecord, "attempts"> & { attempts?: number }) => {
      otps.set(input.key, { ...input, attempts: input.attempts ?? 0 });
    },
    deleteOtp: async (key: string) => {
      otps.delete(key);
    },
    incrementOtpAttempts: async (key: string) => {
      const record = otps.get(key);
      if (record) record.attempts += 1;
    },
    updatePasswordAndConsumeOtp: async (input: { passwordHash: string; otpKey: string }) => {
      passwordHash = input.passwordHash;
      otps.delete(input.otpKey);
    }
  };

  const loginGuard = {
    assertAllowed: async () => {},
    registerFailure: async () => ({ locked: false, failures: 1 }),
    registerSuccess: async () => { loginSuccesses += 1; },
    requestPasswordReset: async () => { resetRequests += 1; },
    assertPasswordResetAllowed: async () => {},
    clearPasswordReset: async () => { resetsCleared += 1; }
  };

  const service = new PlatformAdminService(
    {} as any,
    { notify: async () => {} } as any,
    loginGuard as any,
    authStore as any,
    {
      send: async (input: { text: string }) => {
        sentMessages.push({ text: input.text });
        return { provider: "resend" as const, id: "email_test" };
      }
    }
  );

  return {
    service,
    otps,
    sentMessages,
    getPasswordHash: () => passwordHash,
    getResetRequests: () => resetRequests,
    getResetsCleared: () => resetsCleared,
    getLoginSuccesses: () => loginSuccesses
  };
};

test("platform password recovery persists a bcrypt hash and creates a platform session", async () => {
  const fixture = makeService();
  const email = env.PLATFORM_ADMIN_EMAIL;

  const request = await fixture.service.requestPasswordReset({ email, ip: "127.0.0.1" });
  assert.match(request.message, /codice OTP/i);
  assert.equal(fixture.getResetRequests(), 1);
  assert.equal(fixture.sentMessages.length, 1);

  const code = fixture.sentMessages[0]?.text.match(/: (\d{6})/)?.[1];
  assert.ok(code);
  assert.ok(fixture.otps.has(`password-reset:${email}`));

  const result = await fixture.service.confirmPasswordReset({
    email,
    otp: code,
    newPassword: "a-new-platform-password-with-16-chars",
    ip: "127.0.0.1"
  });

  assert.match(result.message, /Password aggiornata/i);
  assert.equal(typeof result.token, "string");
  assert.equal(jwt.verify(result.token!, env.PLATFORM_JWT_SECRET).tokenType, "platform");
  assert.equal(fixture.otps.has(`password-reset:${email}`), false);
  assert.equal(fixture.getResetsCleared(), 1);
  assert.equal(fixture.getLoginSuccesses(), 1);
  assert.equal(await bcrypt.compare("a-new-platform-password-with-16-chars", fixture.getPasswordHash()!), true);
});

test("platform password recovery returns a generic response for an unauthorized email without sending an OTP", async () => {
  const fixture = makeService();
  const result = await fixture.service.requestPasswordReset({ email: "unknown@example.test", ip: "127.0.0.1" });

  assert.match(result.message, /autorizzato/i);
  assert.equal(fixture.sentMessages.length, 0);
  assert.equal(fixture.otps.size, 0);
});

test("platform password recovery rejects an invalid OTP and records an attempt", async () => {
  const fixture = makeService();
  const email = env.PLATFORM_ADMIN_EMAIL;
  const key = `password-reset:${email}`;
  fixture.otps.set(key, {
    key,
    codeHash: crypto.createHash("sha256").update("123456").digest("hex"),
    expiresAt: new Date(Date.now() + 60_000),
    attempts: 0
  });

  await assert.rejects(
    fixture.service.confirmPasswordReset({
      email,
      otp: "654321",
      newPassword: "a-new-platform-password-with-16-chars",
      ip: "127.0.0.1"
    }),
    (error: { code?: string }) => error.code === "PLATFORM_PASSWORD_RESET_INVALID"
  );

  assert.equal(fixture.otps.get(key)?.attempts, 1);
});
