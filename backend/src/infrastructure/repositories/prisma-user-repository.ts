import { RoleKey } from "@prisma/client";
import { UserEntity } from "../../domain/entities/user.js";
import { UserRepository } from "../../domain/repositories/user-repository.js";
import { prisma } from "../database/prisma/client.js";

const userWithRolesInclude = {
  roles: {
    include: {
      role: {
        include: {
          permissions: { include: { permission: true } }
        }
      }
    }
  }
} as const;

const toEntity = (user: {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  status: "ACTIVE" | "INVITED" | "SUSPENDED";
  roles: { role: { key: RoleKey; permissions: { permission: { key: string } }[] } }[];
}): UserEntity => ({
  id: user.id,
  tenantId: user.tenantId,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  status: user.status,
  roles: user.roles.map((entry) => entry.role.key),
  permissions: Array.from(new Set(user.roles.flatMap((entry) => entry.role.permissions.map((item) => item.permission.key))))
});

export class PrismaUserRepository implements UserRepository {
  async findByEmail(tenantId: string, email: string): Promise<UserEntity | null> {
    const user = await prisma.user.findFirst({
      where: { tenantId, email, deletedAt: null },
      include: userWithRolesInclude
    });

    return user ? toEntity(user) : null;
  }

  async findById(userId: string): Promise<UserEntity | null> {
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: userWithRolesInclude
    });

    return user ? toEntity(user) : null;
  }

  private async findByIdInTenant(tenantId: string, userId: string): Promise<UserEntity | null> {
    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
      include: userWithRolesInclude
    });

    return user ? toEntity(user) : null;
  }

  async create(input: {
    tenantId: string;
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    roleKey?: "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";
  }): Promise<UserEntity> {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: input.roleKey ?? "OPERATOR" } });
    const user = await prisma.user.create({
      data: {
        tenantId: input.tenantId,
        email: input.email,
        passwordHash: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        roles: {
          create: {
            roleId: role.id
          }
        }
      },
      include: userWithRolesInclude
    });

    return toEntity(user);
  }

  async list(tenantId: string): Promise<UserEntity[]> {
    const users = await prisma.user.findMany({
      where: { tenantId, deletedAt: null },
      include: userWithRolesInclude
    });

    return users.map(toEntity);
  }

  async listRoles(): Promise<Array<"ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER">> {
    const roles = await prisma.role.findMany({ orderBy: { key: "asc" } });
    return roles.map((role) => role.key);
  }

  async updateProfile(
    tenantId: string,
    userId: string,
    input: Partial<{ firstName: string; lastName: string; status: "ACTIVE" | "INVITED" | "SUSPENDED" }>
  ): Promise<UserEntity | null> {
    await prisma.user.updateMany({
      where: { id: userId, tenantId, deletedAt: null },
      data: input
    });
    return this.findByIdInTenant(tenantId, userId);
  }

  async setRole(tenantId: string, userId: string, roleKey: "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER"): Promise<UserEntity | null> {
    return prisma.$transaction(async (tx) => {
      // Use the same user-row lock as credential/session mutations, scoped to
      // the requester tenant before any role relation is read or modified.
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "User"
        WHERE "id" = ${userId} AND "tenantId" = ${tenantId} AND "deletedAt" IS NULL
        FOR UPDATE
      `;
      if (rows.length !== 1) return null;

      const role = await tx.role.findUniqueOrThrow({ where: { key: roleKey } });
      await tx.userRole.deleteMany({ where: { userId } });
      await tx.userRole.create({ data: { userId, roleId: role.id } });
      const updated = await tx.user.findFirst({
        where: { id: userId, tenantId, deletedAt: null },
        include: userWithRolesInclude
      });
      return updated ? toEntity(updated) : null;
    });
  }

  async softDelete(tenantId: string, userId: string): Promise<void> {
    await prisma.user.updateMany({
      where: { id: userId, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), status: "SUSPENDED" }
    });
  }
}
