import { readFile } from "node:fs/promises";
import { metrics } from "../../infrastructure/observability/metrics.js";
import { env } from "../../shared/config/env.js";

type RestoreDrillStatus = "PASS" | "FAIL" | "MISSING" | "STALE";

type RestoreDrillTableCount = {
  table: string;
  sourceCount: number;
  restoredCount: number;
  status: "PASS" | "MISMATCH" | "SOURCE_UNAVAILABLE" | string;
};

type RestoreDrillReportPayload = {
  status?: string;
  generatedAt?: string;
  startedAt?: string;
  source?: string;
  postgresBackupFile?: string;
  uploadsBackupFile?: string;
  rpoSeconds?: number;
  rtoSeconds?: number;
  migrationsRestored?: number;
  publicTablesRestored?: number;
  tableCounts?: RestoreDrillTableCount[];
  uploads?: {
    status?: string;
    recoveredFile?: {
      relativePath?: string;
      sizeBytes?: number;
      sha256?: string;
    } | null;
  };
};

const secondsSince = (isoDate: string) => Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
const isValidDate = (value?: string) => Boolean(value && !Number.isNaN(new Date(value).getTime()));

const toSafeStatus = (status?: string): RestoreDrillStatus => (status === "PASS" ? "PASS" : "FAIL");

export class RestoreDrillObservabilityService {
  constructor(
    private readonly summaryFile = env.RESTORE_DRILL_SUMMARY_FILE,
    private readonly staleDays = env.RESTORE_DRILL_STALE_DAYS
  ) {}

  async platformSummary() {
    let payload: RestoreDrillReportPayload;

    try {
      payload = JSON.parse(await readFile(this.summaryFile, "utf8")) as RestoreDrillReportPayload;
    } catch {
      const summary = {
        status: "MISSING" as const,
        summaryFile: this.summaryFile,
        generatedAt: null,
        ageSeconds: null,
        staleAfterDays: this.staleDays,
        source: null,
        postgresBackupFile: null,
        uploadsBackupFile: null,
        rpoSeconds: null,
        rtoSeconds: null,
        migrationsRestored: 0,
        publicTablesRestored: 0,
        tableCounts: [] as RestoreDrillTableCount[],
        tableMismatches: 0,
        uploads: { status: "MISSING", recoveredFileSizeBytes: null, recoveredFileSha256Prefix: null }
      };
      metrics.setRestoreDrillSummary(summary);
      return summary;
    }

    const generatedAt = isValidDate(payload.generatedAt) ? String(payload.generatedAt) : null;
    const ageSeconds = generatedAt ? secondsSince(generatedAt) : null;
    const staleThresholdSeconds = this.staleDays * 24 * 60 * 60;
    const status: RestoreDrillStatus =
      generatedAt && ageSeconds !== null && ageSeconds > staleThresholdSeconds ? "STALE" : toSafeStatus(payload.status);
    const tableCounts = Array.isArray(payload.tableCounts) ? payload.tableCounts : [];
    const tableMismatches = tableCounts.filter((row) => row.status !== "PASS").length;

    const summary = {
      status,
      summaryFile: this.summaryFile,
      generatedAt,
      ageSeconds,
      staleAfterDays: this.staleDays,
      source: payload.source ?? null,
      postgresBackupFile: payload.postgresBackupFile ?? null,
      uploadsBackupFile: payload.uploadsBackupFile ?? null,
      rpoSeconds: Number.isFinite(payload.rpoSeconds) ? payload.rpoSeconds ?? null : null,
      rtoSeconds: Number.isFinite(payload.rtoSeconds) ? payload.rtoSeconds ?? null : null,
      migrationsRestored: Number(payload.migrationsRestored ?? 0),
      publicTablesRestored: Number(payload.publicTablesRestored ?? 0),
      tableCounts,
      tableMismatches,
      uploads: {
        status: payload.uploads?.status ?? "UNKNOWN",
        recoveredFileSizeBytes: payload.uploads?.recoveredFile?.sizeBytes ?? null,
        recoveredFileSha256Prefix: payload.uploads?.recoveredFile?.sha256?.slice(0, 12) ?? null
      }
    };

    metrics.setRestoreDrillSummary(summary);
    return summary;
  }
}
