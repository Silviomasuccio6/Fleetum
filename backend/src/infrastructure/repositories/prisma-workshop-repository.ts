import { WorkshopRepository } from "../../domain/repositories/workshop-repository.js";
import { prisma } from "../database/prisma/client.js";
import { assertCompanyResourceView, canReadSharedCompanyResources } from "../auth/company-resource-access.js";
import { scalarWriteFields } from "./vehicle-tenant-scope.js";

const writableFields = ["name", "contactName", "email", "phone", "whatsapp", "address", "city", "notes", "isActive"] as const;

export class PrismaWorkshopRepository implements WorkshopRepository {
  async list(tenantId: string, params: { search?: string; skip: number; take: number }) {
    const where = {
      tenantId,
      deletedAt: null,
      ...(!canReadSharedCompanyResources(tenantId) ? { id: { in: [] as string[] } } : {}),
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
      prisma.workshop.count({ where }),
      prisma.workshop.findMany({ where, skip: params.skip, take: params.take, orderBy: { createdAt: "desc" } })
    ]);

    return { data, total };
  }

  create(tenantId: string, input: Record<string, unknown>) {
    assertCompanyResourceView(tenantId);
    return prisma.workshop.create({ data: { ...scalarWriteFields(input, writableFields), tenantId } as never });
  }

  async update(tenantId: string, id: string, input: Record<string, unknown>) {
    assertCompanyResourceView(tenantId);
    const data = scalarWriteFields(input, writableFields);
    await prisma.workshop.updateMany({ where: { id, tenantId, deletedAt: null }, data: data as never });
    return prisma.workshop.findFirst({ where: { id, tenantId, deletedAt: null } });
  }

  async delete(tenantId: string, id: string): Promise<void> {
    assertCompanyResourceView(tenantId);
    await prisma.workshop.updateMany({ where: { id, tenantId, deletedAt: null }, data: { deletedAt: new Date() } });
  }
}
