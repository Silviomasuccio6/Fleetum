import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, BadgeEuro, CheckCircle2, CreditCard, Euro, FileWarning, Loader2, LockKeyhole, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useAuthStore } from "../../../application/stores/auth-store";
import {
  RentalDepositDto,
  RentalDepositStatus,
  RentalExtraChargeDto,
  RentalExtraChargeStatus,
  RentalExtraChargeType,
  RentalPaymentMethodDto,
  RentalPaymentMethodStatus,
  RentalPaymentSummaryDto,
  rentalPaymentsUseCases
} from "../../../application/usecases/rental-payments-usecases";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Textarea } from "../ui/textarea";

type RentalPaymentBooking = {
  id: string;
  code: string;
  customerName: string;
  pickupAt: string;
  returnAt: string;
  vehicle: {
    plate: string;
    brand: string;
    model: string;
  };
  customer?: {
    id: string;
    email?: string | null;
    phone?: string | null;
  } | null;
};

type Props = {
  booking: RentalPaymentBooking;
  paymentSetupStatus?: string | null;
};

type ModalKind = "setup" | "deposit" | "extra" | null;
type ActionState = { type: string; id?: string } | null;

const TERMS_VERSION = "rental-payment-mandate-2026-07-01";

const methodLabels: Record<RentalPaymentMethodStatus, string> = {
  SETUP_PENDING: "In verifica",
  ACTIVE: "Attiva",
  FAILED: "Fallita",
  REQUIRES_ACTION: "Autenticazione richiesta",
  EXPIRED: "Scaduta",
  REMOVED: "Rimossa"
};

const depositLabels: Record<RentalDepositStatus, string> = {
  DRAFT: "Bozza",
  AUTHORIZING: "Autorizzazione in corso",
  AUTHORIZED: "Autorizzato",
  PARTIALLY_CAPTURED: "Catturato parzialmente",
  CAPTURED: "Catturato",
  RELEASED: "Rilasciato",
  CANCELED: "Annullato",
  FAILED: "Fallito",
  EXPIRED: "Scaduto"
};

const extraLabels: Record<RentalExtraChargeStatus, string> = {
  DRAFT: "Bozza",
  PENDING_APPROVAL: "In approvazione",
  APPROVED: "Approvato",
  NOTIFIED: "Cliente notificato",
  PAYMENT_PROCESSING: "Pagamento in corso",
  PAID: "Pagato",
  FAILED: "Fallito",
  REQUIRES_ACTION: "Autenticazione richiesta",
  CANCELED: "Annullato",
  REFUNDED: "Rimborsato",
  DISPUTED: "Contestato"
};

const extraTypeLabels: Record<RentalExtraChargeType, string> = {
  FINE: "Multa",
  DAMAGE: "Danno",
  DEDUCTIBLE: "Franchigia",
  FUEL: "Carburante",
  TOLL: "Pedaggio",
  LATE_RETURN: "Ritardo riconsegna",
  CLEANING: "Pulizia straordinaria",
  MISSING_ACCESSORY: "Accessorio mancante",
  ADMIN_FEE: "Costo amministrativo",
  OTHER: "Altro"
};

const extraTypeOptions = Object.keys(extraTypeLabels) as RentalExtraChargeType[];

const money = (cents?: number | null, currency = "EUR") =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency }).format((cents ?? 0) / 100);

const formatDateTime = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

const eurosToCents = (value: string) => {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
};

const optionalEurosToCents = (value: string) => {
  if (!value.trim()) return 0;
  const parsed = eurosToCents(value);
  return parsed ?? null;
};

const statusVariant = (status: string): "outline" | "secondary" | "success" | "destructive" | "warning" => {
  if (["ACTIVE", "AUTHORIZED", "PAID", "APPROVED", "NOTIFIED"].includes(status)) return "success";
  if (["FAILED", "CANCELED", "EXPIRED", "DISPUTED"].includes(status)) return "destructive";
  if (["REQUIRES_ACTION", "AUTHORIZING", "PAYMENT_PROCESSING", "SETUP_PENDING", "PENDING_APPROVAL"].includes(status)) return "warning";
  if (["CAPTURED", "PARTIALLY_CAPTURED", "RELEASED"].includes(status)) return "secondary";
  return "outline";
};

