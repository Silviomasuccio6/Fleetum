import { PrivacyComplianceService } from "../application/services/privacy-compliance-service.js";
import { prisma } from "../infrastructure/database/prisma/client.js";

const mode = process.argv.includes("--run") ? "run" : "dry-run";
const tenantArg = process.argv.find((arg) => arg.startsWith("--tenant="));
const tenantId = tenantArg?.split("=")[1] || process.env.PRIVACY_RETENTION_TENANT_ID || "demo_tenant";

const service = new PrivacyComplianceService();

try {
  const result =
    mode === "run"
      ? await service.runRetention({ tenantId, confirmation: "RUN_RETENTION", userId: null })
      : await service.previewRetention({ tenantId });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await prisma.$disconnect();
}
