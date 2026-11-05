// No historical actor or branch is inferred from a recipient, a booking's
// current vehicle, or a worker's ambient context. A fresh command must replace it.
export const legacySiteCommandReason = (type: string, input: unknown): string | null => {
  const meta = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const needsSiteAuthorization = type === "BOOKING_CONTRACT" || type === "RENTAL_EXTRA_CHARGE_NOTICE" ||
    (type === "REMINDER_EMAIL" && ["MANUAL", "MANUAL_RETRY"].includes(String(meta.reminderType)));
  if ((needsSiteAuthorization && !Object.hasOwn(meta, "siteAuthorization")) ||
      (type === "SCHEDULED_REPORT" && !Object.hasOwn(meta, "companyReportAuthorization"))) {
    return "SITE_LEGACY_REVIEW_REQUIRED";
  }
  return null;
};

export const hasAcceptedSiteCommandReceipt = (input: unknown) => {
  const meta = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  return meta.emailProvider === "resend" && typeof meta.providerMessageId === "string" && meta.providerMessageId.trim().length > 0;
};
