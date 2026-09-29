import crypto from "node:crypto";
import cron, { ScheduledTask } from "node-cron";
import { hasFeature } from "../../application/services/feature-entitlements-service.js";
import { LicensePolicyService } from "../../application/services/license-policy-service.js";
import { prisma } from "../database/prisma/client.js";
import { EmailQueueService } from "../email/email-queue-service.js";
import { logger } from "../logging/logger.js";

// Keep the existing process-local schedule. A logical local slot also prevents
// the repeated hour at the end of daylight saving time from sending twice.
const REPORT_CATCH_UP_MS = 180 * 60 * 1000;

const latestDueOccurrence = (settings: any, now: Date): Date | null => {
  if (!settings?.enabled) return null;
  const hour = Number(settings.hour ?? 8);
  const minute = Number(settings.minute ?? 0);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }
  const freq = settings.frequency ?? "weekly";
  if (freq !== "daily" && freq !== "weekly" && freq !== "monthly") return null;

  // 180 elapsed minutes can cross at most one local midnight, including DST.
  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOffset);
    if (freq === "weekly" && day.getDay() !== 1) continue;
    if (freq === "monthly" && day.getDate() !== 1) continue;

    const occurrence = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
    // A local time skipped by the spring DST change has no occurrence.
    if (occurrence.getHours() !== hour || occurrence.getMinutes() !== minute) continue;
    const elapsed = now.getTime() - occurrence.getTime();
    if (elapsed >= 0 && elapsed <= REPORT_CATCH_UP_MS) return occurrence;
  }
  return null;
};

export const canRunScheduledReport = (plan: string | null | undefined, settings: unknown, now: Date) =>
  hasFeature(plan, "scheduled_reports") && latestDueOccurrence(settings, now) !== null;

const deliveryKey = (tenantId: string, occurrence: Date, recipient: string) => {
  const localSlot = [
    occurrence.getFullYear(),
    String(occurrence.getMonth() + 1).padStart(2, "0"),
    String(occurrence.getDate()).padStart(2, "0"),
    String(occurrence.getHours()).padStart(2, "0"),
    String(occurrence.getMinutes()).padStart(2, "0")
  ].join(":");
  const digest = crypto.createHash("sha256").update(`${tenantId}\0${localSlot}\0${recipient.toLowerCase()}`).digest("hex");
  return `scheduled-report:v1:${digest}`;
};

const escapePdfText = (text: string) =>
  text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

const buildSimplePdf = (title: string, body: string) => {
  const lines = [title, "", ...body.split("\n")].slice(0, 140);
  const streamText = [
    "BT",
    "/F1 10 Tf",
    "50 780 Td",
    ...lines.map((line, idx) => `${idx === 0 ? "" : "T* "}( ${escapePdfText(line)} ) Tj`).map((x) => x.trim()),
    "ET"
  ].join("\n");

  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${streamText.length} >>\nstream\n${streamText}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
  ];
  const header = "%PDF-1.4\n";
  const offsets: number[] = [];
  let cursor = header.length;
  objects.forEach((obj) => {
    offsets.push(cursor);
    cursor += obj.length;
  });
  const xrefStart = cursor;
  const xref =
    `xref\n0 ${objects.length + 1}\n` +
    "0000000000 65535 f \n" +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(header + objects.join("") + xref + trailer, "utf8");
};

const REPORT_TENANT_PAGE_SIZE = 100;

const uniqueRecipients = (settings: any) => {
  if (!Array.isArray(settings?.recipients)) return [];
  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const value of settings.recipients) {
    if (typeof value !== "string") continue;
    const recipient = value.trim();
    const dedupeKey = recipient.toLowerCase();
    if (!recipient || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    recipients.push(recipient);
  }
  return recipients;
};

