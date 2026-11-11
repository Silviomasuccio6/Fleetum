import type { Prisma } from "@prisma/client";
import { currentBookingSiteWhere, currentSiteWhere, siteAccessForTenant } from "../auth/site-access-context.js";
import { assertSiteAccess } from "../../domain/policies/site-access.js";
import { lockOwnedVehicle, lockVehicleSite, ownedVehicleWhere } from "./vehicle-tenant-scope.js";

// Keep tenant ownership independent from site visibility: a booking's historical
// sites do not follow the current vehicle location. Never use the fleet scope
// for that booking's Vehicle relation.
export const visibleVehicleWhere = (tenantId: string, includeDeleted = false): Prisma.VehicleWhereInput => ({
  ...ownedVehicleWhere(tenantId, includeDeleted), AND: [currentSiteWhere(tenantId)]
});

export const visibleBookingWhere = (tenantId: string, selectedSiteId?: string): Prisma.RentalBookingWhereInput => ({
  tenantId, vehicle: { is: ownedVehicleWhere(tenantId, true) },
  AND: [currentBookingSiteWhere(tenantId), { OR: [{ customerId: null }, { customer: { is: { tenantId } } }] }, ...(selectedSiteId ? [{ OR: [
    { siteId: selectedSiteId }, { pickupSiteId: selectedSiteId }, { returnSiteId: selectedSiteId }
  ] }] : [])]
});

export const visibleCustomerAttachmentWhere = (tenantId: string): Prisma.RentalCustomerAttachmentWhereInput => ({
  tenantId, customer: { is: { tenantId } }, OR: [{ bookingId: null }, { booking: { is: visibleBookingWhere(tenantId) } }]
});

export const assertVisibleSite = (tenantId: string, siteId: string) => {
  const scope = siteAccessForTenant(tenantId);
  if (scope) assertSiteAccess(scope, { tenantId, siteIds: [siteId] });
};

export const lockVisibleVehicleSite = async (
  tx: Prisma.TransactionClient, tenantId: string, siteId: string, requireNonDeleted = false
) => {
  assertVisibleSite(tenantId, siteId);
  await lockVehicleSite(tx, tenantId, siteId, requireNonDeleted);
};

export const lockVisibleVehicle = async (
  tx: Prisma.TransactionClient, tenantId: string, id: string, includeDeleted = false
) => {
  const vehicle = await lockOwnedVehicle(tx, tenantId, id, includeDeleted);
  assertVisibleSite(tenantId, vehicle.siteId);
  return vehicle;
};

// Staff projections follow the selected branch, plus company-wide roles. The
// empty operator scope must not expose an otherwise global staff directory.
export const visibleTeamUserWhere = (tenantId: string): Prisma.UserWhereInput => {
  const scope = siteAccessForTenant(tenantId);
  return { tenantId, ...(scope && !scope.allSites ? {
    AND: scope.siteIds.length ? [{ OR: [
      { assignedSite: { is: { id: { in: scope.siteIds }, tenantId, isActive: true, deletedAt: null } } },
      { roles: { some: { role: { key: { in: ["ADMIN", "MANAGER"] } } } } }
    ] }] : [{ id: { in: [] } }]
  } : {}) };
};
