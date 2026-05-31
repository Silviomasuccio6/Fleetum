import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bearer,
  createExpiredTenantAccessToken,
  createPlatformToken,
  createTamperedTenantAccessToken,
  createTenantAccessToken,
  tenantA,
  tenantB,
  TEST_JWT_SECRET,
  TEST_PLATFORM_JWT_SECRET
} from "../helpers/auth.js";

const state = vi.hoisted(() => {
  const tenants = new Map<string, { id: string; isActive: boolean }>();
  const vehicles = new Map<string, Record<string, any>>();
  const bookings = new Map<string, Record<string, any>>();
  const customers = new Map<string, Record<string, any>>();
  const calls = {
    vehicleFindMany: [] as any[],
    vehicleFindFirst: [] as any[],
    vehicleUpdateMany: [] as any[],
    rentalBookingFindFirst: [] as any[],
    rentalCustomerFindFirst: [] as any[],
    rentalCustomerUpdate: [] as any[]
  };

  const matchesTenantRecord = (record: Record<string, any>, where: Record<string, any> = {}) => {
    if (where.tenantId !== undefined && record.tenantId !== where.tenantId) return false;
    if (where.id !== undefined && record.id !== where.id) return false;
    if (where.deletedAt === null && record.deletedAt !== null) return false;
    if (where.isActive !== undefined && record.isActive !== where.isActive) return false;
    return true;
  };

  const prisma = {
    tenant: {
      findUnique: vi.fn(async ({ where }: any) => {
        const tenant = tenants.get(where.id);
        return tenant ? { isActive: tenant.isActive } : null;
      })
    },
    tenantSubscription: {
      findUnique: vi.fn(async () => null)
    },
    auditLog: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => [])
    },
    vehicle: {
      count: vi.fn(async ({ where }: any) => [...vehicles.values()].filter((vehicle) => matchesTenantRecord(vehicle, where)).length),
      findMany: vi.fn(async (args: any) => {
        calls.vehicleFindMany.push(args);
        return [...vehicles.values()].filter((vehicle) => matchesTenantRecord(vehicle, args.where));
      }),
      findFirst: vi.fn(async (args: any) => {
        calls.vehicleFindFirst.push(args);
        return [...vehicles.values()].find((vehicle) => matchesTenantRecord(vehicle, args.where)) ?? null;
      }),
      updateMany: vi.fn(async (args: any) => {
        calls.vehicleUpdateMany.push(args);
        let count = 0;
        for (const [id, vehicle] of vehicles) {
          if (!matchesTenantRecord(vehicle, args.where)) continue;
          vehicles.set(id, { ...vehicle, ...args.data });
          count += 1;
        }
        return { count };
      })
    },
    rentalBooking: {
      findFirst: vi.fn(async (args: any) => {
        calls.rentalBookingFindFirst.push(args);
        return [...bookings.values()].find((booking) => matchesTenantRecord(booking, args.where)) ?? null;
      }),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      update: vi.fn(async ({ where, data }: any) => {
        const booking = bookings.get(where.id);
        if (!booking) return null;
        const updated = { ...booking, ...data };
        bookings.set(where.id, updated);
        return updated;
      })
    },
    rentalCustomer: {
      findFirst: vi.fn(async (args: any) => {
        calls.rentalCustomerFindFirst.push(args);
        return [...customers.values()].find((customer) => matchesTenantRecord(customer, args.where)) ?? null;
      }),
      update: vi.fn(async (args: any) => {
        calls.rentalCustomerUpdate.push(args);
        const customer = customers.get(args.where.id);
        if (!customer) return null;
        const updated = { ...customer, ...args.data };
        customers.set(args.where.id, updated);
        return updated;
      }),
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => [])
    },
    rentalBookingNote: {
      create: vi.fn(async () => ({}))
    },
    $queryRaw: vi.fn(async () => [{ ok: 1 }]),
    $disconnect: vi.fn(async () => undefined)
  };

  return { tenants, vehicles, bookings, customers, calls, prisma };
});

vi.mock("../../src/infrastructure/database/prisma/client.js", () => ({ prisma: state.prisma }));

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = TEST_JWT_SECRET;
process.env.PLATFORM_JWT_SECRET = TEST_PLATFORM_JWT_SECRET;
process.env.PLATFORM_ADMIN_EMAIL = "platform@example.test";
process.env.PLATFORM_ADMIN_PASSWORD = "platform-admin-password-0000";
process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/fleetum_test?schema=public";
process.env.PLATFORM_ALLOWED_IPS = "127.0.0.1,::1";
process.env.EMAIL_PROVIDER = "smtp";
process.env.SMTP_HOST = "localhost";
process.env.SMTP_USER = "smtp-user";
process.env.SMTP_PASS = "smtp-pass";
process.env.SMTP_FROM = "Fleetum <test@example.local>";

