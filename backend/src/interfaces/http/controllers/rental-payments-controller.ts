import { Request, Response } from "express";
import { RentalPaymentService } from "../../../application/services/rental-payment-service.js";
import {
  rentalDepositCaptureSchema,
  rentalDepositCreateSchema,
  rentalExtraChargeChargeSchema,
  rentalExtraChargeCreateSchema,
  rentalPaymentIdParamSchema,
  rentalPaymentSetupSessionSchema
} from "../validators/rental-payments-validators.js";

export class RentalPaymentsController {
  constructor(private readonly rentalPaymentService: RentalPaymentService) {}

  summary = async (req: Request, res: Response) => {
    const bookingId = rentalPaymentIdParamSchema.parse(req.params.bookingId);
    const result = await this.rentalPaymentService.getBookingPaymentSummary(req.auth!.tenantId, bookingId);
    res.json(result);
  };

  setupSession = async (req: Request, res: Response) => {
    const bookingId = rentalPaymentIdParamSchema.parse(req.params.bookingId);
    const input = rentalPaymentSetupSessionSchema.parse(req.body);
    const result = await this.rentalPaymentService.createSetupSession({
      tenantId: req.auth!.tenantId,
      bookingId,
      userId: req.auth!.userId,
      mandateAccepted: input.mandateAccepted,
      termsVersion: input.termsVersion,
      mandateIp: req.ip,
      mandateUserAgent: req.headers["user-agent"] ? String(req.headers["user-agent"]) : undefined
    });
    res.status(201).json(result);
  };

  paymentMethods = async (req: Request, res: Response) => {
    const customerId = rentalPaymentIdParamSchema.parse(req.params.customerId);
    const result = await this.rentalPaymentService.listPaymentMethods(req.auth!.tenantId, customerId);
    res.json(result);
  };

  createDeposit = async (req: Request, res: Response) => {
    const bookingId = rentalPaymentIdParamSchema.parse(req.params.bookingId);
    const input = rentalDepositCreateSchema.parse(req.body);
    const result = await this.rentalPaymentService.createDeposit({
      tenantId: req.auth!.tenantId,
      bookingId,
      paymentMethodId: input.paymentMethodId,
      amountCents: input.amountCents,
      userId: req.auth!.userId
    });
    res.status(201).json(result);
  };

  captureDeposit = async (req: Request, res: Response) => {
    const depositId = rentalPaymentIdParamSchema.parse(req.params.depositId);
    const input = rentalDepositCaptureSchema.parse(req.body ?? {});
    const result = await this.rentalPaymentService.captureDeposit({
      tenantId: req.auth!.tenantId,
      depositId,
      amountToCaptureCents: input.amountToCaptureCents,
      userId: req.auth!.userId
    });
    res.json(result);
  };

  releaseDeposit = async (req: Request, res: Response) => {
    const depositId = rentalPaymentIdParamSchema.parse(req.params.depositId);
    const result = await this.rentalPaymentService.releaseDeposit({
      tenantId: req.auth!.tenantId,
      depositId,
      userId: req.auth!.userId
    });
    res.json(result);
  };

  createExtraCharge = async (req: Request, res: Response) => {
    const bookingId = rentalPaymentIdParamSchema.parse(req.params.bookingId);
    const input = rentalExtraChargeCreateSchema.parse(req.body);
    const result = await this.rentalPaymentService.createExtraCharge({
      tenantId: req.auth!.tenantId,
      bookingId,
      paymentMethodId: input.paymentMethodId,
      type: input.type,
      description: input.description,
      amountCents: input.amountCents,
      adminFeeCents: input.adminFeeCents,
      evidenceFileUrl: input.evidenceFileUrl,
      userId: req.auth!.userId
    });
    res.status(201).json(result);
  };

  approveExtraCharge = async (req: Request, res: Response) => {
    const extraChargeId = rentalPaymentIdParamSchema.parse(req.params.extraChargeId);
    const result = await this.rentalPaymentService.approveExtraCharge({
      tenantId: req.auth!.tenantId,
      extraChargeId,
      userId: req.auth!.userId
    });
    res.json(result);
  };

  notifyExtraCharge = async (req: Request, res: Response) => {
    const extraChargeId = rentalPaymentIdParamSchema.parse(req.params.extraChargeId);
    const result = await this.rentalPaymentService.notifyExtraCharge({
      tenantId: req.auth!.tenantId,
      extraChargeId,
      userId: req.auth!.userId
    });
    res.json(result);
  };

  chargeExtraCharge = async (req: Request, res: Response) => {
    const extraChargeId = rentalPaymentIdParamSchema.parse(req.params.extraChargeId);
    const input = rentalExtraChargeChargeSchema.parse(req.body ?? {});
    const result = await this.rentalPaymentService.chargeExtraCharge({
      tenantId: req.auth!.tenantId,
      extraChargeId,
      paymentMethodId: input.paymentMethodId,
      userId: req.auth!.userId
    });
    res.json(result);
  };

  cancelExtraCharge = async (req: Request, res: Response) => {
    const extraChargeId = rentalPaymentIdParamSchema.parse(req.params.extraChargeId);
    const result = await this.rentalPaymentService.cancelExtraCharge({
      tenantId: req.auth!.tenantId,
      extraChargeId,
      userId: req.auth!.userId
    });
    res.json(result);
  };
}
