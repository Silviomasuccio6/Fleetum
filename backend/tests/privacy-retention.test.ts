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
  websiteEventCount: prisma.websiteEvent.count,
  demoLeadCount: prisma.demoLead.count,
  emailQueueCount: prisma.emailQueue.count,
  emailQueueFindMany: prisma.emailQueue.findMany,
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
  (prisma.websiteEvent as any).count = original.websiteEventCount;
  (prisma.demoLead as any).count = original.demoLeadCount;
  (prisma.emailQueue as any).count = original.emailQueueCount;
  (prisma.emailQueue as any).findMany = original.emailQueueFindMany;
  (prisma.rentalCustomerAttachment as any).findMany = original.rentalCustomerAttachmentFindMany;
  (prisma.storedFileObject as any).findMany = original.storedFileObjectFindMany;
  (prisma as any).$transaction = original.transaction;
  (storageProvider as any).delete = original.storageDelete;
});

test("global retention preview reports only aggregate candidates and configurable cutoffs", async () => {
  (prisma.websiteEvent as any).count = async (input: any) => {
    assert.ok(input.where.createdAt.lt instanceof Date);
    return 11;
  };
  (prisma.demoLead as any).count = async (input: any) => {
    assert.ok(input.where.createdAt.lt instanceof Date);
    return 7;
  };
  (prisma.emailQueue as any).count = async (input: any) => {
    assert.deepEqual(input.where.status.in, ["SENT", "FAILED"]);
    assert.equal(input.where.payloadPurgedAt, null);
    assert.ok(input.where.updatedAt.lt instanceof Date);
    return 5;
  };

  const result = await new PrivacyComplianceService().previewGlobalRetention({
    websiteEventRetentionDays: 45,
    demoLeadRetentionDays: 180,
    emailQueuePayloadRetentionDays: 14
  });

  assert.equal(result.mode, "dry_run");
  assert.deepEqual(result.policy, {
    websiteEventRetentionDays: 45,
    demoLeadRetentionDays: 180,
    emailQueuePayloadRetentionDays: 14
  });
  assert.deepEqual(result.candidates, {
    websiteEvents: 11,
    demoLeads: 7,
    emailQueuePayloads: 5
  });
  assert.equal(JSON.stringify(result).includes("example.com"), false);
});

test("global retention deletes expired public records and purges terminal email payloads", async () => {
  (prisma.websiteEvent as any).count = async () => 2;
  (prisma.demoLead as any).count = async () => 1;
  (prisma.emailQueue as any).count = async () => 1;
  (prisma.emailQueue as any).findMany = async (input: any) => {
    assert.equal(input.where.payloadPurgedAt, null);
    return [{
      id: "email_1",
      meta: {
        tenantId: "tenant_a",
        contractId: "contract_1",
        emailProvider: "resend",
        sentAt: "2026-01-01T00:00:00.000Z",
        replyTo: "private@example.test",
        html: "<p>reset-secret-token</p>",
        attachments: [{ contentBase64: "sensitive" }]
      }
    }];
  };

  const emailUpdates: any[] = [];
  (prisma as any).$transaction = async (callback: any) => callback({
    websiteEvent: { deleteMany: async () => ({ count: 2 }) },
    demoLead: { deleteMany: async () => ({ count: 1 }) },
    emailQueue: {
      updateMany: async (input: any) => {
        emailUpdates.push(input);
        return { count: 1 };
      }
    }
  });

  const result = await new PrivacyComplianceService().runGlobalRetention({
    confirmation: "RUN_GLOBAL_RETENTION",
    websiteEventRetentionDays: 45,
    demoLeadRetentionDays: 180,
    emailQueuePayloadRetentionDays: 14
  });

  assert.equal(result.executed, true);
  assert.deepEqual(result.deleted, { websiteEvents: 2, demoLeads: 1 });
  assert.deepEqual(result.purged, { emailQueuePayloads: 1 });
  assert.equal(emailUpdates.length, 1);
  assert.deepEqual(emailUpdates[0].where, { id: "email_1", payloadPurgedAt: null });
  assert.equal(emailUpdates[0].data.recipient, "[redacted]");
  assert.equal(emailUpdates[0].data.subject, "[redacted]");
  assert.equal(emailUpdates[0].data.body, "[redacted]");
  assert.equal(emailUpdates[0].data.lastError, null);
  assert.ok(emailUpdates[0].data.payloadPurgedAt instanceof Date);
  assert.deepEqual(emailUpdates[0].data.meta, {
    payloadPurged: true,
    tenantId: "tenant_a",
    contractId: "contract_1",
    emailProvider: "resend",
    sentAt: "2026-01-01T00:00:00.000Z"
  });
  assert.equal(JSON.stringify(emailUpdates).includes("private@example.test"), false);
  assert.equal(JSON.stringify(emailUpdates).includes("reset-secret-token"), false);
  assert.equal(JSON.stringify(emailUpdates).includes("contentBase64"), false);
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
        updateMany: async (input: any) => {
          assert.deepEqual(input.where.storageKey.in, ["uploads/customers/att-1.pdf"]);
          assert.ok(input.data.deletedAt instanceof Date);
          return { count: 1 };
        },
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

test("privacy retention keeps metadata when physical object cleanup fails", async () => {
  mockPreviewCounts();
  const attemptedKeys: string[] = [];
  let deletedMetadataIds: string[] = [];

  (prisma.rentalCustomerAttachment as any).findMany = async () => [];
  (prisma.storedFileObject as any).findMany = async () => [
    { id: "file_ok", storageKey: "uploads/retention/ok.pdf" },
    { id: "file_retry", storageKey: "uploads/retention/retry.pdf" }
  ];
  (storageProvider as any).delete = async (key: string) => {
    attemptedKeys.push(key);
    if (key.endsWith("retry.pdf")) throw new Error("synthetic storage outage");
  };
  (prisma as any).$transaction = async (callback: any) => callback({
    passwordResetToken: { deleteMany: async () => ({ count: 0 }) },
    invitationToken: { deleteMany: async () => ({ count: 0 }) },
    refreshSession: { deleteMany: async () => ({ count: 0 }) },
    rentalCustomerAttachment: { deleteMany: async () => ({ count: 0 }) },
    storedFileObject: {
      updateMany: async () => ({ count: 0 }),
      deleteMany: async (input: any) => {
        deletedMetadataIds = input.where.id.in;
        return { count: deletedMetadataIds.length };
      }
    },
    auditLog: { create: async (input: any) => input.data }
  });

  const result = await new PrivacyComplianceService().runRetention({
    tenantId: "tenant_a",
    confirmation: "RUN_RETENTION",
    deletedStoredFileObjectGraceDays: 12
  });

  assert.deepEqual(attemptedKeys.sort(), [
    "uploads/retention/ok.pdf",
    "uploads/retention/retry.pdf"
  ]);
  assert.deepEqual(deletedMetadataIds, ["file_ok"]);
  assert.equal(result.deleted.deletedStoredFileObjects, 1);
});
