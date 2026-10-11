import { Prisma } from "@prisma/client";
import { prisma } from "../../../infrastructure/database/prisma/client.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { ParsedImportRow, normalizeImportHeader, parseImportFile } from "../../services/import-file-parser-service.js";
import { computeVehicleRevisionDueAt } from "../../services/vehicle-revision-schedule-service.js";
import { lockVehicleSite, lockVehicleTenant } from "../../../infrastructure/repositories/vehicle-tenant-scope.js";

type ImportEntity = "vehicles" | "workshops";

type ImportErrorDetail = {
  row: number;
  field: string;
  reason: string;
  value?: string;
};

export type ImportResponse = {
  totalRows: number;
  validRows: number;
  inserted: number;
  skipped: number;
  errors: ImportErrorDetail[];
  dryRun: boolean;
};

type VehicleCandidate = {
  siteId: string;
  plate: string;
  brand: string;
  model: string;
  year?: number;
  currentKm?: number;
  maintenanceIntervalKm?: number;
  registrationDate?: Date;
  lastRevisionAt?: Date;
  revisionDueAt?: Date;
};

type WorkshopCandidate = {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  address: string;
  city: string;
};

type VehicleImportOptions = {
  defaultSiteId?: string;
};

const MAX_IMPORT_ROWS = 5000;

const VEHICLE_HEADERS = {
  plate: ["targa", "plate"],
  brand: ["marca", "brand"],
  model: ["modello", "model"],
  year: ["anno", "year"],
  currentKm: ["km_attuali", "kmattuali", "km_attuale", "current_km", "currentkm", "km"],
  maintenanceIntervalKm: [
    "intervallo_km",
    "intervallo",
    "intervallo_manutenzione_km",
    "maintenance_interval_km",
    "maintenanceintervalkm"
  ],
  registrationDate: [
    "data_immatricolazione",
    "immatricolazione",
    "registration_date",
    "registrationdate",
    "prima_immatricolazione"
  ],
  lastRevisionAt: ["ultima_revisione", "last_revision_at", "lastrevisionat", "data_ultima_revisione"],
  revisionDueAt: ["revisione_scadenza", "scadenza_revisione", "revision_due_at", "revisiondueat"],
  siteName: ["site_name", "sitename", "sede", "site"],
  workshopName: ["workshop_name", "workshopname", "officina", "workshop"]
};

const WORKSHOP_HEADERS = {
  name: ["nome", "nome_officina", "officina", "name"],
  contactName: ["referente", "contact_name", "contactname", "responsabile"],
  email: ["email", "mail"],
  phone: ["telefono", "phone", "tel"],
  whatsapp: ["whatsapp", "numero_whatsapp", "phone_whatsapp"],
  address: ["indirizzo", "address", "via"],
  city: ["citta", "city"]
};

const toKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

const compactValue = (value: unknown): string => String(value ?? "").trim();

const findByAliases = (row: ParsedImportRow, aliases: string[]): string => {
  for (const alias of aliases) {
    if (alias in row) {
      return compactValue(row[alias]);
    }
  }
  return "";
};

const parseInteger = (value: string): number | null => {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, "."));
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
};