let tenantApp: import("express").Express;
let platformApp: import("express").Express;

const vehicleA = {
  id: "vehicle_a",
  tenantId: tenantA.tenantId,
  siteId: "site_a",
  plate: "FTA001AA",
  brand: "Fiat",
  model: "Panda",
  isActive: true,
  deletedAt: null,
  site: { id: "site_a", name: "Roma Centro", city: "Roma" },
  photos: [],
  booklet: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z")
};

const vehicleB = {
  id: "vehicle_b",
  tenantId: tenantB.tenantId,
  siteId: "site_b",
  plate: "FTB001BB",
  brand: "BMW",
  model: "X1",
  isActive: true,
  deletedAt: null,
  site: { id: "site_b", name: "Milano Centro", city: "Milano" },
  photos: [],
  booklet: null,
  createdAt: new Date("2026-01-02T00:00:00.000Z")
};

const bookingB = {
  id: "booking_b",
  tenantId: tenantB.tenantId,
  vehicleId: vehicleB.id,
  customerId: "customer_b",
  code: "BK-B-001",
  status: "CONFIRMED",
  contractStatus: "READY",
  cargosStatus: "NOT_REQUIRED",
  customerName: "Cliente Tenant B",
  pickupAt: new Date("2026-06-01T08:00:00.000Z"),
  returnAt: new Date("2026-06-05T18:00:00.000Z"),
  deletedAt: null,
  vehicle: vehicleB,
  customer: null,
  notes: [],
  attachments: [],
  pricingSnapshot: null
};

const customerB = {
  id: "customer_b",
  tenantId: tenantB.tenantId,
  customerType: "PERSONA_FISICA",
  firstName: "Cliente",
  lastName: "TenantB",
  drivingLicenseNumber: "B000001",
  email: "cliente.tenantb@example.test",
  phone: "+3900000000",
  deletedAt: null
};

const auth = (tenantId = tenantA.tenantId) => bearer(createTenantAccessToken({ tenantId }));

beforeAll(async () => {
  const apps = await import("../../src/app.js");
  tenantApp = apps.createApp();
  platformApp = apps.createPlatformApp();
});

beforeEach(() => {
  vi.clearAllMocks();
  state.tenants.clear();
  state.vehicles.clear();
  state.bookings.clear();
  state.customers.clear();
  Object.values(state.calls).forEach((callList) => callList.splice(0));

  state.tenants.set(tenantA.tenantId, { id: tenantA.tenantId, isActive: true });
  state.tenants.set(tenantB.tenantId, { id: tenantB.tenantId, isActive: true });
  state.vehicles.set(vehicleA.id, { ...vehicleA });
  state.vehicles.set(vehicleB.id, { ...vehicleB });
  state.bookings.set(bookingB.id, { ...bookingB });
  state.customers.set(customerB.id, { ...customerB });
});

