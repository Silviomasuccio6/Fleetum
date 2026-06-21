import { Resend } from "resend";
import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";

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

const normalizeRecipients = (to: string | string[]) => (Array.isArray(to) ? to : [to]).filter(Boolean);
const resend = new Resend(env.RESEND_API_KEY);

const sanitizeDisplayName = (value?: string | null) => String(value ?? "").replace(/[<>\r\n"]/g, " ").replace(/\s+/g, " ").trim();

const resolveFrom = (fromName?: string | null) => {
  const base = env.RESEND_FROM;
  const match = base.match(/<([^>]+)>/);
  const email = match?.[1] ?? base;
  const displayName = sanitizeDisplayName(fromName);
  return displayName ? `${displayName} <${email}>` : base;
};

const sendWithResend = async (input: SendEmailInput) => {
  const { data, error } = await resend.emails.send({
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
  });

  if (error) {
    throw new AppError(error.message || "Invio email Resend fallito", 502, "RESEND_EMAIL_FAILED");
  }

  return { provider: "resend" as const, id: data?.id ?? null };
};

export const emailSender = {
  send: sendWithResend
};