const enqueueTenantReport = async (
  emailQueue: EmailQueueService,
  licensePolicyService: LicensePolicyService,
  tenantId: string,
  settings: any,
  settingsCreatedAt: Date,
  now: Date
) => {
  const occurrence = latestDueOccurrence(settings, now);
  // Settings saved during the scheduled minute keep the old exact-minute
  // behavior; a later change must not create a retrospective delivery.
  if (!occurrence || settingsCreatedAt.getTime() >= occurrence.getTime() + 60_000) return;
  const recipients = uniqueRecipients(settings);
  if (!recipients.length) return;

  const entitlements = await licensePolicyService.getTenantEntitlements(tenantId);
  if (entitlements.license.status !== "ACTIVE" && entitlements.license.status !== "TRIAL") return;
  if (!hasFeature(entitlements.plan, "scheduled_reports")) return;

  const recipientsWithKeys = recipients.map((recipient) => ({
    recipient,
    deduplicationKey: deliveryKey(tenantId, occurrence, recipient)
  }));
  const existing = await prisma.emailQueue.count({
    where: {
      tenantId,
      type: "SCHEDULED_REPORT",
      deduplicationKey: { in: recipientsWithKeys.map((row) => row.deduplicationKey) }
    }
  });
  if (existing === recipientsWithKeys.length) return;

  const lookback = new Date(now.getTime() - 30 * 86400000);
  const [total, open, critical, closedLast30, reminders, remindersFailed, topWorkshops, overdue, preventiveDaysDue] =
    await Promise.all([
      prisma.stoppage.count({ where: { tenantId, deletedAt: null } }),
      prisma.stoppage.count({
        where: { tenantId, deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_PARTS", "SOLICITED"] } }
      }),
      prisma.stoppage.count({
        where: { tenantId, deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_PARTS", "SOLICITED"] }, priority: "CRITICAL" }
      }),
      prisma.stoppage.count({ where: { tenantId, deletedAt: null, status: "CLOSED", closedAt: { gte: lookback } } }),
      prisma.reminder.count({ where: { tenantId, sentAt: { gte: lookback } } }),
      prisma.reminder.count({ where: { tenantId, sentAt: { gte: lookback }, success: false } }),
      prisma.stoppage.groupBy({
        by: ["workshopId"],
        where: { tenantId, deletedAt: null, openedAt: { gte: lookback } },
        _count: { _all: true },
        orderBy: { _count: { workshopId: "desc" } },
        take: 3
      }),
      prisma.stoppage.count({
        where: {
          tenantId,
          deletedAt: null,
          status: { in: ["OPEN", "IN_PROGRESS", "WAITING_PARTS", "SOLICITED"] },
          openedAt: { lte: new Date(now.getTime() - 30 * 86400000) }
        }
      }),
      prisma.vehicle.count({ where: { tenantId, deletedAt: null, isActive: true } })
    ]);
  const kmRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "Vehicle"
    WHERE "tenantId" = ${tenantId}
      AND "deletedAt" IS NULL
      AND "isActive" = true
      AND "currentKm" IS NOT NULL
      AND "maintenanceIntervalKm" IS NOT NULL
  `;
  const preventiveKmDue = Number(kmRows[0]?.count ?? 0n);

  const workshopIds = topWorkshops.map((x) => x.workshopId);
  const workshops = workshopIds.length
    ? await prisma.workshop.findMany({
        where: { tenantId, id: { in: workshopIds } },
        select: { id: true, name: true }
      })
    : [];
  const workshopName = new Map(workshops.map((x) => [x.id, x.name]));
  const topWorkshopsLines = topWorkshops
    .map((x) => `- ${workshopName.get(x.workshopId) ?? x.workshopId}: ${x._count._all} fermi`)
    .join("\n");

  const reminderFailureRate = reminders > 0 ? ((remindersFailed / reminders) * 100).toFixed(2) : "0.00";
  const closureRate = total > 0 ? ((closedLast30 / total) * 100).toFixed(2) : "0.00";
  const format = settings?.reportStyle === "BASIC" ? "BASIC" : "EXECUTIVE";
  const subjectPrefix = format === "EXECUTIVE" ? "[Executive Report]" : "[Report]";
  const subject = `${subjectPrefix} Fleetum - ${now.toISOString().slice(0, 10)}`;
  const body =
    format === "EXECUTIVE"
      ? `Executive Report (ultimo 30 giorni)\n\nTenant: ${tenantId}\nData: ${now.toISOString()}\n\nKPI CORE\n- Totale fermi: ${total}\n- Fermi aperti: ${open}\n- Critici aperti: ${critical}\n- Overdue > 30gg: ${overdue}\n- Chiusi ultimo 30gg: ${closedLast30}\n- Closure rate stimato: ${closureRate}%\n\nREMINDER\n- Reminder inviati: ${reminders}\n- Reminder falliti: ${remindersFailed}\n- Failure rate: ${reminderFailureRate}%\n\nPREVENTIVA\n- Veicoli monitorati: ${preventiveDaysDue}\n- Veicoli con km valorizzato: ${preventiveKmDue}\n\nTOP OFFICINE (volume)\n${topWorkshopsLines || "- Nessun dato"}\n\nNote: per dettaglio completo usa dashboard/statistiche del gestionale.`
      : `Report sintetico\n\nTenant: ${tenantId}\nTotale fermi: ${total}\nFermi aperti: ${open}\nCritici aperti: ${critical}\nReminder falliti: ${remindersFailed}\n`;
  const pdf = buildSimplePdf(
    `Executive Report ${now.toISOString().slice(0, 10)}`,
    body
  );
  const csv = [
    "metric,value",
    `total_stoppages,${total}`,
    `open_stoppages,${open}`,
    `critical_open,${critical}`,
    `overdue_30,${overdue}`,
    `closed_30,${closedLast30}`,
    `reminders,${reminders}`,
    `reminders_failed,${remindersFailed}`,
    `preventive_days_monitored,${preventiveDaysDue}`,
    `preventive_km_monitored,${preventiveKmDue}`
  ].join("\n");
  await emailQueue.enqueueManyOnce(recipientsWithKeys.map(({ recipient, deduplicationKey }) => ({
    tenantId,
    type: "SCHEDULED_REPORT",
    recipient,
    deduplicationKey,
    subject,
    body,
    meta: {
      reportStyle: format,
      generatedAt: now.toISOString(),
      scheduledFor: occurrence.toISOString(),
      attachments: [
        {
          filename: `executive-report-${now.toISOString().slice(0, 10)}.pdf`,
          contentType: "application/pdf",
          contentBase64: pdf.toString("base64")
        },
        {
          filename: `executive-kpi-${now.toISOString().slice(0, 10)}.csv`,
          contentType: "text/csv",
          contentBase64: Buffer.from(csv, "utf8").toString("base64")
        }
      ]
    }
  })));
};

/**
 * Enumerates every active tenant in a stable order and loads that tenant's latest
 * report settings independently. The queue's unique delivery key is the durable
 * ledger for each tenant, local schedule slot and normalized recipient.
 */
export const runReportsCronCycle = async (
  emailQueue: EmailQueueService,
  licensePolicyService: LicensePolicyService,
  now = new Date()
) => {
  let cursor: string | undefined;

  while (true) {
    const tenants = await prisma.tenant.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { id: "asc" },
      take: REPORT_TENANT_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true }
    });

    for (const tenant of tenants) {
      try {
        const settingsRow = await prisma.auditLog.findFirst({
          where: {
            tenantId: tenant.id,
            resource: "reports",
            action: "SETTINGS_REPORTS"
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { details: true, createdAt: true }
        });
        if (!settingsRow) continue;

        await enqueueTenantReport(
          emailQueue,
          licensePolicyService,
          tenant.id,
          settingsRow.details as any,
          settingsRow.createdAt,
          now
        );
      } catch (error) {
        logger.error({ error, tenantId: tenant.id }, "Scheduled report failed for tenant");
      }
    }

    if (tenants.length < REPORT_TENANT_PAGE_SIZE) break;
    cursor = tenants[tenants.length - 1]?.id;
    if (!cursor) break;
  }
};

export const startReportsCron = (
  emailQueue: EmailQueueService,
  licensePolicyService: LicensePolicyService
): ScheduledTask => {
  return cron.schedule(
    "* * * * *",
    async () => {
      try {
        await runReportsCronCycle(emailQueue, licensePolicyService);
      } catch (error) {
        logger.error({ error }, "Scheduled report cron failed");
      }
    },
    { noOverlap: true }
  );
};
