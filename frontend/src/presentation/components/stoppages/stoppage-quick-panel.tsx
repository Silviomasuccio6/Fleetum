import { FormEvent, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { masterDataUseCases } from "../../../application/usecases/master-data-usecases";
import { stoppagesUseCases } from "../../../application/usecases/stoppages-usecases";
import { usersUseCases } from "../../../application/usecases/users-usecases";
import { stoppageStatusOptions } from "../../../domain/constants/stoppage-status";
import { FleetumInlineLoader } from "../brand/fleetum-logo-loader";
import { StoppageStatusBadge } from "./status-badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";

type Props = {
  open: boolean;
  stoppageId: string | null;
  mode: "detail" | "edit" | "create";
  onClose: () => void;
  onSaved: () => void;
  initialOpenedAt?: string | null;
  initialClosedAt?: string | null;
  initialColor?: string | null;
  onSavedRecord?: (record: any, meta?: { color?: string | null }) => void;
};

const priorityOptions = [
  { value: "LOW", label: "Bassa" },
  { value: "MEDIUM", label: "Media" },
  { value: "HIGH", label: "Alta" },
  { value: "CRITICAL", label: "Critica" }
];

const toList = (value: any): any[] => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
};

const nowIso = () => new Date().toISOString();
const toLocalDateTimeInput = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalDateTimeInput = (value: string) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const eventColorOptions = [
  "#2563eb",
  "#0ea5e9",
  "#14b8a6",
  "#22c55e",
  "#eab308",
  "#f97316",
  "#ef4444",
  "#a855f7"
];

