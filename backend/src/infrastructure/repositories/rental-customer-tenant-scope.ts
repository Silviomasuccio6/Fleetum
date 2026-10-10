import type { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/app-error.js";

const customerNotFound = () => new AppError("Cliente non trovato", 404, "CUSTOMER_NOT_FOUND");

// All subject attachment writes and erasure use this order: Tenant -> Customer.
// The row stays locked through attachment discovery, state validation and commit.
// NO KEY UPDATE also permits FK KEY SHARE locks from retained booking records.
export const lockOwnedRentalCustomer = async (
  tx: Prisma.TransactionClient,
  tenantId: string,
  customerId: string,
  includeDeleted = false
) => {
  const tenant = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Tenant" WHERE "id" = ${tenantId} FOR KEY SHARE
  `;
  if (!tenant.length) throw customerNotFound();
  const customers = await tx.$queryRaw<Array<{ id: string; deletedAt: Date | null }>>`
    SELECT "id", "deletedAt" FROM "RentalCustomer"
    WHERE "id" = ${customerId} AND "tenantId" = ${tenantId} FOR NO KEY UPDATE
  `;
  const customer = customers[0];
  if (!customer || (!includeDeleted && customer.deletedAt)) throw customerNotFound();
  return customer;
};
