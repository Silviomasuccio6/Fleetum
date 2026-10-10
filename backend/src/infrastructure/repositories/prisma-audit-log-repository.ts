import crypto from "node:crypto";
import { AuditLogRepository, AuditLogRow } from "../../domain/repositories/audit-log-repository.js";
import { initialReportNextRunAt, reportTimeZone } from "../cron/report-schedule.js";
import { prisma } from "../database/prisma/client.js";

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
    return prisma.auditLog.count({ where: { tenantId } });
  }

  async listByTenant(tenantId: string, input: { skip: number; take: number }): Promise<AuditLogRow[]> {
    return prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      skip: input.skip,
      take: input.take
    });
  }

  async listLatestByTenant(tenantId: string, take: number): Promise<AuditLogRow[]> {
    return prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take
    });
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
