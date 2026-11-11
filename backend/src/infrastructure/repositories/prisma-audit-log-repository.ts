import crypto from "node:crypto";
import { AuditLogRepository, AuditLogRow } from "../../domain/repositories/audit-log-repository.js";
import { initialReportNextRunAt, reportTimeZone } from "../cron/report-schedule.js";
import { prisma } from "../database/prisma/client.js";

import { companyReportAuthorizationReason } from "../../application/services/company-report-authorization.js";
import { AppError } from "../../shared/errors/app-error.js";
import { auditViewScope } from "./audit-view-scope.js";

type CreateAuditLogInput = Parameters<AuditLogRepository["create"]>[0];

export const createAuditLog = async (client: Pick<typeof prisma, "auditLog">, input: CreateAuditLogInput, createdAt?: Date) => {
  const previous = await client.auditLog.findFirst({
    where: { tenantId: input.tenantId },
    orderBy: { createdAt: "desc" },
    select: { id: true, details: true, createdAt: true }
  });
  const prevHash = (previous?.details as any)?.__meta?.hash ?? null;
  const canonical = JSON.stringify({
    tenantId: input.tenantId,
    userId: input.userId ?? null,
    action: input.action,
    resource: input.resource,
    resourceId: input.resourceId ?? null,
    details: input.details ?? null,
    prevHash
  });
  const hash = crypto.createHash("sha256").update(canonical).digest("hex");
  const persistedCreatedAt = createdAt && previous && createdAt.getTime() <= previous.createdAt.getTime()
    ? new Date(previous.createdAt.getTime() + 1)
    : createdAt;

  return client.auditLog.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId ?? null,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId ?? null,
      ...(persistedCreatedAt ? { createdAt: persistedCreatedAt } : {}),
      details: ({
        ...(typeof input.details === "object" && input.details !== null ? (input.details as object) : { value: input.details ?? null }),
        __meta: { immutable: true, hash, prevHash, ts: new Date().toISOString() }
      } as any)
    }
  });
};

export class PrismaAuditLogRepository implements AuditLogRepository {
  async countByTenant(tenantId: string): Promise<number> {
    const view = auditViewScope(tenantId);
    const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS "count" FROM "AuditLog" a WHERE ${view.where}`;
    return Number(row.count);
  }

  async listByTenant(tenantId: string, input: { skip: number; take: number }): Promise<AuditLogRow[]> {
    const view = auditViewScope(tenantId);
    return prisma.$queryRaw<AuditLogRow[]>`SELECT ${view.columns} FROM "AuditLog" a WHERE ${view.where}
      ORDER BY a."createdAt" DESC, a."id" DESC OFFSET ${input.skip} LIMIT ${input.take}`;
  }

  async listLatestByTenant(tenantId: string, take: number): Promise<AuditLogRow[]> {
    return this.listByTenant(tenantId, { skip: 0, take });
  }

  async getLatestByAction(tenantId: string, resource: string, action: string): Promise<AuditLogRow | null> {
    return prisma.auditLog.findFirst({
      where: { tenantId, resource, action },
      orderBy: { createdAt: "desc" }
    });
  }

  async create(input: CreateAuditLogInput): Promise<void> {
    if (input.resource === "reports" && input.action === "SETTINGS_REPORTS") {
      await prisma.$transaction(async (tx) => {
        // Serializing settings writes for this tenant protects the audit hash
        // chain and prevents an older schedule from overwriting a newer one.
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Tenant" WHERE "id" = ${input.tenantId} FOR UPDATE
        `;
        if (locked.length !== 1) throw new Error("Tenant not found while saving report settings");

        const details = input.details as Record<string, unknown> | null;
        if (details && Object.hasOwn(details, "__siteAuthorization") &&
            await companyReportAuthorizationReason(tx, input.tenantId, details.__siteAuthorization)) {
          throw new AppError("Configurazione report non consentita", 403, "FORBIDDEN");
        }
        // PostgreSQL now() is fixed at transaction start; clock_timestamp()
        // preserves write order after a concurrent writer releases the lock.
        const [clock] = await tx.$queryRaw<Array<{ currentTime: Date }>>`
          SELECT clock_timestamp() AS "currentTime"
        `;
        if (!clock) throw new Error("Database clock unavailable while saving report settings");
        const row = await createAuditLog(tx, input, clock.currentTime);
        const schedule = {
          settingsAuditLogId: row.id,
          timeZone: reportTimeZone(),
          nextRunAt: initialReportNextRunAt(input.details, row.createdAt)
        };
        await tx.scheduledReportCursor.upsert({
          where: { tenantId: input.tenantId },
          create: { tenantId: input.tenantId, ...schedule },
          update: schedule
        });
      });
      return;
    }

    await createAuditLog(prisma, input);
  }
}
