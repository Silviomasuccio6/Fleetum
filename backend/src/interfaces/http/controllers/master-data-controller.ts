import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import { z } from "zod";
import { ImportMasterDataUseCase } from "../../../application/usecases/master-data/import-master-data-usecase.js";
import { computeVehicleRevisionDueAt } from "../../../application/services/vehicle-revision-schedule-service.js";
import { assertImportFileIntegrity } from "../../../infrastructure/storage/import-upload.js";
import { prisma } from "../../../infrastructure/database/prisma/client.js";
import { ManageSitesUseCases } from "../../../application/usecases/sites/manage-sites-usecases.js";
import { ManageVehiclesUseCases } from "../../../application/usecases/vehicles/manage-vehicles-usecases.js";
import { ManageWorkshopsUseCases } from "../../../application/usecases/workshops/manage-workshops-usecases.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { listQuerySchema } from "../validators/common.js";
import { siteSchema, vehicleMaintenanceSchema, vehicleSchema, workshopSchema } from "../validators/master-data-validators.js";

const parseBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
};

type MaintenanceExportQuery = {
  dateFrom?: string;
  dateTo?: string;
  vehicleId?: string;
  plate?: string;
};

type MaintenanceExportRow = {
  id: string;
  performedAt: Date;
  maintenanceType: string;
  description: string | null;
  workshopName: string | null;
  kmAtService: number | null;
  cost: number | null;
  vehiclePlate: string;
  vehicleBrand: string;
  vehicleModel: string;
  siteName: string;
  attachmentsCount: number;
  invoiceAnalyzableFiles: number;
  invoiceTotalsFound: number;
  invoiceTotalsMissing: number;
  invoiceTotalAmount: number;
  varianceCostVsInvoices: number | null;
  attachments: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: Date;
    invoiceTotalAmount: number | null;
  }>;
};

type VehicleDeadlineRow = {
  vehicleId: string;
  plate: string;
  brand: string;
  model: string;
  siteName: string;
  currentKm: number | null;
  maintenanceIntervalKm: number | null;
  lastMaintenanceAt: string | null;
  lastMaintenanceKm: number | null;
  kmDrivenSinceMaintenance: number | null;
  remainingKm: number | null;
  dueByKm: boolean;
  dueSoonByKm: boolean;
  registrationDate: string | null;
  lastRevisionAt: string | null;
  revisionDueAt: string | null;
  daysToRevision: number | null;
  dueByRevision: boolean;
  dueSoonByRevision: boolean;
  status: "SCADUTA" | "IN_SCADENZA" | "OK";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  actions: string[];
};

export class MasterDataController {
  constructor(
    private readonly sitesUseCases: ManageSitesUseCases,
    private readonly workshopsUseCases: ManageWorkshopsUseCases,
    private readonly vehiclesUseCases: ManageVehiclesUseCases,
    private readonly importMasterDataUseCase: ImportMasterDataUseCase
  ) {}

  private readonly optionalString = z.preprocess((value) => (value === "" ? undefined : value), z.string().optional());
  private readonly csvDelimiter = ";";

  private readonly maintenanceExportQuerySchema = z.object({
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
    vehicleId: this.optionalString,
    plate: this.optionalString
  });
  private readonly vehicleDeadlinesQuerySchema = z.object({
    kmWarning: z.coerce.number().int().min(0).max(100000).optional().default(1000),
    revisionWarningDays: z.coerce.number().int().min(0).max(365).optional().default(30),
    includeAll: z.preprocess((value) => parseBoolean(value), z.boolean()).optional().default(false),
    limit: z.coerce.number().int().min(1).max(2000).optional().default(600)
  });
  private readonly vehicleDeadlinesCalendarSyncSchema = z.object({
    vehicleIds: z.array(z.string().trim().min(1)).optional(),
    includeSoon: z.boolean().optional().default(true),
    kmWarning: z.coerce.number().int().min(0).max(100000).optional().default(1000),
    revisionWarningDays: z.coerce.number().int().min(0).max(365).optional().default(30)
  });

  private csvEscape(value: unknown) {
    const raw = String(value ?? "");
    const formulaSafe = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${formulaSafe.replace(/"/g, "\"\"")}"`;
  }

  private csvRow(values: unknown[]) {
    return values.map((value) => this.csvEscape(value)).join(this.csvDelimiter);
  }

