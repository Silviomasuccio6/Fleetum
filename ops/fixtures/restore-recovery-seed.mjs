import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Extends the historical compatibility fixture; never uses customer data.
const prisma = new PrismaClient();
const uploadTree = process.env.SYNTHETIC_UPLOAD_TREE;
if (!uploadTree || !path.isAbsolute(uploadTree)) throw new Error("Synthetic upload tree must be task-owned and absolute");
try {
  const tenant = await prisma.tenant.create({ data: { id: "restore_tenant_b", name: "Synthetic restore tenant B" } });
  const user = await prisma.user.create({ data: {
    id: "restore_user_b", tenantId: tenant.id, email: "restore-b@example.invalid",
    passwordHash: await bcrypt.hash(process.env.DEMO_ADMIN_PASSWORD, 12),
    firstName: "Synthetic", lastName: "Restore B", isEmailVerified: true
  } });
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "ADMIN" } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  await prisma.user.create({ data: {
    id: "restore_suspended_user", tenantId: tenant.id, email: "restore-suspended@example.invalid",
    passwordHash: await bcrypt.hash(process.env.DEMO_ADMIN_PASSWORD, 12),
    firstName: "Synthetic", lastName: "Suspended", status: "SUSPENDED", isEmailVerified: true
  } });
  await prisma.refreshSession.create({ data: {
    id: "restore_revoked_session", userId: user.id, tenantId: tenant.id,
    tokenHash: createHash("sha256").update("synthetic revoked refresh fixture").digest("hex"),
    expiresAt: new Date("2026-01-10T10:00:00Z"), revokedAt: new Date("2026-01-09T10:00:00Z")
  } });
  await prisma.emailQueue.create({ data: {
    id: "restore_pending_email", tenantId: tenant.id, type: "SYNTHETIC_RESTORE_ONLY",
    recipient: "restore-pending@example.invalid", subject: "Synthetic pending restore email",
    body: "Synthetic pending payload; never deliver", status: "PENDING"
  } });
  await prisma.tenantSubscription.create({ data: {
    id: "restore_subscription_b", tenantId: tenant.id, provider: "test", plan: "ENTERPRISE",
    billingCycle: "monthly", status: "ACTIVE", seats: 10, priceMonthly: 0
  } });
  await prisma.site.create({ data: { id: "restore_site_b", tenantId: tenant.id, name: "Restore site B", address: "Synthetic address", city: "Roma" } });
  await prisma.vehicle.create({ data: { id: "restore_vehicle_b", tenantId: tenant.id, siteId: "restore_site_b", plate: "RESTOREB", brand: "Synthetic", model: "Tenant B" } });
  await prisma.vehicle.update({ where: { id: "compat_vehicle" }, data: { purchasePrice: 1234.56, monthlyFixedCost: 12.34 } });
  await prisma.rentalBooking.update({ where: { id: "compat_booking" }, data: { expectedTotal: 240.12 } });

  for (const [suffix, tenantId, vehicleId] of [["a", "demo_tenant", "compat_vehicle"], ["b", tenant.id, "restore_vehicle_b"]]) {
    // Historical storage keys included the relative upload-directory prefix.
    // Preserve that key representation through migration and restore.
    const key = `uploads/${tenantId}/vehicle-booklets/restore-${suffix}.pdf`;
    const bytes = Buffer.from(`%PDF-1.4\nSynthetic Fleetum restore booklet ${suffix}\n%%EOF\n`);
    await mkdir(path.dirname(path.join(uploadTree, key)), { recursive: true });
    await writeFile(path.join(uploadTree, key), bytes);
    await prisma.vehicleBooklet.create({ data: {
      id: `restore_booklet_${suffix}`, tenantId, vehicleId, filePath: key,
      fileName: `restore-${suffix}.pdf`, mimeType: "application/pdf", sizeBytes: bytes.length
    } });
    await prisma.storedFileObject.create({ data: {
      id: `restore_file_${suffix}`, tenantId, provider: "local", bucket: "local", storageKey: key,
      originalName: `restore-${suffix}.pdf`, mimeType: "application/pdf", sizeBytes: bytes.length,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      resourceType: "VehicleBooklet", resourceId: `restore_booklet_${suffix}`, visibility: "private"
    } });
  }
} finally { await prisma.$disconnect(); }
