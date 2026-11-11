import { Prisma } from "@prisma/client";
import sharp from "sharp";
import { prisma } from "../../infrastructure/database/prisma/client.js";
import { exactMoneyReader } from "../../infrastructure/database/exact-money-reader.js";
import { storageProvider } from "../../infrastructure/storage/storage-provider.js";
import { currentSiteAccess } from "../../infrastructure/auth/site-access-context.js";
import { bookingSiteWhere, resolveSiteAccess } from "../../domain/policies/site-access.js";
import { AppError } from "../../shared/errors/app-error.js";
import { AuthorizationPolicyService } from "./authorization-policy-service.js";
import { buildBookingInvoiceModel, isTenantBrandingKey } from "./booking-invoice-model.js";
import { renderBookingInvoicePdf } from "./booking-invoice-pdf.js";

export class BookingInvoiceService {
  async preview(tenantId: string, userId: string, bookingId: string) {
    const selected = currentSiteAccess();
    if (selected && selected.tenantId !== tenantId) throw new AppError("Accesso non consentito", 403, "FORBIDDEN");
    // The new document has its own complete site guard even while E02's broader
    // operational rollout remains in preparation. No scope is read from input.
    const snapshot = await prisma.$transaction(async tx => {
      const user = await tx.user.findFirst({
        where: { id: userId, tenantId, status: "ACTIVE", deletedAt: null },
        select: {
          tenantId: true, roles: { select: { role: { select: { key: true, permissions: { select: { permission: { select: { key: true } } } } } } } },
          assignedSite: { select: { id: true, tenantId: true, isActive: true, deletedAt: true } }
        }
      });
      if (!user) throw new AppError("Utente non attivo", 401, "UNAUTHORIZED");
      const roles = user.roles.map(row => row.role.key);
      new AuthorizationPolicyService().assertPermissions({ roles, permissions: user.roles.flatMap(row => row.role.permissions.map(p => p.permission.key)) }, ["vehicles:read"]);
      const scope = resolveSiteAccess({ ...user, roles });
      const booking = await tx.rentalBooking.findFirst({
        where: {
          id: bookingId, tenantId, deletedAt: null,
          AND: [bookingSiteWhere(scope), ...(selected ? [bookingSiteWhere(selected)] : [])],
          vehicle: { is: { tenantId, site: { tenantId } } },
          OR: [{ customerId: null }, { customer: { is: { tenantId } } }]
        },
        select: {
          id: true, tenantId: true, code: true, status: true, customerName: true, expectedTotal: true, finalTotal: true,
          pickupAt: true, returnAt: true,
          vehicle: { select: { plate: true, brand: true, model: true } },
          site: { select: { name: true } }, pickupSite: { select: { name: true } }, returnSite: { select: { name: true } },
          customer: { select: { customerType: true, firstName: true, lastName: true, companyName: true,
            companyVatNumber: true, companyTaxCode: true, companyLegalAddress: true, companyCity: true, companyPostalCode: true,
            companyPec: true, companySdi: true, taxCode: true, residenceAddress: true, residenceCity: true, residencePostalCode: true } }
        }
      });
      if (!booking) throw new AppError("Prenotazione non trovata", 404, "BOOKING_NOT_FOUND");
      const [pricing, profile, branding, tenant] = await Promise.all([
        tx.rentalBookingPricingSnapshot.findFirst({ where: { tenantId, bookingId, deletedAt: null } }),
        tx.tenantProfile.findFirst({ where: { tenantId, deletedAt: null } }),
        tx.tenantBranding.findUnique({ where: { tenantId }, select: { logoFilePath: true } }),
        tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } })
      ]);
      const reader = exactMoneyReader.withQuery(async <T>(sql: string, ...values: unknown[]) => tx.$queryRawUnsafe<T>(sql, ...values));
      const exactBooking = await reader.hydrateOne("RentalBooking", booking, { tenantId });
      const exactPricing = pricing ? await reader.hydrateOne("RentalBookingPricingSnapshot", pricing, { tenantId }) : null;
      const key = branding?.logoFilePath;
      let logoKey: string | null = null;
      if (key && isTenantBrandingKey(key, tenantId)) {
        const objects = await tx.storedFileObject.findMany({ where: { storageKey: key, provider: storageProvider.name },
          select: { tenantId: true, resourceType: true, resourceId: true, deletedAt: true, sizeBytes: true } });
        const registered = objects.length > 0 && objects.every(object => object.tenantId === tenantId && !object.deletedAt &&
          object.resourceType === "TenantBranding" && object.resourceId === tenantId && object.sizeBytes <= 2 * 1024 * 1024);
        const legacy = !objects.length && key.startsWith(`uploads/${tenantId}/branding/`);
        if (registered || legacy) logoKey = key;
      }
      return { booking: exactBooking, pricing: exactPricing, profile, tenantName: tenant.name, logoKey, logoConfigured: Boolean(key) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10_000 });
    const model = buildBookingInvoiceModel({ ...snapshot, generatedAt: new Date() });
    let logo: Buffer | null = null;
    if (snapshot.logoKey) {
      try {
        const bytes = await storageProvider.read(snapshot.logoKey);
        const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        if (bytes.length <= 2 * 1024 * 1024 && (png || jpeg)) logo = await sharp(bytes, { limitInputPixels: 4_000_000, failOn: "error" })
          .rotate().resize({ width: 512, height: 256, fit: "inside", withoutEnlargement: true }).png().toBuffer();
      } catch { /* A missing or invalid logo must retain the issuer's text. */ }
    }
    if (snapshot.logoConfigured && !logo) model.warnings.push("Logo aziendale non disponibile: la bozza riporta i dati dell'emittente.");
    return { buffer: await renderBookingInvoicePdf(model, logo), filename: `Bozza_fattura_${model.code.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "noleggio"}.pdf` };
  }
}