  private formatDate(value: string | Date | null | undefined) {
    if (!value) return "-";
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) return "-";
    return parsed.toLocaleDateString("it-IT");
  }

  private formatMonthYear(value: string | Date | null | undefined) {
    if (!value) return "-";
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) return "-";
    return parsed.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
  }

  private formatDateTime(value: string | Date | null | undefined) {
    if (!value) return "-";
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) return "-";
    return parsed.toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  private formatNumber(value: unknown, decimals = 2) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "-";
    const fixedDecimals = Number.isInteger(num) ? 0 : decimals;
    return num.toLocaleString("it-IT", {
      minimumFractionDigits: fixedDecimals,
      maximumFractionDigits: fixedDecimals
    });
  }

  private formatCurrency(value: unknown) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "-";
    return num.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
  }

  private isInvoiceAnalyzableMime(mimeType: string) {
    return mimeType === "application/pdf" || mimeType.startsWith("image/");
  }

  private roundTo2(value: number) {
    return Math.round(value * 100) / 100;
  }

  private startOfDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  }

  private buildAutoDeadlineMarker(kind: "KM" | "REVISION", vehicleId: string) {
    return `[[AUTO_VEICOLO|${kind}|${vehicleId}]]`;
  }

  private extractAutoDeadlineMarker(description: string | null | undefined) {
    const value = String(description ?? "");
    const match = value.match(/\[\[AUTO_(?:SCADENZA|VEICOLO)\|(KM|REVISION)\|([a-zA-Z0-9_\-]+)\]\]/);
    if (!match) return null;
    return {
      kind: match[1] as "KM" | "REVISION",
      vehicleId: match[2],
      marker: match[0]
    };
  }

  private buildDeadlineEventRange(anchorDate: Date, slotIndex = 0) {
    const slotsPerDay = 10;
    const dayShift = Math.floor(slotIndex / slotsPerDay);
    const slotInDay = slotIndex % slotsPerDay;
    const startAt = new Date(anchorDate);
    startAt.setDate(startAt.getDate() + dayShift);
    startAt.setHours(8 + slotInDay, 30, 0, 0);
    const endAt = new Date(startAt.getTime() + 45 * 60000);
    return { startAt, endAt };
  }

  private async buildVehicleDeadlines(
    tenantId: string,
    input: { kmWarning: number; revisionWarningDays: number; includeAll: boolean; limit: number }
  ) {
    const vehicles = await prisma.vehicle.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      orderBy: [{ updatedAt: "desc" }],
      take: input.limit,
      include: {
        site: { select: { name: true } },
        maintenances: {
          where: { tenantId, deletedAt: null },
          orderBy: [{ performedAt: "desc" }, { createdAt: "desc" }],
          take: 1,
          select: { performedAt: true, kmAtService: true }
        }
      }
    });

    const todayStart = this.startOfDay(new Date());
    const rows: VehicleDeadlineRow[] = vehicles
      .map((vehicle) => {
        const lastMaintenance = vehicle.maintenances[0] ?? null;
        const currentKm = typeof vehicle.currentKm === "number" ? vehicle.currentKm : null;
        const intervalKm = typeof vehicle.maintenanceIntervalKm === "number" ? vehicle.maintenanceIntervalKm : null;
        const baselineKm = typeof lastMaintenance?.kmAtService === "number" ? lastMaintenance.kmAtService : null;

        let kmDrivenSinceMaintenance: number | null = null;
        let remainingKm: number | null = null;

        if (currentKm !== null && intervalKm !== null) {
          if (baselineKm !== null && currentKm >= baselineKm) {
            kmDrivenSinceMaintenance = Math.max(0, currentKm - baselineKm);
          } else {
            kmDrivenSinceMaintenance = ((currentKm % intervalKm) + intervalKm) % intervalKm;
          }
          remainingKm = intervalKm - kmDrivenSinceMaintenance;
        }

        const dueByKm = remainingKm !== null ? remainingKm <= 0 : false;
        const dueSoonByKm = remainingKm !== null ? remainingKm > 0 && remainingKm <= input.kmWarning : false;

        const revisionDate =
          vehicle.revisionDueAt
            ? new Date(vehicle.revisionDueAt)
            : computeVehicleRevisionDueAt({
                registrationDate: vehicle.registrationDate,
                lastRevisionAt: vehicle.lastRevisionAt,
                manualRevisionDueAt: null
              });
        const revisionStart = revisionDate ? this.startOfDay(revisionDate) : null;
        const daysToRevision =
          revisionStart !== null ? Math.ceil((revisionStart.getTime() - todayStart.getTime()) / 86400000) : null;

        const dueByRevision = daysToRevision !== null ? daysToRevision <= 0 : false;
        const dueSoonByRevision =
          daysToRevision !== null ? daysToRevision > 0 && daysToRevision <= input.revisionWarningDays : false;

        const status: VehicleDeadlineRow["status"] =
          dueByKm || dueByRevision ? "SCADUTA" : dueSoonByKm || dueSoonByRevision ? "IN_SCADENZA" : "OK";

        const severity: VehicleDeadlineRow["severity"] =
          dueByKm && dueByRevision
            ? "CRITICAL"
            : dueByKm || dueByRevision
              ? "HIGH"
              : dueSoonByKm || dueSoonByRevision
                ? "MEDIUM"
                : "LOW";

        const actions: string[] = [];
        if (dueByKm || dueSoonByKm) actions.push("Programmare manutenzione / tagliando");
        if (dueByRevision || dueSoonByRevision) actions.push("Prenotare revisione ministeriale");
        if (!actions.length) actions.push("Nessuna azione urgente");

        return {
          vehicleId: vehicle.id,
          plate: vehicle.plate,
          brand: vehicle.brand,
          model: vehicle.model,
          siteName: vehicle.site?.name ?? "-",
          currentKm,
          maintenanceIntervalKm: intervalKm,
          lastMaintenanceAt: lastMaintenance?.performedAt?.toISOString() ?? null,
          lastMaintenanceKm: baselineKm,
          kmDrivenSinceMaintenance,
          remainingKm,
          dueByKm,
          dueSoonByKm,
          registrationDate: vehicle.registrationDate ? vehicle.registrationDate.toISOString() : null,
          lastRevisionAt: vehicle.lastRevisionAt ? vehicle.lastRevisionAt.toISOString() : null,
          revisionDueAt: revisionDate?.toISOString() ?? null,
          daysToRevision,
          dueByRevision,
          dueSoonByRevision,
          status,
          severity,
          actions
        };
      })
      .filter((row) => (input.includeAll ? true : row.dueByKm || row.dueSoonByKm || row.dueByRevision || row.dueSoonByRevision))
      .sort((a, b) => {
        const severityWeight = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
        if (severityWeight[b.severity] !== severityWeight[a.severity]) {
          return severityWeight[b.severity] - severityWeight[a.severity];
        }
        const daysA = a.daysToRevision ?? Number.POSITIVE_INFINITY;
        const daysB = b.daysToRevision ?? Number.POSITIVE_INFINITY;
        if (daysA !== daysB) return daysA - daysB;
        const kmA = a.remainingKm ?? Number.POSITIVE_INFINITY;
        const kmB = b.remainingKm ?? Number.POSITIVE_INFINITY;
        return kmA - kmB;
      });

    return {
      kpis: {
        total: rows.length,
        dueNowKm: rows.filter((row) => row.dueByKm).length,
        dueSoonKm: rows.filter((row) => !row.dueByKm && row.dueSoonByKm).length,
        dueNowRevision: rows.filter((row) => row.dueByRevision).length,
        dueSoonRevision: rows.filter((row) => !row.dueByRevision && row.dueSoonByRevision).length,
        critical: rows.filter((row) => row.severity === "CRITICAL").length
      },
      data: rows
    };
  }

  private setupWorksheet(sheet: ExcelJS.Worksheet, columns: Array<{ width: number }>) {
    sheet.properties.defaultRowHeight = 20;
    sheet.views = [{ state: "frozen", ySplit: 4 }];
    sheet.columns = columns as never;
  }

  private writeSheetTitle(sheet: ExcelJS.Worksheet, title: string, subtitle: string) {
    sheet.mergeCells("A1:H1");
    sheet.getCell("A1").value = title;
    sheet.getCell("A1").font = { name: "Segoe UI", size: 18, bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "1E3A8A" } };
    sheet.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };

    sheet.mergeCells("A2:H2");
    sheet.getCell("A2").value = subtitle;
    sheet.getCell("A2").font = { name: "Segoe UI", size: 11, color: { argb: "E2E8F0" } };
    sheet.getCell("A2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "1E3A8A" } };
    sheet.getCell("A2").alignment = { vertical: "middle", horizontal: "left" };

    sheet.getRow(1).height = 30;
    sheet.getRow(2).height = 24;
  }

  private styleHeaderRow(row: ExcelJS.Row) {
    row.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "FFFFFF" } };
    row.alignment = { vertical: "middle", horizontal: "left" };
    row.height = 20;
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "334155" } };
      cell.border = {
        top: { style: "thin", color: { argb: "1F2937" } },
        left: { style: "thin", color: { argb: "1F2937" } },
        bottom: { style: "thin", color: { argb: "1F2937" } },
        right: { style: "thin", color: { argb: "1F2937" } }
      };
    });
  }

  private styleBodyRow(row: ExcelJS.Row, zebra = false) {
    row.font = { name: "Segoe UI", size: 10, color: { argb: "0F172A" } };
    row.alignment = { vertical: "middle", horizontal: "left" };
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra ? "F8FAFC" : "FFFFFF" } };
      cell.border = {
        top: { style: "thin", color: { argb: "E2E8F0" } },
        left: { style: "thin", color: { argb: "E2E8F0" } },
        bottom: { style: "thin", color: { argb: "E2E8F0" } },
        right: { style: "thin", color: { argb: "E2E8F0" } }
      };
    });
  }

  private async listVehicleMaintenanceExportRows(tenantId: string, parsed: MaintenanceExportQuery): Promise<MaintenanceExportRow[]> {
    const where: Prisma.VehicleMaintenanceWhereInput = {
      tenantId,
      deletedAt: null,
      ...(parsed.dateFrom || parsed.dateTo
        ? {
            performedAt: {
              ...(parsed.dateFrom ? { gte: new Date(parsed.dateFrom) } : {}),
              ...(parsed.dateTo ? { lte: new Date(parsed.dateTo) } : {})
            }
          }
        : {}),
      ...(parsed.vehicleId || parsed.plate
        ? {
            vehicle: {
              is: {
                ...(parsed.vehicleId ? { id: parsed.vehicleId } : {}),
                ...(parsed.plate ? { plate: { contains: parsed.plate, mode: "insensitive" } } : {})
              }
            }
          }
        : {})
    };

    const rows = await prisma.vehicleMaintenance.findMany({
      where,
      orderBy: [{ performedAt: "desc" }, { createdAt: "desc" }],
      include: {
        vehicle: {
          select: {
            id: true,
            plate: true,
            brand: true,
            model: true,
            site: { select: { id: true, name: true, city: true } }
          }
        },
        attachments: {
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
            invoiceTotalAmount: true
          },
          orderBy: { createdAt: "asc" }
        }
      }
    });

    return rows.map((row) => {
      const invoiceTotals = row.attachments
        .map((attachment) => attachment.invoiceTotalAmount)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);

      const invoiceTotalAmount = this.roundTo2(invoiceTotals.reduce((acc, value) => acc + value, 0));
      const invoiceAnalyzableFiles = row.attachments.filter((attachment) => this.isInvoiceAnalyzableMime(attachment.mimeType)).length;
      const invoiceTotalsMissing = Math.max(0, invoiceAnalyzableFiles - invoiceTotals.length);
      const varianceCostVsInvoices =
        typeof row.cost === "number" && Number.isFinite(row.cost) && invoiceTotals.length > 0
          ? this.roundTo2(row.cost - invoiceTotalAmount)
          : null;

      return {
        id: row.id,
        performedAt: row.performedAt,
        maintenanceType: row.maintenanceType,
        description: row.description,
        workshopName: row.workshopName,
        kmAtService: row.kmAtService,
        cost: row.cost,
        vehiclePlate: row.vehicle.plate,
        vehicleBrand: row.vehicle.brand,
        vehicleModel: row.vehicle.model,
        siteName: row.vehicle.site?.name ?? "-",
        attachmentsCount: row.attachments.length,
        invoiceAnalyzableFiles,
        invoiceTotalsFound: invoiceTotals.length,
        invoiceTotalsMissing,
        invoiceTotalAmount,
        varianceCostVsInvoices,
        attachments: row.attachments
      };
    });
  }

  private buildVehicleMaintenanceExportCsv(tenantId: string, parsed: MaintenanceExportQuery, rows: MaintenanceExportRow[]) {
    const lines: string[] = [];

    const totalCost = this.roundTo2(rows.reduce((acc, row) => acc + (row.cost ?? 0), 0));
    const totalInvoiceAmount = this.roundTo2(rows.reduce((acc, row) => acc + row.invoiceTotalAmount, 0));
    const totalVariance = this.roundTo2(
      rows.reduce((acc, row) => acc + (typeof row.varianceCostVsInvoices === "number" ? row.varianceCostVsInvoices : 0), 0)
    );
    const totalAttachments = rows.reduce((acc, row) => acc + row.attachmentsCount, 0);

    lines.push(this.csvRow(["FLEETUM", "REPORT MANUTENZIONI"]));
    lines.push(this.csvRow(["Template", "Enterprise Maintenance CSV v1"]));
    lines.push(this.csvRow(["Generato il", this.formatDateTime(new Date())]));
    lines.push(this.csvRow(["Tenant", tenantId]));
    lines.push(this.csvRow(["Data da", this.formatDate(parsed.dateFrom)]));
    lines.push(this.csvRow(["Data a", this.formatDate(parsed.dateTo)]));
    lines.push(this.csvRow(["Targa filtro", parsed.plate ?? "-"]));
    lines.push(this.csvRow(["Veicolo ID filtro", parsed.vehicleId ?? "Tutti"]));
    lines.push("");

    lines.push(this.csvRow(["KPI", "Valore"]));
    lines.push(this.csvRow(["Manutenzioni estratte", rows.length]));
    lines.push(this.csvRow(["Costo manutenzioni totale", this.formatCurrency(totalCost)]));
    lines.push(this.csvRow(["Totale fatture OCR", this.formatCurrency(totalInvoiceAmount)]));
    lines.push(this.csvRow(["Scostamento complessivo", this.formatCurrency(totalVariance)]));
    lines.push(this.csvRow(["Allegati totali", totalAttachments]));
    lines.push("");

    lines.push(
      this.csvRow([
        "Data",
        "Targa",
        "Marca",
        "Modello",
        "Sede",
        "Intervento",
        "Descrizione",
        "Officina",
        "Km",
        "Costo manutenzione",
        "Totale fatture OCR",
        "Scostamento",
        "Fatture lette",
        "Fatture senza totale",
        "Allegati",
        "Dettaglio file"
      ])
    );

    if (!rows.length) {
      lines.push(this.csvRow(["Nessun dato disponibile"]));
    } else {
      rows.forEach((row) => {
        const attachmentsLabel =
          row.attachments.length === 0
            ? "-"
            : row.attachments
                .map((attachment) =>
                  `${attachment.fileName}${typeof attachment.invoiceTotalAmount === "number" ? ` (${this.formatCurrency(attachment.invoiceTotalAmount)})` : ""}`
                )
                .join(" | ");

        lines.push(
          this.csvRow([
            this.formatDate(row.performedAt),
            row.vehiclePlate,
            row.vehicleBrand,
            row.vehicleModel,
            row.siteName,
            row.maintenanceType,
            row.description ?? "-",
            row.workshopName ?? "-",
            row.kmAtService ?? "-",
            this.formatCurrency(row.cost),
            this.formatCurrency(row.invoiceTotalAmount),
            this.formatCurrency(row.varianceCostVsInvoices),
            row.invoiceTotalsFound,
            row.invoiceTotalsMissing,
            row.attachmentsCount,
            attachmentsLabel
          ])
        );
      });
    }

    return `\uFEFF${lines.join("\r\n")}`;
  }

  private async buildVehicleMaintenanceWorkbook(tenantId: string, parsed: MaintenanceExportQuery, rows: MaintenanceExportRow[]) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Fleetum";
    workbook.lastModifiedBy = "Fleetum";
    workbook.created = new Date();
    workbook.modified = new Date();
    const workbookMetadata = workbook as unknown as { subject?: string; title?: string };
    workbookMetadata.subject = "Maintenance Enterprise Report";
    workbookMetadata.title = "Fleetum Manutenzioni";

    const totalCost = this.roundTo2(rows.reduce((acc, row) => acc + (row.cost ?? 0), 0));
    const totalInvoiceAmount = this.roundTo2(rows.reduce((acc, row) => acc + row.invoiceTotalAmount, 0));
    const totalVariance = this.roundTo2(
      rows.reduce((acc, row) => acc + (typeof row.varianceCostVsInvoices === "number" ? row.varianceCostVsInvoices : 0), 0)
    );
    const totalAttachments = rows.reduce((acc, row) => acc + row.attachmentsCount, 0);

    const executive = workbook.addWorksheet("Executive");
    this.setupWorksheet(executive, [{ width: 28 }, { width: 24 }, { width: 24 }, { width: 24 }, { width: 24 }, { width: 24 }, { width: 24 }, { width: 24 }]);
    this.writeSheetTitle(executive, "Report Manutenzioni", "Confronto costi, fatture e allegati");

    executive.getCell("A4").value = "Generato il";
    executive.getCell("B4").value = this.formatDateTime(new Date());
    executive.getCell("A5").value = "Tenant";
    executive.getCell("B5").value = tenantId;
    executive.getCell("A6").value = "Periodo";
    executive.getCell("B6").value = `${this.formatDate(parsed.dateFrom)} - ${this.formatDate(parsed.dateTo)}`;
    executive.getCell("A7").value = "Filtro targa";
    executive.getCell("B7").value = parsed.plate ?? "-";
    executive.getCell("A8").value = "Filtro veicolo";
    executive.getCell("B8").value = parsed.vehicleId ?? "Tutti";

    ["A4", "A5", "A6", "A7", "A8"].forEach((cell) => {
      executive.getCell(cell).font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "334155" } };
    });
    ["B4", "B5", "B6", "B7", "B8"].forEach((cell) => {
      executive.getCell(cell).font = { name: "Segoe UI", size: 10, color: { argb: "0F172A" } };
    });

    const kpiHeaders = executive.getRow(10);
    kpiHeaders.values = ["", "KPI", "Valore"];
    this.styleHeaderRow(kpiHeaders);
    const kpiRows: Array<[string, string]> = [
      ["Manutenzioni estratte", this.formatNumber(rows.length, 0)],
      ["Costo manutenzioni", this.formatCurrency(totalCost)],
      ["Totale fatture OCR", this.formatCurrency(totalInvoiceAmount)],
      ["Scostamento complessivo", this.formatCurrency(totalVariance)],
      ["Allegati totali", this.formatNumber(totalAttachments, 0)]
    ];
    kpiRows.forEach((row, index) => {
      const line = executive.getRow(11 + index);
      line.values = ["", row[0], row[1]];
      this.styleBodyRow(line, index % 2 === 1);
    });

    const maintSheet = workbook.addWorksheet("Manutenzioni");
    maintSheet.columns = [
      { width: 13 },
      { width: 12 },
      { width: 14 },
      { width: 16 },
      { width: 16 },
      { width: 24 },
      { width: 24 },
      { width: 16 },
      { width: 10 },
      { width: 14 },
      { width: 16 },
      { width: 14 },
      { width: 10 },
      { width: 10 },
      { width: 10 }
    ];

    const maintHeader = maintSheet.getRow(1);
    maintHeader.values = [
      "Data",
      "Targa",
      "Marca",
      "Modello",
      "Sede",
      "Intervento",
      "Descrizione",
      "Officina",
      "Km",
      "Costo",
      "Totale fatture",
      "Scostamento",
      "Fatture lette",
      "Senza totale",
      "Allegati"
    ];
    this.styleHeaderRow(maintHeader);

    rows.forEach((row, index) => {
      const line = maintSheet.getRow(2 + index);
      line.values = [
        this.formatDate(row.performedAt),
        row.vehiclePlate,
        row.vehicleBrand,
        row.vehicleModel,
        row.siteName,
        row.maintenanceType,
        row.description ?? "-",
        row.workshopName ?? "-",
        row.kmAtService ?? "-",
        row.cost ?? null,
        row.invoiceTotalAmount,
        row.varianceCostVsInvoices,
        row.invoiceTotalsFound,
        row.invoiceTotalsMissing,
        row.attachmentsCount
      ];
      this.styleBodyRow(line, index % 2 === 1);
      line.getCell(10).numFmt = "#,##0.00 [$€-it-IT]";
      line.getCell(11).numFmt = "#,##0.00 [$€-it-IT]";
      line.getCell(12).numFmt = "#,##0.00 [$€-it-IT]";
    });

    const attachmentSheet = workbook.addWorksheet("Fatture_Allegati");
    attachmentSheet.columns = [
      { width: 13 },
      { width: 12 },
      { width: 24 },
      { width: 28 },
      { width: 16 },
      { width: 12 },
      { width: 18 },
      { width: 18 },
      { width: 22 }
    ];
    const attachmentHeader = attachmentSheet.getRow(1);
    attachmentHeader.values = [
      "Data manutenzione",
      "Targa",
      "Intervento",
      "File",
      "Mime",
      "Peso KB",
      "Totale estratto",
      "Costo manutenzione",
      "Data upload"
    ];
    this.styleHeaderRow(attachmentHeader);

    let attachmentRowIndex = 2;
    rows.forEach((row) => {
      if (!row.attachments.length) {
        const line = attachmentSheet.getRow(attachmentRowIndex);
        line.values = [this.formatDate(row.performedAt), row.vehiclePlate, row.maintenanceType, "-", "-", "-", "-", row.cost ?? "-", "-"];
        this.styleBodyRow(line, attachmentRowIndex % 2 === 0);
        attachmentRowIndex += 1;
        return;
      }

      row.attachments.forEach((attachment) => {
        const line = attachmentSheet.getRow(attachmentRowIndex);
        line.values = [
          this.formatDate(row.performedAt),
          row.vehiclePlate,
          row.maintenanceType,
          attachment.fileName,
          attachment.mimeType,
          this.roundTo2(attachment.sizeBytes / 1024),
          attachment.invoiceTotalAmount ?? null,
          row.cost ?? null,
          this.formatDateTime(attachment.createdAt)
        ];
        this.styleBodyRow(line, attachmentRowIndex % 2 === 0);
        line.getCell(7).numFmt = "#,##0.00 [$€-it-IT]";
        line.getCell(8).numFmt = "#,##0.00 [$€-it-IT]";
        attachmentRowIndex += 1;
      });
    });

    return workbook;
  }

  listSites = async (req: Request, res: Response) => {
    const query = listQuerySchema.parse(req.query);
    const pagination = { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
    const result = await this.sitesUseCases.list(req.auth!.tenantId, { search: query.search, ...pagination });
    res.json({ ...result, page: query.page, pageSize: query.pageSize });
  };

  createSite = async (req: Request, res: Response) => {
    const input = siteSchema.parse(req.body);
    const result = await this.sitesUseCases.create(req.auth!.tenantId, input);
    res.status(201).json(result);
  };

  updateSite = async (req: Request, res: Response) => {
    const input = siteSchema.partial().parse(req.body);
    const result = await this.sitesUseCases.update(req.auth!.tenantId, req.params.id, input);
    res.json(result);
  };

  deleteSite = async (req: Request, res: Response) => {
    await this.sitesUseCases.delete(req.auth!.tenantId, req.params.id);
    res.status(204).send();
  };

  listWorkshops = async (req: Request, res: Response) => {
    const query = listQuerySchema.parse(req.query);
    const pagination = { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
    const result = await this.workshopsUseCases.list(req.auth!.tenantId, { search: query.search, ...pagination });
    res.json({ ...result, page: query.page, pageSize: query.pageSize });
  };

  createWorkshop = async (req: Request, res: Response) => {
    const input = workshopSchema.parse(req.body);
    const result = await this.workshopsUseCases.create(req.auth!.tenantId, input);
    res.status(201).json(result);
  };

  updateWorkshop = async (req: Request, res: Response) => {
    const input = workshopSchema.partial().parse(req.body);
    const result = await this.workshopsUseCases.update(req.auth!.tenantId, req.params.id, input);
    res.json(result);
  };

  deleteWorkshop = async (req: Request, res: Response) => {
    await this.workshopsUseCases.delete(req.auth!.tenantId, req.params.id);
    res.status(204).send();
  };

  listVehicles = async (req: Request, res: Response) => {
    const query = listQuerySchema.parse(req.query);
    const pagination = { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
    const result = await this.vehiclesUseCases.list(req.auth!.tenantId, { search: query.search, ...pagination });
    res.json({ ...result, page: query.page, pageSize: query.pageSize });
  };

  createVehicle = async (req: Request, res: Response) => {
    const input = vehicleSchema.parse(req.body);
    const result = await this.vehiclesUseCases.create(req.auth!.tenantId, input);
    res.status(201).json(result);
  };

  updateVehicle = async (req: Request, res: Response) => {
    const input = vehicleSchema.partial().parse(req.body);
    const result = await this.vehiclesUseCases.update(req.auth!.tenantId, req.params.id, input);
    res.json(result);
  };

  deleteVehicle = async (req: Request, res: Response) => {
    await this.vehiclesUseCases.delete(req.auth!.tenantId, req.params.id);
    res.status(204).send();
  };

  listVehicleDeadlines = async (req: Request, res: Response) => {
    const query = this.vehicleDeadlinesQuerySchema.parse(req.query);
    const tenantId = req.auth!.tenantId;
    const payload = await this.buildVehicleDeadlines(tenantId, query);
    res.json(payload);
  };

  syncVehicleDeadlinesCalendar = async (req: Request, res: Response) => {
    const input = this.vehicleDeadlinesCalendarSyncSchema.parse(req.body ?? {});
    const tenantId = req.auth!.tenantId;
    const userId = req.auth!.userId;
    const deadlines = await this.buildVehicleDeadlines(tenantId, {
      kmWarning: input.kmWarning,
      revisionWarningDays: input.revisionWarningDays,
      includeAll: true,
      limit: 2000
    });

    const targetVehicleSet = input.vehicleIds?.length ? new Set(input.vehicleIds.map((value) => String(value))) : null;
    const filtered = deadlines.data.filter((row) => {
      if (targetVehicleSet && !targetVehicleSet.has(row.vehicleId)) return false;
      if (row.dueByKm || row.dueByRevision) return true;
      return input.includeSoon ? row.dueSoonByKm || row.dueSoonByRevision : false;
    });

    const now = new Date();
    const pendingEvents: Array<
      {
        marker: string;
        title: string;
        description: string;
        location: string;
        anchorDate: Date;
      }
    > = [];

    for (const row of filtered) {
      if (row.dueByKm || row.dueSoonByKm) {
        const marker = this.buildAutoDeadlineMarker("KM", row.vehicleId);
        const baseDate = new Date(now);
        const remainingKmLabel =
          row.remainingKm === null
            ? "n.d."
            : row.remainingKm <= 0
              ? `in ritardo di ${Math.abs(row.remainingKm)} km`
              : `${row.remainingKm} km residui`;

        pendingEvents.push({
          marker,
          title: `${row.dueByKm ? "Tagliando urgente" : "Programmare tagliando"} · ${row.plate}`,
          description: `Veicolo ${row.plate} (${row.brand} ${row.model})\nIntervallo manutenzione: ${row.maintenanceIntervalKm ?? "-"} km\nStato KM: ${remainingKmLabel}\nAzione: Eseguire tagliando / manutenzione\n${marker}`,
          location: row.siteName,
          anchorDate: baseDate
        });
      }

      if ((row.dueByRevision || row.dueSoonByRevision) && row.revisionDueAt) {
        const marker = this.buildAutoDeadlineMarker("REVISION", row.vehicleId);
        const revisionDate = new Date(row.revisionDueAt);
        const anchor = revisionDate < now ? now : revisionDate;

        pendingEvents.push({
          marker,
          title: `${row.dueByRevision ? "Revisione urgente" : "Programmare revisione"} · ${row.plate}`,
          description: `Veicolo ${row.plate} (${row.brand} ${row.model})\nProssima revisione: ${this.formatMonthYear(row.revisionDueAt)}\nAzione: Prenotare revisione ministeriale\n${marker}`,
          location: row.siteName,
          anchorDate: anchor
        });
      }
    }

    pendingEvents.sort((a, b) => {
      const byDate = a.anchorDate.getTime() - b.anchorDate.getTime();
      if (byDate !== 0) return byDate;
      return a.title.localeCompare(b.title, "it");
    });

    const daySlots = new Map<string, number>();
    const needed = new Map<
      string,
      {
        marker: string;
        title: string;
        description: string;
        location: string;
        startAt: Date;
        endAt: Date;
      }
    >();
    for (const event of pendingEvents) {
      const dayKey = `${event.anchorDate.getFullYear()}-${event.anchorDate.getMonth() + 1}-${event.anchorDate.getDate()}`;
      const slotIndex = daySlots.get(dayKey) ?? 0;
      daySlots.set(dayKey, slotIndex + 1);
      const { startAt, endAt } = this.buildDeadlineEventRange(event.anchorDate, slotIndex);
      needed.set(event.marker, {
        marker: event.marker,
        title: event.title,
        description: event.description,
        location: event.location,
        startAt,
        endAt
      });
    }

    const existing = await prisma.calendarEvent.findMany({
      where: {
        tenantId,
        userId,
        type: "TASK",
        OR: [{ description: { contains: "[[AUTO_SCADENZA|" } }, { description: { contains: "[[AUTO_VEICOLO|" } }]
      },
      select: { id: true, description: true }
    });

    const existingByMarker = new Map<string, { id: string; marker: string; vehicleId: string }>();
    existing.forEach((event) => {
      const parsed = this.extractAutoDeadlineMarker(event.description);
      if (!parsed) return;
      existingByMarker.set(parsed.marker, { id: event.id, marker: parsed.marker, vehicleId: parsed.vehicleId });
    });

    let created = 0;
    let updated = 0;

    for (const item of needed.values()) {
      const existingItem = existingByMarker.get(item.marker);
      if (existingItem) {
        await prisma.calendarEvent.update({
          where: { id: existingItem.id },
          data: {
            title: item.title,
            description: item.description,
            location: item.location,
            startAt: item.startAt,
            endAt: item.endAt,
            allDay: false,
            reminder: 60,
            color: "#f59e0b",
            calendarId: "work"
          }
        });
        updated += 1;
      } else {
        await prisma.calendarEvent.create({
          data: {
            tenantId,
            userId,
            title: item.title,
            description: item.description,
            startAt: item.startAt,
            endAt: item.endAt,
            allDay: false,
            location: item.location,
            attendees: [] as any,
            reminder: 60,
            visibility: "default",
            availability: "BUSY",
            type: "TASK",
            color: "#f59e0b",
            calendarId: "work"
          }
        });
        created += 1;
      }
    }

    const neededMarkers = new Set(Array.from(needed.keys()));
    const staleEventIds = existing
      .map((event) => {
        const parsed = this.extractAutoDeadlineMarker(event.description);
        if (!parsed) return null;
        if (targetVehicleSet && !targetVehicleSet.has(parsed.vehicleId)) return null;
        if (neededMarkers.has(parsed.marker)) return null;
        return event.id;
      })
      .filter((value): value is string => Boolean(value));

    let removed = 0;
    if (staleEventIds.length > 0) {
      const deleted = await prisma.calendarEvent.deleteMany({ where: { id: { in: staleEventIds }, tenantId, userId } });
      removed = deleted.count;
    }

    res.json({
      synced: needed.size,
      created,
      updated,
      removed
    });
  };

  listVehicleMaintenances = async (req: Request, res: Response) => {
    const query = listQuerySchema.parse(req.query);
    const tenantId = req.auth!.tenantId;
    const vehicleId = String(req.query.vehicleId ?? "").trim() || undefined;

    const where: Prisma.VehicleMaintenanceWhereInput = {
      tenantId,
      deletedAt: null,
      ...(vehicleId ? { vehicleId } : {}),
      ...(query.search
        ? {
            OR: [
              { maintenanceType: { contains: query.search, mode: "insensitive" } },
              { description: { contains: query.search, mode: "insensitive" } },
              { workshopName: { contains: query.search, mode: "insensitive" } },
              { vehicle: { is: { plate: { contains: query.search, mode: "insensitive" } } } },
              { vehicle: { is: { brand: { contains: query.search, mode: "insensitive" } } } },
              { vehicle: { is: { model: { contains: query.search, mode: "insensitive" } } } }
            ]
          }
        : {})
    };

    const [total, data] = await Promise.all([
      prisma.vehicleMaintenance.count({ where }),
      prisma.vehicleMaintenance.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [{ performedAt: "desc" }, { createdAt: "desc" }],
        include: {
          vehicle: {
            select: {
              id: true,
              plate: true,
              brand: true,
              model: true,
              site: { select: { id: true, name: true, city: true } }
            }
          },
          attachments: {
            select: {
              id: true,
              fileName: true,
              mimeType: true,
              sizeBytes: true,
              createdAt: true,
              invoiceTotalAmount: true
            },
            orderBy: { createdAt: "desc" }
          }
        }
      })
    ]);

    res.json({ data, total, page: query.page, pageSize: query.pageSize });
  };

  private async syncVehicleRevisionFromMaintenances(tenantId: string, vehicleId: string) {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: vehicleId, tenantId, deletedAt: null },
      select: { id: true, registrationDate: true, revisionDueAt: true }
    });
    if (!vehicle) return;

    const latestRevisionMaintenance = await prisma.vehicleMaintenance.findFirst({
      where: {
        tenantId,
        vehicleId,
        deletedAt: null,
        OR: [
          { maintenanceType: { contains: "revis", mode: "insensitive" } },
          { maintenanceType: { contains: "revision", mode: "insensitive" } }
        ]
      },
      orderBy: [{ performedAt: "desc" }, { createdAt: "desc" }],
      select: { performedAt: true }
    });

    const lastRevisionAt = latestRevisionMaintenance?.performedAt ?? null;
    const revisionDueAt = computeVehicleRevisionDueAt({
      registrationDate: vehicle.registrationDate,
      lastRevisionAt,
      manualRevisionDueAt: vehicle.revisionDueAt
    });

    await prisma.vehicle.updateMany({
      where: { id: vehicleId, tenantId, deletedAt: null },
      data: {
        lastRevisionAt,
        revisionDueAt
      }
    });
  }

  createVehicleMaintenance = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const input = vehicleMaintenanceSchema.parse(req.body);

    const vehicle = await prisma.vehicle.findFirst({
      where: { id: input.vehicleId, tenantId, deletedAt: null },
      select: { id: true }
    });
    if (!vehicle) {
      throw new AppError("Veicolo non trovato", 404, "NOT_FOUND");
    }

    const result = await prisma.vehicleMaintenance.create({
      data: {
        tenantId,
        vehicleId: input.vehicleId,
        performedAt: input.performedAt,
        maintenanceType: input.maintenanceType,
        description: input.description,
        workshopName: input.workshopName,
        kmAtService: input.kmAtService,
        cost: input.cost
      },
      include: {
        vehicle: {
          select: {
            id: true,
            plate: true,
            brand: true,
            model: true,
            site: { select: { id: true, name: true, city: true } }
          }
        },
        attachments: {
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
            invoiceTotalAmount: true
          },
          orderBy: { createdAt: "desc" }
        }
      }
    });

    await this.syncVehicleRevisionFromMaintenances(tenantId, input.vehicleId);

    res.status(201).json(result);
  };

  updateVehicleMaintenance = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const input = vehicleMaintenanceSchema.partial().parse(req.body);
    if (Object.keys(input).length === 0) {
      throw new AppError("Nessun campo da aggiornare", 400, "VALIDATION_ERROR");
    }

    const existingMaintenance = await prisma.vehicleMaintenance.findFirst({
      where: { id: req.params.id, tenantId, deletedAt: null },
      select: { id: true, vehicleId: true, maintenanceType: true }
    });
    if (!existingMaintenance) {
      throw new AppError("Manutenzione non trovata", 404, "NOT_FOUND");
    }

    if (input.vehicleId) {
      const vehicle = await prisma.vehicle.findFirst({
        where: { id: input.vehicleId, tenantId, deletedAt: null },
        select: { id: true }
      });
      if (!vehicle) {
        throw new AppError("Veicolo non trovato", 404, "NOT_FOUND");
      }
    }

    const updated = await prisma.vehicleMaintenance.updateMany({
      where: { id: req.params.id, tenantId, deletedAt: null },
      data: {
        ...(input.vehicleId !== undefined ? { vehicleId: input.vehicleId } : {}),
        ...(input.performedAt !== undefined ? { performedAt: input.performedAt } : {}),
        ...(input.maintenanceType !== undefined ? { maintenanceType: input.maintenanceType } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.workshopName !== undefined ? { workshopName: input.workshopName } : {}),
        ...(input.kmAtService !== undefined ? { kmAtService: input.kmAtService } : {}),
        ...(input.cost !== undefined ? { cost: input.cost } : {})
      }
    });
    if (!updated.count) {
      throw new AppError("Manutenzione non trovata", 404, "NOT_FOUND");
    }

    const affectedVehicleIds = new Set<string>([existingMaintenance.vehicleId]);
    if (input.vehicleId) affectedVehicleIds.add(input.vehicleId);
    for (const vehicleId of affectedVehicleIds) {
      await this.syncVehicleRevisionFromMaintenances(tenantId, vehicleId);
    }

    const result = await prisma.vehicleMaintenance.findFirst({
      where: { id: req.params.id, tenantId, deletedAt: null },
      include: {
        vehicle: {
          select: {
            id: true,
            plate: true,
            brand: true,
            model: true,
            site: { select: { id: true, name: true, city: true } }
          }
        },
        attachments: {
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
            invoiceTotalAmount: true
          },
          orderBy: { createdAt: "desc" }
        }
      }
    });

    res.json(result);
  };

  deleteVehicleMaintenance = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const maintenance = await prisma.vehicleMaintenance.findFirst({
      where: { id: req.params.id, tenantId, deletedAt: null },
      select: { id: true, vehicleId: true, maintenanceType: true }
    });
    if (!maintenance) {
      throw new AppError("Manutenzione non trovata", 404, "NOT_FOUND");
    }
    const removed = await prisma.vehicleMaintenance.updateMany({
      where: { id: req.params.id, tenantId, deletedAt: null },
      data: { deletedAt: new Date() }
    });
    if (!removed.count) {
      throw new AppError("Manutenzione non trovata", 404, "NOT_FOUND");
    }

    await this.syncVehicleRevisionFromMaintenances(tenantId, maintenance.vehicleId);

    res.status(204).send();
  };

  exportVehicleMaintenancesCsv = async (req: Request, res: Response) => {
    const parsed = this.maintenanceExportQuerySchema.parse(req.query);
    if (parsed.dateFrom && parsed.dateTo && new Date(parsed.dateFrom).getTime() > new Date(parsed.dateTo).getTime()) {
      throw new AppError("Intervallo date non valido", 400, "VALIDATION_ERROR");
    }

    const tenantId = req.auth!.tenantId;
    const rows = await this.listVehicleMaintenanceExportRows(tenantId, parsed);
    const csv = this.buildVehicleMaintenanceExportCsv(tenantId, parsed, rows);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=\"gestione-fermi-manutenzioni-${new Date().toISOString().slice(0, 10)}.csv\"`
    );
    res.send(csv);
  };

  exportVehicleMaintenancesXlsx = async (req: Request, res: Response) => {
    const parsed = this.maintenanceExportQuerySchema.parse(req.query);
    if (parsed.dateFrom && parsed.dateTo && new Date(parsed.dateFrom).getTime() > new Date(parsed.dateTo).getTime()) {
      throw new AppError("Intervallo date non valido", 400, "VALIDATION_ERROR");
    }

    const tenantId = req.auth!.tenantId;
    const rows = await this.listVehicleMaintenanceExportRows(tenantId, parsed);
    const workbook = await this.buildVehicleMaintenanceWorkbook(tenantId, parsed, rows);
    const raw = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=\"gestione-fermi-manutenzioni-enterprise-${new Date().toISOString().slice(0, 10)}.xlsx\"`
    );
    res.send(buffer);
  };

  importVehicles = async (req: Request, res: Response) => {
    const file = req.file;
    if (!file?.buffer) {
      throw new AppError("File import mancante", 400, "IMPORT_FILE_REQUIRED");
    }
    assertImportFileIntegrity(file);

    const dryRun = parseBoolean(req.query.dryRun ?? req.body?.dryRun);
    const defaultSiteIdRaw = req.body?.defaultSiteId;
    const defaultSiteId = String(defaultSiteIdRaw ?? "").trim() || undefined;
    const result = await this.importMasterDataUseCase.importVehicles(req.auth!.tenantId, file.buffer, dryRun, {
      defaultSiteId
    });
    res.status(200).json(result);
  };
}
