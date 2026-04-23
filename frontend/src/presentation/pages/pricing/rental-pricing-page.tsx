import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  RentalExtraKmPolicy,
  RentalPriceList,
  RentalPricePackage,
  rentalBookingsUseCases,
  RentalPricingScope
} from "../../../application/usecases/rental-bookings-usecases";
import { masterDataUseCases } from "../../../application/usecases/master-data-usecases";
import { PageHeader } from "../../components/layout/page-header";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { Textarea } from "../../components/ui/textarea";

type Site = { id: string; name: string; city?: string };
type Vehicle = { id: string; plate: string; brand: string; model: string };

type PriceListForm = {
  id?: string;
  name: string;
  scope: RentalPricingScope;
  siteId: string;
  vehicleId: string;
  vehicleCategory: string;
  baseRateUnit: "DAILY" | "WEEKLY" | "MONTHLY";
  baseRateAmount: string;
  vatRate: string;
  discountPercent: string;
  hourOverflowRule: "NONE" | "HALF_DAY" | "FULL_DAY";
  priority: string;
  validFrom: string;
  validTo: string;
  isActive: boolean;
  description: string;
};

type PackageForm = {
  id?: string;
  name: string;
  code: string;
  type: "LIMITED" | "UNLIMITED";
  kmIncluded: string;
  kmScope: "PER_DAY" | "PER_RENTAL";
  sortOrder: string;
  isDefault: boolean;
  isActive: boolean;
};

type PolicyForm = {
  id?: string;
  name: string;
  packageId: string;
  type: "FLAT" | "TIERED";
  flatRatePerKm: string;
  tiersText: string;
  sortOrder: string;
  isDefault: boolean;
  isActive: boolean;
};

const defaultListForm = (): PriceListForm => ({
  name: "",
  scope: "GLOBAL",
  siteId: "",
  vehicleId: "",
  vehicleCategory: "",
  baseRateUnit: "DAILY",
  baseRateAmount: "",
  vatRate: "22",
  discountPercent: "0",
  hourOverflowRule: "FULL_DAY",
  priority: "100",
  validFrom: "",
  validTo: "",
  isActive: true,
  description: ""
});

const defaultPackageForm = (): PackageForm => ({
  name: "",
  code: "",
  type: "LIMITED",
  kmIncluded: "100",
  kmScope: "PER_DAY",
  sortOrder: "0",
  isDefault: false,
  isActive: true
});

const defaultPolicyForm = (): PolicyForm => ({
  name: "",
  packageId: "",
  type: "FLAT",
  flatRatePerKm: "0.40",
  tiersText: "1-100:0.40\n101-300:0.30\n301-*:0.25",
  sortOrder: "0",
  isDefault: false,
  isActive: true
});

const toDateInput = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const parseTiers = (raw: string) => {
  const rows = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return rows.map((row, idx) => {
    const cleaned = row.replace(/\s+/g, "");
    const [range, ratePart] = cleaned.includes(":") ? cleaned.split(":") : cleaned.split("=");
    if (!range || !ratePart) throw new Error(`Formato scaglione non valido alla riga ${idx + 1}. Usa 1-100:0.40`);

    const [fromRaw, toRaw] = range.split("-");
    const fromKm = Number(fromRaw);
    if (!Number.isFinite(fromKm) || fromKm < 1) throw new Error(`fromKm non valido alla riga ${idx + 1}`);

    const toKm = toRaw === "*" || toRaw === undefined ? null : Number(toRaw);
    if (toKm !== null && (!Number.isFinite(toKm) || toKm < fromKm)) {
      throw new Error(`toKm non valido alla riga ${idx + 1}`);
    }

    const ratePerKm = Number(ratePart.replace(",", "."));
    if (!Number.isFinite(ratePerKm) || ratePerKm < 0) {
      throw new Error(`ratePerKm non valido alla riga ${idx + 1}`);
    }

    return { fromKm, toKm, ratePerKm, sortOrder: idx };
  });
};

