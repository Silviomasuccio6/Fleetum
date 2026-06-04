export type ApiQueryValue = string | number | boolean | undefined;
export type ApiQueryParams = Record<string, ApiQueryValue>;

export type AnalyticsStatus = "OPEN" | "IN_PROGRESS" | "WAITING_PARTS" | "SOLICITED" | "CLOSED" | "CANCELED";

export type AnalyticsKpisDto = {
  totalStoppages: number;
  openStoppages: number;
  closedStoppages: number;
  canceledStoppages?: number;
  criticalOpen: number;
  highOpen?: number;
  overdueOpen: number;
  newStoppagesLast30: number;
  closedLast30: number;
  averageClosureDays: number;
  medianClosureDays?: number;
  p90ClosureDays?: number;
  averageOpenAgeDays?: number;
  closureRateWithin7Days: number;
  closureRateWithin30Days?: number;
  closureRateWithin60Days?: number;
  remindersTotal: number;
  reminderSuccessRate: number;
  estimatedOpenCost: number;
  estimatedTotalCost?: number;
};

export type NamedCountDto = {
  name?: string | null;
  count: number;
};

export type StatusCountDto = {
  status: AnalyticsStatus;
  count: number;
};

export type PriorityCountDto = {
  priority: string;
  count: number;
};

export type TrendStoppageDto = {
  day: string;
  opened: number;
  closed: number;
  reminders: number;
};

export type LongestOpenDto = {
  plate?: string | null;
  brand?: string | null;
  model?: string | null;
  site?: string | null;
  workshop?: string | null;
  status: AnalyticsStatus;
  priority?: string | null;
  openDays: number;
};

export type VehicleDowntimeDto = {
  plate?: string | null;
  brand?: string | null;
  model?: string | null;
  count: number;
  openDays: number;
};

export type ReminderFailureDto = {
  sentAt: string;
  recipient?: string | null;
  type?: string | null;
  errorMessage?: string | null;
};

export type DashboardStatsDto = {
  kpis: AnalyticsKpisDto;
  charts: {
    byStatus: StatusCountDto[];
    [key: string]: unknown;
  };
  feeds: {
    alerts: Array<Record<string, string | number | boolean | null | undefined>>;
    recentUsers: Array<Record<string, string | number | boolean | null | undefined>>;
    recentStoppages: Array<Record<string, string | number | boolean | null | undefined>>;
    recentReminders: Array<Record<string, string | number | boolean | null | undefined>>;
  };
  booking?: unknown;
  [key: string]: unknown;
};

export type AnalyticsReportDto = {
  kpis: AnalyticsKpisDto;
  filtersApplied?: {
    dateFrom?: string;
    dateTo?: string;
    siteId?: string | null;
    workshopId?: string | null;
    status?: AnalyticsStatus | null;
    plate?: string | null;
    brand?: string | null;
    model?: string | null;
  };
  charts: {
    trendStoppages: TrendStoppageDto[];
    byStatus: StatusCountDto[];
    byPriority: PriorityCountDto[];
    byWorkshop: NamedCountDto[];
    bySite: NamedCountDto[];
    byBrand?: NamedCountDto[];
    agingBuckets?: NamedCountDto[];
  };
  tables: {
    longestOpen: LongestOpenDto[];
    topVehiclesDowntime: VehicleDowntimeDto[];
    reminderFailures: ReminderFailureDto[];
  };
};

export type VehicleProfitabilityReportDto = {
  period: {
    from: string;
    to: string;
  };
  summary: {
    totalRevenue: number;
    totalCosts: number;
    grossMargin: number;
    netMarginEstimate: number;
    rentedDays: number;
    availableDays: number;
    technicalStopDays: number;
    utilizationRate: number;
    contractsCount: number;
    bookingsCount: number;
  };
  investment: {
    purchasePrice: number | null;
    recoveredAmount: number;
    recoveredPercentage: number | null;
    remainingToBreakEven: number | null;
    breakEvenReached: boolean | null;
    estimatedBreakEvenDate?: string | null;
  };
  trend?: Array<{
    month: string;
    revenue: number;
    costs: number;
    margin: number;
  }>;
  vehicles: Array<{
    vehicleId: string;
    plate: string;
    brand: string;
    model: string;
    siteName?: string | null;
    purchasePrice?: number | null;
    revenue: number;
    costs: number;
    margin: number;
    rentedDays: number;
    utilizationRate: number;
    recoveredPercentage?: number | null;
  }>;
  rows: Array<Record<string, string | number | null | undefined>>;
  filters?: Record<string, unknown>;
  dataQuality?: {
    notes?: string[];
  };
};

export type WorkshopHealthDto = Record<string, string | number | boolean | null | undefined>;
export type WorkshopCapacityDto = Record<string, string | number | boolean | null | undefined>;
export type TeamPerformanceDto = Record<string, string | number | boolean | null | undefined>;
export type AiSuggestionDto = Record<string, string | number | boolean | null | undefined>;
