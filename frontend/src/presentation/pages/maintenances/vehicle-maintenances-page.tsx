import { scopedFetch } from "../../../infrastructure/api/scoped-fetch";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, ExternalLink, FileImage, FileText, Trash2, X } from "lucide-react";
import { masterDataUseCases } from "../../../application/usecases/master-data-usecases";
import { FleetumBlockLoader, FleetumInlineLoader } from "../../components/brand/fleetum-logo-loader";
import { PageHeader } from "../../components/layout/page-header";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { Textarea } from "../../components/ui/textarea";
import { useEntitlements } from "../../hooks/use-entitlements";
import { getApiBaseUrl } from "../../../infrastructure/api/api-base-url";

import {DiscardDialog,useOperationsTask,useOperationsAccess} from "../../components/operations/operations-workspace";

import {WorkspacePageHeader} from "../../components/ui/workspace-ui";
import {CommerceDrawer,CommerceNotice} from "../../components/ui/commerce-workspace";
import type {PanelMotionHandle} from "../../components/ui/panel-motion";

type Vehicle = {
  id: string;
  plate: string;
  brand: string;
  model: string;
  site?: { name?: string };
};

type VehicleMaintenanceAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  invoiceTotalAmount?: number | null;
};

type VehicleMaintenance = {
  id: string;
  vehicleId: string;
  performedAt: string;
  maintenanceType: string;
  description?: string | null;
  workshopName?: string | null;
  kmAtService?: number | null;
  cost?: number | null;
  vehicle?: Vehicle;
  attachments?: VehicleMaintenanceAttachment[];
};

const PAGE_SIZE = 20;
const API_BASE_URL = getApiBaseUrl();
const euroFormatter = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });

const pad = (value: number) => String(value).padStart(2, "0");
const toDateInputValue = (value?: string | Date | null) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const formatDate = (value?: string | Date | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("it-IT");
};

const formatFileSize = (sizeBytes: number) => {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "-";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const kb = sizeBytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
};

const vehiclePlate = (vehicle?: Vehicle) => vehicle?.plate || "-";

const attachmentUrl = (id: string) => `${API_BASE_URL}/uploads/vehicle-maintenance-attachments/${id}/file`;

const isImageAttachment = (mimeType: string) => mimeType.startsWith("image/");
const isPdfMime = (mimeType: string) => mimeType === "application/pdf";
const isInvoiceAnalyzableMime = (mimeType: string) => isPdfMime(mimeType) || isImageAttachment(mimeType);

const getInvoiceSummary = (attachments?: VehicleMaintenanceAttachment[]) => {
  const invoiceAnalyzableAttachments = (attachments ?? []).filter((attachment) => isInvoiceAnalyzableMime(attachment.mimeType));
  const invoiceTotals = invoiceAnalyzableAttachments
    .map((attachment) => attachment.invoiceTotalAmount)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  return {
    analyzableCount: invoiceAnalyzableAttachments.length,
    count: invoiceTotals.length,
    missing: Math.max(0, invoiceAnalyzableAttachments.length - invoiceTotals.length),
    total: invoiceTotals.reduce((acc, value) => acc + value, 0)
  };
};

const getDescriptionPreview = (maintenanceType?: string | null, description?: string | null) => {
  const typeValue = String(maintenanceType ?? "").trim();
  const descriptionValue = String(description ?? "").trim();
  if (!descriptionValue) return "";
  if (!typeValue) return descriptionValue;

  const typeLower = typeValue.toLowerCase();
  const descriptionLower = descriptionValue.toLowerCase();
  if (descriptionLower === typeLower) return "";

  const prefixes = [`${typeLower} `, `${typeLower}:`, `${typeLower}-`, `${typeLower} ·`];
  const hasDuplicatedPrefix = prefixes.some((prefix) => descriptionLower.startsWith(prefix));
  if (!hasDuplicatedPrefix) return descriptionValue;

  const sliced = descriptionValue.slice(typeValue.length).replace(/^[:\-\s·]+/, "").trim();
  return sliced || "";
};

