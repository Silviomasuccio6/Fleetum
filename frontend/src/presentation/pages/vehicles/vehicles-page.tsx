import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { FileText, Trash2, Upload, X } from "lucide-react";
import { masterDataUseCases } from "../../../application/usecases/master-data-usecases";
import { FleetumInlineLoader } from "../../components/brand/fleetum-logo-loader";
import { PageHeader } from "../../components/layout/page-header";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";

type ImportVehicleError = {
  row: number;
  field: string;
  reason: string;
  value?: string;
};

type ImportVehicleResult = {
  totalRows: number;
  validRows: number;
  inserted: number;
  skipped: number;
  errors: ImportVehicleError[];
  dryRun: boolean;
};

const PAGE_SIZE = 20;
const toDateInputValue = (value?: string | Date | null) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
};

const formatDate = (value?: string | Date | null) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("it-IT");
};

const formatMonthYear = (value?: string | Date | null) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
};

const toIsoAtNoon = (value: string) => new Date(`${value.trim()}T12:00:00`).toISOString();

const formatBytes = (value?: number | null) => {
  if (!value || value <= 0) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

export const VehiclesPage = () => {
  const [sites, setSites] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [totalVehicles, setTotalVehicles] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [importPanelOpen, setImportPanelOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editingVehicle, setEditingVehicle] = useState<any | null>(null);
  const [bookletFile, setBookletFile] = useState<File | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importDefaultSiteId, setImportDefaultSiteId] = useState("");
  const [importDryRun, setImportDryRun] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<ImportVehicleResult | null>(null);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(totalVehicles / PAGE_SIZE)), [totalVehicles]);

  const loadSites = async () => {
    const sitesRes = await masterDataUseCases.listSites({ page: 1, pageSize: 200 });
    setSites(sitesRes.data);
  };

  const loadVehicles = async (targetPage: number, targetSearch: string) => {
    setLoading(true);
    setError(null);
    try {
      const vehiclesRes = await masterDataUseCases.listVehicles({
        page: targetPage,
        pageSize: PAGE_SIZE,
        search: targetSearch || undefined
      });
      const nextTotal = typeof vehiclesRes.total === "number" ? vehiclesRes.total : vehiclesRes.data.length;
      const nextTotalPages = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE));
      if (targetPage > nextTotalPages) {
        setPage(nextTotalPages);
        return;
      }
      setVehicles(vehiclesRes.data);
      setTotalVehicles(nextTotal);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const reloadVehicles = async () => {
    await loadVehicles(page, searchQuery);
  };

  useEffect(() => {
    loadSites().catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearchQuery(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    void loadVehicles(page, searchQuery);
  }, [page, searchQuery]);

  useEffect(() => {
    if (!importDefaultSiteId && sites[0]?.id) {
      setImportDefaultSiteId(String(sites[0].id));
    }
  }, [importDefaultSiteId, sites]);

  const openCreatePanel = () => {
    setMode("create");
    setEditingVehicle(null);
    setBookletFile(null);
    setImportPanelOpen(false);
    setPanelOpen(true);
  };

  const openEditPanel = (vehicle: any) => {
    setMode("edit");
    setEditingVehicle(vehicle);
    setBookletFile(null);
    setImportPanelOpen(false);
    setPanelOpen(true);
  };

  const openImportPanel = () => {
    setPanelOpen(false);
    setBookletFile(null);
    setImportResult(null);
    setImportFile(null);
    setImportDryRun(false);
    setError(null);
    setSuccess(null);
    setImportPanelOpen(true);
  };

  const onImportFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setImportFile(file);
  };

  const onBookletFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setBookletFile(file);
  };

  const onOpenBooklet = async (bookletId: string) => {
    setError(null);
    try {
      const blob = await masterDataUseCases.downloadVehicleBooklet(bookletId);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onDeleteBooklet = async (bookletId: string) => {
    setError(null);
    setSuccess(null);
    try {
      await masterDataUseCases.deleteVehicleBooklet(bookletId);
      setSuccess("Libretto rimosso.");
      await reloadVehicles();
      if (editingVehicle && editingVehicle.booklet?.id === bookletId) {
        setEditingVehicle({ ...editingVehicle, booklet: null });
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const form = new FormData(event.currentTarget);

    const registrationDateValue = String(form.get("registrationDate") || "").trim();
    const lastRevisionAtValue = String(form.get("lastRevisionAt") || "").trim();

    const payload = {
      siteId: String(form.get("siteId") || "").trim(),
      plate: String(form.get("plate") || "").trim().toUpperCase(),
      brand: String(form.get("brand") || "").trim(),
      model: String(form.get("model") || "").trim(),
      year: String(form.get("year") || "").trim() ? Number(form.get("year")) : null,
      currentKm: String(form.get("currentKm") || "").trim() ? Number(form.get("currentKm")) : null,
      maintenanceIntervalKm: String(form.get("maintenanceIntervalKm") || "").trim() ? Number(form.get("maintenanceIntervalKm")) : null,
      registrationDate: registrationDateValue ? toIsoAtNoon(registrationDateValue) : null,
      lastRevisionAt: lastRevisionAtValue ? toIsoAtNoon(lastRevisionAtValue) : null,
      notes: String(form.get("notes") || "").trim()
    };

    if (!payload.siteId || !payload.plate || !payload.brand || !payload.model) {
      setError("Compila sede, targa, marca e modello.");
      return;
    }

    try {
      let savedVehicle: any;
      if (mode === "create") {
        savedVehicle = await masterDataUseCases.createVehicle(payload);
        setSuccess(`Veicolo ${payload.plate} creato correttamente.`);
      } else if (editingVehicle) {
        savedVehicle = await masterDataUseCases.updateVehicle(editingVehicle.id, payload);
        setSuccess(`Veicolo ${payload.plate} aggiornato correttamente.`);
      }

      if (bookletFile && savedVehicle?.id) {
        const uploadResult = await masterDataUseCases.uploadVehicleBooklet(savedVehicle.id, bookletFile);
        if (uploadResult?.detectedRegistrationDate) {
          setSuccess(
            `Veicolo ${payload.plate} aggiornato. Libretto acquisito e immatricolazione rilevata automaticamente (${formatDate(uploadResult.detectedRegistrationDate)}).`
          );
        } else {
          setSuccess(`Veicolo ${payload.plate} aggiornato. Libretto caricato.`);
        }
      }
      setPanelOpen(false);
      setEditingVehicle(null);
      setBookletFile(null);
      await reloadVehicles();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onImportSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!importFile) {
      setError("Seleziona un file Excel o CSV da importare.");
      return;
    }

    try {
      setImportLoading(true);
      const result = await masterDataUseCases.importVehicles({
        file: importFile,
        dryRun: importDryRun,
        defaultSiteId: importDefaultSiteId || undefined
      });

      setImportResult(result);
      if (!result.dryRun && result.inserted > 0) {
        await reloadVehicles();
      }

      if (result.dryRun) {
        setSuccess(
          `Anteprima completata: ${result.validRows} righe valide su ${result.totalRows}. Nessun dato salvato.`
        );
      } else {
        setSuccess(
          `Import completato: ${result.inserted} veicoli creati su ${result.totalRows} righe. Errori: ${result.errors.length}.`
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImportLoading(false);
    }
  };

  const importErrorsPreview = useMemo(
    () => (importResult?.errors ?? []).slice(0, 50),
    [importResult]
  );

  const onDelete = async (id: string) => {
    setError(null);
    setSuccess(null);
    try {
      await masterDataUseCases.deleteVehicle(id);
      setSuccess("Veicolo eliminato.");
      await reloadVehicles();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="space-y-3">
      <PageHeader
        title="Anagrafiche Veicoli"
        subtitle="Gestione veicoli con ricerca, modifica rapida e allineamento operativo con sedi/officine."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={openImportPanel}>
              <Upload className="h-4 w-4" />
              Importa veicoli
            </Button>
            <Button onClick={openCreatePanel}>Nuovo veicolo</Button>
          </div>
        }
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}

      <Card className="saas-surface shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Elenco veicoli</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Cerca per targa, marca, modello, sede..."
          />

          {loading ? <FleetumInlineLoader label="Caricamento veicoli" /> : null}

          <div className="space-y-3 md:hidden">
            {vehicles.map((vehicle) => (
              <Card key={vehicle.id} className="border-dashed">
                <CardContent className="space-y-2 pt-4">
                  <p className="text-sm"><span className="text-muted-foreground">Targa: </span><span className="font-semibold">{vehicle.plate}</span></p>
                  <p className="text-sm"><span className="text-muted-foreground">Veicolo: </span>{vehicle.brand} {vehicle.model}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Sede: </span>{vehicle.site?.name || "-"}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Anno: </span>{vehicle.year || "-"}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Km attuali: </span>{vehicle.currentKm ?? "-"}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Intervallo manutenzione km: </span>{vehicle.maintenanceIntervalKm ?? "-"}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Immatricolazione: </span>{formatDate(vehicle.registrationDate)}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Ultima revisione: </span>{formatDate(vehicle.lastRevisionAt)}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Prossima revisione: </span>{formatMonthYear(vehicle.revisionDueAt)}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Libretto: </span>{vehicle.booklet?.fileName || "-"}</p>
                  <div className="flex items-center justify-end gap-2">
                    {vehicle.booklet?.id ? (
                      <Button size="sm" variant="outline" onClick={() => void onOpenBooklet(vehicle.booklet.id)}>
                        <FileText className="h-4 w-4" />
                        Libretto
                      </Button>
                    ) : null}
                    <Button size="sm" variant="outline" onClick={() => openEditPanel(vehicle)}>Modifica</Button>
                    <Button size="sm" variant="destructive" onClick={() => onDelete(vehicle.id)}>Elimina</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="hidden md:block">
            <Table className="text-[12px] [&_th]:h-9 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-[11px] [&_td]:px-2.5 [&_td]:py-2">
              <TableHeader>
                <TableRow>
                  <TableHead>Targa</TableHead>
                  <TableHead>Veicolo</TableHead>
                  <TableHead>Sede</TableHead>
                  <TableHead>Km attuali</TableHead>
                  <TableHead>Intervallo km</TableHead>
                  <TableHead>Revisione</TableHead>
                  <TableHead>Libretto</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles.map((vehicle) => (
                  <TableRow key={vehicle.id} className="text-[12px]">
                    <TableCell className="font-medium">{vehicle.plate}</TableCell>
                    <TableCell className="max-w-[180px] truncate">{vehicle.brand} {vehicle.model}</TableCell>
                    <TableCell>{vehicle.site?.name || "-"}</TableCell>
                    <TableCell>{vehicle.currentKm ?? "-"}</TableCell>
                    <TableCell>{vehicle.maintenanceIntervalKm ?? "-"}</TableCell>
                    <TableCell>
                      <div className="leading-tight">
                        <p className="text-[11px] text-muted-foreground">Ult.: {formatDate(vehicle.lastRevisionAt)}</p>
                        <p className="font-medium">Pross.: {formatMonthYear(vehicle.revisionDueAt)}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {vehicle.booklet?.id ? (
                        <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => void onOpenBooklet(vehicle.booklet.id)}>
                          <FileText className="h-4 w-4" />
                          Apri
                        </Button>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => openEditPanel(vehicle)}>Modifica</Button>
                        <Button size="sm" variant="destructive" className="h-7 px-2 text-[11px]" onClick={() => onDelete(vehicle.id)}>Elimina</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
            <p className="text-muted-foreground">
              Pagina <span className="font-medium text-foreground">{page}</span> di{" "}
              <span className="font-medium text-foreground">{totalPages}</span> · Totale record:{" "}
              <span className="font-medium text-foreground">{totalVehicles}</span>
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

      {panelOpen ? (
        <>
          <div className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-sm" onClick={() => setPanelOpen(false)} />
          <aside className="fixed z-[80] right-0 top-0 h-full w-full max-w-xl border-l bg-card shadow-2xl max-sm:bottom-0 max-sm:top-auto max-sm:max-h-[88vh] max-sm:rounded-t-2xl max-sm:border-t max-sm:border-l-0">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <p className="text-sm font-semibold">{mode === "create" ? "Nuovo veicolo" : "Modifica veicolo"}</p>
              <Button variant="outline" size="icon" onClick={() => setPanelOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="h-[calc(100%-64px)] overflow-auto px-4 py-4">
              <form className="grid gap-3 sm:grid-cols-2" onSubmit={onSubmit}>
                <div className="grid gap-1.5">
                  <Label>Sede</Label>
                  <Select name="siteId" defaultValue={editingVehicle?.siteId ?? sites[0]?.id ?? ""} required>
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>{site.name} - {site.city}</option>
                    ))}
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Targa</Label>
                  <Input name="plate" defaultValue={editingVehicle?.plate ?? ""} placeholder="AB123CD" required />
                </div>
                <div className="grid gap-1.5">
                  <Label>Marca</Label>
                  <Input name="brand" defaultValue={editingVehicle?.brand ?? ""} placeholder="Iveco" required />
                </div>
                <div className="grid gap-1.5">
                  <Label>Modello</Label>
                  <Input name="model" defaultValue={editingVehicle?.model ?? ""} placeholder="Daily" required />
                </div>
                <div className="grid gap-1.5">
                  <Label>Anno</Label>
                  <Input name="year" type="number" min={1950} max={2100} defaultValue={editingVehicle?.year ?? ""} />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Km attuali</Label>
                  <Input name="currentKm" type="number" min={0} defaultValue={editingVehicle?.currentKm ?? ""} />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Intervallo manutenzione (km)</Label>
                  <Input name="maintenanceIntervalKm" type="number" min={100} defaultValue={editingVehicle?.maintenanceIntervalKm ?? ""} />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Data immatricolazione (libretto)</Label>
                  <Input name="registrationDate" type="date" defaultValue={toDateInputValue(editingVehicle?.registrationDate)} />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Ultima revisione effettuata</Label>
                  <Input name="lastRevisionAt" type="date" defaultValue={toDateInputValue(editingVehicle?.lastRevisionAt)} />
                  <p className="text-xs text-muted-foreground">
                    Regola automatica: prima revisione a 4 anni dall'immatricolazione, poi ogni 2 anni dall'ultima revisione.
                  </p>
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Libretto veicolo (PDF o immagine)</Label>
                  <Input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*" onChange={onBookletFileChange} />
                  <p className="text-xs text-muted-foreground">
                    {bookletFile ? `Nuovo file selezionato: ${bookletFile.name}` : "Nessun nuovo file selezionato"}
                  </p>
                  {editingVehicle?.booklet?.id ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs">
                      <span className="text-muted-foreground">
                        Attuale: <span className="font-medium text-foreground">{editingVehicle.booklet.fileName}</span> ({formatBytes(editingVehicle.booklet.sizeBytes)})
                      </span>
                      <Button type="button" size="sm" variant="outline" onClick={() => void onOpenBooklet(editingVehicle.booklet.id)}>
                        <FileText className="h-4 w-4" />
                        Apri
                      </Button>
                      <Button type="button" size="sm" variant="destructive" onClick={() => void onDeleteBooklet(editingVehicle.booklet.id)}>
                        <Trash2 className="h-4 w-4" />
                        Rimuovi
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Prossima revisione (auto)</Label>
                  <Input value={formatMonthYear(editingVehicle?.revisionDueAt)} readOnly />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Note</Label>
                  <Input name="notes" defaultValue={editingVehicle?.notes ?? ""} placeholder="Note operative" />
                </div>
                <div className="sm:col-span-2 flex gap-2">
                  <Button type="submit">{mode === "create" ? "Crea veicolo" : "Salva modifiche"}</Button>
                  <Button type="button" variant="outline" onClick={() => setPanelOpen(false)}>Annulla</Button>
                </div>
              </form>
            </div>
          </aside>
        </>
      ) : null}

      {importPanelOpen ? (
        <>
          <div className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-sm" onClick={() => setImportPanelOpen(false)} />
          <aside className="fixed z-[80] right-0 top-0 h-full w-full max-w-xl border-l bg-card shadow-2xl max-sm:bottom-0 max-sm:top-auto max-sm:max-h-[88vh] max-sm:rounded-t-2xl max-sm:border-t max-sm:border-l-0">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <p className="text-sm font-semibold">Import massivo veicoli</p>
              <Button variant="outline" size="icon" onClick={() => setImportPanelOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="h-[calc(100%-64px)] overflow-auto px-4 py-4">
              <form className="space-y-4" onSubmit={onImportSubmit}>
                <p className="text-sm text-muted-foreground">
                  Carica un file `.xlsx` o `.csv`. Colonne minime supportate: `targa`, `marca`, `modello`.
                  Se nel file manca la sede, usa la sede di default.
                </p>

                <div className="grid gap-1.5">
                  <Label>File import</Label>
                  <Input type="file" accept=".xlsx,.csv" onChange={onImportFileChange} />
                  <p className="text-xs text-muted-foreground">
                    {importFile ? `File selezionato: ${importFile.name}` : "Nessun file selezionato"}
                  </p>
                </div>

                <div className="grid gap-1.5">
                  <Label>Sede di default (opzionale)</Label>
                  <Select value={importDefaultSiteId} onChange={(e) => setImportDefaultSiteId(e.target.value)}>
                    <option value="">Usa la colonna site_name dal file</option>
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name} - {site.city}
                      </option>
                    ))}
                  </Select>
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input"
                    checked={importDryRun}
                    onChange={(event) => setImportDryRun(event.target.checked)}
                  />
                  Esegui anteprima (dry run, nessun salvataggio)
                </label>

                <div className="flex gap-2">
                  <Button type="submit" disabled={importLoading}>
                    {importLoading ? "Import in corso..." : importDryRun ? "Avvia anteprima" : "Avvia import"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setImportPanelOpen(false)}>
                    Chiudi
                  </Button>
                </div>
              </form>

              {importResult ? (
                <Card className="mt-4 border-dashed">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">
                      Risultato {importResult.dryRun ? "anteprima" : "import"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <p>Righe totali: <span className="font-semibold">{importResult.totalRows}</span></p>
                    <p>Righe valide: <span className="font-semibold">{importResult.validRows}</span></p>
                    <p>Inserite: <span className="font-semibold">{importResult.inserted}</span></p>
                    <p>Scartate: <span className="font-semibold">{importResult.skipped}</span></p>
                    <p>Errori: <span className="font-semibold">{importResult.errors.length}</span></p>

                    {importErrorsPreview.length > 0 ? (
                      <div className="max-h-60 space-y-2 overflow-auto rounded-lg border border-dashed p-3">
                        {importErrorsPreview.map((item, index) => (
                          <p key={`${item.row}-${item.field}-${index}`} className="text-xs">
                            <span className="font-semibold">Riga {item.row}</span> · {item.field} · {item.reason}
                            {item.value ? ` (valore: ${item.value})` : ""}
                          </p>
                        ))}
                        {importResult.errors.length > importErrorsPreview.length ? (
                          <p className="text-xs text-muted-foreground">
                            Mostrati primi {importErrorsPreview.length} errori su {importResult.errors.length}.
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-xs text-emerald-700">Nessun errore rilevato.</p>
                    )}
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </aside>
        </>
      ) : null}
    </section>
  );
};