describe("tenant API cross-tenant isolation", () => {
  it("filters GET /api/master-data/vehicles by the authenticated tenant and never returns another tenant's vehicles", async () => {
    const response = await request(tenantApp)
      .get("/api/master-data/vehicles")
      .set("Authorization", auth(tenantA.tenantId))
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].id).toBe(vehicleA.id);
    expect(response.body.data.map((vehicle: any) => vehicle.id)).not.toContain(vehicleB.id);
    expect(state.calls.vehicleFindMany[0].where).toMatchObject({ tenantId: tenantA.tenantId, deletedAt: null });
  });

  it("returns 404 for GET /api/rental-bookings/:id when tenant A requests tenant B booking", async () => {
    const response = await request(tenantApp)
      .get(`/api/rental-bookings/${bookingB.id}`)
      .set("Authorization", auth(tenantA.tenantId))
      .expect(404);

    expect(response.body.error).toBe("BOOKING_NOT_FOUND");
    expect(state.calls.rentalBookingFindFirst[0].where).toMatchObject({
      tenantId: tenantA.tenantId,
      id: bookingB.id,
      deletedAt: null
    });
  });

  it("blocks PATCH /api/master-data/vehicles/:id when tenant A tries to modify tenant B vehicle", async () => {
    const response = await request(tenantApp)
      .patch(`/api/master-data/vehicles/${vehicleB.id}`)
      .set("Authorization", auth(tenantA.tenantId))
      .send({ brand: "Hacked" })
      .expect(404);

    expect(response.body.error).toBe("NOT_FOUND");
    expect(state.calls.vehicleUpdateMany).toHaveLength(0);
    expect(state.vehicles.get(vehicleB.id)?.brand).toBe("BMW");
    expect(state.calls.vehicleFindFirst[0].where).toMatchObject({
      id: vehicleB.id,
      tenantId: tenantA.tenantId,
      deletedAt: null
    });
  });

  it("blocks PATCH /api/rental-customers/:customerId when tenant A tries to modify tenant B customer", async () => {
    const response = await request(tenantApp)
      .patch(`/api/rental-customers/${customerB.id}`)
      .set("Authorization", auth(tenantA.tenantId))
      .send({ firstName: "Hacked" })
      .expect(404);

    expect(response.body.error).toBe("CUSTOMER_NOT_FOUND");
    expect(state.calls.rentalCustomerUpdate).toHaveLength(0);
    expect(state.customers.get(customerB.id)?.firstName).toBe("Cliente");
    expect(state.calls.rentalCustomerFindFirst[0].where).toMatchObject({
      tenantId: tenantA.tenantId,
      id: customerB.id,
      deletedAt: null
    });
  });
});

describe("tenant API authentication failures", () => {
  it("returns 401 when JWT is missing", async () => {
    const response = await request(tenantApp).get("/api/master-data/vehicles").expect(401);
    expect(response.body.error).toBe("UNAUTHORIZED");
  });

  it("returns 401 when JWT is expired", async () => {
    const response = await request(tenantApp)
      .get("/api/master-data/vehicles")
      .set("Authorization", bearer(createExpiredTenantAccessToken()))
      .expect(401);
    expect(response.body.error).toBe("UNAUTHORIZED");
  });

  it("returns 401 when JWT signature is tampered", async () => {
    const response = await request(tenantApp)
      .get("/api/master-data/vehicles")
      .set("Authorization", bearer(createTamperedTenantAccessToken()))
      .expect(401);
    expect(response.body.error).toBe("UNAUTHORIZED");
  });

  it("returns 403 when JWT is valid but tenantId does not exist", async () => {
    const missingTenantId = "tenant_missing";
    const response = await request(tenantApp)
      .get("/api/master-data/vehicles")
      .set("Authorization", auth(missingTenantId))
      .expect(403);

    expect(response.body.error).toBe("TENANT_INACTIVE");
    expect(state.prisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: missingTenantId },
      select: { isActive: true }
    });
  });
});

describe("platform API rejects tenant credentials", () => {
  it("returns 403 when a normal tenant JWT is used on /platform-api/*", async () => {
    const response = await request(platformApp)
      .get("/platform-api/overview")
      .set("Authorization", auth(tenantA.tenantId))
      .expect(403);

    expect(response.body.error).toBe("FORBIDDEN");
  });

  it("returns 401 when platform protected route is missing the platform auth header", async () => {
    const response = await request(platformApp).get("/platform-api/overview").expect(401);
    expect(response.body.error).toBe("UNAUTHORIZED");
  });

  it("accepts a valid platform token at middleware level", async () => {
    const { requirePlatformAuth } = await import("../../src/interfaces/http/middlewares/platform-auth.js");
    const req: any = { headers: { authorization: bearer(createPlatformToken()) } };
    const next = vi.fn();

    requirePlatformAuth(req, {} as any, next);

    expect(req.auth).toMatchObject({
      platformAdmin: true,
      tokenType: "platform",
      userId: "platform_admin_user"
    });
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects a platform-signed token without platform admin claims", async () => {
    const { requirePlatformAuth } = await import("../../src/interfaces/http/middlewares/platform-auth.js");
    const invalidPlatformPayload = jwt.sign(
      {
        userId: "not_platform_admin",
        tenantId: "platform",
        roles: ["USER"],
        permissions: [],
        sessionId: "not_platform_session",
        tokenType: "access"
      },
      TEST_PLATFORM_JWT_SECRET,
      { expiresIn: "15m" }
    );
    const req: any = { headers: { authorization: bearer(invalidPlatformPayload) } };

    expect(() => requirePlatformAuth(req, {} as any, vi.fn())).toThrow("Accesso platform negato");
  });
});
