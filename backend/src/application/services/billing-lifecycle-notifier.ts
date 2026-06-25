import { prisma } from "../../infrastructure/database/prisma/client.js";
import { EmailQueueService } from "../../infrastructure/email/email-queue-service.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { env } from "../../shared/config/env.js";
import { BillingCycle, SaasPlan } from "./feature-entitlements-service.js";

export type BillingLifecycleStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "TRIAL" | "PAST_DUE" | "CANCELED";

export type BillingLifecycleEmailInput = {
  tenantId: string;
  plan: SaasPlan;
  billingCycle: BillingCycle;
  previousStatus?: BillingLifecycleStatus | null;
  nextStatus?: BillingLifecycleStatus;
  expiresAt?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeInvoiceId?: string | null;
  hostedInvoiceUrl?: string | null;
  graceDays?: number;
};

export type BillingCardExpiringEmailInput = {
  tenantId: string;
  expMonth?: number | null;
  expYear?: number | null;
};

export type BillingLifecycleNotifierLike = {
  notifyPaymentFailed(input: BillingLifecycleEmailInput): Promise<void>;
  notifySubscriptionSuspended(input: BillingLifecycleEmailInput): Promise<void>;
  notifySubscriptionReactivated(input: BillingLifecycleEmailInput): Promise<void>;
  notifySubscriptionCanceled(input: BillingLifecycleEmailInput): Promise<void>;
  notifyCardExpiring(input: BillingCardExpiringEmailInput): Promise<void>;
};

const maskId = (value?: string | null) => (value ? `${value.slice(0, 6)}...${value.slice(-4)}` : null);

const cycleLabel = (value: BillingCycle) => (value === "yearly" ? "annuale" : "mensile");

const formatDate = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(date);
};

const htmlShell = (title: string, intro: string, rows: Array<[string, string | null | undefined]>, cta?: { label: string; url: string }) => `
  <div style="font-family:Inter,Arial,sans-serif;background:#f6f8fb;padding:24px;color:#172033;">
    <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e4e9f2;border-radius:18px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#0f2748,#315b91);padding:26px;color:#fff;">
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#b9c9e5;">Fleetum Billing</p>
        <h1 style="margin:0;font-size:26px;line-height:1.15;">${title}</h1>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#33415c;">${intro}</p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
          <tbody>
            ${rows
              .filter(([, value]) => value)
              .map(([label, value]) => `
                <tr>
                  <td style="padding:10px 0;border-top:1px solid #edf1f7;color:#6a7891;font-size:13px;">${label}</td>
                  <td style="padding:10px 0;border-top:1px solid #edf1f7;text-align:right;color:#172033;font-size:13px;font-weight:700;">${value}</td>
                </tr>
              `)
              .join("")}
          </tbody>
        </table>
        ${cta ? `<a href="${cta.url}" style="display:inline-block;background:#2457a6;color:#fff;text-decoration:none;font-weight:800;border-radius:12px;padding:12px 18px;">${cta.label}</a>` : ""}
        <p style="margin:22px 0 0;color:#6a7891;font-size:12px;line-height:1.55;">Questa email e' stata inviata automaticamente per aiutarti a mantenere attivo il servizio Fleetum. Se hai gia' risolto, puoi ignorare questo messaggio.</p>
      </div>
    </div>
  </div>
`;