const methodDisplay = (method?: RentalPaymentMethodDto | null) => {
  if (!method) return "Carta non registrata";
  const brand = method.cardBrand ? method.cardBrand[0].toUpperCase() + method.cardBrand.slice(1) : "Carta";
  const last4 = method.cardLast4 ? `**** ${method.cardLast4}` : "in verifica";
  return `${brand} ${last4}`;
};

const methodExpiry = (method?: RentalPaymentMethodDto | null) => {
  if (!method?.cardExpMonth || !method.cardExpYear) return null;
  return `${String(method.cardExpMonth).padStart(2, "0")}/${method.cardExpYear}`;
};

const isActionBusy = (busy: ActionState, type: string, id?: string) => busy?.type === type && (!id || busy.id === id);

const canCaptureDeposit = (deposit: RentalDepositDto) => deposit.status === "AUTHORIZED";
const canReleaseDeposit = (deposit: RentalDepositDto) => deposit.status === "AUTHORIZED";
const canApproveExtra = (charge: RentalExtraChargeDto) => ["DRAFT", "PENDING_APPROVAL"].includes(charge.status);
const canNotifyExtra = (charge: RentalExtraChargeDto) => ["APPROVED"].includes(charge.status);
const canChargeExtra = (charge: RentalExtraChargeDto) => ["APPROVED", "NOTIFIED", "FAILED", "REQUIRES_ACTION"].includes(charge.status);
const canCancelExtra = (charge: RentalExtraChargeDto) => !["PAID", "REFUNDED", "DISPUTED", "CANCELED"].includes(charge.status);

