-- Separate billing, privacy and financial-report operations from broad operational permissions.
-- Existing role memberships are preserved; this migration only creates the new capabilities and grants them deliberately.
INSERT INTO "Permission" ("id", "key", "description", "createdAt", "updatedAt")
VALUES
  ('perm_' || md5('billing:read'), 'billing:read', 'View Fleetum subscription invoices and billing documents', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perm_' || md5('billing:manage'), 'billing:manage', 'Manage Fleetum subscription checkout and payment method', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perm_' || md5('privacy:export'), 'privacy:export', 'Export rental customer personal data', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perm_' || md5('privacy:manage'), 'privacy:manage', 'Run privacy erasure and retention operations', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perm_' || md5('reports:export'), 'reports:export', 'Export operational and financial reports', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perm_' || md5('vehicle:economics:read'), 'vehicle:economics:read', 'View vehicle cost, margin and profitability data', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE
SET "description" = EXCLUDED."description", "updatedAt" = CURRENT_TIMESTAMP;

WITH grants (role_key, permission_key) AS (
  VALUES
    ('ADMIN'::"RoleKey", 'billing:read'),
    ('ADMIN'::"RoleKey", 'billing:manage'),
    ('ADMIN'::"RoleKey", 'privacy:export'),
    ('ADMIN'::"RoleKey", 'privacy:manage'),
    ('ADMIN'::"RoleKey", 'reports:export'),
    ('ADMIN'::"RoleKey", 'vehicle:economics:read'),
    ('MANAGER'::"RoleKey", 'reports:export'),
    ('MANAGER'::"RoleKey", 'vehicle:economics:read')
)
INSERT INTO "RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT
  'rp_' || md5(role."id" || ':' || permission."id"),
  role."id",
  permission."id",
  CURRENT_TIMESTAMP
FROM grants
JOIN "Role" AS role ON role."key" = grants.role_key
JOIN "Permission" AS permission ON permission."key" = grants.permission_key
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
