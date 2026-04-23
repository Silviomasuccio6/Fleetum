import { Prisma } from "@prisma/client";
import { Request, Response } from "express";
import { prisma } from "../../../infrastructure/database/prisma/client.js";
import { computeRentalQuote } from "../../../application/services/rental-pricing-service.js";
import {
  rentalPricingCreateExtraPolicySchema,
  rentalPricingCreateListSchema,
  rentalPricingCreatePackageSchema,
  rentalPricingListQuerySchema,
  rentalPricingQuoteSchema,
  rentalPricingUpdateExtraPolicySchema,
  rentalPricingUpdateListSchema,
  rentalPricingUpdatePackageSchema
} from "../validators/rental-bookings-validators.js";
import { AppError } from "../../../shared/errors/app-error.js";

const withDefined = <T extends Record<string, unknown>>(input: T): Partial<T> =>
  Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;

export class RentalPricingController {
  private async validateScopeRefs(input: {
    tenantId: string;
    scope: "GLOBAL" | "SITE" | "VEHICLE_CATEGORY" | "VEHICLE";
    siteId?: string;
    vehicleId?: string;
    vehicleCategory?: string;
  }) {
    if (input.scope === "SITE" && !input.siteId) {
      throw new AppError("Per scope SITE devi selezionare una sede.", 400, "RENTAL_PRICING_SITE_REQUIRED");
    }
    if (input.scope === "VEHICLE" && !input.vehicleId) {
      throw new AppError("Per scope VEHICLE devi selezionare un veicolo.", 400, "RENTAL_PRICING_VEHICLE_REQUIRED");
    }
    if (input.scope === "VEHICLE_CATEGORY" && !input.vehicleCategory) {
      throw new AppError("Per scope VEHICLE_CATEGORY devi indicare una categoria veicolo.", 400, "RENTAL_PRICING_CATEGORY_REQUIRED");
    }

    if (input.siteId) {
      const site = await prisma.site.findFirst({
        where: { tenantId: input.tenantId, id: input.siteId, deletedAt: null },
        select: { id: true }
      });
      if (!site) throw new AppError("Sede non valida per il tenant corrente.", 404, "RENTAL_PRICING_SITE_NOT_FOUND");
    }

    if (input.vehicleId) {
      const vehicle = await prisma.vehicle.findFirst({
        where: { tenantId: input.tenantId, id: input.vehicleId, deletedAt: null, isActive: true },
        select: { id: true }
      });
      if (!vehicle) throw new AppError("Veicolo non valido per il tenant corrente.", 404, "RENTAL_PRICING_VEHICLE_NOT_FOUND");
    }
  }

  private async getPriceListOrThrow(tenantId: string, id: string) {
    const list = await prisma.rentalPriceList.findFirst({
      where: { tenantId, id, deletedAt: null }
    });
    if (!list) throw new AppError("Listino non trovato.", 404, "RENTAL_PRICE_LIST_NOT_FOUND");
    return list;
  }

