import { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/app-error.js";
import { assertSiteAccess } from "../../domain/policies/site-access.js";
import { siteAccessForTenant } from "../../infrastructure/auth/site-access-context.js";

type SitePatch = { pickupSiteId?: string; returnSiteId?: string };

// Call inside the booking mutation transaction after locking the vehicle. Site
// locks prevent deactivation/deletion between validation and the committed link.
const lockActiveSites = async (tx: Prisma.TransactionClient, tenantId: string, ids: string[]) => {
  const unique = [...new Set(ids)].sort();
  if (!unique.length) return;
  const sites = await tx.$queryRaw<Array<{ id: string; isActive: boolean; deletedAt: Date | null }>>`
    SELECT "id", "isActive", "deletedAt" FROM "Site"
    WHERE "tenantId" = ${tenantId} AND "id" IN (${Prisma.join(unique)}) ORDER BY "id" FOR SHARE
  `;
  if (sites.length !== unique.length || sites.some(site => !site.isActive || site.deletedAt)) {
    throw new AppError("Sede non disponibile", 404, "NOT_FOUND");
  }
};

export const captureBookingSites = async (
  tx: Prisma.TransactionClient, tenantId: string, vehicleSiteId: string, input: SitePatch
) => {
  const pickupSiteId = input.pickupSiteId ?? vehicleSiteId;
  const returnSiteId = input.returnSiteId ?? pickupSiteId;
  const scope = siteAccessForTenant(tenantId);
  if (scope) {
    assertSiteAccess(scope, { tenantId, siteIds: [vehicleSiteId] });
    assertSiteAccess(scope, { tenantId, siteIds: [pickupSiteId] });
  }
  // Destination can be a different branch: this is a deliberate handover,
  // never permission to read its unrelated vehicles or bookings.
  await lockActiveSites(tx, tenantId, [vehicleSiteId, pickupSiteId, returnSiteId]);
  return { siteId: vehicleSiteId, pickupSiteId, returnSiteId };
};

export const validateBookingSiteChanges = async (
  tx: Prisma.TransactionClient, tenantId: string, input: SitePatch,
  current: { siteId: string | null; pickupSiteId: string | null; returnSiteId: string | null }
) => {
  const scope = siteAccessForTenant(tenantId);
  if (scope) assertSiteAccess(scope, { tenantId, siteIds: [current.siteId, current.pickupSiteId, current.returnSiteId] });
  const changedIds: string[] = [];
  if (input.pickupSiteId !== undefined && input.pickupSiteId !== current.pickupSiteId) {
    if (scope) assertSiteAccess(scope, { tenantId, siteIds: [input.pickupSiteId] });
    changedIds.push(input.pickupSiteId);
  }
  if (input.returnSiteId !== undefined && input.returnSiteId !== current.returnSiteId) changedIds.push(input.returnSiteId);
  await lockActiveSites(tx, tenantId, changedIds);
  // Responsible site is intentionally absent: vehicle reassignment must not
  // reclassify historical ownership. Legacy nulls need an explicit manager flow.
  return {
    ...(input.pickupSiteId !== undefined ? { pickupSiteId: input.pickupSiteId } : {}),
    ...(input.returnSiteId !== undefined ? { returnSiteId: input.returnSiteId } : {})
  };
};
