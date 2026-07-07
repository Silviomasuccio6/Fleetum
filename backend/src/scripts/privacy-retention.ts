import { PrivacyComplianceService } from "../application/services/privacy-compliance-service.js";
import { prisma } from "../infrastructure/database/prisma/client.js";

const mode = process.argv.includes("--run") ? "run" : "dry-run";
const tenantArg = process.argv.find((arg) => arg.startsWith("--tenant="));
const tenantId = tenantArg?.split("=")[1] || process.env.PRIVACY_RETENTION_TENANT_ID || "demo_tenant";
const deletedFileGraceArg = process.argv.find((arg) => arg.startsWith("--deleted-file-grace-days="));
const deletedStoredFileObjectGraceDays = (() => {
  if (!deletedFileGraceArg) return undefined;
  const value = Number(deletedFileGraceArg.split("=")[1]);
  if (!Number.isInteger(value) || value < 1 || value > 365) {
    throw new Error("--deleted-file-grace-days must be an integer between 1 and 365");
  }
  return value;
})();

const service = new PrivacyComplianceService();

try {
  const result =
    mode === "run"
      ? await service.runRetention({ tenantId, confirmation: "RUN_RETENTION", userId: null, deletedStoredFileObjectGraceDays })
      : await service.previewRetention({ tenantId, deletedStoredFileObjectGraceDays });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await prisma.$disconnect();
}
