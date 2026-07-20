import { Prisma } from "@prisma/client";
import {
  EXACT_NUMERIC_FIELDS,
  type ExactNumericField
} from "../../domain/money/exact-money-fields.js";
import { env } from "../../shared/config/env.js";
import { logger } from "../logging/logger.js";
import { metrics } from "../observability/metrics.js";
import { prisma } from "./prisma/client.js";

export type ExactMoneyReadMode = "legacy" | "compare" | "exact";
export type ExactMoneyModel = (typeof EXACT_NUMERIC_FIELDS)[number]["model"];

type ExactMoneyRecord = {
  id: string;
};

type ExactMoneyQueryRow = {
  id: string;
  [key: string]: string | null;
};

type ExactMoneyReadOptions = {
  tenantId?: string;
};

type ExactMoneyReaderDependencies = {
  query<T>(sql: string, ...values: unknown[]): Promise<T>;
  logMismatch(input: {
    model: ExactMoneyModel;
    mode: ExactMoneyReadMode;
    recordsChecked: number;
    fieldsChecked: number;
    mismatchCount: number;
    fallbackCount: number;
  }): void;
  observe(input: {
    model: ExactMoneyModel;
    mode: ExactMoneyReadMode;
    recordsChecked: number;
    mismatchCount: number;
    fallbackCount: number;
  }): void;
};

const quoteIdentifier = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

const fieldsByModel = EXACT_NUMERIC_FIELDS.reduce((map, field) => {
  const fields = map.get(field.model) ?? [];
  fields.push(field);
  map.set(field.model, fields);
  return map;
}, new Map<ExactMoneyModel, ExactNumericField[]>());

const normalizeDecimal = (value: unknown, scale: number): string | null => {
  if (value === null || value === undefined || value === "") return null;
  try {
    return new Prisma.Decimal(value as Prisma.Decimal.Value)
      .toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP)
      .toFixed(scale);
  } catch {
    return null;
  }
};

const defaultDependencies: ExactMoneyReaderDependencies = {
  query: async <T>(sql: string, ...values: unknown[]) =>
    prisma.$queryRawUnsafe<T>(sql, ...values),
  logMismatch(input) {
    const payload = {
      model: input.model,
      mode: input.mode,
      recordsChecked: input.recordsChecked,
      fieldsChecked: input.fieldsChecked,
      mismatchCount: input.mismatchCount,
      fallbackCount: input.fallbackCount
    };
    if (input.fallbackCount > 0) {
      logger.error(payload, "Exact money read retained legacy values");
    } else if (input.mismatchCount > 0) {
      logger.warn(payload, "Exact money shadow read mismatch");
    }
  },
  observe(input) {
    metrics.observeExactMoneyRead(input);
  }
};

export class ExactMoneyReader {
  constructor(
    private readonly mode: ExactMoneyReadMode = env.EXACT_MONEY_READ_MODE,
    private readonly dependencies: ExactMoneyReaderDependencies = defaultDependencies
  ) {}

  async hydrate<T extends ExactMoneyRecord>(
    model: ExactMoneyModel,
    records: readonly T[],
    options: ExactMoneyReadOptions = {}
  ): Promise<T[]> {
    if (this.mode === "legacy" || records.length === 0) return [...records];

    const fields = fieldsByModel.get(model);
    if (!fields?.length) return [...records];
    const selectedFields = fields.filter((field) =>
      records.some((record) =>
        Object.prototype.hasOwnProperty.call(record, field.legacyField)
      )
    );
    if (selectedFields.length === 0) return [...records];

    const ids = [...new Set(records.map((record) => record.id))];
    const table = quoteIdentifier(selectedFields[0].table);
    const exactSelections = selectedFields
      .map(
        (field) =>
          `${quoteIdentifier(field.exactColumn)}::text AS ${quoteIdentifier(field.exactField)}`
      )
      .join(", ");
    const tenantClause = options.tenantId ? ` AND "tenantId" = $2` : "";
    const values: unknown[] = options.tenantId ? [ids, options.tenantId] : [ids];

    // Table and column identifiers come only from the audited static registry.
    // Record IDs and tenant scope remain parameterized.
    let exactRows: ExactMoneyQueryRow[];
    try {
      exactRows = await this.dependencies.query<ExactMoneyQueryRow[]>(
        `SELECT "id", ${exactSelections} FROM ${table} WHERE "id" = ANY($1::text[])${tenantClause}`,
        ...values
      );
    } catch {
      const fallbackCount = records.length;
      this.dependencies.observe({
        model,
        mode: this.mode,
        recordsChecked: records.length,
        mismatchCount: 0,
        fallbackCount
      });
      this.dependencies.logMismatch({
        model,
        mode: this.mode,
        recordsChecked: records.length,
        fieldsChecked: selectedFields.length,
        mismatchCount: 0,
        fallbackCount
      });
      return [...records];
    }
    const exactById = new Map(exactRows.map((row) => [row.id, row]));

    let mismatchCount = 0;
    let fallbackCount = 0;

    const hydrated = records.map((record) => {
      const exactRow = exactById.get(record.id);
      const source = record as T & Record<string, unknown>;
      let next: (T & Record<string, unknown>) | null = null;

      for (const field of selectedFields) {
        if (!Object.prototype.hasOwnProperty.call(source, field.legacyField)) {
          continue;
        }
        const legacyValue = source[field.legacyField];
        const exactValue = exactRow?.[field.exactField] ?? null;
        const normalizedLegacy = normalizeDecimal(legacyValue, field.scale);
        const normalizedExact = normalizeDecimal(exactValue, field.scale);

        if (normalizedLegacy !== normalizedExact) mismatchCount += 1;

        if (this.mode !== "exact") continue;
        if (normalizedExact === null && normalizedLegacy !== null) {
          fallbackCount += 1;
          continue;
        }

        next ??= { ...source };
        const mutable = next as Record<string, unknown>;
        mutable[field.legacyField] =
          normalizedExact === null ? null : Number(normalizedExact);
      }

      return (next ?? record) as T;
    });

    this.dependencies.observe({
      model,
      mode: this.mode,
      recordsChecked: records.length,
      mismatchCount,
      fallbackCount
    });

    if (mismatchCount > 0 || fallbackCount > 0) {
      this.dependencies.logMismatch({
        model,
        mode: this.mode,
        recordsChecked: records.length,
        fieldsChecked: selectedFields.length,
        mismatchCount,
        fallbackCount
      });
    }

    return hydrated;
  }

  async hydrateOne<T extends ExactMoneyRecord>(
    model: ExactMoneyModel,
    record: T,
    options: ExactMoneyReadOptions = {}
  ): Promise<T> {
    return (await this.hydrate(model, [record], options))[0];
  }
}

export const exactMoneyReader = new ExactMoneyReader();