export const RentalPaymentGuaranteePanel = ({ booking, paymentSetupStatus }: Props) => {
  const user = useAuthStore((state) => state.user);
  const permissions = user?.permissions ?? [];
  const canRead = permissions.includes("rental-payments:read");
  const canWrite = permissions.includes("rental-payments:write");
  const canCharge = permissions.includes("rental-payments:charge");

  const [summary, setSummary] = useState<RentalPaymentSummaryDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [actionBusy, setActionBusy] = useState<ActionState>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [mandateAccepted, setMandateAccepted] = useState(false);
  const [depositAmount, setDepositAmount] = useState("500");
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState("");
  const [extraForm, setExtraForm] = useState({
    type: "FINE" as RentalExtraChargeType,
    description: "",
    amount: "",
    adminFee: "",
    evidenceFileUrl: "",
    paymentMethodId: ""
  });

  const activePaymentMethods = useMemo(
    () => (summary?.paymentMethods ?? []).filter((method) => method.status === "ACTIVE"),
    [summary]
  );
  const primaryPaymentMethod = activePaymentMethods[0] ?? summary?.paymentMethods?.[0] ?? null;
  const latestDeposit = summary?.deposits?.[0] ?? null;
  const totalExtraCents = useMemo(
    () => (summary?.extraCharges ?? []).reduce((total, charge) => total + charge.totalAmountCents, 0),
    [summary]
  );

  const loadSummary = async () => {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    try {
      const result = await rentalPaymentsUseCases.getBookingPaymentSummary(booking.id);
      setSummary(result);
      const firstActive = result.paymentMethods.find((method) => method.status === "ACTIVE");
      setSelectedPaymentMethodId((current) => current || firstActive?.id || "");
      setExtraForm((current) => ({ ...current, paymentMethodId: current.paymentMethodId || firstActive?.id || "" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSummary();
  }, [booking.id, canRead]);

  useEffect(() => {
    if (paymentSetupStatus === "success" || paymentSetupStatus === "setup_success") {
      setNotice("Carta in verifica. Lo stato definitivo verra aggiornato dopo conferma Stripe.");
      void loadSummary();
    } else if (paymentSetupStatus === "cancelled" || paymentSetupStatus === "setup_cancelled") {
      setNotice("Registrazione carta annullata. Puoi riprendere la procedura quando vuoi.");
    }
  }, [paymentSetupStatus, booking.id]);

  if (!canRead) return null;

  const closeModal = () => {
    setModal(null);
    setMandateAccepted(false);
    setError(null);
  };

  const runSetupSession = async () => {
    if (!mandateAccepted) return;
    setActionBusy({ type: "setup" });
    setError(null);
    try {
      const session = await rentalPaymentsUseCases.createSetupSession(booking.id, {
        mandateAccepted: true,
        termsVersion: TERMS_VERSION
      });
      window.location.href = session.checkoutUrl;
    } catch (e) {
      setError((e as Error).message);
      setActionBusy(null);
    }
  };

  const runCreateDeposit = async () => {
    const amountCents = eurosToCents(depositAmount);
    if (!selectedPaymentMethodId || !amountCents) {
      setError("Seleziona una carta attiva e inserisci un importo deposito valido.");
      return;
    }
    setActionBusy({ type: "create-deposit" });
    setError(null);
    try {
      await rentalPaymentsUseCases.createDeposit(booking.id, { paymentMethodId: selectedPaymentMethodId, amountCents });
      setNotice("Deposito creato. Lo stato viene aggiornato in base all'esito Stripe.");
      closeModal();
      await loadSummary();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusy(null);
    }
  };

  const runCaptureDeposit = async (deposit: RentalDepositDto, partial = false) => {
    let amountToCaptureCents: number | undefined;
    if (partial) {
      const value = window.prompt("Importo da catturare in euro", String((deposit.amountCents - deposit.capturedAmountCents) / 100));
      if (value === null) return;
      const parsed = eurosToCents(value);
      if (!parsed) {
        setError("Importo cattura non valido.");
        return;
      }
      amountToCaptureCents = parsed;
    }
    setActionBusy({ type: partial ? "capture-partial" : "capture", id: deposit.id });
    setError(null);
    try {
      await rentalPaymentsUseCases.captureDeposit(deposit.id, partial ? { amountToCaptureCents } : undefined);
      setNotice(partial ? "Deposito catturato parzialmente." : "Deposito catturato.");
      await loadSummary();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusy(null);
    }
  };

  const runReleaseDeposit = async (deposit: RentalDepositDto) => {
    setActionBusy({ type: "release", id: deposit.id });
    setError(null);
    try {
      await rentalPaymentsUseCases.releaseDeposit(deposit.id);
      setNotice("Deposito rilasciato.");
      await loadSummary();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusy(null);
    }
  };

  const runCreateExtraCharge = async () => {
    const amountCents = eurosToCents(extraForm.amount);
    const adminFeeCents = optionalEurosToCents(extraForm.adminFee);
    if (!amountCents || adminFeeCents === null || extraForm.description.trim().length < 3) {
      setError("Compila tipo, descrizione e importi validi per creare l'addebito extra.");
      return;
    }
    setActionBusy({ type: "create-extra" });
    setError(null);
    try {
      await rentalPaymentsUseCases.createExtraCharge(booking.id, {
        type: extraForm.type,
        description: extraForm.description.trim(),
        amountCents,
        adminFeeCents,
        paymentMethodId: extraForm.paymentMethodId || undefined,
        evidenceFileUrl: extraForm.evidenceFileUrl.trim() || undefined
      });
      setNotice("Addebito extra creato e in attesa di approvazione.");
      setExtraForm({ type: "FINE", description: "", amount: "", adminFee: "", evidenceFileUrl: "", paymentMethodId: activePaymentMethods[0]?.id ?? "" });
      closeModal();
      await loadSummary();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusy(null);
    }
  };

  const runExtraAction = async (charge: RentalExtraChargeDto, action: "approve" | "notify" | "charge" | "cancel") => {
    setActionBusy({ type: action, id: charge.id });
    setError(null);
    try {
      if (action === "approve") await rentalPaymentsUseCases.approveExtraCharge(charge.id);
      if (action === "notify") await rentalPaymentsUseCases.notifyExtraCharge(charge.id);
      if (action === "charge") await rentalPaymentsUseCases.chargeExtraCharge(charge.id, { paymentMethodId: charge.paymentMethodId ?? activePaymentMethods[0]?.id });
      if (action === "cancel") await rentalPaymentsUseCases.cancelExtraCharge(charge.id);
      setNotice("Workflow addebito aggiornato.");
      await loadSummary();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border bg-card/70 p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <Label>Pagamenti & Garanzie</Label>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Carta cliente finale, deposito cauzionale e addebiti extra collegati alla prenotazione.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void loadSummary()} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Aggiorna
        </Button>
      </div>

      {notice ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-2 md:grid-cols-3 2xl:grid-cols-1">
        <div className="rounded-xl border bg-muted/10 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <CreditCard className="h-3.5 w-3.5" /> Carta garanzia
          </div>
          <p className="mt-2 text-sm font-semibold">{methodDisplay(primaryPaymentMethod)}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {primaryPaymentMethod ? <Badge variant={statusVariant(primaryPaymentMethod.status)}>{methodLabels[primaryPaymentMethod.status]}</Badge> : null}
            {methodExpiry(primaryPaymentMethod) ? <span>Scadenza {methodExpiry(primaryPaymentMethod)}</span> : null}
          </div>
          {primaryPaymentMethod?.mandateAcceptedAt ? (
            <p className="mt-1 text-[11px] text-muted-foreground">Consenso: {formatDateTime(primaryPaymentMethod.mandateAcceptedAt)}</p>
          ) : null}
        </div>

        <div className="rounded-xl border bg-muted/10 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <LockKeyhole className="h-3.5 w-3.5" /> Deposito
          </div>
          <p className="mt-2 text-sm font-semibold">{latestDeposit ? money(latestDeposit.amountCents, latestDeposit.currency) : "Nessun deposito"}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {latestDeposit ? <Badge variant={statusVariant(latestDeposit.status)}>{depositLabels[latestDeposit.status]}</Badge> : null}
            {latestDeposit ? <span>Catturato {money(latestDeposit.capturedAmountCents, latestDeposit.currency)}</span> : null}
          </div>
        </div>

        <div className="rounded-xl border bg-muted/10 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <BadgeEuro className="h-3.5 w-3.5" /> Extra
          </div>
          <p className="mt-2 text-sm font-semibold">{money(totalExtraCents)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{summary?.extraCharges.length ?? 0} addebiti registrati</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setModal("setup")} disabled={!canWrite || Boolean(actionBusy)}>
          {primaryPaymentMethod ? "Sostituisci carta" : "Registra carta garanzia"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setModal("deposit")} disabled={!canCharge || activePaymentMethods.length === 0 || Boolean(actionBusy)}>
          Crea deposito
        </Button>
        <Button size="sm" variant="outline" onClick={() => setModal("extra")} disabled={!canWrite || Boolean(actionBusy)}>
          Nuovo addebito extra
        </Button>
      </div>

      {activePaymentMethods.length === 0 ? (
        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Registra una carta attiva prima di creare depositi o addebiti diretti.</span>
        </div>
      ) : null}

      <div className="rounded-xl border bg-muted/10 p-3 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">Contesto noleggio</p>
        <p className="mt-1">Cliente: {booking.customerName} · Booking: {booking.code}</p>
        <p>Veicolo: {booking.vehicle.plate} · {booking.vehicle.brand} {booking.vehicle.model}</p>
        <p>Periodo: {formatDateTime(booking.pickupAt)} → {formatDateTime(booking.returnAt)}</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Euro className="h-4 w-4" /> Depositi cauzionali
        </div>
        {(summary?.deposits ?? []).length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">Nessun deposito cauzionale registrato.</p>
        ) : (
          <div className="space-y-2">
            {(summary?.deposits ?? []).map((deposit) => (
              <div key={deposit.id} className="rounded-lg border bg-card p-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{money(deposit.amountCents, deposit.currency)}</p>
                    <p className="text-muted-foreground">Catturato {money(deposit.capturedAmountCents, deposit.currency)}</p>
                    {deposit.failureReason ? <p className="text-rose-600">{deposit.failureReason}</p> : null}
                  </div>
                  <Badge variant={statusVariant(deposit.status)}>{depositLabels[deposit.status]}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => void runCaptureDeposit(deposit)} disabled={!canCharge || !canCaptureDeposit(deposit) || isActionBusy(actionBusy, "capture", deposit.id)}>
                    Cattura totale
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void runCaptureDeposit(deposit, true)} disabled={!canCharge || !canCaptureDeposit(deposit) || isActionBusy(actionBusy, "capture-partial", deposit.id)}>
                    Cattura parziale
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void runReleaseDeposit(deposit)} disabled={!canCharge || !canReleaseDeposit(deposit) || isActionBusy(actionBusy, "release", deposit.id)}>
                    Rilascia
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          La durata dell'autorizzazione dipende dal circuito e dalla banca. Se scade, il deposito va ricreato.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <FileWarning className="h-4 w-4" /> Addebiti extra
        </div>
        {(summary?.extraCharges ?? []).length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">Nessun addebito extra registrato.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Descrizione</TableHead>
                  <TableHead>Importo</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(summary?.extraCharges ?? []).map((charge) => (
                  <TableRow key={charge.id}>
                    <TableCell className="text-xs font-semibold">{extraTypeLabels[charge.type]}</TableCell>
                    <TableCell className="max-w-[190px] truncate text-xs">
                      {charge.description}
                      {charge.evidenceFileUrl ? <p className="text-[10px] text-muted-foreground">Documento collegato</p> : null}
                      {charge.failureReason ? <p className="text-[10px] text-rose-600">{charge.failureReason}</p> : null}
                    </TableCell>
                    <TableCell className="text-xs">
                      <p>{money(charge.totalAmountCents, charge.currency)}</p>
                      <p className="text-[10px] text-muted-foreground">Base {money(charge.amountCents, charge.currency)} · Fee {money(charge.adminFeeCents, charge.currency)}</p>
                    </TableCell>
                    <TableCell><Badge variant={statusVariant(charge.status)}>{extraLabels[charge.status]}</Badge></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => void runExtraAction(charge, "approve")} disabled={!canCharge || !canApproveExtra(charge) || isActionBusy(actionBusy, "approve", charge.id)}>Approva</Button>
                        <Button size="sm" variant="outline" onClick={() => void runExtraAction(charge, "notify")} disabled={!canWrite || !canNotifyExtra(charge) || isActionBusy(actionBusy, "notify", charge.id)}>Notifica</Button>
                        <Button size="sm" variant="outline" onClick={() => void runExtraAction(charge, "charge")} disabled={!canCharge || activePaymentMethods.length === 0 || !canChargeExtra(charge) || isActionBusy(actionBusy, "charge", charge.id)}>Addebita</Button>
                        <Button size="sm" variant="destructive" onClick={() => void runExtraAction(charge, "cancel")} disabled={!canWrite || !canCancelExtra(charge) || isActionBusy(actionBusy, "cancel", charge.id)}>Annulla</Button>
                      </div>
                      {charge.status === "REQUIRES_ACTION" ? (
                        <p className="mt-1 text-[10px] text-amber-700">La banca richiede autenticazione cliente. Invia un link sicuro o aggiorna carta.</p>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {modal === "setup" ? (
        <PanelModal title="Registra carta garanzia" onClose={closeModal}>
          <div className="space-y-3 text-sm">
            <div className="rounded-xl border bg-muted/20 p-3 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">{booking.customerName}</p>
              <p>{booking.code} · {booking.vehicle.plate} · {booking.vehicle.brand} {booking.vehicle.model}</p>
            </div>
            <p>
              La carta verra registrata tramite Stripe e sara utilizzabile esclusivamente per importi collegati al contratto di noleggio e alle condizioni accettate. Fleetum non salva il numero completo della carta ne il CVV.
            </p>
            <label className="flex cursor-pointer gap-3 rounded-xl border p-3 text-xs leading-relaxed">
              <input type="checkbox" className="mt-1" checked={mandateAccepted} onChange={(e) => setMandateAccepted(e.target.checked)} />
              <span>
                Autorizzo l'utilizzo del metodo di pagamento registrato per eventuali importi successivi collegati al contratto di noleggio, inclusi multe, pedaggi, danni, franchigie, carburante mancante, ritardi nella riconsegna, pulizia straordinaria, accessori mancanti e costi amministrativi previsti dal contratto e dalle condizioni accettate.
              </span>
            </label>
            <Button className="w-full" onClick={() => void runSetupSession()} disabled={!mandateAccepted || isActionBusy(actionBusy, "setup")}>
              {isActionBusy(actionBusy, "setup") ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Continua su Stripe
            </Button>
          </div>
        </PanelModal>
      ) : null}

      {modal === "deposit" ? (
        <PanelModal title="Crea deposito cauzionale" onClose={closeModal}>
          <div className="space-y-3">
            <FieldPaymentMethodSelect value={selectedPaymentMethodId} onChange={setSelectedPaymentMethodId} methods={activePaymentMethods} />
            <div className="space-y-1">
              <Label>Importo deposito</Label>
              <Input value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} inputMode="decimal" placeholder="500,00" />
            </div>
            <Button className="w-full" onClick={() => void runCreateDeposit()} disabled={!selectedPaymentMethodId || isActionBusy(actionBusy, "create-deposit")}>
              {isActionBusy(actionBusy, "create-deposit") ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
              Autorizza deposito
            </Button>
          </div>
        </PanelModal>
      ) : null}

      {modal === "extra" ? (
        <PanelModal title="Nuovo addebito extra" onClose={closeModal}>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Tipo</Label>
                <Select value={extraForm.type} onChange={(e) => setExtraForm((state) => ({ ...state, type: e.target.value as RentalExtraChargeType }))}>
                  {extraTypeOptions.map((type) => <option key={type} value={type}>{extraTypeLabels[type]}</option>)}
                </Select>
              </div>
              <FieldPaymentMethodSelect value={extraForm.paymentMethodId} onChange={(value) => setExtraForm((state) => ({ ...state, paymentMethodId: value }))} methods={activePaymentMethods} optional />
            </div>
            <div className="space-y-1">
              <Label>Descrizione</Label>
              <Textarea rows={3} value={extraForm.description} onChange={(e) => setExtraForm((state) => ({ ...state, description: e.target.value }))} placeholder="Es. Pedaggio autostradale A1" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Importo</Label>
                <Input value={extraForm.amount} onChange={(e) => setExtraForm((state) => ({ ...state, amount: e.target.value }))} inputMode="decimal" placeholder="75,00" />
              </div>
              <div className="space-y-1">
                <Label>Spese amministrative</Label>
                <Input value={extraForm.adminFee} onChange={(e) => setExtraForm((state) => ({ ...state, adminFee: e.target.value }))} inputMode="decimal" placeholder="10,00" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Documento/evidenza URL</Label>
              <Input value={extraForm.evidenceFileUrl} onChange={(e) => setExtraForm((state) => ({ ...state, evidenceFileUrl: e.target.value }))} placeholder="https://..." />
              <p className="text-[11px] text-muted-foreground">Per multe e danni e consigliato collegare una prova o un documento.</p>
            </div>
            <Button className="w-full" onClick={() => void runCreateExtraCharge()} disabled={isActionBusy(actionBusy, "create-extra")}>
              {isActionBusy(actionBusy, "create-extra") ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Crea addebito
            </Button>
          </div>
        </PanelModal>
      ) : null}
    </div>
  );
};

const FieldPaymentMethodSelect = ({
  value,
  onChange,
  methods,
  optional = false
}: {
  value: string;
  onChange: (value: string) => void;
  methods: RentalPaymentMethodDto[];
  optional?: boolean;
}) => (
  <div className="space-y-1">
    <Label>Metodo di pagamento</Label>
    <Select value={value} onChange={(event) => onChange(event.target.value)}>
      {optional ? <option value="">Da scegliere prima dell'addebito</option> : <option value="">Seleziona carta attiva</option>}
      {methods.map((method) => (
        <option key={method.id} value={method.id}>
          {methodDisplay(method)}{methodExpiry(method) ? ` · ${methodExpiry(method)}` : ""}
        </option>
      ))}
    </Select>
  </div>
);

const PanelModal = ({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) => (
  <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
    <Card className="max-h-[90vh] w-full max-w-2xl overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Chiudi modale">
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="max-h-[calc(90vh-5rem)] overflow-y-auto p-4">{children}</CardContent>
    </Card>
  </div>
);
