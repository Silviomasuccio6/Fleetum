import type { Page, Route } from "@playwright/test";

const now = new Date();
const pickupAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 9, 0).toISOString();
const returnAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5, 18, 0).toISOString();
const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

const testUser = {
  id: "user-e2e-admin",
  tenantId: "tenant-e2e",
  email: "admin.e2e@fleetum.test",
  firstName: "Admin",
  lastName: "Fleetum",
  roles: ["ADMIN"],
  permissions: ["*"]
};

const site = { id: "site-roma", name: "Roma Centro", city: "Roma" };
const vehicle = {
  id: "vehicle-panda",
  plate: "FT100AA",
  brand: "Fiat",
  model: "Panda",
  currentKm: 18400,
  site
};
const customer = {
  id: "customer-rossi",
  customerType: "PERSONA_FISICA",
  firstName: "Cliente",
  lastName: "Demo",
  email: "cliente.demo@example.com",
  phone: "+390600000000",
  taxCode: "DMOCLN90A01H501X"
};

type BookingRow = {
  id: string;
  code: string;
  status: string;
  contractStatus: string;
  cargosStatus: string;
  customerName: string;
  pickupAt: string;
  returnAt: string;
  pickupKm?: number;
  returnKm?: number | null;
  expectedTotal?: number;
  finalTotal?: number | null;
  vehicle: typeof vehicle;
  customer: typeof customer;
};

const state = {
  booking: {
    id: "booking-e2e-1",
    code: "E2E-BK-001",
    status: "CONFIRMED",
    contractStatus: "READY",
    cargosStatus: "NOT_REQUIRED",
    customerName: "Cliente Demo",
    pickupAt,
    returnAt,
    pickupKm: 18400,
    returnKm: null,
    expectedTotal: 420,
    finalTotal: null,
    vehicle,
    customer
  } satisfies BookingRow,
  contractStatus: "READY" as "READY" | "SIGNED"
};

const json = async (route: Route, data: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data)
  });

const emptyPage = { data: [], total: 0, page: 1, pageSize: 20 };

const availability = () => ({
  month: currentMonth,
  siteId: null,
  range: { from: `${currentMonth}-01`, to: `${currentMonth}-31` },
  summary: {
    totalVehicles: 1,
    availableVehicles: 0,
    bookedVehicles: 1,
    occupancyRate: 72
  },
  data: [
    {
      hasBookings: true,
      vehicle,
      bookings: [
        {
          id: state.booking.id,
          code: state.booking.code,
          status: state.booking.status,
          contractStatus: state.booking.contractStatus,
          cargosStatus: state.booking.cargosStatus,
          customerName: state.booking.customerName,
          pickupAt: state.booking.pickupAt,
          returnAt: state.booking.returnAt,
          pickupKm: state.booking.pickupKm,
          returnKm: state.booking.returnKm
        }
      ]
    }
  ]
});

const quote = {
  pricingRef: {
    priceListId: "price-standard",
    pricePackageId: null,
    extraKmPolicyId: null,
    priceListName: "Listino Standard",
    pricePackageName: null,
    extraKmPolicyName: null
  },
  duration: {
    totalHours: 72,
    daysCharged: 3,
    unit: "DAILY",
    chargedUnits: 3,
    overflowRule: "FULL_DAY"
  },
  km: {
    packageType: null,
    kmScope: null,
    includedKmTotal: null,
    estimatedKm: 300,
    actualKm: null,
    extraKmEstimated: 0,
    extraKmActual: 0
  },
  pricing: {
    baseRateAmount: 140,
    baseCost: 420,
    discountPercent: 0,
    discountedBaseCost: 420,
    vatRate: 22,
    extraKmPolicyType: null,
    extraKmEstimatedCost: 0,
    extraKmActualCost: 0,
    expectedSubtotal: 344.26,
    expectedTaxAmount: 75.74,
    expectedTotal: 420,
    finalSubtotal: 344.26,
    finalTaxAmount: 75.74,
    finalTotal: 420,
    extraKmEffectiveRateEstimated: null,
    extraKmEffectiveRateActual: null
  }
};

