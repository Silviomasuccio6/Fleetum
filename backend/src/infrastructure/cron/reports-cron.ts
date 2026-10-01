import crypto from "node:crypto";
import cron, { ScheduledTask } from "node-cron";
import { hasFeature } from "../../application/services/feature-entitlements-service.js";
import { LicensePolicyService } from "../../application/services/license-policy-service.js";
import { prisma } from "../database/prisma/client.js";
import { EmailQueueService } from "../email/email-queue-service.js";
import { logger } from "../logging/logger.js";
import { ownedStoppageWhere } from "../repositories/stoppage-tenant-scope.js";
import {
  latestDueOccurrence,
  nextScheduledOccurrence,
  reportTimeZone
} from "./report-schedule.js";

// Existing schedules have no cursor before this migration. Their first scan
// keeps the previous short catch-up window; later scans use the durable cursor.
const REPORT_CATCH_UP_MS = 180 * 60 * 1000;

export const canRunScheduledReport = (plan: string | null | undefined, settings: unknown, now: Date) =>
  hasFeature(plan, "scheduled_reports") &&
  (() => {
    const latest = latestDueOccurrence(settings, now);
    return latest !== null && now.getTime() - latest.getTime() <= REPORT_CATCH_UP_MS;
  })();

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

const buildTenantReportInputs = async (
  tenantId: string,
  settings: any,
  occurrence: Date,
  now: Date,
  recipientsWithKeys: Array<{ recipient: string; deduplicationKey: string }>
) => {
  const lookback = new Date(now.getTime() - 30 * 86400000);
  const [stoppageScope, historicalStoppageScope] = await Promise.all([
    ownedStoppageWhere(tenantId),
    ownedStoppageWhere(tenantId, prisma, true)
  ]);
  const [total, open, critical, closedLast30, reminders, remindersFailed, topWorkshops, overdue, preventiveDaysDue] =
    await Promise.all([
      prisma.stoppage.count({ where: stoppageScope }),
      prisma.stoppage.count({
        where: { ...stoppageScope, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_PARTS", "SOLICITED"] } }
      }),
      prisma.stoppage.count({
        where: { ...stoppageScope, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_PARTS", "SOLICITED"] }, priority: "CRITICAL" }
      }),
      prisma.stoppage.count({ where: { ...stoppageScope, status: "CLOSED", closedAt: { gte: lookback } } }),
      prisma.reminder.count({ where: { tenantId, stoppage: historicalStoppageScope, sentAt: { gte: lookback } } }),
      prisma.reminder.count({ where: { tenantId, stoppage: historicalStoppageScope, sentAt: { gte: lookback }, success: false } }),
      prisma.stoppage.groupBy({
        by: ["workshopId"],
        where: { ...stoppageScope, openedAt: { gte: lookback } },
        _count: { _all: true },
        orderBy: { _count: { workshopId: "desc" } },
        take: 3
      }),
      prisma.stoppage.count({
        where: {
          ...stoppageScope,
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
  return recipientsWithKeys.map(({ recipient, deduplicationKey }) => ({
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
  }));
};

const bootstrapNextRunAt = (settings: any, settingsCreatedAt: Date, now: Date) => {
  const latest = latestDueOccurrence(settings, now);
  // A pre-migration configuration has no durable history. Keep the old
  // three-hour recovery window at its first scan; do not send months of
  // historical reports when the new cursor table is first deployed.
  if (
    latest &&
    now.getTime() - latest.getTime() <= REPORT_CATCH_UP_MS &&
    settingsCreatedAt.getTime() < latest.getTime() + 60_000
  ) {
    return latest;
  }
  return nextScheduledOccurrence(settings, now);
};

const processTenantReport = async (
  emailQueue: EmailQueueService,
  licensePolicyService: LicensePolicyService,
  tenantId: string,
  settingsRow: { id: string; details: unknown; createdAt: Date },
  now: Date
) => {
  const settings = settingsRow.details as any;
  const timeZone = reportTimeZone();
  let cursor = await prisma.scheduledReportCursor.findUnique({ where: { tenantId } });
  if (!cursor) {
    await prisma.scheduledReportCursor.createMany({
      data: [{
        tenantId,
        settingsAuditLogId: settingsRow.id,
        timeZone,
        nextRunAt: bootstrapNextRunAt(settings, settingsRow.createdAt, now)
      }],
      skipDuplicates: true
    });
    cursor = await prisma.scheduledReportCursor.findUniqueOrThrow({ where: { tenantId } });
  }

  if (cursor.timeZone !== timeZone) {
    throw new Error(`Scheduled report time zone mismatch for tenant ${tenantId}`);
  }
  // The settings writer changes its AuditLog row and cursor in one transaction.
  // An unexpected mismatch means a direct writer bypassed that contract.
  if (cursor.settingsAuditLogId !== settingsRow.id) {
    throw new Error(`Scheduled report settings revision mismatch for tenant ${tenantId}`);
  }
  const dueFrom = cursor.nextRunAt;
  if (!dueFrom || dueFrom.getTime() > now.getTime()) return;

  const disabled = settings?.enabled !== true;
  const latest = disabled ? dueFrom : latestDueOccurrence(settings, now);
  if (!latest || latest.getTime() < dueFrom.getTime()) {
    throw new Error(`Scheduled report cursor is not aligned for tenant ${tenantId}`);
  }
  const nextRunAt = disabled ? null : nextScheduledOccurrence(settings, latest);
  if (!disabled && (!nextRunAt || nextRunAt.getTime() <= now.getTime())) {
    throw new Error(`Scheduled report next occurrence is invalid for tenant ${tenantId}`);
  }

  const recipients = disabled ? [] : uniqueRecipients(settings);
  const configurationPostdatesSlot = !disabled &&
    settingsRow.createdAt.getTime() >= latest.getTime() + 60_000;
  let skipReason: string | null = disabled
    ? "DISABLED"
    : configurationPostdatesSlot
      ? "CONFIG_AFTER_SLOT"
      : recipients.length
        ? null
        : "NO_RECIPIENTS";
  if (!skipReason) {
    const entitlements = await licensePolicyService.getTenantEntitlements(tenantId);
    if (
      (entitlements.license.status !== "ACTIVE" && entitlements.license.status !== "TRIAL") ||
      !hasFeature(entitlements.plan, "scheduled_reports")
    ) {
      skipReason = "INELIGIBLE";
    }
  }

  let inputs: Awaited<ReturnType<typeof buildTenantReportInputs>> = [];
  if (!skipReason) {
    const recipientsWithKeys = recipients.map((recipient) => ({
      recipient,
      deduplicationKey: deliveryKey(tenantId, latest, recipient)
    }));
    const existing = await prisma.emailQueue.count({
      where: {
        tenantId,
        type: "SCHEDULED_REPORT",
        deduplicationKey: { in: recipientsWithKeys.map((row) => row.deduplicationKey) }
      }
    });
    if (existing !== recipientsWithKeys.length) {
      inputs = await buildTenantReportInputs(tenantId, settings, latest, now, recipientsWithKeys);
    }
  }

  // A subscription row is locked after the tenant. When it does not exist,
  // FOR UPDATE on Tenant also prevents a concurrent FK-backed insert until
  // this queue/cursor decision commits.
  const hadSubscription = Boolean(await prisma.tenantSubscription.findUnique({
    where: { tenantId },
    select: { tenantId: true }
  }));
  await prisma.$transaction(async (tx) => {
    const lockedTenants = hadSubscription
      ? await tx.$queryRaw<Array<{ isActive: boolean; deletedAt: Date | null }>>`
          SELECT "isActive", "deletedAt" FROM "Tenant" WHERE "id" = ${tenantId} FOR SHARE
        `
      : await tx.$queryRaw<Array<{ isActive: boolean; deletedAt: Date | null }>>`
          SELECT "isActive", "deletedAt" FROM "Tenant" WHERE "id" = ${tenantId} FOR UPDATE
        `;
    const lockedTenant = lockedTenants[0];
    if (!lockedTenant) return;
    const subscriptions = await tx.$queryRaw<Array<{ tenantId: string }>>`
      SELECT "tenantId" FROM "TenantSubscription" WHERE "tenantId" = ${tenantId} FOR UPDATE
    `;
    if (hadSubscription && subscriptions.length === 0) {
      // Retry on the next tick with the no-subscription lock order.
      throw new Error(`Scheduled report subscription changed for tenant ${tenantId}`);
    }

    // An eligibility decision made before the locks may already be stale.
    // If it changed from ineligible to eligible, retry on the next tick so
    // the report body can be built before we advance the cursor.
    let finalSkipReason = skipReason === "INELIGIBLE" ? null : skipReason;
    if (!finalSkipReason && (!lockedTenant.isActive || lockedTenant.deletedAt)) {
      finalSkipReason = "TENANT_INACTIVE";
    }
    if (!finalSkipReason) {
      const statusChanged = await tx.auditLog.findFirst({
        where: {
          tenantId,
          resource: "tenant",
          action: "PLATFORM_TENANT_STATUS_CHANGED",
          createdAt: { gt: latest }
        },
        select: { id: true }
      });
      if (statusChanged) finalSkipReason = "TENANT_STATUS_CHANGED";
    }
    if (!finalSkipReason) {
      const entitlements = await licensePolicyService.getTenantEntitlements(tenantId);
      if (
        (entitlements.license.status !== "ACTIVE" && entitlements.license.status !== "TRIAL") ||
        !hasFeature(entitlements.plan, "scheduled_reports")
      ) {
        finalSkipReason = "INELIGIBLE";
      }
    }
    if (!finalSkipReason && skipReason === "INELIGIBLE") return;

    const skippedThrough = finalSkipReason
      ? latest
      : dueFrom.getTime() < latest.getTime()
        ? latestDueOccurrence(settings, new Date(latest.getTime() - 1))
        : null;
    const skippedFrom = skippedThrough ? dueFrom : null;
    const effectiveSkipReason = finalSkipReason ?? (skippedThrough ? "BACKLOG" : null);
    const claimed = await tx.scheduledReportCursor.updateMany({
      where: {
        tenantId,
        settingsAuditLogId: settingsRow.id,
        timeZone,
        nextRunAt: dueFrom
      },
      data: {
        nextRunAt,
        ...(!finalSkipReason ? { lastQueuedFor: latest } : {}),
        ...(skippedFrom && skippedThrough && effectiveSkipReason ? {
          lastSkippedFrom: skippedFrom,
          lastSkippedThrough: skippedThrough,
          lastSkipReason: effectiveSkipReason
        } : {})
      }
    });
    if (claimed.count !== 1) return;
    if (!finalSkipReason && inputs.length) await emailQueue.enqueueManyOnce(inputs, tx);
  });
};

/**
 * Enumerates active tenants. Each tenant has a persistent schedule cursor and
 * the queue has a unique delivery key for each local slot and recipient.
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
          select: { id: true, details: true, createdAt: true }
        });
        if (!settingsRow) continue;

        await processTenantReport(
          emailQueue,
          licensePolicyService,
          tenant.id,
          settingsRow,
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
