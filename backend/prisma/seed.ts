import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { PrismaClient, RoleKey } from "@prisma/client";

const prisma = new PrismaClient();

const permissionKeys = [
  "dashboard:read",
  "sites:read",
  "sites:write",
  "workshops:read",
  "workshops:write",
  "vehicles:read",
  "vehicles:write",
  "stoppages:read",
  "stoppages:write",
  "stoppages:delete",
  "stoppages:remind",
  "users:read",
  "users:write",
  "stats:read",
  "billing:read",
  "billing:manage",
  "rental-payments:read",
  "rental-payments:write",
  "rental-payments:charge",
  "rental-payments:refund",
  "privacy:export",
  "privacy:manage",
  "reports:export",
  "vehicle:economics:read"
];

const rolePermissions: Record<RoleKey, string[]> = {
  ADMIN: permissionKeys,
  MANAGER: permissionKeys.filter(
    (key) => !["users:write", "billing:read", "billing:manage", "rental-payments:refund", "privacy:export", "privacy:manage"].includes(key)
  ),
  OPERATOR: [
    "dashboard:read",
    "sites:read",
    "workshops:read",
    "vehicles:read",
    "vehicles:write",
    "stoppages:read",
    "stoppages:write",
    "stoppages:remind",
    "rental-payments:read",
    "rental-payments:write",
    "stats:read"
  ],
  VIEWER: ["dashboard:read", "sites:read", "workshops:read", "vehicles:read", "stoppages:read", "rental-payments:read", "stats:read"]
};

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Seed demo disabilitato in produzione");
  }

  const configuredDemoPassword = process.env.DEMO_ADMIN_PASSWORD?.trim();
  if (configuredDemoPassword && configuredDemoPassword.length < 12) {
    throw new Error("DEMO_ADMIN_PASSWORD deve avere almeno 12 caratteri");
  }
  const demoAdminPassword = configuredDemoPassword || crypto.randomBytes(18).toString("base64url");

  for (const key of permissionKeys) {
    await prisma.permission.upsert({
      where: { key },
      update: { description: key },
      create: { key, description: key }
    });
  }

  for (const key of Object.keys(rolePermissions) as RoleKey[]) {
    const role = await prisma.role.upsert({
      where: { key },
      update: { name: key },
      create: { key, name: key }
    });

    for (const permissionKey of rolePermissions[key]) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { key: permissionKey } });
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id
          }
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permission.id
        }
      });
    }
  }

  const tenant = await prisma.tenant.upsert({
    where: { id: "demo_tenant" },
    update: { name: "Demo Tenant" },
    create: {
      id: "demo_tenant",
      name: "Demo Tenant"
    }
  });

  const passwordHash = await bcrypt.hash(demoAdminPassword, 12);
  const admin = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: tenant.id,
        email: "admin@demo.local"
      }
    },
    update: {
      passwordHash,
      firstName: "System",
      lastName: "Admin"
    },
    create: {
      tenantId: tenant.id,
      email: "admin@demo.local",
      passwordHash,
      firstName: "System",
      lastName: "Admin",
      isEmailVerified: true
    }
  });

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: RoleKey.ADMIN } });
  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: admin.id,
        roleId: adminRole.id
      }
    },
    update: {},
    create: {
      userId: admin.id,
      roleId: adminRole.id
    }
  });

  console.log("Seed completato");
  console.log(`Demo admin: admin@demo.local`);
  if (!configuredDemoPassword) {
    console.log(`Demo password generata: ${demoAdminPassword}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