const contractRow = () => ({
  id: "contract-e2e-1",
  bookingId: state.booking.id,
  status: state.contractStatus,
  title: "Contratto noleggio E2E",
  emailTo: customer.email,
  lastSentAt: null,
  signedAt: state.contractStatus === "SIGNED" ? new Date().toISOString() : null,
  pdfGeneratedAt: new Date().toISOString(),
  errorMessage: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  latestDelivery: null,
  booking: state.booking
});

const dashboardData = () => ({
  kpis: {
    openStoppages: 0,
    criticalOpen: 0,
    overdueOpen: 0,
    totalStoppages: 0,
    newStoppagesLast30: 0,
    closedLast30: 0,
    averageClosureDays: 0
  },
  charts: {
    byStatus: [],
    bySite: [],
    topWorkshops: []
  },
  feeds: {
    alerts: [],
    recentUsers: [],
    recentStoppages: [],
    recentReminders: []
  },
  booking: {
    kpis: {
      availableToday: 1,
      totalRentalVehicles: 1,
      occupiedToday: 0,
      utilizationRateToday: 0,
      pickupsToday: 1,
      returnsToday: 0,
      overdueReturns: 0
    },
    contractKpis: {
      toGenerate: 0,
      toSend: 1,
      sentToday: 0,
      signed: state.contractStatus === "SIGNED" ? 1 : 0,
      errors: 0,
      unsigned: state.contractStatus === "SIGNED" ? 0 : 1
    },
    economicKpis: {
      revenueMonth: 420,
      averageRentalValue: 420,
      topVehicleRevenue: 420
    },
    charts: {
      trend: [],
      utilization: [],
      topVehicles: [],
      contractStatusDistribution: []
    },
    lists: {
      criticalBookings: [],
      nextPickups: [],
      nextReturns: []
    }
  }
});

