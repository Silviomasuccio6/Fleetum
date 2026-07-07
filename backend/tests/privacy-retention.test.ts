import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { PrivacyComplianceService } from "../src/application/services/privacy-compliance-service.js";
import { prisma } from "../src/infrastructure/database/prisma/client.js";
import { storageProvider } from "../src/infrastructure/storage/storage-provider.js";

const original = {
  passwordResetTokenCount: prisma.passwordResetToken.count,
  invitationTokenCount: prisma.invitationToken.count,
  refreshSessionCount: prisma.refreshSession.count,
  rentalCustomerAttachmentCount: prisma.rentalCustomerAttachment.count,
  storedFileObjectCount: prisma.storedFileObject.count,
  rentalCustomerAttachmentFindMany: prisma.rentalCustomerAttachment.findMany,
  storedFileObjectFindMany: prisma.storedFileObject.findMany,
  transaction: prisma.$transaction,
  storageDelete: storageProvider.delete
};

afterEach(() => {
  (prisma.passwordResetToken as any).count = original.passwordResetTokenCount;
  (prisma.invitationToken as any).count = original.invitationTokenCount;
  (prisma.refreshSession as any).count = original.refreshSessionCount;
  (prisma.rentalCustomerAttachment as any).count = original.rentalCustomerAttachmentCount;
  (prisma.storedFileObject as any).count = original.storedFileObjectCount;
  (prisma.rentalCustomerAttachment as any).findMany = original.rentalCustomerAttachmentFindMany;
  (prisma.storedFileObject as any).findMany = original.storedFileObjectFindMany;
  (prisma as any).$transaction = original.transaction;
  (storageProvider as any).delete = original.storageDelete;
});

const mockPreviewCounts = () => {
  (prisma.passwordResetToken as any).count = async () => 1;
  (prisma.invitationToken as any).count = async () => 2;
  (prisma.refreshSession as any).count = async () => 3;
  (prisma.rentalCustomerAttachment as any).count = async () => 4;
  (prisma.storedFileObject as any).count = async (input: any) => {
    assert.equal(input.where.tenantId, "tenant_a");
    assert.equal(input.where.provider, storageProvider.name);
    assert.ok(input.where.deletedAt.lt instanceof Date);
    return 5;
  };
};

test("privacy retention preview includes soft-deleted stored file objects for the active provider", async () => {
  mockPreviewCounts();

  const result = await new PrivacyComplianceService().previewRetention({
    tenantId: "tenant_a",
    deletedStoredFileObjectGraceDays: 12
  });

  assert.equal(result.mode, "dry_run");
  assert.equal(result.candidates.passwordResetTokens, 1);
  assert.equal(result.candidates.deletedCustomerAttachments, 4);
  assert.equal(result.candidates.deletedStoredFileObjects, 5);
  assert.ok(result.cutoffs.deletedStoredFileCutoff);
});

test("privacy retention deletes expired stored file metadata and removes physical files", async () => {
  mockPreviewCounts();
  const deletedKeys: string[] = [];
  let auditPayload: any;

  (prisma.rentalCustomerAttachment as any).findMany = async () => [
    { id: "att_1", filePath: "uploads/customers/att-1.pdf" }
  ];
  (prisma.storedFileObject as any).findMany = async (input: any) => {
    assert.equal(input.where.tenantId, "tenant_a");
    return [
      { id: "file_1", storageKey: "uploads/logos/logo-old.png" },
      { id: "file_2", storageKey: "uploads/contracts/signature-old.png" }
    ];
  };
  (storageProvider as any).delete = async (key: string) => {
    deletedKeys.push(key);
  };
  (prisma as any).$transaction = async (callback: any) =>
    callback({
      passwordResetToken: { deleteMany: async () => ({ count: 1 }) },
      invitationToken: { deleteMany: async () => ({ count: 2 }) },
      refreshSession: { deleteMany: async () => ({ count: 3 }) },
      rentalCustomerAttachment: { deleteMany: async () => ({ count: 1 }) },
      storedFileObject: {
        deleteMany: async (input: any) => {
          assert.deepEqual(input.where.id.in, ["file_1", "file_2"]);
          return { count: 2 };
        }
      },
      auditLog: {
        create: async (input: any) => {
          auditPayload = input.data;
          return input.data;
        }
      }
    });

  const result = await new PrivacyComplianceService().runRetention({
    tenantId: "tenant_a",
    userId: null,
    confirmation: "RUN_RETENTION",
    deletedStoredFileObjectGraceDays: 12
  });

  assert.equal(result.executed, true);
  assert.equal(result.deleted.deletedStoredFileObjects, 2);
  assert.deepEqual(deletedKeys.sort(), [
    "uploads/contracts/signature-old.png",
    "uploads/customers/att-1.pdf",
    "uploads/logos/logo-old.png"
  ]);
  assert.equal(auditPayload.action, "DATA_RETENTION_EXECUTED");
  assert.equal(auditPayload.details.deleted.deletedStoredFileObjects, 2);
});