const parseDate = (value: string): Date | null => {
  const raw = value.trim();
  if (!raw) return null;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [day, month, year] = raw.split("/").map((part) => Number(part));
    const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const isEmailValid = (value: string): boolean => {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
};

const assertRequiredColumns = (
  headers: string[],
  aliasesMap: Record<string, string[]>,
  requiredFields: string[],
  entity: ImportEntity
) => {
  const set = new Set(headers);
  const missing = requiredFields.filter((field) => {
    const aliases = aliasesMap[field] ?? [field];
    return !aliases.some((alias) => set.has(normalizeImportHeader(alias)));
  });

  if (missing.length > 0) {
    throw new AppError(
      `Intestazioni mancanti per import ${entity}: ${missing.join(", ")}`,
      400,
      "IMPORT_MISSING_HEADERS",
      { missingHeaders: missing }
    );
  }
};

const normalizeRowsWithAliases = (rows: ParsedImportRow[], aliasesMap: Record<string, string[]>) => {
  return rows.map((row) => {
    const normalized: ParsedImportRow = {};
    Object.entries(aliasesMap).forEach(([target, aliases]) => {
      normalized[target] = findByAliases(row, aliases);
    });
    return normalized;
  });
};

export class ImportMasterDataUseCase {
  private baseResponse(totalRows: number, dryRun: boolean): ImportResponse {
    return {
      totalRows,
      validRows: 0,
      inserted: 0,
      skipped: totalRows,
      errors: [],
      dryRun
    };
  }

  async importVehicles(
    tenantId: string,
    fileBuffer: Buffer,
    dryRun: boolean,
    options: VehicleImportOptions = {}
  ): Promise<ImportResponse> {
    const parsed = await parseImportFile(fileBuffer);
    if (parsed.rows.length > MAX_IMPORT_ROWS) {
      throw new AppError(
        `Il file supera il limite massimo di ${MAX_IMPORT_ROWS} righe`,
        400,
        "IMPORT_TOO_MANY_ROWS",
        { maxRows: MAX_IMPORT_ROWS }
      );
    }

    assertRequiredColumns(parsed.headers, VEHICLE_HEADERS, ["plate", "brand", "model"], "vehicles");

    const normalizedRows = normalizeRowsWithAliases(parsed.rows, VEHICLE_HEADERS);

    const [sites, workshops, vehicles] = await Promise.all([
      prisma.site.findMany({ where: { tenantId, deletedAt: null }, select: { id: true, name: true } }),
      prisma.workshop.findMany({ where: { tenantId, deletedAt: null }, select: { name: true } }),
      prisma.vehicle.findMany({ where: { tenantId, deletedAt: null }, select: { plate: true } })
    ]);

    const siteByName = new Map<string, { id: string; name: string }>();
    sites.forEach((site) => siteByName.set(toKey(site.name), site));

    const workshopNames = new Set(workshops.map((workshop) => toKey(workshop.name)));
    const existingPlates = new Set(vehicles.map((vehicle) => toKey(vehicle.plate)));
    const filePlates = new Set<string>();
    const defaultSiteId = String(options.defaultSiteId ?? "").trim();
    const defaultSite = defaultSiteId ? sites.find((site) => String(site.id) === defaultSiteId) ?? null : null;

    if (defaultSiteId && !defaultSite) {
      throw new AppError("Sede di default non valida", 400, "IMPORT_DEFAULT_SITE_INVALID");
    }

    const result = this.baseResponse(normalizedRows.length, dryRun);
    const validCandidates: VehicleCandidate[] = [];

    normalizedRows.forEach((row, index) => {
      const rowNumber = index + 2;
      const plate = row.plate.trim().toUpperCase();
      const brand = row.brand.trim();
      const model = row.model.trim();
      const yearRaw = row.year;
      const currentKmRaw = row.currentKm;
      const maintenanceIntervalRaw = row.maintenanceIntervalKm;
      const registrationDateRaw = row.registrationDate;
      const lastRevisionAtRaw = row.lastRevisionAt;
      const revisionDueAtRaw = row.revisionDueAt;
      const siteName = row.siteName;
      const workshopName = row.workshopName;

      const year = parseInteger(yearRaw);
      const currentKm = parseInteger(currentKmRaw);
      const maintenanceIntervalKm = parseInteger(maintenanceIntervalRaw);
      const registrationDate = parseDate(registrationDateRaw);
      const lastRevisionAt = parseDate(lastRevisionAtRaw);
      const revisionDueAt = parseDate(revisionDueAtRaw);

      const rowErrors: ImportErrorDetail[] = [];

      if (!plate) rowErrors.push({ row: rowNumber, field: "targa", reason: "Campo obbligatorio" });
      if (!brand) rowErrors.push({ row: rowNumber, field: "marca", reason: "Campo obbligatorio" });
      if (!model) rowErrors.push({ row: rowNumber, field: "modello", reason: "Campo obbligatorio" });

      if (yearRaw && (year === null || year < 1950 || year > 2100)) {
        rowErrors.push({ row: rowNumber, field: "anno", reason: "Anno non valido", value: yearRaw });
      }
      if (currentKmRaw && (currentKm === null || currentKm < 0)) {
        rowErrors.push({ row: rowNumber, field: "km_attuali", reason: "Km attuali non valido", value: currentKmRaw });
      }
      if (maintenanceIntervalRaw && (maintenanceIntervalKm === null || maintenanceIntervalKm <= 0)) {
        rowErrors.push({ row: rowNumber, field: "intervallo_km", reason: "Intervallo km non valido", value: maintenanceIntervalRaw });
      }
      if (registrationDateRaw && registrationDate === null) {
        rowErrors.push({
          row: rowNumber,
          field: "data_immatricolazione",
          reason: "Data immatricolazione non valida (usa YYYY-MM-DD o DD/MM/YYYY)",
          value: registrationDateRaw
        });
      }
      if (lastRevisionAtRaw && lastRevisionAt === null) {
        rowErrors.push({
          row: rowNumber,
          field: "ultima_revisione",
          reason: "Data ultima revisione non valida (usa YYYY-MM-DD o DD/MM/YYYY)",
          value: lastRevisionAtRaw
        });
      }
      if (revisionDueAtRaw && revisionDueAt === null) {
        rowErrors.push({
          row: rowNumber,
          field: "revisione_scadenza",
          reason: "Data revisione non valida (usa YYYY-MM-DD o DD/MM/YYYY)",
          value: revisionDueAtRaw
        });
      }

      const normalizedSiteKey = toKey(siteName);
      const resolvedSite = normalizedSiteKey ? siteByName.get(normalizedSiteKey) : defaultSite;
      if (!resolvedSite) {
        rowErrors.push({
          row: rowNumber,
          field: "site_name",
          reason: "Sede non trovata. Usa la colonna site_name oppure seleziona una sede di default",
          value: siteName
        });
      }

      if (workshopName && !workshopNames.has(toKey(workshopName))) {
        rowErrors.push({ row: rowNumber, field: "workshop_name", reason: "Officina non trovata", value: workshopName });
      }

      const normalizedPlate = toKey(plate);
      if (normalizedPlate && filePlates.has(normalizedPlate)) {
        rowErrors.push({ row: rowNumber, field: "targa", reason: "Duplicato nel file", value: plate });
      }
      if (normalizedPlate && existingPlates.has(normalizedPlate)) {
        rowErrors.push({ row: rowNumber, field: "targa", reason: "Targa gia esistente", value: plate });
      }

      if (rowErrors.length > 0) {
        result.errors.push(...rowErrors);
        return;
      }

      filePlates.add(normalizedPlate);
      validCandidates.push({
        siteId: resolvedSite!.id,
        plate,
        brand,
        model,
        year: year ?? undefined,
        currentKm: currentKm ?? undefined,
        maintenanceIntervalKm: maintenanceIntervalKm ?? undefined,
        registrationDate: registrationDate ?? undefined,
        lastRevisionAt: lastRevisionAt ?? undefined,
        revisionDueAt:
          computeVehicleRevisionDueAt({
            registrationDate: registrationDate ?? null,
            lastRevisionAt: lastRevisionAt ?? null,
            manualRevisionDueAt: revisionDueAt ?? null
          }) ?? undefined
      });
    });

    result.validRows = validCandidates.length;

    if (dryRun || validCandidates.length === 0) {
      result.inserted = 0;
      result.skipped = result.totalRows;
      return result;
    }
    let insertResult: { count: number };
    try {
      insertResult = await prisma.$transaction(async (tx) => {
        await lockVehicleTenant(tx, tenantId);
        for (const siteId of [...new Set(validCandidates.map((candidate) => candidate.siteId))].sort()) {
          await lockVehicleSite(tx, tenantId, siteId, true);
        }
        return tx.vehicle.createMany({ data: validCandidates.map((candidate) => ({ ...candidate, tenantId })) });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError("Trovate targhe duplicate durante l'import. Aggiorna i dati e riprova", 409, "VEHICLE_PLATE_ALREADY_EXISTS");
      }
      throw error;
    }

    result.inserted = insertResult.count;
    result.skipped = result.totalRows - result.inserted;
    return result;
  }

  async importWorkshops(tenantId: string, fileBuffer: Buffer, dryRun: boolean): Promise<ImportResponse> {
    const parsed = await parseImportFile(fileBuffer);
    if (parsed.rows.length > MAX_IMPORT_ROWS) {
      throw new AppError(
        `Il file supera il limite massimo di ${MAX_IMPORT_ROWS} righe`,
        400,
        "IMPORT_TOO_MANY_ROWS",
        { maxRows: MAX_IMPORT_ROWS }
      );
    }

    assertRequiredColumns(parsed.headers, WORKSHOP_HEADERS, ["name", "address", "city"], "workshops");

    const normalizedRows = normalizeRowsWithAliases(parsed.rows, WORKSHOP_HEADERS);

    const workshops = await prisma.workshop.findMany({
      where: { tenantId, deletedAt: null },
      select: { name: true }
    });

    const existingNames = new Set(workshops.map((workshop) => toKey(workshop.name)));
    const fileNames = new Set<string>();

    const result = this.baseResponse(normalizedRows.length, dryRun);
    const validCandidates: WorkshopCandidate[] = [];

    normalizedRows.forEach((row, index) => {
      const rowNumber = index + 2;
      const name = row.name;
      const contactName = row.contactName;
      const email = row.email;
      const phone = row.phone;
      const whatsapp = row.whatsapp;
      const address = row.address;
      const city = row.city;

      const rowErrors: ImportErrorDetail[] = [];

      if (!name) rowErrors.push({ row: rowNumber, field: "nome", reason: "Campo obbligatorio" });
      if (!address) rowErrors.push({ row: rowNumber, field: "indirizzo", reason: "Campo obbligatorio" });
      if (!city) rowErrors.push({ row: rowNumber, field: "citta", reason: "Campo obbligatorio" });
      if (!isEmailValid(email)) {
        rowErrors.push({ row: rowNumber, field: "email", reason: "Email non valida", value: email });
      }

      const normalizedName = toKey(name);
      if (normalizedName && fileNames.has(normalizedName)) {
        rowErrors.push({ row: rowNumber, field: "nome", reason: "Duplicato nel file", value: name });
      }
      if (normalizedName && existingNames.has(normalizedName)) {
        rowErrors.push({ row: rowNumber, field: "nome", reason: "Officina gia esistente", value: name });
      }

      if (rowErrors.length > 0) {
        result.errors.push(...rowErrors);
        return;
      }

      fileNames.add(normalizedName);
      validCandidates.push({
        name,
        contactName: contactName || undefined,
        email: email || undefined,
        phone: phone || undefined,
        whatsapp: whatsapp || undefined,
        address,
        city
      });
    });

    result.validRows = validCandidates.length;

    if (dryRun || validCandidates.length === 0) {
      result.inserted = 0;
      result.skipped = result.totalRows;
      return result;
    }

    const insertResult = await prisma.$transaction((tx) =>
      tx.workshop.createMany({
        data: validCandidates.map((candidate) => ({ ...candidate, tenantId })),
        skipDuplicates: false
      })
    );

    result.inserted = insertResult.count;
    result.skipped = result.totalRows - result.inserted;
    return result;
  }
}
