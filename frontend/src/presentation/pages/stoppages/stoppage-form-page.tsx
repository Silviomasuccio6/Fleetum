import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { masterDataUseCases } from "../../../application/usecases/master-data-usecases";
import { usersUseCases } from "../../../application/usecases/users-usecases";
import { stoppagesUseCases } from "../../../application/usecases/stoppages-usecases";
import { FleetumBlockLoader } from "../../components/brand/fleetum-logo-loader";
import { PageHeader } from "../../components/layout/page-header";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";

const toList = (value: any): any[] => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
};

const localNowForInput = () => {
  const d = new Date();
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
};

export const StoppageFormPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();

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

  const [showQuickSite, setShowQuickSite] = useState(false);
  const [quickSiteError, setQuickSiteError] = useState<string | null>(null);
  const [quickSiteSuccess, setQuickSiteSuccess] = useState<string | null>(null);
  const [quickSiteName, setQuickSiteName] = useState("");
  const [quickSiteAddress, setQuickSiteAddress] = useState("");
  const [quickSiteCity, setQuickSiteCity] = useState("");

  const [showQuickVehicle, setShowQuickVehicle] = useState(false);
  const [quickVehicleError, setQuickVehicleError] = useState<string | null>(null);
  const [quickVehicleSuccess, setQuickVehicleSuccess] = useState<string | null>(null);
  const [quickPlate, setQuickPlate] = useState("");
  const [quickBrand, setQuickBrand] = useState("");
  const [quickModel, setQuickModel] = useState("");
  const [quickYear, setQuickYear] = useState("");
  const [quickNotes, setQuickNotes] = useState("");

  const [loadingDetail, setLoadingDetail] = useState(Boolean(id));
  const [formVersion, setFormVersion] = useState(0);
  const [formDefaults, setFormDefaults] = useState({
    status: "OPEN",
    priority: "MEDIUM",
    assignedToUserId: "",
    openedAt: localNowForInput(),
    reminderAfterDays: "",
    estimatedCostPerDay: "",
    reason: "",
    notes: ""
  });
  const [error, setError] = useState<string | null>(null);

  const loadMasterData = async () => {
    setError(null);

    const results = await Promise.allSettled([
      masterDataUseCases.listSites({ page: 1, pageSize: 100 }),
      masterDataUseCases.listWorkshops({ page: 1, pageSize: 100 }),
      masterDataUseCases.listVehicles({ page: 1, pageSize: 200 }),
      usersUseCases.list()
    ]);

    const sitesData = results[0].status === "fulfilled" ? toList(results[0].value) : [];
    const workshopsData = results[1].status === "fulfilled" ? toList(results[1].value) : [];
    const vehiclesData = results[2].status === "fulfilled" ? toList(results[2].value) : [];
    const usersData = results[3].status === "fulfilled" ? toList(results[3].value) : [];

    setSites(sitesData);
    setWorkshops(workshopsData);
    setVehicles(vehiclesData);
    setUsers(usersData);

    if (!id) {
      if (!selectedSiteId && sitesData[0]?.id) setSelectedSiteId(sitesData[0].id);
      if (!selectedWorkshopId && workshopsData[0]?.id) setSelectedWorkshopId(workshopsData[0].id);
      if (!selectedVehicleId && vehiclesData[0]?.id) setSelectedVehicleId(vehiclesData[0].id);
    }

    const failed = results.some((r) => r.status === "rejected");
    if (failed) setError("Alcuni dati anagrafici non sono disponibili. Puoi comunque compilare il fermo.");
  };

  useEffect(() => {
    loadMasterData().catch((err: Error) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!id) return;
    let mounted = true;

    const loadStoppage = async () => {
      setLoadingDetail(true);
      setError(null);
      try {
        const detail = await stoppagesUseCases.getById(id);
        if (!mounted) return;

        setSelectedSiteId(String(detail.siteId ?? ""));
        setSelectedWorkshopId(String(detail.workshopId ?? ""));
        setSelectedVehicleId(String(detail.vehicleId ?? ""));
        setFormDefaults({
          status: String(detail.status ?? "OPEN"),
          priority: String(detail.priority ?? "MEDIUM"),
          assignedToUserId: String(detail.assignedToUserId ?? ""),
          openedAt: detail.openedAt ? new Date(detail.openedAt).toISOString().slice(0, 16) : localNowForInput(),
          reminderAfterDays: detail.reminderAfterDays ? String(detail.reminderAfterDays) : "",
          estimatedCostPerDay: detail.estimatedCostPerDay ? String(detail.estimatedCostPerDay) : "",
          reason: String(detail.reason ?? ""),
          notes: String(detail.notes ?? "")
        });
        setFormVersion((value) => value + 1);
      } catch (err) {
        if (!mounted) return;
        setError((err as Error).message);
      } finally {
        if (mounted) setLoadingDetail(false);
      }
    };

    void loadStoppage();
    return () => {
      mounted = false;
    };
  }, [id]);

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
      setSelectedVehicleId(filteredVehicles[0].id);
    }
  }, [filteredVehicles, selectedVehicleId]);

  const onQuickSiteCreate = async () => {
    setQuickSiteError(null);
    setQuickSiteSuccess(null);

    const payload = {
      name: quickSiteName.trim(),
      address: quickSiteAddress.trim() || "Indirizzo da completare",
      city: quickSiteCity.trim() || "N/D",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
      isActive: true
    };

    if (!payload.name) {
      setQuickSiteError("Inserisci almeno il nome sede per crearla.");
      return;
    }

    try {
      const created = (await masterDataUseCases.createSite(payload)) as any;
      await loadMasterData();
      if (created?.id) setSelectedSiteId(created.id);
      setQuickSiteSuccess(`Sede ${payload.name} creata e selezionata.`);
      setQuickSiteName("");
      setQuickSiteAddress("");
      setQuickSiteCity("");
      setShowQuickSite(false);
    } catch (err) {
      setQuickSiteError((err as Error).message);
    }
  };

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
      await loadMasterData();
      if (created?.id) setSelectedWorkshopId(created.id);
      setQuickWorkshopSuccess(`Officina ${payload.name} creata e selezionata.`);
      setQuickWorkshopName("");
      setQuickWorkshopEmail("");
      setQuickWorkshopPhone("");
      setQuickWorkshopCity("");
      setQuickWorkshopAddress("");
      setShowQuickWorkshop(false);
    } catch (err) {
      setQuickWorkshopError((err as Error).message);
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
      await loadMasterData();
      if (created?.id) setSelectedVehicleId(created.id);
      setQuickVehicleSuccess(`Veicolo ${payload.plate} creato e selezionato.`);
      setQuickPlate("");
      setQuickBrand("");
      setQuickModel("");
      setQuickYear("");
      setQuickNotes("");
      setShowQuickVehicle(false);
    } catch (err) {
      const normalizedPlate = payload.plate;
      try {
        const refreshedVehicles = await masterDataUseCases.listVehicles({ page: 1, pageSize: 200 });
        const vehicleList = toList(refreshedVehicles);
        setVehicles(vehicleList);
        const existing = vehicleList.find((v) => String(v.plate ?? "").trim().toUpperCase() === normalizedPlate);
        if (existing?.id) {
          setSelectedVehicleId(String(existing.id));
          setQuickVehicleSuccess(`Esiste gia un veicolo con targa ${normalizedPlate}. Lo abbiamo selezionato automaticamente.`);
          setShowQuickVehicle(false);
          return;
        }
      } catch {
        // Best-effort fallback: keep original backend error message below.
      }
      setQuickVehicleError((err as Error).message);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const openedAtRaw = String(form.get("openedAt") || "").trim();
    if (!openedAtRaw) {
      setError("Data apertura obbligatoria.");
      return;
    }

    const openedAtIso = new Date(openedAtRaw).toISOString();
    if (Number.isNaN(new Date(openedAtIso).getTime())) {
      setError("Data apertura non valida.");
      return;
    }

    const payload = {
      siteId: selectedSiteId,
      vehicleId: selectedVehicleId,
      workshopId: selectedWorkshopId,
      reason: String(form.get("reason") || "").trim(),
      notes: String(form.get("notes") || ""),
      status: String(form.get("status") || "") || "OPEN",
      priority: String(form.get("priority") || "") || "MEDIUM",
      assignedToUserId: String(form.get("assignedToUserId") || "") || null,
      estimatedCostPerDay: Number(form.get("estimatedCostPerDay") || 0) || null,
      openedAt: openedAtIso,
      reminderAfterDays: Number(form.get("reminderAfterDays") || 0) || null
    };

    if (!payload.siteId || !payload.vehicleId || !payload.workshopId || !payload.reason) {
      setError("Compila i campi obbligatori (sede, veicolo, officina, motivo).");
      return;
    }

    try {
      if (id) await stoppagesUseCases.update(id, payload);
      else await stoppagesUseCases.create(payload);
      navigate("/fermi");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (loadingDetail) {
    return <FleetumBlockLoader label="Caricamento fermo" />;
  }

  return (
    <section className="space-y-4">
      <PageHeader
        title={id ? "Modifica fermo" : "Nuovo fermo"}
        subtitle="Compila i dati operativi, imposta priorità e reminder, allega il contesto del fermo."
      />
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Dati fermo</CardTitle>
        </CardHeader>
        <CardContent>
          <form key={`${id ?? "new"}-${formVersion}`} className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
            <div className="grid gap-2">
              <Label>Sede</Label>
              <Select value={selectedSiteId} onChange={(e) => setSelectedSiteId(e.target.value)} required>
                <option value="" disabled>Seleziona sede</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowQuickSite((prev) => !prev)}>
                  {showQuickSite ? "Chiudi creazione sede" : "Sede non presente? Creala qui"}
                </Button>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Veicolo</Label>
              <Select value={selectedVehicleId} onChange={(e) => setSelectedVehicleId(e.target.value)} required>
                <option value="" disabled>Seleziona veicolo</option>
                {filteredVehicles.map((v) => (
                  <option key={v.id} value={v.id}>{v.plate} - {v.brand} {v.model}</option>
                ))}
              </Select>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowQuickVehicle((prev) => !prev)}>
                  {showQuickVehicle ? "Chiudi inserimento veicolo" : "Veicolo non presente? Inseriscilo qui"}
                </Button>
              </div>
            </div>

            {showQuickSite && (
              <div className="sm:col-span-2 rounded-lg border bg-muted/30 p-3">
                <p className="mb-3 text-sm font-medium">Creazione rapida sede</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="quickSiteName">Nome sede</Label>
                    <Input
                      id="quickSiteName"
                      name="quickSiteName"
                      placeholder="Milano Nord"
                      value={quickSiteName}
                      onChange={(e) => setQuickSiteName(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="quickSiteCity">Citta</Label>
                    <Input
                      id="quickSiteCity"
                      name="quickSiteCity"
                      placeholder="Milano"
                      value={quickSiteCity}
                      onChange={(e) => setQuickSiteCity(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5 md:col-span-2">
                    <Label htmlFor="quickSiteAddress">Indirizzo</Label>
                    <Input
                      id="quickSiteAddress"
                      name="quickSiteAddress"
                      placeholder="Via Roma 1"
                      value={quickSiteAddress}
                      onChange={(e) => setQuickSiteAddress(e.target.value)}
                    />
                  </div>
                  {quickSiteError && (
                    <Alert className="sm:col-span-2 border-destructive/40 bg-destructive/10 text-destructive">{quickSiteError}</Alert>
                  )}
                  {quickSiteSuccess && (
                    <Alert className="sm:col-span-2 border-emerald-400 bg-emerald-50 text-emerald-700">{quickSiteSuccess}</Alert>
                  )}
                  <div className="sm:col-span-2">
                    <Button type="button" size="sm" onClick={onQuickSiteCreate}>Crea sede</Button>
                  </div>
                </div>
              </div>
            )}

            {showQuickVehicle && (
              <div className="sm:col-span-2 rounded-lg border bg-muted/30 p-3">
                <p className="mb-3 text-sm font-medium">Creazione rapida veicolo</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="quickPlate">Targa (obbligatoria)</Label>
                    <Input id="quickPlate" name="quickPlate" placeholder="AB123CD" value={quickPlate} onChange={(e) => setQuickPlate(e.target.value)} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="quickBrand">Marca (opzionale)</Label>
                    <Input id="quickBrand" name="quickBrand" placeholder="Iveco" value={quickBrand} onChange={(e) => setQuickBrand(e.target.value)} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="quickModel">Modello (opzionale)</Label>
                    <Input id="quickModel" name="quickModel" placeholder="Daily" value={quickModel} onChange={(e) => setQuickModel(e.target.value)} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="quickYear">Anno</Label>
                    <Input id="quickYear" name="quickYear" type="number" min={1950} max={2100} value={quickYear} onChange={(e) => setQuickYear(e.target.value)} />
                  </div>
                  <div className="grid gap-1.5 sm:col-span-2">
                    <Label htmlFor="quickNotes">Note</Label>
                    <Textarea id="quickNotes" name="quickNotes" rows={2} value={quickNotes} onChange={(e) => setQuickNotes(e.target.value)} />
                  </div>
                  {quickVehicleError && (
                    <Alert className="sm:col-span-2 border-destructive/40 bg-destructive/10 text-destructive">{quickVehicleError}</Alert>
                  )}
                  {quickVehicleSuccess && (
                    <Alert className="sm:col-span-2 border-emerald-400 bg-emerald-50 text-emerald-700">{quickVehicleSuccess}</Alert>
                  )}
                  <div className="sm:col-span-2">
                    <Button type="button" size="sm" onClick={onQuickVehicleCreate}>Crea veicolo</Button>
                  </div>
                </div>
              </div>
            )}

            <div className="grid gap-2">
              <Label>Officina</Label>
              <Select value={selectedWorkshopId} onChange={(e) => setSelectedWorkshopId(e.target.value)} required>
                <option value="" disabled>Seleziona officina</option>
                {workshops.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </Select>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowQuickWorkshop((prev) => !prev)}>
                  {showQuickWorkshop ? "Chiudi creazione officina" : "Officina non presente? Creala qui"}
                </Button>
              </div>
            </div>

            {showQuickWorkshop && (
              <div className="sm:col-span-2 rounded-lg border bg-muted/30 p-3">
                <p className="mb-3 text-sm font-medium">Creazione rapida officina</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="quickWorkshopName">Nome officina</Label>
                    <Input
                      id="quickWorkshopName"
                      name="quickWorkshopName"
                      placeholder="Officina Rossi"
                      value={quickWorkshopName}
                      onChange={(e) => setQuickWorkshopName(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="quickWorkshopEmail">Email</Label>
                    <Input
                      id="quickWorkshopEmail"
                      name="quickWorkshopEmail"
                      placeholder="officina@email.it"
                      value={quickWorkshopEmail}
                      onChange={(e) => setQuickWorkshopEmail(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="quickWorkshopPhone">Telefono</Label>
                    <Input
                      id="quickWorkshopPhone"
                      name="quickWorkshopPhone"
                      placeholder="+39..."
                      value={quickWorkshopPhone}
                      onChange={(e) => setQuickWorkshopPhone(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="quickWorkshopCity">Citta</Label>
                    <Input
                      id="quickWorkshopCity"
                      name="quickWorkshopCity"
                      placeholder="Milano"
                      value={quickWorkshopCity}
                      onChange={(e) => setQuickWorkshopCity(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5 md:col-span-2">
                    <Label htmlFor="quickWorkshopAddress">Indirizzo</Label>
                    <Input
                      id="quickWorkshopAddress"
                      name="quickWorkshopAddress"
                      placeholder="Via Roma 1"
                      value={quickWorkshopAddress}
                      onChange={(e) => setQuickWorkshopAddress(e.target.value)}
                    />
                  </div>
                  {quickWorkshopError && (
                    <Alert className="sm:col-span-2 border-destructive/40 bg-destructive/10 text-destructive">{quickWorkshopError}</Alert>
                  )}
                  {quickWorkshopSuccess && (
                    <Alert className="sm:col-span-2 border-emerald-400 bg-emerald-50 text-emerald-700">{quickWorkshopSuccess}</Alert>
                  )}
                  <div className="sm:col-span-2">
                    <Button type="button" size="sm" onClick={onQuickWorkshopCreate}>Crea officina</Button>
                  </div>
                </div>
              </div>
            )}

            <div className="grid gap-2">
              <Label>Stato</Label>
              <Select name="status" defaultValue={formDefaults.status}>
                <option value="OPEN">Aperto</option>
                <option value="IN_PROGRESS">In lavorazione</option>
                <option value="WAITING_PARTS">In attesa ricambi</option>
                <option value="SOLICITED">Sollecitato</option>
                <option value="CLOSED">Chiuso</option>
                <option value="CANCELED">Annullato</option>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Priorita</Label>
              <Select name="priority" defaultValue={formDefaults.priority}>
                <option value="LOW">Bassa</option>
                <option value="MEDIUM">Media</option>
                <option value="HIGH">Alta</option>
                <option value="CRITICAL">Bloccante</option>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Assegnato a</Label>
              <Select name="assignedToUserId" defaultValue={formDefaults.assignedToUserId}>
                <option value="">Non assegnato</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Data apertura</Label>
              <Input type="datetime-local" name="openedAt" defaultValue={formDefaults.openedAt} required />
            </div>

            <div className="grid gap-2">
              <Label>Reminder dopo giorni</Label>
              <Input type="number" min={1} name="reminderAfterDays" defaultValue={formDefaults.reminderAfterDays} />
            </div>

            <div className="grid gap-2">
              <Label>Costo stimato fermo/giorno (€)</Label>
              <Input type="number" min={0} step="0.01" name="estimatedCostPerDay" defaultValue={formDefaults.estimatedCostPerDay} />
            </div>

            <div className="grid gap-2 sm:col-span-2">
              <Label>Motivo</Label>
              <Input name="reason" defaultValue={formDefaults.reason} required />
            </div>

            <div className="grid gap-2 sm:col-span-2">
              <Label>Note</Label>
              <Textarea name="notes" rows={4} defaultValue={formDefaults.notes} />
            </div>

            {error && <Alert className="sm:col-span-2 border-destructive/40 bg-destructive/10 text-destructive">{error}</Alert>}
            <Button type="submit" className="sm:col-span-2">Salva fermo</Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
};
