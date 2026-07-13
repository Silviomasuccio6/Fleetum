import { EXACT_NUMERIC_FIELDS } from "../domain/money/exact-money-fields.js";
import { prisma } from "../infrastructure/database/prisma/client.js";
import { logger } from "../infrastructure/logging/logger.js";

type ReconciliationRow = {
  rowCount: number;
  mismatchCount: number;
};

const quoteIdentifier = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

const reconcile = async () => {
  let totalMismatches = 0;

  for (const field of EXACT_NUMERIC_FIELDS) {
    const table = quoteIdentifier(field.table);
    const legacy = quoteIdentifier(field.legacyColumn);
    const exact = quoteIdentifier(field.exactColumn);
    const mismatchCondition = field.nullable
      ? `((${legacy} IS NULL AND ${exact} IS NOT NULL) OR (${legacy} IS NOT NULL AND (${exact} IS NULL OR ${exact} <> ROUND(${legacy}::numeric, ${field.scale}))))`
      : `(${exact} IS NULL OR ${exact} <> ROUND(${legacy}::numeric, ${field.scale}))`;

    // Identifiers come only from the audited static field registry, never from user input.
    const rows = await prisma.$queryRawUnsafe<ReconciliationRow[]>(`
      SELECT
        COUNT(*)::int AS "rowCount",
        COUNT(*) FILTER (WHERE ${mismatchCondition})::int AS "mismatchCount"
      FROM ${table}
    `);
    const result = rows[0] ?? { rowCount: 0, mismatchCount: 0 };
    totalMismatches += result.mismatchCount;

    logger.info(
      {
        model: field.model,
        field: field.legacyField,
        rowCount: result.rowCount,
        mismatchCount: result.mismatchCount
      },
      "Exact money reconciliation field checked"
    );
  }

  if (totalMismatches > 0) {
    throw new Error(`Exact money reconciliation failed: ${totalMismatches} mismatched rows`);
  }

  logger.info(
    { checkedFields: EXACT_NUMERIC_FIELDS.length, mismatchCount: 0 },
    "Exact money reconciliation completed"
  );
};

reconcile()
  .catch((error) => {
    logger.error({ error }, "Exact money reconciliation failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
