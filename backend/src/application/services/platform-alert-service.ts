import { env } from "../../shared/config/env.js";
import { emailSender } from "../../infrastructure/email/email-sender.js";

export type PlatformAlertType =
  | "PLATFORM_LOGIN_LOCKED"
  | "PLATFORM_LOGIN_FAILURES"
  | "PLATFORM_UNAUTHORIZED_IP"
  | "PLATFORM_LICENSE_CHANGED"
  | "PLATFORM_TENANT_STATUS_CHANGED";

export type PlatformAlertInput = {
  type: PlatformAlertType;
  tenant?: { id: string; name: string } | null;
  actor: string;
  sourceIp: string;
  occurredAt?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  details?: string;
};

export class PlatformAlertService {
  private readonly recipients = env.PLATFORM_ALERT_EMAILS;

  async notify(input: PlatformAlertInput): Promise<void> {
    if (this.recipients.length === 0) return;

    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const subject = `[Platform Alert] ${input.type}`;
    const lines = [
      `eventType: ${input.type}`,
      `tenant: ${input.tenant ? `${input.tenant.name} (${input.tenant.id})` : "n/a"}`,
      `actor: ${input.actor}`,
      `sourceIp: ${input.sourceIp}`,
      `occurredAt: ${occurredAt}`,
      `before: ${JSON.stringify(input.before ?? null)}`,
      `after: ${JSON.stringify(input.after ?? null)}`,
      `details: ${input.details ?? ""}`
    ];

    for (const recipient of this.recipients) {
      try {
        await emailSender.send({
          to: recipient,
          subject,
          text: lines.join("\n")
        });
      } catch {
        // Alerts should never block platform operations.
      }
    }
  }
}
