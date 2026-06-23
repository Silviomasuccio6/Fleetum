import { Request, Response } from "express";
import { BillingService } from "../../../application/services/billing-service.js";
import { InvoiceService } from "../../../application/services/invoice-service.js";
import { checkoutSessionSchema, localCompleteSchema } from "../validators/billing-validators.js";
import { invoiceIdSchema } from "../validators/platform-admin-validators.js";

export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly invoiceService: InvoiceService
  ) {}

  createCheckoutSession = async (req: Request, res: Response) => {
    const input = checkoutSessionSchema.parse(req.body);
    const result = await this.billingService.createCheckoutSession({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      plan: input.plan,
      billingCycle: input.billingCycle
    });
    res.json(result);
  };

  createPaymentMethodSession = async (req: Request, res: Response) => {
    const result = await this.billingService.createPaymentMethodUpdateSession({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId
    });
    res.json(result);
  };

  createCustomerPortalSession = async (req: Request, res: Response) => {
    const result = await this.billingService.createCustomerPortalSession({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId
    });
    res.json(result);
  };

  localComplete = async (req: Request, res: Response) => {
    const input = localCompleteSchema.parse(req.query);
    await this.billingService.completeLocalCheckout({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      plan: input.plan,
      billingCycle: input.billingCycle
    });
    res.redirect(`/activate?checkout=success&provider=local&plan=${input.plan}`);
  };

  webhook = async (req: Request, res: Response) => {
    const result = await this.billingService.handleWebhook({
      signature: req.headers["stripe-signature"] ? String(req.headers["stripe-signature"]) : undefined,
      rawBody: (req as Request & { rawBody?: Buffer }).rawBody,
      body: req.body
    });
    res.json(result);
  };

  invoices = async (req: Request, res: Response) => {
    const result = await this.invoiceService.listTenantInvoices(req.auth!.tenantId);
    res.json(result);
  };

  invoice = async (req: Request, res: Response) => {
    const invoiceId = invoiceIdSchema.parse(req.params.invoiceId);
    const result = await this.invoiceService.getTenantInvoice(req.auth!.tenantId, invoiceId);
    res.json(result);
  };

  invoicePdf = async (req: Request, res: Response) => {
    const invoiceId = invoiceIdSchema.parse(req.params.invoiceId);
    const pdf = await this.invoiceService.pdfBufferForTenant(req.auth!.tenantId, invoiceId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=\"fleetum-${invoiceId}.pdf\"`);
    res.send(pdf);
  };
}
