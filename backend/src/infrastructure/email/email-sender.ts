import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { mailer } from "./mailer.js";

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
};

const RESEND_API_URL = "https://api.resend.com/emails";

const normalizeRecipients = (to: string | string[]) => (Array.isArray(to) ? to : [to]).filter(Boolean);

const sanitizeDisplayName = (value?: string | null) => String(value ?? "").replace(/[<>\r\n"]/g, " ").replace(/\s+/g, " ").trim();

const resolveFrom = (fromName?: string | null) => {
  const base = env.EMAIL_PROVIDER === "resend" ? env.RESEND_FROM : env.SMTP_FROM;
  const match = base.match(/<([^>]+)>/);
  const email = match?.[1] ?? base;
  const displayName = sanitizeDisplayName(fromName);
  return displayName ? `${displayName} <${email}>` : base;
};

const sendWithResend = async (input: SendEmailInput) => {
  if (!env.RESEND_API_KEY) {
    throw new AppError("RESEND_API_KEY non configurata", 500, "EMAIL_PROVIDER_NOT_CONFIGURED");
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: resolveFrom(input.fromName),
      to: normalizeRecipients(input.to),
      subject: input.subject,
      text: input.text,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      ...(input.html ? { html: input.html } : {}),
      ...(input.attachments?.length
        ? {
            attachments: input.attachments.map((attachment) => ({
              filename: attachment.filename,
              content: attachment.content.toString("base64"),
              ...(attachment.contentType ? { content_type: attachment.contentType } : {})
            }))
          }
        : {})
    })
  });

  const payload = await response.json().catch(() => ({})) as { id?: string; message?: string; error?: string };
  if (!response.ok) {
    throw new AppError(payload.message ?? payload.error ?? "Invio email Resend fallito", 502, "RESEND_EMAIL_FAILED");
  }

  return { provider: "resend" as const, id: payload.id ?? null };
};

const sendWithSmtp = async (input: SendEmailInput) => {
  const result = await mailer.sendMail({
    from: resolveFrom(input.fromName) || undefined,
    to: input.to,
    replyTo: input.replyTo || undefined,
    subject: input.subject,
    text: input.text,
    html: input.html,
    attachments: input.attachments
  });

  return { provider: "smtp" as const, id: String(result.messageId ?? "") || null };
};

export const emailSender = {
  send: (input: SendEmailInput) => (env.EMAIL_PROVIDER === "resend" ? sendWithResend(input) : sendWithSmtp(input))
};
