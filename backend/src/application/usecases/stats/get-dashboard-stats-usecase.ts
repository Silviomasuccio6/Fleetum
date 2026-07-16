import { BookingContractStatus, RentalBookingStatus, StoppageStatus } from "@prisma/client";
import { prisma } from "../../../infrastructure/database/prisma/client.js";
import { exactMoneyReader } from "../../../infrastructure/database/exact-money-reader.js";

type AnalyticsFilters = {
  dateFrom?: Date;
  dateTo?: Date;
  siteId?: string;
  workshopId?: string;
  status?: StoppageStatus;
  plate?: string;
  brand?: string;
  model?: string;
};

const dayMs = 86400000;

const daysDiff = (from: Date, to: Date) => Math.max(0, (to.getTime() - from.getTime()) / dayMs);

const startOfDay = (value: Date) => {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
};

const endOfDay = (value: Date) => {
  const next = new Date(value);
  next.setHours(23, 59, 59, 999);
  return next;
};

const dateKey = (value: Date) => value.toISOString().slice(0, 10);

const roundMoney = (value: number) => Number(value.toFixed(2));

const percentile = (sorted: number[], p: number) => {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
};

const median = (sorted: number[]) => {
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
};

export class GetDashboardStatsUseCase {
  async dashboardOverview(tenantId: string) {
    const now = new Date();
    const last30 = new Date(now.getTime() - 30 * dayMs);
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0));

    const [
      stoppageRows,
      users,
      reminders,
      rentalVehicles,
      rentalBookingRows,
      bookingContracts,
      contractDeliveries
    ] = await Promise.all([
      prisma.stoppage.findMany({
        where: { tenantId, deletedAt: null },
        include: {
          site: true,
          workshop: true,
          vehicle: true
        },
        orderBy: { createdAt: "desc" }
      }),
      prisma.user.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { id: true, firstName: true, lastName: true, email: true, status: true, createdAt: true }
      }),
      prisma.reminder.findMany({
        where: { tenantId },
        orderBy: { sentAt: "desc" },
        take: 8,
        include: {
          stoppage: {
            include: {
              vehicle: { select: { plate: true } }
            }
          }
        }
      }),
      prisma.vehicle.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        select: {
          id: true,
          plate: true,
          brand: true,
          model: true,
          currentKm: true,
          maintenanceIntervalKm: true,
          revisionDueAt: true,
          maintenances: {
            where: { deletedAt: null },
            orderBy: [{ performedAt: "desc" }, { createdAt: "desc" }],
            take: 1,
            select: { kmAtService: true, performedAt: true }
          }
        }
      }),
      prisma.rentalBooking.findMany({
        where: {
          tenantId,
          deletedAt: null,
          pickupAt: { lte: monthEnd },
          returnAt: { gte: new Date(todayStart.getTime() - 30 * dayMs) }
        },
        orderBy: [{ pickupAt: "asc" }, { createdAt: "asc" }],
        include: {
          vehicle: { select: { id: true, plate: true, brand: true, model: true, currentKm: true, maintenanceIntervalKm: true, revisionDueAt: true } },
          customer: {
            select: {
              id: true,
              customerType: true,
              firstName: true,
              lastName: true,
              companyName: true,
              email: true,
              phone: true,
              drivingLicenseNumber: true,
              documentNumber: true,
              companyVatNumber: true
            }
          },
          pricingSnapshot: {
            select: {
              id: true,
              expectedTotal: true,
              finalTotal: true,
              extraKmEstimated: true,
              extraKmActual: true,
              extraKmEstimatedCost: true,
              extraKmActualCost: true,
              daysCharged: true
            }
          },
          contract: {
            select: {
              id: true,
              status: true,
              lastSentAt: true,
              signedAt: true,
              deliveries: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { channel: true, status: true, sentAt: true, errorMessage: true, createdAt: true }
              }
            }
          }
        }
      }),
      prisma.bookingContract.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, status: true, createdAt: true, updatedAt: true, lastSentAt: true, signedAt: true }
      }),
      prisma.bookingContractDelivery.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, channel: true, status: true, sentAt: true, errorMessage: true, createdAt: true, bookingId: true }
      })
    ]);
    const [stoppages, exactRentalBookingRows, pricingSnapshots] = await Promise.all([
      exactMoneyReader.hydrate("Stoppage", stoppageRows, { tenantId }),
      exactMoneyReader.hydrate("RentalBooking", rentalBookingRows, { tenantId }),
      exactMoneyReader.hydrate(
        "RentalBookingPricingSnapshot",
        rentalBookingRows.flatMap((booking) =>
          booking.pricingSnapshot ? [booking.pricingSnapshot] : []
        ),
        { tenantId }
      )
    ]);
    const pricingSnapshotById = new Map(
      pricingSnapshots.map((snapshot) => [snapshot.id, snapshot])
    );
    const rentalBookings = exactRentalBookingRows.map((booking) => ({
      ...booking,
      pricingSnapshot: booking.pricingSnapshot
        ? (pricingSnapshotById.get(booking.pricingSnapshot.id) ?? booking.pricingSnapshot)
        : null
    }));

    const activeStatuses = new Set<StoppageStatus>(["OPEN", "IN_PROGRESS", "WAITING_PARTS", "SOLICITED"]);
    const openStoppages = stoppages.filter((x) => activeStatuses.has(x.status));
    const closed = stoppages.filter((x) => x.status === "CLOSED" && x.closedAt);
    const newLast30 = stoppages.filter((x) => x.createdAt >= last30).length;
    const closedLast30 = stoppages.filter((x) => x.closedAt && x.closedAt >= last30).length;
    const criticalOpen = openStoppages.filter((x) => x.priority === "CRITICAL").length;
    const overdueOpen = openStoppages.filter((x) => daysDiff(x.openedAt, now) > 30).length;

    const closureDurations = closed.map((x) => daysDiff(x.openedAt, x.closedAt!));
    const avgClosureDays = closureDurations.length
      ? closureDurations.reduce((acc, value) => acc + value, 0) / closureDurations.length
      : 0;

    const byStatus = Object.values(StoppageStatus).map((status) => ({
      status,
      count: stoppages.filter((x) => x.status === status).length
    }));

    const recentStoppages = stoppages.slice(0, 8).map((x) => ({
      id: x.id,
      createdAt: x.createdAt,
      status: x.status,
      priority: x.priority,
      reason: x.reason,
      site: x.site.name,
      workshop: x.workshop.name,
      plate: x.vehicle.plate,
      brand: x.vehicle.brand,
      model: x.vehicle.model
    }));

    const alerts = openStoppages
      .map((x) => ({
        id: x.id,
        severity:
          x.priority === "CRITICAL" || daysDiff(x.openedAt, now) > 45
            ? "HIGH"
            : x.priority === "HIGH" || daysDiff(x.openedAt, now) > 20
              ? "MEDIUM"
              : "LOW",
        message: `${x.vehicle.plate} fermo da ${Math.round(daysDiff(x.openedAt, now))} giorni`,
        status: x.status,
        site: x.site.name,
        workshop: x.workshop.name
      }))
      .sort((a, b) => (a.severity < b.severity ? 1 : -1))
      .slice(0, 8);

    const activeRentalStatuses = new Set<RentalBookingStatus>([
      "DRAFT",
      "QUOTED",
      "HOLD",
      "CONFIRMED",
      "CONTRACT_SIGNED",
      "READY_FOR_HANDOVER",
      "IN_RENT"
    ]);
    const closedRentalStatuses = new Set<RentalBookingStatus>(["CLOSED", "CANCELED", "NO_SHOW"]);
    const occupiedToday = rentalBookings.filter(
      (booking) => !closedRentalStatuses.has(booking.status) && booking.pickupAt <= todayEnd && booking.returnAt >= todayStart
    );
    const pickupsToday = rentalBookings.filter((booking) => booking.pickupAt >= todayStart && booking.pickupAt <= todayEnd);
    const returnsToday = rentalBookings.filter((booking) => booking.returnAt >= todayStart && booking.returnAt <= todayEnd);
    const overdueReturns = rentalBookings.filter(
      (booking) => booking.returnAt < now && !closedRentalStatuses.has(booking.status)
    );
    const monthBookings = rentalBookings.filter((booking) => booking.pickupAt <= monthEnd && booking.returnAt >= monthStart);

    const expectedRevenueMonth = monthBookings.reduce(
      (acc, booking) => acc + (booking.pricingSnapshot?.expectedTotal ?? booking.expectedTotal ?? 0),
      0
    );
    const finalRevenueMonth = monthBookings.reduce(
      (acc, booking) => acc + (booking.pricingSnapshot?.finalTotal ?? booking.finalTotal ?? 0),
      0
    );
    const revenueBookings = monthBookings.filter((booking) => (booking.pricingSnapshot?.expectedTotal ?? booking.expectedTotal ?? 0) > 0);
    const rentedDaysMonth = monthBookings.reduce((acc, booking) => acc + daysDiff(booking.pickupAt, booking.returnAt), 0);

    const contractStatusDistribution = Object.values(BookingContractStatus).map((status) => ({
      status,
      count: bookingContracts.filter((contract) => contract.status === status).length
    }));
    const deliveryFailures = contractDeliveries.filter((delivery) => delivery.status === "FAILED");

    const isMaintenanceCritical = (vehicle: {
      currentKm: number | null;
      maintenanceIntervalKm: number | null;
      maintenances: Array<{ kmAtService: number | null }>;
    }) => {
      const interval = vehicle.maintenanceIntervalKm ?? 0;
      const currentKm = vehicle.currentKm ?? 0;
      const lastKm = vehicle.maintenances[0]?.kmAtService ?? 0;
      if (!interval || !currentKm || !lastKm) return { status: "OK" as const, remainingKm: null as number | null };
      const remainingKm = lastKm + interval - currentKm;
      const warningKm = Math.min(1000, Math.floor(interval * 0.08));
      return {
        status: remainingKm <= 0 ? ("EXPIRED" as const) : remainingKm <= warningKm ? ("DUE_SOON" as const) : ("OK" as const),
        remainingKm
      };
    };

    const isRevisionCritical = (revisionDueAt: Date | null) => {
      if (!revisionDueAt) return { status: "OK" as const, days: null as number | null };
      const days = Math.ceil((startOfDay(revisionDueAt).getTime() - todayStart.getTime()) / dayMs);
      return {
        status: days <= 0 ? ("EXPIRED" as const) : days <= 30 ? ("DUE_SOON" as const) : ("OK" as const),
        days
      };
    };

    const vehicleDeadlineMap = new Map(
      rentalVehicles.map((vehicle) => [
        vehicle.id,
        {
          maintenance: isMaintenanceCritical(vehicle),
          revision: isRevisionCritical(vehicle.revisionDueAt)
        }
      ])
    );

    const criticalBookings = rentalBookings
      .flatMap((booking) => {
        const items: Array<{ type: string; reason: string; severity: "HIGH" | "MEDIUM"; booking: typeof booking }> = [];
        const customer = booking.customer;
        const deadline = vehicleDeadlineMap.get(booking.vehicleId);
        const hasCompleteCustomer =
          customer &&
          Boolean(customer.email || customer.phone) &&
          Boolean(
            customer.customerType === "PERSONA_GIURIDICA"
              ? customer.companyName && customer.companyVatNumber
              : customer.firstName && customer.lastName && customer.drivingLicenseNumber
          );

        if (booking.returnAt < now && !closedRentalStatuses.has(booking.status)) {
          items.push({ type: "OVERDUE_RETURN", reason: "Rientro scaduto", severity: "HIGH", booking });
        }
        if (booking.contractRequired && !booking.contract) {
          items.push({ type: "MISSING_CONTRACT", reason: "Contratto mancante", severity: "HIGH", booking });
        }
        if (booking.contractRequired && booking.contract && booking.contract.status !== "SIGNED") {
          items.push({ type: "CONTRACT_NOT_SIGNED", reason: "Contratto non firmato", severity: "MEDIUM", booking });
        }
        if (booking.contract?.deliveries?.[0]?.status === "FAILED") {
          items.push({ type: "CONTRACT_DELIVERY_FAILED", reason: "Invio contratto fallito", severity: "HIGH", booking });
        }
        if (deadline?.maintenance.status === "EXPIRED" || deadline?.maintenance.status === "DUE_SOON") {
          items.push({
            type: deadline.maintenance.status === "EXPIRED" ? "VEHICLE_MAINTENANCE_EXPIRED" : "VEHICLE_MAINTENANCE_DUE_SOON",
            reason: deadline.maintenance.status === "EXPIRED" ? "Manutenzione scaduta" : "Manutenzione in scadenza",
            severity: deadline.maintenance.status === "EXPIRED" ? "HIGH" : "MEDIUM",
            booking
          });
        }
        if (deadline?.revision.status === "EXPIRED" || deadline?.revision.status === "DUE_SOON") {
          items.push({
            type: deadline.revision.status === "EXPIRED" ? "VEHICLE_REVISION_EXPIRED" : "VEHICLE_REVISION_DUE_SOON",
            reason: deadline.revision.status === "EXPIRED" ? "Revisione scaduta" : "Revisione in scadenza",
            severity: deadline.revision.status === "EXPIRED" ? "HIGH" : "MEDIUM",
            booking
          });
        }
        if (booking.status === "CLOSED" && booking.returnKm === null) {
          items.push({ type: "MISSING_RETURN_KM", reason: "Km rientro mancanti", severity: "MEDIUM", booking });
        }
        if (!hasCompleteCustomer) {
          items.push({ type: "INCOMPLETE_CUSTOMER_PROFILE", reason: "Anagrafica cliente incompleta", severity: "MEDIUM", booking });
        }
        return items;
      })
      .slice(0, 10)
      .map((item) => ({
        type: item.type,
        reason: item.reason,
        severity: item.severity,
        bookingId: item.booking.id,
        code: item.booking.code,
        customer: item.booking.customerName,
        vehicle: `${item.booking.vehicle.plate} · ${item.booking.vehicle.brand} ${item.booking.vehicle.model}`,
        pickupAt: item.booking.pickupAt,
        returnAt: item.booking.returnAt,
        status: item.booking.status,
        contractStatus: item.booking.contract?.status ?? item.booking.contractStatus
      }));

    const trendStart = startOfDay(new Date(now.getTime() - 29 * dayMs));
    const trendRange: string[] = [];
    for (let cursor = new Date(trendStart); cursor <= todayEnd; cursor = new Date(cursor.getTime() + dayMs)) {
      trendRange.push(dateKey(cursor));
    }
    const bookingTrend = trendRange.map((day) => ({
      day,
      created: rentalBookings.filter((booking) => dateKey(booking.createdAt) === day).length,
      pickups: rentalBookings.filter((booking) => dateKey(booking.pickupAt) === day).length,
      returns: rentalBookings.filter((booking) => dateKey(booking.returnAt) === day).length
    }));

    const utilizationTrend = trendRange.map((day) => {
      const dayStart = new Date(`${day}T00:00:00.000Z`);
      const dayEnd = new Date(`${day}T23:59:59.999Z`);
      const occupied = rentalBookings.filter(
        (booking) => !closedRentalStatuses.has(booking.status) && booking.pickupAt <= dayEnd && booking.returnAt >= dayStart
      ).length;
      return {
        day,
        utilization: rentalVehicles.length ? Number(((occupied / rentalVehicles.length) * 100).toFixed(1)) : 0,
        occupied
      };
    });

    const topVehicleMap = new Map<string, { plate: string; model: string; occupiedDays: number; revenue: number }>();
    for (const booking of monthBookings) {
      const key = booking.vehicleId;
      const item = topVehicleMap.get(key) ?? {
        plate: booking.vehicle.plate,
        model: `${booking.vehicle.brand} ${booking.vehicle.model}`.trim(),
        occupiedDays: 0,
        revenue: 0
      };
      item.occupiedDays += daysDiff(booking.pickupAt, booking.returnAt);
      item.revenue += booking.pricingSnapshot?.finalTotal ?? booking.finalTotal ?? booking.pricingSnapshot?.expectedTotal ?? booking.expectedTotal ?? 0;
      topVehicleMap.set(key, item);
    }

    return {
      kpis: {
        totalStoppages: stoppages.length,
        openStoppages: openStoppages.length,
        newStoppagesLast30: newLast30,
        closedLast30,
        criticalOpen,
        overdueOpen,
        averageClosureDays: Number(avgClosureDays.toFixed(2))
      },
      charts: {
        byStatus
      },
      feeds: {
        recentUsers: users,
        recentStoppages,
        recentReminders: reminders.map((x) => ({
          id: x.id,
          sentAt: x.sentAt,
          success: x.success,
          type: x.type,
          channel: x.channel,
          recipient: x.recipient,
          plate: x.stoppage.vehicle.plate
        })),
        alerts
      },
      booking: {
        kpis: {
          totalRentalVehicles: rentalVehicles.length,
          availableToday: Math.max(0, rentalVehicles.length - occupiedToday.length),
          occupiedToday: occupiedToday.length,
          activeBookings: rentalBookings.filter((booking) => activeRentalStatuses.has(booking.status)).length,
          pickupsToday: pickupsToday.length,
          returnsToday: returnsToday.length,
          utilizationRateToday: rentalVehicles.length ? Number(((occupiedToday.length / rentalVehicles.length) * 100).toFixed(1)) : 0,
          overdueReturns: overdueReturns.length
        },
        contractKpis: {
          toGenerate: rentalBookings.filter((booking) => booking.contractRequired && !booking.contract).length,
          toSend: bookingContracts.filter((contract) => contract.status === "READY" && !contract.lastSentAt).length,
          sentToday: contractDeliveries.filter((delivery) => delivery.status === "SENT" && delivery.sentAt && delivery.sentAt >= todayStart && delivery.sentAt <= todayEnd).length,
          signed: bookingContracts.filter((contract) => contract.status === "SIGNED").length,
          errors: bookingContracts.filter((contract) => contract.status === "ERROR").length + deliveryFailures.length,
          unsigned: bookingContracts.filter((contract) => contract.status !== "SIGNED").length
        },
        economicKpis: {
          expectedRevenueMonth: roundMoney(expectedRevenueMonth),
          finalRevenueMonth: roundMoney(finalRevenueMonth),
          averageTicket: revenueBookings.length ? roundMoney(expectedRevenueMonth / revenueBookings.length) : 0,
          revenuePerVehicle: rentalVehicles.length ? roundMoney(expectedRevenueMonth / rentalVehicles.length) : 0,
          revenuePerRentalDay: rentedDaysMonth ? roundMoney(expectedRevenueMonth / rentedDaysMonth) : 0,
          extraKmEstimated: monthBookings.reduce((acc, booking) => acc + (booking.pricingSnapshot?.extraKmEstimated ?? 0), 0),
          extraKmActual: monthBookings.reduce((acc, booking) => acc + (booking.pricingSnapshot?.extraKmActual ?? 0), 0)
        },
        charts: {
          trend: bookingTrend,
          utilization: utilizationTrend,
          contractStatusDistribution,
          topVehicles: Array.from(topVehicleMap.values())
            .sort((a, b) => b.occupiedDays - a.occupiedDays)
            .slice(0, 8)
            .map((item) => ({ ...item, occupiedDays: Number(item.occupiedDays.toFixed(1)), revenue: roundMoney(item.revenue) }))
        },
        lists: {
          nextPickups: rentalBookings
            .filter((booking) => booking.pickupAt >= now)
            .slice(0, 6)
            .map((booking) => ({
              id: booking.id,
              code: booking.code,
              customer: booking.customerName,
              vehicle: `${booking.vehicle.plate} · ${booking.vehicle.brand} ${booking.vehicle.model}`,
              pickupAt: booking.pickupAt,
              status: booking.status,
              contractStatus: booking.contract?.status ?? booking.contractStatus
            })),
          nextReturns: rentalBookings
            .filter((booking) => booking.returnAt >= now)
            .sort((a, b) => a.returnAt.getTime() - b.returnAt.getTime())
            .slice(0, 6)
            .map((booking) => ({
              id: booking.id,
              code: booking.code,
              customer: booking.customerName,
              vehicle: `${booking.vehicle.plate} · ${booking.vehicle.brand} ${booking.vehicle.model}`,
              returnAt: booking.returnAt,
              returnKm: booking.returnKm,
              status: booking.status,
              contractStatus: booking.contract?.status ?? booking.contractStatus
            })),
          criticalBookings
        }
      }
    };
  }

  async analytics(tenantId: string, filters: AnalyticsFilters) {
    const now = new Date();
    const start = filters.dateFrom ?? new Date(now.getTime() - 90 * dayMs);
    const end = filters.dateTo ?? now;

    const whereBase = {
      tenantId,
      deletedAt: null,
      ...(filters.siteId ? { siteId: filters.siteId } : {}),
      ...(filters.workshopId ? { workshopId: filters.workshopId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      vehicle: {
        ...(filters.plate ? { plate: { contains: filters.plate, mode: "insensitive" as const } } : {}),
        ...(filters.brand ? { brand: { contains: filters.brand, mode: "insensitive" as const } } : {}),
        ...(filters.model ? { model: { contains: filters.model, mode: "insensitive" as const } } : {})
      }
    };

    const [stoppageRows, closedTrendRows, reminders] = await Promise.all([
      prisma.stoppage.findMany({
        where: { ...whereBase, openedAt: { gte: start, lte: end } },
        include: {
          site: true,
          workshop: true,
          vehicle: true,
          reminders: true
        },
        orderBy: { openedAt: "desc" }
      }),
      prisma.stoppage.findMany({
        where: { ...whereBase, closedAt: { gte: start, lte: end } },
        select: { closedAt: true }
      }),
      prisma.reminder.findMany({
        where: {
          tenantId,
          sentAt: { gte: start, lte: end },
          stoppage: whereBase
        },
        orderBy: { sentAt: "asc" }
      })
    ]);
    const stoppages = await exactMoneyReader.hydrate(
      "Stoppage",
      stoppageRows,
      { tenantId }
    );

    const activeStatuses = new Set<StoppageStatus>(["OPEN", "IN_PROGRESS", "WAITING_PARTS", "SOLICITED"]);
    const closed = stoppages.filter((x) => x.status === "CLOSED" && x.closedAt);
    const open = stoppages.filter((x) => activeStatuses.has(x.status));
    const closureDurations = closed.map((x) => daysDiff(x.openedAt, x.closedAt!)).sort((a, b) => a - b);
    const openAges = open.map((x) => daysDiff(x.openedAt, now));
    const totalReminders = reminders.length;
    const successReminders = reminders.filter((x) => x.success).length;
    const manualReminders = reminders.filter((x) => x.type === "MANUAL").length;
    const automaticReminders = reminders.filter((x) => x.type === "AUTOMATIC").length;

    const statusCounts = Object.values(StoppageStatus).map((status) => ({
      status,
      count: stoppages.filter((x) => x.status === status).length
    }));

    const priorityCounts = (["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).map((priority) => ({
      priority,
      count: stoppages.filter((x) => x.priority === priority).length
    }));

    const bySiteMap = new Map<string, number>();
    const byWorkshopMap = new Map<string, number>();
    const byBrandMap = new Map<string, number>();
    const byVehicleMap = new Map<string, { plate: string; brand: string; model: string; count: number; openDays: number }>();
    const openedDailyMap = new Map<string, number>();
    const closedDailyMap = new Map<string, number>();
    const reminderDailyMap = new Map<string, number>();

    for (const stoppage of stoppages) {
      bySiteMap.set(stoppage.site.name, (bySiteMap.get(stoppage.site.name) ?? 0) + 1);
      byWorkshopMap.set(stoppage.workshop.name, (byWorkshopMap.get(stoppage.workshop.name) ?? 0) + 1);
      byBrandMap.set(stoppage.vehicle.brand, (byBrandMap.get(stoppage.vehicle.brand) ?? 0) + 1);

      const vehicleKey = stoppage.vehicleId;
      const existingVehicle = byVehicleMap.get(vehicleKey) ?? {
        plate: stoppage.vehicle.plate,
        brand: stoppage.vehicle.brand,
        model: stoppage.vehicle.model,
        count: 0,
        openDays: 0
      };
      existingVehicle.count += 1;
      existingVehicle.openDays += daysDiff(stoppage.openedAt, stoppage.closedAt ?? now);
      byVehicleMap.set(vehicleKey, existingVehicle);

      const openKey = stoppage.openedAt.toISOString().slice(0, 10);
      openedDailyMap.set(openKey, (openedDailyMap.get(openKey) ?? 0) + 1);

    }

    for (const row of closedTrendRows) {
      if (!row.closedAt) continue;
      const closeKey = row.closedAt.toISOString().slice(0, 10);
      closedDailyMap.set(closeKey, (closedDailyMap.get(closeKey) ?? 0) + 1);
    }

    for (const reminder of reminders) {
      const key = reminder.sentAt.toISOString().slice(0, 10);
      reminderDailyMap.set(key, (reminderDailyMap.get(key) ?? 0) + 1);
    }

    const trendRange: string[] = [];
    for (let cursor = new Date(start); cursor <= end; cursor = new Date(cursor.getTime() + dayMs)) {
      trendRange.push(cursor.toISOString().slice(0, 10));
    }

    const trendStoppages = trendRange.map((day) => ({
      day,
      opened: openedDailyMap.get(day) ?? 0,
      closed: closedDailyMap.get(day) ?? 0,
      reminders: reminderDailyMap.get(day) ?? 0
    }));

    const agingBuckets = [
      { bucket: "0-3", count: 0 },
      { bucket: "4-7", count: 0 },
      { bucket: "8-15", count: 0 },
      { bucket: "16-30", count: 0 },
      { bucket: "31+", count: 0 }
    ];

    for (const age of openAges) {
      if (age <= 3) agingBuckets[0].count += 1;
      else if (age <= 7) agingBuckets[1].count += 1;
      else if (age <= 15) agingBuckets[2].count += 1;
      else if (age <= 30) agingBuckets[3].count += 1;
      else agingBuckets[4].count += 1;
    }

    const averageClosure = closureDurations.length
      ? closureDurations.reduce((acc, value) => acc + value, 0) / closureDurations.length
      : 0;
    const averageOpenAge = openAges.length ? openAges.reduce((acc, value) => acc + value, 0) / openAges.length : 0;
    const closureRate7 = closed.length ? (closed.filter((x) => daysDiff(x.openedAt, x.closedAt!) <= 7).length / closed.length) * 100 : 0;
    const closureRate30 = closed.length ? (closed.filter((x) => daysDiff(x.openedAt, x.closedAt!) <= 30).length / closed.length) * 100 : 0;
    const closureRate60 = closed.length ? (closed.filter((x) => daysDiff(x.openedAt, x.closedAt!) <= 60).length / closed.length) * 100 : 0;

    const estimatedOpenCost = open.reduce((acc, x) => acc + (x.estimatedCostPerDay ?? 0) * daysDiff(x.openedAt, now), 0);
    const estimatedTotalCost = stoppages.reduce((acc, x) => acc + (x.estimatedCostPerDay ?? 0) * daysDiff(x.openedAt, x.closedAt ?? now), 0);

    return {
      filtersApplied: {
        dateFrom: start.toISOString(),
        dateTo: end.toISOString(),
        siteId: filters.siteId ?? null,
        workshopId: filters.workshopId ?? null,
        status: filters.status ?? null,
        plate: filters.plate ?? null,
        brand: filters.brand ?? null,
        model: filters.model ?? null
      },
      kpis: {
        totalStoppages: stoppages.length,
        openStoppages: open.length,
        closedStoppages: closed.length,
        canceledStoppages: stoppages.filter((x) => x.status === "CANCELED").length,
        criticalOpen: open.filter((x) => x.priority === "CRITICAL").length,
        highOpen: open.filter((x) => x.priority === "HIGH").length,
        averageClosureDays: Number(averageClosure.toFixed(2)),
        medianClosureDays: Number(median(closureDurations).toFixed(2)),
        p90ClosureDays: Number(percentile(closureDurations, 90).toFixed(2)),
        averageOpenAgeDays: Number(averageOpenAge.toFixed(2)),
        closureRateWithin7Days: Number(closureRate7.toFixed(2)),
        closureRateWithin30Days: Number(closureRate30.toFixed(2)),
        closureRateWithin60Days: Number(closureRate60.toFixed(2)),
        remindersTotal: totalReminders,
        reminderSuccessRate: totalReminders ? Number(((successReminders / totalReminders) * 100).toFixed(2)) : 0,
        automaticReminderRate: totalReminders ? Number(((automaticReminders / totalReminders) * 100).toFixed(2)) : 0,
        manualReminderRate: totalReminders ? Number(((manualReminders / totalReminders) * 100).toFixed(2)) : 0,
        remindersPerStoppage: stoppages.length ? Number((totalReminders / stoppages.length).toFixed(2)) : 0,
        estimatedOpenCost: Number(estimatedOpenCost.toFixed(2)),
        estimatedTotalCost: Number(estimatedTotalCost.toFixed(2))
      },
      charts: {
        byStatus: statusCounts,
        byPriority: priorityCounts,
        bySite: Array.from(bySiteMap.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
        byWorkshop: Array.from(byWorkshopMap.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10),
        byBrand: Array.from(byBrandMap.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10),
        agingBuckets,
        trendStoppages
      },
      tables: {
        topVehiclesDowntime: Array.from(byVehicleMap.values())
          .sort((a, b) => b.openDays - a.openDays)
          .slice(0, 10)
          .map((x) => ({ ...x, openDays: Number(x.openDays.toFixed(2)) })),
        longestOpen: open
          .map((x) => ({
            id: x.id,
            plate: x.vehicle.plate,
            brand: x.vehicle.brand,
            model: x.vehicle.model,
            site: x.site.name,
            workshop: x.workshop.name,
            status: x.status,
            priority: x.priority,
            openDays: Number(daysDiff(x.openedAt, now).toFixed(2))
          }))
          .sort((a, b) => b.openDays - a.openDays)
          .slice(0, 10),
        reminderFailures: reminders
          .filter((x) => !x.success)
          .slice(-10)
          .reverse()
          .map((x) => ({
            id: x.id,
            sentAt: x.sentAt,
            recipient: x.recipient,
            type: x.type,
            errorMessage: x.errorMessage
          }))
      }
    };
  }

  async workshopHealth(tenantId: string, dateFrom?: Date, dateTo?: Date) {
    const now = new Date();
    const start = dateFrom ?? new Date(now.getTime() - 180 * dayMs);
    const end = dateTo ?? now;

    const rows = await prisma.stoppage.findMany({
      where: { tenantId, deletedAt: null, openedAt: { gte: start, lte: end } },
      include: { workshop: true, reminders: true }
    });

    const grouped = new Map<
      string,
      { name: string; total: number; closed: number; totalClosureDays: number; reminders: number; reminderFailures: number; openOver30: number }
    >();

    for (const row of rows) {
      const g = grouped.get(row.workshopId) ?? {
        name: row.workshop.name,
        total: 0,
        closed: 0,
        totalClosureDays: 0,
        reminders: 0,
        reminderFailures: 0,
        openOver30: 0
      };
      g.total += 1;
      if (row.closedAt) {
        g.closed += 1;
        g.totalClosureDays += daysDiff(row.openedAt, row.closedAt);
      } else if (daysDiff(row.openedAt, now) > 30) {
        g.openOver30 += 1;
      }
      g.reminders += row.reminders.length;
      g.reminderFailures += row.reminders.filter((x) => !x.success).length;
      grouped.set(row.workshopId, g);
    }

    const data = Array.from(grouped.entries()).map(([workshopId, g]) => {
      const avgClosure = g.closed ? g.totalClosureDays / g.closed : 999;
      const failureRate = g.reminders ? (g.reminderFailures / g.reminders) * 100 : 0;
      const closureRate = g.total ? (g.closed / g.total) * 100 : 0;
      const over30Rate = g.total ? (g.openOver30 / g.total) * 100 : 0;

      // score 0-100: higher is better
      const score = Math.max(
        0,
        Math.min(
          100,
          100 -
            avgClosure * 1.3 -
            failureRate * 0.7 -
            over30Rate * 0.8 +
            closureRate * 0.4
        )
      );

      return {
        workshopId,
        workshop: g.name,
        totalStoppages: g.total,
        averageClosureDays: Number((g.closed ? avgClosure : 0).toFixed(2)),
        closureRate: Number(closureRate.toFixed(2)),
        reminderFailureRate: Number(failureRate.toFixed(2)),
        over30OpenRate: Number(over30Rate.toFixed(2)),
        healthScore: Number(score.toFixed(2)),
        grade: score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "E"
      };
    });

    return data.sort((a, b) => b.healthScore - a.healthScore);
  }

  async teamPerformance(tenantId: string, dateFrom?: Date, dateTo?: Date) {
    const now = new Date();
    const start = dateFrom ?? new Date(now.getTime() - 90 * dayMs);
    const end = dateTo ?? now;

    const [users, stoppages] = await Promise.all([
      prisma.user.findMany({
        where: { tenantId, deletedAt: null, status: "ACTIVE" },
        select: { id: true, firstName: true, lastName: true, email: true }
      }),
      prisma.stoppage.findMany({
        where: { tenantId, deletedAt: null, openedAt: { gte: start, lte: end } },
        select: { id: true, assignedToUserId: true, status: true, openedAt: true, closedAt: true }
      })
    ]);

    return users.map((user) => {
      const assigned = stoppages.filter((x) => x.assignedToUserId === user.id);
      const closed = assigned.filter((x) => x.status === "CLOSED" && x.closedAt);
      const avgClosure = closed.length
        ? closed.reduce((acc, x) => acc + daysDiff(x.openedAt, x.closedAt!), 0) / closed.length
        : 0;
      return {
        userId: user.id,
        name: `${user.firstName} ${user.lastName}`,
        email: user.email,
        assignedTotal: assigned.length,
        closedTotal: closed.length,
        openTotal: assigned.length - closed.length,
        avgClosureDays: Number(avgClosure.toFixed(2))
      };
    });
  }

  async aiSuggestions(tenantId: string) {
    const now = new Date();
    const rows = await prisma.stoppage.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: { in: ["OPEN", "IN_PROGRESS", "WAITING_PARTS", "SOLICITED"] }
      },
      include: { vehicle: true, workshop: true, site: true }
    });

    const suggestions = rows
      .map((item) => {
        const days = daysDiff(item.openedAt, now);
        const risk = Math.min(
          100,
          Math.round(
            days * 3 +
              (item.priority === "CRITICAL" ? 35 : item.priority === "HIGH" ? 22 : item.priority === "MEDIUM" ? 12 : 5) +
              (item.status === "WAITING_PARTS" ? 10 : 0)
          )
        );
        return {
          stoppageId: item.id,
          plate: item.vehicle.plate,
          site: item.site.name,
          workshop: item.workshop.name,
          status: item.status,
          priority: item.priority,
          daysOpen: Number(days.toFixed(1)),
          riskScore: risk,
          recommendation:
            risk >= 80
              ? "Escalation immediata e contatto officina entro 2 ore"
              : risk >= 60
                ? "Inviare sollecito prioritario e verificare ETA ricambi"
                : "Monitoraggio standard con reminder schedulato"
        };
      })
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 20);

    return { data: suggestions };
  }

  async workshopsCapacity(tenantId: string, dateFrom?: Date, dateTo?: Date) {
    const now = new Date();
    const start = dateFrom ?? new Date(now.getTime() - 30 * dayMs);
    const end = dateTo ?? new Date(now.getTime() + 30 * dayMs);
    const rows = await prisma.stoppage.findMany({
      where: {
        tenantId,
        deletedAt: null,
        openedAt: { lte: end },
        OR: [{ closedAt: null }, { closedAt: { gte: start } }]
      },
      include: { workshop: true }
    });
    const map = new Map<string, { workshop: string; active: number; critical: number; high: number }>();
    rows.forEach((row) => {
      const entry = map.get(row.workshopId) ?? { workshop: row.workshop.name, active: 0, critical: 0, high: 0 };
      if (row.status !== "CLOSED" && row.status !== "CANCELED") {
        entry.active += 1;
        if (row.priority === "CRITICAL") entry.critical += 1;
        if (row.priority === "HIGH") entry.high += 1;
      }
      map.set(row.workshopId, entry);
    });
    return Array.from(map.entries())
      .map(([workshopId, x]) => ({
        workshopId,
        workshop: x.workshop,
        active: x.active,
        critical: x.critical,
        high: x.high,
        utilizationScore: Math.min(100, x.active * 8 + x.high * 4 + x.critical * 8)
      }))
      .sort((a, b) => b.utilizationScore - a.utilizationScore);
  }
}
