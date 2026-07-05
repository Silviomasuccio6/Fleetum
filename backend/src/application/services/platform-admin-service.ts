import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import {
  PLAN_MONTHLY_PRICING_EUR,
  SAAS_PLANS,
  ensureKnownPlan,
  estimateLicenseMonthlyRevenue,
  getFeatureListForPlan,
  getPlanMonthlyPrice
} from "./feature-entitlements-service.js";
import {
  PlatformAdminRepository,
  PlatformLicense,
  PlatformLicenseStatus
} from "../../domain/repositories/platform-admin-repository.js";
import { emailSender } from "../../infrastructure/email/email-sender.js";
import { prisma } from "../../infrastructure/database/prisma/client.js";
import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import {
  createPlatformTrustedDeviceToken,
  hashPlatformFingerprint
} from "../../interfaces/http/utils/platform-trusted-device-cookies.js";
import { PlatformAlertService } from "./platform-alert-service.js";
import { PlatformLoginGuardService } from "./platform-login-guard-service.js";

type QuickAction =
  | "ACTIVATE_LICENSE"
  | "SUSPEND_LICENSE"
  | "TRIAL_14_DAYS"
  | "RENEW_30_DAYS"
  | "RENEW_365_DAYS"
  | "DEACTIVATE_TENANT"
  | "REACTIVATE_TENANT";

type SaasPlan = (typeof SAAS_PLANS)[number];

type BreakdownRow = {
  plan: SaasPlan;
  basePrice: number;
  activeTenants: number;
  totalTenants: number;
  seatsTotal: number;
  estimatedRevenue: number;
};

type Snapshot = {
  month: string;
  mrrTotal: number;
  mrrLost: number;
  mrrByPlan: Record<SaasPlan, number>;
  tenantsByPlan: Record<SaasPlan, number>;
  breakdown: BreakdownRow[];
};

const defaultLicense: PlatformLicense = {
  plan: "STARTER",
  seats: 3,
  status: "PENDING",
  expiresAt: null,
  updatedAt: undefined,
  priceMonthly: null,
  billingCycle: "monthly"
};

const addDaysIso = (base: Date, days: number) => {
  const next = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  return next.toISOString();
};

const toMonthStart = (month?: string) => {
  if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    const [year, m] = month.split("-").map(Number);
    return new Date(Date.UTC(year, (m ?? 1) - 1, 1, 0, 0, 0, 0));
  }
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
};

const toMonthEnd = (start: Date) =>
  new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 23, 59, 59, 999));

const shiftMonth = (start: Date, diff: number) =>
  new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + diff, 1, 0, 0, 0, 0));

const toMonthKey = (value: Date) => `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;

const money = (value: number) => Number(value.toFixed(2));

const csvEscape = (value: unknown) => {
  const raw = String(value ?? "");
  const formulaSafe = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${formulaSafe.replace(/"/g, '""')}"`;
};

const hashForSafeCompare = (value: string) => crypto.createHash("sha256").update(value).digest();

const constantTimeEqual = (left: string, right: string) => {
  const leftHash = hashForSafeCompare(left);
  const rightHash = hashForSafeCompare(right);
  return crypto.timingSafeEqual(leftHash, rightHash);
};

const PLATFORM_OTP_TTL_MS = 8 * 60 * 1000;
const PLATFORM_PASSWORD_RESET_TOKEN_TTL_MS = 8 * 60 * 1000;

const maskEmail = (email: string) => email.replace(/^(.{2}).*(@.*)$/, "$1***$2");

const createOtpCode = () => crypto.randomInt(100_000, 1_000_000).toString();

type PlatformOtpPurpose = "login" | "password-reset";
type PlatformPasswordResetTokenPayload = jwt.JwtPayload & {
  tokenType: "platform-password-reset";
  email: string;
  jti: string;
};

const createOtpKey = (email: string, purpose: PlatformOtpPurpose) => `${purpose}:${email}`;
const createPasswordResetTokenKey = (jti: string) => `password-reset-token:${jti}`;
const hashPasswordResetToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

const createPasswordResetToken = (email: string) => {
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + PLATFORM_PASSWORD_RESET_TOKEN_TTL_MS);
  const token = jwt.sign(
    {
      tokenType: "platform-password-reset",
      email,
      jti
    },
    env.PLATFORM_JWT_SECRET,
    { expiresIn: Math.floor(PLATFORM_PASSWORD_RESET_TOKEN_TTL_MS / 1000) }
  );

  return {
    token,
    tokenHash: hashPasswordResetToken(token),
    key: createPasswordResetTokenKey(jti),
    expiresAt
  };
};

const verifyPasswordResetToken = (token: string): PlatformPasswordResetTokenPayload => {
  try {
    const payload = jwt.verify(token, env.PLATFORM_JWT_SECRET) as PlatformPasswordResetTokenPayload;
    if (
      !payload ||
      payload.tokenType !== "platform-password-reset" ||
      typeof payload.email !== "string" ||
      typeof payload.jti !== "string"
    ) {
      throw new Error("Invalid password reset token payload");
    }
    return payload;
  } catch {
    throw new AppError("Sessione recupero password scaduta. Richiedi un nuovo codice OTP.", 401, "PLATFORM_PASSWORD_RESET_TOKEN_INVALID");
  }
};

