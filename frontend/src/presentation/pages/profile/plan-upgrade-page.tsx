import { InvoiceDownloadButton } from "../../components/billing/invoice-download-button";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check, CreditCard, Crown, ExternalLink, FileText, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { useAuthStore } from "../../../application/stores/auth-store";
import { billingUseCases } from "../../../application/usecases/billing-usecases";
import { getConsentedPublicAnalyticsContext, trackPublicEvent } from "../../../application/usecases/public-analytics-usecases";
import {
  ANNUAL_DISCOUNT_PERCENT,
  FeatureKey,
  getFeatureListForPlan,
  PLAN_MONTHLY_PRICING_EUR,
  PLAN_YEARLY_PRICING_EUR,
  SAAS_PLANS,
  SaasPlan
} from "../../../domain/constants/entitlements";
import { FEATURE_LABELS } from "../../../domain/constants/feature-labels";
import {
  canManageTenantBilling,
  canReadTenantBilling,
  canUseStripeSelfService,
  isOperativeLicenseStatus
} from "../../../domain/policies/billing-access";
import type { BillingCycle } from "../../../domain/policies/billing-access";
import { cn } from "../../../lib/utils";
import { useEntitlements } from "../../hooks/use-entitlements";
import { WorkspacePageHeader } from "../../components/ui/workspace-ui";
import { CommerceNotice } from "../../components/ui/commerce-workspace";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { getAccessDestination } from "../auth/access-flow";
import { getBillingStatusNotice } from "./billing-status-copy";

type PlanUpgradeMode = "activation" | "upgrade" | "recovery";
type ActivationCheckStatus = "idle" | "checking" | "ready" | "timeout";

const orderedFeatures = getFeatureListForPlan("ENTERPRISE");
const planRank: Record<SaasPlan, number> = {
  STARTER: 0,
  PRO: 1,
  ENTERPRISE: 2
};

const formatPrice = (value: number) =>
  new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(value);
const formatMoney = (value: number, currency = "EUR") =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency, minimumFractionDigits: 2 }).format(value);
const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleDateString("it-IT") : "-");
const planLabel = (plan?: SaasPlan | null) => (plan ? plan.charAt(0) + plan.slice(1).toLowerCase() : "-");
const billingCycleLabel = (cycle?: BillingCycle | null) => (cycle === "yearly" ? "Annuale" : cycle === "monthly" ? "Mensile" : "-");
const licenseStatusLabel = (status?: string | null) => {
  if (status === "ACTIVE") return "Attivo";
  if (status === "TRIAL") return "Trial attivo";
  if (status === "PAST_DUE") return "Pagamento da regolarizzare";
  if (status === "SUSPENDED") return "Sospeso";
  if (status === "CANCELED") return "Cancellato";
  if (status === "EXPIRED") return "Scaduto";
  if (status === "PENDING") return "In attesa";
  return "Da verificare";
};

const getPlanAccent = (plan: SaasPlan) => {
  if (plan === "STARTER") {
    return {
      chip: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
      gradient: "from-slate-400 via-slate-500 to-slate-600"
    };
  }

  if (plan === "PRO") {
    return {
      chip: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200",
      gradient: "from-indigo-500 via-violet-500 to-fuchsia-500"
    };
  }

  return {
    chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
    gradient: "from-emerald-500 via-cyan-500 to-indigo-500"
  };
};

const getPlanHighlights = (plan: SaasPlan) => {
  if (plan === "STARTER") {
    return ["Gestione base fermi", "Anagrafiche complete", "Dashboard operativa standard"];
  }

  if (plan === "PRO") {
    return ["Trend avanzati", "Export CSV e filtri avanzati", "Reminder e workflow potenziati"];
  }

  return ["Automazioni avanzate", "Controlli multi-workspace", "Security insights e supporto prioritario"];
};

