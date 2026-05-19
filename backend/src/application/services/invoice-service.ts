import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma/client.js";
import { EmailQueueService } from "../../infrastructure/email/email-queue-service.js";
import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { ensureKnownPlan, getPlanMonthlyPrice } from "./feature-entitlements-service.js";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 44;
const BLUE = rgb(0.145, 0.388, 1);
const NAVY = rgb(0.027, 0.067, 0.122);
const TEXT = rgb(0.075, 0.096, 0.15);
const MUTED = rgb(0.38, 0.44, 0.54);
const LINE = rgb(0.86, 0.89, 0.94);
const SOFT = rgb(0.965, 0.98, 1);
const TAX_RATE = 22;

type InvoiceWithRelations = Prisma.InvoiceGetPayload<{
  include: {
    tenant: { select: { id: true; name: true } };
    items: true;
    deliveries: { orderBy: { createdAt: "desc" } };
  };
}>;

type LicenseSnapshot = {
  plan: string;
  seats?: number;
  status?: string;
  expiresAt?: string | null;
  priceMonthly?: number | null;
  billingCycle?: "monthly" | "yearly";
};

const issuer = {
  name: process.env.FLEETUM_BILLING_LEGAL_NAME || "Fleetum",
  vat: process.env.FLEETUM_BILLING_VAT || "P.IVA/CF da configurare",
  address: process.env.FLEETUM_BILLING_ADDRESS || "Sede legale da configurare",
  email: process.env.FLEETUM_BILLING_EMAIL || "info@fleetum.it",
  pec: process.env.FLEETUM_BILLING_PEC || "PEC da configurare",
  sdi: process.env.FLEETUM_BILLING_SDI || "SDI da configurare",
  iban: process.env.FLEETUM_BILLING_IBAN || "IBAN da configurare",
  website: "fleetum.it"
};

const money = (value: number) => Number(value.toFixed(2));
const formatMoney = (value: number, currency = "EUR") =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency, minimumFractionDigits: 2 }).format(value);
const formatDate = (value: Date | string) => new Date(value).toLocaleDateString("it-IT");
const formatPeriod = (start: Date | string, end: Date | string) => `${formatDate(start)} - ${formatDate(end)}`;

const sanitize = (value?: string | null, fallback = "-") => {
  const clean = String(value ?? "").replace(/\s+/g, " ").trim();
  return clean || fallback;
};

const parseLicense = (details: unknown): LicenseSnapshot | null => {
  if (!details || typeof details !== "object") return null;
  const payload = details as Record<string, unknown>;
  const source = payload.after && typeof payload.after === "object" ? (payload.after as Record<string, unknown>) : payload;
  return {
    plan: String(source.plan ?? "STARTER"),
    seats: Number.isFinite(Number(source.seats)) ? Number(source.seats) : 3,
    status: source.status ? String(source.status) : "ACTIVE",
    expiresAt: source.expiresAt ? String(source.expiresAt) : null,
    priceMonthly: Number.isFinite(Number(source.priceMonthly)) && Number(source.priceMonthly) > 0 ? Number(source.priceMonthly) : null,
    billingCycle: source.billingCycle === "yearly" ? "yearly" : "monthly"
  };
};

const monthBounds = (now = new Date()) => {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { start, end };
};

const dueDateFrom = (issueDate: Date) => new Date(issueDate.getTime() + 14 * 24 * 60 * 60 * 1000);

const wrapText = (text: string, font: PDFFont, size: number, maxWidth: number) => {
  const words = sanitize(text, "").split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : ["-"];
};

const drawText = (page: PDFPage, text: string, x: number, y: number, options: { font: PDFFont; size: number; color?: ReturnType<typeof rgb>; maxWidth?: number; lineHeight?: number }) => {
  const lines = options.maxWidth ? wrapText(text, options.font, options.size, options.maxWidth) : [text];
  let nextY = y;
  for (const line of lines) {
    page.drawText(line, { x, y: nextY, size: options.size, font: options.font, color: options.color ?? TEXT });
    nextY -= options.lineHeight ?? options.size + 4;
  }
  return nextY;
};

