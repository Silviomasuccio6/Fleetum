import {
  BookingContractStatus,
  PrismaClient,
  RentalBaseRateUnit,
  RentalBookingStatus,
  RentalContractStatus,
  RentalCustomerType,
  RentalExtraKmPolicyType,
  RentalHourOverflowRule,
  RentalKmPackageType,
  RentalKmScope,
  RentalPricingScope,
  StoppagePriority,
  StoppageStatus,
  VehicleCostType
} from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_NOTE = "[DEMO DATA] Record creato per test gestionale Fleetum";
const DEFAULT_ADMIN_EMAIL = "admin@fleetum.it";

type SeedCounters = Record<
  | "sites"
  | "workshops"
  | "vehicles"
  | "vehicleCosts"
  | "customers"
  | "priceLists"
  | "pricePackages"
  | "extraKmPolicies"
  | "bookings"
  | "pricingSnapshots"
  | "contracts"
  | "contractEvents"
  | "maintenances"
  | "stoppages"
  | "stoppageEvents"
  | "auditLogs",
  number
>;

type SeedContext = {
  tenantId: string;
  adminUserId: string;
};

const counters: SeedCounters = {
  sites: 0,
  workshops: 0,
  vehicles: 0,
  vehicleCosts: 0,
  customers: 0,
  priceLists: 0,
  pricePackages: 0,
  extraKmPolicies: 0,
  bookings: 0,
  pricingSnapshots: 0,
  contracts: 0,
  contractEvents: 0,
  maintenances: 0,
  stoppages: 0,
  stoppageEvents: 0,
  auditLogs: 0
};

const requireProductionOptIn = () => {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.ALLOW_DEMO_SEED_PRODUCTION === "true") return;
  throw new Error("Seed demo tenant bloccato in produzione: imposta ALLOW_DEMO_SEED_PRODUCTION=true per eseguirlo consapevolmente.");
};

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const addDays = (date: Date, days: number, hour = 9, minutes = 0) => {
  const next = startOfDay(date);
  next.setDate(next.getDate() + days);
  next.setHours(hour, minutes, 0, 0);
  return next;
};

const addMonths = (date: Date, months: number) => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
};

const roundCurrency = (value: number) => Math.round(value * 100) / 100;

const demoCode = (prefix: string, index: number) => `${prefix}-${new Date().getFullYear()}-${String(index).padStart(3, "0")}`;

const upsertByFirst = async <T>({
  find,
  update,
  create
}: {
  find: () => Promise<T | null>;
  update: (existing: T) => Promise<T>;
  create: () => Promise<T>;
}) => {
  const existing = await find();
  return existing ? update(existing) : create();
};