export const PlanUpgradePage = ({ mode = "upgrade" }: { mode?: PlanUpgradeMode }) => {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const {
    plan,
    licenseStatus,
    provider,
    billingCycle: activeBillingCycle,
    expiresAt,
    daysRemaining,
    loading,
    refresh
  } = useEntitlements();
  const isActivationMode = mode === "activation";
  const isRecoveryMode = mode === "recovery";
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [busyPlan, setBusyPlan] = useState<SaasPlan | null>(null);
  const [busyPaymentMethod, setBusyPaymentMethod] = useState(false);
  const [busyPortal, setBusyPortal] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [activationCheckStatus, setActivationCheckStatus] = useState<ActivationCheckStatus>("idle");
  const [invoices, setInvoices] = useState<Array<{
    id: string;
    invoiceNumber: string;
    issueDate: string;
    dueDate: string;
    periodStart: string;
    periodEnd: string;
    status: string;
    total: number;
    currency: string;
  }>>([]);
  const hasKnownPlan =
    !loading &&
    (isOperativeLicenseStatus(licenseStatus) || licenseStatus === "PAST_DUE" || licenseStatus === "SUSPENDED");
  const currentPlan = hasKnownPlan ? plan : null;
  const checkoutStatus = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("checkout") : null;
  const paymentMethodStatus = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("payment_method") : null;
  const portalStatus = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("portal") : null;
  const welcomeStatus = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("welcome") : null;
  const hasManagedStripeSubscription = canUseStripeSelfService(provider, licenseStatus);
  const canReadBilling = canReadTenantBilling(user);
  const canManageBilling = canManageTenantBilling(user);
  const billingLock = useRef(false);
  const [invoiceOwner, setInvoiceOwner] = useState(`${user?.tenantId}:${user?.id}`);
  const [invoiceState, setInvoiceState] = useState<"loading" | "ready" | "error">("loading");
  const [invoiceReload, setInvoiceReload] = useState(0);
  const identity = `${user?.tenantId}:${user?.id}`;
  const activeIdentity = useRef(identity); activeIdentity.current = identity;
  const billingActionsUnavailableReason = !canManageBilling
    ? "Solo l'amministratore dell'azienda puo gestire abbonamento e metodo di pagamento."
    : !hasManagedStripeSubscription
      ? "Il piano non risulta ancora collegato a una abbonamento Stripe gestibile."
      : null;
  const billingStatusNotice = getBillingStatusNotice(licenseStatus);

  const openPaymentMethodSession = async () => {
    if (!canManageBilling || !hasManagedStripeSubscription || loading || billingLock.current) return;
    billingLock.current = true;
    setCheckoutError(null);
    setBusyPaymentMethod(true);
    try {
      const session = await billingUseCases.createPaymentMethodSession();
      if (activeIdentity.current !== identity) return;
      window.location.href = session.checkoutUrl;
    } catch (error) {
      setCheckoutError((error as Error).message);
      billingLock.current = false;
      setBusyPaymentMethod(false);
    }
  };

  const openCustomerPortalSession = async () => {
    if (!canManageBilling || !hasManagedStripeSubscription || loading || billingLock.current) return;
    billingLock.current = true;
    setCheckoutError(null);
    setBusyPortal(true);
    try {
      const session = await billingUseCases.createCustomerPortalSession();
      if (activeIdentity.current !== identity) return;
      window.location.href = session.portalUrl;
    } catch (error) {
      setCheckoutError((error as Error).message);
      billingLock.current = false;
      setBusyPortal(false);
    }
  };

  const scrollToPlans = () => {
    document.getElementById("billing-plans")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };

  const handleBillingNoticeAction = () => {
    if (!canManageBilling) return;
    if ((licenseStatus === "PAST_DUE" || licenseStatus === "SUSPENDED") && hasManagedStripeSubscription) {
      void openPaymentMethodSession();
      return;
    }
    scrollToPlans();
  };

  const planCards = useMemo(
    () =>
      SAAS_PLANS.map((entry) => {
        const monthlyPrice = PLAN_MONTHLY_PRICING_EUR[entry];
        const yearlyPrice = PLAN_YEARLY_PRICING_EUR[entry];
        const isCurrent = entry === currentPlan;
        const isUpgrade = currentPlan ? planRank[entry] > planRank[currentPlan] : false;
        const isDowngrade = currentPlan ? planRank[entry] < planRank[currentPlan] : false;

        return {
          entry,
          features: getFeatureListForPlan(entry),
          monthlyPrice,
          yearlyPrice,
          isCurrent,
          isUpgrade,
          isDowngrade,
          accent: getPlanAccent(entry),
          highlights: getPlanHighlights(entry)
        };
      }),
    [currentPlan]
  );

  useEffect(() => {
    if (isActivationMode || !activeBillingCycle) return;
    setBillingCycle(activeBillingCycle);
  }, [activeBillingCycle, isActivationMode]);

  useEffect(() => {
    let cancelled = false;
    setInvoiceOwner(identity); setInvoices([]); setInvoiceState("loading");
    if (!canReadBilling) return;
    billingUseCases.listInvoices().then(result => {
      if (!cancelled) { setInvoices(result.data); setInvoiceState("ready"); }
    }).catch(() => { if (!cancelled) setInvoiceState("error"); });
    return () => { cancelled = true; };
  }, [canReadBilling, identity, invoiceReload]);

  useEffect(() => {
    if (checkoutStatus === "cancelled") {
      trackPublicEvent("STRIPE_CHECKOUT_FAILED", { reason: "cancelled_return", mode });
    }
  }, [checkoutStatus, mode]);

  useEffect(() => {
    if (!isActivationMode || checkoutStatus !== "success") {
      setActivationCheckStatus("idle");
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const maxAttempts = 25;
    const pollDelayMs = 1500;

    const pollLicense = async (attempt = 1) => {
      if (cancelled) return;
      setActivationCheckStatus("checking");

      try {
        const snapshot = await refresh({ force: true });
        if (cancelled) return;
        if (isOperativeLicenseStatus(snapshot.licenseStatus)) {
          setActivationCheckStatus("ready");
          timeoutId = setTimeout(() => {
            if (!cancelled) navigate(getAccessDestination(window.location.search), { replace: true });
          }, 700);
          return;
        }
      } catch {
        // The webhook may still be processing; keep polling for a short window.
      }

      if (cancelled) return;
      if (attempt >= maxAttempts) {
        setActivationCheckStatus("timeout");
        return;
      }

      timeoutId = setTimeout(() => {
        void pollLicense(attempt + 1);
      }, pollDelayMs);
    };

    void pollLicense();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [checkoutStatus, isActivationMode, navigate, refresh]);

  return (
    <section className="administration-workspace billing-workspace">
      <WorkspacePageHeader eyebrow="ABBONAMENTO" title={isActivationMode ? "Scegli il piano Fleetum" : isRecoveryMode ? "Regolarizza il pagamento" : "Piano e fatturazione"} description={isActivationMode ? "14 giorni di prova con carta richiesta. L’addebito parte alla fine del trial." : isRecoveryMode ? "Aggiorna il metodo di pagamento. L’accesso viene ripristinato dopo la conferma verificata del server." : "Piano attuale, documenti e pagamenti della tua azienda."}/>
      <p className="admin-context">{isActivationMode ? "Completa il pagamento su Stripe. L’accesso si attiva solo dopo la conferma verificata." : "Le modifiche all’abbonamento vengono confermate dal server."} Sconto annuale {ANNUAL_DISCOUNT_PERCENT}%.</p>
      {checkoutStatus === "success" ? (
        <Card className="admin-billing-notice" role="status">
          <CardContent className="flex flex-col gap-2 py-4 text-sm font-semibold md:flex-row md:items-center md:justify-between">
            <div>
              <p>Ritorno dal pagamento. Verifica della conferma del server in corso.</p>
              {activationCheckStatus === "checking" ? (
                <p className="mt-1 text-xs font-medium text-emerald-700/80 dark:text-emerald-100/75">
                  Verifico l’attivazione del tuo account. Appena il pagamento viene confermato ti porto alla dashboard.
                </p>
              ) : null}
              {activationCheckStatus === "ready" ? (
                <p className="mt-1 text-xs font-medium text-emerald-700/80 dark:text-emerald-100/75">
                  Attivazione confermata. Reindirizzamento alla dashboard...
                </p>
              ) : null}
              {activationCheckStatus === "timeout" ? (
                <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-200">
                  La conferma non è ancora disponibile. Il ritorno dal pagamento non attiva il piano: aggiorna la pagina tra qualche secondo o contatta l’assistenza.
                </p>
              ) : null}
            </div>
            {activationCheckStatus === "ready" ? (
              <Button type="button" size="sm" onClick={() => navigate(getAccessDestination(window.location.search), { replace: true })}>
                Vai alla dashboard
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {checkoutStatus === "cancelled" ? (
        <Card className="border-amber-300/70 bg-amber-50/80 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <CardContent className="py-4 text-sm font-semibold">
            Pagamento annullato. Puoi scegliere un piano quando vuoi.
          </CardContent>
        </Card>
      ) : null}

      {paymentMethodStatus === "updated" ? (
        <Card className="admin-billing-notice" role="status">
          <CardContent className="py-4 text-sm font-semibold">
            Sei tornato dalla gestione della carta. Verifica nel portale Stripe l’esito della modifica; questo ritorno non ne conferma il salvataggio.
          </CardContent>
        </Card>
      ) : null}

      {paymentMethodStatus === "cancelled" ? (
        <Card className="border-amber-300/70 bg-amber-50/80 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <CardContent className="py-4 text-sm font-semibold">
            Sei tornato senza completare l’aggiornamento della carta. Verifica il metodo attuale nel portale Stripe.
          </CardContent>
        </Card>
      ) : null}

      {portalStatus === "returned" || portalStatus === "plan-updated" ? (
        <Card className="admin-billing-notice" role="status">
          <CardContent className="py-4 text-sm font-semibold">
            {portalStatus === "plan-updated"
              ? "Sei tornato dal cambio piano. Fleetum aggiorna il piano solo dopo la conferma verificata del server."
              : "Sei tornato dal portale Stripe. Le modifiche vengono applicate solo dopo la conferma verificata del server."}
          </CardContent>
        </Card>
      ) : null}

      {checkoutError ? (
        <Card className="border-red-300/70 bg-red-50/80 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          <CardContent className="py-4 text-sm font-semibold" role="alert">{checkoutError}</CardContent>
        </Card>
      ) : null}


      {!isActivationMode ? (
        <Card className="overflow-hidden border-indigo-200/80 bg-white/90 shadow-[0_24px_70px_-48px_rgba(30,64,175,0.55)] dark:border-indigo-500/25 dark:bg-slate-950/60">
          <CardContent className="grid gap-4 p-5 lg:grid-cols-[1.3fr_0.9fr_0.9fr] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Piano corrente</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-semibold text-foreground">{currentPlan ? planLabel(currentPlan) : "Piano non attivo"}</h2>
                <span className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-semibold",
                  licenseStatus === "ACTIVE" || licenseStatus === "TRIAL"
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200"
                    : "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-100"
                )}>
                  {licenseStatusLabel(licenseStatus)}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {hasManagedStripeSubscription
                  ? "L’abbonamento è gestito da Stripe. Upgrade, fatture e carta passano dal portale sicuro."
                  : "Se il piano non e' collegato a Stripe, la modifica va completata con checkout o assistenza Fleetum."}
              </p>
            </div>

            <div className="rounded-2xl border border-border/70 bg-muted/25 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Fatturazione</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{billingCycleLabel(activeBillingCycle)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {expiresAt
                  ? `${licenseStatus === "TRIAL" ? "Fine trial" : "Prossimo rinnovo"}: ${formatDate(expiresAt)}${daysRemaining !== null ? ` (${daysRemaining} giorni)` : ""}`
                  : "Scadenza non disponibile"}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Button
                type="button"
                className="w-full"
                disabled={!canManageBilling || !hasManagedStripeSubscription || busyPortal || busyPaymentMethod || busyPlan !== null}
                onClick={() => void openCustomerPortalSession()}
              >
                <ExternalLink className="h-4 w-4" />
                {busyPortal ? "Apertura Stripe..." : "Apri portale Stripe"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={!canManageBilling || !hasManagedStripeSubscription || busyPaymentMethod || busyPortal || busyPlan !== null}
                onClick={() => void openPaymentMethodSession()}
              >
                <CreditCard className="h-4 w-4" />
                {busyPaymentMethod ? "Apertura Stripe..." : "Sostituisci carta"}
              </Button>
            </div>
            {billingActionsUnavailableReason ? (
              <p className="lg:col-span-3 text-xs font-medium text-muted-foreground" role="status">
                {billingActionsUnavailableReason}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {welcomeStatus === "billing" ? (
        <Card className="border-indigo-300/70 bg-indigo-50/85 text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-100">
          <CardContent className="py-4 text-sm">
            <strong>Account creato.</strong> Scegli un piano e completa Stripe Checkout. La prova dura 14 giorni,
            ma richiede subito una carta valida; Fleetum si abilita solo dopo la conferma verificata del pagamento.
          </CardContent>
        </Card>
      ) : null}

      {!canManageBilling ? (
        <Card className="border-amber-300/70 bg-amber-50/80 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <CardContent className="py-4 text-sm">
            Le modifiche all’abbonamento richiedono un ruolo autorizzato. Le fatture restano consultabili se il tuo ruolo lo consente.
          </CardContent>
        </Card>
      ) : null}

      {billingStatusNotice ? (
        <Card
          className={cn(
            billingStatusNotice.tone === "info" && "border-indigo-300/70 bg-indigo-50/85 text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-100",
            billingStatusNotice.tone === "warning" && "border-amber-300/80 bg-amber-50/85 text-amber-900 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-100",
            billingStatusNotice.tone === "danger" && "border-rose-300/80 bg-rose-50/85 text-rose-900 dark:border-rose-500/35 dark:bg-rose-500/10 dark:text-rose-100",
            billingStatusNotice.tone === "success" && "border-emerald-300/80 bg-emerald-50/85 text-emerald-900 dark:border-emerald-500/35 dark:bg-emerald-500/10 dark:text-emerald-100"
          )}
        >
          <CardContent className="flex flex-col gap-3 py-4 text-sm md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold">{billingStatusNotice.title}</p>
              <p className="mt-1 opacity-85">{billingStatusNotice.body}</p>
            </div>
            <button
              type="button"
              disabled={!canManageBilling || busyPaymentMethod || busyPortal || busyPlan !== null}
              onClick={handleBillingNoticeAction}
              className="inline-flex shrink-0 items-center justify-center rounded-full border border-current/20 bg-white/65 px-3 py-1 text-xs font-bold uppercase tracking-[0.08em] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-950/30 dark:hover:bg-slate-950/45"
            >
              {billingStatusNotice.actionLabel}
            </button>
          </CardContent>
        </Card>
      ) : null}

      {!isRecoveryMode ? (
        <div
          className="flex justify-center"
        >
          <div className="flex items-center gap-1 rounded-full border border-indigo-200/80 bg-white/90 p-1 shadow-[0_12px_28px_-22px_rgba(79,70,229,0.7)] dark:border-indigo-500/30 dark:bg-slate-900/60">
            <Button
              type="button"
              size="sm"
              variant={billingCycle === "monthly" ? "default" : "ghost"}
              className={cn(
                "h-8 rounded-full px-5 text-xs font-semibold uppercase tracking-[0.08em]",
                billingCycle === "monthly" && "bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 text-white shadow-[0_12px_24px_-16px_rgba(79,70,229,0.75)]"
              )}
              onClick={() => setBillingCycle("monthly")}
            >
              Mensile
            </Button>
            <Button
              type="button"
              size="sm"
              variant={billingCycle === "yearly" ? "default" : "ghost"}
              className={cn(
                "h-8 rounded-full px-5 text-xs font-semibold uppercase tracking-[0.08em]",
                billingCycle === "yearly" && "bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 text-white shadow-[0_12px_24px_-16px_rgba(79,70,229,0.75)]"
              )}
              onClick={() => setBillingCycle("yearly")}
            >
              Annuale
            </Button>
          </div>
        </div>
      ) : null}

      {!isRecoveryMode ? (
        <div id="billing-plans" className="grid scroll-mt-24 gap-4 lg:grid-cols-3">
        {planCards.map(({ entry, features, monthlyPrice, yearlyPrice, isCurrent, isUpgrade, isDowngrade, accent, highlights }, index) => {
          const priceValue = billingCycle === "monthly" ? monthlyPrice : yearlyPrice;
          const priceSuffix = billingCycle === "monthly" ? "/mese" : "/anno";
          const isLockedLowerPlan = !isActivationMode && isDowngrade;
          const canUsePortalForUpgrade = !isActivationMode && hasManagedStripeSubscription && isUpgrade;
          const canUseCheckoutForPlan = isActivationMode;
          const buttonLabel = loading
            ? "Verifico piano..."
            : !canManageBilling
              ? "Solo amministratore"
              : isCurrent
                ? licenseStatus === "TRIAL"
                  ? "Trial attivo"
                  : "Piano attivo"
                : isLockedLowerPlan
                  ? "Piano inferiore bloccato"
                  : canUsePortalForUpgrade
                    ? `Passa a ${planLabel(entry)}`
                    : isActivationMode
                      ? "Prova 14 giorni con carta"
                      : "Gestione da Platform";
          const planActionDisabled =
            loading ||
            !canManageBilling ||
            busyPlan !== null || busyPortal || busyPaymentMethod ||
            isCurrent ||
            isLockedLowerPlan ||
            (!canUsePortalForUpgrade && !canUseCheckoutForPlan);

          return (
            <Card
              key={entry}
              className={cn(
                "admin-plan-card relative overflow-hidden",
                isCurrent && "border-primary/50 shadow-[0_22px_40px_-30px_rgba(79,70,229,0.5)]",
                entry === "PRO" && !isCurrent && "admin-plan-suggested"
              )}
            >


              <CardHeader className="space-y-3 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg">{entry}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">{entry === "STARTER" ? "Per team in partenza" : entry === "PRO" ? "Per crescita operativa" : "Per controllo enterprise"}</p>
                  </div>
                  <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]", accent.chip)}>
                    {isCurrent ? "Attuale" : entry === "PRO" ? "Consigliato" : "Disponibile"}
                  </span>
                </div>

                <div>
                  <p className="text-3xl font-semibold tracking-tight text-foreground">{formatPrice(priceValue)}</p>
                  <p className="text-xs text-muted-foreground">{priceSuffix}</p>
                  {isActivationMode ? (
                    <p className="mt-1 text-xs font-semibold text-emerald-600 dark:text-emerald-300">
                      14 giorni di prova, carta richiesta ora, primo addebito dopo il trial.
                    </p>
                  ) : isCurrent ? (
                    <p className="mt-1 text-xs font-semibold text-emerald-600 dark:text-emerald-300">
                      Questo è il piano attualmente assegnato alla tua azienda.
                    </p>
                  ) : isLockedLowerPlan ? (
                    <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
                      Downgrade bloccato da questa schermata per evitare perdita di funzionalita.
                    </p>
                  ) : isUpgrade ? (
                    <p className="mt-1 text-xs font-semibold text-indigo-600 dark:text-indigo-300">
                      Upgrade disponibile tramite gestione sicura Stripe.
                    </p>
                  ) : null}
                </div>
              </CardHeader>

              <CardContent className="space-y-3">
                <div className="space-y-2">
                  {highlights.map((item) => (
                    <p key={`${entry}-${item}`} className="flex items-center gap-2 text-sm text-foreground">
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                      {item}
                    </p>
                  ))}
                </div>

                <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Feature incluse</p>
                  <p className="mt-1 text-xs text-foreground">
                    {features.length} funzionalita abilitate su {orderedFeatures.length}
                  </p>
                </div>

                {isCurrent ? (
                  <Button className="w-full" disabled>
                    {buttonLabel}
                  </Button>
                ) : (
                  <button
                    type="button"
                    disabled={planActionDisabled}
                    onClick={async () => {
                      if (planActionDisabled || billingLock.current) return;
                      billingLock.current = true;
                      setCheckoutError(null);
                      setBusyPlan(entry);
                      try {
                        if (canUsePortalForUpgrade) {
                          const session = await billingUseCases.createCustomerPortalSession({
                            plan: entry,
                            billingCycle
                          });
                          if (activeIdentity.current !== identity) return;
      window.location.href = session.portalUrl;
                          return;
                        }

                        trackPublicEvent("STRIPE_CHECKOUT_STARTED", { plan: entry, billingCycle, mode });
                        const session = await billingUseCases.createCheckoutSession({
                          plan: entry,
                          billingCycle,
                          analytics: getConsentedPublicAnalyticsContext()
                        });
                        if (activeIdentity.current !== identity) return;
      window.location.href = session.checkoutUrl;
                      } catch (error) {
                        setCheckoutError((error as Error).message);
                        billingLock.current = false;
                        setBusyPlan(null);
                      }
                    }}
                    className={cn(
                      "inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition",
                      planActionDisabled
                        ? "cursor-not-allowed border border-input bg-muted text-muted-foreground opacity-70"
                        : !currentPlan || isUpgrade
                          ? "admin-primary-action"
                          : "border border-input bg-background text-foreground hover:bg-muted"
                    )}
                  >
                    {entry === "ENTERPRISE" ? <Crown className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                    {busyPlan === entry ? "Apertura pagamento..." : buttonLabel}
                  </button>
                )}
              </CardContent>
            </Card>
          );
        })}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-primary" />
            Fatture e documenti di cortesia
          </h2>
        </CardHeader>
        <CardContent>
          {!canReadBilling ? (
            <div className="rounded-2xl border border-dashed border-border/80 bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
              Le fatture sono visibili solo agli utenti autorizzati alla gestione billing.
            </div>
          ) : invoiceOwner !== identity || invoiceState === "loading" ? <p role="status" className="admin-context">Caricamento delle fatture…</p> : invoiceState === "error" ? <CommerceNotice>Le fatture non sono disponibili. <Button variant="outline" onClick={() => setInvoiceReload(key => key + 1)}>Riprova</Button></CommerceNotice> : invoices.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/80 bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
              Nessuna fattura disponibile. Quando Fleetum emette un documento per la tua azienda, lo trovi qui.
            </div>
          ) : (
            <div className="overflow-auto rounded-2xl border border-border/70">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Numero</TableHead>
                    <TableHead>Periodo</TableHead>
                    <TableHead>Scadenza</TableHead>
                    <TableHead>Totale</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead>PDF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-semibold">{invoice.invoiceNumber}</TableCell>
                      <TableCell>{formatDate(invoice.periodStart)} - {formatDate(invoice.periodEnd)}</TableCell>
                      <TableCell>{formatDate(invoice.dueDate)}</TableCell>
                      <TableCell>{formatMoney(invoice.total, invoice.currency)}</TableCell>
                      <TableCell>{invoice.status}</TableCell>
                      <TableCell>
                        <InvoiceDownloadButton invoiceId={invoice.id} invoiceNumber={invoice.invoiceNumber} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base">Confronto completo funzionalita</h2>
        </CardHeader>
        <CardContent className="overflow-auto">
          <Table className="[&_th]:py-1.5 [&_td]:py-1.5 [&_td]:text-[12px]">
            <TableHeader>
              <TableRow>
                <TableHead>Feature</TableHead>
                <TableHead>STARTER</TableHead>
                <TableHead>PRO</TableHead>
                <TableHead>ENTERPRISE</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orderedFeatures.map((feature) => (
                <TableRow key={feature}>
                  <TableCell className="font-medium">{FEATURE_LABELS[feature as FeatureKey]}</TableCell>
                  {SAAS_PLANS.map((entry) => {
                    const enabled = getFeatureListForPlan(entry).includes(feature);
                    return (
                      <TableCell key={`${feature}-${entry}`}>
                        {enabled ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-500/45 dark:bg-emerald-500/15 dark:text-emerald-200">
                            <Check className="h-3.5 w-3.5" /> Inclusa
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/45 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                            <Lock className="h-3.5 w-3.5" /> Bloccata
                          </span>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!isRecoveryMode ? <Card>
        <CardContent className="flex flex-col items-center gap-3 py-5 text-center sm:flex-row sm:justify-between sm:text-left">
          <p className="text-sm text-muted-foreground">
            Gli upgrade vengono gestiti dal Customer Portal Stripe per evitare abbonamenti duplicati. I downgrade restano bloccati da questa schermata e vanno valutati con il supporto Fleetum.
          </p>
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/95"
          >
            Scegli un piano
            <ArrowRight className="h-4 w-4" />
          </button>
        </CardContent>
      </Card> : null}
    </section>
  );
};