const drawLabelValue = (page: PDFPage, label: string, value: string, x: number, y: number, w: number, fonts: { regular: PDFFont; bold: PDFFont }) => {
  page.drawText(label.toUpperCase(), { x, y, size: 7.2, font: fonts.bold, color: MUTED });
  drawText(page, value, x, y - 14, { font: fonts.regular, size: 9.2, maxWidth: w, lineHeight: 12, color: TEXT });
};

const resolveLogo = async (pdfDoc: PDFDocument): Promise<PDFImage | null> => {
  const candidates = [
    path.resolve(process.cwd(), "assets/fleetum-logo-horizontal.png"),
    path.resolve(process.cwd(), "backend/assets/fleetum-logo-horizontal.png"),
    path.resolve(process.cwd(), "../backend/assets/fleetum-logo-horizontal.png"),
    path.resolve(process.cwd(), "frontend/public/brand/fleetum-logo-horizontal.png")
  ];
  for (const candidate of candidates) {
    try {
      const image = await fs.readFile(candidate);
      return pdfDoc.embedPng(image);
    } catch {
      // Try next path: prod images can be copied in a different cwd than local dev.
    }
  }
  return null;
};

const latestLicenseForTenant = async (tenantId: string): Promise<LicenseSnapshot> => {
  const row = await prisma.auditLog.findFirst({
    where: { tenantId, resource: "tenant", resourceId: tenantId, action: "PLATFORM_LICENSE_UPDATED" },
    orderBy: { createdAt: "desc" },
    select: { details: true }
  });
  return parseLicense(row?.details ?? null) ?? { plan: "STARTER", seats: 3, status: "ACTIVE", billingCycle: "monthly", priceMonthly: null };
};

const nextInvoiceNumber = async () => {
  const year = new Date().getFullYear();
  const count = await prisma.invoice.count({
    where: {
      invoiceNumber: { startsWith: `FLT-${year}-` }
    }
  });
  return `FLT-${year}-${String(count + 1).padStart(5, "0")}`;
};

const toPublicInvoice = (invoice: InvoiceWithRelations) => ({
  id: invoice.id,
  tenantId: invoice.tenantId,
  tenantName: invoice.tenant.name,
  invoiceNumber: invoice.invoiceNumber,
  issueDate: invoice.issueDate,
  dueDate: invoice.dueDate,
  periodStart: invoice.periodStart,
  periodEnd: invoice.periodEnd,
  status: invoice.status,
  currency: invoice.currency,
  subtotal: invoice.subtotal,
  taxRate: invoice.taxRate,
  taxAmount: invoice.taxAmount,
  total: invoice.total,
  billingName: invoice.billingName,
  billingEmail: invoice.billingEmail,
  sentAt: invoice.sentAt,
  createdAt: invoice.createdAt,
  deliveries: invoice.deliveries.map((delivery) => ({
    id: delivery.id,
    channel: delivery.channel,
    recipient: delivery.recipient,
    status: delivery.status,
    provider: delivery.provider,
    providerMessageId: delivery.providerMessageId,
    errorMessage: delivery.errorMessage,
    sentAt: delivery.sentAt,
    createdAt: delivery.createdAt
  })),
  items: invoice.items.map((item) => ({
    id: item.id,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    subtotal: item.subtotal,
    taxRate: item.taxRate,
    taxAmount: item.taxAmount,
    total: item.total
  }))
});

export class InvoiceService {
  constructor(private readonly emailQueueService = new EmailQueueService()) {}

