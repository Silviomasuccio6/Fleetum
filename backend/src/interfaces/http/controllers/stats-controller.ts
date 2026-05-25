import { Request, Response } from "express";
import ExcelJS from "exceljs";
import { z } from "zod";
import { GetDashboardStatsUseCase } from "../../../application/usecases/stats/get-dashboard-stats-usecase.js";
import { VehicleProfitabilityReportService } from "../../../application/services/vehicle-profitability-report-service.js";
import { stoppageStatusLabel } from "../../../shared/utils/stoppage-status-label.js";
import { prisma } from "../../../infrastructure/database/prisma/client.js";

type AnalyticsQuery = {
  dateFrom?: string;
  dateTo?: string;
  siteId?: string;
  workshopId?: string;
  status?: "OPEN" | "IN_PROGRESS" | "WAITING_PARTS" | "SOLICITED" | "CLOSED" | "CANCELED";
  plate?: string;
  brand?: string;
  model?: string;
};

export class StatsController {
  constructor(private readonly useCase: GetDashboardStatsUseCase) {}

  private readonly statusEnum = z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["OPEN", "IN_PROGRESS", "WAITING_PARTS", "SOLICITED", "CLOSED", "CANCELED"]).optional()
  );

  private readonly optionalString = z.preprocess((value) => (value === "" ? undefined : value), z.string().optional());
  private readonly csvDelimiter = ";";
  private readonly vehicleProfitabilityService = new VehicleProfitabilityReportService();
  private readonly vehicleProfitabilityQuerySchema = z.object({
    vehicleId: this.optionalString,
    siteId: this.optionalString,
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
    includeVat: z.preprocess((value) => String(value ?? "true") === "true", z.boolean()).optional().default(true),
    includeCosts: z.preprocess((value) => String(value ?? "true") === "true", z.boolean()).optional().default(true),
    statuses: z.preprocess((value) => {
      if (Array.isArray(value)) return value;
      if (typeof value === "string" && value.trim()) return value.split(",").map((item) => item.trim()).filter(Boolean);
      return undefined;
    }, z.array(z.enum(["DRAFT", "QUOTED", "HOLD", "CONFIRMED", "CONTRACT_SIGNED", "READY_FOR_HANDOVER", "IN_RENT", "CLOSED", "CANCELED", "NO_SHOW"])).optional())
  });

  private parseVehicleProfitabilityQuery(query: unknown) {
    const parsed = this.vehicleProfitabilityQuerySchema.parse(query);
    const now = new Date();
    const fallbackFrom = new Date(now);
    fallbackFrom.setFullYear(fallbackFrom.getFullYear() - 1);
    const dateFrom = new Date(parsed.from ?? parsed.dateFrom ?? fallbackFrom.toISOString());
    const dateTo = new Date(parsed.to ?? parsed.dateTo ?? now.toISOString());
    return {
      vehicleId: parsed.vehicleId,
      siteId: parsed.siteId,
      dateFrom,
      dateTo,
      includeVat: parsed.includeVat,
      includeCosts: parsed.includeCosts,
      statuses: parsed.statuses
    };
  }

  vehicleProfitability = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const report = await this.vehicleProfitabilityService.build(tenantId, this.parseVehicleProfitabilityQuery(req.query));
    res.json(report);
  };

  vehicleProfitabilityById = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const report = await this.vehicleProfitabilityService.build(tenantId, {
      ...this.parseVehicleProfitabilityQuery(req.query),
      vehicleId: req.params.vehicleId
    });
    res.json(report);
  };

  vehicleProfitabilityExport = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const exportType = String(req.params.format ?? req.query.export ?? "xlsx").toLowerCase();
    const report = await this.vehicleProfitabilityService.build(tenantId, this.parseVehicleProfitabilityQuery(req.query));
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: req.auth!.userId,
        action: "VEHICLE_PROFITABILITY_REPORT_EXPORTED",
        resource: "vehicle/report",
        resourceId: req.query.vehicleId ? String(req.query.vehicleId) : null,
        details: {
          period: report.period,
          exportType,
          filters: report.filters
        }
      }
    });

    if (exportType === "csv") {
      const csv = await this.vehicleProfitabilityService.toCsv(report);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=\"fleetum-report-redditivita-veicolo.csv\"");
      res.send(csv);
      return;
    }
    if (exportType === "pdf") {
      const pdf = await this.vehicleProfitabilityService.toPdf(report);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "attachment; filename=\"fleetum-report-redditivita-veicolo.pdf\"");
      res.send(Buffer.from(pdf));
      return;
    }

    const xlsx = await this.vehicleProfitabilityService.toXlsx(report);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=\"fleetum-report-redditivita-veicolo.xlsx\"");
    res.send(Buffer.from(xlsx));
  };

  private csvEscape(value: unknown) {
    const raw = String(value ?? "");
    const formulaSafe = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${formulaSafe.replace(/"/g, "\"\"")}"`;
  }

  private csvRow(values: unknown[]) {
    return values.map((value) => this.csvEscape(value)).join(this.csvDelimiter);
  }

  private formatDateTime(value: Date) {
    return value.toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  private formatDate(value: string | Date | null | undefined) {
    if (!value) return "-";
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) return "-";
    return parsed.toLocaleDateString("it-IT");
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

  private formatPercent(value: unknown) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "-";
    return `${this.formatNumber(num, 2)}%`;
  }

  private addSection(
    lines: string[],
    title: string,
    headers: string[],
    rows: Array<Array<string | number | null | undefined>>
  ) {
    lines.push(this.csvRow([`SEZIONE`, title]));
    lines.push(this.csvRow(headers));
    if (!rows.length) {
      lines.push(this.csvRow(["Nessun dato disponibile"]));
    } else {
      rows.forEach((row) => lines.push(this.csvRow(row)));
    }
    lines.push("");
  }

  private buildAnalyticsReportCsv(tenantId: string, parsed: {
    dateFrom?: string;
    dateTo?: string;
    siteId?: string;
    workshopId?: string;
    status?: "OPEN" | "IN_PROGRESS" | "WAITING_PARTS" | "SOLICITED" | "CLOSED" | "CANCELED";
    plate?: string;
    brand?: string;
    model?: string;
  }, result: any) {
    const lines: string[] = [];
    const now = new Date();

    lines.push(this.csvRow(["FLEETUM", "REPORT ANALYTICS BRANDIZZATO"]));
    lines.push(this.csvRow(["Template", "Enterprise CSV v2"]));
    lines.push(this.csvRow(["Generato il", this.formatDateTime(now)]));
    lines.push(this.csvRow(["Tenant", tenantId]));
    lines.push(
      this.csvRow([
        "Intervallo",
        `${this.formatDate(parsed.dateFrom ?? result.filtersApplied?.dateFrom)} - ${this.formatDate(parsed.dateTo ?? result.filtersApplied?.dateTo)}`
      ])
    );
    lines.push("");

    this.addSection(
      lines,
      "Filtri applicati",
      ["Filtro", "Valore"],
      [
        ["Sede", parsed.siteId ?? "Tutte"],
        ["Officina", parsed.workshopId ?? "Tutte"],
        ["Stato", parsed.status ? stoppageStatusLabel(parsed.status) : "Tutti"],
        ["Targa", parsed.plate ?? "-"],
        ["Marca", parsed.brand ?? "-"],
        ["Modello", parsed.model ?? "-"]
      ]
    );

    this.addSection(
      lines,
      "KPI principali",
      ["KPI", "Valore"],
      [
        ["Totale fermi", this.formatNumber(result.kpis?.totalStoppages, 0)],
        ["Fermi aperti", this.formatNumber(result.kpis?.openStoppages, 0)],
        ["Fermi chiusi", this.formatNumber(result.kpis?.closedStoppages, 0)],
        ["Fermi annullati", this.formatNumber(result.kpis?.canceledStoppages, 0)],
        ["Critici aperti", this.formatNumber(result.kpis?.criticalOpen, 0)],
        ["Alta priorita aperti", this.formatNumber(result.kpis?.highOpen, 0)],
        ["Media chiusura (giorni)", this.formatNumber(result.kpis?.averageClosureDays)],
        ["Mediana chiusura (giorni)", this.formatNumber(result.kpis?.medianClosureDays)],
        ["P90 chiusura (giorni)", this.formatNumber(result.kpis?.p90ClosureDays)],
        ["Anzianita media aperti (giorni)", this.formatNumber(result.kpis?.averageOpenAgeDays)],
        ["Chiusura entro 7 giorni", this.formatPercent(result.kpis?.closureRateWithin7Days)],
        ["Chiusura entro 30 giorni", this.formatPercent(result.kpis?.closureRateWithin30Days)],
        ["Chiusura entro 60 giorni", this.formatPercent(result.kpis?.closureRateWithin60Days)],
        ["Reminders totali", this.formatNumber(result.kpis?.remindersTotal, 0)],
        ["Tasso successo reminders", this.formatPercent(result.kpis?.reminderSuccessRate)],
        ["Costo stimato aperto (EUR)", this.formatNumber(result.kpis?.estimatedOpenCost)],
        ["Costo stimato totale (EUR)", this.formatNumber(result.kpis?.estimatedTotalCost)]
      ]
    );

    this.addSection(
      lines,
      "Top fermi aperti (anzianita)",
      ["Targa", "Veicolo", "Sede", "Officina", "Stato", "Priorita", "Giorni aperto"],
      (result.tables?.longestOpen ?? []).map((x: any) => [
        x.plate,
        `${x.brand} ${x.model}`.trim(),
        x.site,
        x.workshop,
        stoppageStatusLabel(x.status),
        x.priority ?? "-",
        this.formatNumber(x.openDays)
      ])
    );

    this.addSection(
      lines,
      "Top veicoli per fermo cumulato",
      ["Targa", "Veicolo", "Numero fermi", "Giorni fermo cumulati"],
      (result.tables?.topVehiclesDowntime ?? []).map((x: any) => [
        x.plate,
        `${x.brand} ${x.model}`.trim(),
        this.formatNumber(x.count, 0),
        this.formatNumber(x.openDays)
      ])
    );

    this.addSection(
      lines,
      "Distribuzione per officina",
      ["Officina", "Numero fermi"],
      (result.charts?.byWorkshop ?? []).map((x: any) => [x.name, this.formatNumber(x.count, 0)])
    );

    this.addSection(
      lines,
      "Distribuzione per sede",
      ["Sede", "Numero fermi"],
      (result.charts?.bySite ?? []).map((x: any) => [x.name, this.formatNumber(x.count, 0)])
    );

    this.addSection(
      lines,
      "Distribuzione per marca",
      ["Marca", "Numero fermi"],
      (result.charts?.byBrand ?? []).map((x: any) => [x.name, this.formatNumber(x.count, 0)])
    );

    this.addSection(
      lines,
      "Trend giornaliero",
      ["Data", "Aperti", "Chiusi", "Reminders"],
      (result.charts?.trendStoppages ?? []).map((x: any) => [
        this.formatDate(x.day),
        this.formatNumber(x.opened, 0),
        this.formatNumber(x.closed, 0),
        this.formatNumber(x.reminders, 0)
      ])
    );

    this.addSection(
      lines,
      "Aging bucket fermi aperti",
      ["Bucket giorni", "Numero fermi"],
      (result.charts?.agingBuckets ?? []).map((x: any) => [x.bucket, this.formatNumber(x.count, 0)])
    );

    this.addSection(
      lines,
      "Errori reminder (ultimi)",
      ["Data invio", "Destinatario", "Tipo", "Errore"],
      (result.tables?.reminderFailures ?? []).map((x: any) => [
        this.formatDateTime(new Date(x.sentAt)),
        x.recipient,
        x.type,
        x.errorMessage ?? "-"
      ])
    );

    lines.push(this.csvRow(["Fine report", "Fleetum"]));
    return `\uFEFF${lines.join("\r\n")}`;
  }

  private textBar(value: unknown, max: unknown, width = 24) {
    const rawValue = Number(value);
    const rawMax = Number(max);
    if (!Number.isFinite(rawValue) || !Number.isFinite(rawMax) || rawMax <= 0) {
      return "-".repeat(width);
    }
    const filled = Math.max(0, Math.min(width, Math.round((rawValue / rawMax) * width)));
    return `${"#".repeat(filled)}${"-".repeat(width - filled)}`;
  }

  private setupWorksheet(sheet: ExcelJS.Worksheet, columns: Array<{ width: number }>) {
    sheet.properties.defaultRowHeight = 20;
    sheet.views = [{ state: "frozen", ySplit: 4 }];
    sheet.columns = columns as any;
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

  private writeTable(
    sheet: ExcelJS.Worksheet,
    startRow: number,
    title: string,
    headers: string[],
    rows: Array<Array<string | number>>
  ) {
    sheet.mergeCells(startRow, 1, startRow, headers.length);
    const titleCell = sheet.getCell(startRow, 1);
    titleCell.value = title;
    titleCell.font = { name: "Segoe UI", size: 12, bold: true, color: { argb: "0F172A" } };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "E2E8F0" } };
    titleCell.alignment = { vertical: "middle", horizontal: "left" };
    sheet.getRow(startRow).height = 22;

    const headerRow = sheet.getRow(startRow + 1);
    headerRow.values = ["", ...headers];
    this.styleHeaderRow(headerRow);

    if (!rows.length) {
      const emptyRow = sheet.getRow(startRow + 2);
      emptyRow.values = ["", "Nessun dato disponibile"];
      this.styleBodyRow(emptyRow);
      return startRow + 4;
    }

    rows.forEach((values, index) => {
      const row = sheet.getRow(startRow + 2 + index);
      row.values = ["", ...values];
      this.styleBodyRow(row, index % 2 === 1);
    });

    return startRow + rows.length + 4;
  }

  private writeKpiCard(
    sheet: ExcelJS.Worksheet,
    rowStart: number,
    colStart: number,
    title: string,
    value: string,
    tone: "blue" | "green" | "amber" | "rose" = "blue"
  ) {
    const toneColor =
      tone === "green" ? "065F46" : tone === "amber" ? "92400E" : tone === "rose" ? "9F1239" : "1E3A8A";
    const toneBg =
      tone === "green" ? "DCFCE7" : tone === "amber" ? "FEF3C7" : tone === "rose" ? "FFE4E6" : "DBEAFE";

    sheet.mergeCells(rowStart, colStart, rowStart, colStart + 1);
    sheet.mergeCells(rowStart + 1, colStart, rowStart + 2, colStart + 1);

    const titleCell = sheet.getCell(rowStart, colStart);
    titleCell.value = title;
    titleCell.font = { name: "Segoe UI", size: 9, bold: true, color: { argb: toneColor } };
    titleCell.alignment = { vertical: "middle", horizontal: "left" };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: toneBg } };

    const valueCell = sheet.getCell(rowStart + 1, colStart);
    valueCell.value = value;
    valueCell.font = { name: "Segoe UI", size: 16, bold: true, color: { argb: "0F172A" } };
    valueCell.alignment = { vertical: "middle", horizontal: "left" };
    valueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: toneBg } };

    for (let r = rowStart; r <= rowStart + 2; r += 1) {
      for (let c = colStart; c <= colStart + 1; c += 1) {
        const cell = sheet.getCell(r, c);
        cell.border = {
          top: { style: "thin", color: { argb: "CBD5E1" } },
          left: { style: "thin", color: { argb: "CBD5E1" } },
          bottom: { style: "thin", color: { argb: "CBD5E1" } },
          right: { style: "thin", color: { argb: "CBD5E1" } }
        };
      }
    }
  }

  private async buildAnalyticsWorkbook(tenantId: string, parsed: AnalyticsQuery, result: any) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Fleetum";
    workbook.lastModifiedBy = "Fleetum";
    workbook.created = new Date();
    workbook.modified = new Date();
    const workbookMetadata = workbook as unknown as { subject?: string; title?: string };
    workbookMetadata.subject = "Analytics Enterprise Report";
    workbookMetadata.title = "Fleetum Analytics";

    const executive = workbook.addWorksheet("Executive Dashboard");
    this.setupWorksheet(executive, [
      { width: 26 },
      { width: 18 },
      { width: 22 },
      { width: 18 },
      { width: 22 },
      { width: 18 },
      { width: 22 },
      { width: 18 }
    ]);
    this.writeSheetTitle(
      executive,
      "Fleetum - Executive Dashboard",
      `Tenant: ${tenantId} | Generato: ${this.formatDateTime(new Date())}`
    );

    executive.getCell("A4").value = "Intervallo analisi";
    executive.getCell("B4").value = `${this.formatDate(parsed.dateFrom ?? result.filtersApplied?.dateFrom)} - ${this.formatDate(
      parsed.dateTo ?? result.filtersApplied?.dateTo
    )}`;
    executive.getCell("D4").value = "Filtri";
    executive.getCell("E4").value = `Sede: ${parsed.siteId ?? "Tutte"} | Officina: ${parsed.workshopId ?? "Tutte"} | Stato: ${
      parsed.status ? stoppageStatusLabel(parsed.status) : "Tutti"
    }`;
    ["A4", "D4"].forEach((key) => {
      executive.getCell(key).font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "334155" } };
    });
    ["B4", "E4"].forEach((key) => {
      executive.getCell(key).font = { name: "Segoe UI", size: 10, color: { argb: "0F172A" } };
    });

    this.writeKpiCard(executive, 6, 1, "Totale fermi", this.formatNumber(result.kpis?.totalStoppages, 0), "blue");
    this.writeKpiCard(executive, 6, 3, "Fermi aperti", this.formatNumber(result.kpis?.openStoppages, 0), "amber");
    this.writeKpiCard(executive, 6, 5, "Fermi chiusi", this.formatNumber(result.kpis?.closedStoppages, 0), "green");
    this.writeKpiCard(executive, 6, 7, "Critici aperti", this.formatNumber(result.kpis?.criticalOpen, 0), "rose");
    this.writeKpiCard(executive, 10, 1, "Media chiusura (gg)", this.formatNumber(result.kpis?.averageClosureDays), "blue");
    this.writeKpiCard(executive, 10, 3, "P90 chiusura (gg)", this.formatNumber(result.kpis?.p90ClosureDays), "amber");
    this.writeKpiCard(executive, 10, 5, "Successo reminders", this.formatPercent(result.kpis?.reminderSuccessRate), "green");
    this.writeKpiCard(executive, 10, 7, "Costo stimato aperto", `EUR ${this.formatNumber(result.kpis?.estimatedOpenCost)}`, "rose");

    let rowCursor = 15;
    rowCursor = this.writeTable(
      executive,
      rowCursor,
      "Top Fermi Aperti (Priorita operativa)",
      ["Targa", "Veicolo", "Sede", "Officina", "Stato", "Priorita", "Giorni aperto"],
      (result.tables?.longestOpen ?? []).map((x: any) => [
        x.plate ?? "-",
        `${x.brand ?? ""} ${x.model ?? ""}`.trim(),
        x.site ?? "-",
        x.workshop ?? "-",
        stoppageStatusLabel(x.status),
        x.priority ?? "-",
        this.formatNumber(x.openDays)
      ])
    );

    this.writeTable(
      executive,
      rowCursor,
      "Volume per officina",
      ["Officina", "Fermi", "Grafico"],
      (result.charts?.byWorkshop ?? []).map((x: any, _idx: number, all: any[]) => {
        const max = Math.max(1, ...all.map((y) => Number(y.count) || 0));
        return [x.name ?? "-", this.formatNumber(x.count, 0), this.textBar(x.count, max, 26)];
      })
    );

    const trendSheet = workbook.addWorksheet("Trend");
    this.setupWorksheet(trendSheet, [
      { width: 14 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
      { width: 30 },
      { width: 30 },
      { width: 16 },
      { width: 16 }
    ]);
    this.writeSheetTitle(trendSheet, "Trend Giornaliero e Sintesi", "Vista evoluzione aperture, chiusure e reminders");
    const trendRows = result.charts?.trendStoppages ?? [];
    const maxOpened = Math.max(1, ...trendRows.map((x: any) => Number(x.opened) || 0));
    const maxClosed = Math.max(1, ...trendRows.map((x: any) => Number(x.closed) || 0));

    let trendCursor = this.writeTable(
      trendSheet,
      4,
      "Trend Aperture / Chiusure",
      ["Data", "Aperti", "Chiusi", "Reminders", "Grafico aperti", "Grafico chiusi"],
      trendRows.map((x: any) => [
        this.formatDate(x.day),
        this.formatNumber(x.opened, 0),
        this.formatNumber(x.closed, 0),
        this.formatNumber(x.reminders, 0),
        this.textBar(x.opened, maxOpened, 24),
        this.textBar(x.closed, maxClosed, 24)
      ])
    );

    trendCursor = this.writeTable(
      trendSheet,
      trendCursor,
      "Distribuzione per stato",
      ["Stato", "Numero", "Grafico"],
      (result.charts?.byStatus ?? []).map((x: any, _idx: number, all: any[]) => {
        const max = Math.max(1, ...all.map((y) => Number(y.count) || 0));
        return [stoppageStatusLabel(x.status), this.formatNumber(x.count, 0), this.textBar(x.count, max, 30)];
      })
    );

    this.writeTable(
      trendSheet,
      trendCursor,
      "Distribuzione per priorita",
      ["Priorita", "Numero", "Grafico"],
      (result.charts?.byPriority ?? []).map((x: any, _idx: number, all: any[]) => {
        const max = Math.max(1, ...all.map((y) => Number(y.count) || 0));
        return [x.priority ?? "-", this.formatNumber(x.count, 0), this.textBar(x.count, max, 30)];
      })
    );

    const opsSheet = workbook.addWorksheet("Performance Officine");
    this.setupWorksheet(opsSheet, [
      { width: 28 },
      { width: 12 },
      { width: 34 },
      { width: 28 },
      { width: 12 },
      { width: 34 },
      { width: 18 },
      { width: 18 }
    ]);
    this.writeSheetTitle(opsSheet, "Performance Operativa", "Analisi sedi, officine, aging e rischio reminder");
    let opsCursor = this.writeTable(
      opsSheet,
      4,
      "Distribuzione per sede",
      ["Sede", "Fermi", "Grafico"],
      (result.charts?.bySite ?? []).map((x: any, _idx: number, all: any[]) => {
        const max = Math.max(1, ...all.map((y) => Number(y.count) || 0));
        return [x.name ?? "-", this.formatNumber(x.count, 0), this.textBar(x.count, max, 28)];
      })
    );

    opsCursor = this.writeTable(
      opsSheet,
      opsCursor,
      "Distribuzione per marca",
      ["Marca", "Fermi", "Grafico"],
      (result.charts?.byBrand ?? []).map((x: any, _idx: number, all: any[]) => {
        const max = Math.max(1, ...all.map((y) => Number(y.count) || 0));
        return [x.name ?? "-", this.formatNumber(x.count, 0), this.textBar(x.count, max, 28)];
      })
    );

    this.writeTable(
      opsSheet,
      opsCursor,
      "Aging bucket fermi aperti",
      ["Bucket", "Numero", "Grafico"],
      (result.charts?.agingBuckets ?? []).map((x: any, _idx: number, all: any[]) => {
        const max = Math.max(1, ...all.map((y) => Number(y.count) || 0));
        return [x.bucket ?? "-", this.formatNumber(x.count, 0), this.textBar(x.count, max, 28)];
      })
    );

    const detailSheet = workbook.addWorksheet("Dettaglio Veicoli");
    this.setupWorksheet(detailSheet, [
      { width: 14 },
      { width: 24 },
      { width: 16 },
      { width: 20 },
      { width: 22 },
      { width: 14 },
      { width: 14 },
      { width: 26 }
    ]);
    this.writeSheetTitle(detailSheet, "Dettaglio Veicoli e Reminder", "Tabellare operativo per analisi puntuale");

    let detailCursor = this.writeTable(
      detailSheet,
      4,
      "Top veicoli per downtime cumulato",
      ["Targa", "Veicolo", "Numero fermi", "Giorni cumulati"],
      (result.tables?.topVehiclesDowntime ?? []).map((x: any) => [
        x.plate ?? "-",
        `${x.brand ?? ""} ${x.model ?? ""}`.trim(),
        this.formatNumber(x.count, 0),
        this.formatNumber(x.openDays)
      ])
    );

    this.writeTable(
      detailSheet,
      detailCursor,
      "Reminder falliti (ultimi)",
      ["Data invio", "Destinatario", "Tipo", "Errore"],
      (result.tables?.reminderFailures ?? []).map((x: any) => [
        this.formatDateTime(new Date(x.sentAt)),
        x.recipient ?? "-",
        x.type ?? "-",
        x.errorMessage ?? "-"
      ])
    );

    return workbook;
  }

  dashboard = async (req: Request, res: Response) => {
    const result = await this.useCase.dashboardOverview(req.auth!.tenantId);
    res.json(result);
  };

  analytics = async (req: Request, res: Response) => {
    const querySchema = z.object({
      dateFrom: z.string().datetime().optional(),
      dateTo: z.string().datetime().optional(),
      siteId: this.optionalString,
      workshopId: this.optionalString,
      status: this.statusEnum,
      plate: this.optionalString,
      brand: this.optionalString,
      model: this.optionalString
    });
    const parsed = querySchema.parse(req.query);
    const result = await this.useCase.analytics(req.auth!.tenantId, {
      dateFrom: parsed.dateFrom ? new Date(parsed.dateFrom) : undefined,
      dateTo: parsed.dateTo ? new Date(parsed.dateTo) : undefined,
      siteId: parsed.siteId,
      workshopId: parsed.workshopId,
      status: parsed.status,
      plate: parsed.plate,
      brand: parsed.brand,
      model: parsed.model
    });
    res.json(result);
  };

  analyticsCsv = async (req: Request, res: Response) => {
    const querySchema = z.object({
      dateFrom: z.string().datetime().optional(),
      dateTo: z.string().datetime().optional(),
      siteId: this.optionalString,
      workshopId: this.optionalString,
      status: this.statusEnum,
      plate: this.optionalString,
      brand: this.optionalString,
      model: this.optionalString
    });
    const parsed = querySchema.parse(req.query);
    const result = await this.useCase.analytics(req.auth!.tenantId, {
      dateFrom: parsed.dateFrom ? new Date(parsed.dateFrom) : undefined,
      dateTo: parsed.dateTo ? new Date(parsed.dateTo) : undefined,
      siteId: parsed.siteId,
      workshopId: parsed.workshopId,
      status: parsed.status,
      plate: parsed.plate,
      brand: parsed.brand,
      model: parsed.model
    });

    const csv = this.buildAnalyticsReportCsv(req.auth!.tenantId, parsed, result);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=\"gestione-fermi-report-analytics-${new Date().toISOString().slice(0, 10)}.csv\"`
    );
    res.send(csv);
  };

  analyticsXlsx = async (req: Request, res: Response) => {
    const querySchema = z.object({
      dateFrom: z.string().datetime().optional(),
      dateTo: z.string().datetime().optional(),
      siteId: this.optionalString,
      workshopId: this.optionalString,
      status: this.statusEnum,
      plate: this.optionalString,
      brand: this.optionalString,
      model: this.optionalString
    });
    const parsed = querySchema.parse(req.query);
    const result = await this.useCase.analytics(req.auth!.tenantId, {
      dateFrom: parsed.dateFrom ? new Date(parsed.dateFrom) : undefined,
      dateTo: parsed.dateTo ? new Date(parsed.dateTo) : undefined,
      siteId: parsed.siteId,
      workshopId: parsed.workshopId,
      status: parsed.status,
      plate: parsed.plate,
      brand: parsed.brand,
      model: parsed.model
    });

    const workbook = await this.buildAnalyticsWorkbook(req.auth!.tenantId, parsed, result);
    const raw = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=\"gestione-fermi-report-enterprise-${new Date().toISOString().slice(0, 10)}.xlsx\"`
    );
    res.send(buffer);
  };

  workshopsHealth = async (req: Request, res: Response) => {
    const querySchema = z.object({
      dateFrom: z.string().datetime().optional(),
      dateTo: z.string().datetime().optional()
    });
    const parsed = querySchema.parse(req.query);
    const result = await this.useCase.workshopHealth(
      req.auth!.tenantId,
      parsed.dateFrom ? new Date(parsed.dateFrom) : undefined,
      parsed.dateTo ? new Date(parsed.dateTo) : undefined
    );
    res.json({ data: result });
  };

  teamPerformance = async (req: Request, res: Response) => {
    const querySchema = z.object({
      dateFrom: z.string().datetime().optional(),
      dateTo: z.string().datetime().optional()
    });
    const parsed = querySchema.parse(req.query);
    const result = await this.useCase.teamPerformance(
      req.auth!.tenantId,
      parsed.dateFrom ? new Date(parsed.dateFrom) : undefined,
      parsed.dateTo ? new Date(parsed.dateTo) : undefined
    );
    res.json({ data: result });
  };

  aiSuggestions = async (req: Request, res: Response) => {
    const result = await this.useCase.aiSuggestions(req.auth!.tenantId);
    res.json(result);
  };

  workshopsCapacity = async (req: Request, res: Response) => {
    const querySchema = z.object({
      dateFrom: z.string().datetime().optional(),
      dateTo: z.string().datetime().optional()
    });
    const parsed = querySchema.parse(req.query);
    const result = await this.useCase.workshopsCapacity(
      req.auth!.tenantId,
      parsed.dateFrom ? new Date(parsed.dateFrom) : undefined,
      parsed.dateTo ? new Date(parsed.dateTo) : undefined
    );
    res.json({ data: result });
  };
}