export const installFleetumApiMocks = async (page: Page) => {
  state.contractStatus = "READY";
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "fleetum_cookie_consent_v1",
      JSON.stringify({
        necessary: true,
        analytics: false,
        marketing: false,
        version: "2026-05-17",
        acceptedAt: new Date().toISOString()
      })
    );
  });

  await page.route(/https?:\/\/(?:localhost|127\.0\.0\.1):4000\/api\/.*/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "") || "/";
    const method = request.method();

    if (path === "/health") return json(route, { status: "ok" });
    if (path === "/auth/signup" && method === "POST") return json(route, { tenantId: "tenant-e2e" }, 201);
    if (path === "/auth/login" && method === "POST") {
      return json(route, {
        refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        csrfToken: "csrf-e2e",
        user: testUser
      });
    }
    if (path === "/auth/me") return json(route, testUser);
    if (path === "/auth/me/entitlements") {
      return json(route, {
        plan: "ENTERPRISE",
        priceMonthly: 249,
        features: ["reports_advanced"],
        license: {
          plan: "ENTERPRISE",
          seats: 10,
          status: "ACTIVE",
          expiresAt: null,
          daysRemaining: null,
          expiringSoon: false
        }
      });
    }
    if (path === "/auth/license-status") {
      return json(route, {
        plan: "ENTERPRISE",
        seats: 10,
        status: "ACTIVE",
        expiresAt: null,
        daysRemaining: null,
        expiringSoon: false
      });
    }
    if (path === "/auth/privacy/current") {
      return json(route, {
        notice: {
          id: "privacy-e2e",
          version: "2026-01",
          title: "Informativa privacy",
          summary: "Informativa test",
          content: "Privacy test",
          publishedAt: new Date().toISOString()
        },
        accepted: true,
        acceptedAt: new Date().toISOString(),
        source: "e2e"
      });
    }
    if (path === "/notifications/inbox") return json(route, { data: [] });
    if (path === "/stats/dashboard") return json(route, dashboardData());
    if (path === "/stats/analytics") return json(route, { charts: { trendStoppages: [] } });
    if (path.startsWith("/stoppages/")) return json(route, { data: [], kpis: {}, charts: {} });

    if (path === "/master-data/sites") return json(route, { data: [site], total: 1, page: 1, pageSize: 200 });
    if (path === "/master-data/vehicles") return json(route, { data: [vehicle], total: 1, page: 1, pageSize: 20 });
    if (path === "/rental-bookings/availability/month") return json(route, availability());
    if (path === "/rental-bookings/suggest/vehicles") return json(route, { data: [vehicle] });
    if (path === "/rental-bookings/suggest/customers") return json(route, { data: [customer] });
    if (path === "/rental-pricing/lists") {
      return json(route, {
        data: [
          {
            id: "price-standard",
            name: "Listino Standard",
            isActive: true,
            scope: "GLOBAL",
            baseRateUnit: "DAILY",
            baseRateAmount: 140,
            vatRate: 22,
            discountPercent: 0,
            hourOverflowRule: "FULL_DAY",
            priority: 10,
            updatedAt: new Date().toISOString()
          }
        ],
        total: 1,
        page: 1,
        pageSize: 20
      });
    }
    if (path.includes("/rental-pricing/lists/") && path.endsWith("/packages")) return json(route, { data: [] });
    if (path === "/rental-pricing/extra-policies") return json(route, { data: [] });
    if (path === "/rental-pricing/quote/preview" && method === "POST") return json(route, { quote, selected: {} });

    if (path === "/rental-bookings" && method === "POST") {
      const body = request.postDataJSON() as Partial<BookingRow>;
      state.booking = {
        ...state.booking,
        ...body,
        id: "booking-e2e-created",
        code: "E2E-BK-002",
        status: "CONFIRMED",
        contractStatus: "READY",
        cargosStatus: "NOT_REQUIRED",
        customerName: "Cliente Demo",
        vehicle,
        customer
      };
      return json(route, state.booking, 201);
    }
    if (/^\/rental-bookings\/[^/]+\/pricing$/.test(path) && method === "PATCH") {
      return json(route, { bookingId: state.booking.id, bookingCode: state.booking.code, quote, snapshot: {} });
    }
    if (path === "/rental-bookings/contracts") {
      return json(route, {
        data: [contractRow()],
        total: 1,
        page: 1,
        pageSize: 20,
        kpis: {
          contractsToSend: state.contractStatus === "SIGNED" ? 0 : 1,
          sentToday: 0,
          signed: state.contractStatus === "SIGNED" ? 1 : 0,
          inError: 0,
          exitsToday: 1,
          returnsToday: 0
        },
        timeline: []
      });
    }
    if (/^\/rental-bookings\/[^/]+\/quick$/.test(path) || /^\/rental-bookings\/[^/]+$/.test(path)) {
      return json(route, state.booking);
    }
    if (/^\/rental-bookings\/[^/]+\/contract\/pdf$/.test(path)) {
      return route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: Buffer.from("%PDF-1.4\n% Fleetum E2E PDF\n1 0 obj\n<<>>\nendobj\n%%EOF\n")
      });
    }
    if (/^\/rental-bookings\/[^/]+\/contract\/mark-signed$/.test(path) && method === "POST") {
      state.contractStatus = "SIGNED";
      return json(route, {
        id: "contract-e2e-1",
        tenantId: "tenant-e2e",
        bookingId: state.booking.id,
        status: "SIGNED",
        title: "Contratto noleggio E2E",
        content: "Contratto firmato",
        signedAt: new Date().toISOString(),
        templateVersion: 1,
        signatureSaved: true
      });
    }

    if (method === "GET") return json(route, emptyPage);
    return json(route, { ok: true });
  });
};