  async listPlatformInvoices() {
    const rows = await prisma.invoice.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        tenant: { select: { id: true, name: true } },
        items: true,
        deliveries: { orderBy: { createdAt: "desc" } }
      }
    });
    return { data: rows.map(toPublicInvoice) };
  }

  async listTenantInvoices(tenantId: string) {
    const rows = await prisma.invoice.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        tenant: { select: { id: true, name: true } },
        items: true,
        deliveries: { orderBy: { createdAt: "desc" } }
      }
    });
    return { data: rows.map(toPublicInvoice) };
  }

  async getPlatformInvoice(invoiceId: string) {
    const invoice = await this.findInvoice(invoiceId);
    return { data: toPublicInvoice(invoice) };
  }

  async getTenantInvoice(tenantId: string, invoiceId: string) {
    const invoice = await this.findInvoice(invoiceId, tenantId);
    return { data: toPublicInvoice(invoice) };
  }

  async generateForTenant(input: { tenantId: string; actorUserId: string; sourceIp: string }) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: input.tenantId },
      include: {
        tenantProfile: true,
        users: {
          where: { deletedAt: null },
          orderBy: { createdAt: "asc" },
          select: { email: true, firstName: true, lastName: true }
        }
      }
    });
    if (!tenant) throw new AppError("Tenant non trovato", 404, "NOT_FOUND");

    const profile = tenant.tenantProfile;
    const billingEmail = profile?.email || profile?.adminEmail || tenant.users[0]?.email || null;
    const billingName = profile?.legalName || profile?.tradeName || tenant.name;
    const billingAddress = [profile?.legalAddress, profile?.postalCode, profile?.city, profile?.province, profile?.country]
      .filter(Boolean)
      .join(", ");

    if (!billingEmail) {
      throw new AppError("Email fatturazione tenant mancante", 422, "TENANT_BILLING_EMAIL_MISSING");
    }

    const license = await latestLicenseForTenant(input.tenantId);
    const plan = ensureKnownPlan(license.plan);
    const monthlyPrice = license.priceMonthly ?? getPlanMonthlyPrice(plan);
    const billingCycle = license.billingCycle === "yearly" ? "yearly" : "monthly";
    const quantity = billingCycle === "yearly" ? 12 : 1;
    const unitPrice = monthlyPrice;
    const subtotal = money(unitPrice * quantity);
    const taxAmount = money((subtotal * TAX_RATE) / 100);
    const total = money(subtotal + taxAmount);
    const issueDate = new Date();
    const { start, end } = monthBounds(issueDate);
    const invoiceNumber = await nextInvoiceNumber();

    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          tenantId: tenant.id,
          invoiceNumber,
          issueDate,
          dueDate: dueDateFrom(issueDate),
          periodStart: start,
          periodEnd: billingCycle === "yearly" ? new Date(Date.UTC(issueDate.getUTCFullYear(), 11, 31, 23, 59, 59, 999)) : end,
          status: "GENERATED",
          currency: "EUR",
          subtotal,
          taxRate: TAX_RATE,
          taxAmount,
          total,
          billingName,
          billingVatNumber: profile?.vatNumber ?? null,
          billingTaxCode: profile?.taxCode ?? null,
          billingAddress: billingAddress || null,
          billingEmail,
          billingPec: profile?.pec ?? null,
          billingSdi: profile?.sdiCode ?? null,
          notes: "Documento riepilogativo / copia di cortesia. Non sostituisce fattura elettronica SDI se non emessa tramite sistema fiscale certificato.",
          items: {
            create: {
              description: `Abbonamento Fleetum ${plan} (${billingCycle === "yearly" ? "annuale" : "mensile"})`,
              quantity,
              unitPrice,
              subtotal,
              taxRate: TAX_RATE,
              taxAmount,
              total
            }
          }
        },
        include: {
          tenant: { select: { id: true, name: true } },
          items: true,
          deliveries: { orderBy: { createdAt: "desc" } }
        }
      });

      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          userId: input.actorUserId,
          action: "PLATFORM_INVOICE_GENERATED",
          resource: "invoice",
          resourceId: created.id,
          details: {
            actor: input.actorUserId,
            sourceIp: input.sourceIp,
            invoiceNumber: created.invoiceNumber,
            total: created.total,
            status: created.status
          } as Prisma.InputJsonValue
        }
      });
      return created;
    });

    return { data: toPublicInvoice(invoice) };
  }

  async updateStatus(input: { invoiceId: string; status: string; actorUserId: string; sourceIp: string }) {
    const allowed = new Set(["DRAFT", "GENERATED", "SENT", "PAID", "OVERDUE", "VOID", "ERROR"]);
    if (!allowed.has(input.status)) throw new AppError("Stato fattura non valido", 400, "INVALID_INVOICE_STATUS");
    const current = await this.findInvoice(input.invoiceId);
    const updated = await prisma.invoice.update({
      where: { id: input.invoiceId },
      data: { status: input.status as any },
      include: {
        tenant: { select: { id: true, name: true } },
        items: true,
        deliveries: { orderBy: { createdAt: "desc" } }
      }
    });
    await prisma.auditLog.create({
      data: {
        tenantId: updated.tenantId,
        userId: input.actorUserId,
        action: "PLATFORM_INVOICE_STATUS_CHANGED",
        resource: "invoice",
        resourceId: updated.id,
        details: { actor: input.actorUserId, sourceIp: input.sourceIp, before: current.status, after: updated.status } as Prisma.InputJsonValue
      }
    });
    return { data: toPublicInvoice(updated) };
  }

  async pdfBufferForPlatform(invoiceId: string) {
    return this.renderPdf(await this.findInvoice(invoiceId));
  }

  async pdfBufferForTenant(tenantId: string, invoiceId: string) {
    return this.renderPdf(await this.findInvoice(invoiceId, tenantId));
  }

  async sendEmail(input: { invoiceId: string; actorUserId: string; sourceIp: string }) {
    const invoice = await this.findInvoice(input.invoiceId);
    if (!invoice.billingEmail) throw new AppError("Email fatturazione mancante", 422, "INVOICE_RECIPIENT_MISSING");
    const pdf = await this.renderPdf(invoice);
    const delivery = await prisma.invoiceDelivery.create({
      data: {
        invoiceId: invoice.id,
        channel: "EMAIL",
        recipient: invoice.billingEmail,
        status: "PENDING"
      }
    });

    const subject = `Fattura Fleetum ${invoice.invoiceNumber} - ${formatPeriod(invoice.periodStart, invoice.periodEnd)}`;
    const text = [
      `Gentile ${invoice.billingName},`,
      `in allegato trovi il documento riepilogativo Fleetum ${invoice.invoiceNumber}.`,
      `Periodo: ${formatPeriod(invoice.periodStart, invoice.periodEnd)}`,
      `Totale: ${formatMoney(invoice.total, invoice.currency)}`,
      `Scadenza: ${formatDate(invoice.dueDate)}`,
      "Accedi alla tua area Fleetum per consultare le fatture e lo stato del piano.",
      env.APP_URL,
      "",
      "Nota: documento riepilogativo / copia di cortesia se non emesso tramite sistema SDI certificato."
    ].join("\n");

    const html = this.invoiceEmailHtml(invoice);
    const queued = await this.emailQueueService.enqueue({
      tenantId: invoice.tenantId,
      type: "SAAS_INVOICE_EMAIL",
      recipient: invoice.billingEmail,
      subject,
      body: text,
      meta: {
        fromName: "Fleetum Billing",
        replyTo: issuer.email,
        invoiceId: invoice.id,
        invoiceDeliveryId: delivery.id,
        tenantId: invoice.tenantId,
        html,
        attachments: [
          {
            filename: `${invoice.invoiceNumber}.pdf`,
            contentBase64: pdf.toString("base64"),
            contentType: "application/pdf"
          }
        ]
      }
    });

    await this.emailQueueService.processPending(new Date(), { ids: [queued.id], take: 1 });
    const processed = await prisma.emailQueue.findUnique({ where: { id: queued.id }, select: { status: true, lastError: true, meta: true } });
    const deliveryStatus = processed?.status === "SENT" ? "SENT" : "FAILED";
    const meta = (processed?.meta ?? {}) as Record<string, unknown>;

    const updatedDelivery = await prisma.invoiceDelivery.update({
      where: { id: delivery.id },
      data: {
        status: deliveryStatus,
        provider: typeof meta.emailProvider === "string" ? meta.emailProvider : null,
        providerMessageId: typeof meta.providerMessageId === "string" ? meta.providerMessageId : null,
        errorMessage: deliveryStatus === "FAILED" ? (processed?.lastError ?? "Invio email fattura fallito") : null,
        sentAt: deliveryStatus === "SENT" ? new Date() : null
      }
    });

    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: deliveryStatus === "SENT" ? "SENT" : "ERROR",
        sentAt: deliveryStatus === "SENT" ? new Date() : invoice.sentAt
      },
      include: {
        tenant: { select: { id: true, name: true } },
        items: true,
        deliveries: { orderBy: { createdAt: "desc" } }
      }
    });

    await prisma.auditLog.create({
      data: {
        tenantId: invoice.tenantId,
        userId: input.actorUserId,
        action: deliveryStatus === "SENT" ? "PLATFORM_INVOICE_EMAIL_SENT" : "PLATFORM_INVOICE_EMAIL_FAILED",
        resource: "invoice",
        resourceId: invoice.id,
        details: {
          actor: input.actorUserId,
          sourceIp: input.sourceIp,
          queueEmailId: queued.id,
          deliveryId: updatedDelivery.id,
          provider: updatedDelivery.provider,
          providerMessageId: updatedDelivery.providerMessageId,
          recipientMasked: invoice.billingEmail.replace(/^(.{2}).*(@.*)$/, "$1***$2"),
          error: updatedDelivery.errorMessage
        } as Prisma.InputJsonValue
      }
    });

    if (deliveryStatus !== "SENT") {
      throw new AppError(updatedDelivery.errorMessage ?? "Invio email fattura fallito", 502, "INVOICE_EMAIL_FAILED");
    }

    return { data: toPublicInvoice(updatedInvoice) };
  }

  private async findInvoice(invoiceId: string, tenantId?: string): Promise<InvoiceWithRelations> {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, deletedAt: null, ...(tenantId ? { tenantId } : {}) },
      include: {
        tenant: { select: { id: true, name: true } },
        items: true,
        deliveries: { orderBy: { createdAt: "desc" } }
      }
    });
    if (!invoice) throw new AppError("Fattura non trovata", 404, "INVOICE_NOT_FOUND");
    return invoice;
  }

  private invoiceEmailHtml(invoice: InvoiceWithRelations) {
    return `
      <div style="margin:0;padding:0;background:#07111f;font-family:Inter,Manrope,Arial,sans-serif;color:#e6ecf2;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:38px 16px;background:radial-gradient(circle at 18% 0%,rgba(37,99,255,.30),transparent 34rem),radial-gradient(circle at 86% 10%,rgba(0,184,169,.20),transparent 30rem),#07111f;">
          <tr><td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:660px;border:1px solid rgba(230,236,242,.14);border-radius:28px;overflow:hidden;background:linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.035));box-shadow:0 28px 90px rgba(0,0,0,.38);">
              <tr><td style="padding:30px 34px 10px;">
                <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#9fb2d2;font-weight:800;">Fleetum Billing</div>
                <h1 style="margin:12px 0 10px;font-size:30px;line-height:1.1;letter-spacing:-.04em;color:#fff;">${invoice.invoiceNumber}</h1>
                <p style="margin:0;color:#a8b4c8;font-size:15px;line-height:1.65;">Documento riepilogativo per ${invoice.billingName}. Il PDF e' allegato a questa email.</p>
              </td></tr>
              <tr><td style="padding:18px 34px 28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid rgba(50,221,209,.22);border-radius:22px;background:rgba(5,12,24,.72);">
                  <tr>
                    <td style="padding:18px;color:#8ea3c4;font-size:12px;text-transform:uppercase;letter-spacing:.14em;font-weight:800;">Periodo<br><span style="display:block;margin-top:8px;color:#fff;font-size:15px;letter-spacing:0;text-transform:none;">${formatPeriod(invoice.periodStart, invoice.periodEnd)}</span></td>
                    <td style="padding:18px;color:#8ea3c4;font-size:12px;text-transform:uppercase;letter-spacing:.14em;font-weight:800;">Scadenza<br><span style="display:block;margin-top:8px;color:#fff;font-size:15px;letter-spacing:0;text-transform:none;">${formatDate(invoice.dueDate)}</span></td>
                    <td style="padding:18px;color:#8ea3c4;font-size:12px;text-transform:uppercase;letter-spacing:.14em;font-weight:800;">Totale<br><span style="display:block;margin-top:8px;color:#fff;font-size:22px;letter-spacing:-.03em;text-transform:none;">${formatMoney(invoice.total, invoice.currency)}</span></td>
                  </tr>
                </table>
              </td></tr>
              <tr><td style="padding:0 34px 34px;">
                <a href="${env.APP_URL}/upgrade" style="display:inline-block;border-radius:999px;background:linear-gradient(135deg,#2563ff,#32ddd1);padding:12px 18px;color:#fff;text-decoration:none;font-size:14px;font-weight:800;">Accedi alla tua area Fleetum</a>
                <p style="margin:18px 0 0;color:#7f8da6;font-size:12px;line-height:1.6;">Se hai domande, rispondi a questa email o scrivi a ${issuer.email}.</p>
              </td></tr>
            </table>
          </td></tr>
        </table>
      </div>`;
  }

  private async renderPdf(invoice: InvoiceWithRelations) {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fonts = { regular, bold };
    const logo = await resolveLogo(pdfDoc);

    page.drawRectangle({ x: 0, y: PAGE_H - 154, width: PAGE_W, height: 154, color: SOFT });
    page.drawRectangle({ x: 0, y: PAGE_H - 4, width: PAGE_W, height: 4, color: BLUE });

    page.drawText("DOCUMENTO RIEPILOGATIVO / COPIA DI CORTESIA", {
      x: MARGIN,
      y: PAGE_H - 54,
      size: 7.4,
      font: bold,
      color: BLUE
    });
    page.drawText(invoice.invoiceNumber, { x: MARGIN, y: PAGE_H - 86, size: 24, font: bold, color: NAVY });
    page.drawText("Fatturazione SaaS Fleetum", { x: MARGIN, y: PAGE_H - 108, size: 10.5, font: regular, color: MUTED });

    if (logo) {
      const scale = Math.min(126 / logo.width, 40 / logo.height);
      page.drawImage(logo, { x: PAGE_W - MARGIN - logo.width * scale, y: PAGE_H - 84, width: logo.width * scale, height: logo.height * scale });
    } else {
      page.drawText("Fleetum", { x: PAGE_W - MARGIN - 80, y: PAGE_H - 70, size: 18, font: bold, color: NAVY });
    }

    const statusLabel = invoice.status === "SENT" ? "Inviata" : invoice.status === "PAID" ? "Pagata" : invoice.status === "ERROR" ? "Errore" : "Generata";
    page.drawRectangle({ x: PAGE_W - MARGIN - 106, y: PAGE_H - 124, width: 106, height: 28, borderColor: LINE, borderWidth: 1, color: rgb(1, 1, 1), opacity: 0.9 });
    page.drawText(statusLabel.toUpperCase(), { x: PAGE_W - MARGIN - 90, y: PAGE_H - 115, size: 8.4, font: bold, color: BLUE });

    const metaY = PAGE_H - 182;
    drawLabelValue(page, "Data emissione", formatDate(invoice.issueDate), MARGIN, metaY, 110, fonts);
    drawLabelValue(page, "Data scadenza", formatDate(invoice.dueDate), MARGIN + 126, metaY, 110, fonts);
    drawLabelValue(page, "Periodo", formatPeriod(invoice.periodStart, invoice.periodEnd), MARGIN + 252, metaY, 180, fonts);

    const leftY = PAGE_H - 256;
    page.drawText("Emittente", { x: MARGIN, y: leftY, size: 11, font: bold, color: NAVY });
    drawText(page, issuer.name, MARGIN, leftY - 20, { font: bold, size: 10.2, maxWidth: 220 });
    drawText(page, `${issuer.address}\n${issuer.vat}\n${issuer.email} · ${issuer.website}\nPEC: ${issuer.pec} · SDI: ${issuer.sdi}`.replace(/\n/g, " "), MARGIN, leftY - 36, { font: regular, size: 8.7, maxWidth: 220, lineHeight: 12, color: MUTED });

    page.drawText("Cliente", { x: 326, y: leftY, size: 11, font: bold, color: NAVY });
    drawText(page, invoice.billingName, 326, leftY - 20, { font: bold, size: 10.2, maxWidth: 218 });
    drawText(
      page,
      [invoice.billingAddress, invoice.billingVatNumber ? `P.IVA ${invoice.billingVatNumber}` : null, invoice.billingTaxCode ? `CF ${invoice.billingTaxCode}` : null, invoice.billingEmail, invoice.billingPec ? `PEC ${invoice.billingPec}` : null, invoice.billingSdi ? `SDI ${invoice.billingSdi}` : null]
        .filter(Boolean)
        .join(" · "),
      326,
      leftY - 36,
      { font: regular, size: 8.7, maxWidth: 218, lineHeight: 12, color: MUTED }
    );

    const tableTop = PAGE_H - 378;
    page.drawRectangle({ x: MARGIN, y: tableTop, width: PAGE_W - MARGIN * 2, height: 34, color: NAVY });
    page.drawText("Descrizione", { x: MARGIN + 14, y: tableTop + 12, size: 8, font: bold, color: rgb(1, 1, 1) });
    page.drawText("Q.ta", { x: 330, y: tableTop + 12, size: 8, font: bold, color: rgb(1, 1, 1) });
    page.drawText("Prezzo", { x: 378, y: tableTop + 12, size: 8, font: bold, color: rgb(1, 1, 1) });
    page.drawText("Totale", { x: 474, y: tableTop + 12, size: 8, font: bold, color: rgb(1, 1, 1) });

    let rowY = tableTop - 28;
    for (const item of invoice.items) {
      drawText(page, item.description, MARGIN + 14, rowY, { font: regular, size: 9.3, maxWidth: 260, lineHeight: 12 });
      page.drawText(String(item.quantity), { x: 334, y: rowY, size: 9.3, font: regular, color: TEXT });
      page.drawText(formatMoney(item.unitPrice, invoice.currency), { x: 378, y: rowY, size: 9.3, font: regular, color: TEXT });
      page.drawText(formatMoney(item.total, invoice.currency), { x: 466, y: rowY, size: 9.3, font: bold, color: TEXT });
      page.drawLine({ start: { x: MARGIN, y: rowY - 14 }, end: { x: PAGE_W - MARGIN, y: rowY - 14 }, thickness: 0.7, color: LINE });
      rowY -= 38;
    }

    const summaryX = 348;
    const summaryY = rowY - 24;
    page.drawRectangle({ x: summaryX, y: summaryY - 104, width: PAGE_W - MARGIN - summaryX, height: 126, borderColor: LINE, borderWidth: 1, color: rgb(1, 1, 1), opacity: 0.96 });
    const summaryRows: Array<[string, string, boolean]> = [
      ["Imponibile", formatMoney(invoice.subtotal, invoice.currency), false],
      [`IVA ${invoice.taxRate}%`, formatMoney(invoice.taxAmount, invoice.currency), false],
      ["Totale", formatMoney(invoice.total, invoice.currency), true]
    ];
    let sy = summaryY;
    for (const [label, value, strong] of summaryRows) {
      page.drawText(label, { x: summaryX + 16, y: sy, size: strong ? 10.5 : 8.8, font: strong ? bold : regular, color: strong ? NAVY : MUTED });
      page.drawText(value, { x: summaryX + 106, y: sy, size: strong ? 13 : 9.2, font: bold, color: strong ? BLUE : TEXT });
      sy -= strong ? 28 : 22;
    }

    const notesY = 184;
    page.drawText("Note pagamento", { x: MARGIN, y: notesY, size: 11, font: bold, color: NAVY });
    drawText(
      page,
      `Pagamento secondo accordi contrattuali. IBAN: ${issuer.iban}. ${invoice.notes ?? ""}`,
      MARGIN,
      notesY - 20,
      { font: regular, size: 8.8, maxWidth: 490, lineHeight: 12, color: MUTED }
    );

    page.drawLine({ start: { x: MARGIN, y: 76 }, end: { x: PAGE_W - MARGIN, y: 76 }, thickness: 0.8, color: LINE });
    drawText(
      page,
      `${issuer.name} · ${issuer.website} · ${issuer.email} · Documento generato da Fleetum Billing. Copia di cortesia se non integrata a flusso SDI certificato.`,
      MARGIN,
      56,
      { font: regular, size: 7.4, maxWidth: PAGE_W - MARGIN * 2, lineHeight: 10, color: MUTED }
    );

    return Buffer.from(await pdfDoc.save());
  }
}
