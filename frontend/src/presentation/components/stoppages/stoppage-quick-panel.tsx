import { FormEvent, useEffect, useMemo, useState, useRef } from "react";
import {useNavigate} from "react-router-dom";
import {CommerceDrawer,CommerceNotice} from "../ui/commerce-workspace";
import {DiscardDialog,useOperationsAccess,useOperationsTask,OperationFeedback} from "../operations/operations-workspace";
import type {PanelMotionHandle} from "../ui/panel-motion";
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
  origin?: HTMLElement|null;
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
  onSavedRecord,
  origin=null
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

  const {canRead,canWrite,canRemind,has,identity}=useOperationsAccess();const navigate=useNavigate();const task=useOperationsTask();const motion=useRef<PanelMotionHandle|null>(null);
  const quickLock=useRef(false),saveLock=useRef(false);const[quickBusy,setQuickBusy]=useState(false);
  const [quickStatus,setQuickStatus]=useState("OPEN");
  const [loaded,setLoaded]=useState(false),[loadKey,setLoadKey]=useState(0),[dirty,setDirty]=useState(false),[discard,setDiscard]=useState(false);
  const finishClose=()=>{setDirty(false);if(motion.current)motion.current.dismiss(onClose);else onClose()};
  const requestClose=()=>{if(saving||task.busy||quickLock.current)return;if(dirty)setDiscard(true);else finishClose()};
  useEffect(()=>{if(!dirty||!open)return;const protect=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue=""};window.addEventListener("beforeunload",protect);return()=>window.removeEventListener("beforeunload",protect)},[dirty,open]);
  useEffect(() => setTab(mode === "create" ? "edit" : (mode as "detail" | "edit")), [mode, stoppageId]);
  useEffect(() => {
    setSelectedColor(initialColor ?? eventColorOptions[0]);
  }, [initialColor, open]);
  useEffect(() => {
    if (!openedAtInput) return;
    const opened = new Date(openedAtInput);
    if (Number.isNaN(opened.getTime())) return;
    const closed = closedAtInput ? new Date(closedAtInput) : null;
    if(mode!=="create"&&!closedAtInput)return;
    if (!closed || Number.isNaN(closed.getTime()) || closed.getTime() <= opened.getTime()) {
      const nextClosed = new Date(opened.getTime() + 60 * 60000);
      setClosedAtInput(toLocalDateTimeInput(nextClosed.toISOString()));
    }
  }, [openedAtInput, closedAtInput,mode]);

  useEffect(() => {
    if (!open||!canRead) return;
    setLoaded(false);setDirty(false);setDetail(null);
    let mounted = true;

    setError(null);
    setShowQuickVehicle(false);
    setShowQuickWorkshop(false);
    setDetail(null);

    Promise.allSettled([
      stoppageId ? stoppagesUseCases.getById(stoppageId) : Promise.resolve(null),
      has("sites:read")?masterDataUseCases.listSites({ page: 1, pageSize: 200 }):Promise.resolve({data:[]}),
      has("workshops:read")?masterDataUseCases.listWorkshops({ page: 1, pageSize: 200 }):Promise.resolve({data:[]}),
      has("vehicles:read")?masterDataUseCases.listVehicles({ page: 1, pageSize: 200 }):Promise.resolve({data:[]}),
      has("users:read")?usersUseCases.list():Promise.resolve({data:[]})
    ])
      .then((results) => {
        if (!mounted) return;

        const [stoppageRes, sitesRes, workshopsRes, vehiclesRes, usersRes] = results;

        const nextDetail = stoppageRes.status === "fulfilled" ? stoppageRes.value : null;
        const nextSites = sitesRes.status === "fulfilled" ? toList(sitesRes.value) : [];
        const nextWorkshops = workshopsRes.status === "fulfilled" ? toList(workshopsRes.value) : [];
        const nextVehicles = vehiclesRes.status === "fulfilled" ? toList(vehiclesRes.value) : [];
        const nextUsers = usersRes.status === "fulfilled" ? toList(usersRes.value) : [];

        setLoaded(true);
        if(stoppageId&&!nextDetail){setError("Fermo non disponibile. Riprova il caricamento.");return}
        setDetail(nextDetail);setQuickStatus(String(nextDetail?.status??"OPEN"));
        const withCurrent=(items:any[],item:any)=>item&&!items.some(x=>x.id===item.id)?[item,...items]:items;
        setSites(withCurrent(nextSites,nextDetail?.site));
        setWorkshops(withCurrent(nextWorkshops,nextDetail?.workshop));
        setVehicles(withCurrent(nextVehicles,nextDetail?.vehicle));
        setUsers(withCurrent(nextUsers,nextDetail?.assignedToUser));

        const fallbackSiteId = nextSites[0]?.id ? String(nextSites[0].id) : "";
        const fallbackWorkshopId = nextWorkshops[0]?.id ? String(nextWorkshops[0].id) : "";

        const nextSiteId = String(nextDetail?.siteId ?? fallbackSiteId);
        const nextWorkshopId = String(nextDetail?.workshopId ?? fallbackWorkshopId);

        const siteVehicles = nextVehicles.filter((v) => String(v.siteId ?? "") === nextSiteId);
        const vehiclePool = siteVehicles.length ? siteVehicles : nextVehicles;
        const fallbackVehicleId = vehiclePool[0]?.id ? String(vehiclePool[0].id) : "";
        const requestedVehicleId = String(nextDetail?.vehicleId ?? "");
        const nextVehicleId = requestedVehicleId || fallbackVehicleId;

        setSelectedSiteId(nextSiteId);
        setSelectedWorkshopId(nextWorkshopId);
        setSelectedVehicleId(nextVehicleId);
        setOpenedAtInput(toLocalDateTimeInput(nextDetail?.openedAt ?? initialOpenedAt ?? nowIso()));
        setClosedAtInput(toLocalDateTimeInput(nextDetail?.closedAt ?? initialClosedAt ?? null));

        if (results.some((r) => r.status === "rejected")) {
          setError("Alcuni dati non sono disponibili. Puoi comunque continuare.");
        }
      })
      .catch((e: Error) => {if(mounted){setLoaded(true);setError(e.message)}});

    return () => {
      mounted = false;
    };
  }, [open, stoppageId, mode, initialOpenedAt, initialClosedAt,canRead,loadKey,identity]);

  const filteredVehicles = useMemo(() => {
    if (!selectedSiteId) return vehicles;
    const bySite = vehicles.filter((v) => String(v.siteId ?? "") === String(selectedSiteId));
    return bySite.length ? bySite : vehicles;
  }, [selectedSiteId, vehicles]);

  useEffect(() => {
    if(!loaded||mode!=="create")return;
    if (!filteredVehicles.length) {
      setSelectedVehicleId("");
      return;
    }

    if (!filteredVehicles.some((v) => String(v.id) === String(selectedVehicleId))) {
      setSelectedVehicleId(String(filteredVehicles[0].id));
    }
  }, [filteredVehicles, selectedVehicleId,loaded,mode]);

  const vehicleLabel = useMemo(() => {
    if (!detail) return "";
    return `${detail.vehicle?.plate ?? ""} · ${detail.vehicle?.brand ?? ""} ${detail.vehicle?.model ?? ""}`.trim();
  }, [detail]);

  if (!open) return null;
  if(!canRead)return <CommerceDrawer compact title="Accesso ai fermi" onClose={onClose}><p>Il tuo ruolo non consente l’accesso ai fermi.</p></CommerceDrawer>;

  const onQuickWorkshopCreate = async () => {
    if(!has("workshops:write")||saving||task.busy||quickLock.current)return;
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

    quickLock.current=true;setQuickBusy(true);
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
    }finally{quickLock.current=false;setQuickBusy(false)}
  };

  const onQuickVehicleCreate = async () => {
    if(!has("vehicles:write")||saving||task.busy||quickLock.current)return;
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

    quickLock.current=true;setQuickBusy(true);
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
    }finally{quickLock.current=false;setQuickBusy(false)}
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if(!canWrite||saveLock.current||quickLock.current||task.busy||!loaded)return;
    saveLock.current=true;
    setSaving(true);
    setError(null);

    const form = new FormData(event.currentTarget);

    const siteId = String(selectedSiteId || "").trim();
    const vehicleId = String(selectedVehicleId || "").trim();
    const workshopId = String(selectedWorkshopId || "").trim();
    const reason = String(form.get("reason") || "").trim();

    if (!siteId || !vehicleId || !workshopId || !reason) {
      saveLock.current=false;setSaving(false);
      setError("Compila i campi obbligatori (sede, veicolo, officina, motivo).");
      return;
    }

    try {
      const openedAt = fromLocalDateTimeInput(openedAtInput);
      const closedAt = fromLocalDateTimeInput(closedAtInput);
      if (!openedAt) {
        saveLock.current=false;setSaving(false);
        setError("Data/ora inizio non valida.");
        return;
      }
      if (closedAt && new Date(closedAt).getTime() <= new Date(openedAt).getTime()) {
        saveLock.current=false;setSaving(false);
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

      setDirty(false);onSaved();
      if (result && onSavedRecord) onSavedRecord(result, { color: selectedColor });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saveLock.current=false;setSaving(false);
    }
  };

  return (
    <>
      <CommerceDrawer title={mode==="create"?"Nuovo fermo":`Fermo ${detail?.vehicle?.plate||""}`} description="Dati e operazioni del fermo, senza perdere il contesto." origin={origin} motionRef={motion} onClose={requestClose} busy={saving||task.busy||quickBusy} footer={<><Button variant="outline" onClick={requestClose} disabled={saving||task.busy||quickBusy}>Chiudi</Button>{stoppageId&&tab==='detail'?<Button variant="outline" onClick={()=>navigate('/fermi/'+encodeURIComponent(stoppageId))}>Scheda completa</Button>:null}{tab==='edit'&&canWrite?<Button type="submit" form="stoppage-quick-form" disabled={saving||task.busy||quickBusy||!loaded||!selectedVehicleId||(!detail&&mode!=='create')}>{saving?'Salvataggio...':mode==='create'?'Crea fermo':'Salva modifiche'}</Button>:null}</>}>
        <OperationFeedback error={task.error} success={task.success}/>
        <nav className="commerce-section-nav" aria-label="Sezioni fermo">
          {mode !== "create" ? (
            <Button size="sm" variant={tab === "detail" ? "default" : "outline"} onClick={() => setTab("detail")}>Dettaglio</Button>
          ) : null}
          <Button disabled={!canWrite||saving||task.busy||quickBusy} size="sm" variant={tab === "edit" ? "default" : "outline"} onClick={() => setTab("edit")}>
            {mode === "create" ? "Inserimento" : "Modifica"}
          </Button>
        </nav>

        <div className="operations-quick-content">
          {error ? <CommerceNotice>{error}</CommerceNotice> : null}
          {!loaded ? (
            <FleetumInlineLoader label="Caricamento fermo" />
          ) : !detail&&mode!=="create" ? <Button variant="outline" onClick={()=>setLoadKey(x=>x+1)}>Riprova fermo</Button> : (<> {tab === "detail" ? (
            <div className="space-y-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Veicolo</p>
                <p className="font-medium">{vehicleLabel}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Stato</p>
                <StoppageStatusBadge status={detail.status} />{canWrite?<div className="operations-quick-status"><Label htmlFor="stoppage-quick-status">Nuovo stato</Label><Select id="stoppage-quick-status" value={quickStatus} onChange={e=>setQuickStatus(e.target.value)} disabled={task.busy}>{stoppageStatusOptions.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</Select><Button variant="outline" disabled={task.busy||quickStatus===detail.status} onClick={()=>void task.run(async()=>{await stoppagesUseCases.updateStatus(stoppageId!,quickStatus as any);onSaved();setLoadKey(k=>k+1)},"Stato del fermo aggiornato.")}>Aggiorna stato</Button></div>:null}
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Sede / Officina</p>
                <p className="text-sm" translate="no">{detail.site?.name} · {detail.workshop?.name}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Motivo</p>
                <p className="text-sm" translate="no">{detail.reason}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Note</p>
                <p className="text-sm">{detail.notes || "-"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={!canRemind||task.busy}
                  size="sm"
                  onClick={async () => {
                    if (!stoppageId||!canRemind) return;
                    await task.run(async()=>{await stoppagesUseCases.sendEmailReminder(stoppageId);onSaved()},"Reminder accodato.");
                  }}
                >
                  Invia reminder email
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canRemind||task.busy}
                  onClick={async () => {
                    if (!stoppageId||!canRemind) return;
                    await task.run(async()=>{const {url}=await stoppagesUseCases.getWhatsappLink(stoppageId);if(!window.open(url,"_blank","noopener,noreferrer"))throw Error("Popup WhatsApp bloccato dal browser. Consenti i popup e riprova.")});
                  }}
                >
                  Invia WhatsApp
                </Button>
              </div>
            </div>
          ) : null}
            <form hidden={tab!=="edit"} id="stoppage-quick-form" key={detail?.id ?? "new"} className="operations-form" onChangeCapture={()=>setDirty(true)} onSubmit={onSubmit}><fieldset className="operations-form-fields" disabled={!canWrite||saving||task.busy||quickBusy}>
              <div className="grid gap-1.5">
                <Label htmlFor="stoppage-quick-field-1">Sede</Label>
                <Select id="stoppage-quick-field-1" value={selectedSiteId} onChange={(e) => setSelectedSiteId(e.target.value)}>
                  <option value="" disabled>Seleziona sede</option>
                  {sites.map((x) => (
                    <option translate="no" key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="stoppage-quick-field-2">Veicolo</Label>
                <Select id="stoppage-quick-field-2" value={selectedVehicleId} onChange={(e) => setSelectedVehicleId(e.target.value)}>
                  <option value="" disabled>Seleziona veicolo</option>
                  {filteredVehicles.map((x) => (
                    <option translate="no" key={x.id} value={x.id}>{x.plate} · {x.brand} {x.model}</option>
                  ))}
                </Select>
                <Button disabled={!has("vehicles:write")} type="button" variant="outline" size="sm" onClick={() => setShowQuickVehicle((prev) => !prev)}>
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
                <Label htmlFor="stoppage-quick-field-3">Officina</Label>
                <Select id="stoppage-quick-field-3" value={selectedWorkshopId} onChange={(e) => setSelectedWorkshopId(e.target.value)}>
                  <option value="" disabled>Seleziona officina</option>
                  {workshops.map((x) => (
                    <option translate="no" key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </Select>
                <Button disabled={!has("workshops:write")} type="button" variant="outline" size="sm" onClick={() => setShowQuickWorkshop((prev) => !prev)}>
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
                <Label htmlFor="stoppage-quick-field-4">Stato</Label>
                <Select id="stoppage-quick-field-4" name="status" defaultValue={detail?.status ?? "OPEN"}>
                  {stoppageStatusOptions.map((x) => (
                    <option key={x.value} value={x.value}>{x.label}</option>
                  ))}
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="stoppage-quick-field-5">Priorità</Label>
                <Select id="stoppage-quick-field-5" name="priority" defaultValue={detail?.priority ?? "MEDIUM"}>
                  {priorityOptions.map((x) => (
                    <option key={x.value} value={x.value}>{x.label}</option>
                  ))}
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="stoppage-quick-field-6">Assegnato a</Label>
                <Select id="stoppage-quick-field-6" name="assignedToUserId" defaultValue={detail?.assignedToUserId || ""}>
                  <option value="">Non assegnato</option>
                  {users.map((x) => (
                    <option translate="no" key={x.id} value={x.id}>{x.firstName} {x.lastName}</option>
                  ))}
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="stoppage-quick-field-7">Reminder dopo giorni</Label>
                <Input id="stoppage-quick-field-7" type="number" min={1} name="reminderAfterDays" defaultValue={detail?.reminderAfterDays || ""} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="openedAt">Da (data/ora)</Label>
                <Input id="openedAt" type="datetime-local" step={900} value={openedAtInput} onChange={(e) => setOpenedAtInput(e.target.value)} required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="closedAt">A (data/ora)</Label>
                <Input id="closedAt" type="datetime-local" step={900} value={closedAtInput} onChange={(e) => setClosedAtInput(e.target.value)} />
                <p className="text-xs text-muted-foreground">{closedAtInput?"Puoi modificare la data e l’ora di fine.":"La fine resta aperta finché non viene indicata."}</p>
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
                <Label htmlFor="stoppage-quick-field-8">Motivo</Label>
                <Input id="stoppage-quick-field-8" name="reason" defaultValue={detail?.reason || ""} required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="stoppage-quick-field-9">Note</Label>
                <Textarea id="stoppage-quick-field-9" name="notes" defaultValue={detail?.notes || ""} />
              </div>
              {!selectedVehicleId ? <p className="text-xs text-muted-foreground">Seleziona o crea un veicolo prima di salvare.</p> : null}
            </fieldset></form>
          </>)}
        </div>
      </CommerceDrawer>
      {discard?<DiscardDialog onContinue={()=>setDiscard(false)} onDiscard={()=>{setDiscard(false);finishClose()}}/>:null}
    </>
  );
};
