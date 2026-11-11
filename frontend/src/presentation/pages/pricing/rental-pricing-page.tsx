import {captureOperationContext,publishOperationFeedback} from "../../../application/stores/operation-feedback";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  RentalExtraKmPolicy,
  RentalPriceList,
  RentalPricePackage,
  rentalBookingsUseCases,
  RentalPricingScope
} from "../../../application/usecases/rental-bookings-usecases";
import { masterDataUseCases } from "../../../application/usecases/master-data-usecases";
import { FleetumInlineLoader } from "../../components/brand/fleetum-logo-loader";
import { parseTiers, validatePricing } from "../../components/pricing/pricing-validation";
import { useAuthStore } from "../../../application/stores/auth-store";
import { CommerceDrawer,CommerceCollection,CommerceField,CommerceNotice } from "../../components/ui/commerce-workspace";
import { WorkspacePageHeader } from "../../components/ui/workspace-ui";
import type { PanelMotionHandle } from "../../components/ui/panel-motion";
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
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
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

  const permissions=useAuthStore(state=>state.user?.permissions)??[];
  const has=(permission:string)=>permissions.includes('*')||permissions.includes(permission);
  const canRead=has('vehicles:read'),canWrite=has('vehicles:write'),canReadSites=has('sites:read');
  const listSequence=useRef(0),detailsSequence=useRef(0),selectedRef=useRef<string|null>(null),panelMotion=useRef<PanelMotionHandle|null>(null),panelOrigin=useRef<HTMLElement|null>(null),errorRef=useRef<HTMLDivElement>(null),pendingOperation=useRef<()=>void>(()=>{});
  selectedRef.current=selectedListId;
  const [editorOpen,setEditorOpen]=useState(false),[editorTab,setEditorTab]=useState<'list'|'package'|'policy'>('list');
  const [detailsLoading,setDetailsLoading]=useState(false),[detailsError,setDetailsError]=useState<string|null>(null),[masterError,setMasterError]=useState<string|null>(null);
  const [dirty,setDirty]=useState({list:false,package:false,policy:false}),[discardOpen,setDiscardOpen]=useState(false),[validation,setValidation]=useState<Record<string,string>>({});
  const [deletion,setDeletion]=useState<{kind:'list'|'package'|'policy';item:any}|null>(null);
  const guardChange=(action:()=>void,kind?:'list'|'package'|'policy')=>{if(saving)return;if(kind?dirty[kind]:Object.values(dirty).some(Boolean)){pendingOperation.current=action;setDiscardOpen(true)}else action()};
  const validate=(kind:'list'|'package'|'policy',form:object)=>{const errors=validatePricing(kind,form);setValidation(old=>({...Object.fromEntries(Object.entries(old).filter(([key])=>!key.startsWith(kind+'.'))),...Object.fromEntries(Object.entries(errors).map(([key,value])=>[kind+'.'+key,value]))}));if(Object.keys(errors).length){setError('Controlla i campi indicati prima di salvare.');return false}return true};
  const markChanged=(kind:'list'|'package'|'policy')=>setDirty(old=>({...old,[kind]:true}));
  const clearDirty=(kind:'list'|'package'|'policy')=>setDirty(old=>({...old,[kind]:false}));
  useEffect(()=>{if(editorOpen&&(error||Object.keys(validation).length))errorRef.current?.focus()},[editorOpen,error,validation]);
  useEffect(()=>{if(!Object.values(dirty).some(Boolean))return;const protect=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue=''};window.addEventListener('beforeunload',protect);return()=>window.removeEventListener('beforeunload',protect)},[dirty]);
  const closeEditor=()=>{if(saving)return;guardChange(()=>{setDirty({list:false,package:false,policy:false});const done=()=>{setEditorOpen(false);setError(null);setValidation({})};if(panelMotion.current)panelMotion.current.dismiss(done);else done()})};
  const newList=()=>{if(!canWrite||saving)return;selectedRef.current=null;detailsSequence.current++;setSelectedListId(null);setListForm(defaultListForm());setPackageForm(defaultPackageForm());setPolicyForm(defaultPolicyForm());setPackages([]);setPolicies([]);setValidation({});setError(null);setDetailsError(null);setDirty({list:false,package:false,policy:false});panelOrigin.current=null;setEditorTab('list');setEditorOpen(true)};

  const selectedList = useMemo(() => lists.find((list) => list.id === selectedListId) ?? null, [lists, selectedListId]);

  const loadLists = async () => {
    if(!canRead)return;const sequence=++listSequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await rentalBookingsUseCases.listPriceLists({
        page: 1,
        pageSize: 200,
        search: search || undefined,
        isActive: statusFilter === "all" ? undefined : statusFilter === "active" ? "true" : "false"
      });
      if(sequence!==listSequence.current)return;
      setLists(response.data ?? []);
    } catch (e) {
      if(sequence===listSequence.current)setError((e as Error).message);
    } finally {
      if(sequence===listSequence.current)setLoading(false);
    }
  };

  const loadMasterData = async () => {
    if(!canRead)return;setMasterError(null);
    try{const [sitesRes,vehiclesRes]=await Promise.all([canReadSites?masterDataUseCases.listSites({page:1,pageSize:300}):Promise.resolve({data:[]}),masterDataUseCases.listVehicles({page:1,pageSize:800})]);setSites((sitesRes.data as Site[])??[]);setVehicles((vehiclesRes.data as Vehicle[])??[])}catch(e){setMasterError((e as Error).message)}
  };
  const loadListDetails = async (listId:string) => {
    if(!canRead)return;const sequence=++detailsSequence.current;setDetailsLoading(true);setDetailsError(null);
    try{const [pkgRes,policyRes]=await Promise.all([rentalBookingsUseCases.listPricePackages(listId),rentalBookingsUseCases.listExtraKmPolicies({priceListId:listId})]);if(sequence!==detailsSequence.current||selectedRef.current!==listId)return;setPackages(pkgRes.data??[]);setPolicies(policyRes.data??[]);setLists(current=>current.map(list=>list.id===listId?{...list,_count:list._count?{...list._count,packages:(pkgRes.data??[]).length,extraKmPolicies:(policyRes.data??[]).length}:undefined}:list))}catch(e){if(sequence===detailsSequence.current&&selectedRef.current===listId)setDetailsError((e as Error).message)}finally{if(sequence===detailsSequence.current)setDetailsLoading(false)}
  };

  useEffect(() => {
    void loadMasterData();
  }, [canRead,canReadSites]);

  useEffect(() => {
    void loadLists();
    return()=>{listSequence.current++};
  }, [search, statusFilter,canRead]);

  useEffect(() => {
    if (!selectedListId) {
      detailsSequence.current++;
      setPackages([]);
      setPolicies([]);
      return;
    }
    void loadListDetails(selectedListId);
    return()=>{detailsSequence.current++};
  }, [selectedListId,canRead]);

  const selectList = (list: RentalPriceList,origin?:HTMLElement) => {
    if(saving)return;selectedRef.current=list.id;detailsSequence.current++;panelOrigin.current=origin??null;setPackages([]);setPolicies([]);setDetailsError(null);setError(null);setValidation({});setDirty({list:false,package:false,policy:false});setEditorTab("list");setEditorOpen(true);
    setSelectedListId(list.id);
    if(selectedListId===list.id)void loadListDetails(list.id);
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
    const notificationScope=captureOperationContext();
    event.preventDefault();
    if(!canWrite||saving||!validate("list",listForm))return;
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
        publishOperationFeedback(setSuccess, "Listino aggiornato.", notificationScope);
      } else {
        const created = await rentalBookingsUseCases.createPriceList(payload);
        publishOperationFeedback(setSuccess, "Listino creato.", notificationScope);
        setSelectedListId(created.id);selectedRef.current=created.id;setListForm(previous=>({...previous,id:created.id}));
      }

      clearDirty("list");
      await loadLists();
      if (selectedListId) await loadListDetails(selectedListId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const duplicateList = async (list: RentalPriceList) => {
    const notificationScope=captureOperationContext();
    if(!canWrite||saving)return false;
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
      setStatusFilter("all");selectList(created);
      await loadListDetails(created.id);
      publishOperationFeedback(setSuccess, "Listino duplicato.", notificationScope);
      return true;
    } catch (e) {
      setError((e as Error).message);return false;
    } finally {
      setSaving(false);
    }
  };

  const toggleListStatus = async (list: RentalPriceList) => {
    const notificationScope=captureOperationContext();
    if(!canWrite||saving)return false;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await rentalBookingsUseCases.updatePriceList(list.id, { isActive: !list.isActive });
      await loadLists();
      publishOperationFeedback(setSuccess, `Listino ${list.isActive ? "disattivato" : "attivato"}.`, notificationScope);
      return true;
    } catch (e) {
      setError((e as Error).message);return false;
    } finally {
      setSaving(false);
    }
  };

  const removeList = async (list: RentalPriceList) => {
    const notificationScope=captureOperationContext();
    if(!canWrite||saving)return false;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await rentalBookingsUseCases.deletePriceList(list.id);
      if (selectedListId === list.id) {
        selectedRef.current=null;detailsSequence.current++;setEditorOpen(false);setDirty({list:false,package:false,policy:false});
        setSelectedListId(null);
        setListForm(defaultListForm());
        setPackages([]);
        setPolicies([]);
      }
      await loadLists();
      publishOperationFeedback(setSuccess, "Listino eliminato.", notificationScope);
      return true;
    } catch (e) {
      setError((e as Error).message);return false;
    } finally {
      setSaving(false);
    }
  };

  const savePackage = async (event: FormEvent<HTMLFormElement>) => {
    const notificationScope=captureOperationContext();
    event.preventDefault();
    if(!canWrite||saving||detailsLoading||detailsError||!validate("package",packageForm))return;
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
        publishOperationFeedback(setSuccess, "Pacchetto aggiornato.", notificationScope);
      } else {
        await rentalBookingsUseCases.createPricePackage(selectedListId, payload);
        publishOperationFeedback(setSuccess, "Pacchetto creato.", notificationScope);
      }

      clearDirty("package");
      await loadListDetails(selectedListId);
      setPackageForm(defaultPackageForm());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const savePolicy = async (event: FormEvent<HTMLFormElement>) => {
    const notificationScope=captureOperationContext();
    event.preventDefault();
    if(!canWrite||saving||detailsLoading||detailsError||!validate("policy",policyForm))return;
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
        publishOperationFeedback(setSuccess, "Tariffario km extra aggiornato.", notificationScope);
      } else {
        await rentalBookingsUseCases.createExtraKmPolicy({ priceListId: selectedListId, ...payload });
        publishOperationFeedback(setSuccess, "Tariffario km extra creato.", notificationScope);
      }

      clearDirty("policy");
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
    const notificationScope=captureOperationContext();
    if(!canWrite||saving)return false;
    if (!selectedListId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await rentalBookingsUseCases.deletePricePackage(pkg.id);
      if(packageForm.id===pkg.id){setPackageForm(defaultPackageForm());clearDirty("package");}
      await loadListDetails(selectedListId);
      publishOperationFeedback(setSuccess, "Pacchetto eliminato.", notificationScope);
      return true;
    } catch (e) {
      setError((e as Error).message);return false;
    } finally {
      setSaving(false);
    }
  };

  const deletePolicy = async (policy: RentalExtraKmPolicy) => {
    const notificationScope=captureOperationContext();
    if(!canWrite||saving)return false;
    if (!selectedListId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await rentalBookingsUseCases.deleteExtraKmPolicy(policy.id);
      if(policyForm.id===policy.id){setPolicyForm(defaultPolicyForm());clearDirty("policy");}
      await loadListDetails(selectedListId);
      publishOperationFeedback(setSuccess, "Tariffario km extra eliminato.", notificationScope);
      return true;
    } catch (e) {
      setError((e as Error).message);return false;
    } finally {
      setSaving(false);
    }
  };

  const fieldErrors=Object.entries(validation).filter(([key])=>key.startsWith(editorTab+'.'));
  const submitLabel=editorTab==='list'?(listForm.id?'Aggiorna listino':'Crea listino'):editorTab==='package'?(packageForm.id?'Aggiorna pacchetto':'Aggiungi pacchetto'):(policyForm.id?'Aggiorna tariffario':'Aggiungi tariffario');
  const actions=(list:RentalPriceList)=><div className="commerce-row-actions"><Button variant="outline" onClick={event=>selectList(list,event.currentTarget)} disabled={saving} aria-label={`Apri listino ${list.name}`} aria-haspopup="dialog">Dettagli</Button>{canWrite?<><Button variant="ghost" onClick={()=>void duplicateList(list)} disabled={saving}>Duplica</Button><Button variant="ghost" onClick={()=>void toggleListStatus(list)} disabled={saving}>{list.isActive?'Disattiva':'Attiva'}</Button><Button variant="ghost" className="commerce-remove" onClick={()=>{setError(null);setDeletion({kind:'list',item:list})}} disabled={saving}>Elimina</Button></>:null}</div>;
  const columns=[
   {key:'name',label:'Listino',render:(list:RentalPriceList)=><><button className="commerce-name" onClick={event=>selectList(list,event.currentTarget)} aria-haspopup="dialog" aria-expanded={editorOpen&&selectedListId===list.id}><strong data-panel-origin-title translate="no">{list.name}</strong></button><small translate="no">{list.description||'—'}</small></>},
   {key:'scope',label:'Ambito',render:(list:RentalPriceList)=><>{scopeLabel[list.scope]}<small>{list.scope==='SITE'?list.site?.name:list.scope==='VEHICLE'?list.vehicle?.plate:list.scope==='VEHICLE_CATEGORY'?list.vehicleCategory:null}</small></>},
   {key:'rate',label:'Tariffa base',render:(list:RentalPriceList)=><><strong>{list.baseRateAmount.toFixed(2)} €</strong><small>{{DAILY:'Giornaliera',WEEKLY:'Settimanale',MONTHLY:'Mensile'}[list.baseRateUnit]}</small></>},
   {key:'tax',label:'IVA e sconto',render:(list:RentalPriceList)=><>{list.vatRate}% IVA<small>Sconto {list.discountPercent}%</small></>},
   {key:'status',label:'Stato',render:(list:RentalPriceList)=><span className="commerce-status">{list.isActive?'Attivo':'Non attivo'}</span>},
   {key:'setup',label:'Configurazione',render:(list:RentalPriceList)=><><span>Pacchetti: {list._count?.packages??'—'}</span><small>Tariffe extra: {list._count?.extraKmPolicies??'—'}</small></>},
   {key:'actions',label:'Azioni',render:actions}
  ];
  const confirmDelete=async()=>{if(!deletion||saving||!canWrite)return;const ok=deletion.kind==='list'?await removeList(deletion.item):deletion.kind==='package'?await deletePackage(deletion.item):await deletePolicy(deletion.item);if(ok)setDeletion(null)};
  if(!canRead)return <section className="pricing-workspace commerce-workspace"><h1>Listini</h1><p>Il tuo ruolo non consente l’accesso ai listini.</p></section>;
  return (
   <section className="pricing-workspace commerce-workspace" aria-label="Gestione listini">
    <WorkspacePageHeader eyebrow="LE TUE TARIFFE" title="Listini" description="Tariffe, pacchetti e chilometri extra. Le condizioni del noleggio, organizzate insieme." actions={canWrite?<Button onClick={()=>guardChange(newList)}>Nuovo listino</Button>:undefined}/>
    {!editorOpen&&error?<CommerceNotice>{error}</CommerceNotice>:null}{success?<CommerceNotice tone="success">{success}</CommerceNotice>:null}
    <section className="commerce-panel" aria-labelledby="pricing-list-title"><header className="commerce-panel-header"><div><h2 id="pricing-list-title">I tuoi listini <span>{loading?'—':lists.length}</span></h2><p>Fino a 200 listini per ricerca · condizioni separate dalle prenotazioni già concordate</p></div><Button variant="ghost" aria-label="Aggiorna listini" disabled={loading||saving} onClick={()=>void loadLists()}>Aggiorna</Button></header>
     <div className="commerce-filters pricing-filters"><div><Label htmlFor="pricing-search">Cerca un listino</Label><Input id="pricing-search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Nome o descrizione"/></div><div><Label htmlFor="pricing-status">Stato listino</Label><Select id="pricing-status" value={statusFilter} onChange={event=>setStatusFilter(event.target.value as typeof statusFilter)}><option value="active">Solo attivi</option><option value="inactive">Solo non attivi</option><option value="all">Tutti</option></Select></div></div>
     <div aria-busy={loading}>{loading?<div className="commerce-empty"><FleetumInlineLoader label="Caricamento listini"/></div>:error&&!lists.length?<div className="commerce-empty"><p>Listini non disponibili.</p><Button variant="outline" onClick={()=>void loadLists()}>Riprova elenco listini</Button></div>:!lists.length?<div className="commerce-empty"><h3>Nessun listino trovato.</h3><p>Modifica la ricerca o lo stato selezionato.</p>{canWrite?<Button variant="outline" onClick={newList}>Crea il primo listino</Button>:null}</div>:<CommerceCollection rows={lists} columns={columns} caption="Listini e condizioni tariffarie" selectedId={selectedListId}/>}</div>
    </section>
    {editorOpen?<CommerceDrawer translateTitle={!listForm.id} title={listForm.id?listForm.name||'Dettaglio listino':'Nuovo listino'} description="Le modifiche ai listini non riscrivono le condizioni già concordate nelle prenotazioni." origin={panelOrigin.current} motionRef={panelMotion} onClose={closeEditor} busy={saving} footer={<><Button variant="outline" disabled={saving} onClick={closeEditor}>Chiudi</Button>{canWrite?<Button type="submit" form={`pricing-${editorTab}-form`} aria-busy={saving} disabled={saving||(editorTab!=='list'&&(!selectedListId||detailsLoading||!!detailsError))}>{saving?'Salvataggio...':submitLabel}</Button>:null}</>}>
     {!canWrite?<p className="commerce-hint">Modalità sola lettura.</p>:null}
     <nav className="commerce-section-nav" aria-label="Sezioni listino">{([['list','Listino'],['package','Pacchetti km'],['policy','Km extra']] as const).map(([key,label])=><Button key={key} variant="ghost" aria-pressed={editorTab===key} disabled={saving||(key!=='list'&&!selectedListId)} onClick={()=>setEditorTab(key)}>{label}{dirty[key]?<span aria-label="Modifiche non salvate"> ·</span>:null}</Button>)}</nav>
     {error?<div ref={errorRef} tabIndex={-1} className="commerce-notice commerce-error" role="alert"><p>{error}</p>{fieldErrors.length?<ul>{fieldErrors.map(([key,message])=><li key={key}><a href={`#pricing-${key.replace('.','-')}`} onClick={event=>{event.preventDefault();document.getElementById('pricing-'+key.replace('.','-'))?.focus()}}>{message}</a></li>)}</ul>:null}</div>:null}
     {masterError?<CommerceNotice>{masterError}<Button variant="outline" onClick={()=>void loadMasterData()}>Riprova sedi e veicoli</Button></CommerceNotice>:null}
     {detailsLoading?<p role="status">Caricamento pacchetti e tariffe extra...</p>:null}{detailsError?<CommerceNotice>{detailsError}<Button variant="outline" onClick={()=>selectedListId&&void loadListDetails(selectedListId)}>Riprova dettagli listino</Button></CommerceNotice>:null}

        <Card className="commerce-editor-section" hidden={editorTab!=="list"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{listForm.id ? "Modifica listino" : "Nuovo listino"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form id="pricing-list-form" className="space-y-2" noValidate onChangeCapture={()=>markChanged("list")} onSubmit={saveList}><fieldset className="commerce-form-fields" disabled={saving||!canWrite}>
              <div className="space-y-1"><CommerceField label="Nome listino" id="pricing-list-name" error={validation["list.name"]}><Input value={listForm.name} onChange={(e) => setListForm((s) => ({ ...s, name: e.target.value }))} required /></CommerceField></div>
              <div className="space-y-1"><CommerceField label="Descrizione" id="pricing-list-description" error={validation["list.description"]}><Input value={listForm.description} onChange={(e) => setListForm((s) => ({ ...s, description: e.target.value }))} /></CommerceField></div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1">
                  <CommerceField label="Ambito" id="pricing-list-scope" error={validation["list.scope"]}><Select value={listForm.scope} onChange={(e) => setListForm((s) => ({ ...s, scope: e.target.value as RentalPricingScope }))}>
                    <option value="GLOBAL">Globale</option>
                    <option value="SITE">Per sede</option>
                    <option value="VEHICLE">Per veicolo</option>
                    <option value="VEHICLE_CATEGORY">Per categoria</option>
                  </Select></CommerceField>
                </div>
                <div className="space-y-1">
                  <CommerceField label="Stato" id="pricing-list-isActive" error={validation["list.isActive"]}><Select value={listForm.isActive ? "active" : "inactive"} onChange={(e) => setListForm((s) => ({ ...s, isActive: e.target.value === "active" }))}>
                    <option value="active">Attivo</option>
                    <option value="inactive">Non attivo</option>
                  </Select></CommerceField>
                </div>
              </div>

              {listForm.scope === "SITE" ? (
                <div className="space-y-1">
                  <CommerceField label="Sede" id="pricing-list-siteId" error={validation["list.siteId"]}><Select value={listForm.siteId} onChange={(e) => setListForm((s) => ({ ...s, siteId: e.target.value }))}>
                    <option value="">Seleziona sede</option>
                    {sites.map((site) => <option translate="no" key={site.id} value={site.id}>{site.name}</option>)}
                  </Select></CommerceField>
                </div>
              ) : null}

              {listForm.scope === "VEHICLE" ? (
                <div className="space-y-1">
                  <CommerceField label="Veicolo" id="pricing-list-vehicleId" error={validation["list.vehicleId"]}><Select value={listForm.vehicleId} onChange={(e) => setListForm((s) => ({ ...s, vehicleId: e.target.value }))}>
                    <option value="">Seleziona veicolo</option>
                    {vehicles.map((vehicle) => <option translate="no" key={vehicle.id} value={vehicle.id}>{vehicle.plate} · {vehicle.brand} {vehicle.model}</option>)}
                  </Select></CommerceField>
                </div>
              ) : null}

              {listForm.scope === "VEHICLE_CATEGORY" ? (
                <div className="space-y-1">
                  <CommerceField label="Categoria veicolo" id="pricing-list-vehicleCategory" error={validation["list.vehicleCategory"]}><Input value={listForm.vehicleCategory} onChange={(e) => setListForm((s) => ({ ...s, vehicleCategory: e.target.value }))} placeholder="Es. utilitaria, van, premium" /></CommerceField>
                </div>
              ) : null}

              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1"><CommerceField label="Unita tariffa" id="pricing-list-baseRateUnit" error={validation["list.baseRateUnit"]}><Select value={listForm.baseRateUnit} onChange={(e) => setListForm((s) => ({ ...s, baseRateUnit: e.target.value as PriceListForm["baseRateUnit"] }))}><option value="DAILY">Giornaliera</option><option value="WEEKLY">Settimanale</option><option value="MONTHLY">Mensile</option></Select></CommerceField></div>
                <div className="space-y-1"><CommerceField label="Tariffa base €" id="pricing-list-baseRateAmount" error={validation["list.baseRateAmount"]}><Input type="number" min="0" step="0.01" value={listForm.baseRateAmount} onChange={(e) => setListForm((s) => ({ ...s, baseRateAmount: e.target.value }))} required /></CommerceField></div>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <div className="space-y-1"><CommerceField label="IVA %" id="pricing-list-vatRate" error={validation["list.vatRate"]}><Input type="number" min="0" max="100" step="0.01" value={listForm.vatRate} onChange={(e) => setListForm((s) => ({ ...s, vatRate: e.target.value }))} /></CommerceField></div>
                <div className="space-y-1"><CommerceField label="Sconto %" id="pricing-list-discountPercent" error={validation["list.discountPercent"]}><Input type="number" min="0" max="100" step="0.01" value={listForm.discountPercent} onChange={(e) => setListForm((s) => ({ ...s, discountPercent: e.target.value }))} /></CommerceField></div>
                <div className="space-y-1"><CommerceField label="Priorita" id="pricing-list-priority" error={validation["list.priority"]}><Input type="number" min="0" value={listForm.priority} onChange={(e) => setListForm((s) => ({ ...s, priority: e.target.value }))} /></CommerceField></div>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1"><CommerceField label="Eccedenza oraria" id="pricing-list-hourOverflowRule" error={validation["list.hourOverflowRule"]}><Select value={listForm.hourOverflowRule} onChange={(e) => setListForm((s) => ({ ...s, hourOverflowRule: e.target.value as PriceListForm["hourOverflowRule"] }))}><option value="NONE">Nessun addebito extra</option><option value="HALF_DAY">Mezza giornata</option><option value="FULL_DAY">Giornata intera</option></Select></CommerceField></div>
                <div className="space-y-1"><CommerceField label="Validita da" id="pricing-list-validFrom" error={validation["list.validFrom"]}><Input type="date" value={listForm.validFrom} onChange={(e) => setListForm((s) => ({ ...s, validFrom: e.target.value }))} /></CommerceField></div>
              </div>
              <div className="space-y-1"><CommerceField label="Validita fino a" id="pricing-list-validTo" error={validation["list.validTo"]}><Input type="date" value={listForm.validTo} onChange={(e) => setListForm((s) => ({ ...s, validTo: e.target.value }))} /></CommerceField></div>

              <div className="flex gap-2 pt-1">

                <Button type="button" variant="outline" onClick={() => guardChange(newList,"list")}>Reset</Button>
              </div>
            </fieldset></form>
          </CardContent>
        </Card>

        <Card className="commerce-editor-section" hidden={editorTab!=="package"}>
          <CardHeader className="pb-2"><CardTitle className="text-base">Pacchetti km inclusi</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <form id="pricing-package-form" className="space-y-2" noValidate onChangeCapture={()=>markChanged("package")} onSubmit={savePackage}><fieldset className="commerce-form-fields" disabled={saving||!canWrite}>
              <div className="space-y-1"><CommerceField label="Nome pacchetto" id="pricing-package-name" error={validation["package.name"]}><Input value={packageForm.name} onChange={(e) => setPackageForm((s) => ({ ...s, name: e.target.value }))} required /></CommerceField></div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1"><CommerceField label="Tipo" id="pricing-package-type" error={validation["package.type"]}><Select value={packageForm.type} onChange={(e) => setPackageForm((s) => ({ ...s, type: e.target.value as PackageForm["type"] }))}><option value="LIMITED">Km limitati</option><option value="UNLIMITED">Km illimitati</option></Select></CommerceField></div>
                <div className="space-y-1"><CommerceField label="Codice" id="pricing-package-code" error={validation["package.code"]}><Input value={packageForm.code} onChange={(e) => setPackageForm((s) => ({ ...s, code: e.target.value }))} /></CommerceField></div>
              </div>
              {packageForm.type === "LIMITED" ? (
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="space-y-1"><CommerceField label="Km inclusi" id="pricing-package-kmIncluded" error={validation["package.kmIncluded"]}><Input type="number" min="1" value={packageForm.kmIncluded} onChange={(e) => setPackageForm((s) => ({ ...s, kmIncluded: e.target.value }))} /></CommerceField></div>
                  <div className="space-y-1"><CommerceField label="Validità km inclusi" id="pricing-package-kmScope" error={validation["package.kmScope"]}><Select value={packageForm.kmScope} onChange={(e) => setPackageForm((s) => ({ ...s, kmScope: e.target.value as PackageForm["kmScope"] }))}><option value="PER_DAY">Per giorno</option><option value="PER_RENTAL">Per noleggio</option></Select></CommerceField></div>
                </div>
              ) : null}
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1"><CommerceField label="Ordine" id="pricing-package-sortOrder" error={validation["package.sortOrder"]}><Input type="number" min="0" value={packageForm.sortOrder} onChange={(e) => setPackageForm((s) => ({ ...s, sortOrder: e.target.value }))} /></CommerceField></div>
                <div className="space-y-1"><CommerceField label="Stato" id="pricing-package-isActive" error={validation["package.isActive"]}><Select value={packageForm.isActive ? "active" : "inactive"} onChange={(e) => setPackageForm((s) => ({ ...s, isActive: e.target.value === "active" }))}><option value="active">Attivo</option><option value="inactive">Non attivo</option></Select></CommerceField></div>
              </div>
              <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={packageForm.isDefault} onChange={(e) => setPackageForm((s) => ({ ...s, isDefault: e.target.checked }))} /> Pacchetto predefinito</label>
              <div className="flex gap-2">

                <Button type="button" variant="outline" onClick={() => guardChange(()=>{setPackageForm(defaultPackageForm());clearDirty("package")},"package")}>Reset</Button>
              </div>
            </fieldset></form>

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
                          <p className="text-[11px] text-muted-foreground">{pkg.type==='UNLIMITED'?'Illimitati':'Km limitati'}{pkg.isDefault ? ' · predefinito' : ''}</p>
                        </TableCell>
                        <TableCell>{pkg.type === "UNLIMITED" ? "Illimitati" : `${pkg.kmIncluded ?? 0} (${pkg.kmScope==='PER_DAY'?'al giorno':'per noleggio'})`}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => guardChange(()=>{editPackage(pkg);clearDirty("package")},"package")} disabled={!canWrite||saving}>Modifica</Button>
                            {canWrite?<Button size="sm" variant="destructive" onClick={() => {setError(null);setDeletion({kind:"package",item:pkg})}} disabled={saving}>Elimina</Button>:null}
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

        <Card className="commerce-editor-section" hidden={editorTab!=="policy"}>
          <CardHeader className="pb-2"><CardTitle className="text-base">Tariffario km extra</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <form id="pricing-policy-form" className="space-y-2" noValidate onChangeCapture={()=>markChanged("policy")} onSubmit={savePolicy}><fieldset className="commerce-form-fields" disabled={saving||!canWrite}>
              <div className="space-y-1"><CommerceField label="Nome tariffario" id="pricing-policy-name" error={validation["policy.name"]}><Input value={policyForm.name} onChange={(e) => setPolicyForm((s) => ({ ...s, name: e.target.value }))} required /></CommerceField></div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1"><CommerceField label="Tipo" id="pricing-policy-type" error={validation["policy.type"]}><Select value={policyForm.type} onChange={(e) => setPolicyForm((s) => ({ ...s, type: e.target.value as PolicyForm["type"] }))}><option value="FLAT">Tariffa unica</option><option value="TIERED">A scaglioni</option></Select></CommerceField></div>
                <div className="space-y-1"><CommerceField label="Pacchetto (opz.)" id="pricing-policy-packageId" error={validation["policy.packageId"]}><Select value={policyForm.packageId} onChange={(e) => setPolicyForm((s) => ({ ...s, packageId: e.target.value }))}><option value="">Tutti i pacchetti</option>{packages.map((pkg) => <option translate="no" key={pkg.id} value={pkg.id}>{pkg.name}</option>)}</Select></CommerceField></div>
              </div>

              {policyForm.type === "FLAT" ? (
                <div className="space-y-1"><CommerceField label="Prezzo €/km extra" id="pricing-policy-flatRatePerKm" error={validation["policy.flatRatePerKm"]}><Input type="number" step="0.01" min="0" value={policyForm.flatRatePerKm} onChange={(e) => setPolicyForm((s) => ({ ...s, flatRatePerKm: e.target.value }))} /></CommerceField></div>
              ) : (
                <div className="space-y-1"><CommerceField label="Scaglioni (uno per riga)" id="pricing-policy-tiersText" error={validation["policy.tiersText"]}><Textarea rows={4} value={policyForm.tiersText} onChange={(e) => setPolicyForm((s) => ({ ...s, tiersText: e.target.value }))} placeholder="1-100:0.40\n101-300:0.30\n301-*:0.25" /></CommerceField></div>
              )}

              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1"><CommerceField label="Ordine" id="pricing-policy-sortOrder" error={validation["policy.sortOrder"]}><Input type="number" min="0" value={policyForm.sortOrder} onChange={(e) => setPolicyForm((s) => ({ ...s, sortOrder: e.target.value }))} /></CommerceField></div>
                <div className="space-y-1"><CommerceField label="Stato" id="pricing-policy-isActive" error={validation["policy.isActive"]}><Select value={policyForm.isActive ? "active" : "inactive"} onChange={(e) => setPolicyForm((s) => ({ ...s, isActive: e.target.value === "active" }))}><option value="active">Attivo</option><option value="inactive">Non attivo</option></Select></CommerceField></div>
              </div>

              <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={policyForm.isDefault} onChange={(e) => setPolicyForm((s) => ({ ...s, isDefault: e.target.checked }))} /> Tariffario predefinito</label>
              <div className="flex gap-2">

                <Button type="button" variant="outline" onClick={() => guardChange(()=>{setPolicyForm(defaultPolicyForm());clearDirty("policy")},"policy")}>Reset</Button>
              </div>
            </fieldset></form>

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
                          <p className="text-[11px] text-muted-foreground">{policy.type==='FLAT'?'Tariffa unica':'A scaglioni'}{policy.isDefault ? ' · predefinito' : ''}</p>
                        </TableCell>
                        <TableCell>
                          {policy.type === "FLAT"
                            ? `${policy.flatRatePerKm ?? 0} €/km`
                            : `${policy.tiers?.length ?? 0} scaglioni`}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => guardChange(()=>{editPolicy(policy);clearDirty("policy")},"policy")} disabled={!canWrite||saving}>Modifica</Button>
                            {canWrite?<Button size="sm" variant="destructive" onClick={() => {setError(null);setDeletion({kind:"policy",item:policy})}} disabled={saving}>Elimina</Button>:null}
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

    </CommerceDrawer>:null}
    {discardOpen?<CommerceDrawer compact level={130} title="Modifiche non salvate" onClose={()=>setDiscardOpen(false)} footer={<><Button variant="outline" onClick={()=>setDiscardOpen(false)}>Continua modifica</Button><Button onClick={()=>{setDiscardOpen(false);pendingOperation.current()}}>Esci senza salvare</Button></>}><p>Le modifiche non salvate verranno perse. Vuoi proseguire?</p></CommerceDrawer>:null}
    {deletion?<CommerceDrawer compact level={135} title="Conferma eliminazione" busy={saving} onClose={()=>setDeletion(null)} footer={<><Button variant="outline" disabled={saving} onClick={()=>setDeletion(null)}>Annulla</Button><Button variant="destructive" disabled={saving} onClick={()=>void confirmDelete()}>{saving?'Rimozione...':'Conferma eliminazione'}</Button></>}><p>Confermi l’eliminazione di <strong translate="no">{deletion.item.name}</strong>?</p>{error?<CommerceNotice>{error}</CommerceNotice>:null}</CommerceDrawer>:null}
   </section>
  );
};
