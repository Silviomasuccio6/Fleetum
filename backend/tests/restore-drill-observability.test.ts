import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { RestoreDrillObservabilityService } from "../src/application/services/restore-drill-observability-service.js";
import { metrics } from "../src/infrastructure/observability/metrics.js";

const withTempSummary = async (payload: unknown) => {
  const dir = await mkdtemp(path.join(tmpdir(), "fleetum-restore-drill-"));
  const file = path.join(dir, "latest.json");
  await writeFile(file, JSON.stringify(payload), "utf8");
  return { dir, file };
};

test("restore drill observability returns safe PASS summary and metrics", async () => {
  const { dir, file } = await withTempSummary({
    status: "PASS",
    generatedAt: new Date().toISOString(),
    source: "offsite",
    postgresBackupFile: "fleetum-postgres-20260708T010000Z.sql.gz",
    uploadsBackupFile: "fleetum-uploads-20260708T010000Z.tar.gz",
    rpoSeconds: 120,
    rtoSeconds: 9,
    migrationsRestored: 32,
    publicTablesRestored: 54,
    tableCounts: [
      { table: "Tenant", sourceCount: 1, restoredCount: 1, status: "PASS" },
      { table: "Vehicle", sourceCount: 12, restoredCount: 12, status: "PASS" }
    ],
    uploads: {
      status: "PASS",
      recoveredFile: {
        relativePath: "tenant-private/customer-document.pdf",
        sizeBytes: 4096,
        sha256: "1234567890abcdef"
      }
    }
  });

  try {
    const summary = await new RestoreDrillObservabilityService(file, 35).platformSummary();

    assert.equal(summary.status, "PASS");
    assert.equal(summary.source, "offsite");
    assert.equal(summary.rpoSeconds, 120);
    assert.equal(summary.tableMismatches, 0);
    assert.equal(summary.uploads.recoveredFileSizeBytes, 4096);
    assert.equal(summary.uploads.recoveredFileSha256Prefix, "1234567890ab");
    assert.equal("relativePath" in summary.uploads, false);

    const renderedMetrics = metrics.renderPrometheus();
    assert.match(renderedMetrics, /fleetum_restore_drill_status\{status="PASS"\} 1/);
    assert.match(renderedMetrics, /fleetum_restore_drill_rpo_seconds 120/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("restore drill observability reports MISSING when latest summary is unavailable", async () => {
  const summary = await new RestoreDrillObservabilityService("/tmp/fleetum-missing-restore-drill.json", 35).platformSummary();

  assert.equal(summary.status, "MISSING");
  assert.equal(summary.generatedAt, null);
  assert.deepEqual(summary.tableCounts, []);
});

test("restore drill observability marks old reports as STALE", async () => {
  const { dir, file } = await withTempSummary({
    status: "PASS",
    generatedAt: "2026-01-01T00:00:00.000Z",
    tableCounts: [],
    uploads: { status: "PASS", recoveredFile: null }
  });

  try {
    const summary = await new RestoreDrillObservabilityService(file, 1).platformSummary();
    assert.equal(summary.status, "STALE");
    assert.ok((summary.ageSeconds ?? 0) > 24 * 60 * 60);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
