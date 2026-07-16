import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import ExcelJS from "exceljs";
import { prisma } from "../../infrastructure/database/prisma/client.js";
import { exactMoneyReader } from "../../infrastructure/database/exact-money-reader.js";
import { AppError } from "../../shared/errors/app-error.js";

const DAY_MS = 86_400_000;

const DEFAULT_STATUSES = ["CONFIRMED", "CONTRACT_SIGNED", "READY_FOR_HANDOVER", "IN_RENT", "CLOSED"] as const;
const CONFIRMED_STATUSES = new Set(["CONTRACT_SIGNED", "READY_FOR_HANDOVER", "IN_RENT", "CLOSED"]);
const CONTRACT_STATUSES = new Set(["READY", "SENT", "SIGNED"]);

export type VehicleProfitabilityParams = {
  vehicleId?: string;
  siteId?: string;
  dateFrom: Date;
  dateTo: Date;
  includeVat: boolean;
  includeCosts: boolean;
  statuses?: string[];
};

const round2 = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
const clampDate = (date: Date, min: Date, max: Date) => new Date(Math.min(max.getTime(), Math.max(min.getTime(), date.getTime())));
const dayKey = (date: Date) => date.toISOString().slice(0, 10);

const dateRangeDays = (start: Date, end: Date) => {
  const days = new Set<string>();
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);
  while (cursor <= last) {
    days.add(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
};

const diffInclusiveDays = (start: Date, end: Date) => Math.max(1, Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1);

const revenueFromBooking = (booking: any, includeVat: boolean) => {
  const snapshot = booking.pricingSnapshot;
  const total = Number(snapshot?.finalTotal ?? booking.finalTotal ?? snapshot?.expectedTotal ?? booking.expectedTotal ?? 0);
  const subtotal = Number(snapshot?.finalSubtotal ?? snapshot?.expectedSubtotal ?? 0);
  const vatRate = Number(snapshot?.vatRate ?? 22);
  if (!includeVat && subtotal > 0) return subtotal;
  if (!includeVat && total > 0 && vatRate > 0) return total / (1 + vatRate / 100);
  return total;
};

const sourceForBooking = (booking: any) => {
  if (booking.contract?.status && CONTRACT_STATUSES.has(String(booking.contract.status))) return "CONTRACT";
  if (CONFIRMED_STATUSES.has(String(booking.status))) return "BOOKING_CONFIRMED";
  return "BOOKING_EXPECTED";
};

const monthLabel = (value: Date) => value.toISOString().slice(0, 7);

export class VehicleProfitabilityReportService {
  async build(tenantId: string, params: VehicleProfitabilityParams) {
    if (params.dateTo < params.dateFrom) {
      throw new AppError("Intervallo date non valido", 400, "INVALID_DATE_RANGE");
    }

    const statuses = params.statuses?.length ? params.statuses : [...DEFAULT_STATUSES];
    const vehicleWhere: any = {
      tenantId,
      deletedAt: null,
      ...(params.vehicleId ? { id: params.vehicleId } : {}),
      ...(params.siteId ? { siteId: params.siteId } : {})
    };

    const vehicleRows = await prisma.vehicle.findMany({
      where: vehicleWhere,
      orderBy: [{ plate: "asc" }],
      include: { site: { select: { id: true, name: true, city: true } } }
    });
    const vehicles = await exactMoneyReader.hydrate(
      "Vehicle",
      vehicleRows,
      { tenantId }
    );

    if (params.vehicleId && vehicles.length === 0) {
      throw new AppError("Veicolo non trovato", 404, "NOT_FOUND");
    }

    const vehicleIds = vehicles.map((vehicle) => vehicle.id);
    if (!vehicleIds.length) {
      return this.empty(params);
    }

    const [bookingRows, maintenanceRows, vehicleCostRows, stoppages] = await Promise.all([
      prisma.rentalBooking.findMany({
        where: {
          tenantId,
          deletedAt: null,
          vehicleId: { in: vehicleIds },
          status: { in: statuses as any },
          pickupAt: { lte: params.dateTo },
          returnAt: { gte: params.dateFrom }
        },
        orderBy: [{ pickupAt: "asc" }],
        include: {
          vehicle: { select: { id: true, plate: true, brand: true, model: true } },
          contract: { select: { id: true, status: true } },
          pricingSnapshot: true
        }
      }),
      prisma.vehicleMaintenance.findMany({
        where: {
          tenantId,
          deletedAt: null,
          vehicleId: { in: vehicleIds },
          performedAt: { gte: params.dateFrom, lte: params.dateTo }
        },
        select: { id: true, vehicleId: true, cost: true, performedAt: true, maintenanceType: true, description: true }
      }),
      prisma.vehicleCost.findMany({
        where: {
          tenantId,
          deletedAt: null,
          vehicleId: { in: vehicleIds },
          date: { gte: params.dateFrom, lte: params.dateTo }
        },
        select: { id: true, vehicleId: true, amount: true, type: true, description: true, date: true, recurring: true }
      }),
      prisma.stoppage.findMany({
        where: {
          tenantId,
          deletedAt: null,
          vehicleId: { in: vehicleIds },
          status: { not: "CANCELED" as any },
          openedAt: { lte: params.dateTo },
          OR: [{ closedAt: null }, { closedAt: { gte: params.dateFrom } }]
        },
        select: { vehicleId: true, openedAt: true, closedAt: true }
      })
    ]);
    const [exactBookingRows, maintenances, vehicleCosts, pricingSnapshots] = await Promise.all([
      exactMoneyReader.hydrate("RentalBooking", bookingRows, { tenantId }),
      exactMoneyReader.hydrate("VehicleMaintenance", maintenanceRows, { tenantId }),
      exactMoneyReader.hydrate("VehicleCost", vehicleCostRows, { tenantId }),
      exactMoneyReader.hydrate(
        "RentalBookingPricingSnapshot",
        bookingRows.flatMap((booking) =>
          booking.pricingSnapshot ? [booking.pricingSnapshot] : []
        ),
        { tenantId }
      )
    ]);
    const pricingSnapshotById = new Map(
      pricingSnapshots.map((snapshot) => [snapshot.id, snapshot])
    );
    const bookings = exactBookingRows.map((booking) => ({
      ...booking,
      pricingSnapshot: booking.pricingSnapshot
        ? (pricingSnapshotById.get(booking.pricingSnapshot.id) ?? booking.pricingSnapshot)
        : null
    }));

    const periodDays = diffInclusiveDays(params.dateFrom, params.dateTo);
    const byVehicle = new Map<string, any>();
    vehicles.forEach((vehicle) => {
      byVehicle.set(vehicle.id, {
        vehicleId: vehicle.id,
        plate: vehicle.plate,
        brand: vehicle.brand,
        model: vehicle.model,
        siteName: vehicle.site?.name ?? undefined,
        purchasePrice: vehicle.purchasePrice ?? null,
        purchaseDate: vehicle.purchaseDate?.toISOString() ?? null,
        residualValue: vehicle.residualValue ?? null,
        monthlyFixedCost: vehicle.monthlyFixedCost ?? null,
        revenue: 0,
        contractedRevenue: 0,
        expectedRevenue: 0,
        costs: 0,
        margin: 0,
        rentedDayKeys: new Set<string>(),
        technicalStopDayKeys: new Set<string>(),
        rentedDays: 0,
        technicalStopDays: 0,
        utilizationRate: 0,
        bookingsCount: 0,
        contractsCount: 0,
        recoveredPercentage: null as number | null,
        remainingToBreakEven: null as number | null,
        breakEvenReached: null as boolean | null,
        estimatedBreakEvenDate: null as string | null
      });
    });

    const rows = bookings.map((booking: any) => {
      const clippedStart = clampDate(booking.pickupAt, params.dateFrom, params.dateTo);
      const clippedEnd = clampDate(booking.returnAt, params.dateFrom, params.dateTo);
      const days = diffInclusiveDays(clippedStart, clippedEnd);
      const revenue = round2(revenueFromBooking(booking, params.includeVat));
      const source = sourceForBooking(booking);
      const vehicleRow = byVehicle.get(booking.vehicleId);

      if (vehicleRow) {
        vehicleRow.revenue += revenue;
        vehicleRow.bookingsCount += 1;
        if (booking.contract?.id) vehicleRow.contractsCount += 1;
        if (source === "CONTRACT") vehicleRow.contractedRevenue += revenue;
        else vehicleRow.expectedRevenue += revenue;
        dateRangeDays(clippedStart, clippedEnd).forEach((day) => vehicleRow.rentedDayKeys.add(day));
      }

      return {
        bookingId: booking.id,
        contractId: booking.contract?.id ?? undefined,
        vehicleId: booking.vehicleId,
        plate: booking.vehicle?.plate ?? "-",
        customerName: booking.customerName,
        startDate: booking.pickupAt.toISOString(),
        endDate: booking.returnAt.toISOString(),
        days,
        status: booking.status,
        contractStatus: booking.contract?.status ?? booking.contractStatus,
        revenue,
        extras: round2(Number(booking.pricingSnapshot?.extraKmActualCost ?? booking.pricingSnapshot?.extraKmEstimatedCost ?? 0)),
        total: revenue,
        source
      };
    });

    if (params.includeCosts) {
      maintenances.forEach((cost) => {
        const row = byVehicle.get(cost.vehicleId);
        if (row) row.costs += Number(cost.cost ?? 0);
      });
      vehicleCosts.forEach((cost) => {
        const row = byVehicle.get(cost.vehicleId);
        if (row) row.costs += Number(cost.amount ?? 0);
      });
      vehicles.forEach((vehicle) => {
        const row = byVehicle.get(vehicle.id);
        const fixed = Number(vehicle.monthlyFixedCost ?? 0);
        if (row && fixed > 0) row.costs += fixed * (periodDays / 30);
      });
    }

    stoppages.forEach((stoppage) => {
      const row = byVehicle.get(stoppage.vehicleId);
      if (!row) return;
      const clippedStart = clampDate(stoppage.openedAt, params.dateFrom, params.dateTo);
      const clippedEnd = clampDate(stoppage.closedAt ?? params.dateTo, params.dateFrom, params.dateTo);
      dateRangeDays(clippedStart, clippedEnd).forEach((day) => row.technicalStopDayKeys.add(day));
    });

    const trendMap = new Map<string, { month: string; revenue: number; costs: number; margin: number }>();
    for (const row of rows) {
      const month = monthLabel(new Date(row.startDate));
      const entry = trendMap.get(month) ?? { month, revenue: 0, costs: 0, margin: 0 };
      entry.revenue += row.revenue;
      trendMap.set(month, entry);
    }

    const vehiclesReport = Array.from(byVehicle.values()).map((row) => {
      row.rentedDays = row.rentedDayKeys.size;
      row.technicalStopDays = row.technicalStopDayKeys.size;
      row.utilizationRate = round2((row.rentedDays / Math.max(1, periodDays)) * 100);
      row.revenue = round2(row.revenue);
      row.contractedRevenue = round2(row.contractedRevenue);
      row.expectedRevenue = round2(row.expectedRevenue);
      row.costs = round2(row.costs);
      row.margin = round2(row.revenue - row.costs);
      const purchasePrice = Number(row.purchasePrice ?? 0);
      if (purchasePrice > 0) {
        row.recoveredPercentage = round2((row.margin / purchasePrice) * 100);
        row.remainingToBreakEven = round2(Math.max(0, purchasePrice - row.margin));
        row.breakEvenReached = row.margin >= purchasePrice;
        const avgMonthlyMargin = row.margin / Math.max(1, periodDays / 30);
        if (!row.breakEvenReached && avgMonthlyMargin > 0) {
          const months = Math.ceil(row.remainingToBreakEven / avgMonthlyMargin);
          const estimate = new Date(params.dateTo);
          estimate.setMonth(estimate.getMonth() + months);
          row.estimatedBreakEvenDate = estimate.toISOString();
        }
      }
      delete row.rentedDayKeys;
      delete row.technicalStopDayKeys;
      return row;
    });

    vehicleCosts.forEach((cost) => {
      const month = monthLabel(cost.date);
      const entry = trendMap.get(month) ?? { month, revenue: 0, costs: 0, margin: 0 };
      entry.costs += Number(cost.amount ?? 0);
      trendMap.set(month, entry);
    });
    maintenances.forEach((cost) => {
      const month = monthLabel(cost.performedAt);
      const entry = trendMap.get(month) ?? { month, revenue: 0, costs: 0, margin: 0 };
      entry.costs += Number(cost.cost ?? 0);
      trendMap.set(month, entry);
    });

    const totalRevenue = round2(vehiclesReport.reduce((sum, row) => sum + row.revenue, 0));
    const totalCosts = round2(vehiclesReport.reduce((sum, row) => sum + row.costs, 0));
    const grossMargin = round2(totalRevenue - totalCosts);
    const rentedDays = vehiclesReport.reduce((sum, row) => sum + row.rentedDays, 0);
    const technicalStopDays = vehiclesReport.reduce((sum, row) => sum + row.technicalStopDays, 0);
    const availableDays = Math.max(0, periodDays * Math.max(1, vehiclesReport.length) - technicalStopDays);
    const utilizationRate = round2((rentedDays / Math.max(1, availableDays)) * 100);
    const purchasePrice = vehiclesReport.length === 1 ? Number(vehiclesReport[0]?.purchasePrice ?? 0) : vehiclesReport.reduce((sum, row) => sum + Number(row.purchasePrice ?? 0), 0);
    const recoveredPercentage = purchasePrice > 0 ? round2((grossMargin / purchasePrice) * 100) : null;
    const remainingToBreakEven = purchasePrice > 0 ? round2(Math.max(0, purchasePrice - grossMargin)) : null;

    const trend = Array.from(trendMap.values())
      .map((entry) => ({ ...entry, revenue: round2(entry.revenue), costs: round2(entry.costs), margin: round2(entry.revenue - entry.costs) }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return {
      period: { from: params.dateFrom.toISOString(), to: params.dateTo.toISOString(), days: periodDays },
      filters: {
        vehicleId: params.vehicleId ?? null,
        siteId: params.siteId ?? null,
        includeVat: params.includeVat,
        includeCosts: params.includeCosts,
        statuses
      },
      dataQuality: {
        revenueBasis: "Basato su booking, contratti e pricing snapshot disponibili",
        costBasis: params.includeCosts ? "Costi da manutenzioni, costi manuali e costi fissi veicolo" : "Costi esclusi dal report",
        isEstimate: true,
        notes: [
          "Ricavi incassati e fatturati sono disponibili solo se collegati a moduli pagamento/fatture.",
          "ROI e break-even sono stime operative basate sui dati presenti nel gestionale."
        ]
      },
      summary: {
        totalRevenue,
        totalCosts,
        grossMargin,
        netMarginEstimate: grossMargin,
        rentedDays,
        availableDays,
        technicalStopDays,
        utilizationRate,
        contractsCount: vehiclesReport.reduce((sum, row) => sum + row.contractsCount, 0),
        bookingsCount: rows.length
      },
      investment: {
        purchasePrice: purchasePrice > 0 ? round2(purchasePrice) : null,
        recoveredAmount: grossMargin,
        recoveredPercentage,
        remainingToBreakEven,
        breakEvenReached: purchasePrice > 0 ? grossMargin >= purchasePrice : null,
        estimatedBreakEvenDate: vehiclesReport.length === 1 ? vehiclesReport[0]?.estimatedBreakEvenDate ?? null : null
      },
      vehicles: vehiclesReport.sort((a, b) => b.margin - a.margin),
      rows,
      trend,
      costs: [
        ...maintenances.map((cost) => ({ vehicleId: cost.vehicleId, type: "MAINTENANCE", description: cost.description ?? cost.maintenanceType, amount: Number(cost.cost ?? 0), date: cost.performedAt.toISOString() })),
        ...vehicleCosts.map((cost) => ({ vehicleId: cost.vehicleId, type: cost.type, description: cost.description, amount: Number(cost.amount ?? 0), date: cost.date.toISOString() }))
      ]
    };
  }

  async toCsv(report: any) {
    const esc = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const lines = [
      ["Fleetum", "Report redditivita veicolo"],
      ["Periodo", `${report.period.from} - ${report.period.to}`],
      ["Fatturato", report.summary.totalRevenue],
      ["Costi", report.summary.totalCosts],
      ["Margine", report.summary.grossMargin],
      [],
      ["Targa", "Veicolo", "Sede", "Ricavi", "Costi", "Margine", "Giorni noleggiati", "Occupazione %", "Investimento recuperato %"],
      ...report.vehicles.map((vehicle: any) => [vehicle.plate, `${vehicle.brand} ${vehicle.model}`, vehicle.siteName ?? "-", vehicle.revenue, vehicle.costs, vehicle.margin, vehicle.rentedDays, vehicle.utilizationRate, vehicle.recoveredPercentage ?? "n/d"]),
      [],
      ["Booking", "Contratto", "Targa", "Cliente", "Uscita", "Rientro", "Giorni", "Stato", "Fonte", "Totale"],
      ...report.rows.map((row: any) => [row.bookingId, row.contractId ?? "-", row.plate, row.customerName, row.startDate, row.endDate, row.days, row.status, row.source, row.total])
    ];
    return `\uFEFF${lines.map((line) => line.map(esc).join(";")).join("\r\n")}`;
  }

  async toXlsx(report: any) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Fleetum";
    workbook.created = new Date();

    const summary = workbook.addWorksheet("Riepilogo");
    summary.columns = [{ width: 34 }, { width: 22 }, { width: 22 }, { width: 22 }];
    summary.addRows([
      ["Fleetum - Report redditivita veicolo"],
      ["Periodo", report.period.from, report.period.to],
      ["Fatturato generato", report.summary.totalRevenue],
      ["Costi", report.summary.totalCosts],
      ["Margine stimato", report.summary.grossMargin],
      ["Investimento recuperato %", report.investment.recoveredPercentage ?? "n/d"],
      ["Residuo break-even", report.investment.remainingToBreakEven ?? "n/d"],
      ["Base dato", report.dataQuality.revenueBasis]
    ]);
    summary.getRow(1).font = { bold: true, size: 16, color: { argb: "FF07111F" } };

    const vehicles = workbook.addWorksheet("Veicoli");
    vehicles.columns = [
      { header: "Targa", key: "plate", width: 14 },
      { header: "Veicolo", key: "vehicle", width: 26 },
      { header: "Sede", key: "site", width: 22 },
      { header: "Ricavi", key: "revenue", width: 14 },
      { header: "Costi", key: "costs", width: 14 },
      { header: "Margine", key: "margin", width: 14 },
      { header: "Giorni noleggiati", key: "rentedDays", width: 18 },
      { header: "Occupazione %", key: "utilizationRate", width: 16 },
      { header: "Recupero %", key: "recoveredPercentage", width: 16 }
    ];
    report.vehicles.forEach((vehicle: any) => vehicles.addRow({ plate: vehicle.plate, vehicle: `${vehicle.brand} ${vehicle.model}`, site: vehicle.siteName ?? "-", revenue: vehicle.revenue, costs: vehicle.costs, margin: vehicle.margin, rentedDays: vehicle.rentedDays, utilizationRate: vehicle.utilizationRate, recoveredPercentage: vehicle.recoveredPercentage ?? null }));

    const details = workbook.addWorksheet("Dettaglio noleggi");
    details.columns = [
      { header: "Booking", key: "bookingId", width: 28 },
      { header: "Contratto", key: "contractId", width: 28 },
      { header: "Targa", key: "plate", width: 14 },
      { header: "Cliente", key: "customerName", width: 28 },
      { header: "Uscita", key: "startDate", width: 24 },
      { header: "Rientro", key: "endDate", width: 24 },
      { header: "Giorni", key: "days", width: 10 },
      { header: "Stato", key: "status", width: 18 },
      { header: "Fonte", key: "source", width: 22 },
      { header: "Totale", key: "total", width: 14 }
    ];
    report.rows.forEach((row: any) => details.addRow(row));

    const costs = workbook.addWorksheet("Costi");
    costs.columns = [
      { header: "Veicolo", key: "vehicleId", width: 28 },
      { header: "Tipo", key: "type", width: 18 },
      { header: "Descrizione", key: "description", width: 32 },
      { header: "Data", key: "date", width: 24 },
      { header: "Importo", key: "amount", width: 14 }
    ];
    report.costs.forEach((row: any) => costs.addRow(row));

    const params = workbook.addWorksheet("Parametri report");
    params.columns = [{ width: 30 }, { width: 80 }];
    Object.entries(report.filters).forEach(([key, value]) => params.addRow([key, Array.isArray(value) ? value.join(", ") : String(value ?? "-")]));
    report.dataQuality.notes.forEach((note: string) => params.addRow(["nota", note]));

    return workbook.xlsx.writeBuffer();
  }

  async toPdf(report: any) {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const navy = rgb(0.03, 0.07, 0.12);
    const blue = rgb(0.15, 0.39, 1);
    let y = 790;
    const text = (value: string, x: number, size = 10, isBold = false, color = navy) => {
      page.drawText(value.slice(0, 110), { x, y, size, font: isBold ? bold : font, color });
      y -= size + 8;
    };
    text("Fleetum", 430, 18, true, blue);
    y = 790;
    text("Report redditivita veicolo", 48, 20, true);
    text(`Periodo: ${report.period.from.slice(0, 10)} - ${report.period.to.slice(0, 10)}`, 48, 10);
    y -= 10;
    text(`Fatturato generato: EUR ${report.summary.totalRevenue.toLocaleString("it-IT")}`, 48, 13, true);
    text(`Margine stimato: EUR ${report.summary.grossMargin.toLocaleString("it-IT")}`, 48, 13, true);
    text(`Investimento recuperato: ${report.investment.recoveredPercentage ?? "n/d"}%`, 48, 13, true);
    text(`Residuo a break-even: ${report.investment.remainingToBreakEven ?? "n/d"}`, 48, 13, true);
    y -= 12;
    text("Veicoli", 48, 14, true);
    report.vehicles.slice(0, 12).forEach((vehicle: any) => {
      text(`${vehicle.plate} · ${vehicle.brand} ${vehicle.model} · Ricavi ${vehicle.revenue} · Margine ${vehicle.margin} · Occupazione ${vehicle.utilizationRate}%`, 48, 9);
    });
    y -= 6;
    text("Dettaglio noleggi principali", 48, 14, true);
    report.rows.slice(0, 18).forEach((row: any) => {
      text(`${row.plate} · ${row.customerName} · ${row.startDate.slice(0, 10)} / ${row.endDate.slice(0, 10)} · EUR ${row.total}`, 48, 8);
    });
    page.drawText("Powered by Fleetum · Documento gestionale operativo, non sostituisce documentazione fiscale ufficiale.", { x: 48, y: 32, size: 8, font, color: rgb(0.4, 0.44, 0.52) });
    return pdf.save();
  }

  private empty(params: VehicleProfitabilityParams) {
    return {
      period: { from: params.dateFrom.toISOString(), to: params.dateTo.toISOString(), days: diffInclusiveDays(params.dateFrom, params.dateTo) },
      filters: { vehicleId: params.vehicleId ?? null, siteId: params.siteId ?? null, includeVat: params.includeVat, includeCosts: params.includeCosts, statuses: params.statuses ?? [...DEFAULT_STATUSES] },
      dataQuality: { revenueBasis: "Nessun dato disponibile", costBasis: "Nessun dato disponibile", isEstimate: true, notes: [] },
      summary: { totalRevenue: 0, totalCosts: 0, grossMargin: 0, netMarginEstimate: 0, rentedDays: 0, availableDays: 0, technicalStopDays: 0, utilizationRate: 0, contractsCount: 0, bookingsCount: 0 },
      investment: { purchasePrice: null, recoveredAmount: 0, recoveredPercentage: null, remainingToBreakEven: null, breakEvenReached: null, estimatedBreakEvenDate: null },
      vehicles: [],
      rows: [],
      trend: [],
      costs: []
    };
  }
}
