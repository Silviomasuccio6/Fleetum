import { Prisma } from "@prisma/client";

/**
 * Serializes credential and session mutations for one tenant user.
 *
 * Call this before touching password-reset tokens or refresh sessions inside an
 * interactive transaction. Keeping one lock order prevents a password reset
 * from missing a refresh session that is being rotated concurrently.
 */
export const lockUserForAuthMutation = async (tx: Prisma.TransactionClient, userId: string) => {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "User"
    WHERE "id" = ${userId}
    FOR UPDATE
  `;
  return rows.length === 1;
};