const textBody = (title: string, intro: string, rows: Array<[string, string | null | undefined]>, cta?: { label: string; url: string }) => [
  title,
  "",
  intro,
  "",
  ...rows.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`),
  ...(cta ? ["", `${cta.label}: ${cta.url}`] : [])
].join("\n");

export class BillingLifecycleNotifier implements BillingLifecycleNotifierLike {
  constructor(private readonly emailQueueService = new EmailQueueService()) {}

  async notifyPaymentFailed(input: BillingLifecycleEmailInput) {
    const title = "Pagamento non riuscito";
    const graceText = input.graceDays && input.graceDays > 0
      ? `Stripe tentera' il recupero secondo la configurazione di billing. La finestra operativa Fleetum e' di ${input.graceDays} giorni, ma l'accesso al gestionale resta bloccato finche' il pagamento non torna valido.`
      : "L'accesso al gestionale resta bloccato finche' il pagamento non torna valido.";
    await this.enqueueLifecycleEmail(input, "BILLING_PAYMENT_FAILED", title, graceText, {
      label: "Aggiorna metodo di pagamento",
      url: `${env.APP_URL}/upgrade?billing=past_due`
    });
  }

  async notifySubscriptionSuspended(input: BillingLifecycleEmailInput) {
    await this.enqueueLifecycleEmail(
      input,
      "BILLING_SUBSCRIPTION_SUSPENDED",
      "Abbonamento sospeso",
      "Il pagamento non e' stato recuperato entro la finestra prevista. Fleetum resta sospeso finche' l'abbonamento non viene regolarizzato.",
      { label: "Regolarizza abbonamento", url: `${env.APP_URL}/upgrade?billing=suspended` }
    );
  }

  async notifySubscriptionReactivated(input: BillingLifecycleEmailInput) {
    await this.enqueueLifecycleEmail(
      input,
      "BILLING_SUBSCRIPTION_REACTIVATED",
      "Abbonamento riattivato",
      "Stripe ha confermato il pagamento. Il gestionale Fleetum e' nuovamente disponibile secondo il piano attivo.",
      { label: "Apri Fleetum", url: `${env.APP_URL}/dashboard` }
    );
  }

  async notifySubscriptionCanceled(input: BillingLifecycleEmailInput) {
    await this.enqueueLifecycleEmail(
      input,
      "BILLING_SUBSCRIPTION_CANCELED",
      "Abbonamento cancellato",
      "La subscription Stripe risulta cancellata. Per usare Fleetum e' necessario riattivare un piano o contattare il supporto.",
      { label: "Riattiva piano", url: `${env.APP_URL}/activate?billing=canceled` }
    );
  }

  async notifyCardExpiring(input: BillingCardExpiringEmailInput) {
    const recipient = await this.resolveRecipient(input.tenantId);
    if (!recipient) return;

    const expiry = input.expMonth && input.expYear ? `${String(input.expMonth).padStart(2, "0")}/${input.expYear}` : "in scadenza";
    const title = "Carta in scadenza";
    const intro = "La carta associata al tuo abbonamento Fleetum risulta in scadenza. Sostituiscila prima del prossimo rinnovo per evitare blocchi del gestionale.";
    const rows: Array<[string, string | null | undefined]> = [
      ["Azienda", recipient.companyName],
      ["Scadenza carta", expiry]
    ];

    await this.emailQueueService.enqueue({
      tenantId: input.tenantId,
      type: "BILLING_CARD_EXPIRING",
      recipient: recipient.email,
      subject: "Fleetum - carta in scadenza",
      body: textBody(title, intro, rows, { label: "Sostituisci carta", url: `${env.APP_URL}/upgrade?billing=card_expiring` }),
      meta: {
        html: htmlShell(title, intro, rows, { label: "Sostituisci carta", url: `${env.APP_URL}/upgrade?billing=card_expiring` }),
        billingEvent: "card_expiring"
      }
    });
  }

  private async enqueueLifecycleEmail(
    input: BillingLifecycleEmailInput,
    type: string,
    title: string,
    intro: string,
    cta: { label: string; url: string }
  ) {
    const recipient = await this.resolveRecipient(input.tenantId);
    if (!recipient) return;

    const rows: Array<[string, string | null | undefined]> = [
      ["Azienda", recipient.companyName],
      ["Piano", input.plan],
      ["Fatturazione", cycleLabel(input.billingCycle)],
      ["Stato precedente", input.previousStatus ?? null],
      ["Nuovo stato", input.nextStatus ?? null],
      ["Fine periodo", formatDate(input.expiresAt)],
      ["Cliente Stripe", maskId(input.stripeCustomerId)],
      ["Subscription Stripe", maskId(input.stripeSubscriptionId)],
      ["Invoice Stripe", maskId(input.stripeInvoiceId)]
    ];

    await this.emailQueueService.enqueue({
      tenantId: input.tenantId,
      type,
      recipient: recipient.email,
      subject: `Fleetum - ${title}`,
      body: textBody(title, intro, rows, cta),
      meta: {
        html: htmlShell(title, intro, rows, cta),
        billingEvent: type,
        previousStatus: input.previousStatus ?? null,
        nextStatus: input.nextStatus ?? null,
        stripeCustomerId: maskId(input.stripeCustomerId),
        stripeSubscriptionId: maskId(input.stripeSubscriptionId),
        stripeInvoiceId: maskId(input.stripeInvoiceId)
      }
    });
  }

  private async resolveRecipient(tenantId: string): Promise<{ email: string; companyName: string } | null> {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          name: true,
          tenantProfile: {
            select: { legalName: true, tradeName: true, adminEmail: true, email: true }
          },
          users: {
            where: { deletedAt: null, status: "ACTIVE" },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { email: true }
          }
        }
      });

      const email = tenant?.tenantProfile?.adminEmail ?? tenant?.tenantProfile?.email ?? tenant?.users[0]?.email ?? null;
      if (!email) return null;

      return {
        email,
        companyName: tenant?.tenantProfile?.tradeName ?? tenant?.tenantProfile?.legalName ?? tenant?.name ?? "Fleetum tenant"
      };
    } catch (error) {
      logger.warn({ error, tenantId }, "Billing notification recipient lookup failed");
      return null;
    }
  }
}
