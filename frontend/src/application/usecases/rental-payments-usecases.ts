import { httpClient } from "../../infrastructure/api/http-client";

export type RentalPaymentMethodStatus =
  | "SETUP_PENDING"
  | "ACTIVE"
  | "FAILED"
  | "REQUIRES_ACTION"
  | "EXPIRED"
  | "REMOVED";

export type RentalDepositStatus =
  | "DRAFT"
  | "AUTHORIZING"
  | "AUTHORIZED"
  | "PARTIALLY_CAPTURED"
  | "CAPTURED"
  | "RELEASED"
  | "CANCELED"
  | "FAILED"
  | "EXPIRED";

export type RentalExtraChargeStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "NOTIFIED"
  | "PAYMENT_PROCESSING"
  | "PAID"
  | "FAILED"
  | "REQUIRES_ACTION"
  | "CANCELED"
  | "REFUNDED"
  | "DISPUTED";

export type RentalExtraChargeType =
  | "FINE"
  | "DAMAGE"
  | "DEDUCTIBLE"
  | "FUEL"
  | "TOLL"
  | "LATE_RETURN"
  | "CLEANING"
  | "MISSING_ACCESSORY"
  | "ADMIN_FEE"
  | "OTHER";

export type RentalPaymentMethodDto = {
  id: string;
  bookingId?: string | null;
  rentalCustomerId: string;
  status: RentalPaymentMethodStatus;
  cardBrand?: string | null;
  cardLast4?: string | null;
  cardExpMonth?: number | null;
  cardExpYear?: number | null;
  mandateAccepted: boolean;
  mandateAcceptedAt?: string | null;
  termsVersion?: string | null;
  isDefault?: boolean;
};

export type RentalDepositDto = {
  id: string;
  bookingId: string;
  rentalCustomerId: string;
  vehicleId?: string | null;
  paymentMethodId: string;
  amountCents: number;
  capturedAmountCents: number;
  currency: string;
  status: RentalDepositStatus;
  failureReason?: string | null;
};

export type RentalExtraChargeDto = {
  id: string;
  bookingId: string;
  rentalCustomerId: string;
  vehicleId?: string | null;
  paymentMethodId?: string | null;
  type: RentalExtraChargeType;
  description: string;
  amountCents: number;
  adminFeeCents: number;
  totalAmountCents: number;
  currency: string;
  status: RentalExtraChargeStatus;
  evidenceFileUrl?: string | null;
  failureReason?: string | null;
};

export type RentalPaymentSummaryDto = {
  booking: {
    id: string;
    code: string;
    customerId: string;
  };
  paymentMethods: RentalPaymentMethodDto[];
  deposits: RentalDepositDto[];
  extraCharges: RentalExtraChargeDto[];
};

export const rentalPaymentsUseCases = {
  getBookingPaymentSummary: (bookingId: string) =>
    httpClient.get<RentalPaymentSummaryDto>(`/rental-payments/bookings/${bookingId}/summary`),

  createSetupSession: (bookingId: string, input: { mandateAccepted: boolean; termsVersion: string }) =>
    httpClient.post<{ mode: "stripe"; checkoutUrl: string; paymentMethodId: string; stripeSessionId: string }>(
      `/rental-payments/bookings/${bookingId}/setup-session`,
      input,
      { suppressSuccessToast: true }
    ),

  listCustomerPaymentMethods: (customerId: string) =>
    httpClient.get<RentalPaymentMethodDto[]>(`/rental-payments/customers/${customerId}/payment-methods`),

  createDeposit: (bookingId: string, input: { paymentMethodId: string; amountCents: number }) =>
    httpClient.post<RentalDepositDto>(`/rental-payments/bookings/${bookingId}/deposits`, input),

  captureDeposit: (depositId: string, input?: { amountToCaptureCents?: number }) =>
    httpClient.post<RentalDepositDto>(`/rental-payments/deposits/${depositId}/capture`, input ?? {}),

  releaseDeposit: (depositId: string) =>
    httpClient.post<RentalDepositDto>(`/rental-payments/deposits/${depositId}/release`, {}),

  createExtraCharge: (
    bookingId: string,
    input: {
      paymentMethodId?: string;
      type: RentalExtraChargeType;
      description: string;
      amountCents: number;
      adminFeeCents?: number;
      evidenceFileUrl?: string;
    }
  ) => httpClient.post<RentalExtraChargeDto>(`/rental-payments/bookings/${bookingId}/extra-charges`, input),

  approveExtraCharge: (extraChargeId: string) =>
    httpClient.post<RentalExtraChargeDto>(`/rental-payments/extra-charges/${extraChargeId}/approve`, {}),

  notifyExtraCharge: (extraChargeId: string) =>
    httpClient.post<RentalExtraChargeDto>(`/rental-payments/extra-charges/${extraChargeId}/notify`, {}),

  chargeExtraCharge: (extraChargeId: string, input?: { paymentMethodId?: string }) =>
    httpClient.post<RentalExtraChargeDto>(`/rental-payments/extra-charges/${extraChargeId}/charge`, input ?? {}),

  cancelExtraCharge: (extraChargeId: string) =>
    httpClient.post<RentalExtraChargeDto>(`/rental-payments/extra-charges/${extraChargeId}/cancel`, {})
};
