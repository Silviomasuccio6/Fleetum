import { SiteRepository } from "../../domain/repositories/site-repository.js";
import { prisma } from "../database/prisma/client.js";
import { scalarWriteFields } from "./vehicle-tenant-scope.js";

const writableFields = ["name", "address", "city", "contactName", "email", "phone", "notes", "isActive"] as const;

export class PrismaSiteRepository implements SiteRepository {
  async list(tenantId: string, params: { search?: string; skip: number; take: number }) {
    const where = {
      tenantId,
      deletedAt: null,
      ...(params.search
        ? {
            OR: [
              { name: { contains: params.search, mode: "insensitive" as const } },
              { city: { contains: params.search, mode: "insensitive" as const } }
            ]
          }
        : {})
    };

    const [total, data] = await Promise.all([
      prisma.site.count({ where }),
      prisma.site.findMany({ where, skip: params.skip, take: params.take, orderBy: { createdAt: "desc" } })
    ]);

    return { data, total };
  }

  async create(tenantId: string, input: Record<string, unknown>) {
    return prisma.site.create({ data: { ...scalarWriteFields(input, writableFields), tenantId } as never });
  }

  async update(tenantId: string, id: string, input: Record<string, unknown>) {
    const data = scalarWriteFields(input, writableFields);
    await prisma.site.updateMany({ where: { id, tenantId, deletedAt: null }, data: data as never });
    return prisma.site.findFirst({ where: { id, tenantId, deletedAt: null } });
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await prisma.site.updateMany({ where: { id, tenantId, deletedAt: null }, data: { deletedAt: new Date() } });
  }
}
