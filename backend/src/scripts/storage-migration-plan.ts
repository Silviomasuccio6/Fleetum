import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../infrastructure/database/prisma/client.js";
import { env } from "../shared/config/env.js";

type FileRef = {
  model: string;
  tenantId: string | null;
  resourceId: string;
  storageKey: string;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
};

const outputJson = process.argv.includes("--json");

const localPath = (key: string) => path.resolve(process.cwd(), key);

const exists = async (key: string) => {
  try {
    const stat = await fs.stat(localPath(key));
    return { exists: true, sizeBytes: stat.size };
  } catch {
    return { exists: false, sizeBytes: null };
  }
};

const main = async () => {
  const refs: FileRef[] = [];

  const maintenance = await prisma.vehicleMaintenanceAttachment.findMany({
    select: { id: true, tenantId: true, filePath: true, fileName: true, mimeType: true, sizeBytes: true }
  });
  refs.push(...maintenance.map((x) => ({ model: "VehicleMaintenanceAttachment", tenantId: x.tenantId, resourceId: x.id, storageKey: x.filePath, fileName: x.fileName, mimeType: x.mimeType, sizeBytes: x.sizeBytes })));

  const booklets = await prisma.vehicleBooklet.findMany({
    select: { id: true, tenantId: true, filePath: true, fileName: true, mimeType: true, sizeBytes: true }
  });
  refs.push(...booklets.map((x) => ({ model: "VehicleBooklet", tenantId: x.tenantId, resourceId: x.id, storageKey: x.filePath, fileName: x.fileName, mimeType: x.mimeType, sizeBytes: x.sizeBytes })));

  const customers = await prisma.rentalCustomerAttachment.findMany({
    select: { id: true, tenantId: true, filePath: true, fileName: true, mimeType: true, sizeBytes: true }
  });
  refs.push(...customers.map((x) => ({ model: "RentalCustomerAttachment", tenantId: x.tenantId, resourceId: x.id, storageKey: x.filePath, fileName: x.fileName, mimeType: x.mimeType, sizeBytes: x.sizeBytes })));

  const vehiclePhotos = await prisma.vehiclePhoto.findMany({
    select: { id: true, filePath: true, fileName: true, mimeType: true, sizeBytes: true, vehicle: { select: { tenantId: true } } }
  });
  refs.push(...vehiclePhotos.map((x) => ({ model: "VehiclePhoto", tenantId: x.vehicle.tenantId, resourceId: x.id, storageKey: x.filePath, fileName: x.fileName, mimeType: x.mimeType, sizeBytes: x.sizeBytes })));

  const stoppagePhotos = await prisma.stoppagePhoto.findMany({
    select: { id: true, filePath: true, fileName: true, mimeType: true, sizeBytes: true, stoppage: { select: { tenantId: true } } }
  });
  refs.push(...stoppagePhotos.map((x) => ({ model: "StoppagePhoto", tenantId: x.stoppage.tenantId, resourceId: x.id, storageKey: x.filePath, fileName: x.fileName, mimeType: x.mimeType, sizeBytes: x.sizeBytes })));

  const logos = await prisma.tenantBranding.findMany({
    where: { logoFilePath: { not: null } },
    select: { tenantId: true, logoFilePath: true, logoFileName: true, logoMimeType: true }
  });
  refs.push(...logos.map((x) => ({ model: "TenantBranding", tenantId: x.tenantId, resourceId: x.tenantId, storageKey: x.logoFilePath!, fileName: x.logoFileName, mimeType: x.logoMimeType })));

  const templates = await prisma.contractTemplate.findMany({
    where: { logoFilePath: { not: null } },
    select: { id: true, tenantId: true, logoFilePath: true, logoFileName: true, logoMimeType: true }
  });
  refs.push(...templates.map((x) => ({ model: "ContractTemplate", tenantId: x.tenantId, resourceId: x.id, storageKey: x.logoFilePath!, fileName: x.logoFileName, mimeType: x.logoMimeType })));

  const inspected = await Promise.all(refs.map(async (ref) => ({ ...ref, ...(await exists(ref.storageKey)) })));
  const missing = inspected.filter((x) => !x.exists);
  const totalBytes = inspected.reduce((acc, x) => acc + (x.sizeBytes ?? 0), 0);
  const summary = {
    uploadDir: env.UPLOAD_DIR,
    storageProvider: env.STORAGE_PROVIDER,
    totalReferences: refs.length,
    missingFiles: missing.length,
    totalBytes,
    byModel: inspected.reduce<Record<string, number>>((acc, x) => {
      acc[x.model] = (acc[x.model] ?? 0) + 1;
      return acc;
    }, {}),
    migrationOrder: [
      "1. Run this script in production with current STORAGE_PROVIDER=local and save JSON output.",
      "2. Configure S3/R2/B2 env vars in staging and run application smoke tests.",
      "3. Copy local files to bucket preserving storageKey paths.",
      "4. Backfill StoredFileObject rows after copy or on first re-upload/download cycle.",
      "5. Switch STORAGE_PROVIDER=s3 only after verifying signed/auth downloads.",
      "6. Keep local /opt/fleetum/uploads backup until restore drill passes."
    ],
    missing
  };

  if (outputJson) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`Fleetum storage migration plan`);
    console.log(`Upload dir: ${summary.uploadDir}`);
    console.log(`Current provider: ${summary.storageProvider}`);
    console.log(`Referenced files: ${summary.totalReferences}`);
    console.log(`Missing files: ${summary.missingFiles}`);
    console.log(`Total bytes declared: ${summary.totalBytes}`);
    console.log(`By model: ${JSON.stringify(summary.byModel)}`);
    if (missing.length > 0) console.log(`Missing sample: ${JSON.stringify(missing.slice(0, 10), null, 2)}`);
  }

  await prisma.$disconnect();
};

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
