export interface StoppageRepository {
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
  ): Promise<{ data: unknown[]; total: number }>;
  getById(tenantId: string, id: string): Promise<unknown | null>;
  create(tenantId: string, input: Record<string, unknown>): Promise<unknown>;
  update(tenantId: string, id: string, input: Record<string, unknown>): Promise<unknown>;
  delete(tenantId: string, id: string): Promise<void>;
  listForAutomaticReminders(now: Date): Promise<unknown[]>;
  markReminderSent(tenantId: string, stoppageId: string, sentAt: Date): Promise<void>;
}
