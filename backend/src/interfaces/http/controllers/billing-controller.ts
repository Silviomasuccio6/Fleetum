import { Request, Response } from "express";
import { BillingService } from "../../../application/services/billing-service.js";
import { checkoutSessionSchema, localCompleteSchema } from "../validators/billing-validators.js";

export class BillingController {
  constructor(private readonly billingService: BillingService) {}

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

  localComplete = async (req: Request, res: Response) => {
    const input = localCompleteSchema.parse(req.query);
    await this.billingService.completeLocalCheckout({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      plan: input.plan,
      billingCycle: input.billingCycle
    });
    res.redirect(`/upgrade?checkout=success&provider=local&plan=${input.plan}`);
  };

  webhook = async (req: Request, res: Response) => {
    const result = await this.billingService.handleWebhook({
      signature: req.headers["stripe-signature"] ? String(req.headers["stripe-signature"]) : undefined,
      rawBody: (req as Request & { rawBody?: Buffer }).rawBody,
      body: req.body
    });
    res.json(result);
  };
}
