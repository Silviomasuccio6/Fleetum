import { Resend } from "resend";
import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { FleetumEmailProvider, FleetumEnvironment } from "../../shared/config/staging-safety.js";

export type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  fromName?: string | null;
  replyTo?: string | null;
  attachments?: EmailAttachment[];
  idempotencyKey?: string;
};

const normalizeRecipients = (to: string | string[]) => (Array.isArray(to) ? to : [to]).filter(Boolean);

const sanitizeDisplayName = (value?: string | null) => String(value ?? "").replace(/[<>\r\n"]/g, " ").replace(/\s+/g, " ").trim();

type EmailSenderConfig = {
  environment: FleetumEnvironment;
  provider: FleetumEmailProvider;
  resendApiKey?: string;
  resendFrom?: string;
};

type ResendClient = Pick<Resend, "emails">;
type ResendClientFactory = (apiKey: string) => ResendClient;

export const createEmailSender = (
  config: EmailSenderConfig,
  createResendClient: ResendClientFactory = (apiKey) => new Resend(apiKey)
) => {
  let resend: ResendClient | undefined;

  const resolveFrom = (fromName?: string | null) => {
    const base = config.resendFrom;
    if (!base) throw new AppError("Provider email non configurato", 503, "EMAIL_PROVIDER_NOT_CONFIGURED");
    const match = base.match(/<([^>]+)>/);
    const email = match?.[1] ?? base;
    const displayName = sanitizeDisplayName(fromName);
    return displayName ? `${displayName} <${email}>` : base;
  };

  const send = async (input: SendEmailInput) => {
    // This guard runs before SDK construction and before the message payload is
    // passed to any provider. A blocked staging send is a visible failure so
    // queue rows cannot be mistaken for successful delivery.
    if (config.environment === "staging") {
      throw new AppError("Invio email disabilitato in staging", 503, "STAGING_EMAIL_DISABLED");
    }
    if (config.provider === "disabled") {
      throw new AppError("Provider email disabilitato", 503, "EMAIL_PROVIDER_DISABLED");
    }
    if (!config.resendApiKey) {
      throw new AppError("Provider email non configurato", 503, "EMAIL_PROVIDER_NOT_CONFIGURED");
    }

    resend ??= createResendClient(config.resendApiKey);
    const { data, error } = await resend.emails.send(
      {
        from: resolveFrom(input.fromName),
        to: normalizeRecipients(input.to),
        subject: input.subject,
        text: input.text,
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
        ...(input.html ? { html: input.html } : {}),
        ...(input.attachments?.length
          ? {
              attachments: input.attachments.map((attachment) => ({
                filename: attachment.filename,
                content: attachment.content,
                ...(attachment.contentType ? { contentType: attachment.contentType } : {})
              }))
            }
          : {})
      },
      input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined
    );

    if (error) {
      throw new AppError(error.message || "Invio email Resend fallito", 502, "RESEND_EMAIL_FAILED");
    }

    return { provider: "resend" as const, id: data?.id ?? null };
  };

  return { send };
};

export const emailSender = createEmailSender({
  environment: env.FLEETUM_ENVIRONMENT,
  provider: env.EMAIL_PROVIDER,
  resendApiKey: env.RESEND_API_KEY,
  resendFrom: env.RESEND_FROM
});