export const StoppageQuickPanel = ({
  open,
  stoppageId,
  mode,
  onClose,
  onSaved,
  initialOpenedAt,
  initialClosedAt,
  initialColor,
  onSavedRecord
}: Props) => {
  const [tab, setTab] = useState<"detail" | "edit">(mode === "create" ? "edit" : (mode as "detail" | "edit"));
  const [detail, setDetail] = useState<any | null>(null);
  const [sites, setSites] = useState<any[]>([]);
  const [workshops, setWorkshops] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);

  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [selectedWorkshopId, setSelectedWorkshopId] = useState("");

  const [showQuickWorkshop, setShowQuickWorkshop] = useState(false);
  const [quickWorkshopError, setQuickWorkshopError] = useState<string | null>(null);
  const [quickWorkshopSuccess, setQuickWorkshopSuccess] = useState<string | null>(null);
  const [quickWorkshopName, setQuickWorkshopName] = useState("");
  const [quickWorkshopEmail, setQuickWorkshopEmail] = useState("");
  const [quickWorkshopPhone, setQuickWorkshopPhone] = useState("");
  const [quickWorkshopCity, setQuickWorkshopCity] = useState("");
  const [quickWorkshopAddress, setQuickWorkshopAddress] = useState("");

  const [showQuickVehicle, setShowQuickVehicle] = useState(false);
  const [quickVehicleError, setQuickVehicleError] = useState<string | null>(null);
  const [quickVehicleSuccess, setQuickVehicleSuccess] = useState<string | null>(null);
  const [quickPlate, setQuickPlate] = useState("");
  const [quickBrand, setQuickBrand] = useState("");
  const [quickModel, setQuickModel] = useState("");
  const [quickYear, setQuickYear] = useState("");
  const [quickNotes, setQuickNotes] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [openedAtInput, setOpenedAtInput] = useState("");
  const [closedAtInput, setClosedAtInput] = useState("");
  const [selectedColor, setSelectedColor] = useState(initialColor ?? eventColorOptions[0]);

  useEffect(() => setTab(mode === "create" ? "edit" : (mode as "detail" | "edit")), [mode, stoppageId]);
  useEffect(() => {
    setSelectedColor(initialColor ?? eventColorOptions[0]);
  }, [initialColor, open]);
  useEffect(() => {
    if (!openedAtInput) return;
    const opened = new Date(openedAtInput);
    if (Number.isNaN(opened.getTime())) return;
    const closed = closedAtInput ? new Date(closedAtInput) : null;
    if (!closed || Number.isNaN(closed.getTime()) || closed.getTime() <= opened.getTime()) {
      const nextClosed = new Date(opened.getTime() + 60 * 60000);
      setClosedAtInput(toLocalDateTimeInput(nextClosed.toISOString()));
    }
  }, [openedAtInput, closedAtInput]);

  useEffect(() => {
    if (!open) return;
    let mounted = true;

    setError(null);
    setShowQuickVehicle(false);
    setShowQuickWorkshop(false);
    if (mode === "create") setDetail(null);

    Promise.allSettled([
      stoppageId ? stoppagesUseCases.getById(stoppageId) : Promise.resolve(null),
      masterDataUseCases.listSites({ page: 1, pageSize: 200 }),
      masterDataUseCases.listWorkshops({ page: 1, pageSize: 200 }),
      masterDataUseCases.listVehicles({ page: 1, pageSize: 200 }),
      usersUseCases.list()
    ])
      .then((results) => {
        if (!mounted) return;

        const [stoppageRes, sitesRes, workshopsRes, vehiclesRes, usersRes] = results;

        const nextDetail = stoppageRes.status === "fulfilled" ? stoppageRes.value : null;
        const nextSites = sitesRes.status === "fulfilled" ? toList(sitesRes.value) : [];
        const nextWorkshops = workshopsRes.status === "fulfilled" ? toList(workshopsRes.value) : [];
        const nextVehicles = vehiclesRes.status === "fulfilled" ? toList(vehiclesRes.value) : [];
        const nextUsers = usersRes.status === "fulfilled" ? toList(usersRes.value) : [];

        setDetail(nextDetail);
        setSites(nextSites);
        setWorkshops(nextWorkshops);
        setVehicles(nextVehicles);
        setUsers(nextUsers);

        const fallbackSiteId = nextSites[0]?.id ? String(nextSites[0].id) : "";
        const fallbackWorkshopId = nextWorkshops[0]?.id ? String(nextWorkshops[0].id) : "";

        const nextSiteId = String(nextDetail?.siteId ?? fallbackSiteId);
        const nextWorkshopId = String(nextDetail?.workshopId ?? fallbackWorkshopId);

        const siteVehicles = nextVehicles.filter((v) => String(v.siteId ?? "") === nextSiteId);
        const vehiclePool = siteVehicles.length ? siteVehicles : nextVehicles;
        const fallbackVehicleId = vehiclePool[0]?.id ? String(vehiclePool[0].id) : "";
        const requestedVehicleId = String(nextDetail?.vehicleId ?? "");
        const nextVehicleId = vehiclePool.some((v) => String(v.id) === requestedVehicleId) ? requestedVehicleId : fallbackVehicleId;

        setSelectedSiteId(nextSiteId);
        setSelectedWorkshopId(nextWorkshopId);
        setSelectedVehicleId(nextVehicleId);
        setOpenedAtInput(toLocalDateTimeInput(nextDetail?.openedAt ?? initialOpenedAt ?? nowIso()));
        setClosedAtInput(toLocalDateTimeInput(nextDetail?.closedAt ?? initialClosedAt ?? null));

        if (results.some((r) => r.status === "rejected")) {
          setError("Alcuni dati non sono disponibili. Puoi comunque continuare.");
        }
      })
      .catch((e: Error) => mounted && setError(e.message));

    return () => {
      mounted = false;
    };
  }, [open, stoppageId, mode, initialOpenedAt, initialClosedAt]);

  const filteredVehicles = useMemo(() => {
    if (!selectedSiteId) return vehicles;
    const bySite = vehicles.filter((v) => String(v.siteId ?? "") === String(selectedSiteId));
    return bySite.length ? bySite : vehicles;
  }, [selectedSiteId, vehicles]);

  useEffect(() => {
    if (!filteredVehicles.length) {
      setSelectedVehicleId("");
      return;
    }

    if (!filteredVehicles.some((v) => String(v.id) === String(selectedVehicleId))) {
      setSelectedVehicleId(String(filteredVehicles[0].id));
    }
  }, [filteredVehicles, selectedVehicleId]);

  const vehicleLabel = useMemo(() => {
    if (!detail) return "";
    return `${detail.vehicle?.plate ?? ""} · ${detail.vehicle?.brand ?? ""} ${detail.vehicle?.model ?? ""}`.trim();
  }, [detail]);

  if (!open) return null;

  const onQuickWorkshopCreate = async () => {
    setQuickWorkshopError(null);
    setQuickWorkshopSuccess(null);

    const payload = {
      name: quickWorkshopName.trim(),
      contactName: "",
      email: quickWorkshopEmail.trim(),
      phone: quickWorkshopPhone.trim(),
      whatsapp: "",
      address: quickWorkshopAddress.trim(),
      city: quickWorkshopCity.trim(),
      notes: "",
      isActive: true
    };

    if (!payload.name) {
      setQuickWorkshopError("Inserisci almeno il nome officina per crearla.");
      return;
    }

    try {
      const created = (await masterDataUseCases.createWorkshop(payload)) as any;
      const workshopRes = await masterDataUseCases.listWorkshops({ page: 1, pageSize: 200 });
      const workshopList = toList(workshopRes);
      setWorkshops(workshopList);

      if (created?.id) setSelectedWorkshopId(String(created.id));
      else if (workshopList[0]?.id) setSelectedWorkshopId(String(workshopList[0].id));

      setQuickWorkshopSuccess(`Officina ${payload.name} creata e selezionata.`);
      setQuickWorkshopName("");
      setQuickWorkshopEmail("");
      setQuickWorkshopPhone("");
      setQuickWorkshopCity("");
      setQuickWorkshopAddress("");
      setShowQuickWorkshop(false);
    } catch (e) {
      setQuickWorkshopError((e as Error).message);
    }
  };

  const onQuickVehicleCreate = async () => {
    setQuickVehicleError(null);
    setQuickVehicleSuccess(null);

    const payload = {
      siteId: selectedSiteId,
      plate: quickPlate.trim().toUpperCase(),
      brand: quickBrand.trim() || "N/D",
      model: quickModel.trim() || "N/D",
      year: quickYear ? Number(quickYear) : undefined,
      notes: quickNotes.trim()
    };

    if (!payload.siteId || !payload.plate) {
      setQuickVehicleError("Per creare il veicolo servono almeno sede e targa.");
      return;
    }

    try {
      const created = (await masterDataUseCases.createVehicle(payload)) as any;
      const vehicleRes = await masterDataUseCases.listVehicles({ page: 1, pageSize: 200 });
      const vehicleList = toList(vehicleRes);
      setVehicles(vehicleList);
      if (created?.id) setSelectedVehicleId(String(created.id));
      setQuickVehicleSuccess(`Veicolo ${payload.plate} creato e selezionato.`);
      setQuickPlate("");
      setQuickBrand("");
      setQuickModel("");
      setQuickYear("");
      setQuickNotes("");
      setShowQuickVehicle(false);
    } catch (e) {
      const normalizedPlate = payload.plate;
      try {
        const vehicleRes = await masterDataUseCases.listVehicles({ page: 1, pageSize: 200 });
        const vehicleList = toList(vehicleRes);
        setVehicles(vehicleList);
        const existing = vehicleList.find((v) => String(v.plate ?? "").trim().toUpperCase() === normalizedPlate);
        if (existing?.id) {
          setSelectedVehicleId(String(existing.id));
          setQuickVehicleSuccess(`Esiste gia un veicolo con targa ${normalizedPlate}. Lo abbiamo selezionato automaticamente.`);
          setShowQuickVehicle(false);
          return;
        }
      } catch {
        // keep backend message as fallback
      }
      setQuickVehicleError((e as Error).message);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const form = new FormData(event.currentTarget);

    const siteId = String(selectedSiteId || "").trim();
    const vehicleId = String(selectedVehicleId || "").trim();
    const workshopId = String(selectedWorkshopId || "").trim();
    const reason = String(form.get("reason") || "").trim();

    if (!siteId || !vehicleId || !workshopId || !reason) {
      setSaving(false);
      setError("Compila i campi obbligatori (sede, veicolo, officina, motivo).");
      return;
    }

    try {
      const openedAt = fromLocalDateTimeInput(openedAtInput);
      const closedAt = fromLocalDateTimeInput(closedAtInput);
      if (!openedAt) {
        setSaving(false);
        setError("Data/ora inizio non valida.");
        return;
      }
      if (closedAt && new Date(closedAt).getTime() <= new Date(openedAt).getTime()) {
        setSaving(false);
        setError("La data/ora fine deve essere successiva all'inizio.");
        return;
      }

      const payload = {
        siteId,
        vehicleId,
        workshopId,
        reason,
        notes: String(form.get("notes") || ""),
        status: String(form.get("status") || "") || "OPEN",
        priority: String(form.get("priority") || "") || "MEDIUM",
        assignedToUserId: String(form.get("assignedToUserId") || "") || null,
        reminderAfterDays: Number(form.get("reminderAfterDays") || 0) || null,
        openedAt,
        closedAt
      };

      let result: any = null;
      if (mode === "create") result = await stoppagesUseCases.create(payload);
      else if (stoppageId) result = await stoppagesUseCases.update(stoppageId, payload);

      onSaved();
      if (result && onSavedRecord) onSavedRecord(result, { color: selectedColor });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed z-[80] right-0 top-0 h-full w-full max-w-xl border-l bg-card shadow-2xl max-sm:bottom-0 max-sm:top-auto max-sm:max-h-[88vh] max-sm:rounded-t-2xl max-sm:border-t max-sm:border-l-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">{mode === "create" ? "Nuovo fermo" : `Fermo ${detail?.vehicle?.plate || ""}`}</p>
          <Button variant="outline" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2 border-b px-4 py-2">
          {mode !== "create" ? (
            <Button size="sm" variant={tab === "detail" ? "default" : "outline"} onClick={() => setTab("detail")}>Dettaglio</Button>
          ) : null}
          <Button size="sm" variant={tab === "edit" ? "default" : "outline"} onClick={() => setTab("edit")}>
            {mode === "create" ? "Inserimento" : "Modifica"}
          </Button>
        </div>

        <div className="h-[calc(100%-108px)] overflow-auto px-4 py-4">
          {error ? <p className="mb-2 text-sm text-destructive">{error}</p> : null}
          {!detail && mode !== "create" ? (
            <FleetumInlineLoader label="Caricamento fermo" />
          ) : tab === "detail" ? (
            <div className="space-y-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Veicolo</p>
                <p className="font-medium">{vehicleLabel}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Stato</p>
                <StoppageStatusBadge status={detail.status} />
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Sede / Officina</p>
                <p className="text-sm">{detail.site?.name} · {detail.workshop?.name}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Motivo</p>
                <p className="text-sm">{detail.reason}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Note</p>
                <p className="text-sm">{detail.notes || "-"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={async () => {
                    if (!stoppageId) return;
                    await stoppagesUseCases.sendEmailReminder(stoppageId);
                    onSaved();
                  }}
                >
                  Invia reminder email
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    if (!stoppageId) return;
                    const { url } = await stoppagesUseCases.getWhatsappLink(stoppageId);
                    window.open(url, "_blank", "noopener,noreferrer");
                  }}
                >
                  Invia WhatsApp
                </Button>
              </div>
            </div>
          ) : (
            <form key={detail?.id ?? "new"} className="grid gap-3" onSubmit={onSubmit}>
              <div className="grid gap-1.5">
                <Label>Sede</Label>
                <Select value={selectedSiteId} onChange={(e) => setSelectedSiteId(e.target.value)}>
                  <option value="" disabled>Seleziona sede</option>
                  {sites.map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Veicolo</Label>
                <Select value={selectedVehicleId} onChange={(e) => setSelectedVehicleId(e.target.value)}>
                  <option value="" disabled>Seleziona veicolo</option>
                  {filteredVehicles.map((x) => (
                    <option key={x.id} value={x.id}>{x.plate} · {x.brand} {x.model}</option>
                  ))}
                </Select>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowQuickVehicle((prev) => !prev)}>
                  {showQuickVehicle ? "Chiudi inserimento veicolo" : "+ Nuovo veicolo"}
                </Button>
              </div>

              {showQuickVehicle && (
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="mb-3 text-sm font-medium">Creazione rapida veicolo</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="qpQuickPlate">Targa (obbligatoria)</Label>
                      <Input id="qpQuickPlate" placeholder="AB123CD" value={quickPlate} onChange={(e) => setQuickPlate(e.target.value)} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="qpQuickBrand">Marca</Label>
                      <Input id="qpQuickBrand" placeholder="Iveco" value={quickBrand} onChange={(e) => setQuickBrand(e.target.value)} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="qpQuickModel">Modello</Label>
                      <Input id="qpQuickModel" placeholder="Daily" value={quickModel} onChange={(e) => setQuickModel(e.target.value)} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="qpQuickYear">Anno</Label>
                      <Input id="qpQuickYear" type="number" min={1950} max={2100} value={quickYear} onChange={(e) => setQuickYear(e.target.value)} />
                    </div>
                    <div className="grid gap-1.5 md:col-span-2">
                      <Label htmlFor="qpQuickNotes">Note</Label>
                      <Textarea id="qpQuickNotes" rows={2} value={quickNotes} onChange={(e) => setQuickNotes(e.target.value)} />
                    </div>
                    {quickVehicleError ? <p className="text-sm text-destructive md:col-span-2">{quickVehicleError}</p> : null}
                    {quickVehicleSuccess ? <p className="text-sm text-emerald-600 md:col-span-2">{quickVehicleSuccess}</p> : null}
                    <div className="md:col-span-2">
                      <Button type="button" size="sm" onClick={onQuickVehicleCreate}>Crea veicolo</Button>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid gap-1.5">
                <Label>Officina</Label>
                <Select value={selectedWorkshopId} onChange={(e) => setSelectedWorkshopId(e.target.value)}>
                  <option value="" disabled>Seleziona officina</option>
                  {workshops.map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </Select>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowQuickWorkshop((prev) => !prev)}>
                  {showQuickWorkshop ? "Chiudi creazione officina" : "Officina non presente? Creala qui"}
                </Button>
              </div>

              {showQuickWorkshop && (
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="mb-3 text-sm font-medium">Creazione rapida officina</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="qpWorkshopName">Nome officina</Label>
                      <Input id="qpWorkshopName" value={quickWorkshopName} onChange={(e) => setQuickWorkshopName(e.target.value)} placeholder="Officina Rossi" />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="qpWorkshopEmail">Email</Label>
                      <Input id="qpWorkshopEmail" value={quickWorkshopEmail} onChange={(e) => setQuickWorkshopEmail(e.target.value)} placeholder="officina@email.it" />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="qpWorkshopPhone">Telefono</Label>
                      <Input id="qpWorkshopPhone" value={quickWorkshopPhone} onChange={(e) => setQuickWorkshopPhone(e.target.value)} placeholder="+39..." />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="qpWorkshopCity">Citta</Label>
                      <Input id="qpWorkshopCity" value={quickWorkshopCity} onChange={(e) => setQuickWorkshopCity(e.target.value)} placeholder="Milano" />
                    </div>
                    <div className="grid gap-1.5 md:col-span-2">
                      <Label htmlFor="qpWorkshopAddress">Indirizzo</Label>
                      <Input id="qpWorkshopAddress" value={quickWorkshopAddress} onChange={(e) => setQuickWorkshopAddress(e.target.value)} placeholder="Via Roma 1" />
                    </div>
                    {quickWorkshopError ? <p className="text-sm text-destructive md:col-span-2">{quickWorkshopError}</p> : null}
                    {quickWorkshopSuccess ? <p className="text-sm text-emerald-600 md:col-span-2">{quickWorkshopSuccess}</p> : null}
                    <div className="md:col-span-2">
                      <Button type="button" size="sm" onClick={onQuickWorkshopCreate}>Crea officina</Button>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid gap-1.5">
                <Label>Stato</Label>
                <Select name="status" defaultValue={detail?.status ?? "OPEN"}>
                  {stoppageStatusOptions.map((x) => (
                    <option key={x.value} value={x.value}>{x.label}</option>
                  ))}
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Priorità</Label>
                <Select name="priority" defaultValue={detail?.priority ?? "MEDIUM"}>
                  {priorityOptions.map((x) => (
                    <option key={x.value} value={x.value}>{x.label}</option>
                  ))}
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Assegnato a</Label>
                <Select name="assignedToUserId" defaultValue={detail?.assignedToUserId || ""}>
                  <option value="">Non assegnato</option>
                  {users.map((x) => (
                    <option key={x.id} value={x.id}>{x.firstName} {x.lastName}</option>
                  ))}
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Reminder dopo giorni</Label>
                <Input type="number" min={1} name="reminderAfterDays" defaultValue={detail?.reminderAfterDays || ""} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="openedAt">Da (data/ora)</Label>
                <Input id="openedAt" type="datetime-local" step={900} value={openedAtInput} onChange={(e) => setOpenedAtInput(e.target.value)} required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="closedAt">A (data/ora)</Label>
                <Input id="closedAt" type="datetime-local" step={900} value={closedAtInput} onChange={(e) => setClosedAtInput(e.target.value)} />
                <p className="text-xs text-muted-foreground">Durata predefinita: 1 ora (modificabile).</p>
              </div>
              <div className="grid gap-1.5">
                <Label>Colore promemoria</Label>
                <div className="flex flex-wrap gap-2">
                  {eventColorOptions.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`h-7 w-7 rounded-full border-2 ${selectedColor === color ? "border-foreground" : "border-transparent"}`}
                      style={{ backgroundColor: color }}
                      aria-label={`Scegli colore ${color}`}
                      onClick={() => setSelectedColor(color)}
                    />
                  ))}
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Motivo</Label>
                <Input name="reason" defaultValue={detail?.reason || ""} required />
              </div>
              <div className="grid gap-1.5">
                <Label>Note</Label>
                <Textarea name="notes" defaultValue={detail?.notes || ""} />
              </div>
              <Button type="submit" disabled={saving || !selectedVehicleId}>
                {saving ? "Salvataggio..." : mode === "create" ? "Crea fermo" : "Salva modifiche"}
              </Button>
              {!selectedVehicleId ? <p className="text-xs text-muted-foreground">Seleziona o crea un veicolo prima di salvare.</p> : null}
            </form>
          )}
        </div>
      </aside>
    </>
  );
};
