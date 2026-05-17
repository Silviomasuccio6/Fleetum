import cron, { ScheduledTask } from "node-cron";
import { prisma } from "../database/prisma/client.js";
import { EmailQueueService } from "../email/email-queue-service.js";
import { logger } from "../logging/logger.js";

const shouldRunNow = (settings: any, now: Date) => {
  if (!settings?.enabled) return false;
  const hour = Number(settings.hour ?? 8);
  const minute = Number(settings.minute ?? 0);
  if (now.getHours() !== hour || now.getMinutes() !== minute) return false;
  const freq = settings.frequency ?? "weekly";
  if (freq === "daily") return true;
  if (freq === "weekly") return now.getDay() === 1;
  if (freq === "monthly") return now.getDate() === 1;
  return false;
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

export const startReportsCron = (emailQueue: EmailQueueService): ScheduledTask => {
  return cron.schedule("* * * * *", async () => {
    const now = new Date();
    try {
      const settingsRows = await prisma.auditLog.findMany({
        where: { resource: "reports", action: "SETTINGS_REPORTS" },
        orderBy: { createdAt: "desc" },
        take: 300
      });
      const latestByTenant = new Map<string, any>();
      for (const row of settingsRows) {
        if (!latestByTenant.has(row.tenantId)) latestByTenant.set(row.tenantId, row.details as any);
      }

      for (const [tenantId, settings] of latestByTenant.entries()) {
        if (!shouldRunNow(settings, now)) continue;
        const recipients = Array.isArray(settings?.recipients) ? settings.recipients : [];
        if (!recipients.length) continue;

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
          ? await prisma.workshop.findMany({ where: { id: { in: workshopIds } }, select: { id: true, name: true } })
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
        for (const recipient of recipients) {
          await emailQueue.enqueue({
            tenantId,
            type: "SCHEDULED_REPORT",
            recipient: String(recipient),
            subject,
            body,
            meta: {
              reportStyle: format,
              generatedAt: now.toISOString(),
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
          });
        }
      }
    } catch (error) {
      logger.error({ error }, "Scheduled report cron failed");
    }
  });
};