const findSeedTenant = async (): Promise<SeedContext> => {
  const adminEmail = (process.env.DEMO_TENANT_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
  const tenantId = process.env.DEMO_TENANT_ID?.trim();

  if (tenantId) {
    const users = await prisma.user.findMany({
      where: { tenantId, email: adminEmail, deletedAt: null },
      select: { id: true, tenantId: true, email: true }
    });
    if (users.length !== 1) {
      throw new Error(`Tenant target non univoco per DEMO_TENANT_ID=${tenantId} e DEMO_TENANT_ADMIN_EMAIL=${adminEmail}. Trovati: ${users.length}.`);
    }
    return { tenantId: users[0].tenantId, adminUserId: users[0].id };
  }

  const users = await prisma.user.findMany({
    where: { email: adminEmail, deletedAt: null },
    select: { id: true, tenantId: true, email: true }
  });
  if (users.length !== 1) {
    throw new Error(`Admin tenant non univoco per DEMO_TENANT_ADMIN_EMAIL=${adminEmail}. Trovati: ${users.length}. Specifica DEMO_TENANT_ID.`);
  }

  return { tenantId: users[0].tenantId, adminUserId: users[0].id };
};

const siteSeeds = [
  { name: "Roma Centro", address: "Via Demo Fleetum 12", city: "Roma", email: "roma-centro.demo@example.com", phone: "+39 06 0000 0101" },
  { name: "Roma Eur", address: "Viale Demo Operativo 44", city: "Roma", email: "roma-eur.demo@example.com", phone: "+39 06 0000 0202" },
  { name: "Fiumicino Aeroporto", address: "Via Demo Aeroporto 8", city: "Fiumicino", email: "fiumicino.demo@example.com", phone: "+39 06 0000 0303" }
];

const workshopSeeds = [
  { name: "Officina Demo Roma Nord", address: "Via Tagliando Demo 21", city: "Roma", email: "officina.roma.nord@example.com" },
  { name: "Fleet Service Demo Eur", address: "Via Service Demo 9", city: "Roma", email: "fleet.service.eur@example.com" },
  { name: "Carrozzeria Demo Aeroporto", address: "Via Verniciatura Demo 18", city: "Fiumicino", email: "carrozzeria.aeroporto@example.com" }
];

const vehicleSeeds = [
  { plate: "FT100AA", brand: "Fiat", model: "Panda", year: 2021, km: 32400, category: "City car", purchasePrice: 9700, residualValue: 5700, monthlyFixedCost: 145 },
  { plate: "FT101AA", brand: "Lancia", model: "Ypsilon", year: 2022, km: 28150, category: "City car", purchasePrice: 11200, residualValue: 6900, monthlyFixedCost: 155 },
  { plate: "FT102AA", brand: "Toyota", model: "Aygo X", year: 2023, km: 16200, category: "City car", purchasePrice: 13900, residualValue: 9800, monthlyFixedCost: 165 },
  { plate: "FT103AA", brand: "Hyundai", model: "i10", year: 2021, km: 39500, category: "City car", purchasePrice: 10500, residualValue: 6100, monthlyFixedCost: 150 },
  { plate: "FT104AA", brand: "Toyota", model: "Yaris Hybrid", year: 2023, km: 21400, category: "Utilitaria", purchasePrice: 18900, residualValue: 14100, monthlyFixedCost: 205 },
  { plate: "FT105AA", brand: "Volkswagen", model: "Polo", year: 2022, km: 30700, category: "Utilitaria", purchasePrice: 17100, residualValue: 11600, monthlyFixedCost: 198 },
  { plate: "FT106AA", brand: "Peugeot", model: "208", year: 2022, km: 28600, category: "Utilitaria", purchasePrice: 16600, residualValue: 10900, monthlyFixedCost: 192 },
  { plate: "FT107AA", brand: "Jeep", model: "Renegade", year: 2021, km: 45300, category: "SUV", purchasePrice: 23800, residualValue: 15100, monthlyFixedCost: 260 },
  { plate: "FT108AA", brand: "Nissan", model: "Qashqai", year: 2022, km: 36750, category: "SUV", purchasePrice: 26400, residualValue: 18400, monthlyFixedCost: 275 },
  { plate: "FT109AA", brand: "BMW", model: "X1", year: 2023, km: 18200, category: "SUV Premium", purchasePrice: 38900, residualValue: 30200, monthlyFixedCost: 390 },
  { plate: "FT110AA", brand: "Fiat", model: "Ducato", year: 2020, km: 81200, category: "Van", purchasePrice: 24500, residualValue: 12300, monthlyFixedCost: 310 },
  { plate: "FT111AA", brand: "Ford", model: "Transit", year: 2021, km: 74300, category: "Van", purchasePrice: 26800, residualValue: 14900, monthlyFixedCost: 325 },
  { plate: "FT112AA", brand: "Mercedes", model: "Classe A", year: 2022, km: 29800, category: "Premium", purchasePrice: 33500, residualValue: 24600, monthlyFixedCost: 365 },
  { plate: "FT113AA", brand: "Audi", model: "A3", year: 2023, km: 19500, category: "Premium", purchasePrice: 34800, residualValue: 26900, monthlyFixedCost: 375 },
  { plate: "FT114AA", brand: "Tesla", model: "Model 3", year: 2023, km: 22600, category: "Elettrica", purchasePrice: null, residualValue: 31200, monthlyFixedCost: 330 }
];

const peopleCustomers = [
  ["Mario", "Rossi"], ["Luca", "Bianchi"], ["Giulia", "Conti"], ["Francesca", "Romano"], ["Alessandro", "Moretti"], ["Chiara", "Ferrari"], ["Davide", "Gallo"],
  ["Elena", "Ricci"], ["Marco", "Marini"], ["Sara", "Greco"], ["Andrea", "Costa"], ["Valentina", "Leone"], ["Simone", "Barbieri"], ["Martina", "Riva"]
];

const companyCustomers = [
  "Autotrasporti Demo Srl",
  "Studio Tecnico Esempio Srl",
  "Consulting Test Italia Srl",
  "Delivery Demo Group Srl",
  "Hotel Demo Roma Srl",
  "Eventi Test Srl"
];

const priceListSeeds = [
  { name: "Listino Standard Demo", rate: 54, description: "Tariffa demo feriale" },
  { name: "Listino Weekend Demo", rate: 68, description: "Tariffa demo weekend" },
  { name: "Listino Corporate Demo", rate: 49, description: "Tariffa demo convenzioni aziendali" },
  { name: "Listino Lungo Termine Demo", rate: 39, description: "Tariffa demo noleggi oltre 15 giorni" }
];

const bookingStatusPlan: RentalBookingStatus[] = [
  "CLOSED", "CLOSED", "CLOSED", "CLOSED", "CLOSED", "CLOSED", "CLOSED", "CLOSED",
  "IN_RENT", "IN_RENT", "IN_RENT", "IN_RENT", "IN_RENT", "IN_RENT",
  "READY_FOR_HANDOVER", "READY_FOR_HANDOVER", "CONTRACT_SIGNED", "CONTRACT_SIGNED", "CONFIRMED", "CONFIRMED",
  "CONFIRMED", "CONFIRMED", "CONFIRMED", "DRAFT", "QUOTED", "QUOTED", "HOLD", "HOLD", "READY_FOR_HANDOVER", "CONTRACT_SIGNED",
  "CANCELED", "CANCELED", "NO_SHOW", "CONFIRMED", "READY_FOR_HANDOVER"
];

const bookingOffsets = [
  [-38, -34], [-34, -31], [-30, -26], [-24, -20], [-19, -14], [-13, -9], [-8, -5], [-4, -1],
  [-3, 2], [-2, 4], [-1, 3], [0, 5], [1, 7], [2, 8],
  [0, 2], [1, 4], [2, 6], [3, 5], [4, 9], [5, 10],
  [6, 11], [7, 12], [8, 13], [9, 11], [10, 14], [11, 15], [12, 16], [13, 18], [14, 19], [15, 20],
  [16, 18], [18, 20], [20, 22], [22, 27], [24, 29]
] as const;

const contractStatusForBooking = (status: RentalBookingStatus): RentalContractStatus => {
  if (status === "CONTRACT_SIGNED" || status === "READY_FOR_HANDOVER" || status === "IN_RENT" || status === "CLOSED") return "SIGNED";
  if (status === "CONFIRMED" || status === "HOLD") return "READY";
  return "NOT_READY";
};

const bookingContractStatusForBooking = (status: RentalBookingStatus, index: number): BookingContractStatus => {
  if (status === "CONTRACT_SIGNED" || status === "READY_FOR_HANDOVER" || status === "IN_RENT" || status === "CLOSED") return "SIGNED";
  if (status === "CONFIRMED" || status === "HOLD") return index % 2 === 0 ? "READY" : "DRAFT";
  return "DRAFT";
};

const seedSites = async ({ tenantId }: SeedContext) => {
  const sites = [];
  for (const site of siteSeeds) {
    const row = await upsertByFirst({
      find: () => prisma.site.findFirst({ where: { tenantId, name: site.name, deletedAt: null } }),
      update: (existing) =>
        prisma.site.update({
          where: { id: existing.id },
          data: { ...site, contactName: "Referente Demo", notes: DEMO_NOTE, isActive: true }
        }),
      create: () =>
        prisma.site.create({
          data: { tenantId, ...site, contactName: "Referente Demo", notes: DEMO_NOTE, isActive: true }
        })
    });
    counters.sites += 1;
    sites.push(row);
  }
  return sites;
};

const seedWorkshops = async ({ tenantId }: SeedContext) => {
  const workshops = [];
  for (const workshop of workshopSeeds) {
    const row = await upsertByFirst({
      find: () => prisma.workshop.findFirst({ where: { tenantId, name: workshop.name, deletedAt: null } }),
      update: (existing) =>
        prisma.workshop.update({
          where: { id: existing.id },
          data: { ...workshop, contactName: "Tecnico Demo", phone: "+39 06 0000 9000", whatsapp: "+39 366 000 9000", notes: DEMO_NOTE, isActive: true }
        }),
      create: () =>
        prisma.workshop.create({
          data: {
            tenantId,
            ...workshop,
            contactName: "Tecnico Demo",
            phone: "+39 06 0000 9000",
            whatsapp: "+39 366 000 9000",
            notes: DEMO_NOTE,
            isActive: true
          }
        })
    });
    counters.workshops += 1;
    workshops.push(row);
  }
  return workshops;
};

const seedVehicles = async ({ tenantId }: SeedContext, sites: Awaited<ReturnType<typeof seedSites>>) => {
  const vehicles = [];
  const now = new Date();
  for (let index = 0; index < vehicleSeeds.length; index += 1) {
    const seed = vehicleSeeds[index];
    const site = sites[index % sites.length];
    const revisionDueAt = addDays(now, index % 5 === 0 ? -12 : index % 4 === 0 ? 18 : 160 + index);
    const row = await upsertByFirst({
      find: () => prisma.vehicle.findFirst({ where: { tenantId, plate: seed.plate, deletedAt: null } }),
      update: (existing) =>
        prisma.vehicle.update({
          where: { id: existing.id },
          data: {
            siteId: site.id,
            brand: seed.brand,
            model: seed.model,
            year: seed.year,
            currentKm: seed.km,
            maintenanceIntervalKm: 20000,
            registrationDate: new Date(seed.year, index % 12, 15),
            lastRevisionAt: addMonths(revisionDueAt, -22),
            revisionDueAt,
            purchasePrice: seed.purchasePrice,
            purchaseDate: new Date(seed.year, 0, 20),
            residualValue: seed.residualValue,
            monthlyFixedCost: seed.monthlyFixedCost,
            notes: `${DEMO_NOTE} Categoria: ${seed.category}`,
            isActive: true
          }
        }),
      create: () =>
        prisma.vehicle.create({
          data: {
            tenantId,
            siteId: site.id,
            plate: seed.plate,
            brand: seed.brand,
            model: seed.model,
            year: seed.year,
            currentKm: seed.km,
            maintenanceIntervalKm: 20000,
            registrationDate: new Date(seed.year, index % 12, 15),
            lastRevisionAt: addMonths(revisionDueAt, -22),
            revisionDueAt,
            purchasePrice: seed.purchasePrice,
            purchaseDate: new Date(seed.year, 0, 20),
            residualValue: seed.residualValue,
            monthlyFixedCost: seed.monthlyFixedCost,
            notes: `${DEMO_NOTE} Categoria: ${seed.category}`,
            isActive: true
          }
        })
    });
    counters.vehicles += 1;
    vehicles.push(row);
  }
  return vehicles;
};

const seedVehicleCosts = async ({ tenantId }: SeedContext, vehicles: Awaited<ReturnType<typeof seedVehicles>>) => {
  const now = new Date();
  for (let index = 0; index < vehicles.length; index += 1) {
    const vehicle = vehicles[index];
    const fixedCosts = [
      { type: "INSURANCE" as VehicleCostType, amount: 620 + index * 18, description: `DEMO-COST-${index + 1}-INSURANCE Assicurazione annuale demo`, date: addMonths(now, -7) },
      { type: "TAX" as VehicleCostType, amount: 180 + index * 5, description: `DEMO-COST-${index + 1}-TAX Bollo demo`, date: addMonths(now, -5) }
    ];
    for (const cost of fixedCosts) {
      await upsertByFirst({
        find: () => prisma.vehicleCost.findFirst({ where: { tenantId, vehicleId: vehicle.id, description: cost.description, deletedAt: null } }),
        update: (existing) => prisma.vehicleCost.update({ where: { id: existing.id }, data: { ...cost, recurring: false } }),
        create: () => prisma.vehicleCost.create({ data: { tenantId, vehicleId: vehicle.id, ...cost, recurring: false } })
      });
      counters.vehicleCosts += 1;
    }
  }
};

const seedCustomers = async ({ tenantId }: SeedContext) => {
  const customers = [];

  for (let index = 0; index < peopleCustomers.length; index += 1) {
    const [firstName, lastName] = peopleCustomers[index];
    const email = `cliente.demo${String(index + 1).padStart(2, "0")}@example.com`;
    const row = await upsertByFirst({
      find: () => prisma.rentalCustomer.findFirst({ where: { tenantId, email, deletedAt: null } }),
      update: (existing) =>
        prisma.rentalCustomer.update({
          where: { id: existing.id },
          data: {
            customerType: "PERSONA_FISICA",
            firstName,
            lastName,
            drivingLicenseNumber: `DEMO-LIC-${String(index + 1).padStart(3, "0")}`,
            drivingLicenseIssuedAt: addMonths(new Date(), -48),
            drivingLicenseExpiresAt: addMonths(new Date(), 48),
            drivingLicenseAuthority: "MIT Demo",
            drivingLicenseCategory: "B",
            email,
            phone: `+39 333 000 ${String(index + 1).padStart(4, "0")}`,
            dateOfBirth: new Date(1980 + (index % 18), index % 12, 10),
            placeOfBirth: "Roma",
            nationality: "Italiana",
            residenceAddress: `Via Cliente Demo ${index + 1}, Roma`,
            taxCode: `DMO${String(index + 1).padStart(13, "0")}`,
            documentType: "Carta identita",
            documentNumber: `DOC-DEMO-${String(index + 1).padStart(3, "0")}`,
            documentIssuedAt: addMonths(new Date(), -36),
            documentExpiresAt: addMonths(new Date(), 60),
            documentAuthority: "Comune Demo",
            notes: DEMO_NOTE
          }
        }),
      create: () =>
        prisma.rentalCustomer.create({
          data: {
            tenantId,
            customerType: "PERSONA_FISICA",
            firstName,
            lastName,
            drivingLicenseNumber: `DEMO-LIC-${String(index + 1).padStart(3, "0")}`,
            drivingLicenseIssuedAt: addMonths(new Date(), -48),
            drivingLicenseExpiresAt: addMonths(new Date(), 48),
            drivingLicenseAuthority: "MIT Demo",
            drivingLicenseCategory: "B",
            email,
            phone: `+39 333 000 ${String(index + 1).padStart(4, "0")}`,
            dateOfBirth: new Date(1980 + (index % 18), index % 12, 10),
            placeOfBirth: "Roma",
            nationality: "Italiana",
            residenceAddress: `Via Cliente Demo ${index + 1}, Roma`,
            taxCode: `DMO${String(index + 1).padStart(13, "0")}`,
            documentType: "Carta identita",
            documentNumber: `DOC-DEMO-${String(index + 1).padStart(3, "0")}`,
            documentIssuedAt: addMonths(new Date(), -36),
            documentExpiresAt: addMonths(new Date(), 60),
            documentAuthority: "Comune Demo",
            notes: DEMO_NOTE
          }
        })
    });
    counters.customers += 1;
    customers.push(row);
  }

  for (let index = 0; index < companyCustomers.length; index += 1) {
    const companyName = companyCustomers[index];
    const email = `azienda.demo${String(index + 1).padStart(2, "0")}@example.com`;
    const row = await upsertByFirst({
      find: () => prisma.rentalCustomer.findFirst({ where: { tenantId, email, deletedAt: null } }),
      update: (existing) =>
        prisma.rentalCustomer.update({
          where: { id: existing.id },
          data: {
            customerType: "PERSONA_GIURIDICA",
            firstName: "Referente",
            lastName: `Demo ${index + 1}`,
            drivingLicenseNumber: `DEMO-CORP-LIC-${String(index + 1).padStart(3, "0")}`,
            email,
            phone: `+39 334 000 ${String(index + 1).padStart(4, "0")}`,
            companyName,
            companyLegalForm: "SRL",
            companyVatNumber: `099${String(index + 1).padStart(8, "0")}`,
            companyTaxCode: `099${String(index + 1).padStart(8, "0")}`,
            companyLegalAddress: `Viale Azienda Demo ${index + 1}, Roma`,
            companyPec: `azienda.demo${index + 1}@pec.example.com`,
            companySdi: `SDI${String(index + 1).padStart(4, "0")}`,
            companyRea: `RM-DEMO-${String(index + 1).padStart(5, "0")}`,
            legalRepFirstName: "Legale",
            legalRepLastName: `Demo ${index + 1}`,
            legalRepRole: "Amministratore",
            legalRepEmail: email,
            legalRepPhone: `+39 335 000 ${String(index + 1).padStart(4, "0")}`,
            notes: DEMO_NOTE
          }
        }),
      create: () =>
        prisma.rentalCustomer.create({
          data: {
            tenantId,
            customerType: "PERSONA_GIURIDICA",
            firstName: "Referente",
            lastName: `Demo ${index + 1}`,
            drivingLicenseNumber: `DEMO-CORP-LIC-${String(index + 1).padStart(3, "0")}`,
            email,
            phone: `+39 334 000 ${String(index + 1).padStart(4, "0")}`,
            companyName,
            companyLegalForm: "SRL",
            companyVatNumber: `099${String(index + 1).padStart(8, "0")}`,
            companyTaxCode: `099${String(index + 1).padStart(8, "0")}`,
            companyLegalAddress: `Viale Azienda Demo ${index + 1}, Roma`,
            companyPec: `azienda.demo${index + 1}@pec.example.com`,
            companySdi: `SDI${String(index + 1).padStart(4, "0")}`,
            companyRea: `RM-DEMO-${String(index + 1).padStart(5, "0")}`,
            legalRepFirstName: "Legale",
            legalRepLastName: `Demo ${index + 1}`,
            legalRepRole: "Amministratore",
            legalRepEmail: email,
            legalRepPhone: `+39 335 000 ${String(index + 1).padStart(4, "0")}`,
            notes: DEMO_NOTE
          }
        })
    });
    counters.customers += 1;
    customers.push(row);
  }

  return customers;
};

const seedPricing = async ({ tenantId }: SeedContext, sites: Awaited<ReturnType<typeof seedSites>>) => {
  const lists = [];
  for (let index = 0; index < priceListSeeds.length; index += 1) {
    const seed = priceListSeeds[index];
    const row = await upsertByFirst({
      find: () => prisma.rentalPriceList.findFirst({ where: { tenantId, name: seed.name, deletedAt: null } }),
      update: (existing) =>
        prisma.rentalPriceList.update({
          where: { id: existing.id },
          data: {
            description: `${seed.description}. ${DEMO_NOTE}`,
            isActive: true,
            validFrom: addMonths(new Date(), -6),
            validTo: addMonths(new Date(), 12),
            scope: index === 1 ? RentalPricingScope.SITE : RentalPricingScope.GLOBAL,
            siteId: index === 1 ? sites[0].id : null,
            baseRateUnit: RentalBaseRateUnit.DAILY,
            baseRateAmount: seed.rate,
            vatRate: 22,
            discountPercent: index === 2 ? 8 : 0,
            hourOverflowRule: RentalHourOverflowRule.FULL_DAY,
            priority: 50 + index
          }
        }),
      create: () =>
        prisma.rentalPriceList.create({
          data: {
            tenantId,
            name: seed.name,
            description: `${seed.description}. ${DEMO_NOTE}`,
            isActive: true,
            validFrom: addMonths(new Date(), -6),
            validTo: addMonths(new Date(), 12),
            scope: index === 1 ? RentalPricingScope.SITE : RentalPricingScope.GLOBAL,
            siteId: index === 1 ? sites[0].id : null,
            baseRateUnit: RentalBaseRateUnit.DAILY,
            baseRateAmount: seed.rate,
            vatRate: 22,
            discountPercent: index === 2 ? 8 : 0,
            hourOverflowRule: RentalHourOverflowRule.FULL_DAY,
            priority: 50 + index
          }
        })
    });
    counters.priceLists += 1;

    const pricePackage = await upsertByFirst({
      find: () => prisma.rentalPricePackage.findFirst({ where: { tenantId, priceListId: row.id, code: `DEMO-PKG-${index + 1}`, deletedAt: null } }),
      update: (existing) =>
        prisma.rentalPricePackage.update({
          where: { id: existing.id },
          data: { name: "Pacchetto km demo", type: RentalKmPackageType.LIMITED, kmIncluded: 150 + index * 50, kmScope: RentalKmScope.PER_DAY, isDefault: true, isActive: true }
        }),
      create: () =>
        prisma.rentalPricePackage.create({
          data: {
            tenantId,
            priceListId: row.id,
            name: "Pacchetto km demo",
            code: `DEMO-PKG-${index + 1}`,
            type: RentalKmPackageType.LIMITED,
            kmIncluded: 150 + index * 50,
            kmScope: RentalKmScope.PER_DAY,
            isDefault: true,
            isActive: true,
            sortOrder: index
          }
        })
    });
    counters.pricePackages += 1;

    const extraKmPolicy = await upsertByFirst({
      find: () => prisma.rentalExtraKmPolicy.findFirst({ where: { tenantId, priceListId: row.id, packageId: pricePackage.id, name: "Extra km demo", deletedAt: null } }),
      update: (existing) =>
        prisma.rentalExtraKmPolicy.update({
          where: { id: existing.id },
          data: { type: RentalExtraKmPolicyType.FLAT, flatRatePerKm: roundCurrency(0.22 + index * 0.04), isDefault: true, isActive: true }
        }),
      create: () =>
        prisma.rentalExtraKmPolicy.create({
          data: {
            tenantId,
            priceListId: row.id,
            packageId: pricePackage.id,
            name: "Extra km demo",
            type: RentalExtraKmPolicyType.FLAT,
            flatRatePerKm: roundCurrency(0.22 + index * 0.04),
            currency: "EUR",
            isDefault: true,
            isActive: true,
            sortOrder: index
          }
        })
    });
    counters.extraKmPolicies += 1;
    lists.push({ priceList: row, pricePackage, extraKmPolicy });
  }
  return lists;
};

const seedBookingsAndContracts = async (
  context: SeedContext,
  vehicles: Awaited<ReturnType<typeof seedVehicles>>,
  customers: Awaited<ReturnType<typeof seedCustomers>>,
  pricing: Awaited<ReturnType<typeof seedPricing>>
) => {
  const now = new Date();

  for (let index = 0; index < bookingStatusPlan.length; index += 1) {
    const vehicle = vehicles[index % vehicles.length];
    const customer = customers[index % customers.length];
    const status = bookingStatusPlan[index];
    const [pickupOffset, returnOffset] = bookingOffsets[index];
    const pickupAt = addDays(now, pickupOffset, 9 + (index % 4), index % 2 === 0 ? 0 : 30);
    const returnAt = addDays(now, returnOffset, 10 + (index % 5), index % 2 === 0 ? 30 : 0);
    const days = Math.max(1, Math.ceil((returnAt.getTime() - pickupAt.getTime()) / (24 * 60 * 60 * 1000)));
    const price = pricing[index % pricing.length];
    const expectedSubtotal = roundCurrency(days * (price.priceList.baseRateAmount ?? 55));
    const expectedTaxAmount = roundCurrency(expectedSubtotal * 0.22);
    const expectedTotal = roundCurrency(expectedSubtotal + expectedTaxAmount);
    const finalTotal = status === "CLOSED" || status === "IN_RENT" ? roundCurrency(expectedTotal + (index % 3) * 38) : null;
    const code = demoCode("DEMO-BK", index + 1);
    const customerName =
      customer.customerType === RentalCustomerType.PERSONA_GIURIDICA && customer.companyName
        ? customer.companyName
        : `${customer.firstName} ${customer.lastName}`;

    const booking = await prisma.rentalBooking.upsert({
      where: { tenantId_code: { tenantId: context.tenantId, code } },
      update: {
        vehicleId: vehicle.id,
        customerId: customer.id,
        contractRequired: true,
        createdByUserId: context.adminUserId,
        status,
        contractStatus: contractStatusForBooking(status),
        cargosStatus: "NOT_REQUIRED",
        customerName,
        customerEmail: customer.email,
        customerPhone: customer.phone,
        customerDocument: customer.documentNumber,
        pickupAt,
        returnAt,
        pickupLocation: vehicle.siteId,
        returnLocation: vehicle.siteId,
        pickupKm: vehicle.currentKm ? vehicle.currentKm + index * 70 : null,
        returnKm: status === "CLOSED" ? (vehicle.currentKm ?? 0) + index * 70 + days * 115 : null,
        expectedTotal,
        finalTotal,
        reason: "Noleggio demo per test calendario e contratti",
        internalNotes: `${DEMO_NOTE} ${code}`,
        contractSignedAt: contractStatusForBooking(status) === "SIGNED" ? addDays(pickupAt, -1, 16) : null
      },
      create: {
        tenantId: context.tenantId,
        vehicleId: vehicle.id,
        customerId: customer.id,
        contractRequired: true,
        createdByUserId: context.adminUserId,
        code,
        status,
        contractStatus: contractStatusForBooking(status),
        cargosStatus: "NOT_REQUIRED",
        customerName,
        customerEmail: customer.email,
        customerPhone: customer.phone,
        customerDocument: customer.documentNumber,
        pickupAt,
        returnAt,
        pickupLocation: vehicle.siteId,
        returnLocation: vehicle.siteId,
        pickupKm: vehicle.currentKm ? vehicle.currentKm + index * 70 : null,
        returnKm: status === "CLOSED" ? (vehicle.currentKm ?? 0) + index * 70 + days * 115 : null,
        expectedTotal,
        finalTotal,
        reason: "Noleggio demo per test calendario e contratti",
        internalNotes: `${DEMO_NOTE} ${code}`,
        contractSignedAt: contractStatusForBooking(status) === "SIGNED" ? addDays(pickupAt, -1, 16) : null
      }
    });
    counters.bookings += 1;

    await prisma.rentalBookingPricingSnapshot.upsert({
      where: { bookingId: booking.id },
      update: {
        priceListId: price.priceList.id,
        pricePackageId: price.pricePackage.id,
        extraKmPolicyId: price.extraKmPolicy.id,
        priceListName: price.priceList.name,
        pricePackageName: price.pricePackage.name,
        extraKmPolicyName: price.extraKmPolicy.name,
        baseRateUnit: RentalBaseRateUnit.DAILY,
        baseRateAmount: price.priceList.baseRateAmount,
        vatRate: 22,
        discountPercent: price.priceList.discountPercent,
        hourOverflowRule: RentalHourOverflowRule.FULL_DAY,
        estimatedKm: days * 120,
        actualKm: status === "CLOSED" ? days * 112 : null,
        includedKmTotal: (price.pricePackage.kmIncluded ?? 150) * days,
        extraKmEstimated: 0,
        extraKmActual: 0,
        daysCharged: days,
        expectedSubtotal,
        expectedTaxAmount,
        expectedTotal,
        finalSubtotal: finalTotal ? roundCurrency(finalTotal / 1.22) : null,
        finalTaxAmount: finalTotal ? roundCurrency(finalTotal - finalTotal / 1.22) : null,
        finalTotal,
        notes: `${DEMO_NOTE} Pricing snapshot ${code}`,
        metadata: { seed: "demo-tenant", code }
      },
      create: {
        tenantId: context.tenantId,
        bookingId: booking.id,
        priceListId: price.priceList.id,
        pricePackageId: price.pricePackage.id,
        extraKmPolicyId: price.extraKmPolicy.id,
        priceListName: price.priceList.name,
        pricePackageName: price.pricePackage.name,
        extraKmPolicyName: price.extraKmPolicy.name,
        baseRateUnit: RentalBaseRateUnit.DAILY,
        baseRateAmount: price.priceList.baseRateAmount,
        vatRate: 22,
        discountPercent: price.priceList.discountPercent,
        hourOverflowRule: RentalHourOverflowRule.FULL_DAY,
        estimatedKm: days * 120,
        actualKm: status === "CLOSED" ? days * 112 : null,
        includedKmTotal: (price.pricePackage.kmIncluded ?? 150) * days,
        extraKmEstimated: 0,
        extraKmActual: 0,
        daysCharged: days,
        expectedSubtotal,
        expectedTaxAmount,
        expectedTotal,
        finalSubtotal: finalTotal ? roundCurrency(finalTotal / 1.22) : null,
        finalTaxAmount: finalTotal ? roundCurrency(finalTotal - finalTotal / 1.22) : null,
        finalTotal,
        notes: `${DEMO_NOTE} Pricing snapshot ${code}`,
        metadata: { seed: "demo-tenant", code }
      }
    });
    counters.pricingSnapshots += 1;

    if (index < 18) {
      const contractStatus = bookingContractStatusForBooking(status, index);
      const contractNumber = demoCode("DEMO-CN", index + 1);
      const contract = await prisma.bookingContract.upsert({
        where: { bookingId: booking.id },
        update: {
          status: contractStatus,
          title: `Contratto noleggio ${contractNumber}`,
          content: [
            `# Contratto noleggio ${contractNumber}`,
            "",
            `${DEMO_NOTE}`,
            "",
            `Cliente: ${customerName}`,
            `Veicolo: ${vehicle.plate}`,
            `Periodo: ${pickupAt.toISOString()} - ${returnAt.toISOString()}`,
            `Totale previsto: EUR ${expectedTotal.toFixed(2)}`,
            "",
            "Documento demo non valido ai fini contrattuali."
          ].join("\n"),
          emailTo: customer.email,
          emailSubject: `Contratto demo Fleetum ${contractNumber}`,
          emailBody: "Email demo non inviata automaticamente.",
          signedAt: contractStatus === "SIGNED" ? addDays(pickupAt, -1, 17) : null,
          pdfFileName: `${contractNumber}.pdf`,
          pdfGeneratedAt: contractStatus === "SIGNED" || contractStatus === "READY" ? addDays(pickupAt, -1, 16) : null,
          updatedByUserId: context.adminUserId
        },
        create: {
          tenantId: context.tenantId,
          bookingId: booking.id,
          status: contractStatus,
          title: `Contratto noleggio ${contractNumber}`,
          content: [
            `# Contratto noleggio ${contractNumber}`,
            "",
            `${DEMO_NOTE}`,
            "",
            `Cliente: ${customerName}`,
            `Veicolo: ${vehicle.plate}`,
            `Periodo: ${pickupAt.toISOString()} - ${returnAt.toISOString()}`,
            `Totale previsto: EUR ${expectedTotal.toFixed(2)}`,
            "",
            "Documento demo non valido ai fini contrattuali."
          ].join("\n"),
          emailTo: customer.email,
          emailSubject: `Contratto demo Fleetum ${contractNumber}`,
          emailBody: "Email demo non inviata automaticamente.",
          signedAt: contractStatus === "SIGNED" ? addDays(pickupAt, -1, 17) : null,
          pdfFileName: `${contractNumber}.pdf`,
          pdfGeneratedAt: contractStatus === "SIGNED" || contractStatus === "READY" ? addDays(pickupAt, -1, 16) : null,
          createdByUserId: context.adminUserId,
          updatedByUserId: context.adminUserId
        }
      });
      counters.contracts += 1;

      await upsertByFirst({
        find: () => prisma.bookingContractEvent.findFirst({ where: { tenantId: context.tenantId, contractId: contract.id, type: "DEMO_SEEDED" } }),
        update: (existing) => prisma.bookingContractEvent.update({ where: { id: existing.id }, data: { message: `${DEMO_NOTE} ${contractNumber}` } }),
        create: () =>
          prisma.bookingContractEvent.create({
            data: {
              tenantId: context.tenantId,
              bookingId: booking.id,
              contractId: contract.id,
              actorUserId: context.adminUserId,
              type: "DEMO_SEEDED",
              message: `${DEMO_NOTE} ${contractNumber}`,
              details: { seed: "demo-tenant", contractNumber }
            }
          })
      });
      counters.contractEvents += 1;
    }
  }
};

const seedMaintenancesAndStoppages = async (
  context: SeedContext,
  vehicles: Awaited<ReturnType<typeof seedVehicles>>,
  sites: Awaited<ReturnType<typeof seedSites>>,
  workshops: Awaited<ReturnType<typeof seedWorkshops>>
) => {
  const now = new Date();
  const maintenanceTypes = ["Tagliando", "Cambio gomme", "Freni", "Revisione officina", "Carrozzeria", "Pulizia straordinaria"];

  for (let index = 0; index < 12; index += 1) {
    const vehicle = vehicles[index % vehicles.length];
    const code = `DEMO-MT-${String(index + 1).padStart(3, "0")}`;
    const description = `${code} ${maintenanceTypes[index % maintenanceTypes.length]} demo`;
    await upsertByFirst({
      find: () => prisma.vehicleMaintenance.findFirst({ where: { tenantId: context.tenantId, vehicleId: vehicle.id, description, deletedAt: null } }),
      update: (existing) =>
        prisma.vehicleMaintenance.update({
          where: { id: existing.id },
          data: {
            performedAt: addDays(now, index < 5 ? -42 + index * 5 : index < 9 ? 12 + index : -7 + index),
            maintenanceType: maintenanceTypes[index % maintenanceTypes.length],
            description,
            workshopName: workshops[index % workshops.length].name,
            kmAtService: (vehicle.currentKm ?? 20000) + index * 850,
            cost: 140 + index * 35,
            notes: DEMO_NOTE
          }
        }),
      create: () =>
        prisma.vehicleMaintenance.create({
          data: {
            tenantId: context.tenantId,
            vehicleId: vehicle.id,
            performedAt: addDays(now, index < 5 ? -42 + index * 5 : index < 9 ? 12 + index : -7 + index),
            maintenanceType: maintenanceTypes[index % maintenanceTypes.length],
            description,
            workshopName: workshops[index % workshops.length].name,
            kmAtService: (vehicle.currentKm ?? 20000) + index * 850,
            cost: 140 + index * 35,
            notes: DEMO_NOTE
          }
        })
    });
    counters.maintenances += 1;

    await upsertByFirst({
      find: () => prisma.vehicleCost.findFirst({ where: { tenantId: context.tenantId, vehicleId: vehicle.id, description: `${code} costo manutenzione demo`, deletedAt: null } }),
      update: (existing) => prisma.vehicleCost.update({ where: { id: existing.id }, data: { amount: 140 + index * 35, date: addDays(now, -30 + index), type: "MAINTENANCE" } }),
      create: () =>
        prisma.vehicleCost.create({
          data: {
            tenantId: context.tenantId,
            vehicleId: vehicle.id,
            type: "MAINTENANCE",
            description: `${code} costo manutenzione demo`,
            amount: 140 + index * 35,
            date: addDays(now, -30 + index),
            recurring: false
          }
        })
    });
    counters.vehicleCosts += 1;
  }

  const stoppageStatuses: StoppageStatus[] = ["OPEN", "IN_PROGRESS", "WAITING_PARTS", "CLOSED", "CLOSED", "CLOSED", "SOLICITED", "OPEN"];
  const priorities: StoppagePriority[] = ["HIGH", "CRITICAL", "MEDIUM", "LOW", "MEDIUM", "HIGH", "CRITICAL", "MEDIUM"];

  for (let index = 0; index < 8; index += 1) {
    const vehicle = vehicles[(index + 4) % vehicles.length];
    const site = sites[index % sites.length];
    const workshop = workshops[index % workshops.length];
    const code = `DEMO-ST-${String(index + 1).padStart(3, "0")}`;
    const status = stoppageStatuses[index];
    const openedAt = addDays(now, -18 + index * 3, 8);
    const closedAt = status === "CLOSED" ? addDays(openedAt, 2 + (index % 2), 17) : null;
    const stoppage = await upsertByFirst({
      find: () => prisma.stoppage.findFirst({ where: { tenantId: context.tenantId, vehicleId: vehicle.id, notes: { contains: code }, deletedAt: null } }),
      update: (existing) =>
        prisma.stoppage.update({
          where: { id: existing.id },
          data: {
            siteId: site.id,
            workshopId: workshop.id,
            createdByUserId: context.adminUserId,
            reason: `${code} Fermo tecnico demo`,
            notes: `${DEMO_NOTE} ${code}`,
            closureSummary: closedAt ? "Chiusura demo con veicolo rientrato operativo." : null,
            status,
            priority: priorities[index],
            assignedToUserId: context.adminUserId,
            estimatedCostPerDay: 85 + index * 12,
            openedAt,
            closedAt,
            reminderAfterDays: index % 2 === 0 ? 3 : 7,
            workshopEmailSnapshot: workshop.email,
            workshopPhoneSnapshot: workshop.phone,
            workshopWhatsappSnapshot: workshop.whatsapp
          }
        }),
      create: () =>
        prisma.stoppage.create({
          data: {
            tenantId: context.tenantId,
            siteId: site.id,
            vehicleId: vehicle.id,
            workshopId: workshop.id,
            createdByUserId: context.adminUserId,
            reason: `${code} Fermo tecnico demo`,
            notes: `${DEMO_NOTE} ${code}`,
            closureSummary: closedAt ? "Chiusura demo con veicolo rientrato operativo." : null,
            status,
            priority: priorities[index],
            assignedToUserId: context.adminUserId,
            estimatedCostPerDay: 85 + index * 12,
            openedAt,
            closedAt,
            reminderAfterDays: index % 2 === 0 ? 3 : 7,
            workshopEmailSnapshot: workshop.email,
            workshopPhoneSnapshot: workshop.phone,
            workshopWhatsappSnapshot: workshop.whatsapp
          }
        })
    });
    counters.stoppages += 1;

    await upsertByFirst({
      find: () => prisma.stoppageEvent.findFirst({ where: { tenantId: context.tenantId, stoppageId: stoppage.id, type: "DEMO_SEEDED" } }),
      update: (existing) => prisma.stoppageEvent.update({ where: { id: existing.id }, data: { message: `${DEMO_NOTE} ${code}` } }),
      create: () =>
        prisma.stoppageEvent.create({
          data: {
            tenantId: context.tenantId,
            stoppageId: stoppage.id,
            userId: context.adminUserId,
            type: "DEMO_SEEDED",
            message: `${DEMO_NOTE} ${code}`,
            payload: { seed: "demo-tenant", code }
          }
        })
    });
    counters.stoppageEvents += 1;
  }
};

const writeAuditLog = async (context: SeedContext) => {
  await prisma.auditLog.create({
    data: {
      tenantId: context.tenantId,
      userId: context.adminUserId,
      action: "DEMO_DATA_SEEDED",
      resource: "demo-tenant-seed",
      details: {
        counters,
        note: "Dataset demo idempotente creato o aggiornato. Nessuna email inviata, nessuna chiamata Stripe."
      }
    }
  });
  counters.auditLogs += 1;
};

async function main() {
  requireProductionOptIn();
  const context = await findSeedTenant();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: context.tenantId } });

  console.log(`Seed demo tenant avviato per tenant "${tenant.name}" (${context.tenantId}).`);
  console.log("Modalita non distruttiva: i record demo vengono creati/aggiornati, i record non-demo non vengono toccati.");

  const sites = await seedSites(context);
  const workshops = await seedWorkshops(context);
  const vehicles = await seedVehicles(context, sites);
  await seedVehicleCosts(context, vehicles);
  const customers = await seedCustomers(context);
  const pricing = await seedPricing(context, sites);
  await seedBookingsAndContracts(context, vehicles, customers, pricing);
  await seedMaintenancesAndStoppages(context, vehicles, sites, workshops);
  await writeAuditLog(context);

  console.log("Seed demo tenant completato.");
  console.table(counters);
}

main()
  .catch((error) => {
    console.error("Seed demo tenant fallito:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