const platformOtpEmailHtml = (code: string, purpose: PlatformOtpPurpose) => {
  const copy = purpose === "password-reset"
    ? {
        heading: "Reimposta la password Platform",
        description: "Usa questo codice per reimpostare la password della Platform Console. Il codice scade tra 8 minuti.",
        footer: "Se non hai richiesto il cambio password, non condividere il codice e verifica subito i log di accesso."
      }
    : {
        heading: "Codice di verifica amministratore",
        description: "Usa questo codice per completare l'accesso alla Platform Console founder-only. Il codice scade tra 8 minuti.",
        footer: "Se non sei stato tu, cambia subito la password platform e verifica i log di accesso. Non inoltrare questo codice."
      };

  return `
  <div style="margin:0;padding:0;background:#07111f;font-family:Inter,Manrope,Arial,sans-serif;color:#e6ecf2;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:radial-gradient(circle at 20% 0%,rgba(37,99,255,.35),transparent 34rem),radial-gradient(circle at 80% 8%,rgba(0,184,169,.22),transparent 30rem),#07111f;padding:40px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;border:1px solid rgba(230,236,242,.14);border-radius:28px;overflow:hidden;background:linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.035));box-shadow:0 28px 90px rgba(0,0,0,.38);">
          <tr><td style="padding:30px 32px 12px;">
            <div style="display:inline-block;border:1px solid rgba(75,140,255,.38);border-radius:999px;background:rgba(37,99,255,.16);padding:8px 12px;font-size:12px;letter-spacing:.20em;text-transform:uppercase;color:#ffffff;font-weight:900;">Fleetum Platform Console</div>
            <h1 style="margin:16px 0 10px;font-size:30px;line-height:1.1;letter-spacing:-.04em;color:#fff;">${copy.heading}</h1>
            <p style="margin:0;color:#a7b3c7;font-size:15px;line-height:1.65;">${copy.description}</p>
          </td></tr>
          <tr><td style="padding:18px 32px 28px;">
            <div style="border:1px solid rgba(50,221,209,.28);border-radius:22px;background:rgba(5,12,24,.72);padding:24px;text-align:center;">
              <div style="font-size:13px;text-transform:uppercase;letter-spacing:.22em;color:#8ea3c4;font-weight:800;">OTP</div>
              <div style="margin-top:10px;font-size:42px;letter-spacing:.20em;color:#fff;font-weight:900;font-family:Menlo,Consolas,monospace;">${code}</div>
            </div>
          </td></tr>
          <tr><td style="padding:0 32px 32px;">
            <p style="margin:0;color:#7f8da6;font-size:13px;line-height:1.6;">${copy.footer}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </div>
`;
};

type PlatformOtpRecord = {
  key: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
};

type PlatformAdminAuthStore = {
  findPasswordCredential: (email: string) => Promise<{ passwordHash: string } | null>;
  findActiveOtp: (key: string, now: Date) => Promise<PlatformOtpRecord | null>;
  deleteExpiredOtps: (now: Date) => Promise<void>;
  upsertOtp: (input: Omit<PlatformOtpRecord, "attempts"> & { attempts?: number }) => Promise<void>;
  deleteOtp: (key: string) => Promise<void>;
  incrementOtpAttempts: (key: string) => Promise<void>;
  updatePasswordAndConsumeOtp: (input: { email: string; passwordHash: string; changedAt: Date; otpKey: string }) => Promise<void>;
  revokeAllTrustedDevices: (now: Date) => Promise<void>;
  createTrustedDevice: (input: {
    deviceId: string;
    tokenHash: string;
    label: string;
    userAgentHash: string;
    lastIpHash: string;
    expiresAt: Date;
  }) => Promise<void>;
  listTrustedDevices: () => Promise<Array<{
    id: string;
    label: string | null;
    createdAt: Date;
    lastUsedAt: Date | null;
    expiresAt: Date;
    revokedAt: Date | null;
  }>>;
  revokeTrustedDevice: (id: string, now: Date) => Promise<void>;
  appendSecurityEvent: (input: {
    action: string;
    actor?: string | null;
    ipHash?: string | null;
    userAgentHash?: string | null;
    details?: Prisma.InputJsonObject;
  }) => Promise<void>;
};

