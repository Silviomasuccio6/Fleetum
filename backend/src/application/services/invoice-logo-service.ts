import sharp from "sharp";
import { prisma } from "../../infrastructure/database/prisma/client.js";
import { storageProvider } from "../../infrastructure/storage/storage-provider.js";
import { isTenantBrandingKey } from "./booking-invoice-model.js";

// Only the tenant's registered branding object (or its confined legacy key)
// may enter a new document. Existing invoices never consult today's branding.
export const readInvoiceCompanyLogo = async (tenantId: string): Promise<Buffer | null> => {
  const branding = await prisma.tenantBranding.findUnique({ where: { tenantId }, select: { logoFilePath: true } });
  const key = branding?.logoFilePath;
  if (!key || !isTenantBrandingKey(key, tenantId)) return null;
  const objects = await prisma.storedFileObject.findMany({ where: { provider: storageProvider.name, storageKey: key } });
  const registered = objects.length > 0 && objects.every(row => row.tenantId === tenantId && !row.deletedAt && row.visibility === "private" &&
    row.resourceType === "TenantBranding" && row.resourceId === tenantId && row.sizeBytes > 0 && row.sizeBytes <= 2 * 1024 * 1024);
  if (!registered && !(objects.length === 0 && key.startsWith(`uploads/${tenantId}/branding/`))) return null;
  try {
    const bytes = await storageProvider.read(key);
    const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (bytes.length > 2 * 1024 * 1024 || !(png || jpeg)) return null;
    return await sharp(bytes, { limitInputPixels: 4_000_000, failOn: "error" }).rotate()
      .resize({ width: 512, height: 256, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  } catch { return null; }
};
