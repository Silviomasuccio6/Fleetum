import { PrismaStoppageRepository } from "../../../infrastructure/repositories/prisma-stoppage-repository.js";

export class ManageStoppagesUseCases {
  constructor(private readonly repository: PrismaStoppageRepository) {}
  list(
    tenantId: string,
    params: {
      search?: string;
      status?: string;
      siteId?: string;
      workshopId?: string;
      skip: number;
      take: number;
      sortBy?: string;
      sortDir?: "asc" | "desc";
    }
  ) {
    return this.repository.list(tenantId, params);
  }
  getById(tenantId: string, id: string) { return this.repository.getById(tenantId, id); }
  create(tenantId: string, input: Record<string, unknown>) {
    return this.repository.create(tenantId, input);
  }
  async update(tenantId: string, id: string, input: Record<string, unknown>) {
    return this.repository.update(tenantId, id, {
      ...input, ...(input.status === "CLOSED" && !input.closedAt ? { closedAt: new Date() } : {})
    });
  }
  delete(tenantId: string, id: string) { return this.repository.delete(tenantId, id); }
}