const scopeLabel: Record<RentalPricingScope, string> = {
  GLOBAL: "Globale",
  SITE: "Per sede",
  VEHICLE: "Per veicolo",
  VEHICLE_CATEGORY: "Per categoria"
};

export const RentalPricingPage = () => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");
  const [lists, setLists] = useState<RentalPriceList[]>([]);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [packages, setPackages] = useState<RentalPricePackage[]>([]);
  const [policies, setPolicies] = useState<RentalExtraKmPolicy[]>([]);
  const [listForm, setListForm] = useState<PriceListForm>(() => defaultListForm());
  const [packageForm, setPackageForm] = useState<PackageForm>(() => defaultPackageForm());
  const [policyForm, setPolicyForm] = useState<PolicyForm>(() => defaultPolicyForm());
  const [sites, setSites] = useState<Site[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedList = useMemo(() => lists.find((list) => list.id === selectedListId) ?? null, [lists, selectedListId]);

  const loadLists = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await rentalBookingsUseCases.listPriceLists({
        page: 1,
        pageSize: 200,
        search: search || undefined,
        isActive: statusFilter === "all" ? undefined : statusFilter === "active" ? "true" : "false"
      });
      setLists(response.data ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadMasterData = async () => {
    const [sitesRes, vehiclesRes] = await Promise.all([
      masterDataUseCases.listSites({ page: 1, pageSize: 300 }),
      masterDataUseCases.listVehicles({ page: 1, pageSize: 800 })
    ]);
    setSites((sitesRes.data as Site[]) ?? []);
    setVehicles((vehiclesRes.data as Vehicle[]) ?? []);
  };

  const loadListDetails = async (listId: string) => {
    const [pkgRes, policyRes] = await Promise.all([
      rentalBookingsUseCases.listPricePackages(listId),
      rentalBookingsUseCases.listExtraKmPolicies({ priceListId: listId })
    ]);
    setPackages(pkgRes.data ?? []);
    setPolicies(policyRes.data ?? []);
  };

  useEffect(() => {
    void loadMasterData();
  }, []);

  useEffect(() => {
    void loadLists();
  }, [search, statusFilter]);

  useEffect(() => {
    if (!selectedListId) {
      setPackages([]);
      setPolicies([]);
      return;
    }
    void loadListDetails(selectedListId);
  }, [selectedListId]);

  const selectList = (list: RentalPriceList) => {
    setSelectedListId(list.id);
    setListForm({
      id: list.id,
      name: list.name,
      scope: list.scope,
      siteId: list.siteId ?? "",
      vehicleId: list.vehicleId ?? "",
      vehicleCategory: list.vehicleCategory ?? "",
      baseRateUnit: list.baseRateUnit,
      baseRateAmount: String(list.baseRateAmount),
      vatRate: String(list.vatRate),
      discountPercent: String(list.discountPercent),
      hourOverflowRule: list.hourOverflowRule,
      priority: String(list.priority),
      validFrom: toDateInput(list.validFrom),
      validTo: toDateInput(list.validTo),
      isActive: list.isActive,
      description: list.description ?? ""
    });
    setPackageForm(defaultPackageForm());
    setPolicyForm(defaultPolicyForm());
  };

  const saveList = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = {
        name: listForm.name.trim(),
        description: listForm.description.trim() || undefined,
        scope: listForm.scope,
        siteId: listForm.scope === "SITE" ? listForm.siteId || undefined : undefined,
        vehicleId: listForm.scope === "VEHICLE" ? listForm.vehicleId || undefined : undefined,
        vehicleCategory: listForm.scope === "VEHICLE_CATEGORY" ? listForm.vehicleCategory.trim() || undefined : undefined,
        baseRateUnit: listForm.baseRateUnit,
        baseRateAmount: Number(listForm.baseRateAmount),
        vatRate: Number(listForm.vatRate),
        discountPercent: Number(listForm.discountPercent),
        hourOverflowRule: listForm.hourOverflowRule,
        priority: Number(listForm.priority),
        validFrom: listForm.validFrom ? new Date(`${listForm.validFrom}T00:00:00`).toISOString() : undefined,
        validTo: listForm.validTo ? new Date(`${listForm.validTo}T23:59:59`).toISOString() : undefined,
        isActive: listForm.isActive
      };

      if (!payload.name) throw new Error("Nome listino obbligatorio.");
      if (!Number.isFinite(payload.baseRateAmount) || payload.baseRateAmount < 0) {
        throw new Error("Tariffa base non valida.");
      }

      if (listForm.id) {
        await rentalBookingsUseCases.updatePriceList(listForm.id, payload);
        setSuccess("Listino aggiornato.");
      } else {
        const created = await rentalBookingsUseCases.createPriceList(payload);
        setSuccess("Listino creato.");
        setSelectedListId(created.id);
      }

      await loadLists();
      if (selectedListId) await loadListDetails(selectedListId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const duplicateList = async (list: RentalPriceList) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await rentalBookingsUseCases.createPriceList({
        name: `${list.name} (copia)`,
        description: list.description ?? undefined,
        scope: list.scope,
        siteId: list.siteId ?? undefined,
        vehicleId: list.vehicleId ?? undefined,
        vehicleCategory: list.vehicleCategory ?? undefined,
        baseRateUnit: list.baseRateUnit,
        baseRateAmount: list.baseRateAmount,
        vatRate: list.vatRate,
        discountPercent: list.discountPercent,
        hourOverflowRule: list.hourOverflowRule,
        priority: list.priority + 1,
        validFrom: list.validFrom ?? undefined,
        validTo: list.validTo ?? undefined,
        isActive: false
      });

      const [pkgRes, polRes] = await Promise.all([
        rentalBookingsUseCases.listPricePackages(list.id),
        rentalBookingsUseCases.listExtraKmPolicies({ priceListId: list.id })
      ]);

      const pkgMap = new Map<string, string>();
      for (const pkg of pkgRes.data ?? []) {
        const newPkg = await rentalBookingsUseCases.createPricePackage(created.id, {
          name: pkg.name,
          code: pkg.code ?? undefined,
          type: pkg.type,
          kmIncluded: pkg.kmIncluded ?? undefined,
          kmScope: pkg.kmScope,
          isDefault: pkg.isDefault,
          isActive: pkg.isActive,
          sortOrder: pkg.sortOrder
        });
        pkgMap.set(pkg.id, newPkg.id);
      }

      for (const policy of polRes.data ?? []) {
        await rentalBookingsUseCases.createExtraKmPolicy({
          priceListId: created.id,
          packageId: policy.packageId ? pkgMap.get(policy.packageId) : undefined,
          name: policy.name,
          type: policy.type,
          flatRatePerKm: policy.flatRatePerKm ?? undefined,
          isDefault: policy.isDefault,
          isActive: policy.isActive,
          sortOrder: policy.sortOrder,
          tiers: (policy.tiers ?? []).map((tier) => ({
            fromKm: tier.fromKm,
            toKm: tier.toKm ?? undefined,
            ratePerKm: tier.ratePerKm,
            sortOrder: tier.sortOrder
          }))
        });
      }

      await loadLists();
      setSelectedListId(created.id);
      await loadListDetails(created.id);
      setSuccess("Listino duplicato.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleListStatus = async (list: RentalPriceList) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await rentalBookingsUseCases.updatePriceList(list.id, { isActive: !list.isActive });
      await loadLists();
      setSuccess(`Listino ${list.isActive ? "disattivato" : "attivato"}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const removeList = async (list: RentalPriceList) => {
    if (!window.confirm(`Eliminare il listino ${list.name}?`)) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await rentalBookingsUseCases.deletePriceList(list.id);
      if (selectedListId === list.id) {
        setSelectedListId(null);
        setListForm(defaultListForm());
        setPackages([]);
        setPolicies([]);
      }
      await loadLists();
      setSuccess("Listino eliminato.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const savePackage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedListId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = {
        name: packageForm.name.trim(),
        code: packageForm.code.trim() || undefined,
        type: packageForm.type,
        kmIncluded: packageForm.type === "UNLIMITED" ? undefined : Number(packageForm.kmIncluded),
        kmScope: packageForm.kmScope,
        sortOrder: Number(packageForm.sortOrder),
        isDefault: packageForm.isDefault,
        isActive: packageForm.isActive
      };

      if (!payload.name) throw new Error("Nome pacchetto obbligatorio.");
      if (payload.type === "LIMITED" && (!Number.isFinite(Number(payload.kmIncluded)) || Number(payload.kmIncluded) <= 0)) {
        throw new Error("Inserisci km inclusi validi.");
      }

      if (packageForm.id) {
        await rentalBookingsUseCases.updatePricePackage(packageForm.id, payload);
        setSuccess("Pacchetto aggiornato.");
      } else {
        await rentalBookingsUseCases.createPricePackage(selectedListId, payload);
        setSuccess("Pacchetto creato.");
      }

      await loadListDetails(selectedListId);
      setPackageForm(defaultPackageForm());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const savePolicy = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedListId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const tiers =
        policyForm.type === "TIERED"
          ? parseTiers(policyForm.tiersText).map((tier) => ({ ...tier, toKm: tier.toKm ?? undefined }))
          : [];
      const payload = {
        name: policyForm.name.trim(),
        packageId: policyForm.packageId || undefined,
        type: policyForm.type,
        flatRatePerKm: policyForm.type === "FLAT" ? Number(policyForm.flatRatePerKm) : undefined,
        sortOrder: Number(policyForm.sortOrder),
        isDefault: policyForm.isDefault,
        isActive: policyForm.isActive,
        tiers
      };

      if (!payload.name) throw new Error("Nome tariffario obbligatorio.");
      if (payload.type === "FLAT" && (!Number.isFinite(Number(payload.flatRatePerKm)) || Number(payload.flatRatePerKm) < 0)) {
        throw new Error("Tariffa km extra FLAT non valida.");
      }

      if (policyForm.id) {
        await rentalBookingsUseCases.updateExtraKmPolicy(policyForm.id, payload);
        setSuccess("Tariffario km extra aggiornato.");
      } else {
        await rentalBookingsUseCases.createExtraKmPolicy({ priceListId: selectedListId, ...payload });
        setSuccess("Tariffario km extra creato.");
      }

      await loadListDetails(selectedListId);
      setPolicyForm(defaultPolicyForm());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const editPackage = (pkg: RentalPricePackage) => {
    setPackageForm({
      id: pkg.id,
      name: pkg.name,
      code: pkg.code ?? "",
      type: pkg.type,
      kmIncluded: pkg.kmIncluded != null ? String(pkg.kmIncluded) : "",
      kmScope: pkg.kmScope,
      sortOrder: String(pkg.sortOrder),
      isDefault: pkg.isDefault,
      isActive: pkg.isActive
    });
  };

  const editPolicy = (policy: RentalExtraKmPolicy) => {
    setPolicyForm({
      id: policy.id,
      name: policy.name,
      packageId: policy.packageId ?? "",
      type: policy.type,
      flatRatePerKm: policy.flatRatePerKm != null ? String(policy.flatRatePerKm) : "0.40",
      tiersText: (policy.tiers ?? [])
        .map((tier) => `${tier.fromKm}-${tier.toKm ?? "*"}:${tier.ratePerKm}`)
        .join("\n"),
      sortOrder: String(policy.sortOrder),
      isDefault: policy.isDefault,
      isActive: policy.isActive
    });
  };

  const deletePackage = async (pkg: RentalPricePackage) => {
    if (!window.confirm(`Eliminare il pacchetto ${pkg.name}?`)) return;
    if (!selectedListId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await rentalBookingsUseCases.deletePricePackage(pkg.id);
      await loadListDetails(selectedListId);
      setSuccess("Pacchetto eliminato.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const deletePolicy = async (policy: RentalExtraKmPolicy) => {
    if (!window.confirm(`Eliminare il tariffario ${policy.name}?`)) return;
    if (!selectedListId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await rentalBookingsUseCases.deleteExtraKmPolicy(policy.id);
      await loadListDetails(selectedListId);
      setSuccess("Tariffario km extra eliminato.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3">
      <PageHeader
        title="Listini Noleggi"
        subtitle="Configura tariffa base, pacchetti km (100km, illimitati) e tariffari km extra per booking e contratti."
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}

      <Card className="saas-surface">
        <CardContent className="space-y-3 py-4">
          <div className="grid gap-2 md:grid-cols-[1fr_180px_auto]">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca listino..." />
            <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option value="active">Solo attivi</option>
              <option value="inactive">Solo non attivi</option>
              <option value="all">Tutti</option>
            </Select>
            <Button variant="outline" onClick={() => void loadLists()} disabled={loading}>Aggiorna</Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Listino</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Tariffa base</TableHead>
                <TableHead>IVA / sconto</TableHead>
                <TableHead>Pacchetti</TableHead>
                <TableHead>Policy extra</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-xs text-muted-foreground">Caricamento listini...</TableCell>
                </TableRow>
              ) : lists.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-xs text-muted-foreground">Nessun listino trovato.</TableCell>
                </TableRow>
              ) : (
                lists.map((list) => (
                  <TableRow key={list.id} className={selectedListId === list.id ? "bg-primary/5" : ""}>
                    <TableCell>
                      <p className="font-medium">{list.name}</p>
                      <p className="text-[11px] text-muted-foreground">{list.description || "-"}</p>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Badge variant="secondary">{scopeLabel[list.scope]}</Badge>
                        {list.scope === "SITE" && list.site ? <p className="text-[11px] text-muted-foreground">{list.site.name}</p> : null}
                        {list.scope === "VEHICLE" && list.vehicle ? <p className="text-[11px] text-muted-foreground">{list.vehicle.plate}</p> : null}
                        {list.scope === "VEHICLE_CATEGORY" ? <p className="text-[11px] text-muted-foreground">{list.vehicleCategory || "-"}</p> : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{list.baseRateAmount.toFixed(2)} €</p>
                      <p className="text-[11px] text-muted-foreground">{list.baseRateUnit}</p>
                    </TableCell>
                    <TableCell>
                      <p>{list.vatRate}% IVA</p>
                      <p className="text-[11px] text-muted-foreground">Sconto {list.discountPercent}%</p>
                    </TableCell>
                    <TableCell>{list._count?.packages ?? 0}</TableCell>
                    <TableCell>{list._count?.extraKmPolicies ?? 0}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => selectList(list)}>Seleziona</Button>
                        <Button size="sm" variant="outline" onClick={() => void duplicateList(list)} disabled={saving}>Duplica</Button>
                        <Button size="sm" variant="outline" onClick={() => void toggleListStatus(list)} disabled={saving}>
                          {list.isActive ? "Disattiva" : "Attiva"}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => void removeList(list)} disabled={saving}>Elimina</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-3 xl:grid-cols-3">
        <Card className="saas-surface xl:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{listForm.id ? "Modifica listino" : "Nuovo listino"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-2" onSubmit={saveList}>
              <div className="space-y-1"><Label>Nome listino</Label><Input value={listForm.name} onChange={(e) => setListForm((s) => ({ ...s, name: e.target.value }))} required /></div>
              <div className="space-y-1"><Label>Descrizione</Label><Input value={listForm.description} onChange={(e) => setListForm((s) => ({ ...s, description: e.target.value }))} /></div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Scope</Label>
                  <Select value={listForm.scope} onChange={(e) => setListForm((s) => ({ ...s, scope: e.target.value as RentalPricingScope }))}>
                    <option value="GLOBAL">Globale</option>
                    <option value="SITE">Per sede</option>
                    <option value="VEHICLE">Per veicolo</option>
                    <option value="VEHICLE_CATEGORY">Per categoria</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Stato</Label>
                  <Select value={listForm.isActive ? "active" : "inactive"} onChange={(e) => setListForm((s) => ({ ...s, isActive: e.target.value === "active" }))}>
                    <option value="active">Attivo</option>
                    <option value="inactive">Non attivo</option>
                  </Select>
                </div>
              </div>

              {listForm.scope === "SITE" ? (
                <div className="space-y-1">
                  <Label>Sede</Label>
                  <Select value={listForm.siteId} onChange={(e) => setListForm((s) => ({ ...s, siteId: e.target.value }))}>
                    <option value="">Seleziona sede</option>
                    {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
                  </Select>
                </div>
              ) : null}

              {listForm.scope === "VEHICLE" ? (
                <div className="space-y-1">
                  <Label>Veicolo</Label>
                  <Select value={listForm.vehicleId} onChange={(e) => setListForm((s) => ({ ...s, vehicleId: e.target.value }))}>
                    <option value="">Seleziona veicolo</option>
                    {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.plate} · {vehicle.brand} {vehicle.model}</option>)}
                  </Select>
                </div>
              ) : null}

              {listForm.scope === "VEHICLE_CATEGORY" ? (
                <div className="space-y-1">
                  <Label>Categoria veicolo</Label>
                  <Input value={listForm.vehicleCategory} onChange={(e) => setListForm((s) => ({ ...s, vehicleCategory: e.target.value }))} placeholder="Es. utilitaria, van, premium" />
                </div>
              ) : null}

              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1"><Label>Unita tariffa</Label><Select value={listForm.baseRateUnit} onChange={(e) => setListForm((s) => ({ ...s, baseRateUnit: e.target.value as PriceListForm["baseRateUnit"] }))}><option value="DAILY">Giornaliera</option><option value="WEEKLY">Settimanale</option><option value="MONTHLY">Mensile</option></Select></div>
                <div className="space-y-1"><Label>Tariffa base €</Label><Input type="number" min="0" step="0.01" value={listForm.baseRateAmount} onChange={(e) => setListForm((s) => ({ ...s, baseRateAmount: e.target.value }))} required /></div>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <div className="space-y-1"><Label>IVA %</Label><Input type="number" min="0" max="100" step="0.01" value={listForm.vatRate} onChange={(e) => setListForm((s) => ({ ...s, vatRate: e.target.value }))} /></div>
                <div className="space-y-1"><Label>Sconto %</Label><Input type="number" min="0" max="100" step="0.01" value={listForm.discountPercent} onChange={(e) => setListForm((s) => ({ ...s, discountPercent: e.target.value }))} /></div>
                <div className="space-y-1"><Label>Priorita</Label><Input type="number" min="0" value={listForm.priority} onChange={(e) => setListForm((s) => ({ ...s, priority: e.target.value }))} /></div>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1"><Label>Eccedenza oraria</Label><Select value={listForm.hourOverflowRule} onChange={(e) => setListForm((s) => ({ ...s, hourOverflowRule: e.target.value as PriceListForm["hourOverflowRule"] }))}><option value="NONE">Nessun addebito extra</option><option value="HALF_DAY">Mezza giornata</option><option value="FULL_DAY">Giornata intera</option></Select></div>
                <div className="space-y-1"><Label>Validita da</Label><Input type="date" value={listForm.validFrom} onChange={(e) => setListForm((s) => ({ ...s, validFrom: e.target.value }))} /></div>
              </div>
              <div className="space-y-1"><Label>Validita fino a</Label><Input type="date" value={listForm.validTo} onChange={(e) => setListForm((s) => ({ ...s, validTo: e.target.value }))} /></div>

              <div className="flex gap-2 pt-1">
                <Button type="submit" disabled={saving}>{saving ? "Salvataggio..." : listForm.id ? "Aggiorna listino" : "Crea listino"}</Button>
                <Button type="button" variant="outline" onClick={() => setListForm(defaultListForm())}>Reset</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="saas-surface xl:col-span-1">
          <CardHeader className="pb-2"><CardTitle className="text-base">Pacchetti km inclusi</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <form className="space-y-2" onSubmit={savePackage}>
              <div className="space-y-1"><Label>Nome pacchetto</Label><Input value={packageForm.name} onChange={(e) => setPackageForm((s) => ({ ...s, name: e.target.value }))} required /></div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1"><Label>Tipo</Label><Select value={packageForm.type} onChange={(e) => setPackageForm((s) => ({ ...s, type: e.target.value as PackageForm["type"] }))}><option value="LIMITED">LIMITED</option><option value="UNLIMITED">UNLIMITED</option></Select></div>
                <div className="space-y-1"><Label>Codice</Label><Input value={packageForm.code} onChange={(e) => setPackageForm((s) => ({ ...s, code: e.target.value }))} /></div>
              </div>
              {packageForm.type === "LIMITED" ? (
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="space-y-1"><Label>Km inclusi</Label><Input type="number" min="1" value={packageForm.kmIncluded} onChange={(e) => setPackageForm((s) => ({ ...s, kmIncluded: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>Scope km</Label><Select value={packageForm.kmScope} onChange={(e) => setPackageForm((s) => ({ ...s, kmScope: e.target.value as PackageForm["kmScope"] }))}><option value="PER_DAY">Per giorno</option><option value="PER_RENTAL">Per noleggio</option></Select></div>
                </div>
              ) : null}
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1"><Label>Ordine</Label><Input type="number" min="0" value={packageForm.sortOrder} onChange={(e) => setPackageForm((s) => ({ ...s, sortOrder: e.target.value }))} /></div>
                <div className="space-y-1"><Label>Stato</Label><Select value={packageForm.isActive ? "active" : "inactive"} onChange={(e) => setPackageForm((s) => ({ ...s, isActive: e.target.value === "active" }))}><option value="active">Attivo</option><option value="inactive">Non attivo</option></Select></div>
              </div>
              <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={packageForm.isDefault} onChange={(e) => setPackageForm((s) => ({ ...s, isDefault: e.target.checked }))} /> Pacchetto predefinito</label>
              <div className="flex gap-2">
                <Button type="submit" disabled={saving || !selectedList}>{packageForm.id ? "Aggiorna" : "Aggiungi"}</Button>
                <Button type="button" variant="outline" onClick={() => setPackageForm(defaultPackageForm())}>Reset</Button>
              </div>
            </form>

            <div className="max-h-72 overflow-auto rounded-md border">
              <Table>
                <TableHeader><TableRow><TableHead>Pacchetto</TableHead><TableHead>Km</TableHead><TableHead className="text-right">Azioni</TableHead></TableRow></TableHeader>
                <TableBody>
                  {packages.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center text-xs text-muted-foreground">Nessun pacchetto.</TableCell></TableRow>
                  ) : (
                    packages.map((pkg) => (
                      <TableRow key={pkg.id}>
                        <TableCell>
                          <p className="font-medium">{pkg.name}</p>
                          <p className="text-[11px] text-muted-foreground">{pkg.type}{pkg.isDefault ? " · default" : ""}</p>
                        </TableCell>
                        <TableCell>{pkg.type === "UNLIMITED" ? "Illimitati" : `${pkg.kmIncluded ?? 0} (${pkg.kmScope})`}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => editPackage(pkg)}>Modifica</Button>
                            <Button size="sm" variant="destructive" onClick={() => void deletePackage(pkg)}>Elimina</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="saas-surface xl:col-span-1">
          <CardHeader className="pb-2"><CardTitle className="text-base">Tariffario km extra</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <form className="space-y-2" onSubmit={savePolicy}>
              <div className="space-y-1"><Label>Nome tariffario</Label><Input value={policyForm.name} onChange={(e) => setPolicyForm((s) => ({ ...s, name: e.target.value }))} required /></div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1"><Label>Tipo</Label><Select value={policyForm.type} onChange={(e) => setPolicyForm((s) => ({ ...s, type: e.target.value as PolicyForm["type"] }))}><option value="FLAT">FLAT</option><option value="TIERED">TIERED</option></Select></div>
                <div className="space-y-1"><Label>Pacchetto (opz.)</Label><Select value={policyForm.packageId} onChange={(e) => setPolicyForm((s) => ({ ...s, packageId: e.target.value }))}><option value="">Tutti i pacchetti</option>{packages.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.name}</option>)}</Select></div>
              </div>

              {policyForm.type === "FLAT" ? (
                <div className="space-y-1"><Label>Prezzo €/km extra</Label><Input type="number" step="0.01" min="0" value={policyForm.flatRatePerKm} onChange={(e) => setPolicyForm((s) => ({ ...s, flatRatePerKm: e.target.value }))} /></div>
              ) : (
                <div className="space-y-1"><Label>Scaglioni (uno per riga)</Label><Textarea rows={4} value={policyForm.tiersText} onChange={(e) => setPolicyForm((s) => ({ ...s, tiersText: e.target.value }))} placeholder="1-100:0.40\n101-300:0.30\n301-*:0.25" /></div>
              )}

              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1"><Label>Ordine</Label><Input type="number" min="0" value={policyForm.sortOrder} onChange={(e) => setPolicyForm((s) => ({ ...s, sortOrder: e.target.value }))} /></div>
                <div className="space-y-1"><Label>Stato</Label><Select value={policyForm.isActive ? "active" : "inactive"} onChange={(e) => setPolicyForm((s) => ({ ...s, isActive: e.target.value === "active" }))}><option value="active">Attivo</option><option value="inactive">Non attivo</option></Select></div>
              </div>

              <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={policyForm.isDefault} onChange={(e) => setPolicyForm((s) => ({ ...s, isDefault: e.target.checked }))} /> Tariffario predefinito</label>
              <div className="flex gap-2">
                <Button type="submit" disabled={saving || !selectedList}>{policyForm.id ? "Aggiorna" : "Aggiungi"}</Button>
                <Button type="button" variant="outline" onClick={() => setPolicyForm(defaultPolicyForm())}>Reset</Button>
              </div>
            </form>

            <div className="max-h-72 overflow-auto rounded-md border">
              <Table>
                <TableHeader><TableRow><TableHead>Tariffario</TableHead><TableHead>Regola</TableHead><TableHead className="text-right">Azioni</TableHead></TableRow></TableHeader>
                <TableBody>
                  {policies.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center text-xs text-muted-foreground">Nessun tariffario km extra.</TableCell></TableRow>
                  ) : (
                    policies.map((policy) => (
                      <TableRow key={policy.id}>
                        <TableCell>
                          <p className="font-medium">{policy.name}</p>
                          <p className="text-[11px] text-muted-foreground">{policy.type}{policy.isDefault ? " · default" : ""}</p>
                        </TableCell>
                        <TableCell>
                          {policy.type === "FLAT"
                            ? `${policy.flatRatePerKm ?? 0} €/km`
                            : `${policy.tiers?.length ?? 0} scaglioni`}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => editPolicy(policy)}>Modifica</Button>
                            <Button size="sm" variant="destructive" onClick={() => void deletePolicy(policy)}>Elimina</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
};
