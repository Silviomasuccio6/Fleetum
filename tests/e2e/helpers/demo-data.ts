import { APIRequestContext, expect } from "@playwright/test";
import { csrfHeaders } from "./auth";

const nowStamp = () => {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${timestamp}${random}`;
};

export type DemoDataset = {
  prefix: string;
  site: any;
  customer: any;
  vehicle: any;
  booking: any;
};

const expectOk = async (response: { ok(): boolean; status(): number; text(): Promise<string> }, label: string) => {
  if (!response.ok()) {
    throw new Error(`${label} failed with ${response.status()}: ${await response.text()}`);
  }
};

export const ensureDemoSite = async (api: APIRequestContext, csrfToken: string, prefix: string) => {
  const list = await api.get("/master-data/sites", { params: { pageSize: 50, search: "E2E" } });
  await expectOk(list, "list sites");
  const existing = (await list.json()).data?.find((site: any) => String(site.name).includes("E2E Test Site"));
  if (existing) return existing;

  const created = await api.post("/master-data/sites", {
    headers: csrfHeaders(csrfToken),
    data: {
      name: `E2E Test Site ${prefix}`,
      address: "Via Demo QA 1",
      city: "Roma",
      email: "e2e.site@example.com",
      phone: "+390600000000",
      isActive: true
    }
  });
  await expectOk(created, "create site");
  return created.json();
};

export const createDemoCustomer = async (api: APIRequestContext, csrfToken: string, prefix: string) => {
  const response = await api.post("/rental-bookings/customers", {
    headers: csrfHeaders(csrfToken),
    data: {
      customerType: "PERSONA_FISICA",
      firstName: "Cliente",
      lastName: `E2E ${prefix}`,
      email: `cliente.e2e.${prefix.toLowerCase()}@example.com`,
      phone: "+393330000000",
      taxCode: "RSSMRA80A01H501U",
      documentType: "CI",
      documentNumber: `E2E${prefix}`,
      drivingLicenseNumber: `PAT${prefix}`,
      notes: "[E2E DATA] Cliente creato da Playwright"
    }
  });
  await expectOk(response, "create customer");
  return response.json();
};

export const createDemoVehicle = async (api: APIRequestContext, csrfToken: string, siteId: string, prefix: string) => {
  const plate = `E2E${prefix.slice(-4)}`.slice(0, 8).toUpperCase();
  const response = await api.post("/master-data/vehicles", {
    headers: csrfHeaders(csrfToken),
    data: {
      siteId,
      plate,
      brand: "Toyota",
      model: "Yaris E2E",
      year: 2024,
      currentKm: 12500,
      maintenanceIntervalKm: 20000,
      purchasePrice: 10000,
      purchaseDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
      residualValue: 7200,
      monthlyFixedCost: 180,
      notes: "[E2E DATA] Veicolo creato da Playwright",
      isActive: true
    }
  });
  await expectOk(response, "create vehicle");
  return response.json();
};

export const createDemoBooking = async (api: APIRequestContext, csrfToken: string, input: { vehicleId: string; customerId: string; prefix: string }) => {
  const pickup = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
  pickup.setHours(9, 0, 0, 0);
  const ret = new Date(pickup.getTime() + 3 * 24 * 60 * 60 * 1000);
  ret.setHours(18, 0, 0, 0);

  const response = await api.post("/rental-bookings", {
    headers: csrfHeaders(csrfToken),
    data: {
      vehicleId: input.vehicleId,
      customerId: input.customerId,
      contractRequired: true,
      generateContract: true,
      pickupAt: pickup.toISOString(),
      returnAt: ret.toISOString(),
      pickupLocation: "Roma Centro",
      returnLocation: "Roma Centro",
      pickupKm: 12500,
      expectedTotal: 420,
      finalTotal: 420,
      reason: "Noleggio demo E2E",
      internalNotes: `[E2E DATA] Booking ${input.prefix}`
    }
  });
  await expectOk(response, "create booking");
  return response.json();
};

export const createDemoDataset = async (api: APIRequestContext, csrfToken: string): Promise<DemoDataset> => {
  const prefix = nowStamp();
  const site = await ensureDemoSite(api, csrfToken, prefix);
  const customer = await createDemoCustomer(api, csrfToken, prefix);
  const vehicle = await createDemoVehicle(api, csrfToken, site.id, prefix);
  const booking = await createDemoBooking(api, csrfToken, { vehicleId: vehicle.id, customerId: customer.id, prefix });
  return { prefix, site, customer, vehicle, booking };
};