const platformAdminAuthStore: PlatformAdminAuthStore = {
  findPasswordCredential: (email) =>
    prisma.platformAdminCredential.findUnique({
      where: { email },
      select: { passwordHash: true }
    }),
  findActiveOtp: (key, now) =>
    prisma.platformOtpChallenge.findFirst({
      where: { key, expiresAt: { gt: now } }
    }),
  deleteExpiredOtps: async (now) => {
    await prisma.platformOtpChallenge.deleteMany({ where: { expiresAt: { lt: now } } });
  },
  upsertOtp: async ({ key, codeHash, expiresAt, attempts = 0 }) => {
    await prisma.platformOtpChallenge.upsert({
      where: { key },
      create: { key, codeHash, expiresAt, attempts },
      update: { codeHash, expiresAt, attempts }
    });
  },
  deleteOtp: async (key) => {
    await prisma.platformOtpChallenge.deleteMany({ where: { key } });
  },
  incrementOtpAttempts: async (key) => {
    await prisma.platformOtpChallenge.update({
      where: { key },
      data: { attempts: { increment: 1 } }
    });
  },
  updatePasswordAndConsumeOtp: async ({ email, passwordHash, changedAt, otpKey }) => {
    await prisma.$transaction([
      prisma.platformAdminCredential.upsert({
        where: { email },
        create: { email, passwordHash, passwordChangedAt: changedAt, lastResetAt: changedAt },
        update: { passwordHash, passwordChangedAt: changedAt, lastResetAt: changedAt }
      }),
      prisma.platformOtpChallenge.deleteMany({ where: { key: otpKey } })
    ]);
  },
  revokeAllTrustedDevices: async (now) => {
    await prisma.platformTrustedDevice.updateMany({
      where: { revokedAt: null },
      data: { revokedAt: now }
    });
  },
  createTrustedDevice: async (input) => {
    await prisma.platformTrustedDevice.create({
      data: input
    });
  },
  listTrustedDevices: () =>
    prisma.platformTrustedDevice.findMany({
      orderBy: [{ revokedAt: "asc" }, { lastUsedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        label: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true
      }
    }),
  revokeTrustedDevice: async (id, now) => {
    await prisma.platformTrustedDevice.updateMany({
      where: { id },
      data: { revokedAt: now }
    });
  },
  appendSecurityEvent: async (input) => {
    await prisma.platformSecurityEvent.create({
      data: {
        action: input.action,
        actor: input.actor,
        ipHash: input.ipHash,
        userAgentHash: input.userAgentHash,
        ...(input.details ? { details: input.details } : {})
      }
    });
  }
};

const trustedDeviceLabel = (userAgent?: string | string[] | null) => {
  const value = Array.isArray(userAgent) ? userAgent.join(",") : userAgent ?? "";
  if (/Macintosh|Mac OS X/i.test(value)) return "Mac autorizzato";
  if (/Windows/i.test(value)) return "PC Windows autorizzato";
  if (/iPhone/i.test(value)) return "iPhone autorizzato";
  if (/iPad/i.test(value)) return "iPad autorizzato";
  if (/Android/i.test(value)) return "Dispositivo Android autorizzato";
  return "Dispositivo autorizzato";
};

export class PlatformAdminService {
  constructor(
    private readonly repository: PlatformAdminRepository,
    private readonly alerts: PlatformAlertService,
    private readonly loginGuard: PlatformLoginGuardService,
    private readonly authStore: PlatformAdminAuthStore = platformAdminAuthStore,
    private readonly mailer: Pick<typeof emailSender, "send"> = emailSender
  ) {}

  private isPlatformAdminEmail(email: string) {
    return constantTimeEqual(email, env.PLATFORM_ADMIN_EMAIL.trim().toLowerCase());
  }

  private async passwordHashFor(email: string) {
    const credential = await this.authStore.findPasswordCredential(email);

    return credential?.passwordHash ?? env.PLATFORM_ADMIN_PASSWORD_HASH;
  }

  private createPlatformSession() {
    const token = jwt.sign(
      {
        userId: "platform-admin",
        tenantId: "platform",
        roles: ["PLATFORM_ADMIN"],
        permissions: ["platform:manage"],
        platformAdmin: true,
        tokenType: "platform"
      },
      env.PLATFORM_JWT_SECRET,
      { expiresIn: env.PLATFORM_JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] }
    );

    return {
      token,
      user: { id: "platform-admin", email: env.PLATFORM_ADMIN_EMAIL, firstName: "Platform", lastName: "Admin", roles: ["PLATFORM_ADMIN"] }
    };
  }

  private async issueOtp(email: string, purpose: PlatformOtpPurpose) {
    const code = createOtpCode();
    const now = new Date();
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + PLATFORM_OTP_TTL_MS);
    const challengeKey = createOtpKey(email, purpose);

    await this.authStore.deleteExpiredOtps(now);
    await this.authStore.upsertOtp({ key: challengeKey, codeHash, expiresAt });

    const reset = purpose === "password-reset";
    await this.mailer.send({
      to: email,
      subject: reset ? "Codice recupero password Platform Console Fleetum" : "Codice accesso Platform Console Fleetum",
      text: [
        "Fleetum Platform Console",
        `${reset ? "Codice recupero password" : "Codice OTP"}: ${code}`,
        "Scadenza: 8 minuti.",
        reset
          ? "Se non hai richiesto il cambio password, non condividere questo codice."
          : "Se non sei stato tu, verifica subito la sicurezza dell'account platform."
      ].join("\n"),
      html: platformOtpEmailHtml(code, purpose),
      fromName: "Fleetum Security"
    });
  }

  async login(input: { email: string; password: string; ip: string; userAgent?: string | string[]; otp?: string; trustDevice?: boolean }) {
    const normalizedEmail = input.email.trim().toLowerCase();
    await this.loginGuard.assertAllowed(input.ip, normalizedEmail);

    const emailOk = this.isPlatformAdminEmail(normalizedEmail);
    const passwordOk = await bcrypt.compare(
      input.password,
      emailOk ? await this.passwordHashFor(normalizedEmail) : env.PLATFORM_ADMIN_PASSWORD_HASH
    );

    if (!emailOk || !passwordOk) {
      const failure = await this.loginGuard.registerFailure(input.ip, normalizedEmail);

      if (failure.locked) {
        await this.alerts.notify({
          type: "PLATFORM_LOGIN_LOCKED",
          actor: normalizedEmail,
          sourceIp: input.ip,
          details: `Login locked after ${failure.failures} failures. blockedUntil=${failure.blockedUntil ?? "n/a"}`
        });
      } else if (failure.failures >= Math.max(3, env.PLATFORM_LOGIN_MAX_ATTEMPTS - 1)) {
        await this.alerts.notify({
          type: "PLATFORM_LOGIN_FAILURES",
          actor: normalizedEmail,
          sourceIp: input.ip,
          details: `Repeated failed login attempts: ${failure.failures}`
        });
      }

      throw new AppError("Credenziali platform admin non valide", 401, "UNAUTHORIZED");
    }

    const challengeKey = createOtpKey(normalizedEmail, "login");
    const now = new Date();
    const challenge = await this.authStore.findActiveOtp(challengeKey, now);

    if (!input.otp) {
      await this.issueOtp(normalizedEmail, "login");

      return {
        requiresOtp: true,
        message: `Codice di verifica inviato a ${maskEmail(env.PLATFORM_ADMIN_EMAIL)}`
      };
    }

    if (!challenge) {
      await this.authStore.deleteOtp(challengeKey);
      throw new AppError("Codice OTP scaduto. Richiedi un nuovo codice.", 401, "PLATFORM_OTP_EXPIRED");
    }

    if (challenge.attempts >= 5) {
      await this.authStore.deleteOtp(challengeKey);
      await this.loginGuard.registerFailure(input.ip, normalizedEmail);
      throw new AppError("Troppi tentativi OTP. Richiedi un nuovo codice.", 401, "PLATFORM_OTP_LOCKED");
    }

    const otpHash = crypto.createHash("sha256").update(input.otp).digest("hex");
    const otpOk = constantTimeEqual(otpHash, challenge.codeHash);

    if (!otpOk) {
      await this.authStore.incrementOtpAttempts(challengeKey);
      throw new AppError("Codice OTP non valido", 401, "PLATFORM_OTP_INVALID");
    }

    await this.authStore.deleteOtp(challengeKey);

    await this.loginGuard.registerSuccess(input.ip, normalizedEmail);

    const session = this.createPlatformSession();
    if (!env.PLATFORM_TRUSTED_DEVICE_ENABLED || !input.trustDevice) {
      return session;
    }

    const expiresAt = new Date(Date.now() + env.PLATFORM_TRUSTED_DEVICE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const issued = createPlatformTrustedDeviceToken();
    await this.authStore.createTrustedDevice({
      deviceId: issued.deviceId,
      tokenHash: issued.tokenHash,
      label: trustedDeviceLabel(input.userAgent),
      userAgentHash: hashPlatformFingerprint(input.userAgent),
      lastIpHash: hashPlatformFingerprint(input.ip),
      expiresAt
    });
    await this.authStore.appendSecurityEvent({
      action: "PLATFORM_TRUSTED_DEVICE_CREATED",
      actor: normalizedEmail,
      ipHash: hashPlatformFingerprint(input.ip),
      userAgentHash: hashPlatformFingerprint(input.userAgent),
      details: { label: trustedDeviceLabel(input.userAgent), expiresAt: expiresAt.toISOString() }
    });
    await this.alerts.notify({
      type: "PLATFORM_TRUSTED_DEVICE_CREATED",
      actor: normalizedEmail,
      sourceIp: input.ip,
      details: `Trusted device created. expiresAt=${expiresAt.toISOString()}`
    });

    return {
      ...session,
      trustedDevice: {
        cookieValue: issued.cookieValue,
        expiresAt
      }
    };
  }

  async requestPasswordReset(input: { email: string; ip: string }) {
    const normalizedEmail = input.email.trim().toLowerCase();
    await this.loginGuard.requestPasswordReset(input.ip, normalizedEmail);

    // The same response avoids exposing whether a Platform account exists.
    const message = "Se l'indirizzo e autorizzato, riceverai un codice OTP per reimpostare la password.";
    if (!this.isPlatformAdminEmail(normalizedEmail)) {
      return { message };
    }

    await this.issueOtp(normalizedEmail, "password-reset");
    await this.alerts.notify({
      type: "PLATFORM_PASSWORD_RESET_REQUESTED",
      actor: normalizedEmail,
      sourceIp: input.ip,
      details: "Password reset OTP issued"
    });

    return { message };
  }

  private async assertValidPasswordResetOtp(input: { email: string; otp: string; ip: string }) {
    const normalizedEmail = input.email.trim().toLowerCase();
    await this.loginGuard.assertPasswordResetAllowed(input.ip, normalizedEmail);

    if (!this.isPlatformAdminEmail(normalizedEmail)) {
      throw new AppError("Codice OTP non valido o scaduto", 401, "PLATFORM_PASSWORD_RESET_INVALID");
    }

    const challengeKey = createOtpKey(normalizedEmail, "password-reset");
    const now = new Date();
    const challenge = await this.authStore.findActiveOtp(challengeKey, now);

    if (!challenge) {
      await this.authStore.deleteOtp(challengeKey);
      throw new AppError("Codice OTP scaduto. Richiedi un nuovo codice.", 401, "PLATFORM_PASSWORD_RESET_EXPIRED");
    }

    if (challenge.attempts >= 5) {
      await this.authStore.deleteOtp(challengeKey);
      await this.alerts.notify({
        type: "PLATFORM_PASSWORD_RESET_LOCKED",
        actor: normalizedEmail,
        sourceIp: input.ip,
        details: "Password reset OTP locked after too many attempts"
      });
      throw new AppError("Troppi tentativi OTP. Richiedi un nuovo codice.", 401, "PLATFORM_PASSWORD_RESET_LOCKED");
    }

    const otpHash = crypto.createHash("sha256").update(input.otp).digest("hex");
    if (!constantTimeEqual(otpHash, challenge.codeHash)) {
      await this.authStore.incrementOtpAttempts(challengeKey);
      throw new AppError("Codice OTP non valido o scaduto", 401, "PLATFORM_PASSWORD_RESET_INVALID");
    }

    return { normalizedEmail, challengeKey, now };
  }

  async verifyPasswordReset(input: { email: string; otp: string; ip: string }) {
    const { normalizedEmail, challengeKey } = await this.assertValidPasswordResetOtp(input);
    const resetToken = createPasswordResetToken(normalizedEmail);

    await this.authStore.deleteOtp(challengeKey);
    await this.authStore.upsertOtp({
      key: resetToken.key,
      codeHash: resetToken.tokenHash,
      expiresAt: resetToken.expiresAt
    });

    return {
      message: "Codice OTP verificato. Ora puoi impostare la nuova password.",
      resetToken: resetToken.token
    };
  }

  async confirmPasswordReset(input: { resetToken: string; newPassword: string; ip: string }) {
    const payload = verifyPasswordResetToken(input.resetToken);
    const normalizedEmail = payload.email.trim().toLowerCase();
    const now = new Date();

    if (!this.isPlatformAdminEmail(normalizedEmail)) {
      throw new AppError("Sessione recupero password scaduta. Richiedi un nuovo codice OTP.", 401, "PLATFORM_PASSWORD_RESET_TOKEN_INVALID");
    }

    const resetTokenKey = createPasswordResetTokenKey(payload.jti);
    const challenge = await this.authStore.findActiveOtp(resetTokenKey, now);

    if (!challenge) {
      await this.authStore.deleteOtp(resetTokenKey);
      throw new AppError("Sessione recupero password scaduta. Richiedi un nuovo codice OTP.", 401, "PLATFORM_PASSWORD_RESET_TOKEN_EXPIRED");
    }

    if (!constantTimeEqual(hashPasswordResetToken(input.resetToken), challenge.codeHash)) {
      await this.authStore.incrementOtpAttempts(resetTokenKey);
      throw new AppError("Sessione recupero password non valida. Richiedi un nuovo codice OTP.", 401, "PLATFORM_PASSWORD_RESET_TOKEN_INVALID");
    }

    const passwordHash = await bcrypt.hash(input.newPassword, 12);
    await this.authStore.updatePasswordAndConsumeOtp({
      email: normalizedEmail,
      passwordHash,
      changedAt: now,
      otpKey: resetTokenKey
    });
    await this.authStore.revokeAllTrustedDevices(now);
    await this.loginGuard.clearPasswordReset(input.ip, normalizedEmail);
    await this.loginGuard.registerSuccess(input.ip, normalizedEmail);
    await this.alerts.notify({
      type: "PLATFORM_PASSWORD_RESET_COMPLETED",
      actor: normalizedEmail,
      sourceIp: input.ip,
      details: "Platform password changed through OTP recovery"
    });
    await this.authStore.appendSecurityEvent({
      action: "PLATFORM_TRUSTED_DEVICES_REVOKED_AFTER_PASSWORD_RESET",
      actor: normalizedEmail,
      ipHash: hashPlatformFingerprint(input.ip),
      userAgentHash: null,
      details: { reason: "password-reset" }
    });

    return {
      message: "Password aggiornata. Accedi con la nuova password e completa l'OTP per autorizzare questo dispositivo."
    };
  }

  async listTrustedDevices() {
    const data = await this.authStore.listTrustedDevices();
    return {
      data: data.map((device) => ({
        id: device.id,
        label: device.label,
        createdAt: device.createdAt.toISOString(),
        lastUsedAt: device.lastUsedAt?.toISOString() ?? null,
        expiresAt: device.expiresAt.toISOString(),
        revokedAt: device.revokedAt?.toISOString() ?? null,
        status: device.revokedAt ? "REVOKED" : device.expiresAt < new Date() ? "EXPIRED" : "ACTIVE"
      }))
    };
  }

  async revokeTrustedDevice(input: { id: string; actorUserId: string; sourceIp: string; userAgent?: string | string[] }) {
    const now = new Date();
    await this.authStore.revokeTrustedDevice(input.id, now);
    await this.authStore.appendSecurityEvent({
      action: "PLATFORM_TRUSTED_DEVICE_REVOKED",
      actor: input.actorUserId,
      ipHash: hashPlatformFingerprint(input.sourceIp),
      userAgentHash: hashPlatformFingerprint(input.userAgent),
      details: { deviceId: input.id }
    });
    await this.alerts.notify({
      type: "PLATFORM_TRUSTED_DEVICE_REVOKED",
      actor: input.actorUserId,
      sourceIp: input.sourceIp,
      details: `Trusted device revoked: ${input.id}`
    });
    return { revoked: true };
  }

  async listTenantsWithLicenses() {
    const tenants = await this.repository.listTenants();
    const data = await Promise.all(
      tenants.map(async (tenant) => {
        const owners = tenant.users.filter((u) => u.roles.some((r) => r.role.key === "ADMIN"));
        const latestLicense = (await this.repository.getLatestLicense(tenant.id)) ?? defaultLicense;
        const plan = ensureKnownPlan(latestLicense.plan);
        const license = {
          ...latestLicense,
          plan,
          priceMonthly: latestLicense.priceMonthly ?? getPlanMonthlyPrice(plan),
          billingCycle: latestLicense.billingCycle ?? "monthly"
        };

        return {
          id: tenant.id,
          name: tenant.name,
          company: tenant.tenantProfile
            ? {
                legalName: tenant.tenantProfile.legalName,
                tradeName: tenant.tenantProfile.tradeName,
                vatNumber: tenant.tenantProfile.vatNumber,
                email: tenant.tenantProfile.email,
                phone: tenant.tenantProfile.phone,
                hasLogo: Boolean(tenant.tenantBranding?.logoFilePath),
                profileCompleted: Boolean(tenant.tenantProfile.profileCompletedAt),
                onboardingStatus: tenant.tenantProfile.profileCompletedAt ? "COMPLETE" : "INCOMPLETE"
              }
            : {
                legalName: tenant.name,
                tradeName: tenant.name,
                vatNumber: null,
                email: null,
                phone: null,
                hasLogo: false,
                profileCompleted: false,
                onboardingStatus: "MISSING"
              },
          isActive: tenant.isActive,
          createdAt: tenant.createdAt,
          updatedAt: tenant.updatedAt,
          owner: owners[0]
            ? {
                id: owners[0].id,
                firstName: owners[0].firstName,
                lastName: owners[0].lastName,
                email: owners[0].email,
                status: owners[0].status
              }
            : null,
          usersCount: tenant._count.users,
          vehiclesCount: tenant._count.vehicles,
          stoppagesCount: tenant._count.stoppages,
          license,
          features: getFeatureListForPlan(plan)
        };
      })
    );
    return { data };
  }

  async listRecentEvents(limit: number) {
    const data = await this.repository.listRecentPlatformEvents(limit);
    return { data };
  }

  async listUsersGlobal() {
    const data = await this.repository.listUsersGlobal();
    return { data };
  }

  async tenantCompanyProfile(tenantId: string) {
    const data = await this.repository.getTenantCompanyProfile(tenantId);
    if (!data) throw new AppError("Tenant non trovato", 404, "NOT_FOUND");
    return { data };
  }

  async tenantOnboardingStatus(tenantId: string) {
    const data = (await this.repository.getTenantCompanyProfile(tenantId)) as any;
    if (!data) throw new AppError("Tenant non trovato", 404, "NOT_FOUND");
    const profile = data.tenantProfile;
    const branding = data.tenantBranding;
    const required = ["legalName", "vatNumber", "legalAddress", "city", "province", "postalCode", "email", "phone"];
    const missing = profile ? required.filter((key) => !String(profile[key] ?? "").trim()) : required;
    if (!branding?.logoFilePath) missing.push("logo");
    return {
      data: {
        tenantId,
        status: missing.length === 0 ? "COMPLETE" : "INCOMPLETE",
        profileCompletedAt: profile?.profileCompletedAt ?? null,
        missing,
        percentage: Math.round(((required.length + 1 - missing.length) / (required.length + 1)) * 100)
      }
    };
  }

  async updateLicense(input: {
    tenantId: string;
    actorUserId: string;
    sourceIp: string;
    plan: string;
    seats: number;
    status: PlatformLicenseStatus;
    expiresAt?: string | null;
    priceMonthly?: number | null;
    billingCycle?: "monthly" | "yearly";
  }) {
    const tenant = await this.repository.getTenantById(input.tenantId);
    if (!tenant) throw new AppError("Tenant non trovato", 404, "NOT_FOUND");

    const before = (await this.repository.getLatestLicense(input.tenantId)) ?? defaultLicense;
    const plan = ensureKnownPlan(input.plan);
    const after: PlatformLicense = {
      plan,
      seats: input.seats,
      status: input.status,
      expiresAt: input.expiresAt ?? null,
      updatedAt: new Date().toISOString(),
      priceMonthly: input.priceMonthly === undefined || input.priceMonthly === null ? getPlanMonthlyPrice(plan) : input.priceMonthly,
      billingCycle: input.billingCycle ?? before.billingCycle ?? "monthly"
    };

    await this.repository.setLicense(input.tenantId, input.actorUserId, after);
    await this.repository.appendPlatformAudit({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "PLATFORM_LICENSE_UPDATED",
      resource: "tenant",
      resourceId: input.tenantId,
      details: {
        actor: input.actorUserId,
        sourceIp: input.sourceIp,
        happenedAt: new Date().toISOString(),
        before,
        after
      }
    });

    await this.alerts.notify({
      type: "PLATFORM_LICENSE_CHANGED",
      tenant,
      actor: input.actorUserId,
      sourceIp: input.sourceIp,
      before,
      after
    });

    return { updated: true, before, after };
  }

  async updateTenantStatus(input: { tenantId: string; actorUserId: string; sourceIp: string; isActive: boolean }) {
    const tenant = await this.repository.getTenantById(input.tenantId);
    if (!tenant) throw new AppError("Tenant non trovato", 404, "NOT_FOUND");

    const before = { isActive: tenant.isActive };
    const after = { isActive: input.isActive };

    await this.repository.setTenantActive(input.tenantId, input.isActive);
    await this.repository.appendPlatformAudit({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "PLATFORM_TENANT_STATUS_CHANGED",
      resource: "tenant",
      resourceId: input.tenantId,
      details: {
        actor: input.actorUserId,
        sourceIp: input.sourceIp,
        happenedAt: new Date().toISOString(),
        before,
        after
      }
    });

    await this.alerts.notify({
      type: "PLATFORM_TENANT_STATUS_CHANGED",
      tenant,
      actor: input.actorUserId,
      sourceIp: input.sourceIp,
      before,
      after
    });

    return { updated: true, before, after };
  }

  async executeQuickAction(input: {
    tenantId: string;
    actorUserId: string;
    sourceIp: string;
    action: QuickAction;
  }) {
    const tenant = await this.repository.getTenantById(input.tenantId);
    if (!tenant) throw new AppError("Tenant non trovato", 404, "NOT_FOUND");

    const currentLicense = (await this.repository.getLatestLicense(input.tenantId)) ?? defaultLicense;
    const now = new Date();

    if (input.action === "DEACTIVATE_TENANT" || input.action === "REACTIVATE_TENANT") {
      const isActive = input.action === "REACTIVATE_TENANT";
      const tenantStatusResult = await this.updateTenantStatus({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        sourceIp: input.sourceIp,
        isActive
      });

      let nextStatus: PlatformLicenseStatus | null = null;
      if (input.action === "DEACTIVATE_TENANT" && (currentLicense.status === "ACTIVE" || currentLicense.status === "TRIAL")) {
        nextStatus = "SUSPENDED";
      }
      if (input.action === "REACTIVATE_TENANT" && currentLicense.status === "SUSPENDED") {
        nextStatus = "ACTIVE";
      }

      if (!nextStatus) {
        return { ...tenantStatusResult, action: input.action, before: currentLicense, after: currentLicense };
      }

      const after: PlatformLicense = {
        ...currentLicense,
        status: nextStatus,
        updatedAt: new Date().toISOString()
      };

      await this.repository.setLicense(input.tenantId, input.actorUserId, after);
      await this.repository.appendPlatformAudit({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "PLATFORM_LICENSE_QUICK_ACTION",
        resource: "tenant",
        resourceId: input.tenantId,
        details: {
          quickAction: input.action,
          actor: input.actorUserId,
          sourceIp: input.sourceIp,
          happenedAt: new Date().toISOString(),
          before: currentLicense,
          after
        }
      });

      await this.alerts.notify({
        type: "PLATFORM_LICENSE_CHANGED",
        tenant,
        actor: input.actorUserId,
        sourceIp: input.sourceIp,
        before: currentLicense,
        after
      });

      return { ...tenantStatusResult, action: input.action, before: currentLicense, after };
    }

    let nextLicense = { ...currentLicense };

    if (input.action === "ACTIVATE_LICENSE") {
      nextLicense = { ...nextLicense, status: "ACTIVE" };
    }
    if (input.action === "SUSPEND_LICENSE") {
      nextLicense = { ...nextLicense, status: "SUSPENDED" };
    }
    if (input.action === "TRIAL_14_DAYS") {
      nextLicense = {
        ...nextLicense,
        status: "TRIAL",
        expiresAt: addDaysIso(now, 14)
      };
    }
    if (input.action === "RENEW_30_DAYS" || input.action === "RENEW_365_DAYS") {
      const days = input.action === "RENEW_30_DAYS" ? 30 : 365;
      const base = nextLicense.expiresAt ? new Date(nextLicense.expiresAt) : now;
      const safeBase = base.getTime() > now.getTime() ? base : now;
      nextLicense = {
        ...nextLicense,
        status: "ACTIVE",
        expiresAt: addDaysIso(safeBase, days)
      };
    }

    const after: PlatformLicense = { ...nextLicense, updatedAt: new Date().toISOString() };

    await this.repository.setLicense(input.tenantId, input.actorUserId, after);
    await this.repository.appendPlatformAudit({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "PLATFORM_LICENSE_QUICK_ACTION",
      resource: "tenant",
      resourceId: input.tenantId,
      details: {
        quickAction: input.action,
        actor: input.actorUserId,
        sourceIp: input.sourceIp,
        happenedAt: new Date().toISOString(),
        before: currentLicense,
        after
      }
    });

    await this.alerts.notify({
      type: "PLATFORM_LICENSE_CHANGED",
      tenant,
      actor: input.actorUserId,
      sourceIp: input.sourceIp,
      before: currentLicense,
      after
    });

    return { updated: true, action: input.action, before: currentLicense, after };
  }

  private async buildSnapshot(
    tenants: Array<{ id: string; isActive: boolean }>,
    at: Date,
    licenseCache: Map<string, PlatformLicense | null>
  ): Promise<Snapshot> {
    const month = toMonthKey(at);
    const mrrByPlan = Object.fromEntries(SAAS_PLANS.map((plan) => [plan, 0])) as Record<SaasPlan, number>;
    const tenantsByPlan = Object.fromEntries(SAAS_PLANS.map((plan) => [plan, 0])) as Record<SaasPlan, number>;
    const breakdownMap = Object.fromEntries(
      SAAS_PLANS.map((plan) => [
        plan,
        {
          plan,
          basePrice: getPlanMonthlyPrice(plan),
          activeTenants: 0,
          totalTenants: 0,
          seatsTotal: 0,
          estimatedRevenue: 0
        }
      ])
    ) as Record<SaasPlan, BreakdownRow>;

    let mrrTotal = 0;
    let mrrLost = 0;

    const getLicenseAt = async (tenantId: string) => {
      const cacheKey = `${tenantId}:${month}`;
      if (!licenseCache.has(cacheKey)) {
        const license = await this.repository.getLatestLicenseAtOrBefore(tenantId, at);
        licenseCache.set(cacheKey, license);
      }
      return licenseCache.get(cacheKey) ?? null;
    };

    for (const tenant of tenants) {
      const snapshot = (await getLicenseAt(tenant.id)) ?? defaultLicense;
      const plan = ensureKnownPlan(snapshot.plan);
      const revenue = estimateLicenseMonthlyRevenue({
        plan,
        seats: snapshot.seats,
        priceMonthly: snapshot.priceMonthly,
        billingCycle: snapshot.billingCycle
      });

      const row = breakdownMap[plan];
      row.totalTenants += 1;
      row.seatsTotal += revenue.seatsFactor;
      tenantsByPlan[plan] += 1;

      if (snapshot.status === "ACTIVE") {
        row.activeTenants += 1;
        row.estimatedRevenue += revenue.estimatedMrr;
        mrrTotal += revenue.estimatedMrr;
        mrrByPlan[plan] += revenue.estimatedMrr;
      }

      if (snapshot.status === "PENDING" || snapshot.status === "SUSPENDED" || snapshot.status === "EXPIRED" || snapshot.status === "PAST_DUE" || snapshot.status === "CANCELED") {
        mrrLost += revenue.estimatedMrr;
      }
    }

    const breakdown = SAAS_PLANS.map((plan) => {
      const row = breakdownMap[plan];
      return {
        ...row,
        estimatedRevenue: money(row.estimatedRevenue)
      };
    });

    return {
      month,
      mrrTotal: money(mrrTotal),
      mrrLost: money(mrrLost),
      mrrByPlan: SAAS_PLANS.reduce(
        (acc, plan) => ({ ...acc, [plan]: money(mrrByPlan[plan]) }),
        {} as Record<SaasPlan, number>
      ),
      tenantsByPlan,
      breakdown
    };
  }

  async revenueReport(input: { month?: string; months: number }) {
    const selectedMonthStart = toMonthStart(input.month);
    const previousMonthStart = shiftMonth(selectedMonthStart, -1);
    const trendSize = Math.max(2, Math.min(12, input.months));

    const trendMonthStarts = Array.from({ length: trendSize }, (_, idx) =>
      shiftMonth(selectedMonthStart, idx - (trendSize - 1))
    );

    const tenants = await this.repository.listTenants();
    const licenseCache = new Map<string, PlatformLicense | null>();

    const selectedSnapshot = await this.buildSnapshot(
      tenants,
      toMonthEnd(selectedMonthStart),
      licenseCache
    );
    const previousSnapshot = await this.buildSnapshot(
      tenants,
      toMonthEnd(previousMonthStart),
      licenseCache
    );

    const trend = await Promise.all(
      trendMonthStarts.map(async (monthStart) => {
        const snapshot = await this.buildSnapshot(tenants, toMonthEnd(monthStart), licenseCache);
        return {
          month: snapshot.month,
          mrrTotal: snapshot.mrrTotal,
          mrrLost: snapshot.mrrLost
        };
      })
    );

    return {
      selectedMonth: selectedSnapshot.month,
      previousMonth: previousSnapshot.month,
      planPricing: PLAN_MONTHLY_PRICING_EUR,
      assumptions: {
        formula: "MRR tenant = prezzo mensile (override o piano) x seatsFactor",
        seatsFactorRule: "seatsFactor = max(1, seats)",
        billingCycleRule: "Se billingCycle=yearly, il prezzo viene normalizzato in quota mensile (prezzo/12)."
      },
      kpis: {
        mrrTotal: selectedSnapshot.mrrTotal,
        mrrLost: selectedSnapshot.mrrLost,
        deltaFromPrevious: money(selectedSnapshot.mrrTotal - previousSnapshot.mrrTotal),
        tenantsByPlan: selectedSnapshot.tenantsByPlan,
        mrrByPlan: selectedSnapshot.mrrByPlan
      },
      breakdown: selectedSnapshot.breakdown,
      trend
    };
  }

  async revenueReportCsv(input: { month?: string; months: number }) {
    const report = await this.revenueReport(input);

    const rows: Array<Record<string, unknown>> = [
      ...report.breakdown.map((row) => ({
        section: "BREAKDOWN",
        month: report.selectedMonth,
        plan: row.plan,
        basePrice: row.basePrice,
        activeTenants: row.activeTenants,
        totalTenants: row.totalTenants,
        seatsTotal: row.seatsTotal,
        estimatedRevenue: row.estimatedRevenue,
        mrrTotal: report.kpis.mrrTotal,
        mrrLost: report.kpis.mrrLost,
        deltaFromPrevious: report.kpis.deltaFromPrevious
      })),
      ...report.trend.map((row) => ({
        section: "TREND",
        month: row.month,
        plan: "ALL",
        basePrice: "",
        activeTenants: "",
        totalTenants: "",
        seatsTotal: "",
        estimatedRevenue: row.mrrTotal,
        mrrTotal: row.mrrTotal,
        mrrLost: row.mrrLost,
        deltaFromPrevious: ""
      }))
    ];

    const headers = [
      "section",
      "month",
      "plan",
      "basePrice",
      "activeTenants",
      "totalTenants",
      "seatsTotal",
      "estimatedRevenue",
      "mrrTotal",
      "mrrLost",
      "deltaFromPrevious"
    ];

    const csv = [headers.join(","), ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(","))].join("\n");

    return {
      fileName: `platform-revenue-${report.selectedMonth}.csv`,
      csv
    };
  }
}