export const VehicleMaintenancesPage = () => {
  const {canRead,canWrite,identity}=useOperationsAccess("vehicles");
  const requestSequence=useRef(0);
  useEffect(()=>{requestSequence.current++;return()=>{requestSequence.current++}},[identity,canRead]);
  const { can } = useEntitlements();
  const canExportCsv = can("export_csv");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [rows, setRows] = useState<VehicleMaintenance[]>([]);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [submitting, setSubmitting] = useState(false);
  const [editingItem, setEditingItem] = useState<VehicleMaintenance | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [vehicleQuery, setVehicleQuery] = useState("");
  const [vehicleSuggestionsOpen, setVehicleSuggestionsOpen] = useState(false);
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [expandedAttachmentRows, setExpandedAttachmentRows] = useState<Record<string, boolean>>({});
  const [previewAttachment, setPreviewAttachment] = useState<VehicleMaintenanceAttachment | null>(null);
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportVehicleId, setExportVehicleId] = useState("");
  const [exportDateFrom, setExportDateFrom] = useState(toDateInputValue(new Date(Date.now() - 90 * 86400000)));
  const [exportDateTo, setExportDateTo] = useState(toDateInputValue(new Date()));
  const [exportLoading, setExportLoading] = useState<"csv" | "xlsx" | null>(null);

  const [dirty,setDirty]=useState(false),[discard,setDiscard]=useState(false);
  const [confirm,setConfirm]=useState<{title:string;name:string;run:()=>Promise<void>}|null>(null);
  const task=useOperationsTask();
  const submitLock=useRef(false),savedId=useRef<string|null>(null),previewSequence=useRef(0);
  const previewRequest=useRef<AbortController|null>(null),previewUrl=useRef<string|null>(null);
  const origin=useRef<HTMLElement|null>(null),motion=useRef<PanelMotionHandle|null>(null);
  const closePanel=()=>{if(submitLock.current)return;if(dirty){setDiscard(true);return}motion.current?motion.current.dismiss(()=>setPanelOpen(false)):setPanelOpen(false)};
  useEffect(()=>{if(!panelOpen||!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue=""};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn)},[panelOpen,dirty]);
  useEffect(()=>()=>{previewSequence.current++;previewRequest.current?.abort();if(previewUrl.current)URL.revokeObjectURL(previewUrl.current)},[]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);
  const rowsWithoutAttachments = useMemo(
    () => rows.filter((item) => (item.attachments?.length ?? 0) === 0),
    [rows]
  );
  const rowsWithoutAttachmentsPreview = useMemo(
    () => rowsWithoutAttachments.slice(0, 3).map((item) => vehiclePlate(item.vehicle)).join(", "),
    [rowsWithoutAttachments]
  );
  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null,
    [selectedVehicleId, vehicles]
  );

  const vehicleSuggestions = useMemo(() => {
    const term = vehicleQuery.trim().toLowerCase();
    const source = term
      ? vehicles.filter((vehicle) => {
          const payload = `${vehicle.plate} ${vehicle.brand} ${vehicle.model} ${vehicle.site?.name ?? ""}`.toLowerCase();
          return payload.includes(term);
        })
      : vehicles;
    return source.slice(0, 8);
  }, [vehicleQuery, vehicles]);

  const loadVehicles = async () => {
    if(!canRead)return;
    const result = await masterDataUseCases.listVehicles({ page: 1, pageSize: 200 });
    setVehicles(result.data);
  };

  const loadMaintenances = async (targetPage: number, targetSearch: string, targetVehicleId: string) => {
    const sequence=++requestSequence.current;
    if(!canRead)return;
    setLoading(true);
    setError(null);
    try {
      const initialResult = await masterDataUseCases.listVehicleMaintenances({
        page: targetPage,
        pageSize: PAGE_SIZE,
        search: targetSearch || undefined,
        vehicleId: targetVehicleId || undefined
      });
      if(sequence!==requestSequence.current)return;
      const initialTotal = typeof initialResult.total === "number" ? initialResult.total : initialResult.data.length;
      const nextTotalPages = Math.max(1, Math.ceil(initialTotal / PAGE_SIZE));
      const effectivePage = Math.min(Math.max(1, targetPage), nextTotalPages);

      if (effectivePage !== targetPage) {
        const correctedResult = await masterDataUseCases.listVehicleMaintenances({
          page: effectivePage,
          pageSize: PAGE_SIZE,
          search: targetSearch || undefined,
          vehicleId: targetVehicleId || undefined
        });
        if(sequence!==requestSequence.current)return;
        const correctedTotal =
          typeof correctedResult.total === "number" ? correctedResult.total : correctedResult.data.length;
        setRows(correctedResult.data as VehicleMaintenance[]);
        setTotal(correctedTotal);
        if (page !== effectivePage) setPage(effectivePage);
        return;
      }

      setRows(initialResult.data as VehicleMaintenance[]);
      setTotal(initialTotal);
    } catch (e) {
      if(sequence===requestSequence.current)setError((e as Error).message);
    } finally {
      if(sequence===requestSequence.current)setLoading(false);
    }
  };

  const reload = async () => {
    await loadMaintenances(page, searchQuery, vehicleFilter);
  };

  useEffect(() => {
    loadVehicles().catch((e: Error) => setError(e.message));
  }, [canRead,identity]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearchQuery(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    void loadMaintenances(page, searchQuery, vehicleFilter);
  }, [page, searchQuery, vehicleFilter,canRead,identity]);

  useEffect(() => {
    return () => {
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    };
  }, [previewObjectUrl]);

  const openCreatePanel = (element?:HTMLElement) => {
    if(!canWrite)return;origin.current=element||null;savedId.current=null;setDirty(false);setError(null);
    setMode("create");
    setEditingItem(null);
    setWarning(null);
    setSelectedVehicleId("");
    setVehicleQuery("");
    setAttachmentFiles([]);
    setVehicleSuggestionsOpen(false);
    setPanelOpen(true);
  };

  const openEditPanel = (item: VehicleMaintenance,element?:HTMLElement) => {
    if(!canWrite)return;origin.current=element||null;savedId.current=null;setDirty(false);setError(null);
    setMode("edit");
    setEditingItem(item);
    setWarning(null);
    setSelectedVehicleId(item.vehicleId);
    setVehicleQuery(item.vehicle?.plate ?? "");
    setAttachmentFiles([]);
    setVehicleSuggestionsOpen(false);
    setPanelOpen(true);
  };

  const onAttachmentFilesChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files ?? []);
    setAttachmentFiles(nextFiles);
  };

  const selectVehicle = (vehicle: Vehicle) => {
    setSelectedVehicleId(vehicle.id);
    setVehicleQuery(vehicle.plate);
    setVehicleSuggestionsOpen(false);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWrite||submitLock.current) return;
    setError(null);
    setSuccess(null);
    setWarning(null);

    const form = new FormData(event.currentTarget);
    const performedAt = String(form.get("performedAt") || "").trim();
    const maintenanceType = String(form.get("maintenanceType") || "").trim();
    const kmAtServiceRaw = String(form.get("kmAtService") || "").trim();
    const costRaw = String(form.get("cost") || "").trim();
    const workshopName = String(form.get("workshopName") || "").trim();
    const description = String(form.get("description") || "").trim();

    if (!selectedVehicleId || !performedAt || !maintenanceType) {
      setError("Compila targa, data intervento e tipo manutenzione.");
      return;
    }

    const parsedKm = kmAtServiceRaw ? Number(kmAtServiceRaw) : null;
    const parsedCost = costRaw ? Number(costRaw) : null;
    const normalizedWorkshop = workshopName;
    const normalizedDescription = description;

    submitLock.current=true;setSubmitting(true);
    try {
      let maintenanceId = editingItem?.id ?? "";
      if (mode === "create") {
        const createPayload: Record<string, unknown> = {
          vehicleId: selectedVehicleId,
          performedAt,
          maintenanceType
        };
        if (parsedKm != null) createPayload.kmAtService = parsedKm;
        if (parsedCost != null) createPayload.cost = parsedCost;
        if (normalizedWorkshop) createPayload.workshopName = normalizedWorkshop;
        if (normalizedDescription) createPayload.description = normalizedDescription;

        const created = (await masterDataUseCases.createVehicleMaintenance(createPayload)) as { id?: string };
        maintenanceId = String(created?.id ?? "");
        if(maintenanceId){savedId.current=maintenanceId;setMode("edit");setEditingItem({...createPayload,...created,id:maintenanceId,vehicle:vehicles.find(v=>v.id===selectedVehicleId)} as VehicleMaintenance)}
      } else if (editingItem) {
        const updatePayload: Record<string, unknown> = {};

        if (editingItem.vehicleId !== selectedVehicleId) updatePayload.vehicleId = selectedVehicleId;
        if (toDateInputValue(editingItem.performedAt) !== performedAt) updatePayload.performedAt = performedAt;
        if ((editingItem.maintenanceType ?? "").trim() !== maintenanceType) updatePayload.maintenanceType = maintenanceType;
        if ((editingItem.kmAtService ?? null) !== parsedKm) updatePayload.kmAtService = parsedKm;
        if ((editingItem.cost ?? null) !== parsedCost) updatePayload.cost = parsedCost;
        if ((editingItem.workshopName ?? "") !== normalizedWorkshop) updatePayload.workshopName = normalizedWorkshop;
        if ((editingItem.description ?? "") !== normalizedDescription) updatePayload.description = normalizedDescription;

        if (Object.keys(updatePayload).length > 0) {
          await masterDataUseCases.updateVehicleMaintenance(editingItem.id, updatePayload);
        }
        maintenanceId = editingItem.id;
      }

      if (!maintenanceId) {
        throw new Error("Manutenzione non trovata. Ricarica la pagina e riprova.");
      }

      let uploaded = 0;
      let invoiceAnalysisQueued = 0;
      if (attachmentFiles.length > 0) {
        const uploadResult = await masterDataUseCases.uploadVehicleMaintenanceAttachments(maintenanceId, attachmentFiles);
        setAttachmentFiles([]);
        uploaded = Number(uploadResult.uploaded ?? 0);
        invoiceAnalysisQueued = Number(uploadResult.invoiceAnalysisQueued ?? 0);
        const invoiceTotalsMissing = Number(uploadResult.invoiceTotalsMissing ?? 0);
        const invoiceTotalAmount = Number(uploadResult.invoiceTotalAmount ?? 0);
        const costUpdatedTo = uploadResult.costUpdatedTo;
        const parsedInvoiceTotal = Number.isFinite(invoiceTotalAmount) && invoiceTotalAmount > 0 ? invoiceTotalAmount : null;

        if (parsedInvoiceTotal != null) {
          await masterDataUseCases.updateVehicleMaintenance(maintenanceId, { cost: parsedInvoiceTotal });
          setRows((current) =>
            current.map((row) =>
              row.id === maintenanceId
                ? {
                    ...row,
                    cost: parsedInvoiceTotal
                  }
                : row
            )
          );
        }

        if (invoiceTotalsMissing > 0) {
          if (typeof costUpdatedTo === "number") {
            setWarning(
              `Attenzione: non sono riuscito a leggere il totale in ${invoiceTotalsMissing} fatture allegate. Il costo è stato aggiornato con gli importi letti automaticamente.`
            );
          } else {
            setWarning(
              `Attenzione: non sono riuscito a leggere il totale in ${invoiceTotalsMissing} fatture allegate. Usa "Modifica" e imposta il costo manuale in "Costo (EUR)".`
            );
          }
        }
      }

      setDirty(false);savedId.current=null;setPanelOpen(false);
      setEditingItem(null);
      setAttachmentFiles([]);
      setSelectedVehicleId("");
      setVehicleQuery("");
      await reload();
      if (invoiceAnalysisQueued > 0) {
        window.setTimeout(() => {
          void reload();
        }, 3500);
        window.setTimeout(() => {
          void reload();
        }, 9000);
      }
      setSuccess(
        mode === "create"
          ? `Manutenzione registrata${uploaded ? ` con ${uploaded} allegato/i` : ""}${invoiceAnalysisQueued > 0 ? " · analisi fatture in background" : ""}.`
          : `Manutenzione aggiornata${uploaded ? ` con ${uploaded} nuovo/i allegato/i` : ""}${invoiceAnalysisQueued > 0 ? " · analisi fatture in background" : ""}.`
      );
    } catch (e) {
      setError((savedId.current?"L’intervento è già registrato. Riprova per completare gli allegati senza creare un duplicato. ":"")+(e as Error).message);
    } finally {
      submitLock.current=false;setSubmitting(false);
    }
  };

  const deleteRecord = async (id: string) => {
    if(!canWrite)return;
    setError(null);
    setSuccess(null);
    setWarning(null);
    try {
      await masterDataUseCases.deleteVehicleMaintenance(id);
      setSuccess("Manutenzione eliminata.");
      await reload();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  };

  const onDelete=(id:string)=>{if(canWrite)setConfirm({title:"Elimina manutenzione",name:"l’intervento selezionato e i suoi allegati",run:()=>deleteRecord(id)})};

  const isPdfAttachment = (attachment: VehicleMaintenanceAttachment) =>
    attachment.mimeType === "application/pdf" || attachment.fileName.toLowerCase().endsWith(".pdf");

  const canPreviewAttachment = (attachment: VehicleMaintenanceAttachment) =>
    isImageAttachment(attachment.mimeType) || isPdfAttachment(attachment);

  const toggleAttachmentRow = (maintenanceId: string) => {
    setExpandedAttachmentRows((current) => ({ ...current, [maintenanceId]: !current[maintenanceId] }));
  };

  const closePreview = () => {
    previewSequence.current++;previewRequest.current?.abort();previewUrl.current=null;
    setPreviewAttachment(null);
    setPreviewLoading(false);
    setPreviewError(null);
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      setPreviewObjectUrl(null);
    }
  };

  const openPreview = async (attachment: VehicleMaintenanceAttachment) => {
    if (!canRead||!canPreviewAttachment(attachment)) return;
    const current=++previewSequence.current;previewRequest.current?.abort();const controller=new AbortController();previewRequest.current=controller;

    setPreviewAttachment(attachment);
    setPreviewLoading(true);
    setPreviewError(null);

    try {
      if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
        setPreviewObjectUrl(null);
      }

      const response = await scopedFetch(attachmentUrl(attachment.id), {
        method: "GET",
        credentials: "include",signal:controller.signal
      });
      if (!response.ok) {
        throw new Error(`PREVIEW_FETCH_FAILED_${response.status}`);
      }
      const blob = await response.blob();
      if(current!==previewSequence.current)return;
      const objectUrl = URL.createObjectURL(blob);previewUrl.current=objectUrl;
      setPreviewObjectUrl(objectUrl);
    } catch {
      if(current!==previewSequence.current)return;
      setPreviewError("Impossibile caricare l'anteprima del file.");
    } finally {
      if(current===previewSequence.current)setPreviewLoading(false);
    }
  };

  const deleteAttachment = async (maintenanceId: string, attachment: VehicleMaintenanceAttachment) => {
    if(!canWrite)return;
    if (deletingAttachmentId) return;
    setError(null);
    setWarning(null);
    setDeletingAttachmentId(attachment.id);
    try {
      await masterDataUseCases.deleteVehicleMaintenanceAttachment(attachment.id);
      setRows((current) =>
        current.map((row) =>
          row.id !== maintenanceId
            ? row
            : {
                ...row,
                attachments: (row.attachments ?? []).filter((entry) => entry.id !== attachment.id)
              }
        )
      );
      if (previewAttachment?.id === attachment.id) {
        closePreview();
      }
      setSuccess(`Allegato "${attachment.fileName}" eliminato.`);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setDeletingAttachmentId(null);
    }
  };

  const onDeleteAttachment=(id:string,attachment:VehicleMaintenanceAttachment)=>{if(canWrite)setConfirm({title:"Elimina allegato",name:attachment.fileName,run:()=>deleteAttachment(id,attachment)})};

  const buildExportParams = () => {
    const dateFromValue = new Date(`${exportDateFrom}T00:00:00`);
    const dateToValue = new Date(`${exportDateTo}T23:59:59`);
    if (Number.isNaN(dateFromValue.getTime()) || Number.isNaN(dateToValue.getTime())) {
      throw new Error("Periodo non valido. Imposta correttamente Data da e Data a.");
    }
    if (dateFromValue.getTime() > dateToValue.getTime()) {
      throw new Error("Periodo non valido: la Data da è successiva alla Data a.");
    }
    const vehiclePlateLabel = vehicles.find((vehicle) => vehicle.id === exportVehicleId)?.plate ?? "tutte";
    return {
      query: {
        dateFrom: dateFromValue.toISOString(),
        dateTo: dateToValue.toISOString(),
        vehicleId: exportVehicleId || undefined
      },
      vehiclePlateLabel
    };
  };

  const runMaintenanceExport = async (format: "csv" | "xlsx") => {
    if(!canRead||!canExportCsv||exportLoading)return;
    setError(null);
    setSuccess(null);
    try {
      const { query, vehiclePlateLabel } = buildExportParams();
      setExportLoading(format);
      const blob =
        format === "xlsx"
          ? await masterDataUseCases.downloadVehicleMaintenancesXlsx(query)
          : await masterDataUseCases.downloadVehicleMaintenancesCsv(query);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const fromTag = exportDateFrom.replaceAll("-", "");
      const toTag = exportDateTo.replaceAll("-", "");
      const ext = format === "xlsx" ? "xlsx" : "csv";
      link.download = `manutenzioni-${vehiclePlateLabel}-${fromTag}-${toTag}.${ext}`;
      link.click();
      URL.revokeObjectURL(url);
      setSuccess(`Export ${format.toUpperCase()} manutenzioni generato con successo.`);
      setExportDialogOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExportLoading(null);
    }
  };

  if(!canRead)return <section className="operations-workspace"><h1>Manutenzioni veicoli</h1><p>Il tuo ruolo non consente l’accesso ai veicoli.</p></section>;
  return (
    <section className="operations-workspace operations-maintenance">
      <WorkspacePageHeader eyebrow="CURA DELLA FLOTTA"
        title="Manutenzioni veicoli"
        description="Registro interventi effettuati su ogni mezzo con storico consultabile e filtro rapido."
        actions={
          <>
            {canExportCsv ? (
              <Button variant="outline" onClick={() => setExportDialogOpen(true)}>
                Export Manutenzioni
              </Button>
            ) : null}
            {canWrite?<Button onClick={e=>openCreatePanel(e.currentTarget)}>Nuova manutenzione</Button>:null}
          </>
        }
      />

      {error&&!panelOpen ? <CommerceNotice>{error}</CommerceNotice> : null}
      {success ? <CommerceNotice tone="success">{success}</CommerceNotice> : null}
      {warning ? <p className="text-sm text-amber-700">{warning}</p> : null}

      <Card className="commerce-panel">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Registro manutenzioni</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-[1fr_minmax(220px,320px)]">
            <Input
              aria-label="Cerca manutenzioni"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Cerca per targa, tipo manutenzione o officina..."
            />
            <Select aria-label="Filtra manutenzioni per veicolo" value={vehicleFilter} onChange={(e) => { setPage(1); setVehicleFilter(e.target.value); }}>
              <option value="">Tutti i veicoli</option>
              {vehicles.map((vehicle) => (
                <option translate="no" key={vehicle.id} value={vehicle.id}>
                  {vehicle.plate} · {vehicle.brand} {vehicle.model}
                </option>
              ))}
            </Select>
          </div>

          {loading ? <FleetumInlineLoader label="Caricamento manutenzioni" /> : null}
          {!loading&&!error&&rowsWithoutAttachments.length > 0 ? (
            <Alert className="border-amber-300/70 bg-amber-50/75 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold">Alert documentazione manutenzioni</p>
                  <p className="text-xs">
                    Ci sono <strong>{rowsWithoutAttachments.length}</strong> manutenzioni senza allegati fattura in questa pagina.
                    {rowsWithoutAttachmentsPreview ? ` Mezzi coinvolti: ${rowsWithoutAttachmentsPreview}.` : ""}
                  </p>
                </div>
              </div>
            </Alert>
          ) : null}

          <div className="space-y-3 md:hidden">
            {rows.map((item) => (
              <Card key={item.id} className={`${(item.attachments?.length ?? 0) === 0 ? "border-amber-300/60 bg-amber-50/30 dark:border-amber-700/50 dark:bg-amber-950/20" : "border-dashed"}`}>
                <CardContent className="space-y-2 pt-4">
                  {(() => {
                    const invoiceSummary = getInvoiceSummary(item.attachments);
                    const descriptionPreview = getDescriptionPreview(item.maintenanceType, item.description);
                    return (
                      <>
                  <p className="text-sm">
                    <span className="text-muted-foreground">Data: </span>
                    <span className="font-medium">{formatDate(item.performedAt)}</span>
                  </p>
                  <p className="text-sm">
                    <span className="text-muted-foreground">Veicolo: </span>
                    <span className="font-medium">{vehiclePlate(item.vehicle)}</span>
                  </p>
                  <p className="text-sm"><span className="text-muted-foreground">Tipo: </span>{item.maintenanceType}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Km: </span>{item.kmAtService ?? "-"}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Costo: </span>{item.cost != null ? euroFormatter.format(item.cost) : "-"}</p>
                  {(item.attachments?.length ?? 0) === 0 ? (
                    <div className="inline-flex items-center gap-1 rounded-md border border-amber-300/80 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Allegato fattura mancante
                    </div>
                  ) : null}
                  {invoiceSummary.missing > 0 ? (
                    <p className="text-sm text-amber-700">
                      Totale non letto in {invoiceSummary.missing} allegati fattura. Usa Modifica per impostare il costo manuale.
                    </p>
                  ) : null}
                  <p className="text-sm"><span className="text-muted-foreground">Officina: </span>{item.workshopName || "-"}</p>
                  {descriptionPreview ? <p className="text-xs leading-snug text-muted-foreground">{descriptionPreview}</p> : null}
                  <div className="space-y-1">
                    {(() => {
                      const attachments = item.attachments ?? [];
                      const isExpanded = Boolean(expandedAttachmentRows[item.id]);
                      const visibleAttachments = isExpanded ? attachments : attachments.slice(0, 3);
                      const hiddenCount = Math.max(0, attachments.length - visibleAttachments.length);
                      return (
                        <>
                    {visibleAttachments.map((attachment) => (
                      <div key={attachment.id} className="flex items-center justify-between rounded-lg border border-dashed px-2 py-1 text-xs">
                        <span className="truncate">
                          {attachment.fileName}
                          {attachment.invoiceTotalAmount != null && isInvoiceAnalyzableMime(attachment.mimeType)
                            ? ` · ${euroFormatter.format(attachment.invoiceTotalAmount)}`
                            : ""}
                        </span>
                        <div className="flex items-center gap-2">
                          {canPreviewAttachment(attachment) ? (
                            <button type="button" className="text-primary" onClick={() => void openPreview(attachment)}>
                              Apri
                            </button>
                          ) : (
                            <span className="text-muted-foreground">No preview</span>
                          )}
                          <a href={attachmentUrl(attachment.id)} download={attachment.fileName} className="text-primary">Scarica</a>
                          <button
                            type="button"
                            className="text-destructive disabled:opacity-50"
                            disabled={!canWrite||task.busy||deletingAttachmentId === attachment.id}
                            onClick={() => void onDeleteAttachment(item.id, attachment)}
                          >
                            Elimina
                          </button>
                        </div>
                      </div>
                    ))}
                    {hiddenCount > 0 ? (
                      <button
                        type="button"
                        className="text-[11px] font-medium text-primary"
                        onClick={() => toggleAttachmentRow(item.id)}
                      >
                        +{hiddenCount} altri
                      </button>
                    ) : null}
                    {attachments.length > 3 && isExpanded ? (
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground"
                        onClick={() => toggleAttachmentRow(item.id)}
                      >
                        Mostra meno
                      </button>
                    ) : null}
                        </>
                      );
                    })()}
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Button size="sm" variant="outline" disabled={!canWrite||task.busy} onClick={e => openEditPanel(item,e.currentTarget)}>Modifica</Button>
                    <Button size="sm" variant="destructive" disabled={!canWrite||task.busy} onClick={() => onDelete(item.id)}>Elimina</Button>
                  </div>
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="hidden md:block">
            <Table className="text-[12px] [&_th]:h-9 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-[11px] [&_td]:px-2.5 [&_td]:py-2">
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Veicolo</TableHead>
                  <TableHead>Intervento</TableHead>
                  <TableHead>Km</TableHead>
                  <TableHead>Costo</TableHead>
                  <TableHead>Officina</TableHead>
                  <TableHead>Allegati</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((item) => {
                  const invoiceSummary = getInvoiceSummary(item.attachments);
                  const hasMissingAttachments = (item.attachments?.length ?? 0) === 0;
                  const descriptionPreview = getDescriptionPreview(item.maintenanceType, item.description);
                  return (
                  <TableRow
                    key={item.id}
                    className={`text-[12px] ${hasMissingAttachments ? "bg-amber-50/35 dark:bg-amber-950/10" : ""}`}
                  >
                    <TableCell className="whitespace-nowrap">{formatDate(item.performedAt)}</TableCell>
                    <TableCell className="max-w-[190px] truncate font-medium">{vehiclePlate(item.vehicle)}</TableCell>
                    <TableCell>
                      <div className="max-w-[220px]">
                        <p className="font-medium">{item.maintenanceType}</p>
                        {descriptionPreview ? (
                          <p className="text-[11px] leading-snug text-muted-foreground whitespace-normal break-words">
                            {descriptionPreview}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>{item.kmAtService ?? "-"}</TableCell>
                    <TableCell>
                      <div className="leading-tight">
                        <p>{item.cost != null ? euroFormatter.format(item.cost) : "-"}</p>
                        {invoiceSummary.missing > 0 ? (
                          <p className="text-[10px] font-medium text-amber-700">
                            Fatture senza totale: {invoiceSummary.missing}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[140px] truncate">{item.workshopName || "-"}</TableCell>
                    <TableCell>
                      {hasMissingAttachments ? (
                        <div className="inline-flex items-center gap-1 rounded-md border border-amber-300/80 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Allegato mancante
                        </div>
                      ) : (
                        (() => {
                          const attachments = item.attachments ?? [];
                          const isExpanded = Boolean(expandedAttachmentRows[item.id]);
                          const visibleAttachments = isExpanded ? attachments : attachments.slice(0, 1);
                          const hiddenCount = Math.max(0, attachments.length - visibleAttachments.length);
                          return (
                        <div className="space-y-1">
                          {visibleAttachments.map((attachment) => (
                            <div key={attachment.id} className="flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1">
                              {isImageAttachment(attachment.mimeType) ? (
                                <FileImage className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              ) : (
                                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              )}
                              <p className="max-w-[115px] truncate text-[11px] font-medium">{attachment.fileName}</p>
                              <span className="ml-auto text-[10px] text-muted-foreground">
                                {attachment.invoiceTotalAmount != null && isInvoiceAnalyzableMime(attachment.mimeType)
                                  ? euroFormatter.format(attachment.invoiceTotalAmount)
                                  : formatFileSize(attachment.sizeBytes)}
                              </span>
                              <button
                                type="button"
                                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => void openPreview(attachment)}
                                disabled={!canPreviewAttachment(attachment)}
                                title={canPreviewAttachment(attachment) ? "Apri anteprima" : "Anteprima non disponibile"}
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </button>
                              <a href={attachmentUrl(attachment.id)} download={attachment.fileName} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                                <Download className="h-3.5 w-3.5" />
                              </a>
                              <button
                                type="button"
                                className="rounded p-0.5 text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => void onDeleteAttachment(item.id, attachment)}
                                disabled={!canWrite||task.busy||deletingAttachmentId === attachment.id}
                                title="Elimina allegato"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                          {hiddenCount > 0 ? (
                            <button
                              type="button"
                              className="text-[10px] font-medium text-primary"
                              onClick={() => toggleAttachmentRow(item.id)}
                            >
                              +{hiddenCount} altri
                            </button>
                          ) : null}
                          {attachments.length > 1 && isExpanded ? (
                            <button
                              type="button"
                              className="text-[10px] text-muted-foreground"
                              onClick={() => toggleAttachmentRow(item.id)}
                            >
                              Mostra meno
                            </button>
                          ) : null}
                        </div>
                          );
                        })()
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={!canWrite||task.busy} onClick={e => openEditPanel(item,e.currentTarget)}>
                          Modifica
                        </Button>
                        <Button size="sm" variant="destructive" className="h-7 px-2 text-[11px]" disabled={!canWrite||task.busy} onClick={() => onDelete(item.id)}>
                          Elimina
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
            <p className="text-muted-foreground">
              Pagina <span className="font-medium text-foreground">{page}</span> di{" "}
              <span className="font-medium text-foreground">{totalPages}</span> · Totale record:{" "}
              <span className="font-medium text-foreground">{total}</span>
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1 || loading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Precedente
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                Successiva
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {exportDialogOpen?<CommerceDrawer compact title="Export manutenzioni" description="Scegli veicolo e periodo per il registro degli interventi" busy={!!exportLoading} onClose={()=>setExportDialogOpen(false)} footer={<>
                <Button variant="outline" onClick={() => setExportDialogOpen(false)} disabled={Boolean(exportLoading)}>
                  Annulla
                </Button>
                <Button variant="outline" onClick={() => void runMaintenanceExport("csv")} disabled={Boolean(exportLoading)}>
                  {exportLoading === "csv" ? "Export CSV..." : "Export CSV"}
                </Button>
                <Button onClick={() => void runMaintenanceExport("xlsx")} disabled={Boolean(exportLoading)}>
                  {exportLoading === "xlsx" ? "Export XLSX..." : "Export Enterprise XLSX"}
                </Button>
</>}>{error?<CommerceNotice>{error}</CommerceNotice>:null}              <div className="grid gap-3 px-5 py-4 sm:grid-cols-3">
                <div className="grid gap-1.5 sm:col-span-3">
                  <Label htmlFor="maintenance-field-1">Targa</Label>
                  <Select id="maintenance-field-1" value={exportVehicleId} onChange={(event) => setExportVehicleId(event.target.value)}>
                    <option value="">Tutte le targhe</option>
                    {vehicles.map((vehicle) => (
                      <option translate="no" key={vehicle.id} value={vehicle.id}>
                        {vehicle.plate} · {vehicle.brand} {vehicle.model}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="maintenance-field-2">Data da</Label>
                  <Input id="maintenance-field-2" type="date" value={exportDateFrom} onChange={(event) => setExportDateFrom(event.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="maintenance-field-3">Data a</Label>
                  <Input id="maintenance-field-3" type="date" value={exportDateTo} onChange={(event) => setExportDateTo(event.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="maintenance-field-4">Preset rapido</Label>
                  <Select id="maintenance-field-4"
                    defaultValue=""
                    onChange={(event) => {
                      const value = event.target.value;
                      const today = new Date();
                      if (value === "30") {
                        setExportDateFrom(toDateInputValue(new Date(Date.now() - 29 * 86400000)));
                        setExportDateTo(toDateInputValue(today));
                      } else if (value === "90") {
                        setExportDateFrom(toDateInputValue(new Date(Date.now() - 89 * 86400000)));
                        setExportDateTo(toDateInputValue(today));
                      } else if (value === "365") {
                        setExportDateFrom(toDateInputValue(new Date(Date.now() - 364 * 86400000)));
                        setExportDateTo(toDateInputValue(today));
                      }
                    }}
                  >
                    <option value="">Manuale</option>
                    <option value="30">Ultimi 30 giorni</option>
                    <option value="90">Ultimi 90 giorni</option>
                    <option value="365">Ultimi 12 mesi</option>
                  </Select>
                </div>
              </div>

</CommerceDrawer>:null}

      {previewAttachment?<CommerceDrawer title={previewAttachment.fileName} description={formatFileSize(previewAttachment.sizeBytes)} level={110} onClose={closePreview} footer={<a className="operations-file-link" href={attachmentUrl(previewAttachment.id)} download={previewAttachment.fileName}>Scarica allegato</a>}>                {previewLoading ? (
                  <div className="grid h-[36vh] place-items-center rounded-lg border bg-card">
                    <FleetumBlockLoader label="Caricamento anteprima" className="min-h-0" />
                  </div>
                ) : previewError ? (
                  <div className="grid h-[36vh] place-items-center rounded-lg border bg-card">
                    <p className="text-sm text-destructive">{previewError}</p>
                  </div>
                ) : isImageAttachment(previewAttachment.mimeType) && previewObjectUrl ? (
                  <div className="grid h-[72vh] place-items-center overflow-auto rounded-lg border bg-card">
                    <img
                      src={previewObjectUrl}
                      alt={previewAttachment.fileName}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                ) : isPdfAttachment(previewAttachment) && previewObjectUrl ? (
                  <iframe
                    title={previewAttachment.fileName}
                    src={previewObjectUrl}
                    className="h-[72vh] w-full rounded-lg border bg-card"
                  />
                ) : (
                  <div className="grid h-[36vh] place-items-center rounded-lg border bg-card">
                    <p className="text-sm text-muted-foreground">Anteprima non disponibile per questo tipo di file.</p>
                  </div>
                )}</CommerceDrawer>:null}

      {panelOpen?<CommerceDrawer title={mode==="create"?"Nuova manutenzione":"Modifica manutenzione"} description="Intervento, costi e documenti del veicolo" origin={origin.current} motionRef={motion} busy={submitting} onClose={closePanel}>{error?<CommerceNotice>{error}</CommerceNotice>:null}{savedId.current?<p role="status" className="operations-hint">Intervento registrato: gli allegati ancora selezionati verranno completati con il prossimo salvataggio.</p>:null}              <form id="maintenance-form" className="operations-form" onChangeCapture={()=>setDirty(true)} onSubmit={onSubmit}><fieldset disabled={submitting||!canWrite} className="grid gap-4 sm:grid-cols-2">
                <div className="relative grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="maintenance-field-5">Targa veicolo</Label>
                  <Input id="maintenance-field-5"
                    value={vehicleQuery}
                    onChange={(event) => {
                      const value = event.target.value;
                      setVehicleQuery(value);
                      setVehicleSuggestionsOpen(true);
                      if (selectedVehicle && selectedVehicle.plate.toUpperCase() !== value.trim().toUpperCase()) {
                        setSelectedVehicleId("");
                      }
                    }}
                    onFocus={() => setVehicleSuggestionsOpen(true)}
                    onKeyDown={e=>{if(e.key==="Escape")setVehicleSuggestionsOpen(false);if(e.key==="ArrowDown"){e.preventDefault();document.getElementById("maintenance-vehicle-options")?.querySelector<HTMLButtonElement>("button")?.focus()}}}
                    placeholder="Scrivi targa (es. AB123CD)"
                    required
                  />
                  {vehicleSuggestionsOpen ? (
                    <div id="maintenance-vehicle-options" className="absolute left-0 right-0 top-[72px] z-20 max-h-56 overflow-auto rounded-xl border bg-card shadow-xl">
                      {vehicleSuggestions.length === 0 ? (
                        <p className="px-3 py-2 text-sm text-muted-foreground">Nessun veicolo trovato.</p>
                      ) : (
                        vehicleSuggestions.map((vehicle) => (
                          <button
                            key={vehicle.id}
                            type="button"
                            className="flex w-full flex-col items-start gap-0.5 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/50"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {selectVehicle(vehicle);setDirty(true)}}
                          >
                            <span className="text-sm font-semibold">{vehicle.plate}</span>
                            <span className="text-xs text-muted-foreground">
                              {vehicle.brand} {vehicle.model} {vehicle.site?.name ? `· ${vehicle.site.name}` : ""}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                  {selectedVehicleId ? (
                    <p className="text-xs text-emerald-700">
                      Selezionato: {selectedVehicle?.plate ?? "-"} {selectedVehicle ? `(${selectedVehicle.brand} ${selectedVehicle.model})` : ""}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Seleziona una targa dai suggerimenti.</p>
                  )}
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="maintenance-field-6">Data intervento</Label>
                  <Input id="maintenance-field-6"
                    name="performedAt"
                    type="date"
                    defaultValue={toDateInputValue(editingItem?.performedAt)}
                    required
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="maintenance-field-7">Tipo manutenzione</Label>
                  <Input id="maintenance-field-7"
                    name="maintenanceType"
                    defaultValue={editingItem?.maintenanceType ?? ""}
                    placeholder="Tagliando, freni, pneumatici..."
                    required
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="maintenance-field-8">Km al servizio</Label>
                  <Input id="maintenance-field-8"
                    name="kmAtService"
                    type="number"
                    min={0}
                    defaultValue={editingItem?.kmAtService ?? ""}
                    placeholder="Es. 125000"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="maintenance-field-9">Costo (EUR)</Label>
                  <Input id="maintenance-field-9"
                    name="cost"
                    type="number"
                    min={0}
                    step="0.01"
                    defaultValue={editingItem?.cost ?? ""}
                    placeholder="Es. 380.50"
                  />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="maintenance-field-10">Officina / Fornitore</Label>
                  <Input id="maintenance-field-10" name="workshopName" defaultValue={editingItem?.workshopName ?? ""} placeholder="Nome officina o fornitore" />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="maintenance-field-11">Descrizione intervento</Label>
                  <Textarea id="maintenance-field-11"
                    name="description"
                    defaultValue={editingItem?.description ?? ""}
                    placeholder="Dettaglio lavorazione effettuata"
                  />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="maintenance-field-12">Allegati (immagini, PDF, documenti)</Label>
                  <Input id="maintenance-field-12"
                    type="file"
                    multiple
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                    onChange={onAttachmentFilesChange}
                  />
                  <p className="text-xs text-muted-foreground">
                    {attachmentFiles.length > 0
                      ? `${attachmentFiles.length} file selezionati.`
                      : "Nessun file selezionato."}
                  </p>
                </div>
                <div className="flex gap-2 sm:col-span-2">
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Salvataggio..." : mode === "create" ? "Registra manutenzione" : "Salva modifiche"}
                  </Button>
                  <Button type="button" variant="outline" onClick={closePanel}>
                    Annulla
                  </Button>
                </div>
              </fieldset></form></CommerceDrawer>:null}
      {discard?<DiscardDialog onContinue={()=>setDiscard(false)} onDiscard={()=>{setDiscard(false);setDirty(false);setPanelOpen(false)}}/>:null}
      {confirm?<CommerceDrawer compact level={150} title={confirm.title} onClose={()=>{if(!task.busy)setConfirm(null)}} busy={task.busy} footer={<><Button variant="outline" disabled={task.busy} onClick={()=>setConfirm(null)}>Annulla</Button><Button variant="destructive" disabled={task.busy} onClick={()=>void task.run(async()=>{await confirm.run();setConfirm(null)})}>{task.busy?"Eliminazione...":"Elimina"}</Button></>}><p>Confermi l’eliminazione di {confirm.name}?</p>{task.error?<CommerceNotice>{task.error}</CommerceNotice>:null}</CommerceDrawer>:null}
    </section>
  );
};
