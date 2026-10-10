import { PrivacyComplianceService } from "../application/services/privacy-compliance-service.js";
import { prisma } from "../infrastructure/database/prisma/client.js";

const mode = process.argv.includes("--run") ? "run" : "dry-run";
const globalMode = process.argv.includes("--global");
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

const optionalDaysArg = (name: string) => {
  const arg = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (!arg) return undefined;
  const value = Number(arg.split("=")[1]);
  if (!Number.isInteger(value) || value < 1 || value > 3650) {
    throw new Error(`--${name} must be an integer between 1 and 3650`);
  }
  return value;
};

try {
  const globalPolicy = {
    websiteEventRetentionDays: optionalDaysArg("website-event-days"),
    demoLeadRetentionDays: optionalDaysArg("demo-lead-days"),
    emailQueuePayloadRetentionDays: optionalDaysArg("email-queue-payload-days")
  };
  const result = globalMode
    ? mode === "run"
      ? await service.runGlobalRetention({ confirmation: "RUN_GLOBAL_RETENTION", ...globalPolicy })
      : await service.previewGlobalRetention(globalPolicy)
    : mode === "run"
      ? await service.runRetention({ tenantId, confirmation: "RUN_RETENTION", userId: null, deletedStoredFileObjectGraceDays })
      : await service.previewRetention({ tenantId, deletedStoredFileObjectGraceDays });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await prisma.$disconnect();
}
