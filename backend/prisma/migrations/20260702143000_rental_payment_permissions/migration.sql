-- Grant rental payment / guarantee permissions to existing production roles.
-- The original rental-payment foundation migration creates the operational tables,
-- while this migration aligns existing tenants with the permissions already used by seed.ts.

INSERT INTO "Permission" ("id", "key", "description", "createdAt", "updatedAt")
VALUES
  ('perm_' || md5('rental-payments:read'), 'rental-payments:read', 'View rental customer payment methods, deposits and extra charges', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perm_' || md5('rental-payments:write'), 'rental-payments:write', 'Create rental customer card setup sessions and extra charges', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perm_' || md5('rental-payments:charge'), 'rental-payments:charge', 'Authorize, capture and release rental deposits or approved extra charges', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perm_' || md5('rental-payments:refund'), 'rental-payments:refund', 'Manage rental payment refunds when supported by the workflow', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE
SET "description" = EXCLUDED."description", "updatedAt" = CURRENT_TIMESTAMP;

WITH grants (role_key, permission_key) AS (
  VALUES
    ('ADMIN'::"RoleKey", 'rental-payments:read'),
    ('ADMIN'::"RoleKey", 'rental-payments:write'),
    ('ADMIN'::"RoleKey", 'rental-payments:charge'),
    ('ADMIN'::"RoleKey", 'rental-payments:refund'),
    ('MANAGER'::"RoleKey", 'rental-payments:read'),
    ('MANAGER'::"RoleKey", 'rental-payments:write'),
    ('MANAGER'::"RoleKey", 'rental-payments:charge'),
    ('OPERATOR'::"RoleKey", 'rental-payments:read'),
    ('OPERATOR'::"RoleKey", 'rental-payments:write'),
    ('VIEWER'::"RoleKey", 'rental-payments:read')
)
INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT
  'rp_' || md5(r."id" || ':' || p."id"),
  r."id",
  p."id"
FROM grants
JOIN "Role" AS r ON r."key" = grants.role_key
JOIN "Permission" AS p ON p."key" = grants.permission_key
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