  private async getQuoteSetupOrThrow(input: {
    tenantId: string;
    priceListId: string;
    pricePackageId?: string | null;
    extraKmPolicyId?: string | null;
  }) {
    const list = await prisma.rentalPriceList.findFirst({
      where: { tenantId: input.tenantId, id: input.priceListId, deletedAt: null },
      include: {
        packages: {
          where: { deletedAt: null, isActive: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
        },
        extraKmPolicies: {
          where: { deletedAt: null, isActive: true },
          include: {
            tiers: {
              where: { tenantId: input.tenantId },
              orderBy: [{ sortOrder: "asc" }, { fromKm: "asc" }]
            }
          },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
        }
      }
    });

    if (!list) throw new AppError("Listino non trovato.", 404, "RENTAL_PRICE_LIST_NOT_FOUND");

    const selectedPackage = input.pricePackageId
      ? list.packages.find((pkg) => pkg.id === input.pricePackageId) ?? null
      : (list.packages.find((pkg) => pkg.isDefault) ?? list.packages[0] ?? null);

    if (input.pricePackageId && !selectedPackage) {
      throw new AppError("Pacchetto km non trovato per il listino selezionato.", 404, "RENTAL_PRICE_PACKAGE_NOT_FOUND");
    }

    const matchingPolicies = list.extraKmPolicies.filter((policy) => {
      if (!selectedPackage) return policy.packageId == null;
      return policy.packageId == null || policy.packageId === selectedPackage.id;
    });

    const selectedPolicy = input.extraKmPolicyId
      ? matchingPolicies.find((policy) => policy.id === input.extraKmPolicyId) ?? null
      : (matchingPolicies.find((policy) => policy.isDefault) ?? matchingPolicies[0] ?? null);

    if (input.extraKmPolicyId && !selectedPolicy) {
      throw new AppError("Tariffario km extra non trovato per il listino/pacchetto selezionato.", 404, "RENTAL_EXTRA_POLICY_NOT_FOUND");
    }

    return { list, selectedPackage, selectedPolicy, matchingPolicies };
  }

  listLists = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const query = rentalPricingListQuerySchema.parse(req.query);
    const pagination = { skip: (query.page - 1) * query.pageSize, take: query.pageSize };

    const where: Prisma.RentalPriceListWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.siteId ? { siteId: query.siteId } : {}),
      ...(query.scope ? { scope: query.scope } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { description: { contains: query.search, mode: "insensitive" } },
              { vehicleCategory: { contains: query.search, mode: "insensitive" } }
            ]
          }
        : {})
    };

    const [total, data] = await Promise.all([
      prisma.rentalPriceList.count({ where }),
      prisma.rentalPriceList.findMany({
        where,
        ...pagination,
        orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
        include: {
          site: { select: { id: true, name: true, city: true } },
          vehicle: { select: { id: true, plate: true, brand: true, model: true } },
          _count: { select: { packages: true, extraKmPolicies: true, bookingSnapshots: true } }
        }
      })
    ]);

    res.json({ data, total, page: query.page, pageSize: query.pageSize });
  };

  createList = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const payload = rentalPricingCreateListSchema.parse(req.body);

    await this.validateScopeRefs({
      tenantId,
      scope: payload.scope,
      siteId: payload.scope === "SITE" ? payload.siteId : undefined,
      vehicleId: payload.scope === "VEHICLE" ? payload.vehicleId : undefined,
      vehicleCategory: payload.scope === "VEHICLE_CATEGORY" ? payload.vehicleCategory : undefined
    });

    const created = await prisma.rentalPriceList.create({
      data: {
        tenantId,
        name: payload.name,
        description: payload.description,
        isActive: payload.isActive,
        validFrom: payload.validFrom,
        validTo: payload.validTo,
        scope: payload.scope,
        siteId: payload.scope === "SITE" ? payload.siteId ?? null : null,
        vehicleId: payload.scope === "VEHICLE" ? payload.vehicleId ?? null : null,
        vehicleCategory: payload.scope === "VEHICLE_CATEGORY" ? payload.vehicleCategory ?? null : null,
        baseRateUnit: payload.baseRateUnit,
        baseRateAmount: payload.baseRateAmount,
        vatRate: payload.vatRate,
        discountPercent: payload.discountPercent,
        hourOverflowRule: payload.hourOverflowRule,
        priority: payload.priority
      }
    });

    res.status(201).json(created);
  };

  updateList = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const payload = rentalPricingUpdateListSchema.parse(req.body);
    const current = await this.getPriceListOrThrow(tenantId, req.params.id);

    const nextScope = payload.scope ?? current.scope;
    const nextSiteId = payload.siteId ?? current.siteId ?? undefined;
    const nextVehicleId = payload.vehicleId ?? current.vehicleId ?? undefined;
    const nextVehicleCategory = payload.vehicleCategory ?? current.vehicleCategory ?? undefined;

    await this.validateScopeRefs({
      tenantId,
      scope: nextScope,
      siteId: nextScope === "SITE" ? nextSiteId : undefined,
      vehicleId: nextScope === "VEHICLE" ? nextVehicleId : undefined,
      vehicleCategory: nextScope === "VEHICLE_CATEGORY" ? nextVehicleCategory : undefined
    });

    const updated = await prisma.rentalPriceList.update({
      where: { id: current.id },
      data: {
        ...withDefined({
          name: payload.name,
          description: payload.description,
          isActive: payload.isActive,
          validFrom: payload.validFrom,
          validTo: payload.validTo,
          baseRateUnit: payload.baseRateUnit,
          baseRateAmount: payload.baseRateAmount,
          vatRate: payload.vatRate,
          discountPercent: payload.discountPercent,
          hourOverflowRule: payload.hourOverflowRule,
          priority: payload.priority,
          scope: payload.scope
        }),
        ...(payload.scope !== undefined || payload.siteId !== undefined || payload.vehicleId !== undefined || payload.vehicleCategory !== undefined
          ? {
              siteId: nextScope === "SITE" ? nextSiteId ?? null : null,
              vehicleId: nextScope === "VEHICLE" ? nextVehicleId ?? null : null,
              vehicleCategory: nextScope === "VEHICLE_CATEGORY" ? nextVehicleCategory ?? null : null
            }
          : {})
      }
    });

    res.json(updated);
  };

  removeList = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const current = await this.getPriceListOrThrow(tenantId, req.params.id);

    await prisma.rentalPriceList.update({
      where: { id: current.id },
      data: { deletedAt: new Date(), isActive: false }
    });

    res.status(204).send();
  };

  listPackages = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const listId = req.params.id;
    await this.getPriceListOrThrow(tenantId, listId);

    const data = await prisma.rentalPricePackage.findMany({
      where: { tenantId, priceListId: listId, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
    });

    res.json({ data });
  };

  createPackage = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const listId = req.params.id;
    const payload = rentalPricingCreatePackageSchema.parse(req.body);
    await this.getPriceListOrThrow(tenantId, listId);

    const created = await prisma.$transaction(async (tx) => {
      if (payload.isDefault) {
        await tx.rentalPricePackage.updateMany({
          where: { tenantId, priceListId: listId, deletedAt: null },
          data: { isDefault: false }
        });
      }

      return tx.rentalPricePackage.create({
        data: {
          tenantId,
          priceListId: listId,
          name: payload.name,
          code: payload.code,
          type: payload.type,
          kmIncluded: payload.type === "UNLIMITED" ? null : payload.kmIncluded,
          kmScope: payload.kmScope,
          isDefault: payload.isDefault,
          isActive: payload.isActive,
          sortOrder: payload.sortOrder
        }
      });
    });

    res.status(201).json(created);
  };

  updatePackage = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const payload = rentalPricingUpdatePackageSchema.parse(req.body);

    const current = await prisma.rentalPricePackage.findFirst({
      where: { tenantId, id: req.params.id, deletedAt: null }
    });
    if (!current) throw new AppError("Pacchetto km non trovato.", 404, "RENTAL_PRICE_PACKAGE_NOT_FOUND");

    const updated = await prisma.$transaction(async (tx) => {
      if (payload.isDefault) {
        await tx.rentalPricePackage.updateMany({
          where: { tenantId, priceListId: current.priceListId, deletedAt: null },
          data: { isDefault: false }
        });
      }

      return tx.rentalPricePackage.update({
        where: { id: current.id },
        data: {
          ...withDefined({
            name: payload.name,
            code: payload.code,
            type: payload.type,
            kmScope: payload.kmScope,
            isDefault: payload.isDefault,
            isActive: payload.isActive,
            sortOrder: payload.sortOrder
          }),
          ...(payload.type === "UNLIMITED" ? { kmIncluded: null } : {}),
          ...(payload.type !== "UNLIMITED" && payload.kmIncluded !== undefined ? { kmIncluded: payload.kmIncluded } : {})
        }
      });
    });

    res.json(updated);
  };

  removePackage = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const current = await prisma.rentalPricePackage.findFirst({
      where: { tenantId, id: req.params.id, deletedAt: null }
    });
    if (!current) throw new AppError("Pacchetto km non trovato.", 404, "RENTAL_PRICE_PACKAGE_NOT_FOUND");

    await prisma.rentalPricePackage.update({
      where: { id: current.id },
      data: { deletedAt: new Date(), isActive: false, isDefault: false }
    });

    res.status(204).send();
  };

  listExtraPolicies = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const listId = typeof req.query.priceListId === "string" ? req.query.priceListId : undefined;
    const packageId = typeof req.query.packageId === "string" ? req.query.packageId : undefined;

    const where: Prisma.RentalExtraKmPolicyWhereInput = {
      tenantId,
      deletedAt: null,
      ...(listId ? { priceListId: listId } : {}),
      ...(packageId ? { packageId } : {})
    };

    const data = await prisma.rentalExtraKmPolicy.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        tiers: { where: { tenantId }, orderBy: [{ sortOrder: "asc" }, { fromKm: "asc" }] }
      }
    });

    res.json({ data });
  };

  createExtraPolicy = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const payload = rentalPricingCreateExtraPolicySchema.parse(req.body);

    const body = req.body as Record<string, unknown>;
    const priceListId = String(body.priceListId ?? "").trim();
    if (!priceListId) throw new AppError("priceListId obbligatorio", 400, "RENTAL_PRICE_LIST_REQUIRED");

    await this.getPriceListOrThrow(tenantId, priceListId);
    if (payload.packageId) {
      const pkg = await prisma.rentalPricePackage.findFirst({
        where: { tenantId, id: payload.packageId, priceListId, deletedAt: null },
        select: { id: true }
      });
      if (!pkg) throw new AppError("Pacchetto km non valido per il listino selezionato", 404, "RENTAL_PRICE_PACKAGE_NOT_FOUND");
    }

    const created = await prisma.$transaction(async (tx) => {
      if (payload.isDefault) {
        await tx.rentalExtraKmPolicy.updateMany({
          where: {
            tenantId,
            priceListId,
            packageId: payload.packageId ?? null,
            deletedAt: null
          },
          data: { isDefault: false }
        });
      }

      const policy = await tx.rentalExtraKmPolicy.create({
        data: {
          tenantId,
          priceListId,
          packageId: payload.packageId ?? null,
          name: payload.name,
          type: payload.type,
          flatRatePerKm: payload.type === "FLAT" ? payload.flatRatePerKm ?? 0 : null,
          isDefault: payload.isDefault,
          isActive: payload.isActive,
          sortOrder: payload.sortOrder
        }
      });

      if (payload.type === "TIERED") {
        for (const tier of payload.tiers ?? []) {
          await tx.rentalExtraKmTier.create({
            data: {
              tenantId,
              policyId: policy.id,
              fromKm: tier.fromKm,
              toKm: tier.toKm ?? null,
              ratePerKm: tier.ratePerKm,
              sortOrder: tier.sortOrder ?? 0
            }
          });
        }
      }

      return tx.rentalExtraKmPolicy.findFirst({
        where: { id: policy.id },
        include: { tiers: { where: { tenantId }, orderBy: [{ sortOrder: "asc" }, { fromKm: "asc" }] } }
      });
    });

    res.status(201).json(created);
  };

  updateExtraPolicy = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const current = await prisma.rentalExtraKmPolicy.findFirst({
      where: { tenantId, id: req.params.id, deletedAt: null },
      include: { tiers: true }
    });
    if (!current) throw new AppError("Tariffario extra km non trovato.", 404, "RENTAL_EXTRA_POLICY_NOT_FOUND");

    const payload = rentalPricingUpdateExtraPolicySchema.parse(req.body);
    const rawPackageId = typeof (req.body as Record<string, unknown>).packageId === "string"
      ? String((req.body as Record<string, unknown>).packageId).trim()
      : undefined;
    const normalizedPackageId = rawPackageId === "" ? null : payload.packageId;

    if (normalizedPackageId) {
      const pkg = await prisma.rentalPricePackage.findFirst({
        where: { tenantId, id: normalizedPackageId, priceListId: current.priceListId, deletedAt: null },
        select: { id: true }
      });
      if (!pkg) throw new AppError("Pacchetto km non valido per il listino selezionato", 404, "RENTAL_PRICE_PACKAGE_NOT_FOUND");
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (payload.isDefault) {
        await tx.rentalExtraKmPolicy.updateMany({
          where: {
            tenantId,
            priceListId: current.priceListId,
            packageId: normalizedPackageId ?? current.packageId ?? null,
            deletedAt: null
          },
          data: { isDefault: false }
        });
      }

      const policy = await tx.rentalExtraKmPolicy.update({
        where: { id: current.id },
        data: {
          ...withDefined({
            name: payload.name,
            type: payload.type,
            isDefault: payload.isDefault,
            isActive: payload.isActive,
            sortOrder: payload.sortOrder
          }),
          ...(rawPackageId !== undefined ? { packageId: normalizedPackageId } : {}),
          ...(payload.type === "FLAT" ? { flatRatePerKm: payload.flatRatePerKm ?? 0 } : {}),
          ...(payload.type === "TIERED" ? { flatRatePerKm: null } : {})
        }
      });

      if (payload.type === "TIERED" || payload.tiers) {
        await tx.rentalExtraKmTier.deleteMany({ where: { tenantId, policyId: current.id } });
        const tiers = payload.tiers ?? [];
        for (const tier of tiers) {
          await tx.rentalExtraKmTier.create({
            data: {
              tenantId,
              policyId: current.id,
              fromKm: tier.fromKm,
              toKm: tier.toKm ?? null,
              ratePerKm: tier.ratePerKm,
              sortOrder: tier.sortOrder ?? 0
            }
          });
        }
      }

      return tx.rentalExtraKmPolicy.findFirst({
        where: { id: policy.id },
        include: { tiers: { where: { tenantId }, orderBy: [{ sortOrder: "asc" }, { fromKm: "asc" }] } }
      });
    });

    res.json(updated);
  };

  removeExtraPolicy = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const current = await prisma.rentalExtraKmPolicy.findFirst({
      where: { tenantId, id: req.params.id, deletedAt: null }
    });
    if (!current) throw new AppError("Tariffario extra km non trovato.", 404, "RENTAL_EXTRA_POLICY_NOT_FOUND");

    await prisma.$transaction(async (tx) => {
      await tx.rentalExtraKmTier.deleteMany({ where: { tenantId, policyId: current.id } });
      await tx.rentalExtraKmPolicy.update({
        where: { id: current.id },
        data: { deletedAt: new Date(), isActive: false, isDefault: false }
      });
    });

    res.status(204).send();
  };

  previewQuote = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const payload = rentalPricingQuoteSchema.parse(req.body);

    const setup = await this.getQuoteSetupOrThrow({
      tenantId,
      priceListId: payload.priceListId,
      pricePackageId: payload.pricePackageId,
      extraKmPolicyId: payload.extraKmPolicyId
    });

    const quote = computeRentalQuote({
      priceList: setup.list,
      pricePackage: setup.selectedPackage,
      extraKmPolicy: setup.selectedPolicy,
      pickupAt: payload.pickupAt,
      returnAt: payload.returnAt,
      estimatedKm: payload.estimatedKm,
      actualKm: payload.actualKm
    });

    res.json({
      quote,
      selected: {
        priceList: {
          id: setup.list.id,
          name: setup.list.name,
          baseRateUnit: setup.list.baseRateUnit,
          baseRateAmount: setup.list.baseRateAmount,
          vatRate: setup.list.vatRate,
          discountPercent: setup.list.discountPercent,
          hourOverflowRule: setup.list.hourOverflowRule
        },
        pricePackage: setup.selectedPackage,
        extraKmPolicy: setup.selectedPolicy
      }
    });
  };

  finalizeQuote = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const payload = rentalPricingQuoteSchema.parse(req.body);

    const setup = await this.getQuoteSetupOrThrow({
      tenantId,
      priceListId: payload.priceListId,
      pricePackageId: payload.pricePackageId,
      extraKmPolicyId: payload.extraKmPolicyId
    });

    const quote = computeRentalQuote({
      priceList: setup.list,
      pricePackage: setup.selectedPackage,
      extraKmPolicy: setup.selectedPolicy,
      pickupAt: payload.pickupAt,
      returnAt: payload.returnAt,
      estimatedKm: payload.estimatedKm,
      actualKm: payload.actualKm
    });

    res.json({
      quote,
      selected: {
        priceList: {
          id: setup.list.id,
          name: setup.list.name,
          baseRateUnit: setup.list.baseRateUnit,
          baseRateAmount: setup.list.baseRateAmount,
          vatRate: setup.list.vatRate,
          discountPercent: setup.list.discountPercent,
          hourOverflowRule: setup.list.hourOverflowRule
        },
        pricePackage: setup.selectedPackage,
        extraKmPolicy: setup.selectedPolicy
      }
    });
  };
}
