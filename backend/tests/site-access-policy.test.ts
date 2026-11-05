import test from "node:test";
import assert from "node:assert/strict";
import { resolveSiteAccess, assertSiteAccess, narrowSiteAccess, bookingSiteWhere, siteResourceWhere } from "../src/domain/policies/site-access.js";
import { currentBookingSiteWhere, currentSiteWhere, currentSiteAccess, runWithSiteAccess } from "../src/infrastructure/auth/site-access-context.js";

const site = { id: "roma", tenantId: "company-a", isActive: true, deletedAt: null };
const operator = () => resolveSiteAccess({ tenantId: "company-a", roles: ["OPERATOR"], assignedSite: site });
test("operator scope comes only from an active same-company assignment", () => {
  assert.deepEqual(operator().siteIds, ["roma"]);
  for (const assignedSite of [null, { ...site, isActive: false }, { ...site, deletedAt: new Date() }, { ...site, tenantId: "company-b" }]) {
    const scope = resolveSiteAccess({ tenantId: "company-a", roles: ["OPERATOR"], assignedSite });
    assert.equal(scope.allSites, false); assert.deepEqual(scope.siteIds, []);
  }
});
test("manager and admin see all sites only inside their company", () => {
  for (const role of ["ADMIN", "MANAGER"]) {
    const scope = resolveSiteAccess({ tenantId: "company-a", roles: [role] });
    assert.equal(scope.allSites, true);
    assert.doesNotThrow(() => assertSiteAccess(scope, { tenantId: "company-a", siteIds: ["milano"] }));
    assert.throws(() => assertSiteAccess(scope, { tenantId: "company-b", siteIds: ["milano"] }), (e: any) => e.statusCode === 404);
  }
});
test("an operator cannot request a different site or promote itself to an aggregate view", () => {
  assert.throws(() => narrowSiteAccess(operator(), "milano"), (e: any) => e.statusCode === 404);
  const scope = narrowSiteAccess(operator(), "roma"); assert.equal(scope.allSites, false);
});
test("manager narrowing does not mutate the source aggregate scope", () => {
  const all = resolveSiteAccess({ tenantId: "company-a", roles: ["MANAGER"] });
  const single = narrowSiteAccess(all, "roma");
  assert.equal(all.allSites, true); assert.equal(single.allSites, false);
  assert.equal(single.canViewAllSites, true); assert.deepEqual(single.siteIds, ["roma"]);
});
test("a booking can be consulted by any participating site, never by another company", () => {
  assert.doesNotThrow(() => assertSiteAccess(operator(), { tenantId: "company-a", siteIds: ["milano", "roma"] }));
  assert.throws(() => assertSiteAccess(operator(), { tenantId: "company-a", siteIds: ["milano", "napoli"] }));
  assert.throws(() => assertSiteAccess(operator(), { tenantId: "company-b", siteIds: ["roma"] }));
});
test("unassigned users produce empty database filters rather than company-wide access", () => {
  const scope = resolveSiteAccess({ tenantId: "company-a", roles: ["VIEWER"] });
  assert.deepEqual(siteResourceWhere(scope), { tenantId: "company-a", siteId: { in: [] } });
  const where = bookingSiteWhere(scope);
  assert.equal(where.tenantId, "company-a"); assert.equal(where.OR?.length, 3);
  assert.ok(where.OR?.every(value => Object.values(value).every(v => !v || v.in.length === 0)));
});
test("request scope survives awaits without leaking between concurrent requests", async () => {
  const cases = Array.from({ length: 30 }, (_, i) => ({ ...operator(), tenantId: `company-${i}`, siteIds: [`site-${i}`] }));
  await Promise.all(cases.map(scope => runWithSiteAccess(scope, async () => {
    await Promise.resolve();
    assert.equal(currentSiteAccess()?.tenantId, scope.tenantId);
    assert.deepEqual(currentSiteWhere(scope.tenantId), { tenantId: scope.tenantId, siteId: { in: scope.siteIds } });
    assert.equal(currentBookingSiteWhere(scope.tenantId).tenantId, scope.tenantId);
    assert.throws(() => currentSiteWhere("foreign"), (e: any) => e.statusCode === 403);
  })));
  assert.equal(currentSiteAccess(), undefined);
});
