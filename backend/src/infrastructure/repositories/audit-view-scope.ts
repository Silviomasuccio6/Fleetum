import { Prisma } from "@prisma/client";
import { siteAccessForTenant } from "../auth/site-access-context.js";

// AuditLog has polymorphic, sometimes historical pointers rather than FKs.
// Resolve only known pointers in SQL, before count/order/pagination. Never
// infer authority from the event actor or a JSON copy of a former resource.
export const auditViewScope = (tenantId: string) => {
  const scope = siteAccessForTenant(tenantId);
  const all = !scope || scope.allSites;
  const sites = scope?.siteIds ?? [];
  const site = (column: Prisma.Sql) => all ? Prisma.sql`TRUE`
    : sites.length ? Prisma.sql`${column} IN (${Prisma.join(sites)})` : Prisma.sql`FALSE`;
  const vehicle = (id: Prisma.Sql) => Prisma.sql`EXISTS (
    SELECT 1 FROM "Vehicle" v JOIN "Site" vs ON vs."id" = v."siteId" AND vs."tenantId" = ${tenantId}
    WHERE v."id" = ${id} AND v."tenantId" = ${tenantId} AND ${site(Prisma.sql`v."siteId"`)}
  )`;
  const booking = (id: Prisma.Sql) => Prisma.sql`EXISTS (
    SELECT 1 FROM "RentalBooking" b
    JOIN "Vehicle" bv ON bv."id" = b."vehicleId" AND bv."tenantId" = ${tenantId}
    JOIN "Site" bvs ON bvs."id" = bv."siteId" AND bvs."tenantId" = ${tenantId}
    WHERE b."id" = ${id} AND b."tenantId" = ${tenantId}
      AND (b."customerId" IS NULL OR EXISTS (SELECT 1 FROM "RentalCustomer" bc WHERE bc."id" = b."customerId" AND bc."tenantId" = ${tenantId}))
      AND (${site(Prisma.sql`b."siteId"`)} OR ${site(Prisma.sql`b."pickupSiteId"`)} OR ${site(Prisma.sql`b."returnSiteId"`)})
  )`;
  const stoppage = (id: Prisma.Sql) => Prisma.sql`EXISTS (
    SELECT 1 FROM "Stoppage" s
    JOIN "Site" ss ON ss."id" = s."siteId" AND ss."tenantId" = ${tenantId}
    JOIN "Vehicle" sv ON sv."id" = s."vehicleId" AND sv."tenantId" = ${tenantId}
    JOIN "Site" svs ON svs."id" = sv."siteId" AND svs."tenantId" = ${tenantId}
    JOIN "Workshop" sw ON sw."id" = s."workshopId" AND sw."tenantId" = ${tenantId}
    JOIN "User" sc ON sc."id" = s."createdByUserId" AND sc."tenantId" = ${tenantId}
    WHERE s."id" = ${id} AND s."tenantId" = ${tenantId} AND ${site(Prisma.sql`s."siteId"`)}
      AND (s."assignedToUserId" IS NULL OR EXISTS (SELECT 1 FROM "User" sa WHERE sa."id" = s."assignedToUserId" AND sa."tenantId" = ${tenantId}))
  )`;
  const customer = (id: Prisma.Sql) => Prisma.sql`EXISTS (
    SELECT 1 FROM "RentalCustomer" c WHERE c."id" = ${id} AND c."tenantId" = ${tenantId}
    AND ${all || sites.length > 0}
  )`;
  const user = (id: Prisma.Sql) => Prisma.sql`EXISTS (
    SELECT 1 FROM "User" u WHERE u."id" = ${id} AND u."tenantId" = ${tenantId}
    AND (${all} OR (${sites.length > 0} AND (
      EXISTS (SELECT 1 FROM "Site" us WHERE us."id" = u."assignedSiteId" AND us."tenantId" = ${tenantId}
        AND us."isActive" = TRUE AND us."deletedAt" IS NULL AND ${site(Prisma.sql`us."id"`)})
      OR EXISTS (SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r."id" = ur."roleId"
        WHERE ur."userId" = u."id" AND r."key" IN ('ADMIN','MANAGER'))
    )))
  )`;
  const maintenance = (id: Prisma.Sql) => Prisma.sql`EXISTS (
    SELECT 1 FROM "VehicleMaintenance" m WHERE m."id" = ${id} AND m."tenantId" = ${tenantId}
      AND ${vehicle(Prisma.sql`m."vehicleId"`)}
  )`;
  const target = Prisma.sql`a."resourceId"`;
  const attachment = Prisma.sql`EXISTS (
    SELECT 1 FROM "RentalCustomerAttachment" ca WHERE ca."id" = ${target} AND ca."tenantId" = ${tenantId}
      AND ${customer(Prisma.sql`ca."customerId"`)}
      AND (ca."bookingId" IS NULL OR ${booking(Prisma.sql`ca."bookingId"`)})
  )`;
  const cases: Array<[string,Prisma.Sql]> = [
    ["Vehicle",vehicle(target)], ["RentalBooking",booking(target)], ["Stoppage",stoppage(target)],
    ["RentalCustomer",customer(target)], ["user",user(target)],
    ["Site",Prisma.sql`EXISTS (SELECT 1 FROM "Site" st WHERE st."id" = ${target} AND st."tenantId" = ${tenantId} AND ${site(Prisma.sql`st."id"`)})`],
    ["BookingContract",Prisma.sql`EXISTS (SELECT 1 FROM "BookingContract" ct WHERE ct."id" = ${target} AND ct."tenantId" = ${tenantId} AND ${booking(Prisma.sql`ct."bookingId"`)})`],
    ["VehicleMaintenance",maintenance(target)],
    ["StoppagePhoto",Prisma.sql`CASE WHEN a."action" = 'DOCUMENT_UPLOAD' THEN ${stoppage(target)} ELSE EXISTS (
      SELECT 1 FROM "StoppagePhoto" sp WHERE sp."id" = ${target} AND ${stoppage(Prisma.sql`sp."stoppageId"`)}
    ) END`],
    ["VehiclePhoto",Prisma.sql`CASE WHEN a."action" = 'DOCUMENT_UPLOAD' THEN ${vehicle(target)} ELSE EXISTS (
      SELECT 1 FROM "VehiclePhoto" vp WHERE vp."id" = ${target} AND ${vehicle(Prisma.sql`vp."vehicleId"`)}
    ) END`],
    // Booklet uploads already store the child ID; the other upload types use
    // the parent. Keep those conventions explicit instead of guessing by ID.
    ["VehicleBooklet",Prisma.sql`EXISTS (SELECT 1 FROM "VehicleBooklet" vb WHERE vb."id" = ${target} AND vb."tenantId" = ${tenantId} AND ${vehicle(Prisma.sql`vb."vehicleId"`)})`],
    ["VehicleMaintenanceAttachment",Prisma.sql`CASE WHEN a."action" = 'DOCUMENT_UPLOAD' THEN ${maintenance(target)} ELSE EXISTS (
      SELECT 1 FROM "VehicleMaintenanceAttachment" ma WHERE ma."id" = ${target} AND ma."tenantId" = ${tenantId} AND ${maintenance(Prisma.sql`ma."maintenanceId"`)}
    ) END`],
    ["RentalCustomerAttachment",Prisma.sql`CASE WHEN a."action" = 'DOCUMENT_UPLOAD' THEN ${customer(target)} ELSE ${attachment} END`]
  ];
  const known = Prisma.sql`a."resource" IN (${Prisma.join(cases.map(([name])=>name))})`;
  const visible = Prisma.sql`CASE a."resource" ${Prisma.join(cases.map(([name,condition])=>Prisma.sql`WHEN ${name} THEN ${condition}`)," ")} ELSE ${all} END`;
  return {
    where: Prisma.sql`a."tenantId" = ${tenantId} AND (${visible})`,
    // Public audit is an event index, not an alternate endpoint for credentials,
    // document bodies or before/after business payloads. The original/hash chain
    // and getLatestByAction remain unchanged for internal settings consumers.
    columns: Prisma.sql`a."id", a."tenantId", a."action", a."resource", a."createdAt",
      CASE WHEN ${known} THEN a."resourceId" ELSE NULL END AS "resourceId",
      CASE WHEN ${user(Prisma.sql`a."userId"`)} THEN a."userId" ELSE NULL END AS "userId",
      '{"redacted":true}'::jsonb AS "details"`
  };
};
