-- SaaS invoice management for Platform Console and tenant billing.
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'GENERATED', 'SENT', 'PAID', 'OVERDUE', 'VOID', 'ERROR');
CREATE TYPE "InvoiceDeliveryChannel" AS ENUM ('EMAIL');
CREATE TYPE "InvoiceDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "Invoice" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "issueDate" TIMESTAMP(3) NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "status" "InvoiceStatus" NOT NULL DEFAULT 'GENERATED',
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "subtotal" DOUBLE PRECISION NOT NULL,
  "taxRate" DOUBLE PRECISION NOT NULL,
  "taxAmount" DOUBLE PRECISION NOT NULL,
  "total" DOUBLE PRECISION NOT NULL,
  "billingName" TEXT NOT NULL,
  "billingVatNumber" TEXT,
  "billingTaxCode" TEXT,
  "billingAddress" TEXT,
  "billingEmail" TEXT,
  "billingPec" TEXT,
  "billingSdi" TEXT,
  "notes" TEXT,
  "pdfFilePath" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvoiceItem" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "unitPrice" DOUBLE PRECISION NOT NULL,
  "subtotal" DOUBLE PRECISION NOT NULL,
  "taxRate" DOUBLE PRECISION NOT NULL,
  "taxAmount" DOUBLE PRECISION NOT NULL,
  "total" DOUBLE PRECISION NOT NULL,
  CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvoiceDelivery" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "channel" "InvoiceDeliveryChannel" NOT NULL DEFAULT 'EMAIL',
  "recipient" TEXT NOT NULL,
  "status" "InvoiceDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "provider" TEXT,
  "providerMessageId" TEXT,
  "errorMessage" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");
CREATE INDEX "Invoice_tenantId_createdAt_idx" ON "Invoice"("tenantId", "createdAt");
CREATE INDEX "Invoice_tenantId_status_idx" ON "Invoice"("tenantId", "status");
CREATE INDEX "Invoice_tenantId_deletedAt_idx" ON "Invoice"("tenantId", "deletedAt");
CREATE INDEX "Invoice_status_createdAt_idx" ON "Invoice"("status", "createdAt");
CREATE INDEX "Invoice_sentAt_idx" ON "Invoice"("sentAt");
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");
CREATE INDEX "InvoiceDelivery_invoiceId_createdAt_idx" ON "InvoiceDelivery"("invoiceId", "createdAt");
CREATE INDEX "InvoiceDelivery_status_createdAt_idx" ON "InvoiceDelivery"("status", "createdAt");

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceDelivery" ADD CONSTRAINT "InvoiceDelivery_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
