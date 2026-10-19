export type StripeQaPreflightReceipt = {
  account: string;
  livemode: false;
  prices: number;
  products: number;
  portal: string;
  requests: number;
  methods: string[];
  completedAt: string;
};
export function verifyStripeQa(raw: Record<string, string | undefined>,
  requestJson?: (path: string, signal: AbortSignal) => Promise<unknown>): Promise<StripeQaPreflightReceipt>;
